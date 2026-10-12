import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

installEnvironment();
const h=createHarness(),{CampaignTerminal}=await loadModules(h);
const me={id:2,username:'Игрок'},posts=[];
const target=(id,name,kind='person',visible=true)=>({id,name,kind,visible,description:''});
let state={version:1,updated:100,is_gm:true,characters:[{id:21,name:'Вега',owner_id:2,role:'Фиксер',status:'active'}],data:{contacts:[],messages:[],places:[],assets:[],scene:{id:'scene-1',name:'Склад',active:false,targets:[target('guard','Охранник','person',false)],actions:[],log:[]}}};
let dirty=false;
const api=async(path,method='GET',data)=>{
 assert.equal(path,'/api/campaigns/10/workspace');
 if(method==='POST'){
  posts.push(structuredClone(data));assert.equal(data.version,state.version);
  assert.equal(data.command,'scene.save');Object.assign(state.data.scene,{name:data.name,active:data.active,targets:structuredClone(data.targets)});state.version++;
  return {version:state.version};
 }
 return structuredClone(state);
};
function field(label,type){const node=h.find(n=>n.props['data-label']===label);assert(node,`Missing field ${label}`);return h.nodes(node).find(n=>n.type===type);}
async function change(node,value){node.props.onChange({target:{value,valueAsNumber:Number(value)}});h.render();await h.flush();}
const props=()=>({campaignId:10,me,api,onDirtyChange:value=>{dirty=value;}});
const refresh=()=>h.click('Обновить терминал');

// Preparing and opening have distinct effects, with explicit visibility and readiness.
h.mount(CampaignTerminal,props());await h.flush();await h.click('Подготовить сцену');
assert.equal(h.button('Сохранить и открыть сцену').props.disabled,true);
assert(h.text().includes('видны группе при любом сохранении'));
await h.click('Сохранить подготовку');assert.equal(posts.at(-1).active,false);
assert(h.text().includes('Приём новых действий закрыт'));
await h.click('Подготовить сцену');
const visible=h.find(n=>n.type==='input'&&n.props.type==='checkbox');assert(visible);
visible.props.onChange({target:{checked:true}});h.render();await h.flush();
const count=posts.length;await h.click('Сохранить и открыть сцену');
assert.equal(posts.length,count,'Opening waits for confirmation');
assert(h.text().includes('Открытые цели: Охранник'));
await h.click('Подтвердить');assert.equal(posts.at(-1).active,true);
assert(h.text().includes('Сцена открыта'));h.dispose();

// A target never silently rewrites a deliberately selected action kind.
state.is_gm=false;state.data.scene.targets.push(target('ice','Firewall','program'));
h.mount(CampaignTerminal,props());await h.flush();
await change(field('Тип действия','select'),'attack');
await h.click('Firewall');assert.equal(field('Тип действия','select').props.value,'attack');
await change(field('Цель','select'),'guard');assert.equal(field('Тип действия','select').props.value,'attack');
await change(field('Что ты хочешь сделать','textarea'),'Стреляю по замку.');
state.data.scene.active=false;state.version++;await refresh();
assert(h.find(n=>n.props.className==='terminal-detached-drafts'),'Closed scene exposes the held draft');
assert.equal(dirty,true);assert(!h.find(n=>n.props['data-tour']==='scene-action'));
state.data.scene.active=true;state.version++;await refresh();
assert.equal(field('Что ты хочешь сделать','textarea').props.value,'Стреляю по замку.','Reopening preserves the unsubmitted intention');
h.dispose();

// Pending actions cannot accept dice; external resolution retains unsaved dice explicitly.
const action={id:'act-1',characterId:21,targetId:'guard',kind:'attack',description:'Стреляю',tool:'Пистолет',roll:null,damage:null,status:'submitted',result:'',created:100,resolvedAt:null};
state.data.scene.actions=[action];state.version++;
h.mount(CampaignTerminal,props());await h.flush();
assert(h.text().includes('Ждём разрешения ГМ'));assert(!h.find(n=>n.props.className==='terminal-roll-editor'));
action.status='approved';state.version++;await refresh();
assert(h.find(n=>n.props.className==='terminal-roll-editor'));
await change(field('Итог проверки','input'),'17');assert.equal(dirty,true);
action.status='resolved';action.result='Попадание';action.resolvedAt=101;state.version++;await refresh();
assert(!h.find(n=>n.props.className==='terminal-roll-editor'));
assert.match(h.text(),/Броски для недоступных действий:\s*1/);assert.equal(dirty,true);
await h.click('Отбросить недоступные черновики');assert.equal(dirty,true,'Draft remains until explicit confirmation');
await h.click('Подтвердить');assert.equal(dirty,false);assert(!h.find(n=>n.props.className==='terminal-detached-drafts'));
h.dispose();

// Spaces alone are not a meaningful GM draft after another device finishes the action.
state.is_gm=true;action.status='approved';action.result='';state.version++;
h.mount(CampaignTerminal,props());await h.flush();
await change(field('Описание результата / ответ игроку','textarea'),'   ');
assert.equal(dirty,false);
action.status='resolved';action.result='Готово';state.version++;await refresh();
assert.equal(dirty,false);assert(!h.find(n=>n.props.className==='terminal-detached-drafts'));
h.dispose();
console.log('PASS: scene preparation/opening, visibility and readiness; consistent target selection; closed-scene drafts survive; dice wait for approval; stale dice require explicit discard.');
