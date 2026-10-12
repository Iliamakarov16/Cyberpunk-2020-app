import {clickBattleControl} from './battle-ui-navigation.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,loadModules,moduleUrl,transpile} from './ux-hook-harness.mjs';
import {createDemoScene} from '../lib/firefight/scene.mjs';
const transfer=await import(moduleUrl(transpile(await readFile(new URL('../lib/battle-transfer.ts',import.meta.url),'utf8'))));
for(const text of ['null','[]','3','not json'])await assert.rejects(transfer.readBattleImport({size:text.length,text:async()=>text}));
await assert.rejects(transfer.readBattleImport({size:transfer.MAX_BATTLE_IMPORT_BYTES+1,text:async()=>{throw Error('must not read');}}));
const malicious={version:-20,appliedIds:['steal'],actors:[{ownerId:99,armor:{head:200}}]};
assert.deepEqual(await transfer.readBattleImport({size:100,text:async()=>JSON.stringify(malicious)}),malicious,'Client must forward untrusted document only to server validation, never hydrate live state');
assert.equal(transfer.battleExportName('a/b: c'),'night-city-scene-a-b--c.json');
const env=installEnvironment(),h=createHarness(),pending=new Map(),downloads=[];
globalThis.sessionStorage={getItem:k=>pending.get(k)||null,setItem:(k,v)=>pending.set(k,v),removeItem:k=>pending.delete(k)};
env.window.document=env.document;env.document.createElement=()=>({click(){downloads.push({name:this.download,href:this.href});}});
const {SharedBattle}=await loadModules(h,undefined,{actualSharedBattle:true});
const scene=createDemoScene();scene.actors=[];scene.phase='preparation';scene.currentActorId=null;scene.version=1;
const template={id:'guard-rifle',name:'Охранник · винтовка',description:'Серверный шаблон охранника'};
let state={role:'gm',controlledActorIds:[],options:{characters:[],npcTemplates:[template]},battle:{id:'real-scene',version:1,phase:'preparation',scene,pending:[],log:[]}},calls=[],deny=false,exits=0;
const document={format:'nightcity-scene',schemaVersion:1,name:'Проверенный бар',width:24,height:16,tiles:scene.tiles,devices:scene.devices,props:scene.props,actors:[]};
const api=async(path,method='GET',body)=>{
 calls.push({path,method,body:structuredClone(body)});if(method==='GET')return structuredClone(state);
 assert.equal(body.battleId,state.battle.id);assert.equal(body.expectedVersion,state.battle.version);
 if(path.endsWith('/preview')){
  if(deny)return {preview:{ok:false,error:'Неизвестный формат сцены'}};
  if(body.command.type==='export-scene')return {preview:{ok:true,document,summary:{name:document.name}}};
  if(body.command.type==='import-scene')return {preview:{ok:true,summary:{name:'Проверенный бар',width:24,height:16,characterCount:0,npcCount:2,deviceCount:5},warnings:['Неизвестный персонаж пропущен']}};
  if(body.command.type==='add')return {preview:{ok:true,text:'Охранник',to:{x:4,y:6}}};
  throw Error('Unexpected preview');
 }
 assert(path.endsWith('/commands'));assert(['import-scene','add'].includes(body.type));assert.equal(state.role,'gm');
 state.battle.version++;state.battle.scene.version=state.battle.version;return structuredClone(state);
};
const props={campaignId:7,campaignName:'Test',accountId:1,api,onExit(){exits++;}};
const change=async(node,event)=>{await node.props.onChange({target:event});h.render();await h.flush();};
const choose=async(value)=>change(h.find(n=>n.props['aria-label']==='Выбрать файл сцены'),{value:'',files:[{name:'scene.json',size:100,text:async()=>JSON.stringify(value)}]});
const back=async()=>{const event=new Event('nightcity-battle-back',{cancelable:true});env.window.dispatchEvent(event);assert(event.defaultPrevented);h.render();await h.flush();};
const open=async(label)=>{await clickBattleControl(h,'Сцена и сохранение');await h.click(label);};
const confirmation=()=>h.find(n=>n.type==='input'&&n.props.type==='checkbox'&&h.nodes().some(label=>label.type==='label'&&h.text(label).includes('Заменить текущую подготовку')&&h.nodes(label).includes(n)));
h.mount(SharedBattle,props);await h.flush();
await open('Экспорт сцены');assert(!calls.some(c=>c.body?.command?.type==='export-scene'));await h.click('Подготовить файл сцены');
assert.equal(h.find(n=>n.props['aria-label']==='JSON экспортированной сцены').props.value,JSON.stringify(document,null,2));
await h.click('Сохранить JSON-файл');assert.equal(downloads.length,1);assert(downloads[0].name.endsWith('.json'));assert(downloads[0].href.startsWith('blob:'));assert(!calls.some(c=>c.path.endsWith('/commands')));await back();assert.equal(exits,0);
await open('Импорт сцены');await choose(malicious);assert(h.text().includes('Неизвестный персонаж пропущен'));assert(h.button('Заменить подготовку').props.disabled);assert.deepEqual(calls.at(-1).body.command.document,malicious);assert.equal(state.battle.version,1);
await back();assert.equal(exits,0);await open('Импорт сцены');assert(h.text().includes('scene.json'),'Back retains file draft');
await change(confirmation(),{checked:true});await h.click('Заменить подготовку');const commit=calls.at(-1).body;assert.equal(commit.type,'import-scene');assert.equal(commit.expectedVersion,1);assert.deepEqual(commit.document,malicious);assert(!('appliedIds' in commit));assert.equal(state.battle.version,2);
// A new server revision invalidates a checked preview and its confirmation.
await open('Импорт сцены');await choose(document);await change(confirmation(),{checked:true});state.battle.version++;state.battle.scene.version=state.battle.version;await clickBattleControl(h,'Обновить общий бой');assert(h.text().includes('Сцена изменилась'));assert(h.button('Заменить подготовку').props.disabled);await h.click('Проверить файл ещё раз');assert(!confirmation().props.checked);await back();
// Server rejection produces no commit and exposes no authority controls to players.
await open('Импорт сцены');deny=true;await choose(document);assert(h.text().includes('Неизвестный формат'));assert(h.button('Заменить подготовку').props.disabled);deny=false;await back();
await clickBattleControl(h,'Участники сцены');await h.click('Добавить НПС');await change(h.find(n=>n.props['aria-label']==='Шаблон НПС'),{value:template.id});await change(h.find(n=>n.props['aria-label']==='Имя быстрого НПС'),{value:'Ночной охранник'});assert(h.button('Добавить НПС в сцену').props.disabled);await change(h.find(n=>n.props['aria-label']==='Облик НПС (только внешность)'),{value:'11'});await h.click('Проверить и разместить');assert.equal(calls.at(-1).body.command.sprite,11);assert(h.text().includes('Размещение:'));await change(h.find(n=>n.props['aria-label']==='Облик НПС (только внешность)'),{value:'10'});assert(h.button('Добавить НПС в сцену').props.disabled,'Changing appearance invalidates the checked preview');await h.click('Проверить и разместить');assert.equal(calls.at(-1).body.command.sprite,10);await h.click('Добавить НПС в сцену');const npc=calls.at(-1).body;assert.equal(npc.sprite,10);assert.equal(npc.type,'add');assert.equal(npc.templateId,'guard-rifle');assert.equal(npc.name,'Ночной охранник');assert(!('config' in npc));assert(!('ownerId' in npc));
h.dispose();state.role='player';state.options={characters:[]};h.mount(SharedBattle,{...props,accountId:2});await h.flush();await clickBattleControl(h,'Сцена и сохранение');assert(!h.button('Импорт сцены'));assert(!h.button('Экспорт сцены'));h.dispose();
console.log('Scene transfer: bounded JSON reads, server-only export, preview/explicit replace, stale validation, rejected import, draft-preserving Back, private player UI and server NPC template commands passed. Renderer mocked.');
