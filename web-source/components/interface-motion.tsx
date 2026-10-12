'use client';

import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {usePlayerSettings} from '@/components/player-help';

type Theme = 'bio'|'catalog'|'tactical'|'network'|'signal';
type Transition = {id:number;theme:Theme;left:number;top:number;width:number;height:number;entry:boolean};
// The last tile clears at 712 ms; keep a short margin before discarding the layer.
const DURATION=760,NAV_DURATION=220,TILE_DURATION=460,TILE_STAGGER=36;

/** Decorative sibling layers only. The content tree never receives a navigation key. */
export default function MotionSurface({theme,navigationKey,children,fullscreen=false,enabled=true,startAfter,preserveFocusWithin,entryRevision=0}:{theme:Theme;navigationKey:string;children:React.ReactNode;fullscreen?:boolean;enabled?:boolean;startAfter?:string;preserveFocusWithin?:string;entryRevision?:number}){
 const settings=usePlayerSettings();
 const host=useRef<HTMLDivElement>(null),previous=useRef(navigationKey),previousEntry=useRef(entryRevision),serial=useRef(0);
 const [reduced,setReduced]=useState(true),[hidden,setHidden]=useState(false),[ancestorHidden,setAncestorHidden]=useState(false),[transition,setTransition]=useState<Transition|null>(null);
 useEffect(()=>{
  if(typeof window.matchMedia!=='function')return;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setReduced(media.matches);update();
  media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  const update=()=>{setHidden(document.hidden);if(document.hidden)setTransition(null);};
  update();document.addEventListener('visibilitychange',update);
  const cancel=()=>setTransition(null);
  window.addEventListener('nightcity-start-tutorial',cancel);
  return()=>{document.removeEventListener('visibilitychange',update);window.removeEventListener('nightcity-start-tutorial',cancel);};
 },[]);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const update=()=>{const hidden=!!element.closest('[hidden], [aria-hidden="true"], [inert]');setAncestorHidden(hidden);if(hidden)setTransition(null);};
  update();if(typeof MutationObserver==='undefined')return;
  const observer=new MutationObserver(update);
  for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement)observer.observe(parent,{attributes:true,attributeFilter:['hidden','aria-hidden','inert']});
  return()=>observer.disconnect();
 },[]);
 const moving=settings.animations&&!reduced&&!hidden&&!ancestorHidden;
 useLayoutEffect(()=>{
  const changed=previous.current!==navigationKey,entry=previousEntry.current!==entryRevision;
  previous.current=navigationKey;previousEntry.current=entryRevision;
  const element=host.current;
  // Read the actual ancestor now: its observer may still describe the boot screen
  // from before this commit. Hidden navigation is still consumed without replay.
  const concealed=!!element?.closest('[hidden], [aria-hidden="true"], [inert]');
  if(!settings.animations||reduced||hidden||concealed||!enabled){setTransition(null);return;}
  if(!changed&&!entry)return;
  if(document.hidden||document.querySelector?.('[data-nightcity-tutorial="active"]')||!element||element.closest('[hidden], [aria-hidden="true"], [inert]')||!element.getClientRects().length){setTransition(null);return;}
  if(ancestorHidden)setAncestorHidden(false);
  // Measure the visible work area, including after scrolling. Persistent controls stay clear.
  const rect=element.getBoundingClientRect();
  const viewport=window.visualViewport;
  const width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
  const offsetTop=viewport?.offsetTop??0,offsetLeft=viewport?.offsetLeft??0;
  const header=document.querySelector('.masthead')?.getBoundingClientRect();
  const controls=startAfter?element.querySelector(startAfter)?.getBoundingClientRect():null;
  const left=Math.max(rect.left,offsetLeft),right=Math.min(rect.right,offsetLeft+width);
  const top=Math.max(rect.top,offsetTop,header?.bottom??0,controls?.bottom??0);
  let bottom=Math.min(rect.bottom,offsetTop+height,top+(fullscreen?960:480));
  for(const control of document.querySelectorAll<HTMLElement>('.savebar,.character-tabs .section-tabs')){
   if(control.closest('[hidden], [inert]')||window.getComputedStyle(control).position!=='fixed')continue;
   const box=control.getBoundingClientRect();
   if(box.top>top&&box.top<bottom)bottom=box.top;
  }
  if(right<=left||bottom<=top){setTransition(null);return;}
  // B: assemble the new screen through a diagonal tile release. Real nodes stay mounted.
  setTransition({id:++serial.current,theme,left,top,width:right-left,height:bottom-top,entry});
 },[navigationKey,entryRevision,theme,moving,settings.animations,reduced,hidden,enabled,fullscreen,startAfter]);
 useEffect(()=>{
  if(!transition)return;
  // Also remove the layer if its stylesheet or animationend is unavailable.
  const timer=setTimeout(()=>setTransition(current=>current?.id===transition.id?null:current),DURATION+120);
  const scrollY=window.scrollY,scrollX=window.scrollX;
  const cancel=()=>setTransition(current=>current?.id===transition.id?null:current);
  const scrolled=()=>{if(window.scrollY!==scrollY||window.scrollX!==scrollX)cancel();};
  window.addEventListener('resize',cancel);window.addEventListener('scroll',scrolled);
  window.visualViewport?.addEventListener('resize',cancel);window.visualViewport?.addEventListener('scroll',cancel);
  return()=>{clearTimeout(timer);window.removeEventListener('resize',cancel);window.removeEventListener('scroll',scrolled);window.visualViewport?.removeEventListener('resize',cancel);window.visualViewport?.removeEventListener('scroll',cancel);};
 },[transition]);
 const cancel=()=>{if(transition)setTransition(null);};
 const focus=(event:React.FocusEvent<HTMLDivElement>)=>{
  // Tabs can select on mouse-down before focusing their trigger. That focus
  // belongs to the new navigation; editing the opened content still cancels.
  const control=preserveFocusWithin&&event.target.closest?.(preserveFocusWithin);
  if(control&&event.currentTarget.contains(control))return;
  cancel();
 };
 return <div ref={host} className={`nc-motion-surface ${fullscreen?'nc-motion-global':'nc-motion-local'}`} data-motion-theme={theme} data-ambient={settings.ambient} data-moving={moving?'on':'off'} data-entry-arrival={transition?.entry?'on':'off'} onPointerDownCapture={cancel} onKeyDownCapture={cancel} onFocusCapture={focus}>
  {fullscreen&&settings.ambient!=='off'&&<div className="nc-ambient" aria-hidden="true"/>}
  <div className="nc-motion-content">{children}</div>
  {transition&&<div key={transition.id} className={`nc-transition nc-transition-${transition.theme}`} data-kind={transition.entry?'entry':'navigation'} style={{'--nc-motion-duration':`${transition.entry?DURATION:NAV_DURATION}ms`,'--nc-tile-duration':`${TILE_DURATION}ms`,left:transition.left,top:transition.top,width:transition.width,height:transition.height} as React.CSSProperties} aria-hidden="true" onAnimationEnd={event=>{if(event.target===event.currentTarget)setTransition(current=>current?.id===transition.id?null:current);}}>
   {transition.entry?Array.from({length:20},(_,index)=>{const row=Math.floor(index/5),column=index%5;return <i key={index} className="nc-data-tile" data-code={`${String(index+1).padStart(2,'0')} / NC`} style={{'--nc-tile-delay':`${((3-row)+column)*TILE_STAGGER}ms`} as React.CSSProperties}/>;}):<><i className="nc-panel-frame"/><i className="nc-panel-signal"/></>}
  </div>}
 </div>;
}

/** Small registration marks from the approved study, outside readable text. */
export function RegistryMarks({enabled=true}:{enabled?:boolean}){
 const settings=usePlayerSettings();
 const [reduced,setReduced]=useState(true),[hidden,setHidden]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{setReduced(media.matches);setHidden(document.hidden);};
  update();media.addEventListener('change',update);document.addEventListener('visibilitychange',update);
  return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);};
 },[]);
 const moving=enabled&&settings.animations&&settings.ambient!=='off'&&!reduced&&!hidden;
 return <span className="nc-registry-marks" data-moving={moving?'on':'off'} data-ambient={settings.ambient} aria-hidden="true"><i className="nc-quiet-carrier"/><i className="nc-packet-mark"/></span>;
}
