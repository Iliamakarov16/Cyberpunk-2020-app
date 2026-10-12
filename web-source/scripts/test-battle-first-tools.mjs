import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {clickBattleControl} from './battle-ui-navigation.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
const env=installEnvironment(),h=createHarness();globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
const {SharedBattle}=await loadModules(h,undefined,{actualSharedBattle:true});
let state,calls,failure;
const empty=()=>({role:'gm',controlledActorIds:[],options:{characters:[],npcTemplates:[{id:'guard-rifle',name:'Охранник'}]},battle:null});
const api=async(path,method='GET',body)=>{if(method==='GET')return structuredClone(state);calls.push({path,body:structuredClone(body)});if(failure)throw failure;assert.equal(body.type,'prepare');assert.deepEqual(body.actors,[]);assert.equal(body.expectedVersion,0);state={...state,battle:{id:'new-empty',version:1,phase:'preparation',scene:{...createDemoScene(),...body,actors:[],log:[],currentActorId:null},pending:[],log:[]}};return structuredClone(state);};
const props={campaignId:42,campaignName:'Новый гараж',accountId:9,api,onExit(){}};
for(const [label,expected] of [['Импорт сцены','Выбрать файл сцены'],['Добавить НПС','Шаблон НПС']]){
 state=empty();calls=[];failure=null;h.mount(SharedBattle,props);await h.flush();
 await clickBattleControl(h,label);assert.equal(calls.length,1);assert(h.find(n=>n.props['aria-label']===expected),'Requested tool opens after successful empty preparation');
 assert.equal(state.battle.scene.actors.length,0);assert(!calls.some(c=>c.body.type==='add'||c.body.type==='import-scene'),'Opening never imports or creates an NPC without confirmation');h.dispose();
}
state=empty();calls=[];failure=Object.assign(new Error('Конфликт'),{status:409});h.mount(SharedBattle,props);await h.flush();await clickBattleControl(h,'Импорт сцены');assert.equal(calls.length,1);assert(!h.find(n=>n.props['aria-label']==='Выбрать файл сцены'),'Failed prepare must not open import');assert.equal(state.battle,null);h.dispose();
console.log('Initial campaign tools: direct Import/NPC save only empty preparation, open after confirmed success, never mutate sheets or auto-import, reject conflicts safely.');
