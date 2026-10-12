'use client';
import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {BookOpen,Check,ChevronLeft,ChevronRight,Maximize2,Minimize2,RotateCcw,X} from 'lucide-react';
import {TUTORIALS,getTutorial,markCompleted,readCompleted,resolveTutorialLayout,tutorialStorageKey,type Tutorial,type TutorialId,type TourLayout,type TourRect,type TourViewport} from './tutorial-model';

export {TUTORIALS} from './tutorial-model';
export type GuidedTutorialProps={accountId:number;enabled:boolean;busy:boolean;autoOffer?:boolean;onNavigate:(destination:string)=>boolean|Promise<boolean>};
type Session={id:TutorialId;index:number;manual:boolean};
type NavigationStatus='loading'|'busy'|'blocked'|'ready'|'missing';
const EVENT='nightcity-start-tutorial';

/** Requests a guide. This event never starts a real game action or sends a request. */
export function startTutorial(id:string){
  if(typeof window==='undefined'||!getTutorial(id))return;
  window.dispatchEvent(new CustomEvent(EVENT,{detail:{id}}));
}

export function TutorialLauncher({compact=false,ids}:{compact?:boolean;ids?:TutorialId[]}){
  const guides=ids?ids.map(getTutorial).filter((item):item is Tutorial=>!!item):TUTORIALS;
  return <div className={'tutorial-launcher'+(compact?' compact':'')} aria-label="Пошаговые маршруты обучения">
    {guides.map(guide=><button type="button" key={guide.id} onClick={()=>startTutorial(guide.id)} className="tutorial-launch-button">
      <BookOpen aria-hidden="true"/><span><strong>{guide.title}</strong>{!compact&&<small>{guide.description}</small>}</span><ChevronRight aria-hidden="true"/>
    </button>)}
  </div>;
}

function visible(element:HTMLElement):boolean{
  if(!element.isConnected||element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
  const style=window.getComputedStyle(element),rect=element.getBoundingClientRect();
  return style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse'&&rect.width>0&&rect.height>0&&element.getClientRects().length>0;
}
function anchorElement(anchor:string):HTMLElement|null{
  // Anchors are fixed identifiers from tutorial-model, never a user-provided selector.
  if(!/^[a-z0-9-]+$/.test(anchor))return null;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tour="'+anchor+'"]')).find(visible)||null;
}
function unrelatedDialogOpen():boolean{
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')).some(element=>!element.closest('[data-nightcity-tutorial]')&&visible(element));
}
function viewport():TourViewport{
  const v=window.visualViewport;
  return {left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||window.innerWidth,height:v?.height||window.innerHeight};
}
function toRect(r:DOMRect):TourRect{return {left:r.left,top:r.top,width:r.width,height:r.height};}
function readLocalCompleted(accountId:number):TutorialId[]{try{return readCompleted(localStorage.getItem(tutorialStorageKey(accountId)));}catch{return [];}}
function saveLocalCompleted(accountId:number,completed:TutorialId[]){try{localStorage.setItem(tutorialStorageKey(accountId),JSON.stringify({version:1,completed}));}catch{/* Guides still work in private browsing or when storage is unavailable. */}}
function equalLayout(a:TourLayout|null,b:TourLayout|null):boolean{return JSON.stringify(a)===JSON.stringify(b);}

export default function GuidedTutorial({accountId,enabled,busy,autoOffer=true,onNavigate}:GuidedTutorialProps){
  const [session,setSession]=useState<Session|null>(null),[offer,setOffer]=useState(false),[minimized,setMinimized]=useState(false);
  const [status,setStatus]=useState<NavigationStatus>('loading'),[attempt,setAttempt]=useState(0),[layout,setLayout]=useState<TourLayout|null>(null),[modalPaused,setModalPaused]=useState(false);
  const [completed,setCompleted]=useState<TutorialId[]>([]);
  const labelId=useId(),descriptionId=useId();
  const current=useRef({accountId,enabled,busy,onNavigate,session,status});current.current={accountId,enabled,busy,onNavigate,session,status};
  const completedRef=useRef<TutorialId[]>([]),dismissedOffer=useRef(false),request=useRef(0),previousFocus=useRef<HTMLElement|null>(null),cardRef=useRef<HTMLElement|null>(null),headingRef=useRef<HTMLHeadingElement|null>(null),restoreRef=useRef<HTMLButtonElement|null>(null);
  const tour=session?getTutorial(session.id):undefined,step=tour&&session?tour.steps[session.index]:undefined;

  const restoreFocus=useCallback(()=>{
    const prior=previousFocus.current;previousFocus.current=null;
    if(!prior)return;
    let destination:HTMLElement|null=prior!==document.body&&visible(prior)?prior:null;
    if(!destination){
      const active=current.current.session,anchor=active?getTutorial(active.id)?.steps[active.index].anchor:undefined;
      const target=anchor?anchorElement(anchor):null,selector='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
      destination=target?.matches(selector)?target:target?.querySelector<HTMLElement>(selector)||null;
    }
    if(destination&&visible(destination)){try{destination.focus({preventScroll:true});}catch{destination.focus();}}
  },[]);
  const close=useCallback(()=>{
    request.current++;setSession(null);setOffer(false);setMinimized(false);setLayout(null);dismissedOffer.current=true;restoreFocus();
  },[restoreFocus]);
  const begin=useCallback((id:TutorialId,manual:boolean)=>{
    if(!getTutorial(id)||current.current.accountId<=0)return;
    if(!current.current.session&&document.activeElement instanceof HTMLElement)previousFocus.current=document.activeElement;
    request.current++;dismissedOffer.current=true;setOffer(false);setMinimized(false);setLayout(null);setStatus('loading');setSession({id,index:0,manual});setAttempt(v=>v+1);
  },[]);
  const finish=useCallback(()=>{
    const active=current.current.session;if(!active)return;
    const next=markCompleted(completedRef.current,active.id);completedRef.current=next;setCompleted(next);saveLocalCompleted(current.current.accountId,next);close();
  },[close]);
  const next=useCallback(()=>{
    const active=current.current.session;if(!active||current.current.busy)return;
    const activeTour=getTutorial(active.id);if(!activeTour)return;
    if(active.index===activeTour.steps.length-1){finish();return;}
    setLayout(null);setStatus('loading');setSession({...active,index:active.index+1});
  },[finish]);
  const previous=useCallback(()=>{
    const active=current.current.session;if(!active||current.current.busy||active.index===0)return;
    setLayout(null);setStatus('loading');setSession({...active,index:active.index-1});
  },[]);

  // A new login must not inherit another account's open guide or local progress.
  useEffect(()=>{
    request.current++;previousFocus.current=null;setSession(null);setLayout(null);setOffer(false);setMinimized(false);dismissedOffer.current=false;
    const saved=readLocalCompleted(accountId);completedRef.current=saved;setCompleted(saved);
  },[accountId]);

  // Turning automatic teaching off closes the guide. A later explicit Help request remains available.
  useEffect(()=>{if(!enabled){request.current++;setSession(null);setOffer(false);setMinimized(false);setLayout(null);restoreFocus();}},[enabled,restoreFocus]);

  useEffect(()=>{
    if(!autoOffer||accountId<=0||!enabled||busy||session||dismissedOffer.current||completed.includes('first-start'))return;
    const timer=window.setTimeout(()=>{if(current.current.enabled&&!current.current.busy&&!current.current.session&&!dismissedOffer.current)setOffer(true);},700);
    return()=>window.clearTimeout(timer);
  },[accountId,enabled,busy,session,completed,autoOffer]);

  useEffect(()=>{
    const listener=(event:Event)=>{const id=(event as CustomEvent<{id?:unknown}>).detail?.id;if(typeof id==='string'&&getTutorial(id))begin(id as TutorialId,true);};
    window.addEventListener(EVENT,listener);
    const onKey=(event:KeyboardEvent)=>{
      if(!current.current.session||unrelatedDialogOpen())return;
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key==='ArrowRight'){event.preventDefault();next();}
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key==='ArrowLeft'){event.preventDefault();previous();}
    };
    window.addEventListener('keydown',onKey);
    return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('keydown',onKey);};
  },[begin,close,next,previous]);

  useEffect(()=>{
    if(!session||!step)return;
    const token=++request.current,account=accountId;
    if(busy){setStatus('busy');setLayout(null);return;}
    setStatus('loading');setLayout(null);
    let cancelled=false;
    void Promise.resolve().then(()=>current.current.onNavigate(step.destination)).then(allowed=>{
      if(cancelled||request.current!==token||current.current.accountId!==account)return;
      setStatus(allowed?'missing':'blocked');
    }).catch(()=>{if(!cancelled&&request.current===token&&current.current.accountId===account)setStatus('blocked');});
    return()=>{cancelled=true;};
    // onNavigate is held in a ref; parent renders must not repeatedly navigate or close a user's modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[accountId,session?.id,session?.index,attempt]);

  useEffect(()=>{if(!busy&&session&&status==='busy')setAttempt(v=>v+1);},[busy,session,status]);

  // Track the live button, not a stale rectangle. No target styles or DOM content are mutated.
  useEffect(()=>{
    if(!session&&!offer){setModalPaused(false);return;}
    let frame=0,stopped=false,scrolled:HTMLElement|null=null;
    const update=()=>{
      frame=0;if(stopped)return;
      const dialog=unrelatedDialogOpen();setModalPaused(prior=>prior===dialog?prior:dialog);
      const active=current.current.session;
      if(!active||minimized||dialog||['loading','blocked','busy'].includes(current.current.status)){setLayout(prior=>prior===null?prior:null);return;}
      const activeStep=getTutorial(active.id)?.steps[active.index];if(!activeStep)return;
      const target=anchorElement(activeStep.anchor);
      if(!target){setStatus(prior=>prior==='missing'?prior:'missing');const positioned=resolveTutorialLayout(null,viewport(),cardRef.current?.getBoundingClientRect().height||320);setLayout(prior=>equalLayout(prior,positioned)?prior:positioned);return;}
      const view=viewport(),rect=target.getBoundingClientRect();
      if(scrolled!==target){scrolled=target;
        if(rect.top<view.top+16||rect.bottom>view.top+view.height-16||rect.left<view.left||rect.right>view.left+view.width){target.scrollIntoView({block:rect.height>view.height/2?'start':'center',inline:'nearest',behavior:'auto'});schedule();return;}
      }
      setStatus(prior=>prior==='ready'?prior:'ready');
      const positioned=resolveTutorialLayout(toRect(target.getBoundingClientRect()),viewport(),cardRef.current?.getBoundingClientRect().height||320);
      setLayout(prior=>equalLayout(prior,positioned)?prior:positioned);
    };
    const schedule=()=>{if(!frame&&!stopped)frame=window.requestAnimationFrame(update);};
    const observer=new MutationObserver(records=>{if(records.some(record=>!(record.target instanceof Element&&record.target.closest('[data-nightcity-tutorial]'))))schedule();});
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','inert','aria-hidden','class','style','data-tour']});
    const resize=new ResizeObserver(schedule);resize.observe(document.documentElement);if(cardRef.current)resize.observe(cardRef.current);
    window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    schedule();
    return()=>{stopped=true;if(frame)window.cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);};
  },[session?.id,session?.index,status,offer,minimized,modalPaused]);

  useEffect(()=>{
    if(!session||minimized||modalPaused)return;
    const timer=window.setTimeout(()=>headingRef.current?.focus({preventScroll:true}),50);return()=>window.clearTimeout(timer);
  },[session?.id,session?.index,minimized,modalPaused]);
  useEffect(()=>()=>{request.current++;restoreFocus();},[restoreFocus]);

  if(typeof document==='undefined'||accountId<=0||modalPaused||(!session&&!offer))return null;
  if(!session)return createPortal(<aside data-nightcity-tutorial="offer" className="tutorial-offer" aria-label="Знакомство с приложением">
    <div><span className="tutorial-kicker">ПЕРВЫЙ ВХОД</span><strong>Показать, с чего начать?</strong><p>Короткий маршрут подсветит нужные кнопки. Настоящие листы и кампании не изменятся.</p></div>
    <div className="tutorial-offer-actions"><button type="button" className="tutorial-primary" onClick={()=>begin('first-start',false)}><BookOpen aria-hidden="true"/>Показать маршрут</button><button type="button" onClick={()=>{dismissedOffer.current=true;setOffer(false);}}>Позже</button></div>
  </aside>,document.body);
  if(!tour||!step)return null;
  if(minimized)return createPortal(<div data-nightcity-tutorial="minimized" className="tutorial-minimized">
    <button type="button" ref={restoreRef} onClick={()=>setMinimized(false)} aria-label={'Развернуть обучение: '+tour.title}><Maximize2 aria-hidden="true"/><span>{tour.title} · {session.index+1}/{tour.steps.length}</span></button><button type="button" onClick={close} aria-label="Закрыть обучение"><X aria-hidden="true"/></button>
  </div>,document.body);
  const ready=status==='ready'&&!busy,spotlight=ready?layout?.spotlight:null;
  const cardStyle=layout?{left:layout.card.left,top:layout.card.top,width:layout.card.width,maxHeight:Math.max(0,viewport().height-24)}:undefined;
  const stateText=busy||status==='busy'?'Пауза: дождись завершения текущего действия.':status==='loading'?'Открываем нужный раздел…':status==='blocked'?'Переход остановлен. Сохрани или закрой текущий черновик и продолжи маршрут.':status==='missing'?step.missing:null;
  return createPortal(<div data-nightcity-tutorial="active" className="guided-tutorial">
    {spotlight&&layout?.panels.map((panel,index)=><div key={index} className="tutorial-dim" aria-hidden="true" style={panel}/>)}
    {spotlight&&<div className="tutorial-spotlight" aria-hidden="true" style={spotlight}/>}
    <section ref={cardRef} className={'tutorial-card'+(layout?' positioned':'')} role="region" aria-labelledby={labelId} aria-describedby={descriptionId} style={cardStyle}>
      <header className="tutorial-card-header"><span className="tutorial-kicker">ОБУЧЕНИЕ / {tour.title}</span><div><button type="button" onClick={()=>{setMinimized(true);window.setTimeout(()=>restoreRef.current?.focus({preventScroll:true}),0);}} aria-label="Свернуть обучение, чтобы пользоваться экраном"><Minimize2 aria-hidden="true"/></button><button type="button" onClick={close} aria-label="Закрыть обучение"><X aria-hidden="true"/></button></div></header>
      <div className="tutorial-progress" aria-label={'Шаг '+(session.index+1)+' из '+tour.steps.length}>{tour.steps.map((_,index)=><span key={index} className={index<=session.index?'passed':''}/>)}</div>
      <h2 id={labelId} ref={headingRef} tabIndex={-1}>{step.title}</h2>
      <p id={descriptionId}>{step.body}</p>
      {stateText&&<div className="tutorial-waiting" role="status"><p>{stateText}</p>{!busy&&status!=='loading'&&<button type="button" onClick={()=>setAttempt(v=>v+1)}><RotateCcw aria-hidden="true"/>{status==='blocked'?'Продолжить маршрут':'Открыть нужный раздел'}</button>}</div>}
      {spotlight&&<p className="tutorial-action-hint">Подсвеченная кнопка работает. {layout?.overlapsTarget?'Карточка перекрывает часть экрана — сверни её, чтобы нажать.':'Можно свернуть подсказку, попробовать действие и вернуться.'}</p>}
      <footer className="tutorial-card-footer"><button type="button" onClick={previous} disabled={session.index===0||busy} aria-label="Предыдущий шаг"><ChevronLeft aria-hidden="true"/>Назад</button><span>{session.index+1} / {tour.steps.length}</span><button type="button" className="tutorial-primary" onClick={next} disabled={busy}>{session.index===tour.steps.length-1?<><Check aria-hidden="true"/>Готово</>:<>Дальше<ChevronRight aria-hidden="true"/></>}</button></footer>
      <small className="tutorial-keyboard">Шаги можно читать без выполнения. Alt + ← / → · Esc — закрыть.</small>
    </section>
  </div>,document.body);
}
