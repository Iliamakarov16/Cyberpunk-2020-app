// Independent read-only integration audit. Does not mutate runtime or fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
const current=new URL('../public/',import.meta.url),embeddedMirror=new URL('../../web-source/public/atlas/',import.meta.url);
const read=(name,root=current)=>fs.readFileSync(new URL(name,root),'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const drain=async()=>{for(let n=0;n<6;n++)await Promise.resolve();};
const dataNames=['data.js','atlas-data.json','streets-data.js','streets-data.json','world-data.js','world-data.json','transit-data.js','transit-data.json'];
for(const name of dataNames)assert.equal(hash(read(name)),hash(read(name,embeddedMirror)),name+' source bytes match embedded runtime mirror');

function boot({root=current,crew=false,parentMotion='on',full=true,gm=false}={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
 const parent=new JSDOM('<html></html>',{url:'https://crew.example/app'});
 const dom=new JSDOM(read('index.html',root),{url:`https://crew.example/atlas/?${crew?'crew=1&':''}mode=${gm?'gm':'player'}`,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window,d=w.document;
 Object.assign(parent.window.document.documentElement.dataset,{palette:'carmine',treatment:'printed',digital:'on',playerMotion:parentMotion});
 if(crew)Object.defineProperty(w,'parent',{value:parent.window});
 const timers=new Map(),frames=new Map();let sequence=0,offscreen;
 w.setTimeout=(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;};w.clearTimeout=id=>timers.delete(id);
 w.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};w.cancelAnimationFrame=id=>frames.delete(id);
 w.setInterval=()=>{throw Error('No recurring timers permitted in the appearance or camera scripts');};
 const media=new w.EventTarget();media.matches=false;w.matchMedia=()=>media;
 w.IntersectionObserver=class{constructor(fn){offscreen=fn;}observe(){}disconnect(){}};
 w.HTMLElement.prototype.getBoundingClientRect=w.SVGElement.prototype.getBoundingClientRect=()=>({width:390,height:844,left:0,top:0});
 const names=full?['theme.js','data.js','streets-data.js','world-data.js','transit-data.js','cartography.js',...(root===current?['cyberdeck.js']:[]),'app.js','transit.js']:['theme.js','cyberdeck.js'];
 for(const name of names)w.eval(read(name,root));
 d.dispatchEvent(new w.Event('DOMContentLoaded'));
 const event=(type,detail)=>w.dispatchEvent(new w.CustomEvent(type,{detail}));
 const pumpFrames=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(16));};
 const pumpTimers=ms=>{for(const[id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}};
 const close=()=>{w.dispatchEvent(new w.Event('pagehide'));dom.window.close();parent.window.close();assert.deepEqual(errors,[]);};
 return{dom,w,d,parent:parent.window,timers,frames,media,event,pumpFrames,pumpTimers,offscreen:value=>offscreen([{isIntersecting:!value}]),close};
}

// Compare source and embedded runtime contracts. The embedded mirror may be refreshed by the build; this is not an immutable historical fixture. Historical data preservation is separately recorded in tested-source-hashes.json and the source provenance checks.
for(const gm of [false,true]){
 const old=boot({root:embeddedMirror,gm}),now=boot({gm});
 const plain=value=>JSON.parse(JSON.stringify(value));
 const expected=plain(old.w.NightCityAtlas.getPlayerData());
 assert.deepEqual(plain(now.w.NightCityAtlas.getPlayerData()),expected,'Safe public payload unchanged for role '+gm);
 assert.deepEqual(plain(now.w.NightCityAtlas.getMapData()),plain(old.w.NightCityAtlas.getMapData()),'All coordinate systems unchanged');
 for(const id of ['core-39','ncs-a1-1','ncs-b6-mall-1']){
  old.w.NightCityAtlas.selectLocation(id);now.w.NightCityAtlas.selectLocation(id);
  assert.deepEqual(plain(now.w.NightCityAtlas.getContext()),plain(old.w.NightCityAtlas.getContext()),'Camera/POI source mapping unchanged for '+id);
 }
 assert.deepEqual(plain(now.w.NightCityAtlas.getPlayerData()),expected,'Selection and rendering never mutate public data');
 old.close();now.close();
}

// Actual host setting inheritance, live toggling, and restored iframe lifecycle.
{
 const h=boot({crew:true,parentMotion:'off'}),ring=h.d.getElementById('atlas-optical-register');
 await drain();assert.equal(h.d.documentElement.dataset.playerMotion,'off');
 h.d.getElementById('zoom-in').click();assert(!ring.classList.contains('is-active'),'Parent motion off gates real zoom feedback');
 assert.equal([...h.timers.values()].filter(t=>t.ms===180).length,0);assert(!h.d.querySelector('.nc-atlas-opening'),'No standalone cue inside Crew');
 h.parent.document.documentElement.dataset.playerMotion='on';await drain();
 h.d.getElementById('zoom-in').click();assert(ring.classList.contains('is-active'));
 h.parent.document.documentElement.dataset.playerMotion='off';await drain();assert(!ring.classList.contains('is-active'));assert.equal([...h.timers.values()].filter(t=>t.ms===180).length,0);
 for(let n=0;n<3;n++){
  h.w.dispatchEvent(new h.w.Event('pagehide'));h.parent.document.documentElement.dataset.playerMotion='on';await drain();
  h.w.dispatchEvent(new h.w.Event('pageshow'));await drain();assert.equal(h.d.documentElement.dataset.playerMotion,'on');
  h.parent.document.documentElement.dataset.playerMotion='off';await drain();assert.equal(h.d.documentElement.dataset.playerMotion,'off');
 }
 assert.equal(h.frames.size,0,'Palette/lifecycle updates introduce no animation frames');h.close();
}

// Real camera event is post-clamp and a no-op cannot restart settled feedback.
{
 const h=boot({crew:true}),map=h.d.getElementById('map'),ring=h.d.getElementById('atlas-optical-register');
 let latest;h.w.addEventListener('nc-atlas:camera',e=>latest=e.detail);
 for(let n=0;n<15;n++)h.d.getElementById('zoom-in').click();
 h.pumpTimers(180);assert(!ring.classList.contains('is-active'));
 const before=map.getAttribute('viewBox');
 map.dispatchEvent(new h.w.WheelEvent('wheel',{deltaY:-120,clientX:170,clientY:300,bubbles:true,cancelable:true}));h.pumpFrames();
 assert.equal(map.getAttribute('viewBox'),before,'Wheel cannot exceed detail cap');
 assert.deepEqual(Array.from(latest.view),before.split(' ').map(Number),'Decoration gets final clamped camera');
 assert(!ring.classList.contains('is-active'),'No-op cap has no feedback');h.pumpTimers(120);h.pumpTimers(180);
 assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
 h.close();
}
// A cue already in progress must stop for every optical lifecycle/modal gate.
for(const gate of ['digital','motion','reduced','panel','hidden','offscreen','modal','pagehide']){
 const h=boot({full:false});await drain();
 h.event('nc-atlas:local-ready');assert(h.d.querySelector('.nc-atlas-opening'));
 if(gate==='digital')h.d.documentElement.dataset.digital='off';
 if(gate==='motion')h.d.documentElement.dataset.playerMotion='off';
 if(gate==='reduced'){h.media.matches=true;h.media.dispatchEvent(new h.w.Event('change'));}
 if(gate==='panel')h.event('nc-atlas:panel',{panel:'detail'});
 if(gate==='hidden'){Object.defineProperty(h.d,'hidden',{value:true,configurable:true});h.d.dispatchEvent(new h.w.Event('visibilitychange'));}
 if(gate==='offscreen')h.offscreen(true);
 if(gate==='modal')h.d.getElementById('modal').setAttribute('open','');
 if(gate==='pagehide')h.w.dispatchEvent(new h.w.Event('pagehide'));
 await drain();assert(!h.d.querySelector('.nc-atlas-opening'),gate+' immediately clears the active standalone entry');assert.equal(h.timers.size,0,gate+' clears timers');
 h.event('nc-atlas:local-ready');assert(!h.d.querySelector('.nc-atlas-opening'),gate+' does not replay readiness');h.close();
}
console.log('Independent integration passed: source bytes, player/GM data and coordinates vs embedded runtime mirror, actual clamped camera/no-op feedback, parent animations-off/live restoration, all active-entry pause gates, no idle RAF/timers and no double standalone entry.');
