import {type Item,type ItemIcon,type Slot} from './tracker';

export const SLOT_ART:Record<Slot,ItemIcon>={head:'helmet',eyes:'glasses',inner:'shirt',outer:'jacket',legs:'pants',feet:'boots',hands:'gloves',accessory:'gear',body:'armor',mainHand:'weapon',offHand:'weapon',implant:'cyber',bag:'gear'};
export const DOLL_SLOTS:Slot[]=['head','eyes','inner','outer','legs','feet'];
export const EXTRA_SLOTS:Slot[]=['hands','body','mainHand','offHand','accessory','implant','bag'];
export const SHORT_SLOT:Record<Slot,string>={head:'Голова',eyes:'Очки',inner:'Нижний слой',outer:'Верх',legs:'Ноги',feet:'Обувь',hands:'Руки',accessory:'Аксессуары',body:'Костюм',mainHand:'Основная рука',offHand:'Вторая рука',implant:'Импланты',bag:'Рюкзак'};
/** IllustratedIcon crops the shared atlas; gloves retain their existing registered artwork. */
export const iconAsset=(icon:ItemIcon)=>icon==='gloves'?'/art/icons/gloves.webp':'/art/inventory-atlas-v2.png';
export const wornInSlot=(items:Item[],slot:Slot)=>items.filter(item=>item.equipped&&item.quantity>0&&item.slot===slot).sort((a,b)=>(a.armor?.order??0)-(b.armor?.order??0));

export type Registration={left:string;top:string;width:string;height:string;clipPath?:string};
const registered=(source:number[],target:number[]):Registration=>{
 const sx=(target[2]-target[0])/(source[2]-source[0]),sy=(target[3]-target[1])/(source[3]-source[1]);
 return {left:`${(target[0]-source[0]*sx)/1024*100}%`,top:`${(target[1]-source[1]*sy)/1536*100}%`,width:`${sx*100}%`,height:`${sy*100}%`};
};
/** CSS places transparent drawings onto one shared paper-doll canvas. */
const REGISTRATION:Record<string,Registration>={
 jacket:registered([107,272,926,899],[190,250,834,800]),
 pants:registered([301,546,717,1320],[301,640,717,1350]),
 boots:registered([238,1004,787,1448],[260,1165,770,1452]),
 helmet:registered([338,69,677,457],[430,53,595,255]),
 glasses:registered([380,100,644,196],[443,123,581,173]),
 shirt:registered([126,207,898,928],[315,280,708,720]),
 vest:registered([237,211,800,911],[343,280,683,720]),
 suit:registered([134,131,891,1403],[205,250,820,1340]),
};
type DressLayer={key:string;asset:string;item:Item;order:number;style?:Registration};
/** Illustration follows the slot. Armor protection continues to use its own zone coverage. */
export function dressLayers(items:Item[]):DressLayer[]{
 return items.flatMap((item,index)=>{
  if(!item.equipped||item.quantity<=0)return [];
  let visual:string|null=null;
  if(item.slot==='head')visual='helmet';
  if(item.slot==='eyes')visual='glasses';
  if(item.slot==='inner')visual=item.category==='armor'?'vest':'shirt';
  if(item.slot==='outer')visual=item.icon==='armor'?'vest':'jacket';
  if(item.slot==='legs')visual='pants';
  if(item.slot==='feet')visual='boots';
  if(item.slot==='hands')visual='gloves';
  if(item.slot==='body')visual='suit';
  if(!visual)return [];
  const order=item.slot==='head'?80:item.slot==='eyes'?70:item.slot==='hands'?60:item.slot==='feet'?50:item.slot==='body'?40:item.slot==='outer'?30:item.slot==='legs'?20:10;
  const layer={key:item.id,asset:`/art/layers/${visual}.webp`,item,style:REGISTRATION[visual],order:order+(item.armor?.order??0)/100+index/10000};
  if(visual==='gloves')return [
   {...layer,key:item.id+'-left',style:{...registered([57,597,275,1003],[183,705,275,883]),clipPath:'inset(0 50% 0 0)'}},
   {...layer,key:item.id+'-right',style:{...registered([750,597,967,1003],[750,705,842,883]),clipPath:'inset(0 0 0 50%)'}},
  ];
  return [layer];
 }).sort((a,b)=>a.order-b.order);
}

const cropIcon=(box:number[]):Registration=>{const edge=Math.max(box[2]-box[0],box[3]-box[1]);return {left:`${((edge-(box[2]-box[0]))/2-box[0])/edge*100}%`,top:`${((edge-(box[3]-box[1]))/2-box[1])/edge*100}%`,width:`${1024/edge*100}%`,height:`${1536/edge*100}%`};};
const ICON_REGISTRATION:Partial<Record<ItemIcon,Registration>>={helmet:cropIcon([338,69,677,457]),shirt:cropIcon([126,207,898,928]),armor:cropIcon([237,211,800,911]),gloves:cropIcon([57,597,275,1003])};
export const iconStyle=(icon:ItemIcon)=>ICON_REGISTRATION[icon];
