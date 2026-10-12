import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

installEnvironment();
const h=createHarness(),{CampaignHub,CampaignTerminal,blank}=await loadModules(h);
const calls=[],opened=[];
let gm=true,accepted=true,releaseWrite=null;
const me=()=>({id:gm?1:2,username:gm?'Ведущий':'Вега',role:'player'});
const base={id:10,name:'Тестовый стол',description:'Кампания управления',gm_id:1,gm:'Ведущий',version:1,updated:100,is_member:true,transfer_to:null};
const roster=()=>[
 {character_id:20,owner_id:2,owner:'Вега',name:'Вега',role:'Соло',status:accepted?'active':'pending',can_open:true},
 {character_id:21,owner_id:3,owner:'Нова',name:'Нова',role:'Фиксер',status:'pending',can_open:gm},
 {character_id:22,owner_id:4,owner:'Байт',name:'Байт',role:'Нетраннер',status:'reserve',can_open:gm}
];
const action=(id,status,roll=null)=>({id,characterId:20,targetId:'guard',kind:'attack',description:id,tool:'Пистолет',roll,damage:null,status,result:['resolved','rejected'].includes(status)?'Ответ ведущего':'',created:Number(id.split('-')[1])||100,resolvedAt:status==='resolved'?100:null});
let active=false,workspaceVersion=1;
const workspace=()=>({version:workspaceVersion,updated:100,is_gm:gm,characters:[{id:20,owner_id:2,name:'Вега',role:'Соло',status:'active'},{id:22,owner_id:4,name:'Байт',role:'Нетраннер',status:'reserve'}],data:{contacts:[],messages:[],places:[],assets:[],scene:{id:'scene1',name:'Склад у доков',active,targets:[{id:'guard',name:'Охранник',kind:'person',description:'У входа',visible:true}],actions:[action('request-1','submitted'),action('waiting-2','approved'),action('ready-3','approved',0),action('past-4','resolved',15),action('declined-5','rejected')],log:[]}}});
const api=async(path,method='GET',data)=>{
 calls.push({path,method,data});
 if(method==='POST'){
  assert(gm,'Player presentation cannot issue GM mutations');
  assert.equal(path,'/api/campaigns/10/workspace');
  return new Promise(resolve=>{releaseWrite=()=>{if(data.command==='scene.save')active=data.active;workspaceVersion++;resolve({version:workspaceVersion});};});
 }
 if(path==='/api/campaigns')return [{...base,is_gm:gm}];
 if(path==='/api/campaigns/10')return {...base,is_gm:gm,is_member:accepted||gm,roster:roster(),invite_code:gm?'NC-TEST':undefined,members:[]};
 if(path==='/api/campaigns/10/workspace')return structuredClone(workspace());
 if(path==='/api/characters/20')return {id:20,owner_id:2,owner:'Вега',version:1,updated:100,data:blank('Вега','Соло'),can_edit:true};
 throw new Error(`Unexpected request ${method} ${path}`);
};
const exactButton=(label,inside)=>h.nodes(inside).find(node=>node.type==='button'&&h.text(node).replace(/\s+/g,' ').trim()===label);
const shortcut=id=>h.find(node=>node.props['data-campaign-shortcut']===id);
const queueIds=()=>h.nodes().filter(node=>node.props['data-action-id']).map(node=>node.props['data-action-id']);
const queueFilter=label=>h.nodes(h.find(node=>node.props['aria-label']==='Показать действия')).find(node=>node.type==='button'&&h.text(node).startsWith(label));
const field=(label,type)=>h.nodes(h.find(node=>node.props['data-label']===label)).find(node=>node.type===type);
const hubProps=()=>({me:me(),characters:[],api,open:character=>opened.push(character),createCharacter(){},navigationRevision:()=>1,refreshCharacters:async()=>{}});
async function openHub(){h.mount(CampaignHub,hubProps());await h.flush();await h.click(base.name);}

try{
 // GM landing exposes the real common tasks without going through setup/settings.
 await openHub();
 assert(h.button('Сцена и действия'));assert(h.button('Листы партии'));assert(h.button('Заявки игроков'));
 assert(h.button('Скопировать код приглашения'),'The invitation can be copied from the landing page');
 await h.click('Листы партии');
 assert(h.text().includes('Вега'));assert(h.text().includes('Байт'));assert(!h.text().includes('Нова'),'Accepted-sheet shortcut does not mix pending applications into the party');
 const rosterNav=h.find(node=>node.props['aria-label']==='Показать участников');
 await h.click(exactButton('Заявки 1',rosterNav));
 assert(h.text().includes('Нова'));assert(!h.text().includes('Байт'));
 await h.click(exactButton('Сводка',h.find(node=>node.props['aria-label']==='Разделы кампании')));
 await h.click(shortcut('scene'));
 const terminal=h.find(node=>node.props.className==='campaign-terminal');
 assert.equal(terminal.props['data-embedded'],true);
 assert(!h.find(node=>node.props.className==='nc-commlink-masthead'),'The embedded table has no duplicate masthead');
 assert(!h.find(node=>node.props.className==='nc-terminal-session'),'The embedded table has no duplicate operator/role/version card');
 assert(!h.find(node=>node.props.className==='terminal-identity'),'A GM without an own hero does not need a disabled character picker');
 assert.equal(h.find(node=>node.props['aria-label']==='Твоя роль в кампании').props['data-campaign-role'],'gm');
 assert.deepEqual(queueIds(),['request-1','ready-3','waiting-2'],'Current requests appear in decision order; a zero roll is a ready result');
 assert.equal(h.text(h.find(node=>node.props.className==='terminal-queue-summary')).replace(/\s+/g,' ').trim(),'1 на разрешение · 1 на подтверждение · 1 ждут броска');
 assert(h.button('Текущие действия'),'The live queue is directly reachable above the map');
 assert(h.button('Открыть сцену'),'An already prepared scene can open directly, even without a battle map');
 assert.equal(calls.filter(call=>call.method==='POST').length,0,'Task navigation and filtering are read-only');

 // Filtering preserves a GM response draft; return from consequences reveals the exact past action.
 const response=field('Описание результата / ответ игроку','textarea');
 response.props.onChange({target:{value:'Ответ в процессе'}});h.render();await h.flush();
 await h.click(queueFilter('История'));
 assert.deepEqual(queueIds(),['declined-5','past-4']);
 await h.click(queueFilter('Текущие'));
 assert.equal(field('Описание результата / ответ игроку','textarea').props.value,'Ответ в процессе');
 window.dispatchEvent(new CustomEvent('nightcity-return-to-scene',{detail:{campaignId:10,sceneId:'scene1',actionId:'past-4',characterId:20,result:'Ответ ведущего'}}));
 h.render();await h.flush();
 assert(queueIds().includes('past-4'),'Returning from a sheet never hides its resolved action behind the active filter');
 assert(h.find(node=>node.props['data-action-id']==='past-4').props.className.includes('returned-action'));
 await h.click('Текущие действия');
 assert.deepEqual(queueIds(),['request-1','ready-3','waiting-2'],'The live shortcut also leaves history and reopens current requests');

 // Scene opening retains explicit confirmation, and in-flight work disables navigation/filter changes.
 await h.click('Открыть сцену');
 assert.equal(calls.filter(call=>call.method==='POST').length,0);
 await h.click(exactButton('Подтвердить')); 
 assert(releaseWrite);assert.equal(calls.filter(call=>call.method==='POST').length,1);
 assert.equal(calls.at(-1).data.command,'scene.save');
 assert.equal(calls.at(-1).data.active,true);
 assert(queueFilter('История').props.disabled);
 assert(h.nodes(h.find(node=>node.props['aria-label']==='Разделы кампании')).filter(node=>node.type==='button').every(node=>node.props.disabled),'A pending terminal command also blocks outer campaign task navigation');
 releaseWrite();releaseWrite=null;await h.flush();
 assert(h.text().includes('Сцена открыта'));
 h.dispose();

 // Player's own sheet and scene remain one tap away; other people's sheets and GM controls are absent.
 gm=false;active=true;await openHub();
 const own=h.find(node=>node.props['data-campaign-character']===20);
 assert(own);assert(!h.find(node=>node.props['data-campaign-character']===22));
 await h.click(own);assert.equal(opened.at(-1).id,20);assert.equal(opened.at(-1).data.name,'Вега');
 await h.click(shortcut('scene'));
 assert(h.find(node=>node.props.className==='terminal-current-character'),'A single accepted player character is identified without a redundant picker');
 assert(!h.find(node=>node.props['aria-label']==='Показать действия'),'GM queue controls never appear for players');
 assert(!h.button('Подготовить сцену'));assert(!h.button('Закрыть приём действий'));
 assert(queueIds().includes('past-4'),'Players can see their confirmed results immediately');
 h.dispose();

 accepted=false;await openHub();
 assert(shortcut('scene').props.disabled);assert(shortcut('messages').props.disabled);
 assert(!h.find(node=>node.props.className==='campaign-terminal'));
 h.dispose();

 // Standalone/demo terminal keeps its full context because embedded is an optional default-false flag.
 gm=true;h.mount(CampaignTerminal,{campaignId:10,me:me(),api});await h.flush();
 assert(h.find(node=>node.props.className==='nc-commlink-masthead'));
 assert(h.find(node=>node.props.className==='nc-terminal-session'));
 console.log('PASS: actual campaign shortcuts, GM accepted/pending roster, compact embedded table, current/history queue with retained drafts and result return, confirmed/busy scene control, player/pending roles and standalone context.');
}finally{h.dispose();}
