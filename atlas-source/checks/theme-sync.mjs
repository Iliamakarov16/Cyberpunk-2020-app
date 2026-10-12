import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
const root=new URL('../public/',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const palettes=['carmine','ultraviolet','amber','maelstrom','original'];
for(const embedded of [false,true]){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const host=new JSDOM('<html></html>',{url:'https://atlas.example/app'});
 const dom=new JSDOM(read('index.html'),{url:'https://atlas.example/atlas/',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document,p=host.window;
 if(embedded)Object.defineProperty(w,'parent',{value:p,configurable:true});
 w.matchMedia=()=>({matches:true});w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
 w.HTMLElement.prototype.getBoundingClientRect=w.SVGElement.prototype.getBoundingClientRect=()=>({width:390,height:850,left:0,top:0});
 for(const el of d.querySelectorAll('script[src]'))w.eval(read(el.getAttribute('src').split('?')[0]));
 await new Promise(r=>setTimeout(r,0));
 const api=w.NightCityAtlas,view=JSON.stringify(api.getContext().view),selection=api.getSelection().id;
 for(let pass=0;pass<2;pass++)for(const palette of palettes){
  w.dispatchEvent(new w.Event('pagehide'));
  const value={palette,treatment:'raw',digital:false};
  if(embedded)Object.assign(p.document.documentElement.dataset,{palette,treatment:'raw',digital:'off'});
  else w.localStorage.setItem('nc20.interface.v1',JSON.stringify(value));
  w.dispatchEvent(new w.Event('pageshow'));await new Promise(r=>setTimeout(r,0));
  assert.equal(d.documentElement.dataset.palette,palette);
  assert.equal(d.querySelector('.world-source-base').getAttribute('href'),w.NC_CARTOGRAPHY.dossierBasemap(palette),'Restored theme reaches the raster');
  assert.equal(JSON.stringify(api.getContext().view),view);assert.equal(api.getSelection().id,selection);
  assert.equal(d.querySelectorAll('.world-source-base').length,1);assert.equal(d.querySelectorAll('#map filter').length,0);
 }
 if(embedded){p.document.documentElement.dataset.palette='amber';await new Promise(r=>setTimeout(r,0));assert(d.querySelector('.world-source-base').getAttribute('href').endsWith('/amber.webp'));}
 assert.deepEqual(errors,[]);dom.window.close();host.window.close();
}
console.log('Atlas theme sync: all five palettes, repeated standalone/embedded page restore, reconnected live parent observation, unchanged camera/selection and one filter-free raster passed. DOM coverage; no device pixel/FPS claim.');
