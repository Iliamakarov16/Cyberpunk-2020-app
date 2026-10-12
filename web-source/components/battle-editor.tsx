'use client';

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, CarFront, Check, Crosshair, DoorClosed, EyeOff, Flag, Grid2X2, Move, MousePointer2, Save, Shield, Square, Trash2, UserRound, X} from 'lucide-react';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {battleCellIndex, canOccupyBattleCell, validateBattleBoard, type BattleBoard, type BattlePiece, type BattleTile} from '@/lib/battle';
import {BattlePieceIcon, type BattleCharacter, type BattleTarget} from './battle-board';

export type BattleEditorProps = {
  initialBoard:BattleBoard|null;initialTargets:BattleTarget[];characters:BattleCharacter[];
  busy?:boolean;saveError?:string;onSave:(board:BattleBoard,targets:BattleTarget[])=>void|Promise<void>;
  onDirtyChange?:(dirty:boolean)=>void;onDraftChange?:(draft:{board:BattleBoard;targets:BattleTarget[];placement?:{name:string;description:string;kind:BattleTarget['kind'];visible:boolean;tool:Tool;existingTarget:string;character:string};size?:{width:string;height:string}})=>void;onClose?:()=>void;
};
type Tool='select'|'terrain'|'character'|'target'|'loot'|'vehicle'|'move';
type Stage=0|1|2|3;
const STAGES=['Поле','Стены и проходы','Пешки','Проверка'];
type Template='blank'|'alley'|'warehouse'|'apartment';
const TEMPLATE_LABEL:Record<Template,string>={blank:'Пустое поле',alley:'Городской переулок',warehouse:'Склад',apartment:'Квартира'};
const TILE_LABEL:Record<BattleTile,string>={floor:'Пол / открытый проход',wall:'Стена',door:'Закрытая дверь',cover:'Укрытие'};
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const uid=()=>globalThis.crypto?.randomUUID?.()||`piece-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
const floorTarget=():BattleTarget=>({id:'battle-floor',name:'Поле боя',kind:'device',description:'Перемещение по полю',visible:true});
export function createBattleTemplate(kind:Template):BattleBoard {
  const width=kind==='warehouse'?14:12,height=kind==='warehouse'?12:10;
  const board:BattleBoard={schemaVersion:1,width,height,cellMeters:2,vision:6,tiles:Array<BattleTile>(width*height).fill('floor'),pieces:[],turnPieceId:null};
  const paint=(x:number,y:number,tile:BattleTile)=>{board.tiles[battleCellIndex(board,x,y)]=tile;};
  if(kind==='blank')return board;
  for(let x=0;x<width;x++){paint(x,0,'wall');paint(x,height-1,'wall');}
  for(let y=0;y<height;y++){paint(0,y,'wall');paint(width-1,y,'wall');}
  if(kind==='alley'){
    for(let y=1;y<height-1;y++){paint(3,y,'wall');paint(9,y,'wall');}
    paint(3,3,'door');paint(9,6,'door');paint(6,0,'floor');paint(6,height-1,'floor');
    paint(5,4,'cover');paint(7,6,'cover');paint(7,2,'cover');
  }else if(kind==='warehouse'){
    paint(6,height-1,'door');paint(7,height-1,'door');paint(1,5,'door');
    for(const y of [3,7])for(const x of [3,4,6,7,9,10])paint(x,y,'cover');
  }else{
    for(let y=1;y<height-1;y++)paint(6,y,'wall');
    for(let x=1;x<6;x++)paint(x,5,'wall');
    for(let x=7;x<width-1;x++)paint(x,4,'wall');
    paint(6,3,'door');paint(6,7,'door');paint(3,5,'door');paint(9,4,'door');paint(2,height-1,'door');
    paint(2,2,'cover');paint(3,2,'cover');paint(8,2,'cover');paint(9,7,'cover');
  }
  return board;
}
const pieceName=(kind:BattlePiece['kind'])=>({character:'Персонаж',target:'Цель',loot:'Лут',vehicle:'Транспорт'}[kind]);

export default function BattleEditor({initialBoard,initialTargets,characters,busy=false,saveError,onSave,onDirtyChange,onDraftChange,onClose}:BattleEditorProps) {
  const [board,setBoard]=useState<BattleBoard>(()=>clone(initialBoard||createBattleTemplate('blank')));
  const [targets,setTargets]=useState<BattleTarget[]>(()=>clone(initialTargets));
  const baseline=useRef(JSON.stringify({board:initialBoard||createBattleTemplate('blank'),targets:initialTargets}));
  const [stage,setStage]=useState<Stage>(initialBoard?2:0),lastObjectTool=useRef<Tool>('select'),selectedEditor=useRef<HTMLElement|null>(null);
  const [tool,setTool]=useState<Tool>('select'),[brush,setBrush]=useState<BattleTile>('wall'),[selectedId,setSelectedId]=useState('');
  const [character,setCharacter]=useState(''),[existingTarget,setExistingTarget]=useState('new');
  const [newName,setNewName]=useState(''),[newDescription,setNewDescription]=useState(''),[newKind,setNewKind]=useState<BattleTarget['kind']>('person'),[newVisible,setNewVisible]=useState(true);
  const [width,setWidth]=useState(String(board.width)),[height,setHeight]=useState(String(board.height));
  const [notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[confirmation,setConfirmation]=useState<{title:string;text:string;run:()=>void}|null>(null);
  const locked=busy||saving,selected=board.pieces.find(p=>p.id===selectedId),selectedTarget=selected?.targetId?targets.find(t=>t.id===selected.targetId):undefined;
  const placementDirty=!!newName.trim()||!!newDescription.trim(),sizeDirty=Number(width)!==board.width||Number(height)!==board.height;
  const dirty=JSON.stringify({board,targets})!==baseline.current||placementDirty||sizeDirty;
  const availableCharacters=characters.filter(c=>!board.pieces.some(p=>p.characterId===c.id));
  const availableTargets=targets.filter(t=>t.id!=='battle-floor'&&!board.pieces.some(p=>p.targetId===t.id));
  const eligibleCharacter=availableCharacters.find(c=>String(c.id)===character)||availableCharacters[0];
  const missingReferences=board.pieces.filter(p=>p.characterId!==null&&!characters.some(c=>c.id===p.characterId)||p.targetId!==null&&!targets.some(t=>t.id===p.targetId));
  const boardNames=useMemo(()=>new Map(board.pieces.map(p=>[p.id,p.kind==='character'?characters.find(c=>c.id===p.characterId)?.name||p.name:p.targetId?targets.find(t=>t.id===p.targetId)?.name||p.name:p.name])),[board.pieces,characters,targets]);
  const draftCallback=useRef(onDraftChange);draftCallback.current=onDraftChange;
  useEffect(()=>{draftCallback.current?.({board:clone(board),targets:clone(targets),placement:{name:newName,description:newDescription,kind:newKind,visible:newVisible,tool,existingTarget,character},size:{width,height}});},[board,targets,newName,newDescription,newKind,newVisible,tool,existingTarget,character,width,height]);
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>()=>{onDirtyChange?.(false);},[onDirtyChange]);
  useEffect(()=>{if(selectedId&&!board.pieces.some(p=>p.id===selectedId))setSelectedId('');},[board.pieces,selectedId]);

  function goStage(next:Stage){if(next===1&&tool!=='terrain'){lastObjectTool.current=tool;setTool('terrain');}if(next===2&&tool==='terrain')setTool(lastObjectTool.current);setStage(next);setNotice('');}
  function pickTool(next:Tool,after?:()=>void){const pick=()=>{setTool(next);setNotice('');after?.();};if(placementDirty&&next!==tool)setConfirmation({title:'Сменить инструмент?',text:'Название и описание неразмещённой пешки будут отброшены. Размещённые пешки и остальной черновик сохранятся.',run:()=>{setNewName('');setNewDescription('');pick();}});else pick();}
  function updateBoard(patch:Partial<BattleBoard>){setBoard(previous=>({...previous,...patch}));setNotice('');}
  function updatePiece(patch:Partial<BattlePiece>){
    if(!selected||locked)return;
    const next={...selected,...patch};
    if(selected.kind==='target'&&selected.targetId){
      const targetPatch:Partial<BattleTarget>={};
      if(patch.name!==undefined)targetPatch.name=patch.name;
      if(patch.description!==undefined)targetPatch.description=patch.description;
      if(patch.hidden!==undefined)targetPatch.visible=!patch.hidden;
      setTargets(previous=>previous.map(t=>t.id===selected.targetId?{...t,...targetPatch}:t));
    }
    updateBoard({pieces:board.pieces.map(p=>p.id===selected.id?next:p)});
  }
  function updateTargetKind(kind:BattleTarget['kind']){if(selectedTarget)setTargets(previous=>previous.map(t=>t.id===selectedTarget.id?{...t,kind}:t));}
  function replaceTemplate(kind:Template){
    const replace=()=>{const next=createBattleTemplate(kind);setBoard(next);setWidth(String(next.width));setHeight(String(next.height));setSelectedId('');goStage(1);setNotice('Шаблон загружен в черновик. Размести героев и цели, затем сохрани поле. Существующие цели и история сохранены.');};
    if(board.pieces.length||dirty||initialBoard)setConfirmation({title:'Заменить поле шаблоном?',text:'Геометрия и расстановка пешек будут заменены в черновике. Список целей и история действий останутся. Игроки увидят изменения только после сохранения поля.',run:replace});else replace();
  }
  function resize(){
    const w=Number(width),h=Number(height);
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<6||w>24||h<6||h>24){setNotice('Ширина и высота: целые числа от 6 до 24.');return;}
    if(board.pieces.some(p=>p.x>=w||p.y>=h)){setNotice('Сначала передвинь или убери пешки, которые окажутся за пределами нового поля.');return;}
    const tiles:Array<BattleTile>=Array(w*h).fill('floor');for(let y=0;y<Math.min(h,board.height);y++)for(let x=0;x<Math.min(w,board.width);x++)tiles[y*w+x]=board.tiles[y*board.width+x];
    updateBoard({width:w,height:h,tiles});
  }
  function chooseCell(x:number,y:number){
    if(locked)return;
    const index=battleCellIndex(board,x,y),cellPieces=board.pieces.filter(p=>p.x===x&&p.y===y);setNotice('');
    if(tool==='select'){setSelectedId((cellPieces.find(p=>p.kind!=='loot')||cellPieces[0])?.id||'');return;}
    if(tool==='terrain'){
      if((brush==='wall'||brush==='door')&&cellPieces.length){setNotice('Сначала передвинь или убери пешку из этой клетки.');return;}
      updateBoard({tiles:board.tiles.map((tile,i)=>i===index?brush:tile)});return;
    }
    if(tool==='move'){
      if(!selected){setNotice('Выбери пешку в списке ниже, затем нажми новую клетку.');return;}
      if(!canOccupyBattleCell(board,selected,x,y)){setNotice('Нельзя поставить пешку в стену, закрытую дверь или занятую клетку.');return;}
      updatePiece({x,y});return;
    }
    if(board.pieces.length>=60){setNotice('На поле можно разместить не больше 60 пешек.');return;}
    let piece:BattlePiece={id:uid(),kind:tool,x,y,characterId:null,targetId:null,name:'',description:newDescription.trim(),hidden:!newVisible,initiative:null};
    let addedTarget:BattleTarget|null=null;
    if(tool==='character'){
      if(!eligibleCharacter){setNotice('Все принятые персонажи уже размещены. Чтобы добавить героя, сначала прими его в состав кампании.');return;}
      piece={...piece,characterId:eligibleCharacter.id,name:eligibleCharacter.name,description:'',hidden:false};
    }else if(tool==='target'){
      if(existingTarget==='new'){
        if(!newName.trim()){setNotice('Введи название новой цели перед размещением.');return;}
        if(targets.filter(t=>t.id!=='battle-floor').length>=39){setNotice('В сцене может быть до 39 целей и одна служебная цель для перемещений.');return;}
        addedTarget={id:uid(),name:newName.trim(),kind:newKind,description:newDescription.trim(),visible:newVisible};
      }else addedTarget=availableTargets.find(t=>t.id===existingTarget)||null;
      if(!addedTarget){setNotice('Выбери ещё не размещённую цель.');return;}
      piece={...piece,targetId:addedTarget.id,name:addedTarget.name,description:addedTarget.description,hidden:!addedTarget.visible};
    }else{
      if(!newName.trim()){setNotice(`Введи название: ${pieceName(piece.kind).toLowerCase()}.`);return;}
      piece.name=newName.trim();
    }
    if(!canOccupyBattleCell(board,piece,x,y)){setNotice('Выбери свободную клетку пола или укрытия. Только лут может делить клетку с другой пешкой.');return;}
    if(addedTarget&&existingTarget==='new')setTargets(previous=>[...previous,addedTarget!]);
    updateBoard({pieces:[...board.pieces,piece]});setSelectedId(piece.id);
    if(tool!=='character'&&(tool!=='target'||existingTarget==='new')){setNewName('');setNewDescription('');}
    if(tool==='target'&&existingTarget!=='new')setExistingTarget('new');
    setTool('select');
  }
  function removePiece(){
    if(!selected)return;
    const remove=()=>{updateBoard({pieces:board.pieces.filter(p=>p.id!==selected.id),turnPieceId:board.turnPieceId===selected.id?null:board.turnPieceId});setSelectedId('');if(!placementDirty)setTool('select');};
    setConfirmation({title:'Убрать пешку с поля?',text:selected.kind==='target'?'Цель останется в списке действий и истории сцены. Изменение расстановки применится после сохранения поля.':'Изменение расстановки применится после сохранения поля. Персонаж и его лист не удаляются.',run:remove});
  }
  function close(){if(!onClose||locked)return;if(dirty)setConfirmation({title:'Закрыть без сохранения?',text:'Изменения поля и новые цели в этом черновике будут отброшены. Сохранённая сцена останется прежней.',run:onClose});else onClose();}
  async function save(){
    if(locked)return;setNotice('');
    if(placementDirty){setNotice('Название или описание ещё не привязаны к пешке. Размести её на поле или отбрось неразмещённую пешку перед сохранением.');return;}
    if(sizeDirty){setNotice('Новый размер ещё не применён. Нажми «Применить размер» или верни текущий размер перед сохранением.');return;}
    try{
      const targetRows=targets.filter(t=>t.id!=='battle-floor');
      if(targetRows.length>39||targetRows.some(t=>!t.name.trim()||t.name.length>100||t.description.length>1500)){setNotice('Проверь названия и описания целей. Допустимо не более 39 целей.');return;}
      const finalTargets=[...targetRows.map(t=>({...t,name:t.name.trim(),description:t.description.trim()})),floorTarget()];
      const pieces=board.pieces.map(p=>{
        const target=p.targetId?finalTargets.find(t=>t.id===p.targetId):undefined;
        return {...p,...(target?{name:target.name,description:target.description,hidden:!target.visible}:{}),...(p.kind==='character'?{name:characters.find(c=>c.id===p.characterId)?.name||p.name}:{})};
      });
      const valid=validateBattleBoard({...board,pieces},new Set(characters.map(c=>c.id)),new Set(finalTargets.map(t=>t.id)));
      setSaving(true);await onSave(valid,finalTargets);
      // Parent owns conflict/CAS handling and may keep the editor open on a failed command.
    }catch(error){setNotice(error instanceof Error?error.message:'Не удалось сохранить поле.');}finally{setSaving(false);}
  }
  const instructions:Record<Tool,string>={select:'Нажми пешку на поле или в списке, чтобы изменить её данные.',terrain:`Нажимай клетки, чтобы нарисовать: ${TILE_LABEL[brush].toLowerCase()}. Это пока черновик.`,character:eligibleCharacter?`Нажми свободную клетку, чтобы разместить: ${eligibleCharacter.name}.`:'Нет неразмещённых принятых персонажей.',target:existingTarget==='new'?'Заполни название новой цели, затем нажми свободную клетку.':'Выбери существующую цель, затем нажми свободную клетку.',loot:'Введи название лута и нажми клетку. Лут может лежать рядом с пешкой.',vehicle:'Введи название транспорта и нажми свободную клетку.',move:selected?`Нажми новую клетку для пешки «${selected.name}».`:'Выбери пешку в списке, затем нажми новую клетку.'};

  return <section className="battle-editor" aria-label="Конструктор поля боя">
    <header className="battle-heading"><div><span className="battle-eyebrow">ПОДГОТОВКА ВЕДУЩЕГО</span><h3>Конструктор поля боя</h3><p>Четыре шага подготовки. Можно возвращаться к любому из них.</p></div>{onClose&&<button type="button" onClick={close} disabled={locked} aria-label="Закрыть конструктор"><X aria-hidden="true"/></button>}</header>
    <p className="battle-draft-status"><Save aria-hidden="true"/>{dirty||!initialBoard?'Черновик — игроки ещё не видят эти изменения':'Сохранённое поле открыто для редактирования'}</p>
    <nav className="battle-stage-nav" aria-label="Шаги конструктора">{STAGES.map((label,index)=><button key={label} type="button" disabled={locked} aria-current={stage===index?'step':undefined} onClick={()=>goStage(index as Stage)}><span>{index+1}</span>{label}</button>)}</nav>
    <div className="battle-stage-heading"><span>ШАГ {stage+1} / 4</span><h4>{STAGES[stage]}</h4><p>{['Выбери готовую карту или начни с пустого поля. Размер можно настроить ниже.','Выбери кисть и нажимай клетки. Пальцем можно прокручивать карту.','Выбери, кого добавить, заполни данные и нажми свободную клетку. Для изменения уже размещённой пешки нажми её.','Проверь расстановку и незавершённые изменения. Сохранение обновит поле; приём действий открывается отдельно в сцене.'][stage]}</p></div>
    <details className="battle-builder-help"><summary>Как подготовить бой</summary><p>Шаблон задаёт только геометрию. Добавь принятых персонажей и цели. Красная отметка хода помогает следить за очередью; инициативу бросают за столом и вписывают вручную.</p><p>Стены и закрытые двери закрывают обзор. Чтобы открыть дверь, замени её клетку на «Пол / открытый проход». Укрытие не закрывает обзор и не считает броню автоматически. Радиус обзора здесь — настройка сцены, которую задаёт ведущий.</p><p>Сохранение поля не открывает приём действий. После сохранения открой сцену отдельной кнопкой. Игрок увидит область вокруг своего персонажа; вручную скрытые цели, лут и транспорт останутся скрытыми.</p></details>
    <div hidden={stage!==0}><div className="battle-templates" role="group" aria-label="Шаблоны поля">{(['blank','alley','warehouse','apartment'] as Template[]).map(kind=><button key={kind} type="button" disabled={locked} onClick={()=>replaceTemplate(kind)}><Grid2X2 aria-hidden="true"/>{TEMPLATE_LABEL[kind]}</button>)}</div>
    <details className="battle-size-settings"><summary>Размер поля и обзор</summary><div className="battle-fields"><label>Ширина<input type="number" min={6} max={24} step={1} value={width} disabled={locked} onChange={e=>setWidth(e.target.value)}/></label><label>Высота<input type="number" min={6} max={24} step={1} value={height} disabled={locked} onChange={e=>setHeight(e.target.value)}/></label><button type="button" disabled={locked} onClick={resize}>Применить размер</button>{sizeDirty&&<button type="button" disabled={locked} onClick={()=>{setWidth(String(board.width));setHeight(String(board.height));}}>Вернуть текущий размер</button>}<label>Метров на клетку<input type="number" min={0.5} max={10} step={0.5} value={board.cellMeters} disabled={locked} onChange={e=>updateBoard({cellMeters:Number(e.target.value)})}/></label><label>Обзор, клеток<input type="number" min={1} max={24} step={1} value={board.vision} disabled={locked} onChange={e=>updateBoard({vision:Number(e.target.value)})}/></label></div><p className="battle-hint">Уменьшение поля сохраняет оставшиеся клетки. Пешки за границей не удаляются: передвинь их перед изменением размера.</p></details>
    </div>
    <div hidden={stage!==2}><div className="battle-tools" role="group" aria-label="Инструмент конструктора">{([{tool:'select',label:'Выбрать',Icon:MousePointer2},{tool:'character',label:'Герой',Icon:UserRound},{tool:'target',label:'Цель',Icon:Crosshair},{tool:'loot',label:'Лут',Icon:Box},{tool:'vehicle',label:'Транспорт',Icon:CarFront}] as const).map(row=><button key={row.tool} type="button" disabled={locked} aria-pressed={tool===row.tool} onClick={()=>pickTool(row.tool)}><row.Icon aria-hidden="true"/>{row.label}</button>)}</div>
    </div>
    {stage===1&&<div className="battle-brushes" role="group" aria-label="Тип клетки">{([{tile:'floor',Icon:Square},{tile:'wall',Icon:Grid2X2},{tile:'door',Icon:DoorClosed},{tile:'cover',Icon:Shield}] as const).map(row=><button key={row.tile} type="button" disabled={locked} aria-pressed={brush===row.tile} onClick={()=>setBrush(row.tile)}><row.Icon aria-hidden="true"/>{TILE_LABEL[row.tile]}</button>)}</div>}
    <div hidden={stage!==2}>
    {tool==='character'&&<label className="battle-field">Принятый персонаж<select value={eligibleCharacter?String(eligibleCharacter.id):''} disabled={locked||!availableCharacters.length} onChange={e=>setCharacter(e.target.value)}>{!availableCharacters.length&&<option value="">Все принятые герои уже на поле</option>}{availableCharacters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {tool==='target'&&<label className="battle-field">Цель для размещения<select value={existingTarget} disabled={locked} onChange={e=>setExistingTarget(e.target.value)}><option value="new">Создать новую цель</option>{availableTargets.map(t=><option key={t.id} value={t.id}>{t.name}{t.visible?'':' · скрыта'}</option>)}</select></label>}
    {(tool==='loot'||tool==='vehicle'||tool==='target'&&existingTarget==='new')&&<div className="battle-placement-fields"><label>Название<input maxLength={100} value={newName} disabled={locked} onChange={e=>setNewName(e.target.value)} placeholder={tool==='target'?'Например: охранник у ворот':tool==='loot'?'Например: ящик с припасами':'Например: фургон курьера'}/></label>{tool==='target'&&<label>Тип цели<select value={newKind} disabled={locked} onChange={e=>setNewKind(e.target.value as BattleTarget['kind'])}><option value="person">Человек</option><option value="device">Устройство</option><option value="program">Программа</option></select></label>}<label className="battle-wide">Описание<textarea rows={2} maxLength={1500} value={newDescription} disabled={locked} onChange={e=>setNewDescription(e.target.value)}/></label><label className="battle-checkbox"><input type="checkbox" checked={newVisible} disabled={locked} onChange={e=>setNewVisible(e.target.checked)}/>Не скрывать вручную от игроков</label><p className="battle-hint">Игрок всё равно должен видеть эту клетку своим персонажем.</p></div>}
    </div>
    {placementDirty&&(stage===2||stage===3)&&<aside className="battle-pending-placement"><p>Есть неразмещённая пешка: {newName.trim()||'название пока не задано'}. Она ещё не добавлена на поле.</p>{stage===3&&<button type="button" disabled={locked} onClick={()=>goStage(2)}>Вернуться к размещению</button>}<button type="button" disabled={locked} onClick={()=>{setNewName('');setNewDescription('');}}>Отбросить неразмещённую пешку</button></aside>}
    <p hidden={stage===0||stage===3} className="battle-instruction" aria-live="polite">{instructions[tool]} Поле прокручивается пальцем.</p>
    {notice&&<p className="battle-warning" role="status">{notice}</p>}
    {missingReferences.length>0&&<p className="battle-warning">Некоторые пешки ссылаются на ушедших персонажей или отсутствующие цели. Убери или исправь их перед сохранением: {missingReferences.map(p=>p.name).join(', ')}.</p>}
    {stage===2&&selected&&<div className="battle-selected-summary"><span>Выбрано: <strong>{boardNames.get(selected.id)||selected.name}</strong></span><button type="button" onClick={()=>selectedEditor.current?.scrollIntoView({block:'start',behavior:'auto'})}>Настроить пешку</button></div>}
    <div className="battle-viewport" tabIndex={0} aria-label="Прокручиваемый черновик поля"><div className="battle-grid battle-zoom-normal" style={{gridTemplateColumns:`repeat(${board.width},var(--battle-cell))`}} role="group" aria-label="Клетки конструктора">{board.tiles.map((tile,index)=>{
      const x=index%board.width,y=Math.floor(index/board.width),pieces=board.pieces.filter(p=>p.x===x&&p.y===y),piece=pieces.find(p=>p.kind!=='loot')||pieces[0];
      const label=`Клетка ${x+1}, ${y+1}: ${TILE_LABEL[tile]}${pieces.length?`, ${pieces.map(p=>p.name).join('; ')}`:''}`;
      return <button key={index} type="button" aria-label={label} title={label} aria-pressed={pieces.some(p=>p.id===selectedId)} disabled={locked||stage===0||stage===3} className={`battle-cell tile-${tile}${pieces.some(p=>p.id===selectedId)?' is-selected':''}${pieces.some(p=>p.id===board.turnPieceId)?' is-turn':''}`} onClick={()=>chooseCell(x,y)}>{tile==='door'&&!piece&&<DoorClosed aria-hidden="true"/>}{piece&&<><span className={`battle-pawn pawn-${piece.kind}${piece.hidden?' is-hidden':''}`}><BattlePieceIcon piece={piece} target={piece.targetId?targets.find(t=>t.id===piece.targetId):undefined}/>{piece.hidden&&<EyeOff className="battle-hidden-mark" aria-hidden="true"/>}</span><span className="battle-pawn-label" aria-hidden="true">{boardNames.get(piece.id)||piece.name}</span>{pieces.length>1&&<span className="battle-pawn-count" aria-hidden="true">+{pieces.length-1}</span>}</>}{pieces.some(p=>p.id===board.turnPieceId)&&<Flag className="battle-turn-mark" aria-hidden="true"/>}</button>;
    })}</div></div>
    <div hidden={stage!==2} className="battle-editor-lower">    {selected&&<section ref={selectedEditor} className="battle-piece-editor"><h4>Настройка пешки</h4><div className="battle-fields"><label className="battle-wide">Название<input maxLength={100} value={boardNames.get(selected.id)||selected.name} disabled={locked||selected.kind==='character'} onChange={e=>updatePiece({name:e.target.value})}/></label>{selected.kind==='character'&&<p className="battle-hint battle-wide">Имя берётся из листа персонажа. Скрытие от собственного игрока не применяется.</p>}{selectedTarget&&<label>Тип цели<select value={selectedTarget.kind} disabled={locked} onChange={e=>updateTargetKind(e.target.value as BattleTarget['kind'])}><option value="person">Человек</option><option value="device">Устройство</option><option value="program">Программа</option></select></label>}<label>Инициатива<input type="number" step={1} value={selected.initiative===null?'':selected.initiative} disabled={locked} onChange={e=>updatePiece({initiative:e.target.value.trim()===''?null:Number(e.target.value)})} placeholder="После броска"/></label><label className="battle-wide">Описание<textarea rows={3} maxLength={1500} value={selectedTarget?.description??selected.description} disabled={locked} onChange={e=>updatePiece({description:e.target.value})}/></label>{selected.kind!=='character'&&<label className="battle-checkbox battle-wide"><input type="checkbox" checked={!selected.hidden} disabled={locked} onChange={e=>updatePiece({hidden:!e.target.checked})}/>Не скрывать вручную от игроков</label>}</div><p className="battle-hint">Клетка {selected.x+1}, {selected.y+1}. {selected.kind==='target'?'Название, описание и скрытие связаны с этой же целью в списке действий.':''}</p><div className="battle-actions"><button type="button" disabled={locked} aria-pressed={tool==='move'} onClick={()=>pickTool('move')}><Move aria-hidden="true"/>Переставить на поле</button><button type="button" disabled={locked} onClick={()=>updateBoard({turnPieceId:selected.id})}><Flag aria-hidden="true"/>Сейчас ход этой пешки</button><button type="button" disabled={locked} onClick={removePiece}><Trash2 aria-hidden="true"/>Убрать с поля</button></div></section>}<section className="battle-piece-list"><h4>Пешки на поле · {board.pieces.length}</h4>{!board.pieces.length&&<p className="battle-hint">Выбери «Герой» или «Цель» и нажми клетку для размещения.</p>}{board.pieces.map(p=><button key={p.id} type="button" disabled={locked} aria-pressed={selectedId===p.id} onClick={()=>pickTool('select',()=>setSelectedId(p.id))}><BattlePieceIcon piece={p} target={p.targetId?targets.find(t=>t.id===p.targetId):undefined}/><span><strong>{boardNames.get(p.id)||p.name}</strong><small>{pieceName(p.kind)} · {p.x+1}, {p.y+1}{p.initiative!==null?` · инициатива ${p.initiative}`:''}{p.hidden?' · скрыта':''}</small></span>{board.turnPieceId===p.id&&<Flag aria-label="Текущий ход"/>}</button>)}</section>
</div>
    <div hidden={stage!==3} className="battle-review"><div className="battle-review-counts"><span>Герои <b>{board.pieces.filter(p=>p.kind==='character').length}</b></span><span>Цели <b>{board.pieces.filter(p=>p.kind==='target').length}</b></span><span>Лут <b>{board.pieces.filter(p=>p.kind==='loot').length}</b></span><span>Транспорт <b>{board.pieces.filter(p=>p.kind==='vehicle').length}</b></span></div><p className="battle-hint">{board.width} × {board.height} клеток · {board.cellMeters} м на клетку · обзор {board.vision} клеток. Пустую карту тоже можно сохранить.</p>{sizeDirty&&<p className="battle-warning">Размер введён, но ещё не применён. Вернись на шаг «Поле» и примени размер.</p>}<div className="battle-turn-setting"><label>Текущий ход<select value={board.turnPieceId||''} disabled={locked} onChange={e=>updateBoard({turnPieceId:e.target.value||null})}><option value="">Ещё не выбран</option>{board.pieces.map(p=><option key={p.id} value={p.id}>{boardNames.get(p.id)||p.name}{p.initiative!==null?` · ${p.initiative}`:''}</option>)}</select></label><p className="battle-hint">Дальность движения, атаки, броню и итог бросков определяет ведущий. Поле хранит расстановку и очередь.</p></div>
    {(notice||saveError)&&<p className="battle-warning" role="alert">{notice||saveError}</p>}</div>
    <footer className="battle-save">{stage>0&&<button type="button" disabled={locked} onClick={()=>goStage((stage-1) as Stage)}>Предыдущий шаг</button>}{stage<3&&<button type="button" className="primary" disabled={locked} onClick={()=>goStage((stage+1) as Stage)}>Далее: {STAGES[stage+1]}</button>}{stage===3&&<button type="button" className="primary" disabled={locked} onClick={()=>void save()}><Save aria-hidden="true"/>{saving?'Сохраняем поле…':'Сохранить поле и цели'}</button>}{onClose&&<button type="button" disabled={locked} onClick={close}>Закрыть конструктор</button>}<span>{dirty||!initialBoard?'Изменения ещё не сохранены':'Нет изменений в черновике'}</span></footer>
    <AlertDialog open={!!confirmation} onOpenChange={open=>{if(!open)setConfirmation(null);}}><AlertDialogContent className="tracker-dialog battle-confirm"><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.text}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={()=>{const action=confirmation?.run;setConfirmation(null);action?.();}}><Check aria-hidden="true"/>Подтвердить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
