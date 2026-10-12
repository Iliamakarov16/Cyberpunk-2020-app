'use client';

import React, {memo, useEffect, useId, useRef, useState} from 'react';
import {createLoadingRhythmGenerator, getLoadingState, nextLoadingPlan, type LoadingVariant} from '@/lib/loading-rhythm';

export type DeckConnectionProps = {
  variant: LoadingVariant;
  animations: boolean;
  operator: string;
  /** Actual authentication/data preparation result, supplied by the parent. */
  ready: boolean;
  error?: string;
  /** Sign-in hands off automatically; settings previews keep their explicit return action. */
  autoContinue?: boolean;
  continueLabel?: string;
  onContinue: () => void;
  onSkip?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
};

const phaseCopy = {
  sync: ['Подключение канала', 'Подготавливаем личный канал и интерфейс.'],
  read: ['Загружаем досье', 'Собираем записи в блоки данных.'],
  verify: ['Подготовка интерфейса', 'Завершаем сборку рабочего пространства.'],
  waiting: ['Получаем данные', 'Ждём ответа сервера. Досье откроется, когда данные будут готовы.'],
  ready: ['Загрузка успешна', 'Личное пространство подготовлено. Можно входить.'],
  error: ['Подключение прервано', 'Не удалось подготовить данные. Повтори подключение или вернись назад.'],
} as const;

const delay = (name: string, value: number) => ({[`--nc-boot-${name}`]: `${value}ms`} as React.CSSProperties);
const SUCCESS_DWELL=360;

const ChannelVisual = memo(function ChannelVisual({id}: {id: string}) {
  return <svg className="nc-boot-map" viewBox="0 0 600 360">
    <defs><pattern id={`${id}-grid`} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" className="nc-boot-grid"/></pattern></defs>
    <rect width="600" height="360" fill={`url(#${id}-grid)`}/>
    <g className="nc-boot-register"><path className="nc-boot-memory-frame" d="M18 58V18H100M500 18H582V58M18 302V342H100M500 342H582V302"/>
      <text className="nc-boot-label" x="18" y="43">CHANNEL / 01</text><text className="nc-boot-label" x="450" y="43">PERSONAL DATA</text>
      <text className="nc-boot-address" x="18" y="80">NC—020</text><text className="nc-boot-label" x="18" y="290">LOCAL NODE</text></g>
    <path className="nc-boot-ghost" d="M22 170H84V118H146M22 182H96V242H146M454 118H504V170H580M454 242H518V182H580"/>
    <path className="nc-boot-route nc-boot-route-in" pathLength="1" d="M22 170H84V118H146M22 182H96V242H146"/>
    <path className="nc-boot-route nc-boot-return nc-boot-route-in" pathLength="1" d="M22 196H70V270H126V228H146"/>
    <path className="nc-boot-route nc-boot-route-out" pathLength="1" d="M454 118H504V170H580M454 242H518V182H580"/>
    <path className="nc-boot-route nc-boot-return nc-boot-route-out" pathLength="1" d="M454 228H482V270H534V196H580"/>
    <rect className="nc-boot-node" x="17" y="160" width="20" height="44"/><rect className="nc-boot-node-core nc-boot-core-in" x="23" y="166" width="8" height="32"/>
    <rect className="nc-boot-node" x="563" y="160" width="20" height="44"/><rect className="nc-boot-node-core nc-boot-core-out" x="569" y="166" width="8" height="32"/>
    <text className="nc-boot-label nc-boot-label-bright" x="152" y="77">DOSSIER / DATA BANK</text>
    <path className="nc-boot-memory-frame" d="M145 107V88H166M432 88H454V107M145 235V255H166M432 255H454V235"/>
    <g>{Array.from({length:45}, (_, i) => {const row=Math.floor(i/9), col=i%9; return <rect key={i} className="nc-boot-memory-cell" x={160+col*31} y={100+row*30} width="26" height="24" style={delay('cell-delay',col*145+row*45)}/>;})}</g>
    <rect className="nc-boot-band" x="150" y="92" width="300" height="7"/>
    <path className="nc-boot-check" pathLength="1" d="M145 88H454V255H145V88"/>
    <path className="nc-boot-packet" pathLength="400" d="M22 170H84V118H146M454 118H504V170H580"/>
    <g className="nc-boot-map-ready"><path className="nc-boot-check" style={{strokeDashoffset:0,opacity:1}} d="M161 282H178M169 274V290"/><text x="190" y="288">ACCESS GRANTED</text></g>
    <g className="nc-boot-register">{Array.from({length:22},(_,i)=><rect key={i} className="nc-boot-tick" x={18+i*12} y="325" width={i%3===0?7:3} height="10"/>)}<text className="nc-boot-label" x="385" y="335">NC / PERSONAL / 2020</text></g>
  </svg>;
});

const StreamVisual = memo(function StreamVisual() {
  return <svg className="nc-boot-map" viewBox="0 0 600 360">
    <text className="nc-boot-label" x="24" y="29">RECORD STREAM / NC—020</text><text className="nc-boot-label" x="461" y="29">PERSONAL</text>
    <path className="nc-boot-stream-rule" pathLength="1" d="M24 43H574M70 80V298M80 80V298"/>
    {['IDENTITY','EQUIPMENT','NEURAL RECORD'].map((label,row)=>{const y=80+row*82;return <g key={label}>
      <text className="nc-boot-label" x="24" y={y-9}>{label}</text><rect className="nc-boot-stream-track" x="24" y={y} width="550" height="54"/><text className="nc-boot-stream-index" x="36" y={y+37}>0{row+1}</text>
      {Array.from({length:8},(_,col)=><rect key={col} className="nc-boot-stream-cell" x={86+col*54} y={y+14} width="46" height="27" style={delay('packet-delay',col*130+row*260)}/>)}
      <path className="nc-boot-stream-check" pathLength="1" style={delay('check-delay',row*150)} d={`M24 ${y}H574V${y+54}H24V${y}`}/><rect className="nc-boot-stream-readhead" x="80" y={y+7} width="3" height="40"/>
    </g>;})}
    <rect className="nc-boot-stream-idle" x="86" y="90" width="9" height="4"/>
    <g className="nc-boot-stream-ready"><text x="24" y="337">RECORDS LINKED</text><text className="nc-boot-label" x="435" y="337">03 / 03 / READY</text></g>
  </svg>;
});

const SignatureVisual = memo(function SignatureVisual({id}: {id: string}) {
  return <svg className="nc-boot-map" viewBox="0 0 600 360">
    <defs>{[98,145,192].map((y,i)=><clipPath id={`${id}-band-${i}`} key={i}><rect x="0" y={y} width="600" height={i===2?51:47}/></clipPath>)}</defs>
    <text className="nc-boot-label" x="24" y="29">PERSONAL SIGNATURE / NC—020</text><text className="nc-boot-label" x="469" y="29">ID / 01</text>
    <path className="nc-boot-signature-register" pathLength="1" d="M24 58H572M24 251H572"/>
    <text className="nc-boot-signature-type nc-boot-signature-ghost" x="24" y="239" textLength="548" lengthAdjust="spacingAndGlyphs">NC—020</text>
    {[0,1,2].map(i=><g key={i} className={`nc-boot-signature-strip ${i===1?'nc-boot-signature-strip-accent':''}`} style={delay('type-delay',i*200)} clipPath={`url(#${id}-band-${i})`}><text className="nc-boot-signature-type" x="24" y="239" textLength="548" lengthAdjust="spacingAndGlyphs">NC—020</text></g>)}
    <path d="M24 145H572M24 192H572" stroke="var(--nc-deep,var(--nc-ink))" strokeWidth="2"/>
    <path className="nc-boot-signature-lock" pathLength="1" d="M24 113V94H50M546 94H572V113M24 232V250H50M546 250H572V232"/>
    <g>{Array.from({length:30},(_,i)=><rect key={i} className="nc-boot-signature-cell" x={24+i*18} y="274" width={i%4===0?4:12} height="19" style={delay('bar-delay',i*45)}/>)}</g><rect className="nc-boot-signature-idle" x="24" y="299" width="34" height="2"/>
    <g className="nc-boot-signature-ready"><text x="24" y="337">CHANNEL OPEN</text><text className="nc-boot-label" x="451" y="337">NC / 2020</text></g>
  </svg>;
});

/** An actual connection screen. Its animation clock has no authority over authentication or data. */
export default function DeckConnection({variant,animations,operator,ready,error,autoContinue=false,continueLabel='Войти в досье',onContinue,onSkip,onRetry,onCancel}: DeckConnectionProps) {
  const id = useId().replace(/:/g,'');
  // Stable first markup for server hydration; procedural rhythm is chosen only on the device.
  const [plan,setPlan] = useState(()=>createLoadingRhythmGenerator(()=>.5)());
  const [elapsed,setElapsed] = useState(0), [skipped,setSkipped] = useState(false);
  const [reduced,setReduced] = useState<boolean|null>(null), [hidden,setHidden] = useState(false);
  const clock = useRef<{elapsed:number;last:number|null;frame:number|null}>({elapsed:0,last:null,frame:null});
  const successClock = useRef<{elapsed:number;last:number|null;timer:ReturnType<typeof setTimeout>|null}>({elapsed:0,last:null,timer:null});
  const delivered=useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), skip = useRef<HTMLButtonElement>(null), enter = useRef<HTMLButtonElement>(null);
  const fill = useRef<HTMLSpanElement>(null), actual = useRef({ready,error,onContinue,onSkip});
  actual.current={ready,error,onContinue,onSkip};
  const bypassMotion = !animations || reduced===true || skipped;
  const loading = getLoadingState(plan,elapsed,ready,bypassMotion,error);
  const [label,note] = phaseCopy[loading.phase];
  const percent=loading.complete?100:Math.min(99,Math.floor(loading.progress*100));
  const [seenVariant,setSeenVariant]=useState(variant), [settledPhase,setSettledPhase] = useState<string|null>(null);
  if(seenVariant!==variant){setSeenVariant(variant);setSettledPhase(loading.phase==='ready'?null:loading.phase);}

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setPlan(nextLoadingPlan());});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches);update();
    media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  useEffect(()=>{
    if(document.activeElement===document.body)heading.current?.focus({preventScroll:true});
  },[]);
  useEffect(()=>{
    const paint=(time:number)=>{
      const state=getLoadingState(plan,time,actual.current.ready,false,actual.current.error);
      if(fill.current)fill.current.style.width=`${(state.progress*100).toFixed(3)}%`;
      setElapsed(time);
    };
    const capture=(now:number)=>{
      if(clock.current.last!==null){clock.current.elapsed=Math.min(plan.total,clock.current.elapsed+Math.max(0,now-clock.current.last));clock.current.last=now;}
    };
    const stop=()=>{if(clock.current.frame!==null)cancelAnimationFrame(clock.current.frame);clock.current.frame=null;clock.current.last=null;};
    const draw=(now:number)=>{
      clock.current.frame=null;
      if(document.hidden)return;
      capture(now);paint(clock.current.elapsed);
      if(clock.current.elapsed<plan.total)clock.current.frame=requestAnimationFrame(draw);else clock.current.last=null;
    };
    const start=()=>{
      if(document.hidden||clock.current.frame!==null||clock.current.elapsed>=plan.total||bypassMotion||reduced===null||error)return;
      clock.current.last=performance.now();clock.current.frame=requestAnimationFrame(draw);
    };
    const visibility=()=>{
      setHidden(document.hidden);
      if(document.hidden){capture(performance.now());stop();paint(clock.current.elapsed);}else start();
    };
    visibility();
    document.addEventListener('visibilitychange',visibility);
    return()=>{capture(performance.now());stop();document.removeEventListener('visibilitychange',visibility);};
  },[plan,bypassMotion,reduced,error]);
  useEffect(()=>{
    if(fill.current)fill.current.style.width=`${(loading.progress*100).toFixed(3)}%`;
    if(!autoContinue&&loading.complete&&!document.hidden&&(document.activeElement===heading.current||document.activeElement===skip.current))enter.current?.focus({preventScroll:true});
  },[autoContinue,loading.complete,loading.progress]);

  const complete=(immediate=false)=>{
    const current=actual.current;
    if(delivered.current||!current.ready||current.error)return;
    delivered.current=true;
    (immediate?(current.onSkip??current.onContinue):current.onContinue)();
  };
  useEffect(()=>{
    const success=successClock.current;
    if(!autoContinue||!loading.complete||reduced===null||error||!ready){success.elapsed=0;return;}
    let active=true,scheduleRevision=0;
    const duration=bypassMotion?0:SUCCESS_DWELL;
    const capture=()=>{
      if(success.last!==null){success.elapsed=Math.min(duration,success.elapsed+Math.max(0,performance.now()-success.last));success.last=null;}
    };
    const stop=()=>{scheduleRevision++;capture();if(success.timer!==null)clearTimeout(success.timer);success.timer=null;};
    const start=()=>{
      if(!active||document.hidden||success.timer!==null||delivered.current||!actual.current.ready||actual.current.error)return;
      const remaining=Math.max(0,duration-success.elapsed);
      if(!remaining){complete(bypassMotion);return;}
      success.last=performance.now();
      const revision=++scheduleRevision;
      success.timer=setTimeout(()=>{if(!active||revision!==scheduleRevision)return;stop();if(!document.hidden)complete(bypassMotion);},remaining);
    };
    const visibility=()=>{if(document.hidden)stop();else start();};
    start();document.addEventListener('visibilitychange',visibility);
    return()=>{active=false;stop();document.removeEventListener('visibilitychange',visibility);};
  },[autoContinue,loading.complete,bypassMotion,reduced,error,ready]);

  const restart=()=>{
    clock.current.elapsed=0;clock.current.last=null;
    successClock.current.elapsed=0;delivered.current=false;
    setElapsed(0);setSkipped(false);setSettledPhase(null);setPlan(nextLoadingPlan());onRetry?.();
  };
  const bypass=()=>{
    if(ready&&!error)complete(true);
    else setSkipped(true);
  };
  const cancel=()=>{
    delivered.current=true;
    if(clock.current.frame!==null)cancelAnimationFrame(clock.current.frame);
    clock.current.frame=null;clock.current.last=null;
    if(successClock.current.timer!==null)clearTimeout(successClock.current.timer);
    successClock.current.timer=null;successClock.current.last=null;
    onCancel?.();
  };
  const styles = {
    '--nc-boot-sync-time':`${plan.durations[0]}ms`, '--nc-boot-read-time':`${plan.durations[1]}ms`, '--nc-boot-verify-time':`${plan.durations[2]}ms`,
    '--nc-boot-sync-rate':plan.durations[0]/1300, '--nc-boot-read-rate':plan.durations[1]/2300, '--nc-boot-verify-rate':plan.durations[2]/1100,
  } as React.CSSProperties;
  return <section className="nc-boot-stage" data-phase={loading.phase} data-moving={bypassMotion||reduced===null?'off':'on'} data-hidden={hidden?'true':'false'} data-variant-settled={settledPhase===loading.phase?'true':'false'} data-rhythm={plan.rhythm} style={styles} aria-labelledby={`${id}-title`}>
    <div className="nc-boot-body">
      <p className="nc-boot-kicker">NIGHT CITY / PERSONAL CHANNEL / 2020</p>
      <h1 ref={heading} id={`${id}-title`} className="nc-boot-title" tabIndex={-1}>Личный канал</h1>
      <p className="nc-boot-operator">Оператор: <span>{operator}</span></p>
      <div className="nc-boot-signal" aria-hidden="true">
        <div className="nc-boot-visual" hidden={variant!=='channel'}><ChannelVisual id={id}/></div>
        <div className="nc-boot-visual" hidden={variant!=='stream'}><StreamVisual/></div>
        <div className="nc-boot-visual" hidden={variant!=='signature'}><SignatureVisual id={id}/></div>
      </div>
      <p className="nc-boot-status" role="status" aria-live="polite">{label}</p>
      <p className="nc-boot-note">{autoContinue&&loading.complete?'Открываем личное пространство.':note}</p>
      {error&&<p className="nc-boot-error" role="alert">{error}</p>}
      <div className="nc-boot-meter"><div className="nc-boot-progress" role="progressbar" aria-label="Подготовка личного пространства" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% — ${label}`}><span ref={fill} className="nc-boot-progress-fill"/></div><span className="nc-boot-percent" aria-hidden="true">{percent}%</span></div>
      <dl className="nc-boot-registers"><div><dt>Канал</dt><dd>{error?'Ошибка':ready?'На связи':'Подключение'}</dd></div><div><dt>Досье</dt><dd>{error?'Недоступно':ready?'Получено':'Ожидание'}</dd></div><div><dt>Экран</dt><dd>{loading.complete?'Готов':'Подготовка'}</dd></div></dl>
      <div className="nc-boot-controls">
        {loading.complete?(!autoContinue&&<button ref={enter} type="button" className="nc-boot-enter" onClick={()=>complete(skipped)}>{continueLabel} <span aria-hidden="true">→</span></button>):error?<>{onRetry&&<button type="button" className="nc-boot-enter" onClick={restart}>Повторить подключение</button>}</>:!bypassMotion&&<button ref={skip} type="button" onClick={bypass}>{ready?'Войти без анимации':'Пропустить анимацию'}</button>}
        {onCancel&&<button type="button" className="nc-boot-cancel" onClick={cancel}>Назад</button>}
      </div>
    </div>
  </section>;
}
