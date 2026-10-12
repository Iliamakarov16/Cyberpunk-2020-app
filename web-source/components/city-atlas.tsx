'use client';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useBackEvent} from '@/lib/native-navigation';
import {usePlayerSettings} from '@/components/player-help';
import {readInterfaceStyle} from '@/lib/interface-style';
export type CityAtlasSelection={type:'nc-atlas:selection';version:1;id:string;name:string;district:string;epoch:2020;canonical:boolean;sourceCode:string|null;positionBasis:'campaign-adaptation'|'source-plan'};
type Props={campaignId:number;campaignName:string;isGM:boolean;suspended?:boolean;onExit:()=>void;onSelection?:(selection:CityAtlasSelection)=>void};
/** Same-origin embedded map; actual role and every write are authorized by Crew. */
export function CityAtlas(props:Props){return <CityAtlasFrame key={props.campaignId} {...props}/>;}
function CityAtlasFrame({campaignId,campaignName,isGM,suspended=false,onExit,onSelection}:Props){
 const settings=usePlayerSettings();
 const frame=useRef<HTMLIFrameElement>(null),pendingBack=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0),[leavePrompt,setLeavePrompt]=useState<'exit'|'reload'|null>(null),[notice,setNotice]=useState('');
 const downloadBusy=useRef(false),[downloadError,setDownloadError]=useState('');
 const openingConsumed=useRef(false),[opening,setOpening]=useState(false),[reduced,setReduced]=useState(true),[digital,setDigital]=useState(false);
 const cancelOpening=()=>setOpening(false);
 useEffect(()=>{
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const motion=()=>setReduced(!media||media.matches);
  const appearance=()=>{
   const live=document.documentElement.dataset.digital;
   if(live){setDigital(live!=='off');return;}
   try{setDigital(readInterfaceStyle(localStorage).digital);}catch{setDigital(false);}
  };
  motion();appearance();media?.addEventListener('change',motion);
  window.addEventListener('storage',appearance);window.addEventListener('nightcity-interface-change',appearance);
  return()=>{media?.removeEventListener('change',motion);window.removeEventListener('storage',appearance);window.removeEventListener('nightcity-interface-change',appearance);};
 },[]);
 useLayoutEffect(()=>{
  // Readiness opens the real map immediately. This decoration is consumed once,
  // including when ready arrives while hidden or effects are disabled.
  const allowed=status==='ready'&&!suspended&&!document.hidden&&!reduced&&settings.animations&&digital;
  // Clear the decorative sibling before painting a hidden/disabled-motion map.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  if(!allowed)setOpening(false);
  if(status!=='ready'||openingConsumed.current)return;
  openingConsumed.current=true;if(allowed)setOpening(true);
 },[status,suspended,reduced,settings.animations,digital]);
 useEffect(()=>{
  if(!opening)return;
  const cancel=()=>setOpening(false),visibility=()=>{if(document.hidden)cancel();};
  const visual=(frame.current?.contentWindow as (Window&{NC_ATLAS_REFINEMENT?:{entry:()=>void;cancelEntry:()=>void}})|null)?.NC_ATLAS_REFINEMENT;
  visual?.entry();
  const timer=setTimeout(cancel,2500);
  // Pointer/key events inside an iframe do not bubble into the React host.
  // Listen only to this verified same-origin document; never block its events.
  const child=frame.current?.contentDocument;
  const interactions=['pointerdown','keydown','focusin','wheel','scroll'],passiveCapture={capture:true,passive:true};
  for(const type of interactions){window.addEventListener(type,cancel,passiveCapture);child?.addEventListener(type,cancel,passiveCapture);}
  window.addEventListener('resize',cancel);window.addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',visibility);
  window.visualViewport?.addEventListener('resize',cancel);window.visualViewport?.addEventListener('scroll',cancel);
  return()=>{visual?.cancelEntry();clearTimeout(timer);for(const type of interactions){window.removeEventListener(type,cancel,passiveCapture);child?.removeEventListener(type,cancel,passiveCapture);}window.removeEventListener('resize',cancel);window.removeEventListener('pagehide',cancel);document.removeEventListener('visibilitychange',visibility);window.visualViewport?.removeEventListener('resize',cancel);window.visualViewport?.removeEventListener('scroll',cancel);};
 },[opening]);
 const state=useRef({dirty:false,busy:false}),callbacks=useRef({onExit,onSelection});useLayoutEffect(()=>{callbacks.current={onExit,onSelection};},[onExit,onSelection]);
 const src=`/atlas/index.html?crew=1&campaignId=${encodeURIComponent(campaignId)}&mode=${isGM?'gm':'player'}`;
 const cancelBack=()=>{if(pendingBack.current!==null){clearTimeout(pendingBack.current);pendingBack.current=null;}};
 function requestBack(){
  cancelOpening();
  if(downloadError){setDownloadError('');return;}
  if(leavePrompt){setLeavePrompt(null);return;}
  if(status!=='ready'){if(state.current.busy||state.current.dirty)setLeavePrompt('exit');else callbacks.current.onExit();return;}
  cancelBack();frame.current?.contentWindow?.postMessage({type:'nc-crew:back',version:1},window.location.origin);
  pendingBack.current=setTimeout(()=>{pendingBack.current=null;setNotice('Карта не ответила. Можно остаться на ней или вернуться, закрыв несохранённый ввод.');setLeavePrompt('exit');},1800);
 }
 async function downloadExport(value:{url?:unknown;filename?:unknown}){
  if(downloadBusy.current||typeof value.url!=='string'||typeof value.filename!=='string'||!/^NightCity_Atlas_2020(?:_Player)?\.json$/.test(value.filename))return;
  let source:URL;try{source=new URL(value.url);}catch{return;}if(source.protocol!=='blob:'||source.origin!==window.location.origin)return;
  downloadBusy.current=true;setDownloadError('');const owner=frame.current?.contentWindow;
  try{
   const response=await fetch(source.href);if(!response.ok)throw new Error();const blob=await response.blob();
   if(!blob.size||blob.size>4*1024*1024||!blob.type.startsWith('application/json'))throw new Error();
   JSON.parse(await blob.text());
   // Consume the child Blob before acknowledging it; native save reads a fresh parent Blob asynchronously.
   const own=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=own;anchor.download=value.filename;
   owner?.postMessage({type:'nc-crew:download-complete',version:1,url:source.href},window.location.origin);
   setTimeout(()=>URL.revokeObjectURL(own),60000);anchor.click();
  }catch{setDownloadError('Не удалось подготовить экспорт карты. Попробуй скачать файл ещё раз.');}
  finally{downloadBusy.current=false;}
 }
 useBackEvent('nightcity-atlas-back',()=>{requestBack();return true;});
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return;
   const value=event.data;if(!value||typeof value!=='object'||value.version!==1)return;
   if(value.type==='nc-atlas:exit'){cancelBack();callbacks.current.onExit();}
   else if(value.type==='nc-atlas:ready'){setStatus('ready');setNotice('');}
   else if(value.type==='nc-atlas:state'&&typeof value.dirty==='boolean'&&typeof value.busy==='boolean'){state.current={dirty:value.dirty,busy:value.busy};cancelBack();}
   else if(value.type==='nc-atlas:back-handled'){cancelBack();}
   else if(value.type==='nc-atlas:download'){void downloadExport(value);}
   else if(value.type==='nc-atlas:selection'&&typeof value.id==='string'&&typeof value.name==='string'&&typeof value.district==='string'&&value.epoch===2020&&typeof value.canonical==='boolean'&&(value.sourceCode===null||typeof value.sourceCode==='string')&&['campaign-adaptation','source-plan'].includes(value.positionBasis)){callbacks.current.onSelection?.(value);}
  };
  window.addEventListener('message',receive);return()=>{cancelBack();window.removeEventListener('message',receive);};
 },[]);
 function reload(confirmed=false){if(!confirmed&&(state.current.dirty||state.current.busy)){setNotice('Перезагрузка закроет несохранённый ввод. Уже отправленная команда может быть сохранена сервером; после загрузки карта покажет её результат.');setLeavePrompt('reload');return;}cancelBack();state.current={dirty:false,busy:false};setStatus('loading');setLeavePrompt(null);setDownloadError('');setAttempt(v=>v+1);}
 useEffect(()=>{if(status!=='loading')return;const timer=setTimeout(()=>setStatus('error'),20000);return()=>clearTimeout(timer);},[status,attempt]);
 useEffect(()=>{if(suspended||status!=='ready')return;const frameId=requestAnimationFrame(()=>frame.current?.contentWindow?.postMessage({type:'nc-crew:resume',version:1},window.location.origin));return()=>cancelAnimationFrame(frameId);},[suspended,status]);
 // The iframe is a separate document; explicitly announce current device preferences.
 useEffect(()=>{const theme=()=>{const live=document.documentElement.dataset;let settings=null;if(live.palette&&live.treatment)settings=JSON.stringify({palette:live.palette,treatment:live.treatment,digital:live.digital!=='off'});else try{settings=localStorage.getItem('nc20.interface.v1');}catch{}frame.current?.contentWindow?.postMessage({type:'nc-crew:theme',version:1,settings},window.location.origin);};window.addEventListener('storage',theme);window.addEventListener('nightcity-interface-change',theme);if(status==='ready')theme();return()=>{window.removeEventListener('storage',theme);window.removeEventListener('nightcity-interface-change',theme);};},[status]);
 return <section className="nc-city-atlas" hidden={suspended} aria-label={'Карта кампании '+campaignName} onPointerDownCapture={cancelOpening} onKeyDownCapture={cancelOpening} onFocusCapture={cancelOpening}>
  <iframe key={src+':'+attempt} ref={frame} title={'Найт-Сити · '+campaignName} src={src} onError={()=>setStatus('error')} referrerPolicy="same-origin"/>

  {downloadError&&<div className="nc-atlas-download-error" role="alert"><p>{downloadError}</p><button onClick={()=>setDownloadError('')}>Закрыть</button></div>}
  {status!=='ready'&&<div className="nc-atlas-loading" role={status==='error'?'alert':'status'}><h2>{status==='error'?'Карта не загрузилась':'Открываем Найт-Сити…'}</h2><p>{status==='error'?'Проверь связь с сервером ведущего. Сохранённые метки остаются на сервере.':campaignName}</p>{status==='error'&&<button onClick={()=>reload()}>Повторить загрузку</button>}<button onClick={requestBack}>К кампании</button></div>}
  {leavePrompt&&<div className="nc-atlas-leave" role="dialog" aria-modal="true" aria-label={leavePrompt==='reload'?'Перезагрузить карту?':'Вернуться из карты?'}><div><h2>{leavePrompt==='reload'?'Перезагрузить карту?':'Вернуться из карты?'}</h2><p>{notice||'Несохранённый ввод карты закроется. Уже отправленное изменение может быть сохранено сервером; при следующем входе карта обновится.'}</p><button className="primary" onClick={()=>{setLeavePrompt(null);setNotice('');}}>Остаться</button><button onClick={()=>{if(leavePrompt==='reload')reload(true);else{cancelBack();callbacks.current.onExit();}}}>{leavePrompt==='reload'?'Перезагрузить карту':'Закрыть карту'}</button></div></div>}
 </section>;
}
