'use client';
import React,{useEffect,useId,useState} from 'react';
import {BOOT_VARIANTS,DEFAULT_INTERFACE_STYLE,PALETTES,STYLE_KEY,TREATMENTS,interfaceStyle,readInterfaceStyle,type InterfaceStyle} from '@/lib/interface-style';
import SignalType from '@/components/signal-type';

const paletteLabels = {carmine:'Кармин',ultraviolet:'Ультрафиолет',amber:'Янтарь',maelstrom:'Мальстрём',original:'Оригинал'};
const paletteColors = {carmine:['#ff285c','#edc88c','#080406'],ultraviolet:['#c86bf0','#d8ff45','#07060a'],amber:['#ffc663','#b9d2b3','#080a08'],maelstrom:['#ff3948','#e4e6df','#080909'],original:['#f2154e','#c6ddd2','#03080c']};
const treatmentLabels = {clean:'Чистый',printed:'С фактурой',raw:'Грязнее'};
const bootLabels = {channel:'Канал',stream:'Поток',signature:'Сигнатура'};

function applyStyle(value: InterfaceStyle) {
  const root = document.documentElement;
  root.dataset.palette = value.palette;
  root.dataset.treatment = value.treatment;
  root.dataset.digital = value.digital ? 'on' : 'off';
}
function notifyNative(value: InterfaceStyle) {
  try{
    window.NightCityNative?.postMessage(value.bootEnabled?'boot-enabled':'boot-disabled');
    window.NightCityNative?.postMessage(`palette-${value.palette}`);
  }catch{}
}
export function useInterfaceStyle() {
  const [appearance,setAppearance] = useState<InterfaceStyle>(DEFAULT_INTERFACE_STYLE);
  const [persistent,setPersistent] = useState(true);
  useEffect(()=>{
    const read = ()=>{ let value = DEFAULT_INTERFACE_STYLE;try{value=readInterfaceStyle(localStorage);}catch{}setAppearance(value);applyStyle(value);notifyNative(value); };
    read();
    const onStorage = (event: StorageEvent)=>{if(event.key===STYLE_KEY||event.key===null)read();};
    window.addEventListener('storage',onStorage);
    window.addEventListener('night-city-native-ready',read);
    return ()=>{window.removeEventListener('storage',onStorage);window.removeEventListener('night-city-native-ready',read);};
  },[]);
  function update(value: InterfaceStyle) {
    const normalized = interfaceStyle(value);
    setAppearance(normalized);applyStyle(normalized);notifyNative(normalized);
    try{localStorage.setItem(STYLE_KEY,JSON.stringify(normalized));setPersistent(true);}catch{setPersistent(false);}
    // Storage events do not fire in the document that made the change.
    window.dispatchEvent(new Event('nightcity-interface-change'));
  }
  return {appearance,update,persistent};
}
export default function AppearanceSettings({value,onChange,persistent,onPreview}:{value:InterfaceStyle;onChange:(next:InterfaceStyle)=>void;persistent:boolean;onPreview?:()=>void}) {
  const id=useId();
  return <section className="interface-appearance" aria-labelledby={`${id}-title`}>
    <span className="eyebrow">ЛИЧНЫЙ ИНТЕРФЕЙС / 01</span><h2 id={`${id}-title`}><SignalType>Оформление</SignalType></h2>
    <p className="hint">Изменения сохраняются автоматически на этом устройстве, даже до входа в аккаунт.</p>
    <label className="setting-row appearance-setting appearance-startup"><span><strong>Пропускать загрузку</strong><small>Сразу открывать приложение после получения данных. Включи, чтобы убрать декоративную загрузку при следующих входах.</small></span><input type="checkbox" checked={!value.bootEnabled} onChange={e=>onChange({...value,bootEnabled:!e.target.checked})}/></label>
    <fieldset><legend>Палитра</legend><div className="appearance-palette-grid">{PALETTES.map(palette=><label className="appearance-palette-option" key={palette} data-selected={value.palette===palette}>
      <input type="radio" name={`${id}-palette`} value={palette} checked={value.palette===palette} onChange={()=>onChange({...value,palette})}/><span className="appearance-swatches" aria-hidden="true">{paletteColors[palette].map(color=><i key={color} style={{backgroundColor:color}}/>)}</span><span className="appearance-choice-label">{paletteLabels[palette]}</span>
    </label>)}</div></fieldset>
    <fieldset><legend>Поверхность</legend><div className="appearance-grid">{TREATMENTS.map(treatment=><label className="appearance-palette-option" key={treatment} data-selected={value.treatment===treatment}><input type="radio" name={`${id}-surface`} checked={value.treatment===treatment} onChange={()=>onChange({...value,treatment})}/><span>{treatmentLabels[treatment]}</span></label>)}</div><p className="hint">«С фактурой» — приглушённое зерно и следы печати на декоративных элементах.</p></fieldset>
    <label className="setting-row appearance-setting"><span><strong>Цифровые детали</strong><small>Срезы заголовков, штрихкоды и регистрационные метки. Основной текст остаётся читаемым.</small></span><input type="checkbox" checked={value.digital} onChange={e=>onChange({...value,digital:e.target.checked})}/></label>
    <fieldset><legend>Вид загрузки</legend><div className="appearance-grid">{BOOT_VARIANTS.map(bootVariant=><label className="appearance-palette-option" key={bootVariant} data-selected={value.bootVariant===bootVariant}><input type="radio" name={`${id}-boot`} checked={value.bootVariant===bootVariant} onChange={()=>onChange({...value,bootVariant})}/><span>{bootLabels[bootVariant]}</span></label>)}</div></fieldset>
    {onPreview&&<button type="button" onClick={onPreview}>Посмотреть загрузку</button>}
    <p className="appearance-state" role="status">{persistent?'Изменения сохраняются автоматически':'Браузер запретил сохранение. Выбор действует до закрытия страницы.'}</p>
  </section>;
}
