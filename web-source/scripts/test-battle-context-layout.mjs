import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
import {openBattleMenu,clickBattleControl,showBattleActorActions,clickBattleAction} from './battle-ui-navigation.mjs';
import {confirmedFixtureScene} from './combat-loadout-fixture.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';

const env=installEnvironment(),h=createHarness();
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
const {SharedBattle}=await loadModules(h,undefined,{actualSharedBattle:true});
const panels=()=>h.nodes().filter(n=>n.props.className?.split(' ').includes('battle-context-panel'));
const named=label=>h.find(n=>n.props['aria-label']===label);
const actions=()=>named('Действия выбранного персонажа');
const intent=()=>named('Предпросмотр действия');
const scene=(phase='combat',empty=false)=>{const s=confirmedFixtureScene(createDemoScene());s.phase=phase;s.version=4;s.actors=empty?[]:s.actors;s.order=phase==='combat'?s.actors.map(a=>a.id):[];s.currentActorId=s.order[0]||null;s.index=0;return s;};
const response=(phase='combat',empty=false,role='gm')=>({role,controlledActorIds:role==='player'?['ray']:[],options:{characters:[]},battle:{id:'context-layout',version:4,phase,scene:scene(phase,empty),pending:[],log:[],canUndo:true}});
let state=response(),calls=[],exits=0,prepareFailure=null;
const api=async(path,method='GET',body)=>{
 calls.push({path,method,body:structuredClone(body)});
 if(method==='GET')return structuredClone(state);
 if(body?.type==='prepare'){if(prepareFailure)throw prepareFailure;state=response('preparation',true);return structuredClone(state);}
 if(path.endsWith('/preview'))return {version:state.battle.version,preview:{ok:true,text:body.command.type==='move'?'Переместиться':'Применить',distance:2,path:[{x:7,y:10}],count:1}};
 state=structuredClone(state);state.battle.version++;state.battle.scene.version=state.battle.version;
 return structuredClone(state);
};
const props={campaignId:81,campaignName:'Контекстная карта',accountId:1,api,onExit:()=>exits++};
const pick=async(actorId,x=7,y=10)=>{globalThis.__battlePick({actorId,x,y});h.render();await h.flush();};
const back=async()=>{const event=new Event('nightcity-battle-back',{cancelable:true});env.window.dispatchEvent(event);assert(event.defaultPrevented);h.render();await h.flush();};

// Preparation is an actual map, with no empty actor card or disabled battle bar.
state=response('preparation',true);h.mount(SharedBattle,props);await h.flush();
assert(named('Тактическая карта'));assert(h.find(n=>n.type==='canvas'));
assert.equal(panels().length,0);assert(!h.find(n=>n.type==='footer'));
assert(!named('Действия персонажа'));assert(!named('Быстрые действия боя'));assert(!h.text().includes('Нет участника'));
assert(!h.find(n=>n.props.className==='scene-caption'));
assert(h.button('Меню боя'));assert(h.button('Масштаб и сетка'));
await openBattleMenu(h);assert.equal(panels().length,1);assert(named('Управление боем'));
assert(h.button('Участники и карта'));assert(h.button('Конструктор карты'));
assert(h.button('Начать бой').props.disabled);
await h.click('Масштаб и сетка');assert.equal(panels().length,1);assert(named('Камера карты'));assert(!named('Управление боем'));
assert(h.button('Показать сетку'));assert(h.button('Показать всю карту'));
await back();assert.equal(panels().length,0);assert.equal(exits,0);h.dispose();

// A brand-new campaign has direct tools; map construction opens only after a verified save.
const unsaved=()=>({role:'gm',controlledActorIds:[],options:{characters:[]},battle:null});
state=unsaved();calls=[];h.mount(SharedBattle,props);await h.flush();await openBattleMenu(h);
assert(h.button('Добавить НПС'));assert(h.button('Импорт сцены'));assert(h.button('Сохранить и открыть конструктор'));
assert(h.text().includes('Карта будет сохранена перед добавлением'));assert(!calls.some(c=>c.method==='POST'));
await h.click('Сохранить и открыть конструктор');assert(h.button('Закрыть редактор карты'));
const preparation=calls.filter(c=>c.method==='POST');assert.equal(preparation.length,1);assert.equal(preparation[0].body.type,'prepare');assert.deepEqual(preparation[0].body.actors,[]);h.dispose();
for(const failure of [Object.assign(new Error('Preparation rejected'),{status:409}),new Error('Unknown preparation outcome')]){
 state=unsaved();prepareFailure=failure;calls=[];h.mount(SharedBattle,props);await h.flush();
 await clickBattleControl(h,'Сохранить и открыть конструктор');assert(!h.button('Закрыть редактор карты'));
 assert.equal(calls.filter(c=>c.method==='POST').length,1,'Failure must not retry automatically or enter the constructor');h.dispose();
}
prepareFailure=null;

// Combat starts with a compact queue. Actor selection opens one useful panel.
state=response();calls=[];h.mount(SharedBattle,props);await h.flush();
assert(named('Очередь ходов'));assert.equal(panels().length,0);assert(named('Действия персонажа'));assert(named('Быстрые действия боя'));
await pick('ray',6,10);assert(actions());assert.equal(panels().length,1);
for(const label of ['Идти','Атака','Заряд','Дверь','Завершить ход','Карточка персонажа Рэй'])assert(h.button(label),label);
await openBattleMenu(h);assert(!actions());assert.equal(panels().length,1);
await h.click('Масштаб и сетка');assert(!named('Управление боем'));assert.equal(panels().length,1);
await pick('ray',6,10);assert(actions());assert(!named('Камера карты'));
await h.click('Идти');assert.equal(panels().length,0);assert(!intent());assert(named('Отменить действие'));
assert.equal(calls.filter(c=>c.method==='POST').length,0,'Selecting an action does not mutate or even preview a target');
await pick(null,7,10);assert(intent());assert.equal(panels().length,0);
assert.equal(calls.filter(c=>c.method==='POST').length,1);assert(calls.at(-1).path.endsWith('/preview'));
assert.equal(calls.at(-1).body.command.actorId,'ray');assert.equal(calls.at(-1).body.expectedVersion,4);
const before=exits;await back();assert(!intent());assert(named('Отменить действие'));assert.equal(exits,before);
await back();assert(!named('Отменить действие'));assert.equal(exits,before);
await back();assert.equal(exits,before+1);h.dispose();

// Confirmation still uses the exact authoritative target and clears the targeting chrome.
state=response();calls=[];h.mount(SharedBattle,props);await h.flush();
await clickBattleAction(h,'Идти');await pick(null,7,10);await h.click('Переместиться');
const command=calls.find(c=>c.path.endsWith('/commands'));
assert(command);assert.equal(command.body.type,'move');assert.equal(command.body.actorId,'ray');assert.equal(command.body.x,7);assert.equal(command.body.y,10);assert.equal(command.body.expectedVersion,4);
assert(!intent());assert(!actions());assert(!named('Отменить действие'));
await showBattleActorActions(h);await back();assert(!actions());assert.equal(exits,before+1);h.dispose();

// A stunned actor can still finish its turn, as in the original turn controls.
state=response();state.battle.scene.actors[0].status='stunned';h.mount(SharedBattle,props);await h.flush();
await showBattleActorActions(h);assert(h.button('Идти').props.disabled);assert(!h.button('Завершить ход').props.disabled);h.dispose();

// The constructor keeps square footprints explicit and stages orientation for server validation.
state=response('preparation');calls=[];h.mount(SharedBattle,props);await h.flush();
await clickBattleControl(h,'Конструктор карты');assert.equal(panels().length,0);
let picker=h.find(n=>n.type==='harness-select'&&h.text(n).includes('Фургон · 5×2'));
assert(picker);picker.props.onValueChange('van');h.render();await h.flush();
await h.click('Повернуть предмет · Вправо →');
await pick(null,12,7);assert(intent());assert.equal(calls.at(-1).body.command.paint,'van');assert.equal(calls.at(-1).body.command.facing,90);assert(calls.at(-1).path.endsWith('/preview'));
assert(!calls.some(c=>c.path.endsWith('/commands')));await back();assert(!intent());await back();assert(!h.button('Закрыть редактор карты'));h.dispose();

// Player permissions stay contextual: another actor opens redacted details, never actions.
state=response('combat',false,'player');state.battle.scene.actors[2]={id:'guard-1',name:'Охранник',team:'hostile',sprite:2,x:16,y:8,status:'active',hidden:false};
h.mount(SharedBattle,{...props,accountId:2});await h.flush();
assert(!h.button('Отменить последнее действие'));await openBattleMenu(h);
for(const label of ['Участники и карта','Конструктор карты','Начать бой','Импорт сцены'])assert(!h.button(label),label+' is GM-only');
await pick('guard-1',16,8);assert(!actions());assert(h.text().includes('Личные характеристики и содержимое инвентаря этого персонажа закрыты.'));
await back();await pick('ray',6,10);assert(actions());assert(!h.button('Идти').props.disabled);h.dispose();

// Keyboard shortcuts never steal Space/number activation from focused controls.
state=response();calls=[];h.mount(SharedBattle,props);await h.flush();await showBattleActorActions(h);
for(const tagName of ['BUTTON','A','INPUT','SELECT','TEXTAREA']){
 for(const [key,code] of [[' ','Space'],['3','Digit3']]){
  const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:key},code:{value:code},target:{value:{tagName,getAttribute:()=>null,closest:()=>null}}});
  env.window.dispatchEvent(event);h.render();await h.flush();assert(!event.defaultPrevented);assert(actions());
 }
}
assert(!calls.some(c=>c.method==='POST'),'Focused UI controls never send an end-turn shortcut');
const escapeFromButton=new Event('keydown',{cancelable:true});Object.defineProperties(escapeFromButton,{key:{value:'Escape'},code:{value:'Escape'},target:{value:{tagName:'BUTTON',getAttribute:()=>null,closest:()=>null}}});env.window.dispatchEvent(escapeFromButton);h.render();await h.flush();assert(escapeFromButton.defaultPrevented);assert(!actions());assert(!calls.some(c=>c.method==='POST'),'Escape on a focused control closes the panel without a command');await showBattleActorActions(h);

const shortcut=new Event('keydown',{cancelable:true});Object.defineProperties(shortcut,{key:{value:'3'},code:{value:'Digit3'},target:{value:{tagName:'BODY',getAttribute:()=>null,closest:()=>null}}});env.window.dispatchEvent(shortcut);h.render();await h.flush();assert(shortcut.defaultPrevented);assert(!actions());assert(named('Выбор атаки'));assert(!calls.some(c=>c.method==='POST'));h.dispose();

// Every owned participant remains directly selectable through either map or queue.
state=response('combat',false,'player');state.controlledActorIds=['ray','mira'];state.battle.scene.currentActorId='mira';state.battle.scene.index=1;calls=[];
h.mount(SharedBattle,{...props,accountId:2});await h.flush();await pick('mira',8,10);assert(actions());assert.equal(globalThis.__battleRendered.selectedId,'mira');assert(!h.button('Сеть').props.disabled);
await h.click('Рэй');assert(actions());assert.equal(globalThis.__battleRendered.selectedId,'ray');assert(h.button('Идти').props.disabled,'An owned off-turn actor still cannot act');
await h.click('Мира — текущий ход');assert(actions());assert.equal(globalThis.__battleRendered.selectedId,'mira');assert(!h.button('Идти').props.disabled);
await h.click('Идти');await pick(null,9,10);assert.equal(calls.at(-1).body.command.actorId,'mira');assert(calls.at(-1).path.endsWith('/preview'));h.dispose();

// Structural CSS regressions, not a pixel/device claim.
const css=await readFile(new URL('../components/battle/battle.css',import.meta.url),'utf8');
assert.match(css,/scene-header\.battlefield-rail\{height:46px;min-height:46px/);
assert.match(css,/actor-context-panel \.action-slot\{[^}]*min-height:44px/);
assert.match(css,/battle-context-panel\{[^}]*max-height:calc\(100% - 16px\)/);
assert.match(css,/padding: env\(safe-area-inset-top\) env\(safe-area-inset-right\) env\(safe-area-inset-bottom\) env\(safe-area-inset-left\)/);
console.log('Contextual battle: empty preparation has no HUD; one menu/actor/camera panel; actor→tool→target→server preview→confirmation; Back layers; GM permissions/redacted player details; constructor footprint/orientation; 44px controls and safe-area contracts passed. Renderer mocked; phone pixels remain unverified.');
