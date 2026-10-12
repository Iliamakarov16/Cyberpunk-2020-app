// Actual SharedBattle + BattleApp hooks; only canvas rendering and transport are mocked.
// Fixtures are already server-filtered. This suite does not test line-of-sight geometry.
import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {openBattleMenu} from './battle-ui-navigation.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
import {confirmedFixtureActor,fixtureFirePreview,beginFixtureFire} from './combat-loadout-fixture.mjs';

const env=installEnvironment(),h=createHarness(),storage=new Map();
globalThis.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const {SharedBattle}=await loadModules(h,undefined,{actualSharedBattle:true});
const A='character-11',B='character-12',EA='visible-west-enemy',EB='visible-east-enemy';
const ownNames={[A]:'Вега',[B]:'Мира'};
const publicActor=actor=>Object.fromEntries(['id','characterId','name','team','sprite','x','y','facing','status','hidden'].filter(key=>key in actor).map(key=>[key,actor[key]]));
const ownedActor=id=>confirmedFixtureActor({...structuredClone(createDemoScene().actors[0]),id,characterId:id===A?11:12,name:ownNames[id],x:id===A?2:9,y:3});
const enemy=id=>publicActor({...ownedActor(id===EA?A:B),id,characterId:undefined,name:id===EA?'Западный охранник':'Восточный охранник',team:'hostile',sprite:2,x:id===EA?3:10});

function projected(viewer=A,{version=20,turn=A,noActor=false,visibleOtherOwn=false,pending=[]}={}){
 const id=noActor?null:viewer,west=id===A;
 const cells=id?Array.from({length:5},(_,y)=>Array.from({length:5},(_,x)=>[x+(west?0:7),y+1])).flat():[];
 const visible=new Set(cells.map(([x,y])=>`${x},${y}`));
 const actors=id?[ownedActor(id),enemy(west?EA:EB)]:[];
 if(id&&visibleOtherOwn)actors.push({...publicActor(ownedActor(id===A?B:A)),x:west?4:8});
 const scene={schemaVersion:1,id:'private-scene',name:'Личный обзор',subtitle:'Кампания',version,phase:'combat',round:1,width:12,height:8,tileMeters:1,
  tiles:Array.from({length:8},(_,y)=>Array.from({length:12},(_,x)=>visible.has(`${x},${y}`)?{type:'floor',zone:west?'WEST PRIVATE ZONE':'EAST PRIVATE ZONE'}:{type:'unknown'})),
  actors,props:id?[{id:west?'west-crate':'east-crate',type:'crate',x:west?1:8,y:2,w:1,h:1,cover:true,label:west?'WEST PRIVATE PROP':'EAST PRIVATE PROP'}]:[],
  devices:id?[{id:west?'west-port':'east-port',name:west?'WEST PRIVATE PORT':'EAST PRIVATE PORT',type:'port',x:west?1:8,y:3}]:[],
  order:actors.filter(actor=>actor.id===turn).map(actor=>actor.id),index:0,currentActorId:actors.some(actor=>actor.id===turn)?turn:null,gmTurn:!actors.some(actor=>actor.id===turn),
  log:id?[{id:west?'west-log':'east-log',kind:'move',round:1,text:west?'WEST PRIVATE LOG':'EAST PRIVATE LOG'}]:[],settings:{stagedPenetration:true,cp2020Rulings:{nonautomaticFumbleAmmo:'consume-attempted'}},
  vision:{model:'los360',actorId:id,cells}};
 return {role:'player',viewerActorId:id,viewerActors:noActor?[]:[{id:A,name:ownNames[A]},{id:B,name:ownNames[B]}],controlledActorIds:id?[id]:[],options:{characters:[]},battle:{id:'battle-private',version,phase:'combat',scene,pending:structuredClone(pending),log:scene.log,canUndo:false}};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function transport(config={}){
 const state={version:20,turn:A,noActor:false,visibleOtherOwn:false,pending:[],...config},calls=[],held=[];
 let nextError=null,revoked=false;
 const api=async(path,method='GET',body)=>{
  const url=new URL(path,'https://fixture.invalid'),viewer=url.searchParams.get('viewerActorId')||A;
  const call={path,pathname:url.pathname,method,viewer,body:structuredClone(body)};calls.push(call);
  assert([A,B].includes(viewer),'Only authenticated own viewer choices may be requested');
  if(revoked)throw Object.assign(new Error('Доступ к обзору отозван'),{status:403});
  const wait=held.find(item=>!item.used&&item.matches(call));
  if(wait){wait.used=true;return wait.deferred.promise;}
  if(method==='GET')return projected(viewer,state);
  if(url.pathname.endsWith('/preview')){
   assert.equal(body.command.actorId,viewer,'A preview must use its selected observer');
   return {version:state.version,preview:fixtureFirePreview(body.command,{base:11})};
  }
  assert(url.pathname.endsWith('/commands'),'Unexpected transport endpoint');
  assert.equal(body.type,'declare');assert.equal(body.action.type,'fire');assert(!('gmFire' in body.action)&&!('gmMelee' in body.action)&&!('turnToTarget' in body.action));assert.equal(body.action.actorId,viewer,'Declarations cannot control an unselected or foreign actor');
  if(nextError){const error=nextError;nextError=null;throw error;}
  state.version++;state.pending=[{id:'declaration-private',actorId:viewer,action:body.action,status:'pending',preview:{text:'Выстрел'}}];
  return projected(viewer,state);
 };
 return {api,calls,state,hold:matches=>{const pending={matches,used:false,deferred:deferred()};held.push(pending);return pending.deferred;},failNext:error=>{nextError=error;},revoke:()=>{revoked=true;}};
}
const baseProps={campaignId:10,campaignName:'Личный обзор',accountId:2,onExit(){}};
async function mount(t){h.mount(SharedBattle,{...baseProps,api:t.api});await h.flush();}
const canvas=()=>h.find(node=>node.type==='canvas');
const renderData=()=>globalThis.__battleRendered;
const actionPreview=()=>h.find(node=>node.props['aria-label']==='Предпросмотр действия');
const actionPanel=()=>h.find(node=>node.props['aria-label']==='Действия выбранного персонажа');
const viewerPicker=()=>h.find(node=>node.type==='harness-select'&&h.nodes(node).some(child=>child.props['aria-label']==='Смотреть персонажем'));
async function switchViewer(id){await openBattleMenu(h);const picker=viewerPicker();assert(picker,'Both authenticated own actors have a viewpoint picker');picker.props.onValueChange(id);h.render();await h.flush();}
async function stageShot(targetId){await beginFixtureFire(h);const actor=renderData().state.actors.find(a=>a.id===targetId);assert(actor);globalThis.__battlePick({actorId:actor.id,x:actor.x,y:actor.y});h.render();await h.flush();assert(actionPreview(),'Actual BattleApp must stage a preview');}
function assertProjection(id){
 const actual=renderData(),other=id===A?B:A,privateSide=id===A?'EAST':'WEST';
 assert(canvas(),'Selected projected battle is mounted');assert.equal(actual.selectedId,id);assert.equal(actual.state.vision.actorId,id);
 assert.deepEqual(actual.state.actors.map(actor=>actor.id),[id,id===A?EA:EB]);
 assert(!actual.state.actors.some(actor=>actor.id===other),'Owned actors do not contribute a union view');
 assert(!JSON.stringify(actual.state).includes(privateSide+' PRIVATE'),'Other observer geometry, devices and logs are absent');
 assert.deepEqual(actual.state.tiles[3][id===A?9:2],{type:'unknown'});
}
let passed=0,failed=0;
async function test(name,run){
 storage.clear();delete globalThis.__battleRendered;
 try{await run();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.name+': '+error.message);const at=error.stack?.split('\n').find(line=>line.includes('test-private-battle-vision.mjs:'));if(at)console.error(at);}
 finally{h.dispose();env.timers.clear();}
}

await test('filtered A → B at the same version clears mounted A, pending preview, selection, and ignores delayed A responses',async()=>{
 const t=transport();await mount(t);assertProjection(A);
 assert.equal(renderData().state.version,20);
 // Start an A read before the user changes their observer, and leave it in flight.
 await openBattleMenu(h);const oldRead=t.hold(call=>call.method==='GET'&&call.viewer===A);
 await h.click('Обновить общий бой');
 const oldPreview=t.hold(call=>call.pathname.endsWith('/preview')&&call.viewer===A);
 await stageShot(EA);assert.deepEqual(t.calls.at(-1).body.command.targetIds,[EA]);assert(h.text(actionPreview()).includes('Западный охранник'),'Selected fire target stays visible while its preview is pending');assert.equal(renderData().preview,null);
 const previousRenderers=globalThis.__battleRenderers;
 const nextRead=t.hold(call=>call.method==='GET'&&call.viewer===B);
 await switchViewer(B);
 assert(!canvas(),'Old observer canvas must unmount while the new projection is pending');
 assert(!actionPreview(),'Old pending command must leave the rendered tree immediately');
 assert(!h.text().includes('Западный охранник'),'Old observer target must disappear before B arrives');
 assert.equal(t.calls.at(-1).path,'/api/campaigns/10/battle?viewerActorId='+B);
 nextRead.resolve(projected(B));await h.flush();assertProjection(B);
 assert.equal(renderData().state.version,20,'Same-version projections are legitimate on an observer switch');
 assert(globalThis.__battleRenderers>previousRenderers,'Observer change remounts the actual BattleApp renderer');
 assert(!actionPreview());assert(!actionPanel());assert.equal(renderData().targetId,undefined);assert.equal(renderData().preview,null);
 assert.match(canvas().props.className,/tool-inspect/,'Action state resets as well as selected actor');
 const bSnapshot=structuredClone(renderData());
 oldRead.resolve(projected(A));oldPreview.resolve({version:20,preview:{...fixtureFirePreview({type:'fire',mode:'single',rounds:1,targetIds:[EA]},{base:99,difficulty:1}),text:'STALE A PREVIEW'}});
 await h.flush();assertProjection(B);assert.deepEqual(renderData(),bSnapshot,'Late A poll or preview must not restore A state');
 assert(!h.text().includes('STALE A PREVIEW'));assert(!actionPreview());
 // Switching back is also a fresh projection, with no B leftovers.
 await switchViewer(A);assertProjection(A);assert(!actionPreview());
});

await test('a delayed denied A preview cannot clear an already authorized B projection',async()=>{
 const t=transport();await mount(t);
 const preview=t.hold(call=>call.pathname.endsWith('/preview')&&call.viewer===A);await stageShot(EA);
 await switchViewer(B);assertProjection(B);const bSnapshot=structuredClone(renderData());
 preview.reject(Object.assign(new Error('Старый обзор A отозван'),{status:403}));await h.flush();
 assertProjection(B);assert.deepEqual(renderData(),bSnapshot);assert(!h.text().includes('Старый обзор A отозван'));
});

await test('visible enemy and visible unselected own character remain read-only',async()=>{
 const t=transport({visibleOtherOwn:true});await mount(t);
 const source=renderData().state;
 assert.equal(source.actors.find(actor=>actor.id===EA).stats,undefined);
 assert.equal(source.actors.find(actor=>actor.id===B).weapon,undefined,'Own but unselected sheet is genuinely redacted');
 await openBattleMenu(h);const choices=h.nodes(viewerPicker()).filter(node=>node.type==='harness-select-item').map(node=>node.props.value);
 assert.deepEqual(choices,[A,B],'Viewer choices contain authenticated own actors, never a visible enemy');
 for(const id of [EA,B]){
  const actor=source.actors.find(item=>item.id===id);globalThis.__battlePick({actorId:id,x:actor.x,y:actor.y});h.render();await h.flush();
  assert(h.text().includes('Личные характеристики и содержимое инвентаря этого персонажа закрыты.'));
  assert(!actionPanel(),'Inspecting a read-only actor cannot open its action panel');
  assert.equal(renderData().selectedId,A,'Inspection cannot promote a visible actor to controlled actor');
 }
 await stageShot(EA);assert.equal(t.calls.at(-1).body.command.actorId,A);await h.click('Отправить ГМу');
 const sent=t.calls.findLast(call=>call.body?.type==='declare');assert.equal(sent.body.action.actorId,A);assert.deepEqual(sent.body.action.targetIds,[EA]);
 const count=t.calls.length;await switchViewer(B);assert.equal(t.calls.length,count,'A pending declaration prevents changing observer');assert.equal(renderData().selectedId,A);
});

await test('403 revocation removes the projected battle and delayed previews cannot bring it back',async()=>{
 const t=transport();await mount(t);const oldPreview=t.hold(call=>call.pathname.endsWith('/preview'));
 await stageShot(EA);const oldPick=globalThis.__battlePick;
 t.revoke();await openBattleMenu(h);await h.click('Обновить общий бой');
 assert(!canvas());assert(!actionPreview());assert(!actionPanel());assert(!h.find(node=>node.props['data-battle-original']==='true'));
 assert(h.text().includes('Доступ к обзору отозван'));assert(!h.text().includes('Западный охранник'));
 oldPreview.resolve({version:20,preview:{...fixtureFirePreview({type:'fire',mode:'single',rounds:1,targetIds:[EA]}),text:'STALE REVOKED PREVIEW'}});oldPick({actorId:EA,x:3,y:3});await h.flush();
 assert(!canvas());assert(!actionPreview());assert(!h.text().includes('STALE REVOKED PREVIEW'));
 await h.click('Подключиться ещё раз');assert(!canvas(),'Repeated denied reads remain fail-closed');
});

await test('403 from an action preview immediately clears the previous private projection',async()=>{
 const t=transport();await mount(t);
 const oldRead=t.hold(call=>call.method==='GET');await openBattleMenu(h);await h.click('Обновить общий бой');
 const preview=t.hold(call=>call.pathname.endsWith('/preview'));await stageShot(EA);
 t.revoke();preview.reject(Object.assign(new Error('Доступ к обзору отозван'),{status:403}));await h.flush();
 assert(!canvas(),'A denied preview is an authorization failure and must clear the previous observer map immediately');
 assert(!actionPreview());assert(!h.text().includes('Западный охранник'));
 oldRead.resolve(projected(A));await h.flush();assert(!canvas(),'A pre-revocation poll cannot resurrect the revoked projection');
});

await test('403 from a declaration clears the map and its persisted request',async()=>{
 const t=transport();await mount(t);await stageShot(EA);t.revoke();await h.click('Отправить ГМу');
 assert(!canvas());assert(!actionPreview());assert.equal(storage.size,0,'A definite authorization denial is not an uncertain request');
 assert(h.text().includes('Доступ к обзору отозван'));
});

await test('no accepted scene actor yields only unknown geometry and no controls',async()=>{
 const t=transport({noActor:true});await mount(t);
 assert(canvas(),'Empty projected map can render its safe unknown-cell shell');
 assert.deepEqual(renderData().state.actors,[]);assert.deepEqual(renderData().state.props,[]);assert.deepEqual(renderData().state.devices,[]);
 assert.deepEqual(renderData().state.log,[]);assert.deepEqual(renderData().state.vision.cells,[]);
 assert(renderData().state.tiles.flat().every(tile=>JSON.stringify(tile)==='{"type":"unknown"}'));
 assert.equal(renderData().selectedId,undefined);assert(h.text().includes('чужой обзор закрыт'));
 for(const label of ['Атака','Огонь','Идти','Заряд','Завершить ход'])assert(!h.button(label),'No-actor UI cannot expose '+label);
 await openBattleMenu(h);assert(!viewerPicker());
 const before=t.calls.length;globalThis.__battlePick({actorId:EA,x:3,y:3});h.render();await h.flush();
 assert.equal(t.calls.length,before);assert(!actionPreview());assert(!actionPanel());
});

await test('uncertain declaration from B restores B on remount and retries the exact original request',async()=>{
 const t=transport({turn:B});await mount(t);await switchViewer(B);assertProjection(B);
 await stageShot(EB);assert.equal(t.calls.at(-1).path,'/api/campaigns/10/battle/preview?viewerActorId='+B);
 t.failNext(new Error('Connection lost after request'));await h.click('Отправить ГМу');
 const uncertain=t.calls.findLast(call=>call.body?.type==='declare');assert.equal(uncertain.viewer,B);assert.equal(uncertain.body.expectedVersion,20);assert.equal(uncertain.body.action.actorId,B);
 assert.equal(storage.size,1);assert.deepEqual(JSON.parse([...storage.values()][0]),uncertain.body);
 assert(h.text().includes('Ответ на запрос не получен'));
 const beforeSwitch=t.calls.length;await switchViewer(A);assert.equal(t.calls.length,beforeSwitch,'Unknown write outcome locks observer selection');
 h.dispose();const beforeRemount=t.calls.length;await mount(t);
 assert.equal(t.calls[beforeRemount].path,'/api/campaigns/10/battle?viewerActorId='+B,'Persisted declaration actor restores its observer before the first remount read');
 assertProjection(B);assert(h.text().includes('Ответ на запрос не получен'));assert(!actionPreview(),'Draft preview does not survive a remount');
 await h.click('Проверить и повторить тот же запрос');
 const retried=t.calls.findLast(call=>call.body?.type==='declare');assert.equal(retried.path,uncertain.path);assert.deepEqual(retried.body,uncertain.body,'Retry preserves id, battle, expected version, actor and target');
 assert.equal(storage.size,0);assertProjection(B);assert.equal(renderData().state.version,21);
 assert(!h.text().includes('Ответ на запрос не получен'));
});

console.log(`Private battle frontend regression: ${passed} passed, ${failed} failed. Actual SharedBattle and BattleApp; renderer and filtered server transport mocked. No browser/device claim.`);
if(failed)process.exitCode=1;
