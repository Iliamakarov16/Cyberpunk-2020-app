import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const fixture=JSON.parse(read('qa/preserved-source-hashes.json'));
const corrections=JSON.parse(read('qa/source-metadata-corrections.json'));
for(const [file,expected] of Object.entries(fixture)){
 let bytes=fs.readFileSync(new URL('public/'+file,root));
 if(corrections[file]){const c=corrections[file];assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),c.sha256);const text=bytes.toString();assert.equal(text.split(c.after).length,2);bytes=Buffer.from(text.replace(c.after,c.before));}
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected,'Preserve source bytes except recorded metadata correction: '+file);
}
assert.deepEqual(JSON.parse(read('public/atlas-data.json')),JSON.parse(read('public/data.js').replace(/^window\.NC_ATLAS_DATA=/,'').replace(/;\s*$/,'')));
const palettes=['carmine','ultraviolet','amber','maelstrom','original'];
for(const palette of palettes){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(read('public/index.html'),{url:'https://atlas.example/',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document;
 w.localStorage.setItem('nc20.interface.v1',JSON.stringify({palette,treatment:'raw',digital:false,bootEnabled:false,bootVariant:'signature',other:'preserve-me'}));
 w.eval(read('public/theme.js'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 assert.deepEqual({...d.documentElement.dataset},{palette,appPalette:palette,mapPalette:palette,treatment:'raw',digital:'off'});
 assert.equal(d.getElementById('atlas-palette').value,'app');
 d.getElementById('atlas-treatment').value='clean';d.getElementById('atlas-treatment').dispatchEvent(new w.Event('change'));
 d.getElementById('atlas-digital').checked=true;d.getElementById('atlas-digital').dispatchEvent(new w.Event('change'));
 const saved=JSON.parse(w.localStorage.getItem('nc20.interface.v1'));
 assert.equal(saved.bootEnabled,false);assert.equal(saved.bootVariant,'signature');assert.equal(saved.other,'preserve-me');assert.equal(saved.treatment,'clean');assert.equal(saved.digital,true);
 w.dispatchEvent(new w.MessageEvent('message',{origin:'https://evil.example',source:w,data:{type:'nc-atlas:theme',version:1,appearance:{palette:'amber',treatment:'raw',digital:false}}}));
 assert.equal(d.documentElement.dataset.palette,palette,'Untrusted theme messages cannot change appearance');
 w.localStorage.setItem('nc20.interface.v1',JSON.stringify({palette:'amber',treatment:'printed',digital:false}));w.dispatchEvent(new w.StorageEvent('storage',{key:'nc20.interface.v1'}));
 assert.equal(d.documentElement.dataset.palette,'amber');assert.equal(d.documentElement.dataset.digital,'off');
 assert.deepEqual(errors,[]);dom.window.close();
}

// Real separate parent/child documents, with the same-origin/source boundary.
{
 const parent=new JSDOM('<html></html>',{url:'https://atlas.example/app'});
 const child=new JSDOM(read('public/index.html'),{url:'https://atlas.example/atlas/?crew=1',runScripts:'outside-only'});
 const p=parent.window,c=child.window;
 p.document.documentElement.dataset.palette='ultraviolet';p.document.documentElement.dataset.treatment='clean';p.document.documentElement.dataset.digital='off';
 Object.defineProperty(c,'parent',{value:p,configurable:true});c.eval(read('public/theme.js'));
 assert.equal(c.document.documentElement.dataset.palette,'ultraviolet');
 const send=(origin,source,settings)=>c.dispatchEvent(new c.MessageEvent('message',{origin,source,data:{type:'nc-crew:theme',version:1,settings}}));
 send('https://evil.example',p,JSON.stringify({palette:'amber',treatment:'raw',digital:true}));assert.equal(c.document.documentElement.dataset.palette,'ultraviolet');
 send('https://atlas.example',c,JSON.stringify({palette:'amber',treatment:'raw',digital:true}));assert.equal(c.document.documentElement.dataset.palette,'ultraviolet');
 send('https://atlas.example',p,JSON.stringify({palette:'amber',treatment:'printed',digital:true}));assert.equal(c.document.documentElement.dataset.palette,'ultraviolet','Current live parent wins over a stale message');
 send('https://atlas.example',p,'invalid json');assert.equal(c.document.documentElement.dataset.palette,'ultraviolet');
 p.document.documentElement.dataset.palette='maelstrom';await new Promise(r=>setTimeout(r,0));assert.equal(c.document.documentElement.dataset.palette,'maelstrom');
 // A bfcache restore must re-read the parent and reconnect its observer.
 c.dispatchEvent(new c.Event('pagehide'));
 p.document.documentElement.dataset.palette='original';
 c.dispatchEvent(new c.Event('pageshow'));await new Promise(r=>setTimeout(r,0));
 assert.equal(c.document.documentElement.dataset.palette,'original','Restore picks up the current parent palette');
 p.document.documentElement.dataset.palette='amber';await new Promise(r=>setTimeout(r,0));
 assert.equal(c.document.documentElement.dataset.palette,'amber','Restore reconnects live parent observation');
 c.dispatchEvent(new c.Event('pagehide'));child.window.close();parent.window.close();
}

const css=read('public/dossier.css'),carto=read('public/cartography.js');
assert(!carto.includes('clip-path="url(#dossier-land-clip)"'),'Do not crop source coast to a simplified traced vector');
assert(!carto.includes('id="dossier-ink"')&&!carto.includes('id="dossier-routes"'),'No live palette filter chains in the interactive map');
for(const item of JSON.parse(read('qa/dossier-basemap-manifest.json')).outputs)assert(fs.existsSync(new URL('public/'+item.path,root)),'Baked palette exists');
for(const p of palettes)assert(css.includes(`[data-palette="${p}"]`));
assert(css.includes('[data-digital=off] .map-coordinate-grid{display:none}'));
assert(css.includes('[data-treatment="clean"] {--nc-grain:0'));
assert(css.includes('pointer-events:none'),'Texture/decorations do not intercept gestures');
assert(css.includes('@media(prefers-reduced-motion:reduce)'));
console.log('Dossier: coordinates/assets byte-identical; catalog changed only in recorded provenance metadata; five palettes, texture/digital controls, settings preservation, storage sync and untrusted-theme rejection passed.');
