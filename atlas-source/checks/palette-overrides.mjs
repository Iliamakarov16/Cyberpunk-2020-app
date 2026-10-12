import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';

const root = new URL('../public/',import.meta.url);
const read = file => fs.readFileSync(new URL(file,root),'utf8');
const KEY='nc20.interface.v1', LEGACY='nc20.dossier.appearance.v1', LOCAL='nc20.atlas.appearance.v1';
const palettes=['carmine','ultraviolet','amber','maelstrom','original'];
const defaults={theme:'app',separate:false,ui:'theme',map:'theme'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const appearance=palette=>({palette,treatment:'raw',digital:false,bootEnabled:false,bootVariant:'signature',keep:'untouched'});
function boot({stored={},parent=null,url='https://atlas.example/atlas/',full=false}={}) {
  const errors=[],events=[],vc=new VirtualConsole();
  vc.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(read('index.html'),{url,runScripts:'outside-only',virtualConsole:vc});
  const w=dom.window,d=w.document;
  if(parent)Object.defineProperty(w,'parent',{value:parent,configurable:true});
  for(const [key,value]of Object.entries(stored))w.localStorage.setItem(key,value);
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
  w.HTMLElement.prototype.getBoundingClientRect=w.SVGElement.prototype.getBoundingClientRect=()=>({width:390,height:850,left:0,top:0,right:390,bottom:850});
  w.addEventListener('nc-atlas:appearance',event=>events.push(event.detail));
  const scripts=full?[...d.querySelectorAll('script[src]')].map(el=>el.getAttribute('src').split('?')[0]):['theme.js'];
  for(const script of scripts)w.eval(read(script));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  return {w,d,dom,events,errors,close(){w.dispatchEvent(new w.Event('pagehide'));assert.deepEqual(errors,[]);w.close();}};
}
function change(h,id,value) {
  const el=h.d.getElementById(id);assert(el,'Actual HTML includes '+id);
  if(el.type==='checkbox')el.checked=value;else el.value=value;
  el.dispatchEvent(new h.w.Event('change',{bubbles:true}));
}
const last=h=>h.events.at(-1);
function effective(h,app,ui,map) {
  assert.equal(h.d.documentElement.dataset.appPalette,app);
  assert.equal(h.d.documentElement.dataset.palette,ui);
  assert.equal(h.d.documentElement.dataset.mapPalette,map);
  assert.equal(last(h).appPalette,app);assert.equal(last(h).uiPalette,ui);
  assert.equal(last(h).mapPalette,map);assert.equal(last(h).palette,map,'Legacy event field follows map, never UI');
  if(h.w.NC_CARTOGRAPHY) {
    assert.equal(h.w.NC_CARTOGRAPHY.dossierBasemap(),h.w.NC_CARTOGRAPHY.dossierBasemap(map),'A newly drawn map keeps its independent palette');
    const raster=h.d.querySelector('.world-dossier-base .world-source-base');
    if(raster)assert.equal(raster.getAttribute('href'),h.w.NC_CARTOGRAPHY.dossierBasemap(map));
  }
}
const snapshot=h=>Object.fromEntries(Object.keys(h.w.localStorage).map(key=>[key,h.w.localStorage.getItem(key)]));

// Real app/raster integration: five bases × all 25 independent UI/map pairs.
for(const app of palettes) {
  const appBytes=JSON.stringify(appearance(app));
  const h=boot({full:true,stored:{[KEY]:appBytes,'nc20.campaign.sentinel':'do-not-touch'}});
  await tick();
  effective(h,app,app,app);
  assert.equal(h.d.getElementById('atlas-palette').value,'app');
  assert(h.d.getElementById('atlas-palette-overrides').hidden);
  assert.equal(h.w.localStorage.getItem(LOCAL),null,'Linked default does not write any setting');
  const view=JSON.stringify(h.w.NightCityAtlas.getContext().view),selection=h.w.NightCityAtlas.getSelection().id;
  const raster=h.d.querySelector('.world-source-base');
  const geometry=()=>h.d.getElementById('map').innerHTML.replace(/href="[^"]*dossier-v8\/[a-z]+\.webp"/g,'href="PALETTE"');
  const originalGeometry=geometry();
  change(h,'atlas-separate',true);
  for(const ui of palettes)for(const map of palettes) {
    change(h,'atlas-ui-palette',ui);change(h,'atlas-map-palette',map);
    effective(h,app,ui,map);
    assert.equal(h.d.querySelector('.world-source-base'),raster,'Palette changes reuse the one raster node');
    assert.equal(geometry(),originalGeometry,'Palette switching never rebuilds geometry');
    assert.equal(h.w.localStorage.getItem(KEY),appBytes,'Overrides never mutate app settings');
    assert.equal(h.w.localStorage.getItem('nc20.campaign.sentinel'),'do-not-touch');
    assert.equal(JSON.stringify(h.w.NightCityAtlas.getContext().view),view);
    assert.equal(h.w.NightCityAtlas.getSelection().id,selection);
    assert.equal(h.d.querySelectorAll('#map filter').length,0);
    assert.equal(h.d.documentElement.dataset.digital,'off');
    assert.equal(h.d.documentElement.dataset.treatment,'raw');
  }
  // Explicit shared Atlas theme and preserved inactive overrides.
  change(h,'atlas-palette','ultraviolet');change(h,'atlas-separate',false);
  effective(h,app,'ultraviolet','ultraviolet');
  change(h,'atlas-separate',true);effective(h,app,'original','original');
  change(h,'atlas-ui-palette','amber');change(h,'atlas-map-palette','maelstrom');
  change(h,'atlas-treatment','clean');change(h,'atlas-digital',true);
  assert.deepEqual(JSON.parse(h.w.localStorage.getItem(KEY)),{...appearance(app),treatment:'clean',digital:true});
  effective(h,app,'amber','maelstrom');
  assert.equal(last(h).treatment,'clean');assert.equal(last(h).digital,true);
  // Source print and layer redraws keep the chosen map, without recoloring originals.
  const source=h.d.querySelector('[data-layer="sourcePrint"]');
  source.checked=true;source.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.equal(h.d.querySelector('.world-source-base').getAttribute('href'),h.w.NC_CARTOGRAPHY.overviewSource.print);
  change(h,'atlas-map-palette','original');
  assert.equal(h.d.querySelector('.world-source-base').getAttribute('href'),h.w.NC_CARTOGRAPHY.overviewSource.print);
  source.checked=false;source.dispatchEvent(new h.w.Event('change',{bubbles:true}));effective(h,app,'amber','original');
  const stored=snapshot(h);h.close();
  const reload=boot({stored,full:true});await tick();effective(reload,app,'amber','original');
  reload.d.getElementById('atlas-palette-reset').click();effective(reload,app,app,app);
  assert.deepEqual(JSON.parse(reload.w.localStorage.getItem(LOCAL)),defaults);
  assert.equal(JSON.parse(reload.w.localStorage.getItem(KEY)).treatment,'clean','Relink does not reset app texture');
  assert.equal(JSON.parse(reload.w.localStorage.getItem(KEY)).digital,true);
  reload.close();
}

// Invalid current app storage cannot revive legacy state; local inputs are bounded.
for(const invalid of ['bad json','','null','[]','42','"amber"','{}','{"palette":"constructor"}']) {
  const h=boot({stored:{[KEY]:invalid,[LEGACY]:JSON.stringify(appearance('original'))}});
  effective(h,'carmine','carmine','carmine');assert.equal(h.w.localStorage.getItem(KEY),invalid);h.close();
}
{
  const h=boot({stored:{[LEGACY]:JSON.stringify(appearance('amber'))}});
  effective(h,'amber','amber','amber');h.close();
}
for(const invalid of ['bad json','','null','[]','42','"amber"','{"theme":"study","separate":"true","ui":"constructor","map":"__proto__"}']) {
  const h=boot({stored:{[KEY]:JSON.stringify(appearance('ultraviolet')),[LOCAL]:invalid}});
  effective(h,'ultraviolet','ultraviolet','ultraviolet');assert.deepEqual({...last(h).preferences},defaults);h.close();
}

// Parent remains authoritative through app/local storage and repeated bfcache restores.
{
  const host=new JSDOM('<html></html>',{url:'https://atlas.example/app'}),p=host.window;
  Object.assign(p.document.documentElement.dataset,{palette:'ultraviolet',treatment:'raw',digital:'off'});
  const h=boot({parent:p,full:true,stored:{[KEY]:JSON.stringify(appearance('amber'))}});await tick();
  effective(h,'ultraviolet','ultraviolet','ultraviolet');
  assert.equal(h.d.documentElement.dataset.playerMotion,undefined);
  p.document.documentElement.dataset.playerMotion='off';await tick();
  assert.equal(h.d.documentElement.dataset.playerMotion,'off','Live app effects-off reaches embedded map instruments');
  assert.equal(h.w.localStorage.getItem(LOCAL),null,'Motion inheritance never creates a palette preference');
  change(h,'atlas-separate',true);change(h,'atlas-ui-palette','carmine');change(h,'atlas-map-palette','original');
  change(h,'atlas-treatment','clean');
  assert.equal(JSON.parse(h.w.localStorage.getItem(KEY)).palette,'ultraviolet','An app-wide texture edit preserves live parent palette, not stale storage or either Atlas override');
  assert.equal(JSON.parse(h.w.localStorage.getItem(KEY)).keep,'untouched');
  assert.equal(JSON.parse(h.w.localStorage.getItem(KEY)).playerMotion,undefined,'Runtime motion state is never persisted in app settings');
  for(let pass=0;pass<2;pass++)for(const palette of palettes) {
    h.w.dispatchEvent(new h.w.Event('pagehide'));
    p.document.documentElement.dataset.palette=palette;
    p.document.documentElement.dataset.playerMotion=pass===0?'off':'on';
    h.w.dispatchEvent(new h.w.Event('pageshow'));await tick();
    assert.equal(h.d.documentElement.dataset.playerMotion,pass===0?'off':'on','bfcache reconnects effects-off inheritance');
    effective(h,palette,'carmine','original');
    h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:KEY}));effective(h,palette,'carmine','original');
    h.d.getElementById('atlas-palette-reset').click();effective(h,palette,palette,palette);
    change(h,'atlas-separate',true);change(h,'atlas-ui-palette','carmine');change(h,'atlas-map-palette','original');
  }
  p.document.documentElement.dataset.palette='amber';await tick();effective(h,'amber','carmine','original');
  p.document.documentElement.dataset.playerMotion='off';await tick();
  assert.equal(h.d.documentElement.dataset.playerMotion,'off');
  delete p.document.documentElement.dataset.playerMotion;await tick();
  assert.equal(h.d.documentElement.dataset.playerMotion,undefined,'Removing parent motion preference clears a stale child switch');
  h.w.localStorage.setItem(LOCAL,JSON.stringify({theme:'app',separate:true,ui:'theme',map:'maelstrom'}));
  h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:LOCAL}));effective(h,'amber','amber','maelstrom');
  h.w.dispatchEvent(new h.w.MessageEvent('message',{origin:'https://atlas.example',source:p,data:{type:'nc-crew:theme',version:1,settings:JSON.stringify(appearance('original'))}}));
  effective(h,'amber','amber','maelstrom');
  h.d.getElementById('atlas-palette-reset').click();
  p.document.documentElement.dataset.palette='original';await tick();effective(h,'original','original','original');
  h.close();host.window.close();
}

// Separate tabs, visibility restore and explicit storage clear return to linked mode.
{
  const h=boot({stored:{[KEY]:JSON.stringify(appearance('carmine'))}});
  change(h,'atlas-palette','amber');
  h.w.localStorage.setItem(LOCAL,JSON.stringify({theme:'app',separate:true,ui:'original',map:'ultraviolet'}));
  h.w.localStorage.setItem(KEY,JSON.stringify(appearance('maelstrom')));
  Object.defineProperty(h.d,'hidden',{value:false,configurable:true});
  h.d.dispatchEvent(new h.w.Event('visibilitychange'));effective(h,'maelstrom','original','ultraviolet');
  h.w.localStorage.clear();h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:null}));effective(h,'carmine','carmine','carmine');
  h.close();
}

// Parent message origin + exact source + version + bounded payload still apply.
{
  const host=new JSDOM('<html></html>',{url:'https://parent.example/app'}),p=host.window;
  const h=boot({parent:p,url:'https://atlas.example/atlas/?parentOrigin=https%3A%2F%2Fparent.example'});
  const send=(data,origin='https://parent.example',source=p)=>h.w.dispatchEvent(new h.w.MessageEvent('message',{origin,source,data}));
  const valid={type:'nc-atlas:theme',version:1,appearance:{palette:'amber',treatment:'clean',digital:false}};
  send(valid,'https://evil.example');effective(h,'carmine','carmine','carmine');
  send(valid,'https://parent.example',h.w);effective(h,'carmine','carmine','carmine');
  send({...valid,version:2});send({...valid,appearance:{...valid.appearance,palette:'constructor'}});
  send({...valid,appearance:{...valid.appearance,digital:'false'}});effective(h,'carmine','carmine','carmine');
  send({type:'nc-crew:theme',version:1,settings:JSON.stringify(valid.appearance)});effective(h,'carmine','carmine','carmine');
  send(valid);effective(h,'amber','amber','amber');
  change(h,'atlas-separate',true);change(h,'atlas-map-palette','original');effective(h,'amber','amber','original');
  h.w.dispatchEvent(new h.w.Event('pagehide'));h.w.dispatchEvent(new h.w.Event('pageshow'));effective(h,'amber','amber','original');
  send({...valid,appearance:{palette:'maelstrom',treatment:'raw',digital:true}});effective(h,'maelstrom','maelstrom','original');
  h.d.getElementById('atlas-palette-reset').click();effective(h,'maelstrom','maelstrom','maelstrom');
  h.close();host.window.close();
}
{
  const host=new JSDOM('<html></html>',{url:'https://atlas.example/app'}),p=host.window;
  const h=boot({parent:p});
  const send=settings=>h.w.dispatchEvent(new h.w.MessageEvent('message',{origin:'https://atlas.example',source:p,data:{type:'nc-crew:theme',version:1,settings}}));
  send('x'.repeat(10001));send('{invalid');effective(h,'carmine','carmine','carmine');
  send(JSON.stringify(appearance('original')));effective(h,'original','original','original');
  send(null);effective(h,'carmine','carmine','carmine');h.close();host.window.close();
}

// Failed persistence stays visible and survives page restore in this document.
{
  const h=boot({stored:{[KEY]:JSON.stringify(appearance('carmine'))}}),storage=h.w.Storage.prototype;
  const original=storage.setItem;
  storage.setItem=function(){throw new Error('Quota exceeded');};
  change(h,'atlas-palette','amber');effective(h,'carmine','amber','amber');
  assert.match(h.d.getElementById('atlas-palette-status').textContent,/Не сохранено/);
  h.w.dispatchEvent(new h.w.Event('pagehide'));h.w.dispatchEvent(new h.w.Event('pageshow'));effective(h,'carmine','amber','amber');
  storage.setItem=original;
  h.d.getElementById('atlas-palette-reset').click();effective(h,'carmine','carmine','carmine');
  assert.doesNotMatch(h.d.getElementById('atlas-palette-status').textContent,/Не сохранено/);h.close();
}

// CSS contract: every map token equals its named source palette. Local aliases
// are redeclared on SVG so root-level var() resolution cannot leak UI colors.
const sourceCss=read('dossier.css'),css=read('atlas-palette.css'),html=read('index.html');
assert(html.indexOf('atlas-palette.css')>html.indexOf('dossier.css'));
for(const palette of palettes) {
  const source=sourceCss.match(new RegExp(':root\\[data-palette="'+palette+'"\\]\\s*\\{([^}]+)'))[1];
  const map=css.match(new RegExp(':root\\[data-map-palette="'+palette+'"\\]\\s*\\{([^}]+)'))[1];
  for(const [,token,value]of map.matchAll(/--atlas-map-([a-z-]+):([^;]+);/g)) {
    assert.equal(value,source.match(new RegExp('--nc-'+token+':([^;]+);'))[1],palette+' map '+token);
  }
}
const scoped=css.match(/#map\s*\{([^}]+)\}/)[1];
for(const token of ['deep','text','muted','red','signal','register','soft-line'])assert(scoped.includes('--nc-'+token+':var(--atlas-map-'+token+')'));
for(const token of ['water','land','line','route','coast','grid'])assert(scoped.includes('--map-'+token+':var(--nc-'));
assert(!css.includes('filter:')&&!css.includes('animation:')&&!css.includes('transition:'));
assert(sourceCss.includes('[data-digital=off] .map-coordinate-grid{display:none}'));
assert(sourceCss.includes('@media(prefers-reduced-motion:reduce)'));
assert(css.includes('--map-signal:var(--atlas-map-signal)'));
assert(css.includes('--map-background:var(--atlas-map-deep)'));
console.log('Atlas palette overrides: 125 UI/map/base combinations, exact SVG/instrument token palette parity, one reused prebaked raster, redraw/source-print preservation, app-key isolation, malformed/legacy storage, reload/relink, live parent/storage/message security, repeated bfcache + visibility + effects-off inheritance, and failed-storage recovery passed. DOM/source checks only; no device-pixel or FPS claim.');
