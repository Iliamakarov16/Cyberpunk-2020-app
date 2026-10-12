import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
function harness(query=''){
 const dom=new JSDOM(read('public/index.html'),{url:'https://atlas.example/'+query,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 const timers=new Map();let seq=0;w.setTimeout=(fn,ms)=>{timers.set(++seq,{fn,ms});return seq};w.clearTimeout=id=>timers.delete(id);w.requestAnimationFrame=()=>{throw Error('Optical feedback must not start RAF')};
 const media={matches:false,fn:null,addEventListener(_,fn){this.fn=fn}};w.matchMedia=()=>media;d.documentElement.dataset.digital='on';
 let intersection;w.IntersectionObserver=class{constructor(fn){intersection=fn}observe(){}disconnect(){}};
 w.eval(read('public/cyberdeck.js'));
 const event=(type,detail)=>w.dispatchEvent(new w.CustomEvent(type,{detail}));
 const camera=(view,interaction=true,map='city2020')=>event('nc-atlas:camera',{view,width:390,height:844,interaction,map});
 const ring=d.getElementById('atlas-optical-register'),tick=ring.querySelector('.ring-ticks');
 const pump=ms=>{for(const[id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn()}};
 return{dom,w,d,timers,media,event,camera,ring,tick,pump,offscreen:value=>intersection([{isIntersecting:!value}])};
}
{
 const h=harness();h.camera([0,0,1000,2000],false);assert.equal(h.timers.size,0);assert(!h.ring.classList.contains('is-active'));
 h.camera([100,100,800,1600]);assert(h.ring.classList.contains('is-active'));assert.equal(h.d.getElementById('atlas-relative-zoom').textContent,'×1.25 · ОБЗОР');assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,180);assert.equal(h.tick.style.transform,'scale(1.044628710262842)');
 h.camera([100,100,800,1600]);assert.equal(h.timers.size,1,'No-op does not schedule a second settle');
 h.camera([80,100,800,1600]);assert(h.ring.classList.contains('is-panning'));assert.equal(h.ring.querySelector('.ring-edge').style.transform,'rotate(90deg)');
 h.camera([0,0,1000,2000]);assert(parseFloat(h.tick.style.transform.slice(6))<1,'Reversal contracts ticks without restarting a film');assert.equal(h.timers.size,1);
 h.pump(180);assert.equal(h.timers.size,0);assert(!h.ring.classList.contains('is-active'));assert.equal(h.tick.style.transform,'scale(1)');
 h.camera([0,0,400,800],false);assert.equal(h.timers.size,0,'Programmatic selection changes readout without gesture pulse');assert.equal(h.d.getElementById('atlas-relative-zoom').textContent,'×2.50 · ОБЗОР');
 h.w.dispatchEvent(new h.w.Event('pagehide'));h.w.dispatchEvent(new h.w.Event('pageshow'));h.camera([0,0,400,800],false);assert.equal(h.d.getElementById('atlas-relative-zoom').textContent,'×2.50 · ОБЗОР','bfcache does not reset relative scale');
 h.camera([0,0,1200,900],false,'sector:A1');assert.equal(h.d.getElementById('atlas-relative-zoom').textContent,'×1.00 · ПЛАН');h.w.dispatchEvent(new h.w.Event('pagehide'));h.dom.window.close();
}
for(const gate of ['digital','motion','reduced','panel','hidden','offscreen','modal']){
 const h=harness();h.camera([0,0,1000,2000],false);h.camera([0,0,800,1600]);assert.equal(h.timers.size,1);
 if(gate==='digital')h.d.documentElement.dataset.digital='off';
 if(gate==='motion')h.d.documentElement.dataset.playerMotion='off';
 if(gate==='reduced'){h.media.matches=true;h.media.fn()}
 if(gate==='panel')h.event('nc-atlas:panel',{panel:'catalog'});
 if(gate==='hidden'){Object.defineProperty(h.d,'hidden',{value:true,configurable:true});h.d.dispatchEvent(new h.w.Event('visibilitychange'))}
 if(gate==='offscreen')h.offscreen(true);
 if(gate==='modal')h.d.getElementById('modal').setAttribute('open','');
 await Promise.resolve();h.event('nc-atlas:appearance',{});assert.equal(h.timers.size,0,gate+' cancels timer');assert(h.ring.classList.contains('is-paused'));h.camera([0,0,700,1400]);assert.equal(h.timers.size,0,gate+' blocks new motion');h.w.dispatchEvent(new h.w.Event('pagehide'));h.dom.window.close();
}
// Entry and zoom raster lifecycle are covered by raster-refinement.mjs.
const css=read('public/cyberdeck.css');assert(css.includes('pointer-events:none'));assert(css.includes('@media(prefers-reduced-motion:reduce)'));assert(!css.includes('@keyframes'),'No idle ring animation');assert(css.includes('.map-resolution-note button{min-height:44px'));
const html=read('public/index.html');for(const id of ['catalog-toggle','zoom-in','zoom-out','atlas-overview','tools-toggle','show-card','map-reset'])assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,'Control has one stable identity: '+id);
console.log('Cyberdeck: actual camera-delta ring, reversal/no-op/settle, relative-scale continuity, seven pause gates, timer cleanup and frameless control contracts passed. Browser CSS/pointer QA remains separate.');
