import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {clickBattleControl,showBattleActorActions} from './battle-ui-navigation.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';

const env=installEnvironment(),h=createHarness(),storage=new Map();
globalThis.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
// Only the DOM lookup used by preparation guards is modeled here. The actual
// SharedBattle, BattleApp and LoadoutEditor components all run through hooks.
document.querySelector=selector=>selector==='[data-loadout-draft="true"]'?h.find(node=>node.props['data-loadout-draft']==='true')??null:null;
let nativeBack;
const addEventListener=env.window.addEventListener.bind(env.window);
env.window.addEventListener=(name,callback,options)=>{if(name==='nightcity-battle-back')nativeBack=callback;return addEventListener(name,callback,options);};
const {SharedBattle,blank,newItem}=await loadModules(h,undefined,{actualSharedBattle:true});
const makeCharacter=()=>{const data=blank('Реальный лист');data.skills=[{name:'Handgun',stat:'REF',rank:7,ip:0,multiplier:1}];data.items=[{...newItem('weapon'),id:'real-gun',name:'Militech Ronin, но имя не профиль',quantity:1,icon:'rifle'},{...newItem('ammo'),id:'real-ammo',name:'Патроны',quantity:30}];return {id:11,owner_id:1,name:data.name,version:3,data};};
const empty=()=>({role:'gm',controlledActorIds:[],battle:null,options:{characters:[makeCharacter()],sceneLoadouts:[]}});
function projectedScene(training=false,version=10){
 const scene=createDemoScene();scene.version=version;scene.phase='preparation';scene.order=[];scene.index=-1;scene.currentActorId=null;
 scene.actors=scene.actors.slice(0,2).map((actor,index)=>({...actor,id:'scene-'+index,characterId:training?-index-1:null,origin:{kind:training?'training':'npc'},sheetVersion:0}));
 const sceneLoadouts=scene.actors.map(actor=>{
  const weapon=actor.weapon,data=blank(actor.name),ammoItemId='ammo-'+weapon.id;
  data.skills=[{name:'Handgun',stat:'REF',rank:actor.stats.handgun,ip:0,multiplier:1},{name:'Dance',stat:'REF',rank:10,ip:0,multiplier:1}];
  data.items=[{...newItem('weapon'),id:weapon.id,name:weapon.name,quantity:1},{...newItem('ammo'),id:ammoItemId,name:'Боеприпасы сцены',quantity:weapon.ammo+weapon.reserve}];
  // This mirrors the server's explicit source suggestion. No capability fields
  // are supplied: the client may not derive them from ROF or the weapon name.
  data.profileSuggestions={[weapon.id]:{weaponId:weapon.id,kind:'ranged',weaponType:'handgun',skillName:'Handgun',skillRank:actor.stats.handgun,ammoItemId,profileId:'Core 2020 p61–63: числа и VR; режимы / класс ошибки — решение ГМа',damageDice:String(weapon.damageDice),damageBonus:String(weapon.damageBonus),accuracy:String(weapon.accuracy),range:String(weapon.range),rof:String(weapon.rof),magazine:String(weapon.magazine),loaded:String(weapon.ammo),reliability:'VR'}};
  return {actorId:actor.id,data};
 });
 return {role:'gm',controlledActorIds:[],options:{characters:[],sceneLoadouts},battle:{id:training?'training-scene':'npc-scene',version,phase:'preparation',scene,pending:[],log:[],canUndo:false}};
}
let state=empty(),trainingState=projectedScene(true),calls=[],exits=0,props;
const commands=()=>calls.filter(call=>call.body?.type==='configure-loadout'||call.body?.action?.type==='configure-loadout');
const api=async(path,method='GET',body)=>{
 calls.push({path,method,body:structuredClone(body)});
 const training=path.includes('/training'),current=training?trainingState:state;
 if(method==='GET')return structuredClone(current);
 assert.equal(method,'POST');
 if(body.type==='configure-loadout'){
  // Minimal transport success fixture: no client engine, dice or inventory rule
  // implementation. Its only purpose is to return the submitted confirmed data.
  const next=structuredClone(current),actor=next.battle.scene.actors.find(row=>row.id===body.actorId);
  if(actor){actor.loadout={schemaVersion:1,activeWeaponId:body.config.activeWeaponId,weapons:body.config.weapons.map(config=>{const weapon={...config,id:config.weaponId,name:next.options.sceneLoadouts.find(row=>row.actorId===body.actorId).data.items.find(item=>item.id===config.weaponId).name,skill:'selectedWeapon'};if(weapon.kind==='ranged'){weapon.ammo=weapon.loaded;delete weapon.loaded;}return weapon;}),ammoPools:{},itemBindings:{},sheetVersion:0,legacy:false};}
  next.battle.version++;next.battle.scene.version=next.battle.version;if(training)trainingState=next;else state=next;return next;
 }
 if(body.type==='prepare'){state=projectedScene(false,1);return structuredClone(state);}
 if(body.type==='training-start'){trainingState=projectedScene(true,1);return structuredClone(trainingState);}
 throw new Error('Unexpected command '+body.type);
};
const mount=async(next=projectedScene())=>{h.dispose();storage.clear();calls=[];state=next;trainingState=projectedScene(true);props={campaignId:10,campaignName:'Ночная смена',accountId:1,api,onExit:()=>exits++};h.mount(SharedBattle,props);await h.flush();};
const field=label=>{const node=h.find(row=>row.props['aria-label']===label);assert(node,'Missing field '+label);return node;};
const change=async(label,value)=>{const node=field(label);assert(!node.props.disabled,'Disabled field '+label);node.props.onChange({target:{value:String(value),checked:value,valueAsNumber:Number(value)}});h.render();await h.flush();};
const text=()=>h.text().replace(/\s+/g,' ');
const equipmentForm=()=>h.find(node=>node.type==='form'&&h.text(node).includes('Сохранить набор сцены'));
const submitEquipment=async()=>{const form=equipmentForm();assert(form,'Equipment form must be open');await form.props.onSubmit({preventDefault(){}});h.render();await h.flush();};
const back=async(handler)=>{const event=new Event('nightcity-battle-back',{cancelable:true});if(handler)handler(event);else env.window.dispatchEvent(event);assert(event.defaultPrevented);h.render();await h.flush();};
const openEquipment=async(actorId='scene-0')=>{await showBattleActorActions(h,actorId);await h.click(h.button('Подтвердить оружие по правилам 2020')||h.button('Оружие и режимы')); assert(equipmentForm());};
const openProfile=async()=>{await h.click('Добавить профиль оружия');await change('Строка оружия профиля','colt-amt2000');};
const commitProfile=async()=>{await change('Одиночных атак за одно действие',1);await change('Класс оружия для неудачи','nonautomatic');await change('Режим: Одиночный',true);await change('Подтверждение профиля ГМом',true);await h.click('Подтвердить профиль');assert(!h.find(node=>node.props['data-loadout-draft']==='true'));};
const poll=async()=>{for(const callback of [...env.timers.values()])callback();await h.flush();};
const failures=[];
async function test(name,run){try{await run();console.log('PASS '+name);}catch(error){failures.push({name,error});console.error('FAIL '+name+': '+error.message);}finally{h.dispose();storage.clear();}}

await test('new character preparation sends an explicit empty loadout and no guessed weapon',async()=>{
 await mount(empty());await clickBattleControl(h,'Участники и карта');await h.click('Добавить участника');
 assert.equal(field('Активное оружие набора').props.value,'');assert(!text().includes('2d6'));
 const agreement=h.find(node=>node.type==='label'&&h.text(node).includes('Я проверил параметры оружия'));
 if(agreement){h.nodes(agreement).find(node=>node.type==='input').props.onChange({target:{checked:true}});h.render();await h.flush();}
 const form=h.find(node=>node.type==='form'&&h.text(node).includes('Сохранить общую подготовку'));
 await form.props.onSubmit({preventDefault(){}});h.render();await h.flush();
 const sent=calls.findLast(call=>call.body?.type==='prepare');assert(sent);assert.equal(sent.path,'/api/campaigns/10/battle');assert.deepEqual(sent.body.actors[0].loadout,{weapons:[],activeWeaponId:null});assert.equal(sent.body.actors[0].weapon,null);
});

await test('GM training actor opens equipment; source hints require explicit capabilities before save',async()=>{
 await mount(empty());await clickBattleControl(h,'Пробный бой');assert(h.find(node=>node.props['aria-label']==='Пробный бой без последствий'));
 await openEquipment();await openProfile();
 const expected={'Урон: число d6':'4','Добавка к урону':'1','Точность WA':'0','Дальность, м':'50','ROF: выстрелов за весь раунд':'1','Вместимость магазина':'8','Заряжено сейчас':'8','Надёжность оружия':'VR'};
 for(const [label,value] of Object.entries(expected))assert.equal(field(label).props.value,value,label);
 assert.equal(field('Боевой навык профиля').props.value,'Handgun');assert.equal(field('Класс оружия для неудачи').props.value,'');assert.equal(field('Одиночных атак за одно действие').props.value,'');
 for(const mode of ['Одиночный','Очередь из трёх','Автоогонь','Подавление'])assert.equal(field('Режим: '+mode).props.checked,false);
 assert.equal(field('Подтверждение профиля ГМом').props.checked,false);assert.equal(commands().length,0);
 await submitEquipment();assert.equal(commands().length,0,'An internal profile draft must block the outer save');assert.match(text(),/Сначала подтверди профиль/);
 await change('Подтверждение профиля ГМом',true);await h.click('Подтвердить профиль');assert(h.find(node=>node.props['data-loadout-draft']==='true'),'Missing capabilities cannot commit a source suggestion');
 await commitProfile();await change('Активное оружие набора','colt-amt2000');await submitEquipment();
 const sent=commands().at(-1);assert(sent);assert.equal(sent.path,'/api/campaigns/10/battle/training/commands');assert.equal(sent.body.actorId,'scene-0');assert.equal(sent.body.expectedVersion,10);assert.equal(sent.body.battleId,'training-scene');assert.equal(sent.body.config.activeWeaponId,'colt-amt2000');
 const config=sent.body.config.weapons[0];assert.deepEqual(config.fireModes,['single']);assert.equal(config.singleActionCap,1);assert.equal(config.fumbleClass,'nonautomatic');assert.equal(config.reliability,'VR');assert.equal(config.loaded,8);assert.equal(config.skillRank,4);assert(!('ammo' in config));assert(!('resetReadiness' in sent.body.config),'Readiness is not silently reset');assert(!equipmentForm());
});

await test('NPC dirty committed draft prompts on native Back; Stay and discard preserve server state',async()=>{
 await mount();const original=structuredClone(state);await openEquipment();await openProfile();await commitProfile();await change('Активное оружие набора','colt-amt2000');
 const exitCount=exits;await back();assert(h.button('Остаться'));assert.equal(exits,exitCount);await h.click('Остаться');assert(equipmentForm());assert.equal(field('Активное оружие набора').props.value,'colt-amt2000');
 await back();await h.click('Закрыть набор без сохранения');assert(!equipmentForm());assert.deepEqual(state,original);assert.equal(commands().length,0);
 await openEquipment();assert.equal(field('Активное оружие набора').props.value,'');assert(!text().includes('магазин 8/8'));await h.click('Назад');assert(!equipmentForm());assert(!h.button('Остаться'));
});

await test('native Back prompts for a child-only profile draft without relying on a parent rerender',async()=>{
 await mount();await openEquipment();const parentBackBeforeChildEdit=nativeBack;await openProfile();await change('Источник профиля ГМа','Незавершённый источник');
 // Real React child-local useState does not rerender BattleSession. The harness
 // normally rerenders its whole tree, so use the captured parent listener to
 // reproduce that real lifecycle rather than accidentally masking the bug.
 await back(parentBackBeforeChildEdit);assert(h.button('Остаться'),'Native Back silently discarded a child-only profile draft');assert.equal(commands().length,0);
});

await test('Stay after an internal-profile leave prompt keeps every uncommitted field',async()=>{
 await mount();await openEquipment();await openProfile();await change('Источник профиля ГМа','Незавершённый источник');await change('Урон: число d6',9);
 await back();assert(h.button('Остаться'));await h.click('Остаться');assert(equipmentForm());assert.equal(field('Источник профиля ГМа').props.value,'Незавершённый источник');assert.equal(field('Урон: число d6').props.value,'9');assert.equal(commands().length,0);
});

await test('scene version change keeps the draft but prevents stale configuration writes',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();state=structuredClone(state);state.battle.version++;state.battle.scene.version++;
 await poll();await submitEquipment();assert.equal(commands().length,0);assert.match(text(),/Сцена изменилась/);assert(equipmentForm());
});

await test('actor removal from the current projection cannot save an old equipment context',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();state=structuredClone(state);state.battle.scene.actors=state.battle.scene.actors.filter(actor=>actor.id!=='scene-0');state.options.sceneLoadouts=state.options.sceneLoadouts.filter(row=>row.actorId!=='scene-0');
 await poll();if(equipmentForm())await submitEquipment();assert.equal(commands().length,0,'An actor missing from the current projection must not be reconfigured from a stale dialog');
});

await test('account change cannot submit the previous account equipment draft',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();props={...props,accountId:99};h.update(props);await h.flush();
 if(equipmentForm())await submitEquipment();assert.equal(commands().length,0,'Changing accounts must invalidate the previous account equipment context');
});

await test('a revoked GM projection cannot submit the previous equipment draft as a declaration',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();state=structuredClone(state);state.role='player';state.options.sceneLoadouts=[];
 await poll();if(equipmentForm())await submitEquipment();assert.equal(commands().length,0,'A lost GM role must block the old configuration, including declaration wrapping');
});

await test('combat phase blocks an equipment context opened during preparation',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();state=structuredClone(state);state.battle.phase='combat';state.battle.scene.phase='combat';
 await poll();if(equipmentForm())await submitEquipment();assert.equal(commands().length,0,'An equipment context cannot configure a now-active combat scene');
});

await test('a replaced battle identity cannot receive the prior scene equipment draft',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();state=structuredClone(state);state.battle.id='replacement-scene-same-version';
 await poll();if(equipmentForm())await submitEquipment();assert.equal(commands().length,0,'Equal version numbers do not make two battle identities interchangeable');
});

await test('scene readiness reset is an explicit separate opt-in and does not refill magazines',async()=>{
 await mount();await openEquipment();await openProfile();await commitProfile();
 const label=h.find(node=>node.type==='label'&&h.text(node).includes('ГМ подтверждает: выроненное оружие подобрано'));
 assert(label);const checkbox=h.nodes(label).find(node=>node.type==='input');assert.equal(checkbox.props.checked,false);checkbox.props.onChange({target:{checked:true}});h.render();await h.flush();
 await submitEquipment();const config=commands().at(-1).body.config;assert.equal(config.resetReadiness,true);assert.equal(config.resetLoaded,undefined);assert.equal(config.weapons[0].loaded,8);
});

await test('switching NPC contexts cannot carry a previous profile draft into another actor',async()=>{
 await mount();await openEquipment('scene-0');await openProfile();await change('Источник профиля ГМа','Только первый НПС');await back();await h.click('Закрыть набор без сохранения');
 await openEquipment('scene-1');assert.equal(field('Активное оружие набора').props.value,'');await openProfile();assert.notEqual(field('Источник профиля ГМа').props.value,'Только первый НПС');await commitProfile();await submitEquipment();assert.equal(commands().at(-1).body.actorId,'scene-1');
});

if(failures.length){console.error(`Scene loadout UI: ${failures.length} failed case(s).`);for(const failure of failures)console.error(' - '+failure.name+': '+failure.error.message);process.exitCode=1;}else console.log('Scene loadout UI passed. Actual React hook integration; canvas and transport mocked, no browser/device claim.');
