import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,moduleUrl,transpile} from './ux-hook-harness.mjs';

const rhythmSource=await readFile(new URL('../lib/loading-rhythm.ts',import.meta.url),'utf8');
const rhythmUrl=moduleUrl(transpile(rhythmSource));
const {createLoadingRhythmGenerator,sampleLoadingProgress,getLoadingState,LOADING_RHYTHMS}=await import(rhythmUrl);
let seed=2020;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const generate=createLoadingRhythmGenerator(random), plans=[];
for(let run=0;run<256;run++){
 const plan=generate();plans.push(plan);
 assert(plan.total>=4600&&plan.total<=5700);
 assert.equal(plan.durations.reduce((a,b)=>a+b,0),plan.total);
 assert(plan.durations.every(value=>value>0));
 assert.equal(sampleLoadingProgress(plan,-1),0);assert.equal(sampleLoadingProgress(plan,plan.total),1);
 if(run)assert.notEqual(plan.rhythm,plans[run-1].rhythm,'Adjacent loading families never repeat');
 if(run%8===7)assert.equal(new Set(plans.slice(run-7,run+1).map(item=>item.rhythm)).size,LOADING_RHYTHMS.length,'Every shuffle bag contains all 8 families');
 let previous=0;
 for(let time=0;time<plan.total;time+=7){const value=sampleLoadingProgress(plan,time);assert(Number.isFinite(value)&&value>=previous-1e-12&&value>=0&&value<1);previous=value;}
 for(let index=1;index<plan.points.length-1;index++){
  const knot=plan.points[index],delta=.01;
  assert(Math.abs(sampleLoadingProgress(plan,knot.time)-knot.value)<1e-12);
  const left=(sampleLoadingProgress(plan,knot.time)-sampleLoadingProgress(plan,knot.time-delta))/delta;
  const right=(sampleLoadingProgress(plan,knot.time+delta)-sampleLoadingProgress(plan,knot.time))/delta;
  assert(Math.abs(left-right)<1e-6,'PCHIP has continuous speed at curve landmarks');
 }
 for(const bypass of [false,true]){
  const pending=getLoadingState(plan,plan.total,false,bypass);assert.equal(pending.complete,false);assert.equal(pending.phase,'waiting');assert(pending.progress<=.96);
  const done=getLoadingState(plan,plan.total,true,bypass);assert.equal(done.complete,true);assert.equal(done.progress,1);
  const failed=getLoadingState(plan,plan.total,true,bypass,'Server unavailable');assert.equal(failed.complete,false);assert.equal(failed.phase,'error');assert(failed.progress<1);
 }
 assert.equal(getLoadingState(plan,0,true,false).complete,false,'API success alone does not finish the optional visual scene');
 assert.equal(getLoadingState(plan,0,true,true).complete,true,'Reduced motion does not impose a synthetic wait');
}
assert(new Set(plans.map(plan=>plan.total)).size>180,'Procedural runs vary their duration');
assert(new Set(plans.map(plan=>JSON.stringify(plan.points))).size===plans.length,'Each run has a distinct progress curve');

// Public component events, with a controlled animation clock and actual API result changes.
const env=installEnvironment(),h=createHarness(),frames=new Map();let now=0,nextFrame=1,entered=0,skippedEntries=0,retried=0,cancelled=0;
globalThis.performance={now:()=>now};
globalThis.requestAnimationFrame=fn=>{const id=nextFrame++;frames.set(id,fn);return id;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const media=new EventTarget();media.matches=false;media.addEventListener=media.addEventListener.bind(media);media.removeEventListener=media.removeEventListener.bind(media);
env.window.matchMedia=()=>media;env.document.hidden=false;env.document.activeElement=env.document.body;
globalThis.__deckReact=h.React;globalThis.__deckHarness=h;
const reactUrl=moduleUrl("const r=globalThis.__deckReact;export default r;export const memo=fn=>fn,useState=r.useState,useRef=r.useRef,useId=r.useId;export const useEffect=(fn,deps)=>r.useEffect(()=>{for(const n of globalThis.__deckHarness.nodes(undefined,[],false)){if(n.props.ref?.current)n.props.ref.current.style??={};}return fn();},deps);");
const componentSource=await readFile(new URL('../components/deck-connection.tsx',import.meta.url),'utf8');
const componentUrl=moduleUrl(transpile(componentSource.replace("from 'react'",`from '${reactUrl}'`).replace("from '@/lib/loading-rhythm'",`from '${rhythmUrl}'`)));
const {default:DeckConnection}=await import(componentUrl);
let props={variant:'channel',animations:true,operator:'test_operator',ready:false,onContinue:()=>entered++,onSkip:()=>{entered++;skippedEntries++;},onRetry:()=>retried++,onCancel:()=>cancelled++};
const stage=()=>h.find(node=>node.props.className==='nc-boot-stage');
const progress=()=>h.find(node=>node.props.role==='progressbar');
const prepareHosts=()=>{for(const node of h.nodes(undefined,[],false))if(node.props.ref?.current)node.props.ref.current.style??={};};
const setHidden=value=>{prepareHosts();env.document.hidden=value;env.document.dispatchEvent(new Event('visibilitychange'));h.render();};
const advance=ms=>{prepareHosts();now+=ms;const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(now);h.render();};
try{
 h.mount(DeckConnection,props);await h.flush();
 assert.equal(stage().props['data-phase'],'sync');assert.equal(h.button('Войти в досье'),undefined);
 advance(600);const before=progress().props['aria-valuenow'];
 prepareHosts();env.document.hidden=true;env.document.dispatchEvent(new Event('visibilitychange'));h.render();advance(9000);
 assert.equal(progress().props['aria-valuenow'],before,'Hidden time never advances the loading bar');
 assert.equal(stage().props['data-hidden'],'true');
 env.document.hidden=false;env.document.dispatchEvent(new Event('visibilitychange'));h.render();
 props={...props,variant:'stream'};h.update(props);assert.equal(stage().props['data-phase'],'sync');assert.equal(stage().props['data-variant-settled'],'true');
 advance(7000);assert.equal(stage().props['data-phase'],'waiting');assert.equal(progress().props['aria-valuenow'],96);assert.equal(h.button('Войти в досье'),undefined);assert.equal(entered,0);
 props={...props,ready:true};h.update(props);assert.equal(stage().props['data-phase'],'ready');assert.equal(progress().props['aria-valuenow'],100);assert(h.button('Войти в досье'));assert.equal(entered,0,'Ready never auto-enters');
 await h.click('Войти в досье');assert.equal(entered,1);assert.equal(skippedEntries,0,'Normal completion keeps the entrance reveal');
 props={...props,ready:false,error:'Нет связи с сервером'};h.update(props);assert.equal(stage().props['data-phase'],'error');assert.equal(h.button('Войти в досье'),undefined);assert(h.text().includes('Нет связи с сервером'));
 await h.click('Повторить подключение');assert.equal(retried,1);
 props={...props,error:undefined};h.update(props);assert.equal(stage().props['data-phase'],'sync');assert.equal(progress().props['aria-valuenow'],0);
 await h.click('Пропустить анимацию');assert.equal(entered,1,'Skip never bypasses the actual API request');assert.equal(stage().props['data-phase'],'waiting');assert.equal(frames.size,0);
 props={...props,ready:true};h.update(props);assert.equal(stage().props['data-phase'],'ready');await h.click('Войти в досье');assert.equal(entered,2);assert.equal(skippedEntries,1,'Skip chosen while the API is pending also suppresses the later entrance reveal');
 await h.click('Назад');assert.equal(cancelled,1);
 h.dispose();props={...props,ready:false,variant:'signature'};media.matches=true;h.mount(DeckConnection,props);await h.flush();assert.equal(stage().props['data-phase'],'waiting');assert.equal(frames.size,0);assert.equal(h.button('Войти в досье'),undefined);
 props={...props,ready:true};h.update(props);assert.equal(stage().props['data-phase'],'ready');assert.equal(progress().props['aria-valuenow'],100);assert.equal(entered,2);
 h.dispose();media.matches=false;props={...props,ready:true,animations:false};h.mount(DeckConnection,props);await h.flush();assert.equal(stage().props['data-phase'],'ready');assert.equal(frames.size,0);
 h.dispose();props={...props,ready:true,animations:true};h.mount(DeckConnection,props);await h.flush();await h.click('Войти без анимации');assert.equal(skippedEntries,2,'Ready-state skip uses the same immediate entrance path');
 h.dispose();props={...props,ready:false,animations:true,autoContinue:true};
 const timeout=globalThis.setTimeout,dwellDelays=[];
 globalThis.setTimeout=(callback,ms)=>{dwellDelays.push(ms);return timeout(callback,ms);};
 h.mount(DeckConnection,props);await h.flush();advance(7000);
 assert.equal(stage().props['data-phase'],'waiting');assert.equal(env.timers.size,0);assert.equal(h.button('Войти в досье'),undefined,'Automatic sign-in never presents a second entry action');
 const normalBefore=entered,skipBefore=skippedEntries;
 props={...props,ready:true};h.update(props);assert.equal(stage().props['data-phase'],'ready');assert.equal(entered,normalBefore);assert.equal(dwellDelays.at(-1),360,'Prepared data receives the short visible success dwell');
 const cancelledSuccess=[...env.timers.values()][0];
 now+=100;setHidden(true);assert.equal(env.timers.size,0,'Hidden page suspends success handoff');
 now+=5000;assert.equal(entered,normalBefore);
 setHidden(false);assert.equal(dwellDelays.at(-1),260,'Only visible success time counts');cancelledSuccess();h.render();assert.equal(entered,normalBefore,'The cancelled hidden-page timer cannot complete the resumed dwell');assert.equal(env.timers.size,1);
 now+=260;const success=[...env.timers.values()][0];success();h.render();assert.equal(entered,normalBefore+1);assert.equal(skippedEntries,skipBefore,'Normal automatic completion preserves the entrance reveal');assert.equal(env.timers.size,0);
 success();cancelledSuccess();setHidden(false);assert.equal(entered,normalBefore+1,'Timer and visibility re-entry cannot hand off twice');

 h.dispose();props={...props,ready:false};h.mount(DeckConnection,props);await h.flush();await h.click('Пропустить анимацию');
 assert.equal(entered,normalBefore+1,'Skip waits for actual prepared data');assert.equal(frames.size,0);assert.equal(env.timers.size,0);
 setHidden(true);props={...props,ready:true};h.update(props);assert.equal(entered,normalBefore+1,'Ready result cannot enter a hidden page');
 setHidden(false);assert.equal(entered,normalBefore+2);assert.equal(skippedEntries,skipBefore+1,'Pending skip automatically opens the immediate entrance path once ready');assert.equal(env.timers.size,0);
 h.render();assert.equal(entered,normalBefore+2);

 for(const mode of ['reduced','animations-off']){
  h.dispose();media.matches=mode==='reduced';props={...props,ready:false,animations:mode!=='animations-off'};h.mount(DeckConnection,props);await h.flush();
  const beforeMode=entered,beforeSkip=skippedEntries;assert.equal(entered,beforeMode);assert.equal(frames.size,0);
  props={...props,ready:true};h.update(props);assert.equal(entered,beforeMode+1);assert.equal(skippedEntries,beforeSkip+1,`${mode} suppresses dwell and the entrance layer`);assert.equal(env.timers.size,0);assert.equal(h.button('Войти в досье'),undefined);
 }

 h.dispose();media.matches=false;props={...props,ready:true,animations:true,error:undefined};h.mount(DeckConnection,props);await h.flush();advance(7000);const staleSuccess=[...env.timers.values()][0];assert(staleSuccess);
 const errorBefore=entered;props={...props,ready:false,error:'Сбой данных'};h.update(props);assert.equal(env.timers.size,0);staleSuccess();h.render();assert.equal(entered,errorBefore,'An error cancels the prepared handoff');assert.equal(stage().props['data-phase'],'error');
 await h.click('Повторить подключение');props={...props,error:undefined,ready:true};h.update(props);advance(7000);const retriedSuccess=[...env.timers.values()][0];assert(retriedSuccess);staleSuccess();h.render();assert.equal(entered,errorBefore,'A stale pre-retry timer cannot authorize the new preparation');
 const cancelBefore=cancelled;await h.click('Назад');assert.equal(cancelled,cancelBefore+1);assert.equal(env.timers.size,0);assert.equal(frames.size,0);retriedSuccess();h.render();assert.equal(entered,errorBefore,'Back cancels every handoff clock');
 h.dispose();props={...props,ready:true};h.mount(DeckConnection,props);await h.flush();await h.click('Войти без анимации');assert.equal(entered,errorBefore+1);assert.equal(env.timers.size,0);
 h.dispose();assert.equal(frames.size,0);assert.equal(env.timers.size,0);globalThis.setTimeout=timeout;
 console.log('Loading: 256 procedural curves; actual API/error/retry gate; hidden clock pause; manual preview; one automatic normal handoff after360ms visible success; immediate pending skip/reduced/off; stale timer and back cancellation passed.');
}finally{h.dispose();}
