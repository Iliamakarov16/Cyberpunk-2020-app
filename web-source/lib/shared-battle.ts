/* eslint-disable @typescript-eslint/no-explicit-any -- Transport records mirror the separately validated original JavaScript combat schema and its role-redacted variants. */
import {equipment, type CharacterData} from './tracker';
import type {LoadoutEditorValue,LoadoutWeaponConfig} from '@/components/battle/LoadoutEditor';
import {isActorAppearanceId} from './firefight/appearances.mjs';

export const BATTLE_ZONES = ['head','torso','rightArm','leftArm','rightLeg','leftLeg'] as const;
export type BattleZone = typeof BATTLE_ZONES[number];
export type BattleOption = {id:number;name:string;owner_id:number;version:number;data:CharacterData};
export type BattleNetSetup = {deckItemId:string;interfaceRank:number;programIds:string[]};
export type BattleDeviceSetup = {id:string;name:string;type:'port'|'door'|'camera'|'speaker';networkId:string;x:number;y:number;range?:number;active?:boolean};
export const CONTROLLER_OPTIONS=[{id:'genie',label:'Genie · двери · STR 5'},{id:'crystalBall',label:'Crystal Ball · камеры · STR 4'},{id:'soundmachine',label:'Soundmachine · громкая связь · STR 4'}];
export function interfaceRanks(data:CharacterData):number[]{return [...new Set([...data.skills.filter(s=>/^(interface|интерфейс)$/i.test(s.name.trim())).map(s=>s.rank),...(/^(interface|интерфейс)$/i.test((data.special||'').trim())?[data.specialRank]:[])])].filter(rank=>Number.isInteger(rank)&&rank>=1&&rank<=10);}
export type BattleActorSetup = {characterId:number;version:number;unarmed?:boolean;loadout?:LoadoutEditorValue;resetReadiness?:boolean;net?:BattleNetSetup;x:number;y:number;team:'crew'|'hostile';hidden:boolean;sprite:number;weapon:{weaponId:string;ammoItemId:string;skillName:string;skillRank:number;damageDice:number;damageBonus:number;accuracy:number;range:number;rof:number;magazine:number;loaded:number};armor:Record<BattleZone,number>;combatSense:number};
export type BattleNpcTemplate = {id:string;name:string;description?:string};
export type BattleScenePreview = {ok:boolean;error?:string;text?:string;document?:Record<string,unknown>;warnings?:string[];requiresManualWearAcknowledgement?:boolean;to?:{x:number;y:number};summary?:{name:string;width?:number;height?:number;actorCount?:number;npcCount?:number;deviceCount?:number;characterCount?:number}};
export type BattleView = {id:string;version:number;phase:string;scene:any;pending:any[];log:any[];canUndo?:boolean;demoCompatible?:boolean};
export type BattleResponse = {viewerActorId?:string|null;viewerActors?:{id:string;name:string}[];role:'gm'|'player';controlledActorIds:string[];battle:BattleView|null;options:{characters:BattleOption[];npcTemplates?:BattleNpcTemplate[];sceneLoadouts?:{actorId:string;data:CharacterData}[]};duplicate?:boolean;receipt?:any;demoCompatible?:boolean;rulesNote?:string};
export type BattleRequest = Record<string,unknown>&{id:string;type:string;expectedVersion:number;battleId?:string};
export const battleCommandId = () => globalThis.crypto?.randomUUID?.() ?? 'battle-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
export function actorSetup(option:BattleOption,index:number):BattleActorSetup {
 const data=option.data, skill=data.skills.find(s=>s.stat==='REF'&&/handgun|пистолет/i.test(s.name));
 const calc=equipment(data);
 return {loadout:{weapons:[],activeWeaponId:null},characterId:option.id,version:option.version,unarmed:!data.items.some(i=>i.category==='weapon'&&i.quantity>0)||!data.items.some(i=>i.category==='ammo'&&i.quantity>0),x:4+(index%6)*2,y:10+Math.floor(index/6),team:index===0?'crew':'hostile',hidden:false,sprite:index===0?0:2,
  weapon:{weaponId:data.items.find(i=>i.category==='weapon'&&i.quantity>0)?.id||'',ammoItemId:data.items.find(i=>i.category==='ammo'&&i.quantity>0)?.id||'',skillName:skill?.name||'',skillRank:skill?.rank||0,damageDice:2,damageBonus:0,accuracy:0,range:50,rof:2,magazine:8,loaded:Math.min(8,data.items.find(i=>i.category==='ammo'&&i.quantity>0)?.quantity||0)},
  armor:Object.fromEntries(BATTLE_ZONES.map(zone=>[zone,data.armorMode==='manual'?data.armor[zone]:(calc.zones[zone].sp??0)])) as Record<BattleZone,number>,combatSense:data.role==='Соло'?Math.max(0,Math.min(10,data.specialRank)):0};
}
/** A client-side usability check only. The GM server repeats all validation. */
export function setupError(actors:BattleActorSetup[],options:BattleOption[]):string|null {
 if(actors.length>12)return 'В подготовке может быть не больше двенадцати участников.';
 if(new Set(actors.map(a=>a.characterId)).size!==actors.length)return 'Каждый лист можно добавить в бой только один раз.';
 for(const actor of actors){
  const option=options.find(c=>c.id===actor.characterId);if(!option)return 'Один из листов больше недоступен.';
  if(!isActorAppearanceId(actor.sprite))return option.name+': выбери доступный облик.';
  if(actor.net){if(!option.data.items.some(i=>i.id===actor.net?.deckItemId&&i.quantity>0))return option.name+': выбери существующую деку из инвентаря.';if(!interfaceRanks(option.data).includes(actor.net.interfaceRank))return option.name+': выбери ранг Interface из листа.';if(new Set(actor.net.programIds).size!==actor.net.programIds.length||actor.net.programIds.some(id=>!CONTROLLER_OPTIONS.some(p=>p.id===id)))return option.name+': проверь Controller-программы деки.';}
  if(actor.loadout||actor.unarmed)continue;
  if(!option.data.items.some(i=>i.id===actor.weapon.weaponId&&i.category==='weapon'&&i.quantity>0))return option.name+': выбери оружие из листа.';
  if(!option.data.items.some(i=>i.id===actor.weapon.ammoItemId&&i.category==='ammo'&&i.quantity>0))return option.name+': выбери боеприпасы с положительным количеством.';
  if(!Number.isInteger(actor.weapon.magazine)||actor.weapon.magazine<1||actor.weapon.magazine>1000)return option.name+': проверь вместимость магазина.';
  if(!Number.isInteger(actor.weapon.loaded)||actor.weapon.loaded<0||actor.weapon.loaded>actor.weapon.magazine||actor.weapon.loaded>(option.data.items.find(i=>i.id===actor.weapon.ammoItemId)?.quantity||0))return option.name+': заряжено больше, чем в магазине или выбранных патронов.';
  if(actor.weapon.skillName&&!option.data.skills.some(s=>s.stat==='REF'&&s.name===actor.weapon.skillName&&s.rank===actor.weapon.skillRank))return option.name+': обнови выбранный навык.';
 }
 return null;
}
export function shouldAcceptBattleResponse(current:BattleResponse|null,next:BattleResponse):boolean {
 if(!current?.battle)return true;
 if(!next.battle)return false;
 return next.battle.version>=current.battle.version;
}

/** Reopen a saved GM preparation without losing weapon mapping or positions. */
export function actorSetupFromScene(actor:any):BattleActorSetup {
 const weapon=actor.weapon||{};
 return {...(actor.loadout?{loadout:loadoutSetupFromScene(actor.loadout)}:{}),characterId:actor.characterId,version:actor.sheetVersion,x:actor.x,y:actor.y,team:actor.team,hidden:actor.hidden,sprite:actor.sprite,unarmed:!!weapon.unarmed,...(actor.net?.deck?{net:{deckItemId:actor.net.deckItemId||'',interfaceRank:actor.stats?.interface||0,programIds:[...actor.net.programIds]}}:{}),
  weapon:{weaponId:weapon.weaponId||'',ammoItemId:weapon.ammoItemId||'',skillName:weapon.skillName||'',skillRank:weapon.skillRank||0,damageDice:weapon.damageDice||1,damageBonus:weapon.damageBonus||0,accuracy:weapon.accuracy||0,range:weapon.range||1,rof:weapon.rof||1,magazine:weapon.magazine||1,loaded:weapon.ammo||0},
  armor:{...actor.armor},combatSense:actor.stats?.combatSense||0};
}

export type BattlePendingWear = {actorId:string;name:string;zone:BattleZone;amount:number;sourceSP:number;resultSP:number;reason:string};
/** Only projected actor records reach this helper; private armor data is never inferred. */
export function pendingArmorWear(scene:any):BattlePendingWear[]{
 return (scene?.actors||[]).flatMap((actor:any)=>BATTLE_ZONES.filter(zone=>actor.wearPending?.[zone]).map(zone=>({actorId:actor.id,name:actor.name,zone,...actor.wearPending[zone]})));
}
export function isSceneNpc(actor:any):boolean{return actor.origin?.kind==='npc';}

/** Strip private runtime bindings/receipts while preserving actual magazine counts. */
export function loadoutSetupFromScene(loadout:any):LoadoutEditorValue{
 return {activeWeaponId:loadout.activeWeaponId,weapons:loadout.weapons.map((weapon:any)=>{
  const keys=['weaponId','kind','profileId','weaponType','skillName','skillRank','damageDice','damageBonus','accuracy',...(weapon.kind==='ranged'?['ammoItemId','range','rof','magazine','fireModes','singleActionCap','reliability','fumbleClass']:['skillKind'])];
  return {...Object.fromEntries(keys.map(key=>[key,weapon[key]])),...(weapon.kind==='ranged'?{loaded:weapon.ammo}:{})} as LoadoutWeaponConfig;
 })};
}
