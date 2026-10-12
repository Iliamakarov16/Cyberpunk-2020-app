import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

const env=installEnvironment(),h=createHarness();
const {CampaignHub,CampaignTerminal,blank}=await loadModules(h);
const campaign={id:10,name:'Ночная смена',description:'Общий стол',gm_id:1,gm:'Ведущий',version:1,updated:100,is_member:true,transfer_to:null};
const character={id:21,owner_id:2,owner:'Вега',version:1,updated:100,can_edit:true,data:blank('Вега','Соло')};
const resolved={id:'resolved-action',characterId:21,targetId:'guard',kind:'attack',description:'Прежний выстрел',tool:'Пистолет',roll:18,damage:7,status:'resolved',result:'Согласованный результат',created:100,resolvedAt:101};
const scene={id:'old-scene',name:'Прежний склад',active:true,targets:[{id:'guard',name:'Охранник',kind:'person',description:'',visible:true}],actions:[resolved],log:[{id:'old-log',text:'Сохранённая запись журнала',created:101}]};
let gm=false,status='active',shared=true,dirty=false;
const requests=[],battles=[],sheets=[];
const me=()=>({id:gm?1:2,username:gm?'Ведущий':'Вега',role:'player'});
const snapshot=()=>({version:1,updated:100,is_gm:gm,characters:[{id:21,name:'Вега',role:'Соло',owner_id:2,status}],data:{
 contacts:[{id:'mara',name:'Мара',phone:'555',description:'Связная',notes:'',recipients:[21]}],
 messages:[{id:'old-message',contactId:'mara',characterId:21,sender:'npc',body:'Сохранённое сообщение',created:100}],
 places:[{id:'docks',name:'Старые доки',address:'Док 12',description:'Сохранённый адрес',x:10,y:20,recipients:[21]}],
 assets:[{id:'car',kind:'vehicle',name:'Сохранённая машина',ownerCharacterId:21,access:[21],location:'Доки',condition:'Исправна',cost:1000,upkeep:0,notes:'',contents:''}],
 scene:structuredClone(scene),
}});
const api=async(path,method='GET',data)=>{
 requests.push({path,method,data});
 assert.equal(method,'GET','Entry, legacy history and aftermath navigation never write or migrate server data');
 if(path==='/api/campaigns')return [{...campaign,is_gm:gm}];
 if(path==='/api/campaigns/10')return {...campaign,is_gm:gm,roster:[{character_id:21,owner_id:2,owner:'Вега',name:'Вега',role:'Соло',status,can_open:true}],members:[]};
 if(path==='/api/campaigns/10/workspace')return structuredClone(snapshot());
 if(path==='/api/characters/21')return structuredClone(character);
 throw new Error(`Unexpected ${method} ${path}`);
};
const props=()=>({me:me(),characters:[character],api,open:(character,context)=>sheets.push({character,context}),createCharacter(){},navigationRevision:()=>1,refreshCharacters:async()=>{},onDirtyChange:value=>{dirty=value;},onOpenBattle:shared?context=>battles.push(context):undefined});
const exact=(label,inside=h.tree)=>h.nodes(inside).find(n=>n.type==='button'&&h.text(n).replace(/\s+/g,' ').trim()===label);
const shortcut=id=>h.find(n=>n.props['data-campaign-shortcut']===id);
const terminalNav=()=>h.find(n=>n.props['aria-label']==='Разделы терминала');
const terminalSection=()=>h.find(n=>n.props['data-terminal-view'])?.props['data-terminal-view'];
const field=(label,type='textarea')=>h.nodes(h.find(n=>n.props['data-label']===label)).find(n=>n.type===type);
async function change(node,value){assert(node);node.props.onChange({target:{value}});h.render();await h.flush();}
async function openHub(){h.mount(CampaignHub,props());await h.flush();await h.click(campaign.name);}
function assertSingleBattle(){
 const entries=h.buttons().filter(n=>h.text(n).replace(/\s+/g,' ').trim()==='Бой');
 assert.equal(entries.length,1,'The campaign has exactly one canonical Battle entry');
 assert.equal(entries[0].props['data-campaign-shortcut'],'shared-battle');
 assert(!shortcut('scene'),'The old overview scene shortcut is absent in shared mode');
 assert(!exact('Сцена и действия'));assert(!exact('Совместный бой'));
}

try{
 for(const role of ['gm','active','reserve']){
  gm=role==='gm';status=role==='reserve'?'reserve':'active';shared=true;
  await openHub();assertSingleBattle();
  assert(!exact('Открыть сцену'),'The landing page has no second battlefield front door');
  assert(shortcut('legacy-scene'),'Saved manual scenes are explicitly secondary');
  const before=battles.length;await h.click(exact('Бой'));
  assert.equal(battles.length,before+1);assert.deepEqual(battles.at(-1),{campaignId:10,campaignName:campaign.name});
  await h.click(exact('Связь и записи'));
  assert.equal(terminalSection(),'messages','The normal terminal entry starts with communications');assertSingleBattle();
  assert.deepEqual(h.nodes(terminalNav()).filter(n=>n.type==='button').map(n=>h.text(n).trim()),['Сообщения','Места','Имущество']);
  assert(h.text().includes('Сохранённое сообщение'));
  for(const [label,content] of [['Места','Старые доки'],['Имущество','Сохранённая машина']]){
   await h.click(exact(label,terminalNav()));assert(h.text().includes(content));
  }
  await h.click(h.find(n=>n.props['data-terminal-secondary']==='scene'));
  assert.equal(terminalSection(),'scene');assert(h.text().includes('Прежний склад'));assert(h.text().includes('Сохранённая запись журнала'));
  if(gm)await h.click(h.nodes(h.find(n=>n.props['aria-label']==='Показать действия')).find(n=>n.type==='button'&&h.text(n).startsWith('История')));
  assert(h.find(n=>n.props['data-action-id']===resolved.id),'Resolved manual records remain readable');
  await h.click('Патроны и вещи');
  assert.equal(sheets.at(-1).character.id,21);assert.equal(sheets.at(-1).context.sceneId,scene.id);assert.equal(sheets.at(-1).context.actionId,resolved.id);
  await h.click(exact('Связь и записи'));
  env.window.dispatchEvent(new CustomEvent('nightcity-return-to-scene',{detail:sheets.at(-1).context}));h.render();await h.flush();
  assert.equal(terminalSection(),'scene');assert(h.find(n=>n.props['data-action-id']===resolved.id&&n.props.className.includes('returned-action')),'Aftermath returns to the same retained manual action');
  if(!gm){
   await change(field('Что ты хочешь сделать'),'Ручной черновик остаётся на месте');assert(dirty);
   await h.click(exact('Бой'));assert(dirty);assert.equal(field('Что ты хочешь сделать').props.value,'Ручной черновик остаётся на месте');
   await h.click(exact('Связь и записи'));await change(field('Ответ от Вега'),'Сообщение остаётся на месте');
   await h.click(exact('Бой'));assert.equal(field('Ответ от Вега').props.value,'Сообщение остаётся на месте');
   await h.click(h.find(n=>n.props['data-terminal-secondary']==='scene'));assert.equal(field('Что ты хочешь сделать').props.value,'Ручной черновик остаётся на месте');
  }
  const command={destination:'campaign-play'};
  env.window.dispatchEvent(new CustomEvent('nightcity-hub-navigate',{detail:command}));h.render();await h.flush();
  assert.equal(terminalSection(),'messages','The generic play tutorial does not turn the old battlefield into a front door');
  env.window.dispatchEvent(new CustomEvent('nightcity-hub-navigate',{detail:{destination:'campaign-scene'}}));h.render();await h.flush();
  assert.equal(terminalSection(),'scene','Explicit legacy-scene lessons retain their original route');
  h.dispose();
 }
 gm=false;status='pending';await openHub();
 assert(!shortcut('shared-battle'));assert(!shortcut('legacy-scene'));assert(!shortcut('scene'));
 assert.equal(exact('Связь и записи').props.disabled,true,'Pending applicants gain no access from presentation changes');h.dispose();

 // Hosted backend fallback keeps the established scene route when no shared callback exists.
 shared=false;status='active';
 for(const isGM of [false,true]){
  gm=isGM;await openHub();assert(!exact('Бой'));assert(shortcut('scene'));assert(exact('Стол'));
  await h.click(shortcut('scene'));assert.equal(terminalSection(),'scene');assert(exact('Поле боя',terminalNav()));assert(!h.find(n=>n.props['data-terminal-secondary']));h.dispose();
 }
 h.mount(CampaignTerminal,{campaignId:10,me:me(),api,demoMode:true});await h.flush();
 assert.equal(terminalSection(),'scene');assert(exact('Поле боя',terminalNav()),'Standalone/demo tutorials keep their original battlefield tab');
 assert(requests.every(request=>request.method==='GET'));
 console.log('PASS: one canonical Battle entry for GM, player and reserve; no competing scene front door; secondary legacy history, messages, places and assets; same-action aftermath return; manual/message draft retention; denied pending access; shared tutorial routes and hosted/demo fallback. Hook harness only, no browser rendering claim.');
}finally{h.dispose();}
