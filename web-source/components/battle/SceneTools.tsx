'use client';
import React,{useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './Dialog';
import {readBattleImport,downloadBattleDocument} from '@/lib/battle-transfer';
import {ZONES} from '@/lib/tracker';
import {ACTOR_APPEARANCES,isActorAppearanceId} from '@/lib/firefight/appearances.mjs';
import type {BattleNpcTemplate,BattleScenePreview,BattlePendingWear} from '@/lib/shared-battle';

type Command=Record<string,unknown>&{type:string;expectedVersion:number};
type Props={
 tool:'import'|'export'|'npc'|null;version:number;width:number;height:number;busy:boolean;online:boolean;
 templates:BattleNpcTemplate[];pendingWear:BattlePendingWear[];onClose:()=>void;onPreview:(command:Command)=>Promise<BattleScenePreview>;
 onConfirm:(command:Command)=>Promise<unknown>;
};
type ImportStage={document:Record<string,unknown>;version:number;preview:BattleScenePreview};
type NpcStage={command:Command;preview:BattleScenePreview};
const message=(error:unknown)=>error instanceof Error?error.message:'Не удалось проверить подготовку.';

/** Keeps a selected file and NPC draft across Close/Back; only confirmation mutates the server. */
export default function SceneTools({tool,version,width,height,busy,online,templates,pendingWear,onClose,onPreview,onConfirm}:Props){
 const [exportStage,setExportStage]=useState<{version:number;document:Record<string,unknown>;name:string;warnings:string[]}|null>(null);
 const [document,setDocument]=useState<Record<string,unknown>|null>(null),[filename,setFilename]=useState('');
 const [importStage,setImportStage]=useState<ImportStage|null>(null),[replace,setReplace]=useState(false),[wearAcknowledged,setWearAcknowledged]=useState(false);
 const [templateId,setTemplateId]=useState(''),[name,setName]=useState(''),[hidden,setHidden]=useState(false);
 const [sprite,setSprite]=useState<number|''>('');
 const [manualPosition,setManualPosition]=useState(false),[x,setX]=useState(0),[y,setY]=useState(0);
 const [npcStage,setNpcStage]=useState<NpcStage|null>(null),[checking,setChecking]=useState(false),[error,setError]=useState('');
 const request=useRef(0),currentVersion=useRef(version),currentTool=useRef(tool);
 useEffect(()=>{currentVersion.current=version;currentTool.current=tool;},[version,tool]);
 useEffect(()=>()=>{request.current++;},[]);
 const locked=busy||!online,template=templates.find(row=>row.id===templateId);
 const validAppearance=sprite===''||isActorAppearanceId(sprite);
 const validPosition=!manualPosition||(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<width&&y>=0&&y<height);
 const currentExport=exportStage?.version===version?exportStage:null;
 const currentImport=importStage?.version===version?importStage:null;
 const currentNpc=npcStage?.command.expectedVersion===version?npcStage:null;
 const needsWearAcknowledgement=pendingWear.length>0||!!currentImport?.preview.requiresManualWearAcknowledgement;
 const stale=!!(tool==='export'?exportStage&&!currentExport:tool==='import'?importStage&&!currentImport:npcStage&&!currentNpc);
 function close(){if(busy)return;request.current++;setChecking(false);setError('');onClose();}
 async function checkExport(){
  if(locked)return;
  const sequence=++request.current,expectedVersion=version;setChecking(true);setError('');setExportStage(null);
  try{
   const preview=await onPreview({type:'export-scene',expectedVersion});
   if(sequence!==request.current||currentTool.current!=='export')return;
   if(currentVersion.current!==expectedVersion)throw new Error('Сцена изменилась. Получи актуальный экспорт ещё раз.');
   if(!preview.ok||!preview.document)throw new Error(preview.error||'Не удалось подготовить экспорт.');
   setExportStage({version:expectedVersion,document:preview.document,name:preview.summary?.name||String(preview.document.name||'scene'),warnings:preview.warnings||[]});
  }catch(error){if(sequence===request.current)setError(message(error));}
  finally{if(sequence===request.current)setChecking(false);}
 }
 function download(){if(!currentExport||locked)return;try{downloadBattleDocument(currentExport.document,currentExport.name);}catch(error){setError(message(error)+' Можно скопировать JSON ниже.');}}
 async function checkDocument(next:Record<string,unknown>){
  const sequence=++request.current,expectedVersion=version;setChecking(true);setError('');setImportStage(null);setReplace(false);setWearAcknowledged(false);
  try{
   const preview=await onPreview({type:'import-scene',document:next,expectedVersion});
   if(sequence!==request.current||currentTool.current!=='import')return;
   if(currentVersion.current!==expectedVersion)throw new Error('Сцена изменилась. Проверь файл ещё раз перед заменой.');
   if(!preview.ok)throw new Error(preview.error||'Этот файл нельзя импортировать.');
   setImportStage({document:next,version:expectedVersion,preview});
  }catch(error){if(sequence===request.current)setError(message(error));}
  finally{if(sequence===request.current)setChecking(false);}
 }
 async function selectFile(event:React.ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  const sequence=++request.current;setChecking(true);setError('');setImportStage(null);setReplace(false);setWearAcknowledged(false);
  try{
   const next=await readBattleImport(file);if(sequence!==request.current)return;
   setDocument(next);setFilename(file.name);await checkDocument(next);
  }catch(error){if(sequence===request.current){setError(message(error));setChecking(false);}}
 }
 function invalidateNpc(){request.current++;setNpcStage(null);setChecking(false);setError('');}
 async function checkNpc(){
  if(!template||!validPosition||!validAppearance||locked)return;
  const command:Command={type:'add',templateId,hidden,expectedVersion:version,...(sprite!==''?{sprite}:{}),...(name.trim()?{name:name.trim()}:{}),...(manualPosition?{x,y}:{})};
  const sequence=++request.current;setChecking(true);setError('');setNpcStage(null);
  try{
   const preview=await onPreview(command);if(sequence!==request.current||currentTool.current!=='npc')return;
   if(currentVersion.current!==command.expectedVersion)throw new Error('Сцена изменилась. Проверь НПС ещё раз.');
   if(!preview.ok)throw new Error(preview.error||'НПС нельзя разместить.');
   setNpcStage({command,preview});
  }catch(error){if(sequence===request.current)setError(message(error));}
  finally{if(sequence===request.current)setChecking(false);}
 }
 async function commitImport(){
  if(!currentImport||!replace||needsWearAcknowledgement&&!wearAcknowledged||locked||checking)return;
  const result=await onConfirm({type:'import-scene',document:currentImport.document,expectedVersion:currentImport.version,...(needsWearAcknowledgement&&wearAcknowledged?{acknowledgeManualWear:true}:{})});
  if(result){setImportStage(null);setReplace(false);setWearAcknowledged(false);onClose();}
 }
 async function commitNpc(){
  if(!currentNpc||locked||checking)return;
  const result=await onConfirm(currentNpc.command);
  if(result){setNpcStage(null);setName('');onClose();}
 }
 const preview=tool==='import'?currentImport?.preview:tool==='npc'?currentNpc?.preview:undefined;
 return <Dialog open={tool!==null} onOpenChange={open=>{if(!open)close();}}><DialogContent className="nc-battle-setup-dialog nc-battle-tools-dialog"><DialogHeader><DialogTitle>{tool==='export'?'Экспорт сцены':tool==='import'?'Импорт сцены':'Быстрый НПС'}</DialogTitle></DialogHeader>
 <div className="nc-battle-tools-body">
 <DialogDescription>{tool==='export'?'Экспорт подготовки содержит карту, устройства, шаблоны НПС и ссылки на участников. Ранения, патроны, личные характеристики и история команд в файл не входят. При импорте НПС создаются заново по шаблонам.':tool==='import'?'Файл проверяет сервер. Замена создаст новую подготовку, НПС заново получат ресурсы своих шаблонов. Текущие листы персонажей не перезаписываются данными из файла.':'НПС хранится в этой сцене. Аккаунт и личный лист для него не создаются.'}</DialogDescription>
 {tool==='export'?<><button disabled={locked||checking} onClick={()=>void checkExport()}>Подготовить файл сцены</button>{currentExport&&<><p role="status">Экспорт проверен сервером.</p>{currentExport.warnings.length>0&&<ul className="battle-export-warnings">{currentExport.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}<button className="primary" disabled={locked} onClick={download}>Сохранить JSON-файл</button><details><summary>Если сохранение файла недоступно</summary><p className="hint">Скопируй этот JSON в текстовый файл с расширением .json.</p><textarea aria-label="JSON экспортированной сцены" readOnly rows={7} value={JSON.stringify(currentExport.document,null,2)} onFocus={event=>event.target.select()}/></details></>}</>:tool==='import'?<><label className="battle-file-field"><span>JSON-файл сцены · до 2 МБ</span><input type="file" accept="application/json,.json" aria-label="Выбрать файл сцены" disabled={busy||checking} onChange={selectFile}/></label>{filename&&<p className="hint">Выбран файл: {filename}</p>}{document&&<button disabled={locked||checking} onClick={()=>void checkDocument(document)}>Проверить файл ещё раз</button>}</>:<><label><span>Шаблон НПС</span><select aria-label="Шаблон НПС" value={templateId} disabled={busy||checking} onChange={event=>{setTemplateId(event.target.value);invalidateNpc();}}><option value="">Выбери шаблон</option>{templates.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{!templates.length&&<p className="hint">Сервер пока не вернул доступные шаблоны. Закрой окно и обнови сцену.</p>}{template?.description&&<p>{template.description}</p>}<label><span>Облик · только внешность</span><select aria-label="Облик НПС (только внешность)" value={sprite} disabled={busy||checking} onChange={event=>{setSprite(event.target.value===''?'':Number(event.target.value));invalidateNpc();}}><option value="">Исходный облик шаблона</option>{ACTOR_APPEARANCES.map(appearance=><option key={appearance.id} value={appearance.id}>{appearance.label}</option>)}</select></label><p className="hint">Оружие, щит и броня на картинке не дают снаряжение или характеристики. Правила НПС задаёт выбранный шаблон.</p>{!validAppearance&&<p role="alert">Выбери доступный облик.</p>}<label><span>Имя в сцене</span><input aria-label="Имя быстрого НПС" maxLength={80} value={name} placeholder={template?.name||'Название из шаблона'} disabled={busy||checking} onChange={event=>{setName(event.target.value);invalidateNpc();}}/></label><label className="nc-shared-check"><input type="checkbox" checked={hidden} disabled={busy||checking} onChange={event=>{setHidden(event.target.checked);invalidateNpc();}}/>Скрыть НПС от игроков</label><label className="nc-shared-check"><input type="checkbox" checked={manualPosition} disabled={busy||checking} onChange={event=>{setManualPosition(event.target.checked);invalidateNpc();}}/>Указать стартовую клетку вручную</label>{manualPosition&&<div className="nc-shared-form-grid"><label><span>X (с нуля)</span><input type="number" aria-label="НПС X" min={0} max={width-1} step={1} value={Number.isNaN(x)?'':x} onChange={event=>{setX(event.target.valueAsNumber);invalidateNpc();}}/></label><label><span>Y (с нуля)</span><input type="number" aria-label="НПС Y" min={0} max={height-1} step={1} value={Number.isNaN(y)?'':y} onChange={event=>{setY(event.target.valueAsNumber);invalidateNpc();}}/></label></div>}{!validPosition&&<p role="alert">Клетка должна находиться внутри карты.</p>}<button disabled={locked||checking||!template||!validPosition||!validAppearance} onClick={()=>void checkNpc()}>Проверить и разместить</button></>}
 {checking&&<p role="status">Сервер проверяет подготовку…</p>}{error&&<p className="battle-tool-error" role="alert">{error}</p>}{stale&&<p className="battle-tool-error" role="status">Сцена изменилась. Проверь подготовку ещё раз.</p>}
 {tool==='import'&&needsWearAcknowledgement&&<section className="battle-pending-wear"><h3>Износ брони требует ручной проверки</h3><ul>{pendingWear.map(wear=><li key={wear.actorId+wear.zone}>{wear.name} · {ZONES[wear.zone]}: SP {wear.sourceSP} → {wear.resultSP}. {wear.reason}</li>)}</ul><label className="nc-shared-check"><input type="checkbox" checked={wearAcknowledged} onChange={event=>setWearAcknowledged(event.target.checked)}/>Я проверил указанный износ вручную. Подтверждение не исправляет броню в листах автоматически.</label></section>}
 {preview&&<section className="battle-import-summary" aria-label={tool==='import'?'Проверенная сцена':'Проверенный НПС'}><h3>{preview.summary?.name||preview.text||'Подготовка проверена'}</h3>{preview.summary&&<dl>{preview.summary.width!==undefined&&<><dt>Карта</dt><dd>{preview.summary.width} × {preview.summary.height} клеток</dd></>}{preview.summary.characterCount!==undefined&&<><dt>Персонажи из листов</dt><dd>{preview.summary.characterCount}</dd></>}{preview.summary.npcCount!==undefined&&<><dt>НПС сцены</dt><dd>{preview.summary.npcCount}</dd></>}{preview.summary.deviceCount!==undefined&&<><dt>Устройства</dt><dd>{preview.summary.deviceCount}</dd></>}</dl>}{preview.to&&<p>Размещение: {preview.to.x+1}, {preview.to.y+1}</p>}{preview.warnings?.length?<ul>{preview.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>:null}{tool==='import'&&<label className="nc-shared-check"><input type="checkbox" checked={replace} onChange={event=>setReplace(event.target.checked)}/>Заменить текущую подготовку этой сценой. Ранее сохранённые последствия в листах остаются.</label>}</section>}
 </div><div className="nc-shared-actions"><button disabled={busy} onClick={close}>Назад</button>{tool==='export'?null:tool==='import'?<button className="primary" disabled={locked||checking||!currentImport||!replace||needsWearAcknowledgement&&!wearAcknowledged} onClick={()=>void commitImport()}>Заменить подготовку</button>:<button className="primary" disabled={locked||checking||!currentNpc} onClick={()=>void commitNpc()}>Добавить НПС в сцену</button>}</div></DialogContent></Dialog>;
}
