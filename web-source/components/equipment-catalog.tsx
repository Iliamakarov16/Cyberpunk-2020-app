'use client';
import React,{useEffect,useMemo,useState} from 'react';
import {Plus,Search,AlertTriangle} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {IllustratedIcon} from '@/components/paper-doll';
import {SLOT_ART} from '@/lib/wardrobe';
import {CATEGORIES,SLOTS,PRESETS,newItem,fromPreset,type Item,type Slot,type Category} from '@/lib/tracker';
import {BOOK_TITLES,isEquipmentEntry,catalogSource,catalogSlot,catalogIcon,catalogPrice,catalogNeedsSlot,fromCatalogEntry,type SourceCatalog} from '@/lib/catalog';
import {catalogIsDeck,catalogIsProgram,catalogMatchesQuery,catalogVariantLabel} from '@/lib/catalog-visuals';

let cachedCatalog:SourceCatalog|undefined;
export default function EquipmentCatalog({select,slot,category:categoryScope}:{select:(item:Item)=>void;slot?:Slot;category?:Category}){
 const initialCategory=categoryScope??(slot==='implant'?'cyber':slot==='mainHand'||slot==='offHand'?'weapon':slot&&['head','eyes','inner','outer','legs','feet','hands','body'].includes(slot)?'wear':'all');
 const [mode,setMode]=useState('books'),[query,setQuery]=useState(''),[category,setCategory]=useState<string>(categoryScope??'all'),[book,setBook]=useState('all'),[limit,setLimit]=useState(40);
 const [catalog,setCatalog]=useState<SourceCatalog|undefined>(cachedCatalog),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(cachedCatalog){setCatalog(cachedCatalog);return;}
  const controller=new AbortController();
  fetch('/catalog/equipment-v1.json',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Не удалось загрузить каталог.');const data=await r.json();if(!data||typeof data!=='object'||!('items' in data)||!Array.isArray(data.items))throw new Error('Каталог не удалось прочитать.');return data as SourceCatalog;}).then(data=>{if(!controller.signal.aborted){cachedCatalog=data;setCatalog(data);setError('');}}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Не удалось загрузить каталог.');});
  return()=>controller.abort();
 },[attempt]);
 const cyberScope=categoryScope==='cyber';
 const itemsLabel=cyberScope?'имплантов':'вещей';
 const searchExamples=cyberScope?['киберглаз','киберрука','кибернога','нейро']:['пистолет','куртка','киберглаз','программа'];
 useEffect(()=>{setMode('books');setQuery('');setCategory(categoryScope??'all');setBook('all');setLimit(40);},[categoryScope]);
 const entries=useMemo(()=>catalog?.items.filter(isEquipmentEntry)??[],[catalog]);
 const slotEntries=useMemo(()=>entries.filter(e=>!slot||catalogSlot(e)===slot),[entries,slot]);
 const scopeEntries=useMemo(()=>slotEntries.filter(entry=>!categoryScope||entry.category===categoryScope),[slotEntries,categoryScope]);
 const bookCounts=useMemo(()=>Object.fromEntries(Object.keys(BOOK_TITLES).map(id=>[id,scopeEntries.filter(e=>e.source.bookId===id).length])),[scopeEntries]);
 const chromebookCount=useMemo(()=>(categoryScope?scopeEntries:entries).filter(e=>/^cb[1-4]$/.test(e.source.bookId)).length,[entries,scopeEntries,categoryScope]);
 const results=useMemo(()=>scopeEntries.filter(e=>(book==='all'||e.source.bookId===book)&&(category==='all'||category==='wear'&&['clothing','armor'].includes(e.category)||category==='netprogram'&&catalogIsProgram(e)||category==='cyberdeck'&&catalogIsDeck(e)||e.category===category)&&catalogMatchesQuery(e,query,catalogSource(e))),[scopeEntries,query,category,book]);
 const filtered=!!query.trim()||category!==(categoryScope??'all')||book!=='all';
 const resetFilters=()=>{setQuery('');setCategory(categoryScope??'all');setBook('all');setLimit(40);};
 const presets=PRESETS.filter(p=>(!slot||p.slot===slot)&&(!categoryScope||p.category===categoryScope));
 const showTemplates=!categoryScope||presets.length>0;
 const customCategory:Category=categoryScope??(initialCategory==='cyber'?'cyber':initialCategory==='weapon'?'weapon':initialCategory==='wear'?'clothing':'gear');
 return <div className="catalog" data-catalog-category={categoryScope}>
  <button className="catalog-custom" onClick={()=>select({...newItem(customCategory),...(slot?{slot,icon:SLOT_ART[slot]}:{})})}><Plus/><span><strong>{cyberScope?'Свой имплант':'Своя вещь'}</strong><small>{cyberScope&&!slot?'Название, место установки и свойства вручную':slot?`В слот «${SLOTS[slot]}»`:'Заполнить название и свойства вручную'}</small></span></button>
  <Tabs value={mode} onValueChange={setMode} className="catalog-tabs">
   {showTemplates&&<TabsList className="compact-tabs" aria-label={cyberScope?'Откуда добавить имплант':'Откуда добавить вещь'}><TabsTrigger value="books">Из книг</TabsTrigger><TabsTrigger value="templates">Быстрые шаблоны</TabsTrigger></TabsList>}
   <TabsContent value="books">
    <div className="catalog-library-heading"><div><span className="eyebrow">{cyberScope?'КИБЕРИМПЛАНТЫ ИЗ КНИГ':'КАТАЛОГ ИЗ КНИГ'}</span><h3>{cyberScope?'Выбери имплант или компонент':categoryScope?CATEGORIES[categoryScope]:'Выбери книгу или найди вещь'}</h3></div>{catalog&&<p>Хромбуки 1–4: <strong>{chromebookCount.toLocaleString('ru-RU')}</strong> {itemsLabel}</p>}</div>
    <div className="catalog-book-shelf" role="group" aria-label={cyberScope?'Книги: количество доступных имплантов':slot?`Книги: количество вещей для слота «${SLOTS[slot]}»`:'Выбор книги: количество доступных вещей'}>
     {[['all','Все книги'],...Object.entries(BOOK_TITLES)].map(([id,title])=><button type="button" key={id} className={`catalog-book-spine ${book===id?'selected':''}`} aria-pressed={book===id} onClick={()=>{setBook(id);setLimit(40);}}><span className="catalog-book-code">{id==='all'?'FULL INDEX':id==='core'?'CORE / 2020':`CHROME / 0${id.slice(2)}`}</span><strong>{title}</strong><small>{catalog?`${(id==='all'?scopeEntries.length:bookCounts[id]??0).toLocaleString('ru-RU')} ${itemsLabel}${slot?' в слот':''}`:'Загрузка…'}</small></button>)}
    </div>
    <div className="search-control"><Search/><input value={query} onChange={e=>{setQuery(e.target.value);setLimit(40);}} placeholder={cyberScope?'Киберглаз, киберрука, нейропроцессор, название…':'Пистолет, куртка, киберглаз, название…'} aria-label={cyberScope?'Поиск имплантов: название, русский тип или свойство':'Поиск вещей: название, русский тип или свойство'}/></div>
    <div className="catalog-quick-search" role="group" aria-label="Примеры поиска">{searchExamples.map(term=><button type="button" key={term} aria-pressed={query===term} onClick={()=>{setQuery(query===term?'':term);setLimit(40);}}>{term}</button>)}</div>
    {(!categoryScope||filtered)&&<div className="catalog-filters catalog-filters-shelf">{!categoryScope&&<label><span>Тип вещи</span><select value={category} onChange={e=>{setCategory(e.target.value);setLimit(40);}}><option value="all">Все типы</option><option value="wear">Одежда и броня</option>{Object.entries(CATEGORIES).map(([id,label])=><option key={id} value={id}>{label}</option>)}<option value="netprogram">NET-программы</option><option value="cyberdeck">Кибердеки и кибермодемы</option></select></label>}{filtered&&<button type="button" className="catalog-reset-filters" onClick={resetFilters}>Сбросить фильтры</button>}</div>}
    {cyberScope&&!slot&&<p className="catalog-slot-hint">Все киберимпланты и компоненты, включая кибероптику, руки и нейросистемы. Место установки уточняется в карточке.</p>}{slot&&<p className="catalog-slot-hint">Для слота «{SLOTS[slot]}». Полный каталог доступен через «Все вещи → Каталог книг / Добавить вещь».</p>}
    <p className="hint">Названия моделей оставлены как в книгах. Тип вещи можно искать по-русски. При добавлении деньги и человечность меняются вручную; свойства и сложные эффекты сохраняются в описании.</p>
    {error?<div className="catalog-error" role="alert"><p>{error}</p><button onClick={()=>{setError('');setAttempt(n=>n+1);}}>Повторить</button></div>:!catalog?<p className="catalog-loading" role="status">{cyberScope?'Загружаю импланты из книг…':'Загружаю вещи из книг…'}</p>:<>
     <p className="catalog-result-count" role="status">Найдено {results.length.toLocaleString('ru-RU')} · {book==='all'?'все книги':BOOK_TITLES[book]}{categoryScope?` · ${CATEGORIES[categoryScope]}`:''}{slot?` · слот «${SLOTS[slot]}»`:''}</p>
     <div className="book-item-list">{results.slice(0,limit).map(entry=>{const variant=catalogVariantLabel(entry);return <button type="button" key={entry.id} onClick={()=>select(fromCatalogEntry(entry))} className="book-item"><IllustratedIcon icon={catalogIcon(entry)} small/><span><strong>{entry.name}</strong>{variant&&<small className="catalog-item-variant">{variant}</small>}<small>{catalogSource(entry)}</small>{catalogIsProgram(entry)&&<small>Добавится как вещь с описанием программы</small>}{catalogNeedsSlot(entry)&&<small>Выбери слот в карточке</small>}{entry.verification!=='text-and-page'&&<em><AlertTriangle aria-hidden="true"/>Сверить с книгой</em>}</span><span className="book-price">{catalogPrice(entry,true)}</span></button>;})}</div>
     {!results.length&&<div className="slot-no-items"><p>Ничего не нашлось с этими фильтрами.</p>{filtered&&<button type="button" onClick={resetFilters}>Показать {cyberScope?'все импланты':slot?'все вещи этого слота':'все вещи'}</button>}{slot&&<p>Неопределённые комплекты ищи через «Все вещи → Каталог книг / Добавить вещь»; слот можно выбрать в карточке.</p>}</div>}
     {results.length>limit&&<button className="catalog-more" onClick={()=>setLimit(n=>n+40)}>Ещё 40 {itemsLabel}</button>}
    </>}
   </TabsContent>
   {showTemplates&&<TabsContent value="templates"><p className="hint">Обычная одежда и броня из основной книги. SP, покрытие и EV заполнены в шаблонах брони.</p><div className="catalog-grid">{presets.map(p=><button key={p.key} onClick={()=>select(fromPreset(p))}><IllustratedIcon icon={p.icon}/><strong>{p.label}</strong><small>{p.sp?`SP ${p.sp} · EV ${p.ev}`:'Без бонусов'}</small></button>)}</div>{!presets.length&&<p className="slot-no-items">Для этого слота используй каталог книг или свою вещь.</p>}</TabsContent>}
  </Tabs>
 </div>;
}
