import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

const env=installEnvironment(),h=createHarness();
const {Tracker,CampaignHub,CampaignTerminal,blank}=await loadModules(h);
const calls=[];
const me={id:2,username:'Adam',role:'player',csrf:'test-token',platform:true};
let characters=[];let rosterStatus='active';
const character=id=>({id,owner_id:2,owner:'Adam',version:1,updated:100,data:blank(id===21?'Вега':'Новичок','Фиксер'),can_edit:true});
const campaign={id:10,name:'Тестовая кампания',description:'Учебный сервер',gm_id:1,gm:'ГМ',version:1,updated:100,is_gm:false,is_member:true,transfer_to:null};
const detail=()=>({...campaign,roster:characters.map(c=>({character_id:c.id,owner_id:c.owner_id,owner:c.owner,name:c.data.name,role:c.data.role,status:rosterStatus,can_open:true}))});
const snapshot=()=>({version:1,updated:100,is_gm:false,characters:characters.map(c=>({id:c.id,name:c.data.name,role:c.data.role,owner_id:c.owner_id,status:'active'})),data:{schemaVersion:1,contacts:[{id:'mara',name:'Мара',phone:'555-0100',description:'Фиксер',notes:'',recipients:characters.map(c=>c.id)}],messages:[],places:[],assets:[],scene:{id:'scene-1',name:'Склад',active:true,targets:[{id:'guard',name:'Охранник',kind:'person',description:'У двери',visible:true}],actions:[],log:[]}}});
const reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
let heldCharacterRead;
let holdCharacter=false;
let heldMessageWrite;
let holdMessage=false;
globalThis.fetch=async(path,options={})=>{
 const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
 if(path==='/api/me')return reply(me);
 if(path==='/api/settings')return reply({hints:true,tutorial:true,animations:false});
 if(path==='/api/characters'&&method==='GET')return reply(characters);
 if(path==='/api/characters'&&method==='POST'){const created={...character(21),data:body.data};characters.push(created);return reply({id:21,version:1});}
 if(path==='/api/characters/21'){if(holdCharacter)return new Promise(resolve=>{heldCharacterRead=()=>resolve(reply(characters[0]));});return reply(characters.find(c=>c.id===21));}
 if(path==='/api/campaigns')return reply([campaign]);
 if(path==='/api/campaigns/10')return reply(detail());
 if(path==='/api/campaigns/10/workspace'){if(method==='POST'&&holdMessage)return new Promise(resolve=>{heldMessageWrite=()=>resolve(reply({version:1}));});return reply(snapshot());}
 if(path==='/api/campaigns/join')return reply({id:10,name:campaign.name});
 throw new Error(`Unexpected fetch: ${method} ${path}`);
};

function control(label,type){const field=h.find(node=>node.props['data-label']===label);assert(field,`Missing field ${label}`);return h.nodes(field,[],false).find(node=>node.type===type);}
async function change(node,value){assert(node);node.props.onChange({target:{value}});h.render();await h.flush();}
const nav=anchor=>h.find(node=>node.props['data-tour']===anchor);
const tutorial=()=>h.find(node=>node.type==='harness-tutorial');

// The actual root, actual campaign hub and actual terminal are mounted together.
h.mount(Tracker,{platformAuth:false});await h.flush();
assert(nav('nav-personal')&&nav('nav-campaigns')&&nav('nav-learning'));
assert(h.text().includes('Главное меню'));await h.click(nav('nav-personal'));assert(nav('nav-personal').props['aria-current']==='page');
assert(!h.buttons().some(node=>/^(?:ГМ|Игрок|GM|Player)$/.test(h.text(node).trim())), 'No mid-game account role toggle');
await h.click(nav('nav-learning'));assert(h.find(node=>node.type==='harness-learning'));
await h.click(nav('nav-campaigns'));assert(h.text().includes('Роль и доступ указаны у каждой папки'));
await h.click('Ввести код');
await change(control('Пригласительный код','input'),'KEEP-MY-CODE');
await h.click('Создать персонажа');
const creation=h.find(node=>node.type==='harness-creation');assert(creation);
await creation.props.submit(blank('Вега','Фиксер'));await h.flush();
assert.equal(control('Пригласительный код','input').props.value,'KEEP-MY-CODE','Join code survives creation dialog');
assert.equal(control('Твой персонаж','select').props.value,'21','New own character is preselected');
assert(!h.find(node=>node.type==='harness-creation'),'Creation dialog closed');
assert(!h.find(node=>node.props.className?.split(' ').includes('character-heading')),'Join-origin creation does not open the sheet');
const joinForm=h.find(node=>node.type==='form'&&h.text(node).includes('Заявка по коду'));
await joinForm.props.onSubmit({preventDefault(){}});await h.flush();
assert(calls.some(call=>call.path==='/api/campaigns/join'&&call.body.code==='KEEP-MY-CODE'&&call.body.character_id===21));
assert(h.text().includes('Твоя игра'));
// openSheet uses a GET busy state separate from campaign mutations, so root open() is allowed.
holdCharacter=true;
const sheet=h.find(node=>node.props['data-campaign-character']===21);assert(sheet);
sheet.props.onClick();h.render();await h.flush();
assert(heldCharacterRead,'Fresh sheet access is read from server');
assert.equal(tutorial().props.busy,false,'Read-only sheet GET does not trip global mutation busy guard');
// A later main navigation invalidates the read rather than reopening a sheet over a lesson.
await h.click(nav('nav-learning'));assert(h.find(node=>node.type==='harness-learning'));
heldCharacterRead();holdCharacter=false;await h.flush();
assert(h.find(node=>node.type==='harness-learning'),'Late read leaves the selected lesson open');
assert(!h.find(node=>node.props.className?.split(' ').includes('character-heading')),'Late read cannot reopen a sheet');
await h.click(nav('nav-campaigns'));
holdCharacter=true;h.find(node=>node.props['data-campaign-character']===21).props.onClick();h.render();await h.flush();
heldCharacterRead();holdCharacter=false;await h.flush();
assert(h.find(node=>node.props.className?.split(' ').includes('character-heading')),'Campaign sheet GET opens the real root sheet');
assert(!h.text().includes('Дождись ответа сервера на текущее действие.'),'Root open was not rejected by its own busy guard');
// Dirty character draft blocks tutorial navigation without changing the sheet/workspace.
await h.click('Увеличить ранения на один');
const accepted=tutorial().props.onNavigate('training-net');h.render();await h.flush();
assert.equal(accepted,false);assert(h.find(node=>node.props.className?.split(' ').includes('character-heading')));
assert(!h.find(node=>node.type==='harness-learning'));
h.dispose();

// A terminal mutation is global busy work: main navigation must wait for its acknowledgement.
h.mount(Tracker,{platformAuth:false});await h.flush();
await h.click(nav('nav-campaigns'));await h.click('Тестовая кампания');await h.click(h.find(node=>node.props['data-campaign-shortcut']==='messages'));
await change(control('Ответ от Вега','textarea'),'Сообщение на сервер в процессе.');
holdMessage=true;
const compose=h.find(node=>node.type==='form'&&node.props['data-tour']==='message-compose');assert(compose);
compose.props.onSubmit({preventDefault(){}});h.render();await h.flush();assert(heldMessageWrite);
await h.click(nav('nav-learning'));
assert.equal(nav('nav-campaigns').props['aria-current'],'page','Busy terminal keeps the campaign workspace open');
assert(!h.find(node=>node.type==='harness-learning'));
assert(h.text().includes('Дождись ответа сервера на текущее действие.'));
heldMessageWrite();holdMessage=false;await h.flush();
await h.click(nav('nav-learning'));assert(h.find(node=>node.type==='harness-learning'));
h.dispose();

// A guide may open a pending folder from the index; it must keep an explanatory overview.
rosterStatus='pending';campaign.is_member=false;
h.mount(Tracker,{platformAuth:false});await h.flush();await h.flush();
const workspaceReadsBefore=calls.filter(call=>call.path==='/api/campaigns/10/workspace').length;
assert.equal(tutorial().props.onNavigate('campaign-play'),true);h.render();await h.flush();
assert(h.text().includes('Твоя игра'),'Pending campaign falls back to its overview: '+h.text());
assert(h.text().includes('Заявка отправлена.'));
assert(!h.button('Открыть сцену'),'Pending shared-mode folders do not expose a competing legacy scene entry');
assert(h.button('Связь и записи').props.disabled);
assert.equal(calls.filter(call=>call.path==='/api/campaigns/10/workspace').length,workspaceReadsBefore,'Pending campaign does not fetch a denied terminal');
h.dispose();rosterStatus='active';campaign.is_member=true;

// Direct terminal integration: requestedSection changes the view without resetting identity or message draft.
let terminalProps={campaignId:10,me,api:async(path)=>{assert.equal(path,'/api/campaigns/10/workspace');return snapshot();},requestedSection:{section:'messages',revision:1}};
h.mount(CampaignTerminal,terminalProps);await h.flush();
assert(h.text().includes('Контакты и сообщения'));
assert.equal(control('Твой персонаж в этой кампании','select').props.value,'21');
await change(control('Ответ от Вега','textarea'),'Черновик: встретимся у склада.');
terminalProps={...terminalProps,requestedSection:{section:'scene',revision:2}};
h.update(terminalProps);await h.flush();assert(h.text().includes('Сцена открыта'));
assert.equal(control('Твой персонаж в этой кампании','select').props.value,'21');
terminalProps={...terminalProps,requestedSection:{section:'messages',revision:3}};
h.update(terminalProps);await h.flush();
assert.equal(control('Ответ от Вега','textarea').props.value,'Черновик: встретимся у склада.');
assert.equal(control('Твой персонаж в этой кампании','select').props.value,'21');
h.dispose();

// A late read from a previous account cannot publish its contacts or draft into the new account.
let resolveOldRead,readCount=0;
const otherMe={id:3,username:'Brother'},otherSnapshot={...snapshot(),characters:[{id:22,name:'Брат',role:'Соло',owner_id:3,status:'active'}],data:{...snapshot().data,contacts:[{id:'other',name:'Другой контакт',phone:'555-0200',description:'',notes:'',recipients:[22]}]}};
const readApi=async()=>{readCount++;if(readCount===1)return new Promise(resolve=>{resolveOldRead=resolve;});return otherSnapshot;};
h.mount(CampaignTerminal,{campaignId:10,me,api:readApi,requestedSection:{section:'messages',revision:1}});await h.flush();assert(resolveOldRead);
h.update({campaignId:10,me:otherMe,api:readApi,requestedSection:{section:'messages',revision:2}});await h.flush();
assert.equal(control('Твой персонаж в этой кампании','select').props.value,'22');
resolveOldRead(snapshot());await h.flush();
assert.equal(control('Твой персонаж в этой кампании','select').props.value,'22');
assert(h.text().includes('Другой контакт'));
assert(!h.text().includes('Мара'),'Late old-account read does not disclose prior contacts');
h.dispose();

console.log('PASS: actual root/hub/terminal transitions; no role toggle; personal/campaign/learn; join-origin creation preserves code and selects hero; fresh campaign GET opens root sheet; dirty draft denies tutorial navigation; terminal mutation blocks global navigation; terminal section requests preserve message/identity; late previous-account read is ignored.');
