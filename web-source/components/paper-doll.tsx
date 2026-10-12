'use client';
import React from 'react';
import {Plus,Layers} from 'lucide-react';
import {SLOTS,type CharacterData,type Item,type ItemIcon,type Slot} from '@/lib/tracker';
import {catalogVisualIcon} from '@/lib/catalog-visuals';
import type {CatalogEntry} from '@/lib/catalog';
import {DOLL_SLOTS,EXTRA_SLOTS,SHORT_SLOT,SLOT_ART,wornInSlot} from '@/lib/wardrobe';

const ATLAS_ICONS=['pistol','revolver','smg','rifle','shotgun','sniper','heavyweapon','knife','katana','baton','grenade','ammo','armor','jacket','shirt','pants','boots','helmet','glasses','deck','radio','cybereye','cyberarm','cyberleg','trauma','tools','chip','gear'];
const ATLAS_ALIASES:Record<string,string>={weapon:'rifle',cyber:'cyberarm',medical:'trauma'};

export function IllustratedIcon({icon,small=false,item}:{icon:ItemIcon;small?:boolean;item?:Item}){
 if(item&&['weapon','cyber','gear'].includes(icon)){
  const facts:Record<string,unknown>={};
  for(const [key,label] of [['type','Тип'],['group','Группа'],['kind','kind'],['subtype','subtype']]){
   const line=item.description.split('\n').find(value=>value.startsWith(label+': '));if(line)facts[key]=line.slice(label.length+2);
  }
  const entry={id:'legacy-visual',name:item.name,category:item.category,facts} as CatalogEntry;
  const russian=item.name.toLocaleLowerCase('ru-RU');
  const named:Partial<Record<Item['category'],ItemIcon>>={weapon:/револьвер/.test(russian)?'revolver':/пистолет/.test(russian)?'pistol':/дробовик/.test(russian)?'shotgun':/катана/.test(russian)?'katana':/нож/.test(russian)?'knife':undefined,cyber:/глаз|оптик/.test(russian)?'cybereye':/нога/.test(russian)?'cyberleg':undefined,gear:/кибердек|кибермодем/.test(russian)?'deck':/инструмент/.test(russian)?'tools':undefined};
  icon=named[item.category]||catalogVisualIcon(entry);
 }

 if(icon==='gloves')return <span className={`item-icon illustrated-icon ${small?'small':''}`} aria-hidden="true"><img src="/art/icons/gloves.webp" alt=""/></span>;
 const index=ATLAS_ICONS.indexOf(ATLAS_ALIASES[icon]||icon),safe=index<0?27:index;
 return <span className={`item-icon illustrated-icon atlas-icon ${small?'small':''}`} aria-hidden="true"><span className="atlas-glyph" style={{backgroundPosition:`${safe%7/6*100}% ${Math.floor(safe/7)/3*100}%`}}/></span>;
}

/** Equipment map only. Visual slots never infer an item's armor coverage or effects. */
export default function PaperDoll({data,choose,compact=false}:{data:CharacterData;choose:(slot:Slot)=>void;compact?:boolean}){
 return <div className={`equipment-map ${compact?'compact-map':''}`}>
  <p className="map-instruction">Выбери слот, чтобы надеть или снять вещь.</p>
  <div className="silhouette-board" role="group" aria-label="Одежда на персонаже">
   <div className="equipment-silhouette" aria-hidden="true"/>
   {DOLL_SLOTS.map((slot,index)=><MapSlot key={slot} slot={slot} items={wornInSlot(data.items,slot)} choose={choose} position={index}/>)}
  </div>
  {!compact&&<div className="equipment-extra" role="group" aria-label="Остальное снаряжение">{EXTRA_SLOTS.map(slot=>{
   const items=wornInSlot(data.items,slot);
   return <button key={slot} className={`equipment-extra-slot ${items.length?'occupied':''}`} onClick={()=>choose(slot)} aria-label={`${SLOTS[slot]}: ${items.length?items.map(i=>i.name).join(', '):'пусто'}`}>
    <IllustratedIcon icon={items.at(-1)?.icon??SLOT_ART[slot]} item={items.at(-1)} small/>
    <span><strong>{SHORT_SLOT[slot]}</strong><small>{items.length?items.map(i=>i.name).join(', '):'Пусто'}</small></span>
    {items.length>1?<span className="equipment-count">{items.length}</span>:!items.length?<Plus aria-hidden="true"/>:null}
   </button>;
  })}</div>}
 </div>;
}

function MapSlot({slot,items,choose,position}:{slot:Slot;items:Item[];choose:(slot:Slot)=>void;position:number}){
 const item=items.at(-1);
 return <button className={`equipment-map-slot position-${position} ${item?'occupied':'vacant'}`} onClick={()=>choose(slot)} aria-label={`${SLOTS[slot]}: ${items.length?items.map(i=>i.name).join(', '):'пусто'}`}>
  <span className="map-slot-title">{SHORT_SLOT[slot]}</span>
  <span className="map-slot-content"><IllustratedIcon icon={item?.icon??SLOT_ART[slot]} item={item} small/><span>{item?.name??'Пусто'}</span></span>
  {items.length>1&&<span className="map-layer-count"><Layers aria-hidden="true"/>{items.length}</span>}
 </button>;
}
