import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const data = JSON.parse(read('public/atlas-data.json'));
const districtIds = new Set(data.districts.map(d=>d.id));
const all = [...data.districts, ...data.places, ...data.corePlaces];
assert.equal(new Set(all.map(p=>p.id)).size, all.length, 'IDs must be unique');
assert.equal(data.districts.length,25);
assert.equal(data.corePlaces.length,64);
assert.deepEqual(data.corePlaces.map(p=>p.number).sort((a,b)=>a-b), Array.from({length:64},(_,i)=>i+1));
for(const p of data.places){
  assert(districtIds.has(p.district), `Unknown district: ${p.id}`);
  assert(data.categories[p.category], `Unknown category: ${p.id}`);
  assert(p.canon && p.name && p.english && p.sourceCode);
  assert(p.status==='author' || (Number.isInteger(p.page) && p.pdfPage===p.page+1));
  if(p.parent)assert(all.some(i=>i.id===p.parent),`Unknown parent: ${p.id}`);
}
for(const d of data.districts){
  for(const key of ['canon','look','day','night','readout','transport','future'])assert(d[key],`${d.id}.${key}`);
  if(d.polygon)assert(d.polygon.length>=3 && d.polygon.flat().every(Number.isFinite));
}
for(const p of data.corePlaces)assert(p.point.length===2 && p.point.every(Number.isFinite));
assert.equal(data.coverage.ncsNumbered,data.places.filter(p=>p.source==='ncs' && p.sourceCode.includes('#')).length);
assert.equal(data.coverage.named,data.places.filter(p=>p.source==='ncs' && !p.sourceCode.includes('#')).length);
assert.equal(data.coverage.described,data.places.filter(p=>p.curated).length);
for(const match of read('public/index.html').matchAll(/(?:src|href)="([^"?#]+)"/g)){
  if(match[1]==='./'||/^(data:|https?:)/.test(match[1]))continue;
  assert(fs.existsSync(new URL('public/'+match[1],root)),`Missing asset: ${match[1]}`);
}

// A small DOM stand-in exercises the public integration contract and state changes.
// This does not assert browser layout or browser-native pointer behavior.
const elements=new Map(), docEvents=new Map(), winEvents=new Map(), registrations=[];
const classSet=()=>{const s=new Set();return{add:(...x)=>x.forEach(v=>s.add(v)),remove:(...x)=>x.forEach(v=>s.delete(v)),toggle:(x,v)=>{const on=v===undefined?!s.has(x):v;on?s.add(x):s.delete(x);return on},contains:x=>s.has(x)}};
function element(id=''){
  return {id,tagName:'DIV',dataset:{},style:{},attributes:{},classList:classSet(),innerHTML:'',textContent:'',value:'',children:[],events:new Map(),
    setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]},
    addEventListener(k,f){this.events.set(k,f)},insertAdjacentHTML(_p,s){this.innerHTML+=s},
    appendChild(e){this.children.push(e);if(e.id)elements.set(e.id,e)},
    getBoundingClientRect(){return{width:640,height:850,left:0,top:0}},
    closest(){return null},focus(){},select(){},showModal(){this.open=true},close(){this.open=false},click(){this.onclick?.()}};
}
for(const id of [...read('public/index.html').matchAll(/id="([^"]+)"/g)].map(m=>m[1]))elements.set(id,element(id));
elements.set('local-notes',element('local-notes'));
const workspace=element(),topbar=element();
const modeButtons=['synthesis','reference2077','sector','region','core','red'].map(v=>{const e=element();e.dataset.map=v;return e});
const mobileButtons=['map','catalog','detail'].map(v=>{const e=element();e.dataset.mobile=v;return e});
const document={body:element(),activeElement:element(),modelContext:{registerTool:t=>registrations.push(t)},
  getElementById:id=>elements.get(id),
  querySelector:s=>s==='.workspace'?workspace:s==='.topbar'?topbar:null,
  querySelectorAll:s=>s==='button[data-map]'?modeButtons:s==='button[data-mobile]'?mobileButtons:[],
  createElement:()=>element(),createElementNS:()=>element(),addEventListener:(k,f)=>docEvents.set(k,f)};
const location={search:'',hash:'',href:'https://atlas.example/'};
const window={NC_ATLAS_DATA:data,addEventListener:(k,f)=>winEvents.set(k,f),dispatchEvent:()=>{},print:()=>{}};
window.parent=window;
const localStorage={getItem:()=>null,setItem:()=>{}};
const context={window,document,location,history:{replaceState:(_a,_b,u)=>{location.hash=u}},localStorage,
  URLSearchParams,URL,Blob,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}},
  matchMedia:()=>({matches:false}),navigator:{clipboard:{writeText:async()=>{}}},setTimeout:()=>1,clearTimeout:()=>{}};
window.NC_TRANSIT_DATA=JSON.parse(read('public/transit-data.json'));window.NC_STREETS_DATA=JSON.parse(read('public/streets-data.json'));window.NC_WORLD_DATA=JSON.parse(read('public/world-data.json'));vm.runInNewContext(read('public/cartography.js'),context,{filename:'cartography.js'});vm.runInNewContext(read('public/app.js'),context,{filename:'app.js'});
const api=window.NightCityAtlas;
assert.equal(api.getSelection().id,'B2');
assert.equal(api.search('Arasaka').length>0,true);
assert.equal(api.search('Short Circuit').length,2,'Both source catalogs must remain searchable');
assert.throws(()=>api.selectLocation('missing'));
assert.throws(()=>api.selectLocation('campaign-mara'));
assert.equal(api.search('Mara Vale').length,0);
assert.equal(api.getPlayerData().places.some(p=>p.status==='author'),false);
assert.equal(api.getPlayerData().districts.some(d=>'future' in d),false);
assert.equal(api.getPlayerData().places.some(p=>'security' in p),false);
assert(!elements.get('detail-content').innerHTML.includes('Связь с 2077'));
api.selectLocation('core-01');assert(elements.get('map-subtitle').textContent.includes('Картографический архив'));
api.selectLocation('ncs-a1-1');assert(elements.get('map-subtitle').textContent.includes('Картографический архив'));
const clickPlan=()=>docEvents.get('click')({target:{closest:s=>s==='[data-action]'?{dataset:{action:'plan'}}:null}});clickPlan();assert(elements.get('map-subtitle').textContent.includes('Sourcebook'));
for(const p of all.filter(p=>p.status!=='author')){
  api.selectLocation(p.id);
  const html=elements.get('detail-content').innerHTML;
  assert(html.includes('<h1 id="detail-title">'),p.id);
  assert(!/undefined|NaN/.test(html),p.id);
}
elements.get('view-mode').onclick();
api.selectLocation('campaign-mara');
assert(elements.get('detail-content').innerHTML.includes('Место кампании'));
elements.get('view-mode').onclick();assert.equal(api.getSelection().id,'B2');
elements.get('search').events.get('input')({target:{value:'A3#1'}});
assert(elements.get('results').innerHTML.includes('ncs-a3-1'));
elements.get('search').events.get('input')({target:{value:'no_match_!_here'}});
assert(elements.get('results').innerHTML.includes('Ничего не найдено'));
elements.get('clear-filters').onclick();
elements.get('coverage').onclick();assert(elements.get('modal').open);
assert.equal(registrations.length,2);
assert.throws(()=>registrations[0].execute({query:1}));
assert.throws(()=>registrations[1].execute({id:'core-01',extra:true}));
assert.equal(registrations[1].execute({id:'core-01'}).id,'core-01');
const geo=window.NC_STREETS_DATA;assert.equal(geo.blocks.length,314);assert.equal(geo.streets.length,32);for(const p of Object.values(geo.plans)){assert(fs.existsSync(new URL('public/'+p.image,root)));for(const m of p.markers||[]){if(m.placeId)assert(all.some(i=>i.id===m.placeId));assert(m.x>=0 && m.x<p.width && m.y>=0 && m.y<p.height)}}api.selectLocation('ncs-b3-13');clickPlan();assert(elements.get('map-title').textContent.includes('Корпоративная площадь'));
docEvents.get('click')({target:{closest:s=>s==='button[data-map]'?{dataset:{map:'synthesis'}}:null}});api.selectLocation('E1');assert(elements.get('map-subtitle').textContent.includes('Картографический архив'));
const world=api.getMapData().synthesis;assert.equal(Object.keys(world.districts).length,25);assert.equal(Object.values(world.points).filter(p=>p.source==='core').length,64);assert(Object.values(world.points).filter(p=>p.source==='ncs').length>=248);assert(world.reference.modernDistricts.every(d=>d.basis==='extracted-game-trigger'));assert(world.macroAreas.every(d=>d.rings.length));assert.equal(world.assets.tiles.length,0);assert.equal(world.reference.assets.tiles.length,38);assert(world.legacy);assert.equal(world.layoutVersion,7);assert.equal(world.renderedFootprintCount,1703);assert(!elements.get('map').innerHTML.includes('sourcebook-lines'));
for(const p of Object.values(world.points))assert(p.point.every(Number.isFinite));assert.equal(world.landmarks.length,40);assert(world.landmarks.every(l=>world.points[l.id]));assert(world.localRoadPolylineCount>100);
for(const name of ['central','outer','seams'])for(const road of JSON.parse(read('docs/geography/reference-local-roads-'+name+'.json')).roads){assert.equal(road.basis,'traced-reference-road');assert(road.points.length>=2);assert(road.points.every(p=>p.length===2&&p.every(Number.isFinite)&&p[0]>=442&&p[0]<=1536&&p[1]>=0&&p[1]<=1207));}
for(const path of [world.assets.cleanBasemap,world.assets.printBasemap,world.assets.coast,world.assets.roads,world.assets.localRoads,world.assets.buildingsOverview,...world.assets.tiles.map(([x,y])=>world.assets.buildingTiles.replace('{x}',x).replace('{y}',y))])assert(fs.existsSync(new URL('public/'+path,root)),path);
api.focusMap([400,370],'synthesis');assert.equal(api.getContext().map,'synthesis');assert(elements.get('map-title').textContent.includes('Прежняя'));api.focusMap([400,370],'city2020');assert.equal(api.getContext().map,'city2020');docEvents.get('click')({target:{closest:s=>s==='button[data-map]'?{dataset:{map:'reference2077'}}:null}});assert.equal(api.getContext().map,'reference2077');assert(!elements.get('map').innerHTML.includes('world-place-pin'));api.selectLocation('E1');assert.equal(api.getContext().map,'city2020');
// Camera contracts: cursor anchoring, pinch distance and no accidental selection.
const mapEl=elements.get('map'),view=()=>mapEl.attributes.viewBox.split(' ').map(Number);elements.get('map-reset').onclick();
const before=view();const pointer=(id,x,y)=>({pointerId:id,button:0,clientX:x,clientY:y,target:mapEl});
mapEl.events.get('pointerdown')(pointer(1,200,300));mapEl.events.get('pointerdown')(pointer(2,320,300));mapEl.events.get('pointermove')(pointer(2,380,300));assert(Math.abs(view()[2]/before[2]-2/3)<1e-8);mapEl.events.get('pointerup')(pointer(2,380,300));mapEl.events.get('pointerup')(pointer(1,200,300));assert.equal(api.getSelection().id,'E1');
elements.get('map-reset').onclick();const v0=view(),r={width:640,height:850};const anchor=[v0[0]+v0[2]*.25,v0[1]+v0[3]*.4];mapEl.events.get('wheel')({clientX:160,clientY:340,deltaY:-80,preventDefault(){}});const v1=view();assert(Math.abs(v1[0]+v1[2]*.25-anchor[0])<1e-7);assert(Math.abs(v1[1]+v1[3]*.4-anchor[1])<1e-7);
api.selectLocation('core-01');clickPlan();assert(elements.get('map-title').textContent.includes('Исходная карта'));assert(elements.get('map').innerHTML.includes('assets/core-2020.webp'));

console.log(`Validated ${data.districts.length} districts, ${data.places.length} catalog records, 64 core points; all cards and integration contract.`);
