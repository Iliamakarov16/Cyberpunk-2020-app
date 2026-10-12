'use client';

import React, {useEffect, useRef, useState} from 'react';
import type {CharacterData, Skill} from '@/lib/tracker';

export type LoadoutFireMode = 'single'|'burst'|'auto'|'suppress';
export type LoadoutRangedType = 'handgun'|'rifle'|'shotgun'|'smg'|'heavy'|'archery';
type SkillFamily = Exclude<LoadoutRangedType, 'shotgun'>|'melee'|'fencing';
type CommonConfig = {
 weaponId:string; profileId:string; skillName:string; skillRank:number;
 damageDice:number; damageBonus:number; accuracy:number;
};
export type LoadoutWeaponConfig = CommonConfig & ({
 kind:'ranged'; weaponType:LoadoutRangedType; ammoItemId:string;
 range:number; rof:number; magazine:number; loaded:number;
 fireModes:LoadoutFireMode[]; singleActionCap:number;
 reliability:'VR'|'ST'|'UR'; fumbleClass:'automatic'|'nonautomatic';
}|{kind:'melee'; weaponType:'standard'; skillKind:'melee'|'fencing'});
export type LoadoutEditorValue = {weapons:LoadoutWeaponConfig[];activeWeaponId:string|null;resetLoaded?:boolean};
export type LoadoutEditorProps = {data:CharacterData;value:LoadoutEditorValue;onChange:(value:LoadoutEditorValue)=>void;disabled?:boolean;suggestions?:Record<string,Partial<Draft>>};

// Keep these exact supported families aligned with battle_loadout.py. Neither
// inventory names/icons nor an arbitrary REF skill may select combat rules.
const SKILL_ALIASES:Record<SkillFamily,readonly string[]> = {
 handgun:['handgun','пистолеты'], rifle:['rifle','винтовки','винтовки и ружья'],
 smg:['submachinegun','пистолеты-пулемёты'], heavy:['heavy weapons','тяжёлое оружие'],
 archery:['archery','стрельба из лука'], melee:['melee','ближний бой с оружием'],
 fencing:['fencing','фехтование'],
};
const TYPES:Record<LoadoutRangedType,string> = {handgun:'Пистолет · Handgun',rifle:'Винтовка · Rifle',shotgun:'Дробовик · Rifle',smg:'Пистолет-пулемёт · Submachinegun',heavy:'Тяжёлое оружие · Heavy Weapons',archery:'Лук · Archery'};
const MODES:Record<LoadoutFireMode,string> = {single:'Одиночный',burst:'Очередь из трёх',auto:'Автоогонь',suppress:'Подавление'};
const controlStyle:React.CSSProperties = {minHeight:44,minWidth:0,width:'100%'};
const checkStyle:React.CSSProperties = {display:'flex',alignItems:'center',gap:10,minHeight:44};
const gridStyle:React.CSSProperties = {display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',gap:12};
const familyOf = (weapon:LoadoutWeaponConfig):SkillFamily => weapon.kind==='melee'?weapon.skillKind:weapon.weaponType==='shotgun'?'rifle':weapon.weaponType;
const integer = (value:unknown,low:number,high:number):value is number => typeof value==='number'&&Number.isInteger(value)&&value>=low&&value<=high;
const identifier = (value:unknown):value is string => typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value);
const validText = (value:unknown):value is string => typeof value==='string'&&value.trim().length>0&&value.length<=100&&!/[\x00-\x1f\ud800-\udfff]/u.test(value);

export function matchingLoadoutSkills(data:CharacterData,family:SkillFamily):Skill[] {
 const aliases=SKILL_ALIASES[family]??[];
 return data.skills.filter(skill=>skill.stat==='REF'&&integer(skill.rank,0,10)&&aliases.includes(skill.name.trim().toLowerCase())&&data.skills.filter(row=>row.stat==='REF'&&row.name===skill.name).length===1);
}

export function loadoutPoolSummary(data:CharacterData,weapons:LoadoutWeaponConfig[]) {
 const ids=[...new Set(weapons.filter(weapon=>weapon.kind==='ranged').map(weapon=>weapon.ammoItemId))];
 return ids.map(id=>{
  const item=data.items.find(row=>row.id===id&&row.category==='ammo');
  const loaded=weapons.reduce((sum,weapon)=>sum+(weapon.kind==='ranged'&&weapon.ammoItemId===id?weapon.loaded:0),0);
  return {id,name:item?.name??'Недоступные боеприпасы',total:item?.quantity??0,loaded,reserve:(item?.quantity??0)-loaded};
 });
}

/** UI guard only. The server remains authoritative for ownership, CAS and rules. */
export function loadoutEditorError(data:CharacterData,value:LoadoutEditorValue,previous:LoadoutWeaponConfig[]=[]):string|null {
 if(value.weapons.length>40)return 'В наборе может быть не больше 40 профилей.';
 const ids=data.items.map(item=>item.id);
 if(new Set(ids).size!==ids.length||data.items.some(item=>!identifier(item.id)||!integer(item.quantity,0,100000)))return 'Проверь ID и целые количества предметов в листе.';
 if(new Set(value.weapons.map(weapon=>weapon.weaponId)).size!==value.weapons.length)return 'На одну строку оружия разрешён только один профиль.';
 for(const weapon of value.weapons){
  const item=data.items.find(row=>row.id===weapon.weaponId&&row.category==='weapon'&&row.quantity>0);
  if(!item||!validText(item.name))return 'Выбери доступную строку оружия с положительным количеством.';
  if(!validText(weapon.profileId))return 'Укажи источник профиля: книгу, страницу или описание решения ГМа (до 100 символов).';
  if(!integer(weapon.damageDice,1,20)||!integer(weapon.damageBonus,-100,100)||!integer(weapon.accuracy,-10,10))return 'Проверь целые значения урона и точности WA.';
  if(weapon.kind==='melee'&&(weapon.weaponType!=='standard'||!['melee','fencing'].includes(weapon.skillKind)))return 'Поддержан только обычный профиль Melee или Fencing.';
  if(weapon.kind!=='ranged'&&weapon.kind!=='melee')return 'Явно выбери стрелковый или обычный рукопашный профиль.';
  if(weapon.kind==='ranged'&&!Object.hasOwn(TYPES,weapon.weaponType))return 'Выбери поддерживаемый стрелковый тип.';
  if(weapon.skillName===''?weapon.skillRank!==0:!matchingLoadoutSkills(data,familyOf(weapon)).some(skill=>skill.name===weapon.skillName&&skill.rank===weapon.skillRank))return 'Выбери точный подходящий навык REF и его ранг из листа либо явно «Без навыка · 0».';
  const before=previous.find(row=>row.weaponId===weapon.weaponId);
  if(!value.resetLoaded&&before?.kind==='ranged'){
   if((weapon.kind!=='ranged'||weapon.ammoItemId!==before.ammoItemId)&&before.loaded>0)return 'Смена заряженного профиля или патронов требует явной перенастройки магазинов ГМом.';
   if(weapon.kind==='ranged'&&weapon.loaded!==before.loaded)return 'Изменение сохранённого магазина требует явной перенастройки магазинов ГМом.';
  }
  if(weapon.kind==='ranged'){
   if(!data.items.some(item=>item.id===weapon.ammoItemId&&item.category==='ammo'))return 'Выбери настоящую строку боеприпасов из листа.';
   if(!integer(weapon.range,1,10000)||!integer(weapon.rof,1,100)||!integer(weapon.magazine,1,1000)||!integer(weapon.loaded,0,weapon.magazine))return 'Проверь дальность, ROF, вместимость и заряженное количество. Магазин не меняется автоматически.';
   if(!Array.isArray(weapon.fireModes)||!weapon.fireModes.length||weapon.fireModes.some(mode=>!Object.hasOwn(MODES,mode))||new Set(weapon.fireModes).size!==weapon.fireModes.length)return 'Явно подтверди допустимые режимы огня.';
   const single=weapon.fireModes.includes('single');
   if(!integer(weapon.singleActionCap,single?1:0,single?weapon.rof:0))return 'Предел одиночных атак за действие: 1–ROF для одиночного режима, иначе явно 0.';
   if(weapon.fireModes.includes('burst')&&weapon.rof<3)return 'Очередь из трёх требует ROF не меньше 3.';
   if(!['VR','ST','UR'].includes(weapon.reliability)||!['automatic','nonautomatic'].includes(weapon.fumbleClass))return 'Явно подтверди надёжность VR/ST/UR и класс оружия для неудачи.';
   if(weapon.fireModes.some(mode=>mode!=='single')&&weapon.fumbleClass!=='automatic')return 'Очередь, автоогонь и подавление требуют автоматического класса оружия.';
  }
 }
 if(value.activeWeaponId!==null&&!value.weapons.some(weapon=>weapon.weaponId===value.activeWeaponId))return 'Выбранное оружие отсутствует в наборе.';
 if(loadoutPoolSummary(data,value.weapons).some(pool=>pool.reserve<0))return 'Сумма всех заряженных магазинов превышает общий запас этой строки боеприпасов.';
 return null;
}

type NumberKey = 'damageDice'|'damageBonus'|'accuracy'|'range'|'rof'|'magazine'|'loaded'|'singleActionCap';
type Draft = Record<NumberKey,string> & {
 originalId:string|null; weaponId:string; kind:''|'ranged'|'melee';profileId:string;
 weaponType:''|LoadoutRangedType|'standard';skillKind:''|'melee'|'fencing';
 skillName:string|null;skillRank:number;ammoItemId:string;fireModes:LoadoutFireMode[];
 reliability:''|'VR'|'ST'|'UR';fumbleClass:''|'automatic'|'nonautomatic';
};
function freshDraft():Draft {
 return {originalId:null,weaponId:'',kind:'',profileId:'',weaponType:'',skillKind:'',skillName:null,skillRank:0,ammoItemId:'',damageDice:'',damageBonus:'',accuracy:'',range:'',rof:'',magazine:'',loaded:'',fireModes:[],singleActionCap:'',reliability:'',fumbleClass:''};
}
function editDraft(weapon:LoadoutWeaponConfig):Draft {
 const common={...freshDraft(),originalId:weapon.weaponId,weaponId:weapon.weaponId,
  kind:weapon.kind,profileId:weapon.profileId,skillName:weapon.skillName,skillRank:weapon.skillRank,
  damageDice:String(weapon.damageDice),damageBonus:String(weapon.damageBonus),accuracy:String(weapon.accuracy)};
 if(weapon.kind==='melee')return {...common,weaponType:'standard',skillKind:weapon.skillKind};
 return {...common,weaponType:weapon.weaponType,ammoItemId:weapon.ammoItemId,
  range:String(weapon.range),rof:String(weapon.rof),magazine:String(weapon.magazine),loaded:String(weapon.loaded),
  singleActionCap:String(weapon.singleActionCap),fireModes:[...weapon.fireModes],
  reliability:weapon.reliability??'',fumbleClass:weapon.fumbleClass??''};
}
function configFromDraft(draft:Draft):LoadoutWeaponConfig|null {
 const keys:NumberKey[]=draft.kind==='ranged'?['damageDice','damageBonus','accuracy','range','rof','magazine','loaded','singleActionCap']:['damageDice','damageBonus','accuracy'];
 if(!draft.kind||draft.skillName===null||keys.some(key=>!/^[-]?\d+$/.test(draft[key])))return null;
 const common={weaponId:draft.weaponId,profileId:draft.profileId,skillName:draft.skillName,skillRank:draft.skillRank,damageDice:Number(draft.damageDice),damageBonus:Number(draft.damageBonus),accuracy:Number(draft.accuracy)};
 if(draft.kind==='melee')return draft.skillKind?{...common,kind:'melee',weaponType:'standard',skillKind:draft.skillKind}:null;
 if(!draft.weaponType||draft.weaponType==='standard'||!draft.reliability||!draft.fumbleClass)return null;
 return {...common,kind:'ranged',weaponType:draft.weaponType,ammoItemId:draft.ammoItemId,range:Number(draft.range),rof:Number(draft.rof),magazine:Number(draft.magazine),loaded:Number(draft.loaded),singleActionCap:Number(draft.singleActionCap),fireModes:[...draft.fireModes],reliability:draft.reliability,fumbleClass:draft.fumbleClass};
}

/** Mount once per actor/preparation session (key by character ID when switching sheets). */
export function LoadoutEditor({data,value,onChange,disabled=false,suggestions={}}:LoadoutEditorProps){
 const [baseline]=useState(()=>value.weapons.map(weapon=>({...weapon})));
 const confirmation=useRef<HTMLInputElement|null>(null);
 const [draft,setDraft]=useState<Draft|null>(null);
 const [confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState<string|null>(null);
 // The enclosing preparation form must not submit an unapplied local draft,
 // even after its checkbox is checked. Only the explicit commit clears it.
 useEffect(()=>{confirmation.current?.setCustomValidity?.(draft?'Нажми «Подтвердить профиль» или отмени черновик перед сохранением подготовки.':'');},[draft]);
 const savedError=loadoutEditorError(data,value,baseline);
 const available=data.items.filter(item=>item.category==='weapon'&&item.quantity>0&&!value.weapons.some(weapon=>weapon.weaponId===item.id));
 const before=draft?baseline.find(weapon=>weapon.weaponId===draft.weaponId):undefined;
 const protectedMagazine=before?.kind==='ranged'&&!value.resetLoaded;
 const protectedBinding=protectedMagazine&&before.loaded>0;
 const draftFamily:SkillFamily|undefined=draft?.kind==='melee'?(draft.skillKind||undefined):draft?.weaponType&&draft.weaponType!=='standard'?(draft.weaponType==='shotgun'?'rifle':draft.weaponType):undefined;
 const skills=draftFamily?matchingLoadoutSkills(data,draftFamily):[];
 const patch=(change:Partial<Draft>)=>{if(disabled)return;setDraft(current=>current?{...current,...change}:current);setConfirmed(false);setError(null);};
 const close=()=>{setDraft(null);setConfirmed(false);setError(null);};
 const begin=(weapon?:LoadoutWeaponConfig)=>{setDraft(weapon?editDraft(weapon):freshDraft());setConfirmed(false);setError(null);};
 const save=()=>{
  if(disabled||!draft)return;
  if(!confirmed){setError('Подтверди профиль и источник как ГМ.');return;}
  const config=configFromDraft(draft);
  if(!config){setError('Заполни все поля явно, включая нули и подходящий навык.');return;}
  // New ammunition bindings must be actual positive-quantity rows. A previously
  // saved empty pool remains visible at zero, so reopening never refills it.
  const old=value.weapons.find(weapon=>weapon.weaponId===config.weaponId);
  if(config.kind==='ranged'&&!(old?.kind==='ranged'&&old.ammoItemId===config.ammoItemId)&&!data.items.some(item=>item.id===config.ammoItemId&&item.category==='ammo'&&item.quantity>0)){
   setError('Для новой привязки выбери строку боеприпасов с положительным количеством.');return;
  }
  if(!draft.originalId&&value.weapons.some(weapon=>weapon.weaponId===config.weaponId)){setError('На одну строку оружия разрешён только один профиль.');return;}
  const next={...value,weapons:draft.originalId?value.weapons.map(weapon=>weapon.weaponId===draft.originalId?config:weapon):[...value.weapons,config]};
  const problem=loadoutEditorError(data,next,baseline);
  if(problem){setError(problem);return;}
  onChange(next);close();
 };
 const numberField=(key:NumberKey,label:string,min:number,max:number,locked=false)=>draft&&<label key={key}><span>{label}</span><input aria-label={label} style={controlStyle} type="number" inputMode={min<0?'text':'numeric'} step={1} min={min} max={max} value={draft[key]} required disabled={disabled||locked} onChange={event=>patch({[key]:event.target.value})}/></label>;
 return <fieldset className="nc-shared-loadout" disabled={disabled} style={{minWidth:0,margin:'12px 0'}}>
  <legend>Подтверждённый набор оружия · {value.weapons.length}/40</legend>
  <p className="hint">Одна строка предмета — один профиль. Название, значок и количество не задают характеристики. Все правила и источник подтверждает ГМ.</p>
  <label><span>Оружие в руках</span><select aria-label="Активное оружие набора" style={controlStyle} value={value.activeWeaponId??''} disabled={disabled} onChange={event=>{if(!disabled)onChange({...value,activeWeaponId:event.target.value||null});}}>
   <option value="">Без оружия</option>{value.weapons.map(weapon=><option key={weapon.weaponId} value={weapon.weaponId}>{data.items.find(item=>item.id===weapon.weaponId)?.name??weapon.weaponId}</option>)}
  </select></label>
  {value.weapons.map(weapon=><details key={weapon.weaponId} style={{marginTop:10,minWidth:0}}>
   <summary style={{minHeight:44,padding:'12px 0',overflowWrap:'anywhere'}}>{data.items.find(item=>item.id===weapon.weaponId)?.name??weapon.weaponId} · {weapon.kind==='ranged'?`магазин ${weapon.loaded}/${weapon.magazine}`:'Melee/Fencing'}{weapon.weaponId===value.activeWeaponId?' · в руках':''}</summary>
   <p style={{overflowWrap:'anywhere'}}>Источник: {weapon.profileId}</p>
   <p>{weapon.kind==='ranged'?TYPES[weapon.weaponType]:weapon.skillKind==='fencing'?'Обычный Fencing':'Обычный Melee'} · {weapon.skillName||'Без навыка'} {weapon.skillRank} · {weapon.damageDice}d6 {weapon.damageBonus<0?'−':'+'}{Math.abs(weapon.damageBonus)} · WA {weapon.accuracy}</p>
   {weapon.kind==='ranged'&&<p>Дальность {weapon.range} м · ROF {weapon.rof} · {weapon.fireModes.map(mode=>MODES[mode]??mode).join(', ')} · одиночных за действие: {weapon.singleActionCap} · {weapon.reliability||'Надёжность не подтверждена'} · {weapon.fumbleClass==='automatic'?'автоматическое':weapon.fumbleClass==='nonautomatic'?'неавтоматическое':'класс не подтверждён'}</p>}
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="quiet" style={{minHeight:44}} disabled={disabled||draft!==null} onClick={()=>begin(weapon)}>Изменить профиль</button><button type="button" className="quiet" style={{minHeight:44}} disabled={disabled||draft!==null} onClick={()=>{if(!disabled)onChange({...value,weapons:value.weapons.filter(row=>row.weaponId!==weapon.weaponId),activeWeaponId:value.activeWeaponId===weapon.weaponId?null:value.activeWeaponId});}}>Убрать профиль</button></div>
  </details>)}
  {loadoutPoolSummary(data,value.weapons).map(pool=><p className="hint" key={pool.id} role={pool.reserve<0?'alert':undefined}>Боеприпасы: {pool.name} · всего {pool.total} − во всех магазинах {pool.loaded} = резерв {pool.reserve}</p>)}
  {<label className="nc-shared-check" style={checkStyle}><input aria-label="Перенастройка магазинов ГМом" type="checkbox" style={{width:22,height:22,flexShrink:0}} disabled={disabled} checked={!!value.resetLoaded} onChange={event=>{
   if(disabled)return;
   const next={...value,resetLoaded:event.target.checked};
   const problem=!event.target.checked?loadoutEditorError(data,next,baseline):null;
   if(problem){setError('Перед отменой перенастройки верни сохранённые магазины и привязки патронов. '+problem);return;}
   onChange(next);setConfirmed(false);setError(null);
  }}/>Перенастройка магазинов ГМом: явно разрешаю изменить сохранённые заряды и привязки. Это не игровая перезарядка.</label>}
  {!draft&&<button type="button" className="quiet" style={{minHeight:44}} disabled={disabled||!available.length||value.weapons.length>=40} onClick={()=>begin()}>Добавить профиль оружия</button>}
  {!draft&&!available.length&&<p className="hint">Свободных строк оружия с положительным количеством нет.</p>}
  {draft&&<fieldset data-loadout-draft="true" style={{minWidth:0,marginTop:12}} disabled={disabled} onKeyDown={event=>{if(event.key==='Enter'&&event.target instanceof HTMLInputElement)event.preventDefault();}}>
   <legend>{draft.originalId?'Изменение профиля':'Новый профиль'} · ввод по источнику ГМа</legend>
   <p className="hint">Подсказанные числа исходной сцены не подтверждают режим огня или класс критической ошибки. Проверь все поля; запись произойдёт только после твоего подтверждения.</p><div className="nc-shared-form-grid" style={gridStyle}>
    <label><span>Строка оружия из листа</span><select aria-label="Строка оружия профиля" style={controlStyle} required disabled={disabled||!!draft.originalId} value={draft.weaponId} onChange={event=>patch({...freshDraft(),...suggestions[event.target.value],weaponId:event.target.value})}><option value="">Выбери оружие</option>{data.items.filter(item=>item.category==='weapon'&&item.quantity>0&&(item.id===draft.originalId||!value.weapons.some(weapon=>weapon.weaponId===item.id))).map(item=><option key={item.id} value={item.id}>{item.name} · в листе {item.quantity}</option>)}</select></label>
    <label><span>Тип профиля</span><select aria-label="Тип профиля оружия" style={controlStyle} required disabled={disabled||protectedBinding} value={draft.kind} onChange={event=>patch({kind:event.target.value as Draft['kind'],weaponType:'',skillKind:'',skillName:null,skillRank:0})}><option value="">Выбери явно</option><option value="ranged">Стрелковое</option><option value="melee">Обычное Melee/Fencing</option></select></label>
    <label style={{gridColumn:'1 / -1'}}><span>Источник / profileId: книга, страница или описание решения ГМа</span><input aria-label="Источник профиля ГМа" style={controlStyle} value={draft.profileId} maxLength={100} required disabled={disabled} placeholder="Укажи свой источник и профиль" onChange={event=>patch({profileId:event.target.value})}/></label>
    {draft.kind==='ranged'&&<label><span>Стрелковый тип и семейство навыка</span><select aria-label="Стрелковый тип" style={controlStyle} value={draft.weaponType} required disabled={disabled} onChange={event=>patch({weaponType:event.target.value as Draft['weaponType'],skillName:null,skillRank:0})}><option value="">Выбери явно</option>{Object.entries(TYPES).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label>}
    {draft.kind==='melee'&&<label><span>Обычное оружие · standard</span><select aria-label="Семейство рукопашного навыка" style={controlStyle} value={draft.skillKind} required disabled={disabled} onChange={event=>patch({skillKind:event.target.value as Draft['skillKind'],skillName:null,skillRank:0})}><option value="">Выбери явно</option><option value="melee">Melee · ближний бой с оружием</option><option value="fencing">Fencing · фехтование</option></select></label>}
    <label><span>Подходящий навык REF из листа</span><select aria-label="Боевой навык профиля" style={controlStyle} required disabled={disabled||!draftFamily} value={draft.skillName===null?'':draft.skillName===''?'__untrained__':draft.skillName} onChange={event=>{const skill=skills.find(row=>row.name===event.target.value);patch(event.target.value==='__untrained__'?{skillName:'',skillRank:0}:{skillName:skill?.name??null,skillRank:skill?.rank??0});}}><option value="">Выбери явно</option><option value="__untrained__">Без навыка · 0 (только REF)</option>{skills.map(skill=><option key={skill.name} value={skill.name}>{skill.name} · {skill.rank}</option>)}</select></label>
    {numberField('damageDice','Урон: число d6',1,20)}{numberField('damageBonus','Добавка к урону',-100,100)}{numberField('accuracy','Точность WA',-10,10)}
    {draft.kind==='ranged'&&<>
     <label><span>Строка боеприпасов из листа</span><select aria-label="Боеприпасы профиля" style={controlStyle} required disabled={disabled||protectedBinding} value={draft.ammoItemId} onChange={event=>patch({ammoItemId:event.target.value})}><option value="">Выбери боеприпасы</option>{data.items.filter(item=>item.category==='ammo'&&(item.quantity>0||(item.id===draft.ammoItemId&&value.weapons.some(weapon=>weapon.kind==='ranged'&&weapon.weaponId===draft.originalId&&weapon.ammoItemId===item.id)))).map(item=><option key={item.id} value={item.id}>{item.name} · всего {item.quantity}</option>)}</select></label>
     {numberField('range','Дальность, м',1,10000)}{numberField('rof','ROF: выстрелов за весь раунд',1,100)}{numberField('magazine','Вместимость магазина',1,1000)}{numberField('loaded','Заряжено сейчас',0,1000,protectedMagazine)}
     {numberField('singleActionCap','Одиночных атак за одно действие',0,100)}
     <label><span>Надёжность</span><select aria-label="Надёжность оружия" style={controlStyle} value={draft.reliability} required disabled={disabled} onChange={event=>patch({reliability:event.target.value as Draft['reliability']})}><option value="">Выбери по источнику</option><option value="VR">VR</option><option value="ST">ST</option><option value="UR">UR</option></select></label>
     <label><span>Класс для критической неудачи</span><select aria-label="Класс оружия для неудачи" style={controlStyle} value={draft.fumbleClass} required disabled={disabled} onChange={event=>patch({fumbleClass:event.target.value as Draft['fumbleClass']})}><option value="">Выбери по источнику</option><option value="automatic">Автоматическое</option><option value="nonautomatic">Неавтоматическое</option></select></label>
    </>}
   </div>
   {draft.kind==='ranged'&&<><p className="hint">Допустимые режимы по источнику. ROF — бюджет раунда, предел одиночных — за одно действие; без одиночного режима введи 0. Режимы и класс не выводятся из ROF.</p><div style={gridStyle}>{Object.entries(MODES).map(([mode,label])=><label key={mode} className="nc-shared-check" style={checkStyle}><input type="checkbox" aria-label={`Режим: ${label}`} style={{width:22,height:22,flexShrink:0}} disabled={disabled} checked={draft.fireModes.includes(mode as LoadoutFireMode)} onChange={event=>patch({fireModes:event.target.checked?[...draft.fireModes,mode as LoadoutFireMode]:draft.fireModes.filter(value=>value!==mode)})}/>{label}</label>)}</div>{protectedMagazine&&<p className="hint">Сохранено {before.loaded} патронов. Поля не пополняются и не обрезаются автоматически. Для изменения включи «Перенастройка магазинов ГМом».</p>}</>}
   {draft.kind==='melee'&&<p className="hint">Только обычное оружие с Melee/Fencing. Особые и экзотические правила здесь не подтверждаются.</p>}
   <label className="nc-shared-check" style={checkStyle}><input ref={confirmation} type="checkbox" aria-label="Подтверждение профиля ГМом" style={{width:22,height:22,flexShrink:0}} checked={confirmed} required disabled={disabled} onInvalid={()=>setError('Нажми «Подтвердить профиль» или отмени черновик перед сохранением подготовки.')} onChange={event=>setConfirmed(event.target.checked)}/>Как ГМ подтверждаю все введённые поля и указанный источник профиля.</label>
   <p className="hint">Черновик ещё не включён в набор. Подтверди его кнопкой или отмени перед сохранением подготовки.</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" style={{minHeight:44}} disabled={disabled||!confirmed} onClick={save}>Подтвердить профиль</button><button type="button" className="quiet" style={{minHeight:44}} disabled={disabled} onClick={close}>Отменить черновик</button></div>
  </fieldset>}
  {(error||savedError)&&<p role="alert">{error||savedError}</p>}
 </fieldset>;
}

export default LoadoutEditor;
