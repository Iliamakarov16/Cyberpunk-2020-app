import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

// Actual Tracker, Hub, Terminal, portrait editor and wardrobe callbacks. This
// exercises navigation/state/access contracts; it does not emulate browser layout.
const env=installEnvironment(),h=createHarness(),media=new EventTarget();
media.matches=false;env.window.matchMedia=()=>media;env.document.hidden=false;
globalThis.Image=class{naturalWidth=1200;naturalHeight=1800;decode(){return Promise.resolve();}};
const scrolls=[];env.window.scrollTo=options=>scrolls.push(options);
let readDraft;env.document.modelContext={registerTool(tool){if(tool.name==='read_character_draft')readDraft=tool.execute;}};
const {Tracker,blank,newItem}=await loadModules(h,undefined,{actualWardrobe:true});
const clone=value=>structuredClone(value);
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const me={id:2,username:'Adam',role:'player',csrf:'test-token',platform:true};
const item=(id,name,category,slot,equipped)=>({...newItem(category),id,name,slot,equipped});
const own={id:21,owner_id:2,owner:'Adam',version:1,updated:100,can_edit:true,data:blank('Вега','Фиксер')};
own.data.stats.REF=7;own.data.stats.INT=6;own.data.notes='Сохранённая запись';own.data.background='Сохранённая предыстория';
own.data.appearance={accent:'rust',portrait:'data:image/jpeg;base64,/9j/AA',portraitFrame:{fit:'cover',x:50,y:50,zoom:100,height:340,effect:'off'}};
own.data.skills=[{name:'Handgun',stat:'REF',rank:4,ip:12,multiplier:2}];
own.data.items=[
 item('jacket','Куртка Веги','clothing','outer',true),
 item('pistol','Пистолет Веги','weapon','mainHand',true),
 {...item('ammo','Патроны Веги','ammo','bag',false),quantity:9},
 item('eye','Киберглаз Веги','cyber','eyes',true),
 item('arm','Запасная киберрука','cyber','hands',false),
 item('legacy','Старый имплант','gear','implant',true),
];
const shared={...clone(own),id:22,owner_id:3,owner:'Друг',can_edit:false,can_delete:false,can_history:false,access:'shared',data:{...clone(own.data),name:'Чужой герой',notes:'Общая запись'}};
const campaign={id:10,name:'Тест навигации',description:'',gm_id:1,gm:'ГМ',version:1,updated:100,is_gm:false,is_member:true,transfer_to:null};
let ownCurrent=own,sharedCurrent=clone(shared),denyShared=false,holdHistory=false,pendingHistory;
const action={id:'action-1',characterId:21,targetId:'guard',kind:'attack',description:'Выстрел по охраннику',tool:'Пистолет',roll:18,damage:9,status:'resolved',result:'Потрачен один патрон. Ранения героя определены отдельно.',created:100,resolvedAt:101};
const scene={id:'scene-warehouse',name:'Склад',active:true,targets:[{id:'guard',name:'Охранник',kind:'person',description:'У двери',visible:true}],actions:[action],log:[]};
const detail=()=>({...campaign,members:[],roster:[own,sharedCurrent].map(c=>({character_id:c.id,owner_id:c.owner_id,owner:c.owner,name:c.data.name,role:c.data.role,status:'active',can_open:true}))});
const workspace=()=>({version:1,updated:100,is_gm:false,characters:[own,sharedCurrent].map(c=>({id:c.id,name:c.data.name,role:c.data.role,owner_id:c.owner_id,status:'active'})),data:{schemaVersion:1,contacts:[],messages:[],places:[],assets:[],scene:clone(scene)}});
const calls=[];
globalThis.fetch=async(path,options={})=>{
 const method=options.method||'GET';calls.push({path,method});
 assert.equal(method,'GET','Navigating, applying local drafts and reading shared sheets never writes API data');
 if(path==='/api/me')return reply(me);
 if(path==='/api/settings')return reply({hints:false,tutorial:false,animations:false});
 if(path==='/api/characters')return reply([ownCurrent,sharedCurrent]);
 if(path==='/api/characters/21')return reply(ownCurrent);
 if(path==='/api/characters/22')return denyShared?reply({error:'Доступ закрыт'},403):reply(sharedCurrent);
 if(path==='/api/characters/21/history')return holdHistory?new Promise(resolve=>{pendingHistory=resolve;}):reply([{version:1,reason:'Создание персонажа',created:100,username:'Adam'}]);
 if(path==='/api/campaigns')return reply([campaign]);
 if(path==='/api/campaigns/10')return reply(detail());
 if(path==='/api/campaigns/10/workspace')return reply(workspace());
 throw new Error(`Unexpected ${method} ${path}`);
};
const selectors={sheet:'Персонаж',items:'Вещи',worn:'Экипировка',implants:'Импланты',skills:'Навыки',notes:'Заметки',history:'История'};
const hasClass=(node,name)=>node.props.className?.split(' ').includes(name);
const sectionSelect=()=>h.find(n=>n.type==='select'&&n.props['aria-label']==='Раздел листа персонажа');
const characterTabs=()=>h.find(n=>n.type==='harness-tabs'&&hasClass(n,'character-tabs'));
const savebar=()=>h.find(n=>n.props['aria-label']==='Сохранение листа');
const editSheet=()=>h.find(n=>n.type==='harness-Sheet');
const draft=()=>{assert(readDraft,'Actual Tracker registers its readonly draft tool');return readDraft({}).data;};
const field=(label,type='textarea')=>{
 const parent=h.find(n=>n.props['data-label']===label);assert(parent,`Missing field ${label}`);
 const node=h.nodes(parent).find(n=>n.type===type);assert(node,`Missing ${type} in ${label}`);return node;
};
async function change(node,value){assert(node);node.props.onChange({target:{value}});h.render();await h.flush();}
async function mount(){h.mount(Tracker,{platformAuth:false});await h.flush();}
async function openOwn(){await mount();await h.click(h.find(n=>n.props['data-tour']==='nav-personal'));await h.click(h.find(n=>hasClass(n,'character-card')&&h.text(n).includes('Вега')));}
function assertSection(value,{readonly=false,preserved}={}){
 assert.equal(sectionSelect()?.props.value,value,'The phone selector represents the focused page');
 assert.equal(characterTabs()?.props.value,value,'Desktop and phone navigation represent the same page');
 assert.equal(h.find(n=>n.props['data-record-view']===value)?.props['data-record-view'],value);
 assert.equal(h.nodes().filter(n=>n.type==='harness-tab-content').length,1,'Only the selected section is visible');
 assert.equal(!!h.find(n=>hasClass(n,'nc-dossier-heading')),value==='sheet','The full portrait/identity block appears only on the main profile');
 assert.equal(!!h.find(n=>n.props['aria-label']==='Основные показатели досье'),value==='sheet','The stat rail appears only on the main profile');
 if(value!=='sheet')assert(!h.find(n=>hasClass(n,'nc-portrait-card')),'Focused sections contain no large portrait');
 if(readonly){assert(!savebar());assert(!editSheet());assert(!h.find(n=>n.props['data-tour']==='sheet-save'));}
 if(preserved){assert.deepEqual(draft(),preserved,'Changing sections preserves the entire current sheet draft');assert(savebar(),'The same global draft footer remains available');}
 assert(!h.find(n=>n.type==='harness-AlertDialog'),'Section navigation never asks to discard the sheet draft');
}
async function selectSection(value,options={}){
 const before=scrolls.length;await change(sectionSelect(),value);assertSection(value,options);
 assert(scrolls.length>before,'Phone section changes request a reset to the section top');assert.equal(scrolls.at(-1).top,0);
}
async function linkTo(value,options={}){
 const links=h.find(n=>n.props['aria-label']==='Открыть раздел персонажа');assert(links);
 const labels={items:'Все вещи',worn:'Экипировка',implants:'Импланты',skills:'Навыки',notes:'Заметки',history:'История сохранений'};
 const button=h.nodes(links).find(n=>n.type==='button'&&h.nodes(n).some(child=>child.type==='strong'&&h.text(child).trim()===labels[value]));assert(button);
 const before=scrolls.length;await h.click(button);assertSection(value,options);assert(scrolls.length>before);assert.equal(scrolls.at(-1).top,0);
}
async function returnProfile(options={}){const before=scrolls.length;await h.click('К досье');assertSection('sheet',options);assert(scrolls.length>before);assert.equal(scrolls.at(-1).top,0);}
async function closeEditor(){assert(editSheet());editSheet().props.onOpenChange(false);h.render();await h.flush();}
function inventoryNames(){return h.nodes().filter(n=>n.type==='article'&&hasClass(n,'inventory-item')).map(n=>h.text(h.nodes(n).find(v=>v.type==='strong')).trim()).sort();}

await openOwn();assertSection('sheet');assert(!savebar());
assert.deepEqual(h.nodes(sectionSelect()).filter(n=>n.type==='option').map(n=>[n.props.value,h.text(n).trim()]),Object.entries(selectors),'The phone menu exposes seven clearly named sections');
await h.click('Настроить портрет · Вега');
const zoom=h.find(n=>n.type==='input'&&n.props.type==='range'&&n.props.id.endsWith('-zoom'));await change(zoom,'160');
await h.click('Применить к листу');assert.equal(draft().appearance.portraitFrame.zoom,160);assert(savebar());
await linkTo('notes');
await change(field('Задания, контакты и находки'),'Новый личный черновик');
await change(field('Близкие, враги, долги и цели'),'Новая предыстория');
await selectSection('items');assert.deepEqual(inventoryNames(),own.data.items.map(i=>i.name).sort(),'Inventory includes every ordinary/cyber item');
await h.click('Экипировать Патроны Веги');
const preserved=clone(draft());assert.equal(preserved.notes,'Новый личный черновик');assert.equal(preserved.background,'Новая предыстория');assert.equal(preserved.items.find(i=>i.id==='ammo').equipped,true);
await change(h.find(n=>n.props['aria-label']==='Описание сохранения'),'Черновик после сцены');
for(const section of Object.keys(selectors))await selectSection(section,{preserved});
for(const section of Object.keys(selectors).filter(value=>value!=='sheet')){
 await selectSection('sheet',{preserved});await linkTo(section,{preserved});await returnProfile({preserved});
}
assert.equal(h.find(n=>n.props['aria-label']==='Описание сохранения').props.value,'Черновик после сцены','The global save comment survives every section change');
// Exercise the desktop Tabs callback as well as the phone select.
const desktopBefore=scrolls.length;characterTabs().props.onValueChange('worn');h.render();await h.flush();assertSection('worn',{preserved});assert.equal(scrolls.length,desktopBefore+1);assert.equal(scrolls.at(-1).top,0);
const wardrobe=h.find(n=>hasClass(n,'equipment-map'));assert(wardrobe,'The integration uses the actual PaperDoll');
assert.match(h.text(wardrobe),/Куртка Веги/);assert.match(h.text(wardrobe),/Пистолет Веги/);assert.match(h.text(wardrobe),/Патроны Веги/);
assert(!/Киберглаз Веги|Запасная киберрука|Старый имплант/.test(h.text(wardrobe)),'Worn ordinary items exclude cyber items even when their raw slot is eyes/hands');
await h.click(h.nodes(wardrobe).find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Импланты:')));assertSection('implants',{preserved});
assert.deepEqual(inventoryNames(),['Киберглаз Веги','Запасная киберрука','Старый имплант'].sort(),'The implant page includes cyber raw body slots and legacy implant slots, installed or spare');
await h.click('Добавить имплант');
const catalog=h.find(n=>n.type==='harness-external'&&typeof n.props.select==='function');assert(catalog);assert.equal(catalog.props.category,'cyber');assert.equal(catalog.props.slot,undefined,'The implant catalogue covers the whole cyber category rather than only slot implant');
await closeEditor();assertSection('implants',{preserved});
await h.click('К досье');await linkTo('skills',{preserved});
const localIPHelp=h.find(n=>n.type==='details'&&hasClass(n,'nc-skill-ip-help'));assert(localIPHelp,'IP help stays inside the skill page, preserving the draft');
assert.deepEqual(draft(),preserved);assert.equal(calls.filter(n=>n.method!=='GET').length,0);
h.dispose();

// A permission-only downgrade must close private history, including its old GET.
await openOwn();holdHistory=true;await selectSection('history');assert(pendingHistory,'The actual history read is pending');
ownCurrent={...clone(own),owner_id:3,owner:'Друг',can_edit:false,access:'shared'};
const sync=h.find(n=>n.type==='harness-network');assert(sync);
await sync.props.onSync();await h.flush();assertSection('sheet',{readonly:true});
assert(!h.nodes(sectionSelect()).some(n=>n.type==='option'&&n.props.value==='history'),'Same id/version permission downgrade removes private history navigation');
const historyCount=calls.filter(n=>n.path==='/api/characters/21/history').length;
pendingHistory(reply([{version:1,reason:'Старая закрытая история',created:100,username:'Друг'}]));await h.flush();
assert(!h.text().includes('Старая закрытая история'),'An earlier history response cannot expose private data after downgrade');
await change(sectionSelect(),'history');assertSection('sheet',{readonly:true});assert.equal(calls.filter(n=>n.path==='/api/characters/21/history').length,historyCount);
h.dispose();ownCurrent=own;holdHistory=false;

// Actual resolved-action links read a fresh sheet and return to its same scene.
const returned=[];env.window.addEventListener('nightcity-return-to-scene',event=>returned.push(event.detail));
await mount();await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));await h.click(campaign.name);
await h.click(h.find(n=>n.props['data-campaign-shortcut']==='legacy-scene'));
assert(h.find(n=>n.props['data-action-id']===action.id),'The real terminal renders the confirmed action');
await h.click('Патроны и вещи');assertSection('items');assert(!editSheet());assert(!savebar());
assert.match(h.text(h.find(n=>n.props['aria-label']==='Учёт последствий действия')),new RegExp(scene.name));
assert.equal(draft().wounds,own.data.wounds,'Target damage is never automatically copied to actor wounds');
await h.click('Назад к сцене');assert(!sectionSelect());assert.equal(returned.at(-1).sceneId,scene.id);assert.equal(returned.at(-1).actionId,action.id);assert.equal(returned.at(-1).campaignId,campaign.id);
assert(h.find(n=>n.props['data-action-id']===action.id&&hasClass(n,'returned-action')),'Returning selects the same resolved action in the same scene');
await h.click('Ранения и состояние');assert.equal(sectionSelect()?.props.value,'sheet');assert(editSheet(),'The resources result link opens the local state editor');
assert(field('Ранения','input'));await closeEditor();assertSection('sheet');assert(!savebar());
await h.click('Назад к сцене');assert.equal(returned.at(-1).sceneId,scene.id);assert(h.find(n=>n.props['data-action-id']===action.id&&hasClass(n,'returned-action')));h.dispose();

// Shared access uses the same focused pages while retaining server permission checks.
await mount();await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));await h.click(campaign.name);await h.click('Партия');
const row=h.find(n=>hasClass(n,'campaign-roster-row')&&h.text(n).includes('Чужой герой'));assert(row);
await h.click(h.nodes(row).find(n=>n.type==='button'&&h.text(n).trim()==='Лист'));assertSection('sheet',{readonly:true});
assert.deepEqual(h.nodes(sectionSelect()).filter(n=>n.type==='option').map(n=>n.props.value),Object.keys(selectors).filter(value=>value!=='history'));
const noHistory=calls.filter(n=>n.path==='/api/characters/22/history').length;
for(const section of Object.keys(selectors).filter(value=>!['sheet','history'].includes(value))){
 await linkTo(section,{readonly:true});await returnProfile({readonly:true});
}
await selectSection('worn',{readonly:true});
const wornText=h.text(characterTabs());assert.match(wornText,/Куртка Веги/);assert.match(wornText,/Пистолет Веги/);assert(!/Киберглаз Веги|Запасная киберрука|Старый имплант/.test(wornText));
await selectSection('implants',{readonly:true});assert.match(h.text(characterTabs()),/Киберглаз Веги/);assert.match(h.text(characterTabs()),/Запасная киберрука/);assert.match(h.text(characterTabs()),/Старый имплант/);
assert(!h.button('Добавить имплант'));assert(!h.buttons().some(n=>/^(?:Снять|Экипировать) /.test(n.props['aria-label']||'')));
await selectSection('notes',{readonly:true});assert.match(h.text(characterTabs()),/Общая запись/);assert(!h.find(n=>n.type==='textarea'));
sharedCurrent={...clone(shared),version:2,data:{...clone(shared.data),notes:'Обновлённая общая запись'}};
env.document.dispatchEvent(new Event('visibilitychange'));await h.flush();assertSection('notes',{readonly:true});assert.match(h.text(characterTabs()),/Обновлённая общая запись/,'Permission refresh retains the focused page and updates permitted data');
await change(sectionSelect(),'history');assertSection('notes',{readonly:true});assert.equal(calls.filter(n=>n.path==='/api/characters/22/history').length,noHistory,'Shared navigation cannot request private history');
const unload=new Event('beforeunload',{cancelable:true});env.window.dispatchEvent(unload);assert(!unload.defaultPrevented,'Readonly navigation and refresh never create unsaved work');
denyShared=true;env.document.dispatchEvent(new Event('visibilitychange'));await h.flush();
assert(!sectionSelect(),'Revoking access closes the shared focused page');assert(!h.text().includes('Обновлённая общая запись'));assert.match(h.text(),/Владелец закрыл доступ/);assert.throws(()=>draft(),/Сначала открой персонажа/);
assert.equal(calls.filter(n=>n.method!=='GET').length,0);h.dispose();
console.log('PASS: actual seven-section character navigation; sheet-only portrait/stat rail; top reset from phone, desktop and profile links; notes/items/portrait/comment draft retention and global save footer; real wardrobe/cyber split and category catalogue; history permission downgrade cancels pending disclosure; resolved-scene items/resources links and same-action return; six shared readonly pages, focused permission refresh and revocation; no API writes. Logical harness only, no browser or device rendering claim.');
