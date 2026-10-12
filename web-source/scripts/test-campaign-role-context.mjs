import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

installEnvironment();
const h=createHarness(),{Tracker,blank}=await loadModules(h);
const user={id:2,username:'Вега',role:'player',csrf:'test',platform:false};
const own={id:21,owner_id:2,owner:'Вега',version:1,updated:100,data:blank('Вега','Фиксер'),can_edit:true};
const base={description:'',gm_id:1,gm:'Ведущий',version:1,updated:100,transfer_to:null};
let cases=[],releaseWorkspace=null;
const requests=[];
const reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(path,options={})=>{
 const method=options.method||'GET';requests.push({path,method});
 assert.equal(method,'GET','Presentation, navigation and role labels cannot grant rights through a mutation');
 if(path==='/api/me')return reply(user);
 if(path==='/api/settings')return reply({hints:true,tutorial:true,animations:false});
 if(path==='/api/characters')return reply([own]);
 if(path==='/api/campaigns')return reply(cases.map(c=>({...base,...c})));
 const match=String(path).match(/^\/api\/campaigns\/(\d+)(\/workspace)?$/);
 assert(match,`Unexpected fetch ${path}`);
 const c=cases.find(c=>c.id===Number(match[1]));assert(c,`Unknown campaign ${path}`);
 const status=c.reserve?'reserve':'active';
 const character=c.accepted?{id:21,name:'Вега',role:'Фиксер',owner_id:2,status}:null;
 if(match[2]){
  const workspace={version:1,updated:100,is_gm:c.is_gm,characters:character?[character]:[],data:{contacts:[],messages:[],places:[],assets:[],scene:{id:'scene1',name:'Подготовка',active:false,targets:[],actions:[],log:[]}}};
  if(c.deferWorkspace)return new Promise(resolve=>{releaseWorkspace=()=>resolve(reply(workspace));});
  return reply(workspace);
 }
 return reply({...base,...c,members:[],roster:character?[{character_id:21,name:'Вега',role:'Фиксер',owner_id:2,owner:'Вега',status,can_open:true}]:[]});
};
const roleBanner=()=>h.find(n=>n.props['aria-label']==='Твоя роль в кампании');
const nav=()=>h.find(n=>n.props['aria-label']==='Разделы кампании');
const navButton=label=>h.nodes(nav()).find(n=>n.type==='button'&&h.text(n).replace(/\s+/g,' ').trim()===label);
const terminal=()=>h.find(n=>n.props.className==='campaign-terminal');
async function open(config){
 cases=[{id:10,name:'Кампания ролей',...config}];
 h.mount(Tracker,{platformAuth:false});await h.flush();
 await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));
 await h.click('Кампания ролей');
 assert(roleBanner(),'The actual visible campaign banner identifies the current role');
}

try{
 await open({is_gm:true,is_member:true,accepted:false,deferWorkspace:true});
 assert.equal(roleBanner().props['data-campaign-role'],'gm');
 assert(h.text(roleBanner()).includes('Ты — ГМ'));
 assert(navButton('Записи'));assert(navButton('Настройки'));
 await h.click(navButton('Записи'));
 assert(h.find(n=>n.props['data-label']==='Заметки ведущего'),'GM notes are available through the actual navigation');
 await h.click(navButton('Настройки'));
 assert(h.find(n=>n.props['data-tour']==='campaign-invite'),'Invite management is available to this campaign GM');
 await h.click(navButton('Связь и записи'));
 assert.equal(terminal().props['data-terminal-role'],'loading');
 assert(!h.text(terminal()).includes('ИГРОК / МОЙ ТЕРМИНАЛ'),'An unresolved workspace never briefly labels a GM as a player');
 assert.equal(roleBanner().props['data-campaign-role'],'gm','The known campaign role remains stable during terminal loading');
 assert(releaseWorkspace);releaseWorkspace();await h.flush();
 assert.equal(terminal().props['data-terminal-role'],'gm');
 assert(h.text(terminal()).includes('ГМ / ПАНЕЛЬ ВЕДУЩЕГО'));
 assert(!h.button('Подготовить сцену'),'Shared mode opens messages rather than a competing legacy battlefield');
 await h.click(h.find(n=>n.props['data-terminal-secondary']==='scene'));
 assert(h.button('Подготовить сцену'),'Legacy preparation remains accessible through the secondary entry');
 h.dispose();

 for(const reserve of [false,true]){
  await open({is_gm:false,is_member:true,accepted:true,reserve});
  assert.equal(roleBanner().props['data-campaign-role'],'player');
  assert(h.text(roleBanner()).includes('Ты — игрок'));
  assert(!navButton('Записи'));assert(!navButton('Настройки'));
  assert.equal(navButton('Связь и записи').props.disabled,false);
  await h.click(navButton('Связь и записи'));
  assert.equal(terminal().props['data-terminal-role'],'player');
  assert(h.text(terminal()).includes('ИГРОК / МОЙ ТЕРМИНАЛ'));
  assert(!h.button('Подготовить сцену'));
  h.dispose();
 }

 await open({is_gm:false,is_member:false,accepted:false});
 assert.equal(roleBanner().props['data-campaign-role'],'pending');
 assert(h.text(roleBanner()).includes('Заявка на рассмотрении'));
 assert.equal(navButton('Связь и записи').props.disabled,true);
 assert(!navButton('Записи'));assert(!navButton('Настройки'));
 h.dispose();

 await open({is_gm:false,is_member:true,accepted:false});
 assert.equal(roleBanner().props['data-campaign-role'],'member');
 assert(h.text(roleBanner()).includes('Участник без героя'));
 assert.equal(navButton('Связь и записи').props.disabled,true);
 assert(!navButton('Записи'));assert(!navButton('Настройки'));
 h.dispose();

 // One account can be GM in one campaign and a player in another; opening a folder never changes its rights.
 cases=[{id:10,name:'Веду эту игру',is_gm:true,is_member:true,accepted:false},{id:11,name:'Играю эту игру',is_gm:false,is_member:true,accepted:true}];
 h.mount(Tracker,{platformAuth:false});await h.flush();
 await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));
 await h.click('Веду эту игру');assert.equal(roleBanner().props['data-campaign-role'],'gm');
 await h.click('Все кампании');await h.click('Играю эту игру');
 assert.equal(roleBanner().props['data-campaign-role'],'player');assert(!navButton('Записи'));
 await h.click(navButton('Связь и записи'));assert.equal(terminal().props['data-terminal-role'],'player');
 await h.click('Все кампании');await h.click('Веду эту игру');
 assert.equal(roleBanner().props['data-campaign-role'],'gm');assert(navButton('Записи'));
 await h.click(navButton('Связь и записи'));assert.equal(terminal().props['data-terminal-role'],'gm');
 assert(requests.every(r=>r.method==='GET'));
 console.log('PASS: visible GM/player/reserve/pending/member campaign banners, real notes/invite/table navigation and per-campaign rights remain stable; presentation never writes roles.');
}finally{h.dispose();}
