'use client';
import React,{useEffect,useRef,useState} from 'react';
import {Check,RefreshCw,ShieldCheck} from 'lucide-react';
import type {Character} from '@/lib/tracker';
import {exteriorCard} from '@/lib/character-appearance';
import CharacterExterior from './character-exterior';

type Access={campaign_id:number;name:string;gm_id:number;status:string;version:number;mode:'private'|'party'|'selected';player_ids:number[];players:{id:number;username:string}[]};
type API=(path:string,method?:string,data?:unknown)=>Promise<any>;
export default function CharacterAccess({character,api,onBusyChange}:{character:Character;api:API;onBusyChange:(busy:boolean)=>void}){
 const [rows,setRows]=useState<Access[]|null>(null),[error,setError]=useState('');
 const [revision,setRevision]=useState(0),[locked,setLocked]=useState(false);
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onBusyChange(false);};},[]);
 function begin(){if(lock.current)return false;lock.current=true;setLocked(true);onBusyChange(true);return true;}
 function end(){lock.current=false;if(alive.current){setLocked(false);onBusyChange(false);}}
 useEffect(()=>{let alive=true;setRows(null);setError('');api(`/api/characters/${character.id}/access`).then(v=>{if(alive)setRows(v.campaigns);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[character.id,revision]);
 return <div className="character-access"><div className="access-introduction"><ShieldCheck/><div><h3>Кто видит полный лист</h3><p>Ты и ГМ кампании видите весь лист. Другие игроки видят внешность. Можно дополнительно открыть полный лист для чтения и скачивания, включая инвентарь, деньги и личные заметки.</p><p className="hint">Разрешение действует только для этой кампании и её игроков с принятым персонажем. История изменений остаётся у тебя и ГМа.</p></div></div>
  {error&&<div role="alert"><p>{error}</p><button onClick={()=>setRevision(v=>v+1)}><RefreshCw/>Повторить</button></div>}
  {!rows&&!error&&<p role="status">Загружаем настройки…</p>}
  {rows?.length===0&&<p className="hint">Этот герой пока не принят в кампанию. Настройки появятся здесь после вступления. До этого лист доступен тебе; ГМ увидит его при подаче заявки.</p>}
  {rows?.map(row=><CampaignAccess key={`${row.campaign_id}-${row.version}`} row={row} characterId={character.id} api={api} locked={locked} begin={begin} end={end} saved={next=>setRows(prev=>prev?.map(r=>r.campaign_id===next.campaign_id?next:r)??null)}/>)}
  <details className="exterior-preview"><summary>Как выглядит моя карточка для партии</summary>{character.data&&<><CharacterExterior card={exteriorCard(character.id,character.data)}/><p className="hint">Предпросмотр текущего листа. Изменения портрета и вещей увидят после «Сохранить лист». Видимость каждой вещи можно изменить в её настройках.</p></>}</details>
 </div>;
}
function CampaignAccess({row,characterId,api,saved,locked,begin,end}:{row:Access;characterId:number;api:API;saved:(next:Access)=>void;locked:boolean;begin:()=>boolean;end:()=>void}){
 const [mode,setMode]=useState(row.mode),[players,setPlayers]=useState(row.player_ids),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const changed=mode!==row.mode||JSON.stringify([...players].sort())!==JSON.stringify([...row.player_ids].sort());
 const accepted=['active','reserve'].includes(row.status);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy||locked||!changed||!begin())return;setBusy(true);setError('');setNotice('');
  try{const result=await api(`/api/characters/${characterId}/access`,'PUT',{campaign_id:row.campaign_id,version:row.version,mode,player_ids:mode==='selected'?players:[]});if(!alive.current)return;saved({...row,version:result.version,mode,player_ids:mode==='selected'?players:[]});window.dispatchEvent(new Event('nightcity-sync'));}
  catch(e:any){if(alive.current)setError(e.message);}
  finally{if(alive.current)setBusy(false);end();}
 }
 return <form className="campaign-access-row" onSubmit={save}><h3>{row.name}</h3>
  {!accepted?<p className="hint">Заявка рассматривается. Доступ игрокам можно настроить после принятия.</p>:<>
   <fieldset disabled={locked}><legend>Полный лист доступен</legend>
    {([['private','Только мне и ГМу'],['party','Всем игрокам этой кампании'],['selected','Выбранным игрокам']] as const).map(([value,label])=><label className="access-choice" key={value}><input type="radio" name={`access-${row.campaign_id}`} checked={mode===value} onChange={()=>{setMode(value);setError('');}}/>{label}</label>)}
   </fieldset>
   {mode==='selected'&&<fieldset disabled={locked}><legend>Выбери игроков</legend>{row.players.map(p=><label key={p.id} className="access-choice"><input type="checkbox" checked={players.includes(p.id)} onChange={e=>setPlayers(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.username}</label>)}{!row.players.length&&<p className="hint">В кампании пока нет других игроков с принятым героем.</p>}</fieldset>}
   {mode==='selected'&&players.length===0&&<p className="hint">Пока никто не выбран — полный лист остаётся закрыт от других игроков.</p>}
   {error&&<p role="alert" className="error-text">{error} Закрой и снова открой настройки, чтобы загрузить актуальную версию.</p>}{notice&&<p role="status">{notice}</p>}
   <button className="primary" type="submit" disabled={locked||!changed}><Check/>{busy?'Сохраняем…':changed?'Сохранить доступ':'Доступ сохранён'}</button>
  </>}
 </form>;
}
