import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,loadModules,moduleUrl,transpile} from './ux-hook-harness.mjs';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
const battle=await import(moduleUrl(transpile(await readFile(root+'/lib/battle.ts','utf8'))));
installEnvironment();
const h=createHarness(),{BattleBoard,BattleEditor,CampaignTerminal}=await loadModules(h,root);
const piece=(id,kind,x,y,link,name,hidden=false)=>({id,kind,x,y,characterId:kind==='character'?link:null,targetId:kind==='target'?link:null,name,description:'Описание '+name,hidden,initiative:null});
const targets=[{id:'near',name:'Ближний охранник',kind:'person',description:'Патруль у героя',visible:true},{id:'far',name:'Дальний охранник',kind:'person',description:'Другой коридор',visible:true},{id:'secret',name:'Скрытый тайник',kind:'device',description:'Секрет',visible:false}];
const characters=[{id:21,name:'Вега',owner_id:2,role:'Фиксер',status:'active'},{id:22,name:'Никс',owner_id:2,role:'Нетраннер',status:'active'}];
const board={schemaVersion:1,width:6,height:6,cellMeters:2,vision:1,tiles:Array(36).fill('floor'),pieces:[piece('vega','character',1,1,21,'Вега'),piece('nix','character',4,4,22,'Никс'),piece('near-pawn','target',2,1,'near','Ближний охранник'),piece('far-pawn','target',4,3,'far','Дальний охранник'),piece('secret-pawn','target',1,2,'secret','Скрытый тайник',true),piece('loot','loot',1,1,null,'Ящик у Веги')],turnPieceId:'far-pawn'};
const projected=battle.projectBattleBoard(board,new Set([21,22]),new Set([21,22]),new Set(['near','far']));
function cell(x,y){const node=h.find(n=>n.type==='button'&&n.props['data-cell']===`${x}:${y}`);assert(node,`Cell ${x}:${y} missing`);return node;}
const calls=[];
const boardProps={board:projected,gm:false,characterId:21,characters,targets:targets.filter(t=>t.visible),onTarget:(...args)=>calls.push(args),onRequestMove:(...args)=>calls.push(['move',...args])};

// An account with two characters receives a union projection, but the actual board displays one actor's LOS.
h.mount(BattleBoard,boardProps);await h.flush();
assert(h.text().includes('ОБЗОР · Вега'));
assert(!h.text().includes('Дальний охранник'),'Another owned character must not widen the selected view');
assert(!h.text().includes('Скрытый тайник'),'Hidden targets must not appear in text');
assert(!h.nodes().some(n=>`${n.props.title||''} ${n.props['aria-label']||''}`.includes('Скрытый тайник')),'Hidden information must not leak through labels');
assert(cell(4,3).props['aria-label'].includes('Неизвестная область'));
assert.equal(cell(4,3).props.disabled,true);
await h.click(cell(2,1));await h.click('Атаковать');assert.deepEqual(calls.pop(),['near','attack']);
h.update({...boardProps,characterId:22});await h.flush();
assert(!h.text().includes('Ближний охранник'));assert(!h.find(n=>n.props.className==='battle-selection'),'Actor switch clears the previous target');
await h.click(cell(4,3));await h.click('Применить программу');assert.deepEqual(calls.pop(),['far','program']);
h.dispose();

// Standalone display never mutates the board: movement is a callback after an explicit destination confirmation.
h.mount(BattleBoard,{...boardProps,board,gm:true,characterId:null,onMove:(...args)=>calls.push(['gm-move',...args]),onNextTurn:()=>calls.push(['turn'])});await h.flush();
assert(h.text().includes('ПОЛНЫЙ ОБЗОР ГМ'));assert(h.text().includes('Скрытый тайник'));
await h.click(cell(1,1));await h.click(cell(3,1));assert.equal(board.pieces[0].x,1);
await h.click('Подтвердить перемещение');assert.deepEqual(calls.pop(),['gm-move','vega',3,1]);
await h.click('Следующий ход');assert.deepEqual(calls.pop(),['turn']);h.dispose();

// Closing an edited map requires explicit discard; template replacement keeps existing targets.
let editorDirty=false,closed=0,saved=null;
h.mount(BattleEditor,{initialBoard:board,initialTargets:targets,characters,onDirtyChange:value=>editorDirty=value,onClose:()=>closed++,onSave:(next,nextTargets)=>{saved={board:next,targets:nextTargets};}});await h.flush();
await h.click('Стены и проходы');
const wall=h.buttons().find(n=>h.text(n).trim()==='Стена');assert(wall);await h.click(wall);
const paintCell=h.find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Клетка 4, 3:'));assert(paintCell);await h.click(paintCell);assert.equal(editorDirty,true);
await h.click('Закрыть конструктор');assert.equal(closed,0);assert(h.text().includes('Закрыть без сохранения?'));
await h.click('Подтвердить');assert.equal(closed,1);
await h.click(h.buttons().find(n=>n.props['aria-current']===undefined&&h.text(n).trim()==='1 Поле'));await h.click('Склад');assert(h.text().includes('Существующие цели')||h.text().includes('Список целей'));
await h.click('Подтвердить');await h.click('Проверка');await h.click('Сохранить поле и цели');assert(saved);assert.equal(saved.board.width,14);assert.equal(saved.board.pieces.length,0);assert(targets.every(t=>saved.targets.some(v=>v.id===t.id)));assert(saved.targets.some(t=>t.id==='battle-floor'));h.dispose();

// A concurrent board edit is reported as a conflict and its local draft is kept.
let state={version:1,updated:100,is_gm:true,characters,data:{contacts:[],messages:[],places:[],assets:[],scene:{id:'scene-1',name:'Склад',active:false,targets:[...targets,{id:'battle-floor',name:'Поле боя',kind:'device',description:'Перемещение',visible:true}],actions:[],log:[],board:structuredClone(board)}}};
const posts=[];const api=async(path,method='GET',payload)=>{assert.equal(path,'/api/campaigns/10/workspace');if(method==='POST'){posts.push(payload);return {version:++state.version};}return structuredClone(state);};
h.mount(CampaignTerminal,{campaignId:10,me:{id:1,username:'Ведущий'},api});await h.flush();
assert(h.text().includes('ГМ / ПАНЕЛЬ ВЕДУЩЕГО'));
await h.click('Изменить поле');await h.click('Стены и проходы');
const editor=h.find(n=>n.props['aria-label']==='Конструктор поля боя');assert(editor);
const editorPaint=h.nodes(editor).find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Клетка 4, 3:'));assert(editorPaint);await h.click(editorPaint);
state.data.scene.board.vision=2;state.version++;await h.click('Обновить терминал');await h.click('Проверка');
await h.click('Сохранить поле и цели');assert.equal(posts.length,0,'Conflicted map draft is not submitted');
assert(h.text().includes('Поле или цели изменились на другом устройстве'));
assert(h.find(n=>n.props['aria-label']==='Конструктор поля боя'),'Editor remains open after conflict');
h.dispose();
// An unfinished placement remains usable across terrain/review/template steps.
let draft;
h.mount(BattleEditor,{initialBoard:board,initialTargets:targets,characters,onSave:next=>{saved=next;},onDraftChange:value=>draft=value});await h.flush();
await h.click(h.buttons().find(n=>h.text(n).trim()==='Цель'));
const placementInput=()=>h.find(n=>n.type==='input'&&n.props.placeholder==='Например: охранник у ворот');
placementInput().props.onChange({target:{value:'Новый охранник'}});h.render();await h.flush();
await h.click(h.buttons().find(n=>h.text(n).trim()==='1 Поле'));await h.click('Склад');await h.click('Подтвердить');
await h.click('Пешки');assert.equal(placementInput().props.value,'Новый охранник');
await h.click('Проверка');saved=null;await h.click('Сохранить поле и цели');assert.equal(saved,null);
assert(h.text().includes('ещё не привязаны к пешке'));
await h.click('Вернуться к размещению');assert.equal(placementInput().props.value,'Новый охранник');
const free=h.find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Клетка 3, 3:'));await h.click(free);
assert.equal(draft.board.pieces.length,1);assert.equal(draft.placement.tool,'select');assert.equal(draft.placement.name,'');
assert(h.text().includes('Настройка пешки'));
// A list selection explicitly asks before discarding the next unfinished piece.
await h.click(h.buttons().find(n=>h.text(n).trim()==='Цель'));
placementInput().props.onChange({target:{value:'Другой охранник'}});h.render();await h.flush();
const row=h.nodes(h.find(n=>n.props.className==='battle-piece-list')).find(n=>n.type==='button');await h.click(row);
assert(h.text().includes('Сменить инструмент?'));
h.find(n=>n.type==='harness-AlertDialog').props.onOpenChange(false);h.render();await h.flush();
assert.equal(placementInput().props.value,'Другой охранник');
await h.click('Проверка');await h.click('Вернуться к размещению');assert.equal(placementInput().props.value,'Другой охранник');
h.dispose();
console.log('PASS: scoped LOS; callbacks; editor steps; pending placement retained/recoverable; explicit discard; auto-selection; template preservation and concurrent draft guard.');
