import {useEffect,useLayoutEffect,useRef} from 'react';

/** Native Android Back is deliberately an application event, never WebView history. */
export function forwardBack(name:string){
 const event=new Event(name,{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
}
export function useBackEvent(name:string,handler:()=>boolean){
 const current=useRef(handler);useLayoutEffect(()=>{current.current=handler;},[handler]);
 useEffect(()=>{const receive=(event:Event)=>{if(current.current())event.preventDefault();};window.addEventListener(name,receive);return()=>window.removeEventListener(name,receive);},[name]);
}
/** Bounded per-account trail. Replaying Back consumes an entry instead of recording it again. */
export function useBackTrail<T>(value:T,scope:unknown,keyOf:(value:T)=>string=JSON.stringify){
 const encoded=keyOf(value);
 const trail=useRef<{scope:unknown;last:T;encoded:string;entries:T[];replay:string|null}>({scope,last:value,encoded,entries:[],replay:null});
 useLayoutEffect(()=>{
 const state=trail.current;
 if(state.scope!==scope){Object.assign(state,{scope,last:value,encoded,entries:[],replay:null});}
 else if(state.encoded!==encoded){
  if(state.replay!==encoded){state.entries.push(state.last);if(state.entries.length>60)state.entries.shift();}
  state.last=value;state.encoded=encoded;state.replay=null;
 }
 },[scope,encoded,value]);
 return {peek:()=>trail.current.entries.at(-1),pop:()=>{const state=trail.current,previous=state.entries.pop();if(previous!==undefined)state.replay=keyOf(previous);return previous;},clear:()=>{trail.current.entries=[];trail.current.replay=null;}};
}
