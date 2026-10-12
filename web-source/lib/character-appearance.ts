import type {CharacterData, ItemIcon, Slot} from './tracker';

export const PORTRAIT_FITS=['contain','cover'] as const;
export const PORTRAIT_EFFECTS=['off','foil','scan','pulse','tilt'] as const;
export type PortraitFit=typeof PORTRAIT_FITS[number];
export type PortraitEffect=typeof PORTRAIT_EFFECTS[number];
/** Framing percentages are integers so portable archives preserve exact values. */
export type PortraitFrame={fit:PortraitFit;x:number;y:number;zoom:number;height:number;effect:PortraitEffect};
export type CharacterAppearance={accent:'rust'|'teal'|'blue'|'violet';portrait?:string;portraitFrame?:PortraitFrame};
export const DEFAULT_PORTRAIT_FRAME:Readonly<PortraitFrame>={fit:'contain',x:50,y:50,zoom:100,height:340,effect:'off'};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bounded=(value:unknown,min:number,max:number,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.round(Math.max(min,Math.min(max,value))):fallback;

export function isSafePortrait(value:unknown):value is string{
 return typeof value==='string'&&value.length<=100000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Strict shape check for API adapters; normalization below is for stored client data. */
export function isPortraitFrame(value:unknown):value is PortraitFrame{
 if(!object(value)||Object.keys(value).length!==6||!Object.keys(DEFAULT_PORTRAIT_FRAME).every(key=>Object.prototype.hasOwnProperty.call(value,key)))return false;
 return PORTRAIT_FITS.includes(value.fit as PortraitFit)&&PORTRAIT_EFFECTS.includes(value.effect as PortraitEffect)
  &&[ ['x',0,100],['y',0,100],['zoom',100,300],['height',220,520] ].every(([key,min,max])=>{
   const number=value[key as string];return typeof number==='number'&&Number.isInteger(number)&&number>=(min as number)&&number<=(max as number);
  });
}

/** Missing metadata stays missing: old character/archive equality remains unchanged. */
export function normalizePortraitFrame(raw:unknown):PortraitFrame|undefined{
 if(!object(raw))return undefined;
 return {fit:PORTRAIT_FITS.includes(raw.fit as PortraitFit)?raw.fit as PortraitFit:'contain',
  x:bounded(raw.x,0,100,50),y:bounded(raw.y,0,100,50),zoom:bounded(raw.zoom,100,300,100),
  height:bounded(raw.height,220,520,340),effect:PORTRAIT_EFFECTS.includes(raw.effect as PortraitEffect)?raw.effect as PortraitEffect:'off'};
}

export function normalizeCharacterAppearance(raw:unknown):CharacterAppearance{
 const value=object(raw)?raw:{};
 const frame=normalizePortraitFrame(value.portraitFrame);
 return {accent:['rust','teal','blue','violet'].includes(value.accent as string)?value.accent as CharacterAppearance['accent']:'rust',
  ...(isSafePortrait(value.portrait)?{portrait:value.portrait}:{}),...(frame?{portraitFrame:frame}:{})};
}

export type ExteriorCard = {
 character_id:number; name:string;
 appearance:CharacterAppearance;
 items:{name:string;slot:Slot;icon:ItemIcon}[];
};

/** A separate public projection: never pass a private sheet or Item to its viewer. */
export function exteriorCard(character_id:number,data:CharacterData):ExteriorCard {
 const worn=data.items.filter(i=>i.equipped&&i.quantity>0);
 const suit=worn.some(i=>i.slot==='body'),outer=worn.some(i=>i.slot==='outer');
 return {character_id,name:data.name,appearance:normalizeCharacterAppearance(data.appearance),items:worn.filter(i=>{
  if(i.visibility==='hidden')return false;
  if(i.visibility==='visible')return true;
  if(i.slot==='bag'||i.slot==='implant'||i.category==='cyber'||i.category==='ammo')return false;
  if(suit&&['inner','outer','legs'].includes(i.slot))return false;
  if(outer&&i.slot==='inner')return false;
  return true;
 }).map(i=>({name:i.name,slot:i.slot,icon:i.icon}))};
}
