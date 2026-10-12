import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,moduleUrl} from './ux-hook-harness.mjs';
import {createTestModuleLoader} from './test-ts-loader.mjs';

installEnvironment();
const h=createHarness();globalThis.__catalogReact=h.React;
const reactUrl=moduleUrl('const r=globalThis.__catalogReact;export default r;export const useState=r.useState,useMemo=r.useMemo,useEffect=r.useEffect;');
const iconsUrl=moduleUrl(['Plus','Search','AlertTriangle'].map(name=>`export const ${name}=props=>({type:'svg',props:{...props,children:[]}});`).join('\n'));
const tabsUrl=moduleUrl("export const Tabs=props=>({type:'harness-tabs',props});export const TabsList=props=>({type:'div',props});export const TabsTrigger=props=>({type:'button',props});export const TabsContent=props=>({type:'harness-tab-content',props});");
const artUrl=moduleUrl('export const IllustratedIcon=()=>null;');
const replacements=new Map([['react',reactUrl],['lucide-react',iconsUrl],['@/components/ui/tabs',tabsUrl],['@/components/paper-doll',artUrl]]);
const modules=createTestModuleLoader({cacheTag:'catalog-scope',transformSource:(source,file)=>file.endsWith('/components/equipment-catalog.tsx')?source.replace(/from ['"]([^'"]+)['"]/g,(whole,name)=>replacements.has(name)?`from '${replacements.get(name)}'`:whole):source});
const {default:EquipmentCatalog}=await modules.load('components/equipment-catalog.tsx');
const {isEquipmentEntry,catalogSlot,fromCatalogEntry}=await modules.load('lib/catalog.ts');
const source=JSON.parse(await readFile(new URL('../public/catalog/equipment-v1.json',import.meta.url),'utf8'));
const baseCyber=source.items.find(entry=>entry.category==='cyber');
// An explicit head component proves scope is independent from the visual/body slot vocabulary.
const headComponent={...structuredClone(baseCyber),id:'fixture-head-component',name:'Scope Head Component',slot:'head'};
const catalog={...source,items:[...source.items,headComponent]};
const all=catalog.items.filter(isEquipmentEntry),cyber=all.filter(entry=>entry.category==='cyber');
let reads=0,selected=[];
globalThis.fetch=async path=>{assert.equal(path,'/catalog/equipment-v1.json');reads++;return new Response(JSON.stringify(catalog),{status:200,headers:{'Content-Type':'application/json'}});};
const props=extra=>({select:item=>selected.push(item),...extra});
const text=node=>h.text(node).replace(/\s+/g,' ').trim();
const rows=()=>h.nodes().filter(node=>node.type==='button'&&node.props.className==='book-item');
const search=()=>h.find(node=>node.type==='input'&&node.props['aria-label']?.startsWith('Поиск'));
const setSearch=async value=>{search().props.onChange({target:{value}});h.render();await h.flush();};
const resultCount=()=>text(h.find(node=>node.props.className==='catalog-result-count'));
const bookButton=label=>h.nodes().find(node=>node.type==='button'&&node.props.className?.includes('catalog-book-spine')&&text(node).includes(label));
const entriesById=new Map(all.map(entry=>[entry.id,entry]));
const rowEntry=row=>entriesById.get(row.props.key);

try{
 h.mount(EquipmentCatalog,props({category:'cyber'}));await h.flush();
 assert.equal(reads,1);assert.equal(h.find(node=>node.props.className==='catalog').props['data-catalog-category'],'cyber');
 assert(resultCount().startsWith(`Найдено ${cyber.length}`));
 assert(rows().every(row=>rowEntry(row)?.category==='cyber'),'Scoped book results contain only implants/components');
 assert(!h.button('Быстрые шаблоны'),'Ordinary clothing/armor templates do not appear on the implants page');
 assert(!h.find(node=>node.type==='select'),'A fixed category page has no misleading all-category selector');
 assert(h.button('киберрука'));assert(h.button('нейро'));assert(!h.button('куртка'));
 assert(h.text().includes('деньги и человечность меняются вручную'),'The existing manual spending/HUMANITY policy remains visible');
 assert(text(bookButton('Все книги')).includes(`${cyber.length} имплантов`),'Book shelf count is scoped to cyber entries');
 for(const id of ['core','cb1','cb2','cb3','cb4']){
  const n=cyber.filter(entry=>entry.source.bookId===id).length;
  const label=id==='core'?'Cyberpunk 2020':`Chromebook ${id.slice(2)}`;
  assert(text(bookButton(label)).includes(`${n} имплантов`),`${label} count uses this category scope`);
 }

 // Every body-slot component remains searchable: no slot='implant' restriction is added.
 for(const entry of [cyber.find(entry=>entry.slot==='eyes'),cyber.find(entry=>entry.slot==='hand'),headComponent]){
  assert(entry);await setSearch(entry.name);
  const match=rows().find(row=>rowEntry(row)?.id===entry.id);assert(match,`Raw ${entry.slot} component remains in the cyber category`);
  await h.click(match);
  assert.deepEqual({...selected.at(-1),id:'item'}, {...fromCatalogEntry(entry),id:'item'},'Catalog scope never changes imported item location or rules');
  assert.equal(selected.at(-1).equipped,false);assert.deepEqual(selected.at(-1).modifiers,[]);
 }
 await h.click('Сбросить фильтры');
 assert.equal(search().props.value,'');assert(resultCount().startsWith(`Найдено ${cyber.length}`));
 await h.click(bookButton('Chromebook 1'));
 assert(resultCount().startsWith(`Найдено ${cyber.filter(entry=>entry.source.bookId==='cb1').length}`));
 await h.click('Сбросить фильтры');assert(rows().every(row=>rowEntry(row)?.category==='cyber'));
 await h.click('Свой имплант');
 assert.equal(selected.at(-1).category,'cyber');assert.equal(selected.at(-1).slot,'implant');assert.equal(selected.at(-1).equipped,false);
 assert.equal(selected.at(-1).armor,null);assert.deepEqual(selected.at(-1).modifiers,[]);
 h.dispose();

 // The unscoped catalogue preserves all-category filters, quick templates and custom gear.
 h.mount(EquipmentCatalog,props());await h.flush();
 assert.equal(reads,1,'Reopening a scope reuses the same validated catalogue');
 assert(resultCount().startsWith(`Найдено ${all.length.toLocaleString('ru-RU').replace(/\s+/g,' ')}`));
 const type=h.find(node=>node.type==='select');assert(type);assert.equal(type.props.value,'all');assert(h.button('Быстрые шаблоны'));
 await h.click('Своя вещь');assert.equal(selected.at(-1).category,'gear');assert.equal(selected.at(-1).slot,'bag');
 type.props.onChange({target:{value:'weapon'}});h.render();await h.flush();assert(rows().every(row=>rowEntry(row)?.category==='weapon'));
 await h.click('Сбросить фильтры');assert.equal(h.find(node=>node.type==='select').props.value,'all');
 h.dispose();

 // Existing doll slot pickers still use exactly their old slot filter and custom defaults.
 h.mount(EquipmentCatalog,props({slot:'feet'}));await h.flush();
 assert(rows().every(row=>catalogSlot(rowEntry(row))==='feet'));
 assert(resultCount().startsWith(`Найдено ${all.filter(entry=>catalogSlot(entry)==='feet').length}`));
 await h.click('Своя вещь');assert.equal(selected.at(-1).category,'clothing');assert.equal(selected.at(-1).slot,'feet');assert.equal(selected.at(-1).icon,'boots');
 await setSearch('no-match-scope-test');await h.click('Показать все вещи этого слота');
 assert(rows().every(row=>catalogSlot(rowEntry(row))==='feet'));
 h.dispose();
 console.log('PASS: actual scoped implant catalogue/counts/search/reset/custom creation, eye/hand/head component inclusion and unaltered imports; existing general and body-slot catalogues remain unchanged.');
}finally{h.dispose();}
