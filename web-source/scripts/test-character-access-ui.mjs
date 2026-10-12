import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

const env=installEnvironment(),h=createHarness();
const {Tracker,CharacterAccess,blank}=await loadModules(h);
assert(CharacterAccess,'Harness must expose actual CharacterAccess');
const clone=value=>structuredClone(value);
const event={preventDefault(){}};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const forms=()=>h.nodes().filter(n=>n.type==='form'&&n.props.className==='campaign-access-row');
const form=id=>forms().find(n=>h.nodes(n).some(v=>v.type==='input'&&v.props.name===`access-${id}`));
const radio=(id,index)=>h.nodes(form(id)).filter(n=>n.type==='input'&&n.props.type==='radio')[index];
const checkbox=(id,index)=>h.nodes(form(id)).filter(n=>n.type==='input'&&n.props.type==='checkbox')[index];
const change=(node,target={})=>{assert(node);node.props.onChange({target});h.render();};

const character={id:21,owner_id:2,owner:'Вега',version:1,updated:100,can_edit:true,data:blank('Вега','Фиксер')};
const campaigns=[
 {campaign_id:10,name:'Кампания А',gm_id:1,status:'active',version:1,mode:'private',player_ids:[],players:[{id:3,username:'Друг А'},{id:4,username:'Друг Б'}]},
 {campaign_id:11,name:'Кампания Б',gm_id:5,status:'reserve',version:3,mode:'party',player_ids:[],players:[{id:3,username:'Друг А'}]},
];
const calls=[],busy=[];let held=deferred();
const accessApi=async(path,method='GET',data)=>{
 calls.push({path,method,data});
 assert.equal(path,'/api/characters/21/access');
 if(method==='GET')return {campaigns:clone(campaigns)};
 assert.equal(method,'PUT');return held.promise;
};
h.mount(CharacterAccess,{character,api:accessApi,onBusyChange:value=>busy.push(value)});await h.flush();
assert.equal(forms().length,2);
assert(radio(10,0).props.checked,'Default private mode loaded from server');
assert(radio(11,1).props.checked,'Party mode loaded independently for second campaign');
change(radio(10,2));change(checkbox(10,1),{checked:true});
change(radio(11,0));
const secondSubmitBeforeRender=form(11).props.onSubmit;
const pending=form(10).props.onSubmit(event);
const callsAfterFirst=calls.length;await secondSubmitBeforeRender(event);
assert.equal(calls.length,callsAfterFirst,'Same-frame stale sibling submit cannot bypass the shared lock');
h.render();await h.flush();
assert.deepEqual(calls.at(-1),{path:'/api/characters/21/access',method:'PUT',data:{campaign_id:10,version:1,mode:'selected',player_ids:[4]}});
assert.deepEqual(busy,[true],'Parent is busy throughout the pending request');
assert(forms().every(f=>h.nodes(f).filter(n=>n.type==='fieldset').every(n=>n.props.disabled)),'All campaign choices lock while save is pending');
const before=calls.length;await form(11).props.onSubmit(event);await h.flush();
assert.equal(calls.length,before,'Direct submit on second campaign is blocked while first save waits');
assert.deepEqual(busy,[true],'Blocked sibling submit cannot unlock parent');
held.reject(new Error('Проверочный сбой'));await pending;await h.flush();
assert.deepEqual(busy,[true,false],'Parent unlocks only after the failed request completes');
assert.match(h.text(form(10)),/Проверочный сбой/);
assert(checkbox(10,1).props.checked,'Chosen recipient remains selected after failure');
held=deferred();const retry=form(10).props.onSubmit(event);h.render();await h.flush();
assert.deepEqual(busy,[true,false,true]);
held.resolve({ok:true,version:2});await retry;await h.flush();
assert.deepEqual(busy,[true,false,true,false]);
assert(radio(10,2).props.checked&&checkbox(10,1).props.checked,'Saved selection is rehydrated after version changes');
assert.match(h.text(form(10)),/Доступ сохранён/);
assert(radio(11,0).props.checked,'First save does not discard the second campaign draft');
h.dispose();

const me={id:2,username:'Вега',role:'player',csrf:'test-token',platform:false};
const shared={id:22,owner_id:3,owner:'Друг А',version:1,updated:100,can_edit:false,can_delete:false,can_history:false,access:'shared',data:blank('Чужой герой','Соло')};
shared.data.notes='Общая заметка';shared.data.skills=[{name:'Handgun',stat:'REF',rank:4,ip:12,multiplier:2}];
const campaign={id:10,name:'Тест доступа',description:'',gm_id:1,gm:'ГМ',version:1,updated:100,is_gm:false,is_member:true,transfer_to:null};
let opened=clone(shared),sheetMode='initial',heldRead;
const exterior=c=>({character_id:c.id,name:c.data.name,appearance:{accent:'rust'},items:[]});
const detail=()=>({...campaign,members:[],roster:[character,shared].map(c=>({character_id:c.id,owner_id:c.owner_id,owner:c.owner,name:c.data.name,role:c.data.role,status:'active',can_open:true,exterior:exterior(c)}))});
globalThis.fetch=async(path,options={})=>{
 assert.equal(options.method||'GET','GET','Reading shared sheets must not mutate API state');
 if(path==='/api/me')return reply(me);
 if(path==='/api/settings')return reply({hints:true,tutorial:true,animations:false});
 if(path==='/api/characters')return reply([character,opened]);
 if(path==='/api/campaigns')return reply([campaign]);
 if(path==='/api/campaigns/10')return reply(detail());
 if(path==='/api/characters/22'){
  if(sheetMode==='hold'){heldRead=deferred();return heldRead.promise;}
  if(sheetMode==='deny')return reply({error:'Доступ закрыт'},404);
  return reply(opened);
 }
 throw new Error(`Unexpected read ${path}`);
};
const nav=key=>h.find(n=>n.props['data-tour']===key);
async function openShared(){
 h.mount(Tracker,{platformAuth:false});await h.flush();
 await h.click(nav('nav-campaigns'));await h.click('Тест доступа');await h.click('Партия');
 const row=h.find(n=>n.props.className==='campaign-roster-row'&&h.text(n).includes('Чужой герой'));
 assert(row,'Shared character is present in actual campaign roster');
 const button=h.nodes(row).find(n=>n.type==='button'&&h.text(n).trim()==='Лист');assert(button);
 await h.click(button);
 assert(h.find(n=>n.props.className==='application-sheet'),'Shared character opens actual readonly root sheet');
 assert.match(h.text(),/Владелец открыл тебе полный лист/);
}
const refresh=async()=>{env.document.dispatchEvent(new Event('visibilitychange'));await h.flush();};
await openShared();
change(h.find(n=>n.type==='select'&&n.props['aria-label']==='Раздел листа персонажа'),{value:'notes'});await h.flush();
opened={...clone(shared),version:2,data:{...clone(shared.data),notes:'Обновлённая заметка'}};
await refresh();assert.match(h.text(),/Обновлённая заметка/,'Permission refresh shows latest permitted data');
assert(!h.find(n=>n.props.className?.split(/\s+/).includes('savebar')),'Shared full sheet exposes no editing or saving controls');
const unload=new Event('beforeunload',{cancelable:true});env.window.dispatchEvent(unload);
assert(!unload.defaultPrevented,'A refreshed readonly sheet is never considered an unsaved draft');
await h.click('К кампании');
assert(!h.find(n=>n.props.className==='application-sheet'),'Leaving updated readonly sheet completes directly');
assert(!h.text().includes('Выйти без сохранения?'),'Readonly refresh cannot cause unsaved-changes prompt');
h.dispose();

sheetMode='initial';await openShared();
sheetMode='hold';await refresh();assert(heldRead,'First permission read is held');
const oldRead=heldRead;
sheetMode='deny';await refresh();
assert(!h.find(n=>n.props.className==='application-sheet'),'New permission denial closes opened full sheet');
assert.match(h.text(),/Владелец закрыл доступ/);
oldRead.resolve(reply({...clone(shared),data:{...clone(shared.data),notes:'Старый ответ с закрытыми данными'}}));await h.flush();
assert(!h.find(n=>n.props.className==='application-sheet'),'Late old 200 cannot reopen sheet after newer denial');
assert(!h.text().includes('Старый ответ с закрытыми данными'));
h.dispose();

// Direct portrait editing preserves newer card controls while its image decode is asynchronous.
let decoding;const priorImage=globalThis.Image,priorCreate=env.document.createElement;
globalThis.Image=class {naturalWidth=400;naturalHeight=600;decode(){decoding=deferred();return decoding.promise;}};
env.document.createElement=tag=>tag==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/AA'}:priorCreate(tag);
sheetMode='initial';h.mount(Tracker,{platformAuth:false});await h.flush();
await h.click(nav('nav-personal'));
await h.click(h.find(n=>n.props.className==='character-card'&&h.text(n).includes('Вега')));
await h.click('Добавить портрет · Вега');
const picker=h.find(n=>n.type==='input'&&n.props.type==='file');assert(picker);
picker.props.onChange({target:{files:[new Blob(['test image'],{type:'image/png'})],value:'portrait.png'}});h.render();await h.flush();
assert(decoding,'Image picker waits for its actual decode step');
const heightInput=()=>h.find(n=>n.type==='input'&&n.props.type==='range'&&n.props.id.endsWith('-height'));
change(heightInput(),{value:'420'});
const accent=h.find(n=>n.type==='input'&&n.props.type==='radio'&&n.props.value==='blue');accent.props.onChange();h.render();
decoding.resolve();await h.flush();
assert.equal(heightInput().props.value,420,'Late portrait decode cannot revert framing edited during upload');
assert(h.find(n=>n.type==='input'&&n.props.type==='radio'&&n.props.value==='blue').props.checked,'Late portrait decode preserves the latest card color');
assert(h.find(n=>n.type==='img'&&n.props.alt==='Портрет · Вега'),'Decoded portrait is added to the same appearance draft');
h.dispose();globalThis.Image=priorImage;env.document.createElement=priorCreate;
console.log('PASS: actual CharacterAccess loads per-campaign policy; exact selected payload; shared save lock and failed-save recovery; focused readonly notes refresh stays clean; revocation closes full sheet; older pending 200 cannot reopen revoked sheet; asynchronous direct portrait decode preserves newer card edits.');
