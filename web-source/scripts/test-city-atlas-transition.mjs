import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,moduleUrl,transpile} from './ux-hook-harness.mjs';

// Exercise the actual React host against a per-frame renderer spy. The renderer
// owns map pixels and entry timing; this suite checks only the lifecycle handoff.
const env=installEnvironment(),h=createHarness(),media=new EventTarget(),viewport=new EventTarget();
env.window.location={origin:'http://crew.test'};env.window.visualViewport=viewport;
env.window.matchMedia=()=>media;media.matches=false;env.document.hidden=false;
const delays=new Map(),schedule=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms)=>{const id=schedule(fn);delays.set(id,ms);return id;};
globalThis.__atlasReact={...h.React,useLayoutEffect:h.React.useEffect};
globalThis.__atlasPreferences={animations:true};
const react=moduleUrl('const r=globalThis.__atlasReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect,useLayoutEffect=r.useLayoutEffect;');
const help=moduleUrl('export const usePlayerSettings=()=>globalThis.__atlasPreferences;');
const style=moduleUrl(transpile(await readFile(new URL('../lib/interface-style.ts',import.meta.url),'utf8')));
const navigation=moduleUrl(transpile((await readFile(new URL('../lib/native-navigation.ts',import.meta.url),'utf8')).replace("from 'react'",`from '${react}'`)));
const source=(await readFile(new URL('../components/city-atlas.tsx',import.meta.url),'utf8'))
 .replace("from 'react'",`from '${react}'`).replace("from '@/components/player-help'",`from '${help}'`)
 .replace("from '@/lib/interface-style'",`from '${style}'`).replace("from '@/lib/native-navigation'",`from '${navigation}'`);
const {CityAtlas}=await import(moduleUrl(transpile(source)));
let props,child,messages,owner,visual,exits,childListeners;
const frame=()=>h.find(n=>n.type==='iframe',false),host=()=>h.find(n=>n.props.className==='nc-city-atlas',false);
const timersFor=ms=>[...env.timers].filter(([id])=>delays.get(id)===ms);
function attachFrame(withRenderer=true){
 const record={entries:0,cancellations:0,active:false};
 const renderer={entry(){record.entries++;record.active=true;},cancelEntry(){record.cancellations++;record.active=false;}};
 visual=record;owner={postMessage:(...args)=>messages.push(args),...(withRenderer?{NC_ATLAS_REFINEMENT:renderer}:{})};
 Object.assign(frame().props.ref.current,{contentWindow:owner,contentDocument:child});
 return record;
}
function noHostOverlay(){assert(!h.find(n=>n.props.className?.includes('nc-atlas-opening'),false),'The React host does not render the rejected overlay or manipulate map pixels');}
function mount(overrides={},withRenderer=true){
 h.dispose();assert.equal(env.timers.size,0,'Unmount removes all handoff and loading timers');
 media.matches=false;env.document.hidden=false;globalThis.__atlasPreferences={animations:true};
 Object.assign(env.document.documentElement.dataset,{palette:'carmine',treatment:'printed',digital:'on'});
 child=new EventTarget();childListeners=new Map();
 const add=child.addEventListener.bind(child),remove=child.removeEventListener.bind(child);
 child.addEventListener=(type,listener,options)=>{assert(!childListeners.has(type),'Only one cancellation observer per input type');assert.deepEqual(options,{capture:true,passive:true});childListeners.set(type,listener);add(type,listener,options);};
 child.removeEventListener=(type,listener,options)=>{assert.equal(childListeners.get(type),listener);childListeners.delete(type);remove(type,listener,options);};
 messages=[];exits=0;props={campaignId:42,campaignName:'Little Italy',isGM:true,onExit:()=>exits++,...overrides};
 h.mount(CityAtlas,props);attachFrame(withRenderer);noHostOverlay();
}
function send(data={type:'nc-atlas:ready',version:1},{origin='http://crew.test',sender=owner}={}){
 const event=new Event('message');Object.defineProperties(event,{origin:{value:origin},source:{value:sender},data:{value:data}});env.window.dispatchEvent(event);h.render();noHostOverlay();
}
function ready(){send();assert.equal(visual.entries,1,'The first valid ready message starts the current child renderer once');assert(visual.active);assert.equal(timersFor(2500).length,1,'The host retains only a bounded safety cleanup timer');}
function noEntry(message){assert(!visual.active,message);assert.equal(timersFor(2500).length,0);assert.equal(childListeners.size,0,'Iframe observers are released when the renderer handoff ends');noHostOverlay();}
function cancelled(message){noEntry(message);assert.equal(visual.entries,1);assert.equal(visual.cancellations,1,'An active handoff cancels its captured child renderer exactly once');}
function emit(target,type){const event=new Event(type,{cancelable:true});let delivered=0;const observer=()=>delivered++;EventTarget.prototype.addEventListener.call(target,type,observer);target.dispatchEvent(event);EventTarget.prototype.removeEventListener.call(target,type,observer);h.render();assert(!event.defaultPrevented,'Entry observers never cancel input');assert.equal(delivered,1,'The first input still reaches the application');}
function appearance(value){Object.assign(env.document.documentElement.dataset,value);emit(env.window,'nightcity-interface-change');}

mount();assert(h.text().includes('Открываем Найт-Сити'));assert.equal(visual.entries,0);assert.equal(timersFor(20000).length,1);
for(const [data,origin,sender] of [[{type:'nc-atlas:ready',version:1},'https://foreign.test',owner],[{type:'nc-atlas:ready',version:1},'http://crew.test',{}],[{type:'nc-atlas:ready',version:2},'http://crew.test',owner]]){
 send(data,{origin,sender});assert.equal(visual.entries,0);assert.equal(timersFor(2500).length,0);assert(h.text().includes('Открываем Найт-Сити'));
}
const firstFrame=frame().props.ref.current;ready();const firstTimer=timersFor(2500)[0][0];
assert(!h.text().includes('Открываем Найт-Сити'),'Actual readiness exposes the map immediately without waiting for renderer cleanup');
assert.equal(frame().props.ref.current,firstFrame);assert(!frame().props.style&&!frame().props.inert&&!frame().props.hidden,'The host keeps the real map stationary and interactive');
assert.equal(timersFor(20000).length,0);assert(messages.some(([message])=>message.type==='nc-crew:theme'));
send();appearance({palette:'amber'});assert.equal(timersFor(2500)[0][0],firstTimer,'Duplicate ready and live recoloring do not restart the entry');assert.equal(visual.entries,1);assert.equal(visual.cancellations,0);
assert.equal(JSON.parse(messages.at(-1)[0].settings).palette,'amber');
const timeout=timersFor(2500)[0][1];timeout();h.render();cancelled('The 2500 ms safety deadline releases renderer and listeners even without a completion event');send();cancelled('Duplicate ready cannot replay a consumed opening');

for(const [targetName,events] of [['host',['pointerdown','keydown','focusin','wheel','scroll','resize','pagehide']],['iframe',['pointerdown','keydown','focusin','wheel','scroll']],['viewport',['resize','scroll']]]){
 for(const type of events){mount();ready();emit(targetName==='iframe'?child:targetName==='viewport'?viewport:env.window,type);cancelled(`${targetName} ${type} cancels the renderer on first input or lifecycle change`);send();cancelled('Cancellation never causes a replay');}
}
for(const callback of ['onPointerDownCapture','onKeyDownCapture','onFocusCapture']){
 mount();ready();host().props[callback]();h.render();cancelled(`${callback} immediately cancels the child renderer`);
}
mount();ready();const nativeBack=new Event('nightcity-atlas-back',{cancelable:true});env.window.dispatchEvent(nativeBack);h.render();cancelled('Native Back also cancels child entry');assert(nativeBack.defaultPrevented);assert.equal(messages.at(-1)[0].type,'nc-crew:back');send({type:'nc-atlas:back-handled',version:1});assert.equal(exits,0);
for(const gate of ['reduced','animations','digital','hidden','suspended']){
 mount();ready();
 if(gate==='reduced'){media.matches=true;emit(media,'change');media.matches=false;emit(media,'change');}
 if(gate==='animations'){globalThis.__atlasPreferences.animations=false;h.render();globalThis.__atlasPreferences.animations=true;h.render();}
 if(gate==='digital'){appearance({digital:'off'});appearance({digital:'on'});}
 if(gate==='hidden'){env.document.hidden=true;emit(env.document,'visibilitychange');env.document.hidden=false;emit(env.document,'visibilitychange');}
 if(gate==='suspended'){h.update({...props,suspended:true});assert.equal(frame().props.ref.current.contentWindow,owner);h.update(props);assert.equal(messages.at(-1)[0].type,'nc-crew:resume');}
 cancelled(`${gate} cancels active entry and re-enabling never replays it`);
}
for(const gate of ['reduced','animations','digital','hidden','suspended']){
 mount(gate==='suspended'?{suspended:true}:{});
 if(gate==='reduced'){media.matches=true;emit(media,'change');}
 if(gate==='animations'){globalThis.__atlasPreferences.animations=false;h.render();}
 if(gate==='digital')appearance({digital:'off'});
 if(gate==='hidden')env.document.hidden=true;
 send();noEntry(`Readiness is immediate when ${gate} prevents effects`);assert.equal(visual.entries,0);assert.equal(visual.cancellations,0);assert(!h.text().includes('Открываем Найт-Сити'));
 media.matches=false;emit(media,'change');globalThis.__atlasPreferences.animations=true;appearance({digital:'on'});env.document.hidden=false;emit(env.document,'visibilitychange');h.update({...props,suspended:false});send();noEntry('Readiness consumed while hidden or disabled is never replayed later');assert.equal(visual.entries,0);
}
mount();timersFor(20000)[0][1]();h.render();assert(h.text().includes('Карта не загрузилась'));noEntry('A loading timeout reports error without starting a successful entry');assert.equal(visual.entries,0);
await h.click('Повторить загрузку');attachFrame();assert(h.text().includes('Открываем Найт-Сити'));ready();
frame().props.onError();h.render();cancelled('Frame error cancels the renderer');assert(h.text().includes('Карта не загрузилась'));
await h.click('Повторить загрузку');attachFrame();send();noEntry('Retry after an already-consumed opening does not replay entry');assert.equal(visual.entries,0);

mount();ready();const oldOwner=owner,oldVisual=visual,staleTimeout=timersFor(2500)[0][1];
h.update({...props,campaignId:43});cancelled('A campaign change cancels the previous renderer and resets readiness');assert.match(frame().props.src,/campaignId=43/);
attachFrame();send({type:'nc-atlas:ready',version:1},{sender:oldOwner});noEntry('An old frame cannot activate the new campaign renderer');assert.equal(visual.entries,0);ready();
staleTimeout();h.render();assert(visual.active,'A stale cleanup callback cannot cancel the new campaign entry');assert.equal(visual.cancellations,0);assert.equal(oldVisual.cancellations,1,'Cleanup targets the captured old renderer only');
h.dispose();assert.equal(visual.cancellations,1);assert(!visual.active);assert.equal(env.timers.size,0);assert.equal(childListeners.size,0);

mount({},false);send();assert(!h.text().includes('Открываем Найт-Сити'),'A frame without the optional renderer remains usable');assert.equal(visual.entries,0);assert.equal(timersFor(2500).length,1);noHostOverlay();emit(child,'pointerdown');noEntry('The optional-renderer fallback still cleans up on first input');h.dispose();assert.equal(env.timers.size,0);
assert.doesNotMatch(source,/nc-atlas-opening|role="progressbar"|aria-valuenow/,'The host renders no replacement reveal layer or fake network progress');
console.log('Atlas child-renderer handoff: same-origin/source/version readiness, entry/cancelEntry ownership, 2500 ms safety cleanup, first-input passthrough, motion/off/hidden/suspended/Back/retry gates, stale-campaign isolation, optional renderer and unmount cleanup passed. No host overlay or renderer-pixel claim.');
