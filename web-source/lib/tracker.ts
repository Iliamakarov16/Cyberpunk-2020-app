import {normalizeCharacterAppearance,type CharacterAppearance} from './character-appearance';

export const STATS = ['INT','REF','TECH','COOL','ATTR','LUCK','MA','BODY','EMP'] as const;
export type Stat = typeof STATS[number];
export const STAT_LABELS: Record<Stat,string> = {INT:'Интеллект',REF:'Рефлексы',TECH:'Техника',COOL:'Самообладание',ATTR:'Привлекательность',LUCK:'Удача',MA:'Движение',BODY:'Телосложение',EMP:'Эмпатия'};
export const ZONES = {head:'Голова',torso:'Торс',rightArm:'Правая рука',leftArm:'Левая рука',rightLeg:'Правая нога',leftLeg:'Левая нога'} as const;
export type Zone = keyof typeof ZONES;
export const SLOTS = {head:'Голова',eyes:'Лицо и очки',inner:'Нижний слой',outer:'Верхний слой',legs:'Ноги',feet:'Обувь',hands:'Перчатки',accessory:'Аксессуары',body:'Костюм',mainHand:'Основная рука',offHand:'Вторая рука',implant:'Импланты',bag:'С собой'} as const;
export type Slot = keyof typeof SLOTS;
export const CATEGORIES = {clothing:'Одежда',armor:'Броня',weapon:'Оружие',gear:'Снаряжение',ammo:'Боеприпасы',cyber:'Имплант'} as const;
export type Category = keyof typeof CATEGORIES;
export const ICONS = {shirt:'Футболка',jacket:'Куртка',helmet:'Шлем',glasses:'Очки',pants:'Ноги',boots:'Обувь',gloves:'Перчатки',armor:'Броня',weapon:'Оружие',pistol:'Пистолет',deck:'Кибердека',cyber:'Имплант',ammo:'Боеприпасы',gear:'Вещь',radio:'Связь',medical:'Медицина',trauma:'Медицинский набор',revolver:'Револьвер',smg:'Пистолет-пулемёт',rifle:'Винтовка',shotgun:'Дробовик',sniper:'Снайперская винтовка',heavyweapon:'Тяжёлое оружие',knife:'Нож',katana:'Катана',baton:'Дубинка',grenade:'Граната',cybereye:'Киберглаз',cyberarm:'Киберрука',cyberleg:'Кибернога',tools:'Инструменты',chip:'Чип'} as const;
export type ItemIcon = keyof typeof ICONS;
export type Armor = {type:'soft'|'hard'|'skinweave'|'implant';coverage:Record<Zone,number>;ev:number;order:number};
export type Modifier = {stat:Stat;value:number;label:string;source:string};
export type Item = {id:string;name:string;category:Category;quantity:number;weight:number;equipped:boolean;description:string;slot:Slot;icon:ItemIcon;armor:Armor|null;modifiers:Modifier[];source:string;visibility?:'auto'|'visible'|'hidden'};
export type Skill = {name:string;stat:Stat;rank:number;ip:number;multiplier:number};
/** Core 2.01, pp. 53–54: the first rank costs 10 IP; later ranks use the current rank. */
export function skillImprovementCost({rank,multiplier}:Pick<Skill,'rank'|'multiplier'>):number|null {
 if(!Number.isInteger(rank)||rank<0||rank>=10||!Number.isInteger(multiplier)||multiplier<1)return null;
 return rank===0?10:rank*10*multiplier;
}
export type CharacterData = {schemaVersion:2;name:string;role:string;special:string;specialRank:number;cash:number;humanity:number;wounds:number;armorPenalty:number;armorMode:'manual'|'equipment';evAdjustment:number;stats:Record<Stat,number>;armor:Record<Zone,number>;skills:Skill[];items:Item[];notes:string;background:string;condition:string;appearance:CharacterAppearance};
export type Character = {id:number;owner_id:number;owner:string;version:number;updated:number;data:CharacterData;can_edit?:boolean;can_delete?:boolean;can_history?:boolean;access?:'owner'|'gm'|'shared'};
export const zeroArmor = ():Record<Zone,number> => Object.fromEntries(Object.keys(ZONES).map(k=>[k,0])) as Record<Zone,number>;
export const defaultSlot = (category:Category):Slot => category==='armor'?'outer':category==='clothing'?'inner':category==='weapon'?'mainHand':category==='cyber'?'implant':'bag';
export const newId = () => globalThis.crypto?.randomUUID?.() ?? 'item-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
export function newItem(category:Category='gear'):Item {
 return {id:newId(),name:'',category,quantity:1,weight:0,equipped:false,description:'',slot:defaultSlot(category),icon:category==='clothing'?'shirt':category,armor:null,modifiers:[],source:''};
}
export function blank(name='Новый персонаж',role='Соло'):CharacterData {
 return {schemaVersion:2,name,role,special:'',specialRank:0,cash:0,humanity:0,wounds:0,armorPenalty:0,armorMode:'equipment',evAdjustment:0,stats:Object.fromEntries(STATS.map(k=>[k,0])) as Record<Stat,number>,armor:zeroArmor(),skills:[],items:[],notes:'',background:'',condition:'',appearance:{accent:'rust'}};
}
/** Legacy sheets retain their manual SP/EV. Reading never writes or infers armor from item names. */
export function normalize(raw:any):CharacterData {
 const base=blank(raw?.name,raw?.role);
 return {...base,...raw,schemaVersion:2,armorMode:raw?.armorMode==='equipment'?'equipment':'manual',evAdjustment:raw?.evAdjustment??0,appearance:normalizeCharacterAppearance(raw?.appearance),
  stats:{...base.stats,...raw?.stats},armor:{...base.armor,...raw?.armor},
  skills:(raw?.skills??[]).map((s:any)=>({...s})),
  items:(raw?.items??[]).map((i:any,index:number)=>({...newItem(i.category),...i,id:i.id??`legacy-${index}`,slot:i.slot??defaultSlot(i.category),icon:i.icon??(i.category==='clothing'?'shirt':i.category),armor:i.armor?{...i.armor,coverage:{...zeroArmor(),...i.armor.coverage}}:null,modifiers:i.modifiers??[],source:i.source??''}))};
}
export const layerBonus = (difference:number) => difference<=4?5:difference<=8?4:difference<=14?3:difference<=20?2:difference<=26?1:0;
export const combineSP = (a:number,b:number) => Math.max(a,b)+layerBonus(Math.abs(a-b));
export function equipment(data:CharacterData) {
 const active=data.items.filter(i=>i.equipped&&i.quantity>0);
 const warnings:string[]=[];
 for(const item of data.items.filter(i=>i.equipped&&i.quantity===0))warnings.push(`${item.name}: количество 0, эффекты не действуют.`);
 const byStat=Object.fromEntries(STATS.map(stat=>[stat,active.flatMap(i=>i.modifiers.filter(m=>m.stat===stat).map(m=>({...m,item:i.name})))])) as Record<Stat,(Modifier&{item:string})[]>;
 const modified=Object.fromEntries(STATS.map(stat=>[stat,data.stats[stat]+byStat[stat].reduce((s,m)=>s+m.value,0)])) as Record<Stat,number>;
 let layeringEV=0;
 const zones=Object.fromEntries((Object.keys(ZONES) as Zone[]).map(zone=>{
  const layers=active.filter(i=>i.armor&&i.armor.coverage[zone]>0).sort((a,b)=>a.armor!.order-b.armor!.order || data.items.indexOf(a)-data.items.indexOf(b));
  const hard=layers.filter(i=>i.armor!.type==='hard').length;
  const valid=layers.length<=3&&hard<=1;
  if(!valid)warnings.push(`${ZONES[zone]}: ${layers.length>3?'больше трёх слоёв брони':'больше одного жёсткого слоя'}.`);
  const ordinary=layers.filter(i=>i.armor!.type!=='skinweave').length;
  layeringEV=Math.max(layeringEV,ordinary>2?3:ordinary>1?1:0);
  const sp=layers.reduce((sum,item,index)=>index?combineSP(sum,item.armor!.coverage[zone]):item.armor!.coverage[zone],0);
  return [zone,{sp:valid?sp:null,layers,valid}];
 })) as Record<Zone,{sp:number|null;layers:Item[];valid:boolean}>;
 const itemEV=active.reduce((sum,i)=>sum+(i.armor?.ev??0),0);
 const computedEV=Math.max(0,itemEV+layeringEV+data.evAdjustment);
 const ev=data.armorMode==='manual'?data.armorPenalty:computedEV;
 const stats={...modified,REF:modified.REF-ev};
 const weight=data.items.filter(i=>i.category!=='cyber').reduce((sum,i)=>sum+i.quantity*i.weight,0);
 return {active,byStat,stats,zones,warnings,itemEV,layeringEV,computedEV,ev,weight,valid:!warnings.some(w=>w.includes('сло'))};
}
const coverage = (sp:number,zones:Zone[]) => Object.fromEntries((Object.keys(ZONES) as Zone[]).map(k=>[k,zones.includes(k)?sp:0])) as Record<Zone,number>;
export type Preset = {key:string;label:string;category:Category;slot:Slot;icon:ItemIcon;sp?:number;zones?:Zone[];ev?:number;type?:Armor['type'];order?:number;description:string};
export const PRESETS:Preset[] = [
 {key:'tee',label:'Футболка',category:'clothing',slot:'inner',icon:'shirt',description:'Обычная одежда. Без механических бонусов.'},
 {key:'jacket',label:'Куртка',category:'clothing',slot:'outer',icon:'jacket',description:'Обычная одежда. Без механических бонусов.'},
 {key:'pants',label:'Брюки',category:'clothing',slot:'legs',icon:'pants',description:'Обычная одежда. Без механических бонусов.'},
 {key:'boots',label:'Ботинки',category:'clothing',slot:'feet',icon:'boots',description:'Обычная обувь. Без механических бонусов.'},
 {key:'shades',label:'Зеркальные очки',category:'clothing',slot:'eyes',icon:'glasses',description:'Стиль — тоже часть истории. Без пассивного бонуса.'},
 {key:'kevlar',label:'Kevlar T-shirt / Vest',category:'armor',slot:'inner',icon:'shirt',sp:10,zones:['torso'],ev:0,type:'soft',order:10,description:'Мягкая броня торса. Вес внеси по своему листу.'},
 {key:'light',label:'Light Armor Jacket',category:'armor',slot:'outer',icon:'jacket',sp:14,zones:['torso','rightArm','leftArm'],ev:0,type:'soft',order:20,description:'Лёгкая бронекуртка. Торс и обе руки.'},
 {key:'medium',label:'Medium Armor Jacket',category:'armor',slot:'outer',icon:'jacket',sp:18,zones:['torso','rightArm','leftArm'],ev:1,type:'soft',order:20,description:'Средняя бронекуртка. Торс и обе руки.'},
 {key:'heavy',label:'Heavy Armor Jacket',category:'armor',slot:'outer',icon:'jacket',sp:20,zones:['torso','rightArm','leftArm'],ev:2,type:'soft',order:20,description:'Тяжёлая бронекуртка. Торс и обе руки.'},
 {key:'steel',label:'Steel Helmet',category:'armor',slot:'head',icon:'helmet',sp:14,zones:['head'],ev:0,type:'hard',order:20,description:'Стальной шлем. Жёсткий слой.'},
 {key:'flak',label:'Flak Vest',category:'armor',slot:'outer',icon:'armor',sp:20,zones:['torso'],ev:1,type:'hard',order:20,description:'Жёсткий бронежилет.'},
 {key:'flakpants',label:'Flak Pants',category:'armor',slot:'legs',icon:'pants',sp:20,zones:['rightLeg','leftLeg'],ev:1,type:'hard',order:20,description:'Жёсткая броня обеих ног.'},
 {key:'metalgear',label:'MetalGear',category:'armor',slot:'body',icon:'armor',sp:25,zones:Object.keys(ZONES) as Zone[],ev:2,type:'hard',order:20,description:'Полный комплект. EV 2 учитывается один раз за костюм.'},
];
export function fromPreset(preset:Preset):Item {
 return {...newItem(preset.category),name:preset.label,slot:preset.slot,icon:preset.icon,description:preset.description,source:preset.sp?'Cyberpunk 2020, core 2.01: Armor / FNFF':'' ,armor:preset.sp?{type:preset.type!,coverage:coverage(preset.sp,preset.zones!),ev:preset.ev!,order:preset.order!}:null};
}
