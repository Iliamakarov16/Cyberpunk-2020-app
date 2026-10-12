import {catalogVisualIcon} from './catalog-visuals';
import {CATEGORIES,SLOTS,ZONES,newItem,zeroArmor,defaultSlot,type Item,type Slot,type Category,type ItemIcon} from './tracker';

export type CatalogEntry={id:string;name:string;category:string;slot:string|null;price:{value:number|null;currency:string;unit:string|null;raw:string};source:{bookId:string;printedPage:number|null;pdfPage:number|null};facts:Record<string,unknown>;effects:{text:string;automatic:boolean}[];dependencies:unknown[];notes:string[];verification:string};
export type SourceCatalog={books:{id:string;title:string}[];items:CatalogEntry[]};
export const BOOK_TITLES:Record<string,string>={core:'Cyberpunk 2020',cb1:'Chromebook 1',cb2:'Chromebook 2',cb3:'Chromebook 3',cb4:'Chromebook 4'};
const SLOT_ALIASES:Record<string,Slot>={innerTorso:'inner',outerTorso:'outer',outerwear:'outer',torso:'outer',suit:'body',face:'eyes',foot:'feet',hand:'hands',finger:'accessory',neck:'accessory',waist:'accessory',back:'bag'};
const TRUSTED_CORE_ARMOR=new Set(['core-kevlar-t-shirt-vest','core-steel-helmet','core-light-armor-jacket','core-med-armor-jacket','core-flack-vest','core-flack-pants','core-nylon-helmet','core-heavy-armor-jacket','core-door-gunner-s-vest','core-metalgear']);
// Visual slots for the individually named garments in Chromebook 1.
// These assignments do not imply protective coverage or mechanical effects.
const CLOTHING_SLOT_OVERRIDES:Record<string,Slot>={
 // Printed page 58.
 'cb1-nu-tek-wearman-video-jacket':'outer','cb1-nu-tek-wearman-video-skirt':'legs',
 // Printed page 59.
 'cb1-uniware-blouse-shirt':'inner','cb1-uniware-boots':'feet','cb1-uniware-dress':'body','cb1-uniware-jumpsuit':'body',
 'cb1-uniware-pants':'legs','cb1-uniware-skirt':'legs','cb1-uniware-utility-belt':'accessory','cb1-uniware-vest':'outer',
 // Printed page 61.
 'cb1-icon-america-bomber-jacket':'outer','cb1-icon-america-boots':'feet','cb1-icon-america-gun-belt':'accessory',
 'cb1-icon-america-gunfighter-hat':'head','cb1-icon-america-halfboots':'feet','cb1-icon-america-long-duster':'outer',
 'cb1-icon-america-long-skirt':'legs','cb1-icon-america-miniskirt':'legs','cb1-icon-america-pants':'legs','cb1-icon-america-tunic':'inner',
 // Printed page 63.
 'cb1-takanaka-exec-cape':'outer','cb1-takanaka-exec-cravat':'accessory','cb1-takanaka-exec-jacket':'outer',
 'cb1-takanaka-exec-monogram-shirt':'inner','cb1-takanaka-exec-pants':'legs','cb1-takanaka-exec-scarf':'accessory',
 'cb1-takanaka-exec-tie':'accessory','cb1-takanaka-exec-top-coat':'outer','cb1-takanaka-exec-vest':'outer',
 // Printed page 64.
 'cb1-eji-of-japan-designer-jeans':'legs','cb1-eji-of-japan-lambs-wool-sweater':'inner',
 'cb4-base-vest':'outer',
};
const FACT_LABELS:Record<string,string>={type:'Тип',WA:'Точность (WA)',concealability:'Скрытность',availability:'Доступность',damage:'Урон',caliber:'Калибр',shots:'Боезапас',ROF:'Темп стрельбы (ROF)',reliability:'Надёжность',range:'Дальность',SP:'SP',EV:'EV',coverage:'Покрытие',possibleCoverage:'Возможное покрытие',armorType:'Тип брони',weightKg:'Вес, кг',humanityLoss:'Потеря человечности (HL)',HumanityLoss:'Потеря человечности (HL)',surgery:'Установка / операция',dependencies:'Требования',roundCount:'Патронов в упаковке',capacity:'Вместимость',memoryMU:'Память (MU)',SDP:'SDP',edgedWeaponsHalfSP:'Половина SP против режущего оружия',group:'Группа',style:'Стиль',code:'Код'};

export function isEquipmentEntry(entry:CatalogEntry):boolean{return Object.hasOwn(CATEGORIES,entry.category);}
export function catalogSource(entry:CatalogEntry):string{
 return `${BOOK_TITLES[entry.source.bookId]??entry.source.bookId}${entry.source.printedPage!=null?`, стр. ${entry.source.printedPage}`:''}${entry.source.pdfPage!=null?` (PDF ${entry.source.pdfPage})`:''}`;
}
export function catalogSlot(entry:CatalogEntry):Slot{
 const category=entry.category as Category;
 if(category==='cyber')return 'implant';
 if(category==='clothing'&&CLOTHING_SLOT_OVERRIDES[entry.id])return CLOTHING_SLOT_OVERRIDES[entry.id];
 if(category==='clothing'&&entry.slot==='torso')return 'inner';
 if(entry.slot && Object.hasOwn(SLOTS,entry.slot))return entry.slot as Slot;
 if(entry.slot && SLOT_ALIASES[entry.slot])return SLOT_ALIASES[entry.slot];
 if(TRUSTED_CORE_ARMOR.has(entry.id)){
  const zones=Array.isArray(entry.facts.coverage)?entry.facts.coverage:[];
  if(zones.length===6)return 'body';
  if(zones.includes('head'))return 'head';
  if(zones.includes('rightLeg'))return 'legs';
  if(entry.id==='core-kevlar-t-shirt-vest')return 'inner';
 }
 return category==='clothing'||category==='armor'?'bag':defaultSlot(category);
}
export function catalogNeedsSlot(entry:CatalogEntry):boolean{
 return (entry.category==='clothing'||entry.category==='armor')&&!entry.slot&&!CLOTHING_SLOT_OVERRIDES[entry.id]&&!TRUSTED_CORE_ARMOR.has(entry.id);
}
function display(value:unknown):string{
 if(value===null)return 'не указано';
 if(typeof value==='boolean')return value?'да':'нет';
 if(Array.isArray(value))return value.map(v=>typeof v==='string'?(ZONES[v as keyof typeof ZONES]??v):display(v)).join(', ');
 return typeof value==='object'?JSON.stringify(value):String(value);
}
export function catalogPrice(entry:CatalogEntry,compact=false):string{
 const raw=entry.price.raw||String(entry.price.value??'Не указана');
 const amount=/^[\d\s.,]+$/.test(raw)?`${raw} ${entry.price.currency||'eb'}`:raw;
 const price=entry.price.unit&&!raw.toLowerCase().includes(entry.price.unit.toLowerCase())?`${amount} / ${entry.price.unit}`:amount;
 return compact&&price.length>26?'Цена в описании':price;
}
export function catalogDescription(entry:CatalogEntry):string{
 const lines=[`Цена: ${catalogPrice(entry)}`];
 for(const [key,value] of Object.entries(entry.facts))if(value!==null)lines.push(`${FACT_LABELS[key]??key}: ${display(value)}`);
 if(entry.dependencies.length)lines.push(`Требования: ${entry.dependencies.map(display).join('; ')}`);
 if(entry.effects.length)lines.push('Эффекты по книге:',...entry.effects.map(e=>e.text));
 if(entry.notes.length)lines.push('Примечания:',...entry.notes);
 if(entry.verification!=='text-and-page')lines.unshift('Сверь данные с указанной страницей перед игрой.');
 if(catalogNeedsSlot(entry))lines.unshift('Слот не указан в каталоге. Пока вещь в «С собой»: выбери слот в карточке перед экипировкой. Для комплекта можно создать отдельные вещи.');
 const text=lines.join('\n');
 return text.length<=3000?text:text.slice(0,2880)+'\n… Полные данные смотри на указанной странице книги.';
}
const WEAR_ICONS:Partial<Record<Slot,ItemIcon>>={head:'helmet',eyes:'glasses',inner:'shirt',outer:'jacket',legs:'pants',feet:'boots',hands:'gloves',body:'armor'};
export function catalogIcon(entry:CatalogEntry):ItemIcon{
 const visual=catalogVisualIcon(entry);
 return entry.category==='clothing'||entry.category==='armor'?WEAR_ICONS[catalogSlot(entry)]??visual:visual;
}
export function fromCatalogEntry(entry:CatalogEntry):Item{
 if(!isEquipmentEntry(entry))throw new Error('Эта запись не относится к экипировке.');
 const category=entry.category as Category,slot=catalogSlot(entry),icon=catalogIcon(entry);
 const item:Item={...newItem(category),name:entry.name.slice(0,100),slot,icon,source:catalogSource(entry).slice(0,250),description:catalogDescription(entry)};
 const weight=entry.facts.weightKg;
 if(entry.verification==='text-and-page'&&typeof weight==='number'&&Number.isFinite(weight)&&weight>=0&&weight<=10000)item.weight=weight;
 // Only the explicit, page-checked core table is a mechanical template.
 // WA, SDP, HL and conditional effects always remain descriptions.
 if(entry.source.bookId==='core'&&entry.verification==='text-and-page'&&TRUSTED_CORE_ARMOR.has(entry.id)){
  const {SP,EV,coverage,armorType}=entry.facts;
  if(typeof SP==='number'&&Number.isFinite(SP)&&SP>0&&SP<=200&&typeof EV==='number'&&Number.isFinite(EV)&&EV>=0&&EV<=20&&Array.isArray(coverage)&&coverage.length>0&&coverage.every(z=>typeof z==='string'&&Object.hasOwn(ZONES,z))&&(armorType==='soft'||armorType==='hard')){
   item.armor={type:armorType,ev:EV,order:slot==='inner'?10:20,coverage:{...zeroArmor(),...Object.fromEntries(coverage.map(z=>[z,SP]))}};
  }
 }
 return item;
}
