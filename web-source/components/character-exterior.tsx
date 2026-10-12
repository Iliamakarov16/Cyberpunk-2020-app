'use client';
import React,{useEffect,useId,useRef,useState} from 'react';
import {UserRound} from 'lucide-react';
import {SLOTS} from '@/lib/tracker';
import {DEFAULT_PORTRAIT_FRAME,PORTRAIT_EFFECTS,isSafePortrait,normalizeCharacterAppearance,normalizePortraitFrame,type CharacterAppearance,type ExteriorCard,type PortraitEffect,type PortraitFrame} from '@/lib/character-appearance';
import {getPortraitLayout,getPortraitDragFrame,type PortraitLayoutInput} from '@/lib/portrait-frame';
import {IllustratedIcon} from '@/components/paper-doll';
import {usePlayerSettings} from '@/components/player-help';

export function CharacterPortrait({name,appearance,large=false,onEdit}:{name:string;appearance:CharacterAppearance;large?:boolean;onEdit?:(viewport:{width:number;height:number})=>void}){
 const safe=normalizeCharacterAppearance(appearance),frame=safe.portraitFrame,effect=frame?.effect??'off';
 const settings=usePlayerSettings(),host=useRef<HTMLDivElement|HTMLButtonElement>(null);
 const [size,setSize]=useState({width:0,height:0}),[image,setImage]=useState({src:'',width:0,height:0});
 const [allowed,setAllowed]=useState(false);
 useEffect(()=>{
  if(!frame||!safe.portrait)return;
  const element=host.current;if(!element)return;
  const measure=()=>{const box=element.getBoundingClientRect(),width=element.clientWidth||box.width,height=element.clientHeight||box.height;setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});};
  measure();
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();}
  window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);
 },[safe.portrait,!!frame,frame?.height]);
 useEffect(()=>{
  if(effect==='off'){setAllowed(false);return;}
  const element=host.current;if(!element)return;
  const media=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;let inView=true;
  const update=()=>setAllowed(!!media&&!media.matches&&!document.hidden&&inView&&!element.closest('[hidden], [aria-hidden="true"], [inert]')&&!!element.getClientRects().length);
  update();media?.addEventListener('change',update);document.addEventListener('visibilitychange',update);
  const ancestors=typeof MutationObserver==='undefined'?null:new MutationObserver(update);
  if(ancestors)for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement)ancestors.observe(parent,{attributes:true,attributeFilter:['hidden','aria-hidden','inert']});
  const viewport=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting??false;update();});viewport?.observe(element);
  return()=>{media?.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);ancestors?.disconnect();viewport?.disconnect();};
 },[effect]);
 const moving=effect!=='off'&&settings.animations&&allowed;
 useEffect(()=>{if(!moving&&host.current?.style){host.current.style.setProperty('--portrait-tilt-x','0deg');host.current.style.setProperty('--portrait-tilt-y','0deg');}},[moving]);
 const layout=frame&&image.src===safe.portrait?getPortraitLayout({...frame,imageWidth:image.width,imageHeight:image.height,...size}):null;
 const imageStyle=layout&&layout.width>0?{width:layout.width,height:layout.height,left:layout.left,top:layout.top,right:'auto',bottom:'auto',objectFit:'fill' as const}:frame?{objectFit:frame.fit,objectPosition:`${frame.x}% ${frame.y}%`,transform:`scale(${frame.zoom/100})`,transformOrigin:`${frame.x}% ${frame.y}%`}:undefined;
 const tilt=(event:React.PointerEvent<HTMLElement>)=>{
  if(effect!=='tilt'||!moving)return;const box=event.currentTarget.getBoundingClientRect();if(!box.width||!box.height)return;
  event.currentTarget.style.setProperty('--portrait-tilt-x',`${Math.max(-3,Math.min(3,((event.clientY-box.top)/box.height-.5)*-6))}deg`);
  event.currentTarget.style.setProperty('--portrait-tilt-y',`${Math.max(-3,Math.min(3,((event.clientX-box.left)/box.width-.5)*6))}deg`);
 };
 const resetTilt=(event:React.PointerEvent<HTMLElement>)=>{event.currentTarget.style.setProperty('--portrait-tilt-x','0deg');event.currentTarget.style.setProperty('--portrait-tilt-y','0deg');};
 const body=<>{safe.portrait?<div className="nc-portrait-image-plane"><img className="character-portrait" src={safe.portrait} alt={`Портрет · ${name}`} style={imageStyle} onLoad={event=>{const node=event.currentTarget;setImage({src:safe.portrait!,width:node.naturalWidth,height:node.naturalHeight});}} draggable={false}/></div>:<><UserRound aria-hidden="true"/><span aria-hidden="true">{name.slice(0,2).toUpperCase()}</span></>}
  <i className="nc-portrait-finish" aria-hidden="true"/>{onEdit&&<i className="nc-portrait-edit-mark" aria-hidden="true">{safe.portrait?'НАСТРОИТЬ ПОРТРЕТ':'ДОБАВИТЬ ПОРТРЕТ'} <span>↗</span></i>}</>;
 const props={className:`avatar ${large?'large':''} accent-${safe.accent} nc-portrait-card`,'data-effect':effect,'data-portrait-motion':moving?'on':'off','data-framed':frame?'true':'false',style:frame?{'--portrait-height':`${frame.height}px`} as React.CSSProperties:undefined,onPointerMove:tilt,onPointerLeave:resetTilt};
 return onEdit?<button {...props} ref={host as React.RefObject<HTMLButtonElement>} type="button" onClick={()=>{const element=host.current,box=element?.getBoundingClientRect();onEdit({width:element?.clientWidth||box?.width||0,height:element?.clientHeight||box?.height||0});}} aria-label={safe.portrait?`Настроить портрет · ${name}`:`Добавить портрет · ${name}`}>{body}</button>:<div {...props} ref={host as React.RefObject<HTMLDivElement>}>{body}</div>;
}

/** Keep the complete downsized image; framing never rewrites this raster. */
export async function preparePortraitFile(file:File):Promise<string>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Выбери PNG, JPEG или WebP до 10 МБ.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('Размер изображения слишком большой. Выбери уменьшенную копию.');
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw new Error('Не удалось подготовить изображение.');
  let scale=Math.min(1,960/Math.max(image.naturalWidth,image.naturalHeight));
  for(let attempt=0;attempt<6;attempt++){
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   context.fillStyle='#080406';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.72,.62]){const portrait=canvas.toDataURL('image/jpeg',quality);if(isSafePortrait(portrait))return portrait;}
   scale*=.75;
  }
  throw new Error('Не удалось уместить изображение. Попробуй другую копию.');
 }finally{URL.revokeObjectURL(url);}
}

function usePortraitUpload(onChange:(portrait:string)=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),generation=useRef(0),change=useRef(onChange);change.current=onChange;
 useEffect(()=>()=>{generation.current++;},[]);
 const cancel=()=>{generation.current++;setBusy(false);};
 const choose=async(file?:File)=>{
  if(!file)return;const request=++generation.current;setBusy(true);setError('');
  try{const portrait=await preparePortraitFile(file);if(request===generation.current)change.current(portrait);}
  catch(reason){if(request===generation.current)setError(reason instanceof Error?reason.message:'Не удалось открыть изображение. Попробуй другой файл.');}
  finally{if(request===generation.current)setBusy(false);}
 };
 return {busy,error,choose,cancel};
}

export function PortraitPicker({value,onChange,frame,onFrameChange}:{value?:string;onChange:(portrait?:string)=>void;frame?:PortraitFrame;onFrameChange?:(frame:PortraitFrame)=>void}){
 const upload=usePortraitUpload(portrait=>{onChange(portrait);if(onFrameChange)onFrameChange(normalizePortraitFrame(frame)??{...DEFAULT_PORTRAIT_FRAME});});
 return <div className="portrait-picker">{isSafePortrait(value)&&<img src={value} alt="Выбранный портрет"/>}<label className="portrait-upload">{upload.busy?'Подготавливаем…':'Выбрать портрет'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={upload.busy} onChange={event=>{void upload.choose(event.target.files?.[0]);event.target.value='';}}/></label>{value&&<button type="button" disabled={upload.busy} onClick={()=>onChange(undefined)}>Убрать портрет</button>}<p className="hint">Изображение сохраняется целиком. Участники твоей партии увидят выбранный портрет.</p>{upload.error&&<p role="alert">{upload.error}</p>}</div>;
}

const effectLabels:Record<PortraitEffect,string>={off:'Без эффекта',foil:'Фольга',scan:'Сканирование',pulse:'Пульс',tilt:'Наклон'};
const effectNotes:Record<PortraitEffect,string>={off:'Спокойная печатная карточка.',foil:'Мягкий свет движется по поверхности.',scan:'Тонкая световая полоска проходит по карточке.',pulse:'Акцент слегка меняет яркость.',tilt:'Карточка реагирует на движение указателя.'};
const accentLabels:Record<CharacterAppearance['accent'],string>={rust:'Красный',teal:'Бирюзовый',blue:'Синий',violet:'Фиолетовый'};

/** Local preview only. Root applies the resulting appearance to its current sheet draft. */
export function PortraitEditor({name,appearance,viewportWidth,onChange,onCancel,onDirtyChange}:{name:string;appearance:CharacterAppearance;viewportWidth?:number;onChange:(appearance:CharacterAppearance)=>void;onCancel:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
 const id=useId(),[draft,setDraft]=useState(()=>normalizeCharacterAppearance(appearance));
 const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
 useEffect(()=>{dirtyCallback.current?.(JSON.stringify(draft)!==JSON.stringify(normalizeCharacterAppearance(appearance)));},[draft,appearance]);
 const frame=normalizePortraitFrame(draft.portraitFrame)??{...DEFAULT_PORTRAIT_FRAME};
 const preview=useRef<HTMLDivElement>(null),drag=useRef<{pointer:number;clientX:number;clientY:number;input:PortraitLayoutInput;zoomFloor:number;target:HTMLDivElement}|null>(null);
 const [dragging,setDragging]=useState(false),[dimensions,setDimensions]=useState({src:'',width:0,height:0});
 const updateFrame=(patch:Partial<PortraitFrame>)=>setDraft(previous=>({...previous,portraitFrame:{...(normalizePortraitFrame(previous.portraitFrame)??DEFAULT_PORTRAIT_FRAME),...patch}}));
 const stopDrag=()=>{const active=drag.current;drag.current=null;setDragging(false);if(active?.target.hasPointerCapture(active.pointer))active.target.releasePointerCapture(active.pointer);};
 const controlFrame=(patch:Partial<PortraitFrame>)=>{stopDrag();updateFrame(patch);};
 const upload=usePortraitUpload(portrait=>{setDimensions({src:'',width:0,height:0});setDraft(previous=>({...previous,portrait,portraitFrame:normalizePortraitFrame(previous.portraitFrame)??{...DEFAULT_PORTRAIT_FRAME}}));});
 useEffect(()=>{
  if(!draft.portrait)return;const source=draft.portrait,image=new Image();let active=true;
  image.src=source;void image.decode().then(()=>{if(active)setDimensions({src:source,width:image.naturalWidth,height:image.naturalHeight});},()=>{});return()=>{active=false;};
 },[draft.portrait]);
 useEffect(()=>{stopDrag();return()=>{const active=drag.current;drag.current=null;if(active?.target.hasPointerCapture(active.pointer))active.target.releasePointerCapture(active.pointer);};},[draft.portrait,viewportWidth]);
 useEffect(()=>{
  const element=preview.current;if(!element)return;
  const resized=()=>{const active=drag.current;if(!active)return;const box=element.getBoundingClientRect(),width=element.clientWidth||box.width,height=element.clientHeight||box.height;if(Math.abs(width-active.input.width)>.5||Math.abs(height-active.input.height)>.5)stopDrag();};
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resized);observer?.observe(element);window.addEventListener('resize',stopDrag);
  return()=>{observer?.disconnect();window.removeEventListener('resize',stopDrag);};
 },[]);
 const beginDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
  if(drag.current||event.isPrimary===false||!draft.portrait||dimensions.src!==draft.portrait||event.button!==0)return;
  const box=event.currentTarget.getBoundingClientRect(),input={...frame,imageWidth:dimensions.width,imageHeight:dimensions.height,width:event.currentTarget.clientWidth||box.width,height:event.currentTarget.clientHeight||box.height},layout=getPortraitLayout(input);
  if(!layout.width)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  drag.current={pointer:event.pointerId,clientX:event.clientX,clientY:event.clientY,input,zoomFloor:frame.zoom,target:event.currentTarget};setDragging(true);
 };
 const moveDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
  const active=drag.current;if(!active||active.pointer!==event.pointerId)return;event.preventDefault();
  const next=getPortraitDragFrame(active.input,event.clientX-active.clientX,event.clientY-active.clientY,active.zoomFloor);active.zoomFloor=next.zoom;updateFrame(next);
 };
 const endDrag=(event:React.PointerEvent<HTMLDivElement>)=>{if(drag.current?.pointer===event.pointerId)stopDrag();};
 const cancel=()=>{stopDrag();upload.cancel();onCancel();};
 const apply=()=>{if(!upload.busy){stopDrag();onChange(normalizeCharacterAppearance({...draft,portraitFrame:frame}));}};
 const slider=(key:'zoom'|'x'|'y'|'height',label:string,min:number,max:number,suffix:string)=> <label className="nc-portrait-slider" htmlFor={`${id}-${key}`}><span>{label}<output htmlFor={`${id}-${key}`}>{frame[key]}{suffix}</output></span><input id={`${id}-${key}`} type="range" min={min} max={max} step={1} value={frame[key]} onChange={event=>controlFrame({[key]:Number(event.target.value)})}/></label>;
 const targetWidth=typeof viewportWidth==='number'&&Number.isFinite(viewportWidth)&&viewportWidth>0?viewportWidth:300,ratio=targetWidth/frame.height;
 const previewStyle={aspectRatio:`${targetWidth} / ${frame.height}`,'--portrait-preview-width':`${240*ratio}px`,'--portrait-preview-desktop-width':`${360*ratio}px`} as React.CSSProperties;
 return <div className="nc-portrait-editor">
  <div className="nc-portrait-preview-column"><div ref={preview} className="nc-portrait-preview" data-dragging={dragging?'true':'false'} data-can-drag={draft.portrait?'true':'false'} style={previewStyle} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}><CharacterPortrait name={name} appearance={{...draft,portraitFrame:frame}} large/></div><div className="nc-portrait-preview-actions"><button type="button" onClick={()=>controlFrame({x:50,y:50})}>Центрировать</button><button type="button" onClick={()=>controlFrame({fit:'contain',x:50,y:50,zoom:100})}>Показать целиком</button></div><p className="hint">{draft.portrait?'Рамка совпадает с листом. Перетаскивай изображение; если оно точно вписано, масштаб слегка увеличится для перемещения.':'Добавь своё изображение. Затем выбери кадрирование и оформление карточки.'}</p><label className="portrait-upload nc-portrait-upload">{upload.busy?'Подготавливаем изображение…':draft.portrait?'Заменить изображение':'Добавить изображение'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={upload.busy} onChange={event=>{void upload.choose(event.target.files?.[0]);event.target.value='';}}/></label>{draft.portrait&&<button type="button" className="text-button" disabled={upload.busy} onClick={()=>{stopDrag();setDraft(previous=>{const next={...previous};delete next.portrait;return next;});}}>Убрать изображение</button>}{upload.error&&<p className="nc-portrait-error" role="alert">{upload.error}</p>}</div>
  <div className="nc-portrait-controls"><fieldset><legend>Кадрирование</legend><div className="nc-portrait-fit-options">{([['contain','Целиком'],['cover','Заполнить рамку']] as const).map(([fit,label])=><label key={fit} data-selected={frame.fit===fit}><input type="radio" name={`${id}-fit`} value={fit} checked={frame.fit===fit} onChange={()=>controlFrame({fit})}/><span>{label}</span></label>)}</div>{slider('zoom','Масштаб изображения',100,300,'%')}{slider('x','По горизонтали',0,100,'%')}{slider('y','По вертикали',0,100,'%')}</fieldset>
   <fieldset><legend>Размер карточки</legend>{slider('height','Высота',220,520,' px')}</fieldset>
   <fieldset><legend>Цвет карточки</legend><div className="nc-portrait-accent-options">{(Object.keys(accentLabels) as CharacterAppearance['accent'][]).map(accent=><label className={`accent-${accent}`} key={accent} data-selected={draft.accent===accent}><input type="radio" name={`${id}-accent`} value={accent} checked={draft.accent===accent} onChange={()=>setDraft(previous=>({...previous,accent}))}/><i aria-hidden="true"/><span>{accentLabels[accent]}</span></label>)}</div></fieldset>
   <fieldset><legend>Движение и блеск</legend><div className="nc-portrait-effect-options">{PORTRAIT_EFFECTS.map(effect=><label key={effect} data-selected={frame.effect===effect}><input type="radio" name={`${id}-effect`} value={effect} checked={frame.effect===effect} onChange={()=>updateFrame({effect})}/><span>{effectLabels[effect]}</span><small>{effectNotes[effect]}</small></label>)}</div><p className="hint">Эффекты соблюдают настройку анимаций и сокращения движения на устройстве. На скрытых карточках они приостанавливаются.</p></fieldset>
   <p className="hint">«Применить» изменит черновик. Сохрани лист, чтобы обновлённый портрет увидела партия.</p><div className="nc-portrait-editor-actions"><button type="button" onClick={cancel}>Отмена</button><button type="button" className="primary" disabled={upload.busy} onClick={apply}>Применить к листу</button></div>
  </div>
 </div>;
}
export default function CharacterExterior({card}:{card:ExteriorCard}){
 return <section className="exterior-card" aria-label={`Внешность · ${card.name}`}>
  <div className="exterior-identity"><CharacterPortrait name={card.name} appearance={card.appearance} large/><div><span className="eyebrow">ВИДНО ДРУГИМ ПЕРСОНАЖАМ</span><h2>{card.name}</h2></div></div>
  <h3>Видимые вещи</h3>
  {card.items.length?<ul className="exterior-items">{card.items.map((i,index)=><li key={index}><IllustratedIcon icon={i.icon} small/><div><strong>{i.name}</strong><span>{SLOTS[i.slot]}</span></div></li>)}</ul>:<p className="muted">Видимые вещи пока не указаны.</p>}
  <p className="hint">Здесь видна внешность героя. Характеристики, содержимое рюкзака и личные записи доступны по разрешению владельца.</p>
 </section>;
}
