import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestModuleLoader} from './test-ts-loader.mjs';

const modules=createTestModuleLoader();
const tracker=await modules.load('lib/tracker.ts');
const {fromCatalogEntry,isEquipmentEntry,catalogSlot,catalogPrice,catalogIcon}=await modules.load('lib/catalog.ts');
const catalog=JSON.parse(readFileSync(new URL('../public/catalog/equipment-v1.json',import.meta.url),'utf8'));
const entries=catalog.items.filter(isEquipmentEntry);
assert.equal(entries.length,1489);
assert.equal(new Set(entries.map(e=>e.id)).size,entries.length,'Catalog entry IDs must be unique');
const items=entries.map(fromCatalogEntry);
for(let i=0;i<entries.length;i++){
 const entry=entries[i],item=items[i];
 assert.ok(Object.hasOwn(tracker.CATEGORIES,item.category),entry.name);
 assert.ok(Object.hasOwn(tracker.SLOTS,item.slot),entry.name);
 assert.ok(Object.hasOwn(tracker.ICONS,item.icon),entry.name);
 assert.ok(item.name.length>0&&item.name.length<=100,entry.name);
 assert.ok(item.description.length<=3000&&item.source.length<=250,entry.name);
 assert.equal(item.quantity,1);assert.equal(item.equipped,false);
 assert.deepEqual(item.modifiers,[],'Book facts cannot silently change character stats');
 if(entry.category==='cyber'){assert.equal(item.slot,'implant');assert.equal(item.armor,null);}
 assert.equal(item.slot,catalogSlot(entry));
 if(entry.verification!=='text-and-page')assert.equal(item.weight,0,'Unreviewed weight remains in the description');
}
assert.deepEqual(tracker.normalize({...tracker.blank(),items}).items,items,'Imported items must survive character normalization');
const byId=id=>entries.find(e=>e.id===id);
const expected={
 'core-kevlar-t-shirt-vest':[10,0,'soft',['torso'],'inner'],
 'core-steel-helmet':[14,0,'hard',['head'],'head'],
 'core-light-armor-jacket':[14,0,'soft',['torso','rightArm','leftArm'],'outer'],
 'core-med-armor-jacket':[18,1,'soft',['torso','rightArm','leftArm'],'outer'],
 'core-flack-vest':[20,1,'hard',['torso'],'outer'],
 'core-flack-pants':[20,1,'hard',['rightLeg','leftLeg'],'legs'],
 'core-nylon-helmet':[20,0,'hard',['head'],'head'],
 'core-heavy-armor-jacket':[20,2,'soft',['torso','rightArm','leftArm'],'outer'],
 'core-door-gunner-s-vest':[25,3,'hard',['torso'],'outer'],
 'core-metalgear':[25,2,'hard',Object.keys(tracker.ZONES),'body'],
};
assert.equal(items.filter(i=>i.armor).length,Object.keys(expected).length);
for(const [id,[sp,ev,type,zones,slot]] of Object.entries(expected)){
 const entry=byId(id);assert.ok(entry,id);
 const item=fromCatalogEntry(entry);assert.equal(item.slot,slot);assert.equal(item.armor.ev,ev);assert.equal(item.armor.type,type);
 assert.deepEqual(item.armor.coverage,Object.fromEntries(Object.keys(tracker.ZONES).map(z=>[z,zones.includes(z)?sp:0])));
 for(const invalid of [
  {...entry,verification:'needs-review'},
  {...entry,source:{...entry.source,bookId:'cb1'}},
  {...entry,facts:{...entry.facts,EV:-1}},
  {...entry,facts:{...entry.facts,SP:Infinity}},
  {...entry,facts:{...entry.facts,coverage:['foot']}},
  {...entry,facts:{...entry.facts,coverage:[]}},
 ])assert.equal(fromCatalogEntry(invalid).armor,null,`Unverified armor must remain manual: ${id}`);
}
const weapon=entries.find(e=>e.category==='weapon'&&e.facts.WA);
assert.ok(fromCatalogEntry(weapon).description.includes('Точность (WA)'));
assert.deepEqual(fromCatalogEntry(weapon).modifiers,[]);
const sdp=entries.find(e=>e.facts.SDP);
assert.equal(fromCatalogEntry(sdp).armor,null,'SDP is not armor SP');
const helmet=fromCatalogEntry(byId('core-steel-helmet'));
assert.notEqual(helmet.slot,'feet','Opening a slot must never reassign a helmet to feet');
for(const [id,slot,icon] of [
 ['cb1-uniware-boots','feet','boots'],['cb1-uniware-pants','legs','pants'],
 ['cb1-icon-america-gunfighter-hat','head','helmet'],['cb4-base-tshirt','inner','shirt'],
 ['cb4-polylog-shirt','inner','shirt'],['cb1-uniware-jumpsuit','body','armor'],
]){const item=fromCatalogEntry(byId(id));assert.equal(item.slot,slot);assert.equal(item.icon,icon);assert.equal(item.armor,null);}
const unresolved=fromCatalogEntry(byId('cb4-ponco-ensemble'));
assert.equal(unresolved.slot,'bag');assert.ok(unresolved.description.includes('Слот не указан'));
const priceEntry={...weapon,price:{value:475,currency:'eb',unit:null,raw:'475eb/single arm'}};
assert.equal(catalogPrice(priceEntry),'475eb/single arm');
assert.equal(catalogPrice({...priceEntry,price:{...priceEntry.price,value:0,raw:''}}),'0 eb');
assert.throws(()=>fromCatalogEntry(catalog.items.find(e=>e.category==='vehicle')));
const {catalogMatchesQuery,catalogIsProgram,catalogIsDeck}=await modules.load('lib/catalog-visuals.ts');
assert.equal(entries.filter(e=>/^cb[1-4]$/.test(e.source.bookId)).length,1078);
assert.equal(catalogIcon(byId('core-budgetarms-c-13')),'pistol');
for(const term of ['пистолет','куртка','киберглаз','программа'])assert(entries.some(e=>catalogMatchesQuery(e,term)),term);
assert.equal(entries.filter(catalogIsProgram).length,60);
for(const e of entries.filter(catalogIsProgram))assert.equal(catalogIcon(e),'chip',e.name);
for(const e of entries.filter(catalogIsDeck))assert.equal(catalogIcon(e),'deck',e.name);
console.log(`Catalog: ${entries.length} valid imports; ten core armor templates; manual WA/SDP/HL; source, slot, price and normalization checks passed.`);
