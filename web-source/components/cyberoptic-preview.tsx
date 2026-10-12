'use client';
import React,{useCallback,useEffect,useId,useRef,useState} from 'react';
import {RotateCcw,ScanEye} from 'lucide-react';
import {usePlayerSettings} from '@/components/player-help';

/** A visual inspection aid, not a model-specific depiction or a rules calculator. */
export default function CyberopticPreview({title='Кибероптика'}:{title?:string}){
  const settings=usePlayerSettings();
  const uid=useId().replace(/:/g,'');
  const [open,setOpen]=useState(false),[running,setRunning]=useState(false);
  const [reduced,setReduced]=useState(true);
  const frame=useRef<number|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const stop=useCallback(()=>{
    if(frame.current!==null)cancelAnimationFrame(frame.current);
    if(timer.current!==null)clearTimeout(timer.current);
    frame.current=null;timer.current=null;setRunning(false);
  },[]);
  const enabled=settings.animations&&!reduced;
  const play=useCallback(()=>{
    stop();
    if(!enabled||!open||document.hidden)return;
    // A fresh frame restarts the finite CSS animation when replay is pressed.
    frame.current=requestAnimationFrame(()=>{
      frame.current=null;
      if(document.hidden)return;
      setRunning(true);
      timer.current=setTimeout(()=>{timer.current=null;setRunning(false);},1350);
    });
  },[enabled,open,stop]);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches);
    update();media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  useEffect(()=>{
    if(open&&enabled)play();else stop();
    return stop;
  },[open,enabled,play,stop]);
  useEffect(()=>{
    const visibility=()=>{if(document.hidden)stop();};
    document.addEventListener('visibilitychange',visibility);
    return()=>document.removeEventListener('visibilitychange',visibility);
  },[stop]);
  const ref=(name:string)=>`url(#${uid}-${name})`;
  const noteId=`${uid}-note`;
  return <details className="nc-cyberoptic" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="nc-cyberoptic-summary"><ScanEye aria-hidden="true"/><span><strong>Осмотреть оптический узел</strong><small>{title}</small></span><span className="nc-cyberoptic-classification" aria-hidden="true">OPT / 020</span></summary>
    <div className="nc-cyberoptic-body">
      <figure className={`nc-cyberoptic-device${running?' nc-cyberoptic-running':''}`}>
        <svg className="nc-cyberoptic-art" viewBox="0 0 420 270" role="img" aria-label="Техническая иллюстрация глазного импланта: металлический корпус, оптическая линза и кабель">
          <defs>
            <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#d1e7df"/><stop offset=".15" stopColor="#536b64"/><stop offset=".38" stopColor="#a9c6bc"/><stop offset=".6" stopColor="#31443e"/><stop offset=".78" stopColor="#bacfc6"/><stop offset="1" stopColor="#50635c"/></linearGradient>
            <linearGradient id={`${uid}-rim`} x1="0" x2="1"><stop stopColor="#50675f"/><stop offset=".35" stopColor="#bdd3c8"/><stop offset=".75" stopColor="#718a80"/><stop offset="1" stopColor="#293e36"/></linearGradient>
            <radialGradient id={`${uid}-glass`} cx=".34" cy=".3"><stop stopColor="#a8c9bb"/><stop offset=".14" stopColor="#496f65"/><stop offset=".53" stopColor="#1c3937"/><stop offset=".88" stopColor="#091819"/><stop offset="1" stopColor="#405d53"/></radialGradient>
            <radialGradient id={`${uid}-lens-light`}><stop stopColor="var(--nc-accent,#ee124b)" stopOpacity=".8"/><stop offset=".65" stopColor="var(--nc-accent,#ee124b)" stopOpacity=".18"/><stop offset="1" stopColor="var(--nc-accent,#ee124b)" stopOpacity="0"/></radialGradient>
            <linearGradient id={`${uid}-scan-light`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--nc-signal,#d1e7df)" stopOpacity="0"/><stop offset=".7" stopColor="var(--nc-signal,#d1e7df)" stopOpacity=".05"/><stop offset="1" stopColor="var(--nc-signal,#d1e7df)" stopOpacity=".65"/></linearGradient>
            <clipPath id={`${uid}-clip`}><ellipse cx="194" cy="126" rx="72" ry="80"/><path d="M196 67 L261 82 Q294 104 288 143 Q282 181 252 189 L191 185Z"/></clipPath>
          </defs>
          <path d="M269 150 Q294 163 289 190 Q283 213 319 215 L350 210" fill="none" stroke="#526b60" strokeWidth="9"/>
          <path d="M269 148 Q294 161 289 188 Q284 212 319 213 L350 208" fill="none" stroke="#a1b9ac" strokeWidth="2"/>
          <path d="M343 199 L363 198 L375 205 L374 219 L347 221Z" fill={ref('metal')} stroke="#293f35" strokeWidth="2"/>
          <path d="M361 204 L370 207 M357 210 L370 212 M357 215 L368 216" stroke="#132923" strokeWidth="2"/>
          <path d="M196 67 L261 82 Q294 104 288 143 Q282 181 252 189 L191 185Z" fill={ref('metal')} stroke="#729486" strokeWidth="1"/>
          <path d="M251 87 Q277 105 279 129 M262 158 L270 159 M259 169 L264 171" fill="none" stroke="#d1e7df" strokeWidth="1" opacity=".7"/>
          <path d="M223 72 L221 184 M240 78 L237 184 M255 83 L250 181" stroke="#0c2520" strokeWidth="3" opacity=".6"/>
          <ellipse cx="194" cy="126" rx="72" ry="80" fill={ref('rim')} stroke="#d1e7df" strokeWidth="1"/>
          <ellipse cx="184" cy="123" rx="62" ry="72" fill="#18302a" stroke="#afc9bd" strokeWidth="3"/>
          <ellipse cx="181" cy="123" rx="51" ry="61" fill={ref('glass')} stroke="#586f60" strokeWidth="5"/>
          <ellipse className="nc-optic-glow" cx="181" cy="123" rx="49" ry="59" fill={ref('lens-light')} aria-hidden="true"/>
          <ellipse cx="181" cy="123" rx="33" ry="41" fill="none" stroke="#799e90" strokeWidth=".8" opacity=".8"/>
          <g className="nc-optic-iris"><ellipse cx="181" cy="123" rx="17" ry="24" fill="var(--nc-deep,#050b0e)" stroke="#a9c6b7" strokeWidth="1"/><path d="M166 106 L174 100 M189 102 L196 113 M198 133 L191 143 M172 144 L165 133" stroke="#a9c6b7" strokeWidth=".7" fill="none" opacity=".65"/></g>
          <path d="M148 95 Q153 74 174 73 L165 89 Q152 94 150 107Z" fill="#d1e7df" opacity=".53"/>
          <path d="M151 168 Q169 182 187 175" fill="none" stroke="#9abaac" strokeWidth="2" opacity=".5"/>
          <path d="M152 68 L159 76 M141 83 L151 90 M131 104 L142 106 M128 128 L140 128 M134 153 L143 149 M146 176 L155 166 M168 192 L172 180 M195 194 L194 181 M217 184 L210 173 M235 163 L223 157 M244 140 L231 137 M244 114 L231 115 M236 92 L224 99 M218 71 L210 83 M196 60 L195 73 M173 59 L176 73" stroke="#d1e7df" strokeWidth="2" opacity=".8"/>
          <circle cx="256" cy="119" r="5" fill="#142620" stroke="#819e91"/><path d="M253 117 L259 121" stroke="#c1d4c8"/>
          <circle cx="254" cy="151" r="5" fill="#142620" stroke="#819e91"/><path d="M251 149 L257 153" stroke="#c1d4c8"/>
          <rect className="nc-optic-led" x="256" y="133" width="18" height="5" fill="var(--nc-accent,#ee124b)"/>
          <g aria-hidden="true" clipPath={ref('clip')}><g className="nc-optic-sweep"><rect x="116" y="30" width="184" height="12" fill={ref('scan-light')}/><path d="M116 42 H300" stroke="var(--nc-signal,#d1e7df)" strokeWidth=".7"/></g></g>
          <ellipse className="nc-optic-contour" cx="194" cy="126" rx="73" ry="81" fill="none" stroke="var(--nc-accent,#ee124b)" strokeWidth="1.2" strokeDasharray="560" strokeDashoffset="560" aria-hidden="true"/>
          <path d="M130 149 L89 166 L66 166 M184 185 L161 226 L114 226" fill="none" stroke="#a0b9ac" strokeWidth="1"/>
          <circle cx="130" cy="149" r="2.5" fill="#d1e7df"/><circle cx="184" cy="185" r="2.5" fill="#d1e7df"/>
          <path d="M87 89 L96 89 L96 80 M288 183 L288 192 L279 192" stroke="var(--nc-accent,#ee124b)" strokeWidth="1" fill="none"/>
        </svg>
        <figcaption>ОПТИЧЕСКИЙ УЗЕЛ / ТЕХНИЧЕСКИЙ ЭСКИЗ</figcaption>
      </figure>
      <div className="nc-cyberoptic-controls"><button type="button" className="nc-cyberoptic-replay" disabled={!enabled} onClick={play} aria-describedby={noteId}><RotateCcw aria-hidden="true"/><span>Повторить осмотр</span></button><p id={noteId} className="nc-cyberoptic-note">Условная иллюстрация оптического узла. Внешность конкретной модели может отличаться.{!enabled&&' Анимация отключена настройками движения.'}</p></div>
    </div>
  </details>;
}
