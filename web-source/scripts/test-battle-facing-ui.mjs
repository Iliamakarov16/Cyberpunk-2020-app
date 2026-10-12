import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
import {actorHeading,headingToward,HEADINGS,interpolateHeading} from '../lib/firefight/heading.mjs';
import {showBattleActorActions} from './battle-ui-navigation.mjs';
import {confirmedFixtureScene,fixtureFirePreview,beginFixtureFire,fixtureConfirmButton} from './combat-loadout-fixture.mjs';
const env=installEnvironment(),h=createHarness();globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
const {SharedBattle,BattleApp}=await loadModules(h,undefined,{actualSharedBattle:true});
assert.equal(actorHeading({facing:-1}),180);assert.equal(actorHeading({facing:1}),0);
for(const heading of HEADINGS){const r=heading*Math.PI/180;assert.equal(headingToward({x:3,y:3},{x:3+Math.round(Math.cos(r)*4),y:3+Math.round(Math.sin(r)*4)}),heading);assert.equal(interpolateHeading(0,heading,1),heading);}
let data,calls=[],held=null;
function reset(role='gm',phase='combat') {const scene=confirmedFixtureScene(createDemoScene());scene.version=4;scene.phase=phase;scene.actors[0].heading=0;scene.order=phase==='combat'?scene.actors.map(a=>a.id):[];scene.currentActorId=scene.order[0]||null;scene.index=0;data={role,controlledActorIds:role==='player'?['ray']:[],viewerActorId:role==='player'?'ray':null,options:{characters:[]},battle:{id:'facing-ui',version:4,phase,scene,pending:[],log:[]}};calls=[];}
const api=async(path,method='GET',body)=>{calls.push({path,method,body:structuredClone(body)});if(method==='GET')return structuredClone(data);if(path.endsWith('/preview')){if(held)return held.promise;const c=body.command;return {preview:c.type==='face'?{ok:true,type:'face',text:'Повернуться',fromHeading:0,heading:c.heading}:c.type==='shoot'?{ok:false,error:'Прежний алгоритм закрыт для новых атак. Создай подтверждённое огневое действие.'}:fixtureFirePreview(c)};}return structuredClone(data);};
const props={campaignId:88,accountId:1,api,onExit(){}};
const pickTarget=async()=>{globalThis.__battlePick({actorId:'guard-1',x:16,y:8});h.render();await h.flush();};
reset('gm','preparation');h.mount(SharedBattle,props);await h.flush();await showBattleActorActions(h);await h.click('Повернуть персонажа');await h.click('Вверх ↑');assert.equal(calls.at(-1).body.command.heading,270);assert(!('x' in calls.at(-1).body.command));assert.equal(globalThis.__battleRendered.state.actors[0].heading,0,'Preview never applies proposed heading or future vision locally');assert.equal(globalThis.__battleRendered.preview.heading,270);await h.click('Повернуться');assert.equal(calls.at(-1).body.type,'face');assert.equal(calls.at(-1).body.heading,270);h.dispose();
reset();h.mount(SharedBattle,props);await h.flush();await beginFixtureFire(h);await pickTarget();assert(fixtureConfirmButton(h).props.disabled,'No implicit GM ruling');await h.click('Разворот · −2');assert.deepEqual(calls.at(-1).body.command.gmFire,{turnToTarget:true});assert.match(h.text(),/Охранник\s*:\s*5\s*\+\s*0\s*\+\s*d10\s*≥\s*15/,'The displayed server formula includes the chosen −2 turn penalty');await h.click(fixtureConfirmButton(h));assert.equal(calls.at(-1).body.type,'fire');assert.deepEqual(calls.at(-1).body.gmFire,{turnToTarget:true});assert(!('turnToTarget' in calls.at(-1).body));h.dispose();
reset('player');h.mount(SharedBattle,{...props,accountId:2});await h.flush();await h.click('Поворот');await h.click('Влево ←');assert(!h.button('Без разворота'));await h.click('Отправить ГМу');const declared=calls.at(-1).body;assert.equal(declared.type,'declare');assert.deepEqual(declared.action,{type:'face',actorId:'ray',heading:180});assert.equal(globalThis.__battleRendered.state.actors[0].heading,0);h.dispose();
// A delayed previous adjudication cannot enable a new decision's confirmation.
reset();const pendingAction={type:'fire',actorId:'ray',targetIds:['guard-1'],mode:'single',rounds:1,location:'random'};data.battle.pending=[{id:'shot-pending',actorId:'ray',action:pendingAction,status:'pending'}];h.mount(SharedBattle,props);await h.flush();await h.click('Заявки');assert(h.button('Подтвердить и бросить').props.disabled);
let release;held={promise:new Promise(resolve=>release=resolve)};await h.click('Без разворота');held=null;await h.click('Разворот · −2');release({preview:fixtureFirePreview({...pendingAction,gmFire:{turnToTarget:false}},{base:99,difficulty:1})});await h.flush();assert(!h.text().includes('99'));await h.click('Подтвердить и бросить');assert.deepEqual(calls.at(-1).body.gmFire,{turnToTarget:true});assert.equal(calls.at(-1).body.declarationId,'shot-pending');h.dispose();
// Historical root-shaped declarations remain readable, but the closed legacy
// resolver cannot authorize a new shot. They can be rejected without rolling.
reset();data.battle.pending=[{id:'legacy-shot',actorId:'ray',targetId:'guard-1',location:'random',status:'pending',preview:{text:'Выстрел'}}];h.mount(SharedBattle,props);await h.flush();await h.click('Заявки');assert(h.button('Подтвердить и бросить').props.disabled);await h.click('Без разворота');assert.equal(calls.at(-1).body.command.type,'shoot');assert.equal(calls.at(-1).body.command.targetId,'guard-1');assert(h.button('Подтвердить и бросить').props.disabled);assert(h.text().includes('Прежний алгоритм закрыт'));assert(!calls.some(call=>call.path.endsWith('/commands')));await h.click('Отклонить');assert.equal(calls.at(-1).body.type,'reject');assert.equal(calls.at(-1).body.declarationId,'legacy-shot');h.dispose();
// An unconfirmed old weapon cannot stage a new legacy attack through the hotbar.
reset();delete data.battle.scene.actors[0].loadout;h.mount(SharedBattle,props);await h.flush();await h.click('Огонь');assert(h.text().includes('Подтверди оружие по правилам 2020'));assert(!h.find(node=>node.props['aria-label']==='Предпросмотр действия'));assert(!calls.some(call=>call.path.endsWith('/preview')||call.path.endsWith('/commands')));h.dispose();
// Local owner-as-GM adjudication is opt-in only and never enabled by training alone.
for(const enabled of [false,true]){
 reset('player');const sent=[],previewed=[];
 h.mount(BattleApp,{scene:data.battle.scene,role:'player',controlledIds:['ray'],training:true,trainingLocalAdjudication:true,...(enabled?{onTestMenu(){}}:{}),onPreview:async c=>{previewed.push(c);return fixtureFirePreview(c);},onCommand:async c=>{sent.push(c);return {};}});await h.flush();await beginFixtureFire(h);await pickTarget();
 assert.equal(!!h.button('Без разворота'),enabled);
 if(enabled){assert(h.text().includes('Решение ГМа в тренировке'));assert(h.button('Отправить ГМу').props.disabled);await h.click('Разворот · −2');}
 await h.click('Отправить ГМу');assert.equal(sent.at(-1).type,'fire');assert.equal(Object.hasOwn(sent.at(-1),'gmFire'),enabled);assert.equal(Object.hasOwn(previewed.at(-1),'gmFire'),enabled);assert(!Object.hasOwn(sent.at(-1),'turnToTarget'));h.dispose();
}
void env;
console.log('Facing UI: legacy/eight headings, GM preparation preview, no local reveal, explicit per-action fire ruling, player intent, stale adjudication ignored, and closed legacy attacks passed.');
