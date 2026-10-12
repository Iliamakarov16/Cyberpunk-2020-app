import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
const env=installEnvironment(),h=createHarness();
const {BattleApp}=await loadModules(h,undefined,{actualSharedBattle:true});
const originals={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,performance:globalThis.performance};
let now=0,nextId=0;const timers=new Map();
globalThis.performance={now:()=>now};globalThis.setTimeout=(fn,ms)=>{const id=++nextId;timers.set(id,{fn,at:now+ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
const tick=async ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await h.flush();};
globalThis.__battleEffectCalls=[];
const base=createDemoScene();base.version=4;base.phase='combat';base.order=['ray','mira'];base.currentActorId='ray';base.log=[];
const props={scene:base,role:'player',viewerActorId:'ray',controlledIds:['ray'],onCommand:async()=>({}),onPreview:async()=>({ok:true})};
const shot={id:'event-5-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',kind:'shoot',actorIds:['ray','guard-1'],from:{x:6,y:10},to:{x:16,y:8},hit:false,text:'Выстрел'};
const end={id:'event-6-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',kind:'end',actorIds:['ray'],text:'Ход завершён'};
try{
 h.mount(BattleApp,props);await h.flush();h.update({...props,scene:{...base,version:6,log:[shot,end]}});await h.flush();
 assert.equal(globalThis.__battleEffectCalls.filter(Boolean).at(-1).id,shot.id,'A [shoot,end] poll delivers the actual shot rather than the final harmless event');
 assert.equal(globalThis.__battleEffectCalls.filter(Boolean).at(-1).static,false);assert(!globalThis.__battleEffectCalls.some(e=>e?.kind==='end'));
 await tick(1400);assert.equal(globalThis.__battleEffectCalls.at(-1),null);
 const move={id:'event-7-cccccccccccccccccccccccccccccccc',kind:'move',actorIds:['ray'],from:{x:6,y:10},path:[{x:7,y:10}]},reload={id:'event-8-dddddddddddddddddddddddddddddddd',kind:'reload',actorIds:['ray'],text:'Перезарядка'};
 const latest={...base,version:8,log:[shot,end,move,reload]};h.update({...props,scene:latest});await h.flush();assert.equal(globalThis.__battleEffectCalls.filter(Boolean).at(-1).id,move.id);await tick(1400);assert.equal(globalThis.__battleEffectCalls.filter(Boolean).at(-1).id,reload.id);
 h.update({...props,scene:latest,viewerActorId:'mira',controlledIds:['mira']});await h.flush();assert.equal(globalThis.__battleEffectCalls.at(-1),null);await tick(5000);assert.equal(globalThis.__battleEffectCalls.at(-1),null,'No old observer callback returns');h.dispose();
 // Same-ID redaction reaches the renderer as a replacement, never stale geometry.
 globalThis.__battleEffectCalls=[];h.mount(BattleApp,props);await h.flush();h.update({...props,scene:{...base,version:5,log:[shot]}});await h.flush();
 const redacted={id:shot.id,kind:'shoot',actorIds:['ray'],text:'Выстрел'};h.update({...props,scene:{...base,version:5,log:[redacted]}});await h.flush();const safe=globalThis.__battleEffectCalls.filter(Boolean).at(-1);assert.equal(safe.static,true);assert(!('from' in safe));assert(!('to' in safe));await tick(5000);assert(!globalThis.__battleEffectCalls.at(-1)?.from);h.dispose();
 env.document.documentElement.dataset.playerMotion='off';h.mount(BattleApp,props);await h.flush();h.update({...props,scene:{...base,version:6,log:[shot,end]}});await h.flush();assert.equal(globalThis.__battleEffectCalls.filter(Boolean).at(-1).static,true);assert.equal(globalThis.__battleRendered.reducedMotion,true);assert.equal(timers.size,0);h.dispose();
 console.log('Actual BattleApp event delivery: [shoot,end], ordered effects, observer reset, same-ID redaction, and interface reduced motion passed. Renderer mocked; queue timers deterministic.');
}finally{h.dispose();Object.assign(globalThis,originals);delete globalThis.__battleEffectCalls;}
