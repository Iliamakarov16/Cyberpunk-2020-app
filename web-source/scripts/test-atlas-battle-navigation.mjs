import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
const env=installEnvironment(),h=createHarness();env.window.location={origin:'http://crew.test'};
const {Tracker}=await loadModules(h,undefined,{actualAtlas:true,actualInvitations:true});
const campaign={id:10,name:'Бар',description:'',gm_id:2,gm:'Tester',version:1,updated:100,is_gm:true,is_member:true,transfer_to:null};
let active=[];const reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(path,options={})=>{
 assert.equal(options.method||'GET','GET','Overlay navigation must not mutate campaign data');
 if(path==='/api/me')return reply({id:2,username:'Tester',role:'player',csrf:'test'});
 if(path==='/api/settings')return reply({hints:false,tutorial:false,animations:false});
 if(path==='/api/characters')return reply([]);if(path==='/api/campaigns')return reply([campaign]);
 if(path==='/api/campaigns/10')return reply({...campaign,members:[],roster:[],gm_notes:'Saved'});
 if(path==='/api/campaigns/10/workspace')return reply({version:1,is_gm:true,characters:[],data:{schemaVersion:1,contacts:[],messages:[],places:[],assets:[],scene:null}});
 if(path==='/api/battles/active')return reply({battles:active});throw new Error(path);
};
await h.mount(Tracker,{platformAuth:false});await h.flush();
await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));await h.click(h.find(n=>n.type==='button'&&n.props.className?.includes('campaign-folder')));
const tabs=h.find(n=>n.props['aria-label']==='Разделы кампании');await h.click(h.nodes(tabs).find(n=>n.type==='button'&&h.text(n).includes('Записи')));
const notes=h.find(n=>n.type==='textarea'&&n.props.value==='Saved');notes.props.onChange({target:{value:'Private unsaved GM draft'}});h.render();await h.flush();
await h.click('Карта Найт-Сити');assert(!h.find(n=>n.type==='textarea'));const frame=()=>h.find(n=>n.type==='iframe',false);assert(frame());
let messages=[];const source={postMessage:value=>messages.push(value)};frame().props.ref.current.contentWindow=source;
function send(data){const event=new Event('message');Object.defineProperties(event,{origin:{value:'http://crew.test'},source:{value:source},data:{value:data}});env.window.dispatchEvent(event);}
send({type:'nc-atlas:ready',version:1});send({type:'nc-atlas:state',version:1,dirty:true,busy:false});await h.flush();
active=[{campaignId:10,campaignName:'Бар',battleId:'live-scene',battleName:'Столкновение',phase:'combat',actorIds:['npc-ray']}];env.window.dispatchEvent(new Event('nightcity-sync'));await h.flush();assert(h.button('Войти в бой'));
await h.click('Войти в бой');assert(!h.find(n=>n.type==='iframe'));assert.equal(frame().props.ref.current.contentWindow,source,'Invitation suspends rather than destroys dirty map');
let battleBack=0;env.window.addEventListener('nightcity-battle-back',event=>{battleBack++;event.preventDefault();});
async function back(){const event=new Event('nightcity-native-back',{cancelable:true});env.window.dispatchEvent(event);h.render();await h.flush();assert(event.defaultPrevented);}
await back();assert.equal(battleBack,1);assert(!messages.some(value=>value.type==='nc-crew:back'),'Battle receives native Back before suspended map');
const battle=h.find(n=>n.type==='harness-external'&&n.props.campaignId===10&&n.props.accountId===2);assert(battle);battle.props.onExit();h.render();await h.flush();assert(h.find(n=>n.type==='iframe'));assert.equal(frame().props.ref.current.contentWindow,source);
await back();assert.equal(messages.at(-1).type,'nc-crew:back');send({type:'nc-atlas:back-handled',version:1});send({type:'nc-atlas:exit',version:1});await h.flush();
assert(!frame());assert(h.find(n=>n.type==='textarea'&&n.props.value==='Private unsaved GM draft'),'Map and battle return preserve the exact prior tab and draft');
h.dispose();console.log('Actual Tracker/CampaignHub/Atlas/invitation path: notes draft → map → connected battle invitation → battle Back → same dirty map → exact notes tab/draft. No network mutation or runtime pixel claim.');
