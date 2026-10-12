import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const base=new URL('../',import.meta.url),require=createRequire(new URL('package.json',base));
const {JSDOM}=require('jsdom');
const canvas=process.env.NC_REFINE_CANVAS_MODULE?require(process.env.NC_REFINE_CANVAS_MODULE):null;
const code=fs.readFileSync(new URL('public/raster-refinement.js',base),'utf8');
const original=canvas?await canvas.loadImage(fs.readFileSync(new URL('public/assets/geography-2020/dossier-v8/carmine.webp',base))):{width:2048,height:2048};
function harness({delayed=false,query='',width=390,height=844,theme=false}={}){
 const dom=new JSDOM('<!doctype html><html data-digital="on"><body><div id="map-viewport"><svg id="map" viewBox="0 -598 1024 2216"><rect width="1024" height="1024"/><g><image class="world-source-base" href="assets/source.webp" width="1024" height="1024"/></g><text id="label">CRISP LABEL</text><circle id="pin"/></svg></div><dialog id="modal"></dialog></body></html>',{url:'https://test.example/'+query,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;const parent={postMessage(){}};if(query.includes('crew=1'))Object.defineProperty(w,'parent',{value:parent});let now=0,id=0,observer,sourceImage;const timers=new Map(),raf=new Map(),draws=[];
 w.matchMedia=()=>media;const media={matches:false,listeners:[],addEventListener(_,fn){this.listeners.push(fn)}};
 Object.defineProperty(w.performance,'now',{value:()=>now});w.requestAnimationFrame=fn=>{raf.set(++id,fn);return id};w.cancelAnimationFrame=x=>raf.delete(x);
 w.setTimeout=(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id};w.clearTimeout=x=>timers.delete(x);
 w.SVGElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,width,height});
 w.IntersectionObserver=class{constructor(fn){observer=fn}observe(){}disconnect(){}};
 w.Image=class{constructor(){sourceImage=this;this.native=original;this.loaded=!delayed;this.onload=this.onerror=null;this.src=''}get complete(){return this.loaded}get naturalWidth(){return this.loaded?original.width:0}get naturalHeight(){return this.loaded?original.height:0}finish(ok=true){this.loaded=ok;(ok?this.onload:this.onerror)?.()}};
 w.HTMLCanvasElement.prototype.getContext=function(){if(!this.native)this.native=canvas?canvas.createCanvas(this.width,this.height):{getContext:()=>({clearRect(){},drawImage(){}})};const ctx=this.native.getContext('2d');return new Proxy(ctx,{get(t,k){if(k==='drawImage')return(...args)=>{draws.push(args.slice(1));args[0]=args[0].native||args[0];return t.drawImage(...args)};const v=t[k];return typeof v==='function'?v.bind(t):v},set(t,k,v){t[k]=v;return true}})};
 if(theme)w.eval(fs.readFileSync(new URL('public/theme.js',base),'utf8'));
 w.eval(code);const svg=d.getElementById('map'),view=d.getElementById('map-viewport');
 const event=(type,detail)=>w.dispatchEvent(new w.CustomEvent(type,{detail}));
 function step(ms){now=ms;for(const [key,t]of[...timers])if(t.at<=now){timers.delete(key);t.fn()}const work=[...raf];raf.clear();for(const [,fn]of work)fn(now)}
 const camera=(v,interaction=true,map='city2020')=>{svg.setAttribute('viewBox',v.join(' '));event('nc-atlas:camera',{view:v,width,height,interaction,map})};
 const node=()=>d.querySelector('.atlas-raster-refinement'),surface=()=>node()?.querySelector('canvas');
 return {w,d,dom,media,timers,raf,draws,event,step,camera,node,surface,view,get now(){return now},image:()=>sourceImage,offscreen:on=>observer([{isIntersecting:!on}]),close(){event('pagehide');dom.window.close()}};
}
{
 const h=harness();const label=h.d.getElementById('label'),source=h.d.querySelector('image');h.event('nc-atlas:local-ready');assert(h.node());assert.equal(h.node().previousSibling,source);assert.equal(h.d.getElementById('label'),label);
 const surface=h.surface();assert(surface.width*surface.height+96*96<=1000000);assert(surface.width<=1400&&surface.height<=1400);assert.equal(h.draws.length,96);
 if(canvas){const pixels=surface.native.getContext('2d').getImageData(0,0,surface.width,surface.height).data;for(let i=3;i<pixels.length;i+=4)assert.equal(pixels[i],255,'Complete actual coarse image before insertion, no shutter blanks');}
 for(const ms of [0,240,480,740]){h.step(ms);const foreign=h.node(),live=h.surface();assert(live);if(canvas&&process.env.NC_REFINE_FRAMES){const out=canvas.createCanvas(live.width,live.height),ctx=out.getContext('2d');ctx.drawImage(original,Number(foreign.getAttribute('x'))*2,Number(foreign.getAttribute('y'))*2,Number(foreign.getAttribute('width'))*2,Number(foreign.getAttribute('height'))*2,0,0,out.width,out.height);ctx.drawImage(live.native,0,0);fs.mkdirSync(process.env.NC_REFINE_FRAMES,{recursive:true});fs.writeFileSync(process.env.NC_REFINE_FRAMES+'/refinement-'+ms+'.png',out.toBuffer('image/png'));}}
 assert(h.draws.some(args=>args[6]===7));assert(h.draws.some(args=>args[6]===24));h.step(920);assert(!h.node());assert.equal(h.raf.size,0);assert.equal(h.timers.size,0);assert.equal(source.getAttribute('href'),'assets/source.webp');assert.equal(h.d.getElementById('label'),label);h.close();
}
for(const gate of ['off','motion','reduced','hidden','pagehide','panel','modal','pan','reverse','resize','source','appearance','input']){
 const h=harness();h.event('nc-atlas:local-ready');assert(h.node());
 if(gate==='off')h.d.documentElement.dataset.digital='off';if(gate==='motion')h.d.documentElement.dataset.playerMotion='off';if(gate==='reduced'){h.media.matches=true;h.media.listeners.forEach(fn=>fn())}
 if(gate==='hidden'){Object.defineProperty(h.d,'hidden',{value:true});h.d.dispatchEvent(new h.w.Event('visibilitychange'))}if(gate==='pagehide')h.event('pagehide');if(gate==='panel')h.event('nc-atlas:panel',{panel:'tools'});if(gate==='modal')h.d.getElementById('modal').setAttribute('open','');
 if(gate==='resize')h.event('resize');if(gate==='appearance'){h.d.documentElement.dataset.mapPalette='amber';h.event('nc-atlas:appearance');}if(gate==='input')h.event('pointerdown');if(gate==='source')h.d.querySelector('image').remove();
 if(gate==='pan'||gate==='reverse'){h.camera([0,-598,1024,2216],false);h.event('nc-atlas:refinement-preview');h.camera(gate==='pan'?[10,-598,1024,2216]:[0,-598,1200,2600])}
 await Promise.resolve();h.step(100);assert(!h.node(),gate+' removes image effect');assert.equal(h.raf.size,0);h.close();
}
{
 const h=harness({delayed:true});h.event('nc-atlas:local-ready');assert(!h.node());const late=h.image().onload;h.event('pointerdown');late();assert(!h.node());assert.equal(h.timers.size,0);h.close();
}
{
 const h=harness({delayed:true});h.event('nc-atlas:local-ready');h.step(1201);assert(!h.node());assert.equal(h.timers.size,0);h.image().finish();assert(!h.node());h.close();
}
{
 const h=harness({query:'?crew=1'});h.event('nc-atlas:local-ready');assert(!h.node());h.w.NC_ATLAS_REFINEMENT.entry();assert(h.node());h.w.NC_ATLAS_REFINEMENT.cancelEntry();assert(!h.node());h.close();
}
{
 const h=harness();h.event('nc-atlas:local-ready');h.step(920);h.camera([0,-598,1024,2216],false);
 for(let i=1;i<=120;i++)h.camera([i*.1,-598,1024*(1-i*.001),2216*(1-i*.001)]);
 assert.equal(h.raf.size,0);assert.equal(h.timers.size,2,'One coalesced zoom start and one quiet timer, not 120 rebuilds');h.step(981);const first=h.node();assert(first);const count=h.draws.length;
 for(let i=121;i<=140;i++)h.camera([i*.1,-598,1024*(1-i*.001),2216*(1-i*.001)]);
 assert.equal(h.node(),first);assert.equal(h.draws.length,count,'Pointer camera changes do not rebuild the image');h.step(1200);h.step(1900);assert(!h.node());assert.equal(h.raf.size,0);assert.equal(h.timers.size,0);h.close();
}
{
 const h=harness();h.event('nc-atlas:local-ready');h.event('pointerdown');h.offscreen(true);h.event('nc-atlas:refinement-preview');assert(!h.node());h.offscreen(false);assert(h.node());h.offscreen(true);assert(!h.node());h.close();
}
{
 const h=harness({theme:true});h.camera([0,-598,1024,2216],false);h.event('nc-atlas:local-ready');const initial=h.node();assert(initial);
 h.d.dispatchEvent(new h.w.Event('DOMContentLoaded'));assert.equal(h.node(),initial,'Real theme DOMContentLoaded does not cancel entry');
 h.event('nc-atlas:appearance');h.camera([0,-598,1024,2216],false);assert.equal(h.node(),initial,'Unchanged appearance and Crew resume retain entry');
 h.camera([20,-598,1024,2216],false);assert(!h.node(),'Real programmatic camera change cancels');h.close();
}
{
 const h=harness({query:'?crew=1',theme:true});h.camera([0,-598,1024,2216],false);h.event('nc-atlas:local-ready');h.w.NC_ATLAS_REFINEMENT.entry();const initial=h.node();assert(initial);
 h.w.NightCityAtlas={openModal(){},closeModal(){},resizeMap(){h.camera([0,-598,1024,2216],false)},flushLocalNotes(){}};
 h.w.NC_CREW_CAMPAIGN={getState:()=>({}),tryDismiss:()=>false,subscribe:()=>()=>{}};
 h.w.eval(fs.readFileSync(new URL('public/crew-bridge.js',base),'utf8'));
 const message=(data)=>h.w.dispatchEvent(new h.w.MessageEvent('message',{origin:'https://test.example',source:h.w.parent,data:{...data,version:1}}));
 assert.notEqual(h.w.parent,h.w);message({type:'nc-crew:theme',settings:JSON.stringify({palette:'carmine',treatment:'printed',digital:true})});message({type:'nc-crew:resume'});h.d.dispatchEvent(new h.w.Event('DOMContentLoaded'));assert.equal(h.node(),initial,'Actual Crew bridge theme/resume and DOM ready retain the same image');
 message({type:'nc-crew:theme',settings:JSON.stringify({palette:'amber',treatment:'printed',digital:true})});assert(!h.node(),'Real changed parent theme cancels');
 h.close();
}
{
 const h=harness({delayed:true});h.event('nc-atlas:local-ready');const first=h.image();first.finish(false);assert(!h.node());h.event('nc-atlas:refinement-preview');assert.notEqual(h.image(),first,'Failed image is retried on explicit replay');h.image().finish(true);assert(h.node());h.close();
}
{
 const h=harness();h.event('nc-atlas:local-ready');h.event('pointerdown');const drawer=h.d.createElement('section'),content=h.d.createElement('div');drawer.hidden=true;drawer.append(content);h.d.body.append(drawer);
 h.event('nc-atlas:refinement-preview');const replay=h.node();assert(replay);content.dispatchEvent(new h.w.Event('scroll'));assert.equal(h.node(),replay,'Late scroll from closed drawer is not map input');
 h.view.dispatchEvent(new h.w.Event('scroll'));assert(!h.node(),'Visible map scroll still cancels immediately');h.close();
}
console.log((canvas?'Actual-pixel':'Recorded canvas-call/DOM')+' refinement checks passed: original-source resampling, opaque coarse data, 4/7/12/24/48/96 samples→unchanged original, bounded pixels,48 tiles, crisp untouched labels, lifecycle gates, delayed image cancellation, Crew handoff,120-event zoom coalescing and no idle work. These are software canvas/DOM checks, not Safari or phone FPS.');
