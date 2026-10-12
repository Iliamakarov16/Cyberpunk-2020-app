import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
const env=installEnvironment(),h=createHarness();globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
const {SharedBattle}=await loadModules(h,undefined,{actualSharedBattle:true});
let calls=[],held=null;
function response(role='gm'){const scene=createDemoScene();scene.phase='combat';scene.version=5;scene.currentActorId='ray';scene.order=['ray','mira','guard-1'];scene.index=0;return {role,controlledActorIds:role==='player'?['ray']:[],options:{characters:[]},battle:{id:'bar',version:5,phase:'combat',scene,pending:[],log:[]}};}
let data=response();
const api=async(path,method,body)=>{if(!method)return structuredClone(data);calls.push({path,body});if(held)return held.promise;if(path.endsWith('/preview'))return {preview:{ok:true,type:body.command.type,distance:1,path:[{x:7,y:10}],text:'Переместиться'}};return structuredClone(data);};
const props={campaignId:77,campaignName:'Test',accountId:1,api,onExit(){}};
function key(repeat=false){const e=new Event('keydown',{cancelable:true});Object.defineProperties(e,{key:{value:' '},code:{value:'Space'},repeat:{value:repeat},target:{value:{tagName:'CANVAS',getAttribute:()=>null,closest:()=>null}}});env.window.dispatchEvent(e);h.render();return e;}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
h.mount(SharedBattle,props);await h.flush();
assert(h.text().includes('ГМ · вся сцена'));assert(h.text().includes('Ход участника'));assert(!h.text().includes('Твой ход'));assert(h.find(n=>n.props['aria-label']==='Быстрые действия боя'));assert(!h.find(n=>n.props['aria-label']==='Действия выбранного персонажа'));
await h.click('Идти');globalThis.__battlePick({x:7,y:10});h.render();await h.flush();assert(h.button('Завершить ход').props.disabled);assert(!key().defaultPrevented);assert(!calls.some(c=>c.path.endsWith('/commands')));await h.click('Отменить выбор');assert(!key(true).defaultPrevented);assert(!calls.some(c=>c.path.endsWith('/commands')));
// A rapid double tap shares one authoritative command even before render.
held=deferred();const click=h.button('Завершить ход').props.onClick;click();click();h.render();assert.equal(calls.filter(c=>c.path.endsWith('/commands')).length,1);held.resolve(data);held=null;await h.flush();h.dispose();
// Player waiting for another actor cannot send End; a stunned current actor can.
for(const [current,status,allowed] of [['mira','active',false],['ray','stunned',true]]){data=response('player');data.battle.scene.currentActorId=current;data.battle.scene.actors[0].status=status;h.mount(SharedBattle,{...props,accountId:2});await h.flush();assert.equal(h.button('Завершить ход').props.disabled,!allowed);assert(h.button('Идти').props.disabled);h.dispose();}
// Import arrival is explicit. Merely following a campaign link never creates a scene.
data={role:'gm',controlledActorIds:[],options:{characters:[]},battle:null};calls=[];h.mount(SharedBattle,{...props,initialTool:'import'});await h.flush();assert(h.button('Выбрать файл поля боя'));assert.equal(calls.length,0);await h.click('Позже');assert(!h.button('Выбрать файл поля боя'));assert.equal(calls.length,0);h.dispose();
console.log('Hotbar: direct actions, pending-preview/Space guard, duplicate End, player ownership/stun semantics, and explicit import arrival passed.');
const css=await (await import('node:fs/promises')).readFile(new URL('../components/battle/battle.css',import.meta.url),'utf8');
assert.match(css,/@media\(max-width:700px\)\{\.nc-firefight \.hotbar-end>svg\{display:none\}/,'Narrow End label retains its touch target without decorative chevron overflow');
