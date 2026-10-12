import {openBattleMenu,clickBattleControl,showBattleActorActions,clickBattleAction} from './battle-ui-navigation.mjs';
import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
import {confirmedFixtureScene,fixtureFirePreview,beginFixtureFire,confirmFixtureFire} from './combat-loadout-fixture.mjs';
const env=installEnvironment(),h=createHarness(),pending=new Map(),native=[];
globalThis.sessionStorage={getItem:k=>pending.get(k)||null,setItem:(k,v)=>pending.set(k,v),removeItem:k=>pending.delete(k)};
env.window.NightCityNative={postMessage:value=>native.push(value)};
const style=JSON.stringify({palette:'ultraviolet',treatment:'raw',digital:false,bootEnabled:false,bootVariant:'signature'});env.storage.set('nc20.interface.v1',style);
const {SharedBattle}=await loadModules(h,undefined,{actualSharedBattle:true});
const ordinary={role:'gm',controlledActorIds:[],battle:null,options:{characters:[]}};
let real=structuredClone(ordinary),training={...structuredClone(ordinary),training:true,demoCompatible:true},calls=[],unknown=null;
function seed(version){const scene=confirmedFixtureScene(createDemoScene());scene.version=version;scene.currentActorId=null;return {role:'gm',training:true,demoCompatible:true,controlledActorIds:scene.actors.map(a=>a.id),options:{characters:[]},battle:{id:'training-test',version,phase:scene.phase,scene,pending:[],log:[],canUndo:false}};}
const api=async(path,method='GET',body)=>{
 calls.push({path,method,body:structuredClone(body)});const trial=path.includes('/training');
 if(method==='GET')return structuredClone(trial?training:real);
 assert.equal(method,'POST');
 if(path.endsWith('/preview'))return {version:training.battle.version,preview:body.command.type==='fire'?fixtureFirePreview(body.command):{ok:true,text:({move:'Переместиться',shoot:'Выстрел',reload:'Перезарядить',control:'Открыть дверь'})[body.command.type]||'Выполнить',distance:8,base:7,difficulty:15,chance:.7,location:'random',line:{cover:false},path:[{x:6,y:11}],count:1,program:{name:'Genie',strength:5},device:{type:'door'}}};
 if(!trial){assert.equal(body.type,'prepare');assert.equal(body.actors.length,0);real={...ordinary,battle:{id:'saved-empty',version:1,phase:'preparation',scene:{...createDemoScene(),...body,actors:[],devices:[],log:[],currentActorId:null},pending:[],log:[]}};return structuredClone(real);}
 if(unknown){const error=unknown;unknown=null;throw error;}
 if(body.type==='training-start'){if(!training.battle)training=seed(1);}
 else if(body.type==='training-reset')training=seed(training.battle.version+1);
 else {assert.equal(body.battleId,training.battle.id);assert.equal(body.expectedVersion,training.battle.version);training.battle.version++;const s=training.battle.scene;s.version=training.battle.version;const actor=s.actors.find(a=>a.id===body.actorId);
  if(body.type==='start'){assert(s.actors.every(a=>a.loadout&&!a.loadout.legacy),'Start fixture requires confirmed canonical loadouts');s.phase=training.battle.phase='combat';s.order=s.actors.map(a=>a.id);s.index=0;s.currentActorId=s.order[0];}
  if(body.type==='end'){s.index=(s.index+1)%s.order.length;s.currentActorId=s.order[s.index];}
  if(body.type==='move'){actor.x=body.x;actor.y=body.y;actor.moved=true;actor.actions++;}
  if(body.type==='fire'){assert.equal(body.mode,'single');assert.equal(body.rounds,1);assert.deepEqual(body.targetIds,['guard-1']);assert.equal(typeof body.gmFire?.turnToTarget,'boolean');const weapon=actor.loadout.weapons.find(w=>w.id===actor.loadout.activeWeaponId);weapon.ammo-=body.rounds;actor.loadout.ammoPools[weapon.ammoItemId]-=body.rounds;actor.weapon.ammo=weapon.ammo;actor.shots+=body.rounds;actor.shotsByWeapon[weapon.id]=(actor.shotsByWeapon[weapon.id]||0)+body.rounds;actor.actions++;s.log.push({id:'fire-visual-'+s.version,kind:'shoot',visualOnly:true,hit:false,damage:0,text:'Подтверждённый промах',roll:2,from:{x:actor.x,y:actor.y},to:{x:16,y:8},actorIds:[actor.id,'guard-1']},{id:'fire-'+s.version,kind:'shoot',effectSuppressed:true,mode:body.mode,rounds:body.rounds,hits:0,hit:false,damage:0,text:'Тестовое огневое действие: 1 патрон, 0 попаданий.',actorIds:[actor.id,'guard-1']});}
  assert.notEqual(body.type,'shoot','New shots cannot call the retired per-bullet command');
  if(body.type==='reload'){const weapon=actor.loadout.weapons.find(w=>w.id===actor.loadout.activeWeaponId);weapon.ammo++;actor.weapon.ammo=weapon.ammo;actor.weapon.reserve--;}
  if(body.type==='connect')actor.net.linkedPortId=body.deviceId;
  if(body.type==='scan')actor.net.knownDeviceIds=s.devices.filter(d=>d.type!=='port').map(d=>d.id);
  if(body.type==='control'){actor.net.controlUsed=true;const device=s.devices.find(d=>d.id===body.deviceId);s.tiles[device.y][device.x].open=true;s.log.push({id:'net-'+s.version,kind:'control',success:true,roll:3,strength:5,program:'Genie',text:'Команда выполнена'});}
  training.battle.log=s.log;
 }
 return structuredClone(training);
};
const props={campaignId:10,campaignName:'Пустая кампания',accountId:1,api,onExit(){}};
const change=async(node,value)=>{node.props.onChange({target:{value}});h.render();await h.flush();};
const pick=async(cell)=>{globalThis.__battlePick(cell);h.render();await h.flush();};
const back=async()=>{env.window.dispatchEvent(new Event('nightcity-battle-back',{cancelable:true}));h.render();await h.flush();};
h.mount(SharedBattle,props);await h.flush();assert.equal(native.at(-1),'battle-enter');assert.equal(env.document.body.style.overflow,'hidden');
assert(h.find(n=>n.type==='canvas'),'GM immediately sees empty original map');assert(!calls.some(c=>c.method==='POST'));
await clickBattleControl(h,'Участники и карта');const nameInput=()=>h.find(n=>n.type==='input'&&n.props.maxLength===100);await change(nameInput(),'Мой черновик');
await back();assert(h.text().includes('Несохранённые изменения подготовки'));await h.click('Остаться');assert.equal(nameInput().props.value,'Мой черновик');
await clickBattleControl(h,'Пробный бой');assert(!calls.some(c=>!c.path.includes('/training')&&c.method==='POST'));assert(h.find(n=>n.props['aria-label']==='Пробный бой без последствий'));assert.equal(calls.filter(c=>c.body?.type==='training-start').length,1);
assert.deepEqual(training.battle.scene.actors.map(a=>a.id),['ray','mira','guard-1','guard-2']);assert(h.text().includes('Тренировка'));await openBattleMenu(h);assert(h.button('Начать бой'));
await clickBattleControl(h,'Начать бой');assert(h.find(n=>n.props['aria-label']==='Очередь ходов'));assert.equal(globalThis.__battleRendered.selectedId,'ray');
await clickBattleAction(h,'Идти');await pick({x:6,y:11});assert(h.text().includes('Предел за раунд'));await h.click('Переместиться');assert.equal(training.battle.scene.actors[0].y,11);
await beginFixtureFire(h);await pick({actorId:'guard-1',x:16,y:8});assert(h.text().includes('патронов в одном действии'));await confirmFixtureFire(h);assert.equal(training.battle.scene.actors[0].weapon.ammo,7);assert(h.find(n=>n.props['aria-label']==='Результат действия'));assert(h.text().includes('Огневое действие'));assert(/0\s+попаданий/.test(h.text()));
await clickBattleAction(h,'Заряд');assert(/Загрузить\s+1\s+патронов/.test(h.text()));await h.click('Перезарядить');assert.equal(training.battle.scene.actors[0].weapon.ammo,8);
await clickBattleAction(h,'Завершить ход');assert.equal(globalThis.__battleRendered.selectedId,'mira');await showBattleActorActions(h);assert(h.button('Сеть'));
await clickBattleAction(h,'Сеть');await h.click('Подключить к порту');await h.click('Найти устройства');await h.click('Открыть');assert(/Genie\s*:\s*d10 ≤\s*5/.test(h.text()));await h.click('Выполнить команду');assert(training.battle.scene.actors.find(a=>a.id==='mira').net.controlUsed);assert(h.text().includes('Управление выполнено'));
await h.click('К подготовке');assert.equal(nameInput().props.value,'Мой черновик');assert.equal(env.storage.get('nc20.interface.v1'),style);assert(!native.includes('battle-exit'),'Switching training must not unlock portrait');
await clickBattleControl(h,'Пробный бой');assert.equal(calls.filter(c=>c.body?.type==='training-start').length,1);await clickBattleControl(h,'Сцена и сохранение');await h.click('Сбросить демонстрацию');await h.click('Вернуться к сцене');assert.equal(calls.filter(c=>c.body?.type==='training-reset').length,0);
await h.click('Сбросить демонстрацию');await h.click('Сбросить демонстрацию');assert.equal(training.battle.phase,'preparation');assert.equal(training.battle.scene.actors[0].weapon.ammo,8);
await clickBattleControl(h,'Начать бой');await beginFixtureFire(h);await pick({actorId:'guard-1',x:16,y:8});unknown=new Error('Lost training reply');await confirmFixtureFire(h);assert.equal(pending.size,1);assert([...pending.keys()][0].endsWith(':training'));const original=calls.at(-1).body;await h.click('Проверить и повторить тот же запрос');assert.deepEqual(calls.at(-1).body,original);assert.equal(pending.size,0);
await h.click('К подготовке');await h.find(n=>n.type==='form'&&n.props.className==='nc-shared-setup').props.onSubmit({preventDefault(){}});h.render();await h.flush();assert.equal(real.battle.scene.name,'Мой черновик');assert.equal(real.battle.scene.actors.length,0);await openBattleMenu(h);assert(h.button('Начать бой').props.disabled);h.dispose();assert.equal(native.at(-1),'battle-exit');assert.equal(env.document.body.style.overflow,'');
// An older stored demonstration is never silently replaced on opening.
training=seed(20);training.battle.scene.actors=training.battle.scene.actors.slice(0,2);training.demoCompatible=false;h.mount(SharedBattle,props);await h.flush();await clickBattleControl(h,'Пробный бой');assert.equal(training.battle.scene.actors.length,2);assert(h.text().includes('Прежняя тренировка сохранена, включая ручное скрытие.'));assert(h.text().includes('В новой сцене охранник не скрыт вручную.'));assert.equal(calls.filter(c=>c.body?.type==='training-start').length,1);h.dispose();
console.log('Original training: four-actor bar, initiative, move preview, shot result, reload, NET connect/scan/control, isolated real draft, explicit reset, legacy preservation, exact retry and native enter/exit passed. Renderer mocked; no device claim.');
