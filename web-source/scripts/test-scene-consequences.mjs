import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

installEnvironment();
const h=createHarness();
const {Tracker,blank}=await loadModules(h);
const calls=[];
const me={id:2,username:'Adam',role:'player',csrf:'test-token',platform:true};
const campaign={id:10,name:'Склад у доков',description:'Проверка последствий',gm_id:1,gm:'ГМ',version:9,updated:100,is_gm:false,is_member:true,transfer_to:null};
const cached={id:21,owner_id:2,owner:'Adam',version:1,updated:100,data:blank('Вега','Соло'),can_edit:true,can_delete:true};
cached.data.wounds=0;
cached.data.items=[{id:'rounds',name:'Патроны 9 мм',category:'ammo',quantity:10,weight:0,equipped:false,description:'',slot:'bag',icon:'ammo',armor:null,modifiers:[],source:''}];
let persisted={...structuredClone(cached),version:7,updated:700};
persisted.data.wounds=3;
persisted.data.condition='Состояние из свежего листа';
persisted.data.items[0].quantity=8;
let listReadFresh=false;
const result='Охранник получил попадание, но ГМ отдельно определяет последствия для действовавшего героя. '.repeat(4);
const action={id:'action-1',characterId:21,targetId:'guard',kind:'attack',description:'Вега стреляет в охранника.',tool:'Пистолет',roll:18,damage:15,status:'resolved',result,created:100,resolvedAt:101};
const snapshot=()=>({version:4,updated:101,is_gm:false,characters:[{id:21,owner_id:2,name:'Вега',role:'Соло',status:'active'}],data:{schemaVersion:1,contacts:[],messages:[],places:[],assets:[],scene:{id:'scene-1',name:'Склад у доков',active:true,targets:[{id:'guard',name:'Охранник',kind:'person',description:'Стоит у входа',visible:true}],actions:[structuredClone(action)],log:[{id:'action-1',targetId:'guard',text:'Вега → Охранник: '+result,created:101}]}}});
const detail=()=>({...campaign,roster:[{character_id:21,owner_id:2,owner:'Adam',name:'Вега',role:'Соло',status:'active',can_open:true}]});
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
let holdRead=false,releaseRead;
globalThis.fetch=async(path,options={})=>{
  const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
  calls.push({path,method,body});
  if(path==='/api/me')return reply(me);
  if(path==='/api/settings')return reply({hints:true,tutorial:true,animations:false});
  if(path==='/api/characters'&&method==='GET')return reply([listReadFresh?persisted:cached]);
  if(path==='/api/characters/21'&&method==='GET'){
    if(holdRead)return new Promise(resolve=>{releaseRead=()=>resolve(reply(persisted));});
    return reply(persisted);
  }
  if(path==='/api/characters/21'&&method==='PUT'){
    if(body.version!==persisted.version)return reply({error:'Версия листа изменилась.'},409);
    if(typeof body.reason!=='string'||body.reason.length>180)return reply({error:'Описание изменения длиннее 180 символов.'},400);
    persisted={...persisted,data:structuredClone(body.data),version:persisted.version+1,updated:800};
    listReadFresh=true;
    return reply({id:21,version:persisted.version,updated:persisted.updated});
  }
  if(path==='/api/campaigns')return reply([campaign]);
  if(path==='/api/campaigns/10')return reply(detail());
  if(path==='/api/campaigns/10/workspace'&&method==='GET')return reply(snapshot());
  throw new Error(`Unexpected fetch: ${method} ${path}`);
};

const nav=anchor=>h.find(node=>node.props['data-tour']===anchor);
const reads=()=>calls.filter(call=>call.path==='/api/characters/21'&&call.method==='GET');
const writes=()=>calls.filter(call=>call.path==='/api/characters/21'&&call.method==='PUT');
function control(label,type){
  const field=h.find(node=>node.props['data-label']===label);
  assert(field,`Missing field: ${label}`);
  const node=h.nodes(field,[],false).find(node=>node.type===type);
  assert(node,`Missing ${type} in field: ${label}`);
  return node;
}
async function change(node,value){
  node.props.onChange({target:{value,valueAsNumber:Number(value)}});
  h.render();await h.flush();
}
async function openScene(){
  h.mount(Tracker,{platformAuth:false});await h.flush();
  await h.click(nav('nav-campaigns'));
  await h.click(campaign.name);
  await h.click(h.find(node=>node.props['data-campaign-shortcut']==='legacy-scene'));
  assert(h.find(node=>node.props['data-action-id']==='action-1'),'Actual terminal resolved card is mounted');
}
function resourceForm(){return h.find(node=>node.type==='form'&&h.nodes(node,[],false).some(child=>child.props['data-label']==='Ранения'));}

// Actual root + hub + terminal: resolved card opens a fresh character, never the list cache.
await openScene();
assert.equal(reads().length,0);
assert.equal(writes().length,0);
await h.click('Ранения и состояние');
assert.equal(reads().length,1,'Aftermath navigation reads current server sheet');
assert(h.find(node=>node.props['aria-label']==='Учёт последствий действия'),'Root retains action context');
assert.equal(control('Ранения','input').props.value,3,'Editor uses fresh wounds, not cached zero or outgoing target damage 15');
assert.equal(control('Травмы, лечение и временные эффекты','textarea').props.value,'Состояние из свежего листа');
assert(h.text().includes('Урон цели из заявки не добавляется к ранениям действовавшего героя.'));
assert.equal(writes().length,0,'Opening consequences performs no character mutation');
assert.equal(persisted.data.items[0].quantity,8,'Opening does not automatically consume ammo');

// Apply only changes the local draft; explicit Save submits the fresh version.
await change(control('Ранения','input'),'5');
await change(control('Травмы, лечение и временные эффекты','textarea'),'ГМ назначил отдельную травму герою.');
const form=resourceForm();assert(form,'Actual ResourcesEditor form is rendered');
await form.props.onSubmit({preventDefault(){}});h.render();await h.flush();
assert.equal(writes().length,0,'Apply does not PUT');
assert.equal(persisted.data.wounds,3,'Server unchanged until explicit Save');
assert(h.text().includes('Изменения ещё не сохранены'));
await h.click('Сохранить лист');
assert.equal(writes().length,1);
assert.equal(writes()[0].body.version,7,'Uses version from fresh GET');
assert.equal(writes()[0].body.data.wounds,5,'Only user-entered consequences are saved');
assert.equal(writes()[0].body.data.condition,'ГМ назначил отдельную травму герою.');
assert.equal(writes()[0].body.data.items[0].quantity,8,'Saving wounds leaves ammo unchanged');
assert(writes()[0].body.reason.startsWith('После действия в сцене «Склад у доков»:'),'Save history identifies scene context');
assert(writes()[0].body.reason.length<=180,'Long action result must fit API reason limit');
assert.equal(persisted.version,8,'Actual explicit Save succeeded');

await h.click('Назад к сцене');
assert(!h.find(node=>node.props['aria-label']==='Учёт последствий действия'),'Character panel closed after return');
const returned=h.find(node=>node.props['data-action-id']==='action-1');
assert(returned&&returned.props.className.includes('returned-action'),'Returns to same resolved action in preserved scene');
assert(h.text().includes('Сцена открыта'));
assert.equal(snapshot().data.scene.id,'scene-1');
assert.equal(snapshot().data.scene.actions[0].status,'resolved','Manual sheet update does not rewrite scene result');

// Alternative destination opens the real inventory section, still without auto-applying quantities.
await h.click('Патроны и вещи');
assert.equal(reads().length,2);
assert(h.find(node=>node.props.id==='inventory'),'Items destination opens real inventory tab');
assert.equal(writes().length,1);
assert.equal(persisted.data.items[0].quantity,8);
await h.click('Назад к сцене');

// An unfinished terminal action prevents entering consequences, preserving its draft.
await change(control('Что ты хочешь сделать','textarea'),'Неотправленное намерение: проверить дверь.');
const beforeDirtyRead=reads().length;
await h.click('Ранения и состояние');
assert.equal(reads().length,beforeDirtyRead,'Dirty terminal refuses sheet GET');
assert(!h.find(node=>node.props['aria-label']==='Учёт последствий действия'),'Dirty terminal does not navigate away');
assert.equal(control('Что ты хочешь сделать','textarea').props.value,'Неотправленное намерение: проверить дверь.');
assert(h.text().includes('Сначала сохрани или отбрось черновики в терминале.'));
h.dispose();

// Late aftermath GET cannot reopen a sheet after a later main navigation.
await openScene();
holdRead=true;
await h.click('Ранения и состояние');
assert(releaseRead,'Fresh consequence GET is pending');
const tutorial=h.find(node=>node.type==='harness-tutorial');
assert.equal(tutorial.props.busy,false,'Sheet GET does not block its own opening as a mutation');
await h.click(nav('nav-learning'));
assert(h.find(node=>node.type==='harness-learning'));
releaseRead();holdRead=false;await h.flush();
assert(h.find(node=>node.type==='harness-learning'),'Late aftermath GET respects navigation revision');
assert(!h.find(node=>node.props['aria-label']==='Учёт последствий действия'));
assert.equal(writes().length,1);
h.dispose();

// An undo during the pending sheet read cancels the old result's instructions.
await openScene();
holdRead=true;await h.click('Ранения и состояние');assert(releaseRead);
action.status='approved';action.result='';action.resolvedAt=null;
releaseRead();holdRead=false;await h.flush();await h.flush();
assert(!h.find(node=>node.props['aria-label']==='Учёт последствий действия'),'Undone result does not open aftermath sheet');
assert(h.text().includes('Сцена, результат или доступ к персонажу изменились.'));
assert(h.text().includes('Разрешено · можно бросать'),'Terminal refreshes the action after undo');
assert.equal(writes().length,1,'Stale result causes no sheet mutation');
h.dispose();

console.log('PASS: actual root/hub/terminal resolved action → fresh sheet GET → Resources Apply draft → explicit versioned Save → same-scene return; outgoing target damage is not actor wounds; items open without automatic ammo changes; dirty terminal refuses sheet; long save reason fits API; late consequence GET cannot override later navigation.');
