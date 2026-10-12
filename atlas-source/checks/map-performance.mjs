import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';

const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
for(const width of [390,640]){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(read('public/index.html'),{url:'https://atlas.example/',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document,frames=new Map();let sequence=0,measurements=0;
 w.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence};w.cancelAnimationFrame=id=>frames.delete(id);
 const pump=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(16));};
 w.matchMedia=()=>({matches:width<700});
 w.HTMLElement.prototype.getBoundingClientRect=w.SVGElement.prototype.getBoundingClientRect=()=>({width,height:850,left:0,top:0});
 w.SVGElement.prototype.getBBox=()=>{measurements++;throw new Error('Synchronous SVG layout is not allowed in camera updates')};
 for(const element of d.querySelectorAll('script[src]'))w.eval(read('public/'+element.getAttribute('src').split('?')[0]));
 const api=w.NightCityAtlas,map=d.getElementById('map'),viewport=d.getElementById('map-viewport');
 const camera=()=>map.getAttribute('viewBox').split(' ').map(Number);
 let cameraWrites=0,geometryWrites=0;
 const set=w.Element.prototype.setAttribute;
 w.Element.prototype.setAttribute=function(name,value){if(this===map&&name==='viewBox')cameraWrites++;else if(map.contains(this))geometryWrites++;return set.call(this,name,value)};
 const pointer=(type,id,x,y)=>{const e=new w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:id});map.dispatchEvent(e)};
 const before=camera(),selection=api.getSelection().id;
 pointer('pointerdown',1,120,300);
 for(let i=1;i<=120;i++)pointer('pointermove',1,120+i,300+i/3);
 assert.equal(frames.size,1,'120 pointer events schedule one camera frame');
 assert.equal(cameraWrites,0,'No camera writes until the frame');assert.equal(geometryWrites,0,'No per-marker updates during pointer events');
 pump();assert.equal(cameraWrites,1);assert.equal(geometryWrites,0,'A gesture frame only updates viewBox');assert.notDeepEqual(camera(),before);
 pointer('pointerup',1,240,340);assert(geometryWrites>0,'Marker layout refreshes once on settle');assert.equal(api.getSelection().id,selection,'Pan does not select');assert.equal(frames.size,0);assert(!viewport.classList.contains('gesturing'));
 d.getElementById('map-reset').click();const pinchBefore=camera();
 pointer('pointerdown',2,150,300);pointer('pointerdown',3,270,300);pointer('pointermove',3,330,300);pump();
 assert(Math.abs(camera()[2]/pinchBefore[2]-2/3)<1e-8,'Pinch anchor and distance are preserved');
 pointer('pointerup',3,330,300);pointer('pointermove',2,160,310);assert.equal(frames.size,1);pointer('pointercancel',2,160,310);assert.equal(frames.size,0);assert(!viewport.classList.contains('gesturing'),'Cancel finishes pending frame');
 api.selectLocation('core-39');for(let i=0;i<30;i++)d.getElementById('zoom-in').click();
 assert(Math.abs(api.getContext().view[2]-width*w.NC_CARTOGRAPHY.overviewSource.worldUnitsPerPixel/2)<1e-6,'Zoom bound follows actual source pixel density');
 assert(!d.getElementById('map-resolution-note').hidden);assert(!d.getElementById('map-detail-plan').hidden);
 const sourceButton=d.getElementById('map-detail-plan');sourceButton.click();assert.equal(api.getContext().map,'core');assert(d.getElementById('map-resolution-note').hidden);
 d.querySelector('[data-map="synthesis"]').click();
 const districts=d.querySelector('[data-layer="districts"]');districts.checked=true;districts.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(d.querySelectorAll('.world-district-marker').length,25,'All districts still have keyboard/click selectors');
 assert.equal(d.querySelectorAll('.world-zone,.selected-area').length,0,'Editorial masks are not painted as geographic borders');
 api.selectLocation('ncs-a1-1');assert(d.getElementById('detail-content').textContent.includes('Положение на обзоре приблизительное'));assert(d.getElementById('selection-context').textContent.includes('≈ место'));
 api.selectLocation('ncs-b6-mall-1');assert(d.getElementById('detail-content').textContent.includes('Общая точка комплекса'));assert(d.getElementById('selection-context').textContent.includes('общий адрес'));
 api.selectLocation('core-44');assert(d.getElementById('detail-content').textContent.includes('положение на обзоре и район в каталоге расходятся'));
 const stableCamera=JSON.stringify(api.getContext().view),stableSelection=api.getSelection().id;
 for(const palette of ['carmine','amber','ultraviolet','maelstrom','original']){
  w.dispatchEvent(new w.CustomEvent('nc-atlas:appearance',{detail:{palette}}));
  assert.equal(d.querySelector('.world-source-base').getAttribute('href'),w.NC_CARTOGRAPHY.dossierBasemap(palette));
  assert.equal(d.querySelectorAll('.world-source-base').length,1);assert.equal(d.querySelectorAll('#map filter').length,0);
 }
 assert.equal(JSON.stringify(api.getContext().view),stableCamera);assert.equal(api.getSelection().id,stableSelection);
 assert.equal(measurements,0,'No forced SVG text bounding-box reads');assert.deepEqual(errors,[]);
 dom.window.close();
}
console.log('Map rendering contracts: one camera frame per 120-event burst, zero marker writes during gestures, settled/cancelled/pinch flows, source-density zoom limit, detailed-plan action, 25 district selectors and five filter-free palettes passed. This is DOM regression coverage, not measured device FPS.');
