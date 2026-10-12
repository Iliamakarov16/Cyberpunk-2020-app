import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,moduleUrl,transpile} from './ux-hook-harness.mjs';

installEnvironment();
const h=createHarness();
globalThis.__loadoutTestReact=h.React;
const react=moduleUrl('const r=globalThis.__loadoutTestReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect;');
const source=await readFile(new URL('../components/battle/LoadoutEditor.tsx',import.meta.url),'utf8');
const {default:LoadoutEditor,loadoutEditorError,loadoutPoolSummary,matchingLoadoutSkills}=await import(moduleUrl(transpile(source.replace("from 'react'",`from '${react}'`))));
const item=(id,category,quantity,name=id)=>({id,name,category,quantity,icon:'rifle',equipped:false});
const data={items:[item('gun-a','weapon',1,'Название НЕ задаёт правила'),item('gun-b','weapon',4),item('blade','weapon',1),item('empty-gun','weapon',0),item('ammo-a','ammo',12),item('ammo-b','ammo',4),item('empty-ammo','ammo',0),item('fake-gun','gear',1,'Пистолет')],skills:[{name:'Handgun',stat:'REF',rank:6},{name:'Rifle',stat:'REF',rank:3},{name:'Dance',stat:'REF',rank:10},{name:'Melee',stat:'REF',rank:4},{name:'Fencing',stat:'REF',rank:2},{name:'Heavy Weapons',stat:'BODY',rank:8}]};
const ranged=(weaponId='gun-a',changes={})=>({weaponId,kind:'ranged',profileId:'Core · явное решение ГМа',weaponType:'handgun',ammoItemId:'ammo-a',skillName:'Handgun',skillRank:6,damageDice:3,damageBonus:-1,accuracy:0,range:50,rof:2,magazine:8,loaded:6,fireModes:['single'],singleActionCap:2,reliability:'ST',fumbleClass:'nonautomatic',...changes});
const melee=()=>({weaponId:'blade',kind:'melee',profileId:'Core · обычное оружие',weaponType:'standard',skillKind:'fencing',skillName:'Fencing',skillRank:2,damageDice:2,damageBonus:0,accuracy:1});
const valueOf=(weapons=[],activeWeaponId=null)=>({weapons,activeWeaponId});
const sourceData=structuredClone(data);
let value=valueOf(),calls=0,disabled=false;
const onChange=next=>{value=next;calls++;h.update({data,value,onChange,disabled});};
const mount=(next=valueOf(),sheet=data,locked=false)=>{h.dispose();value=structuredClone(next);disabled=locked;h.mount(LoadoutEditor,{data:sheet,value,onChange,disabled});};
const node=label=>{const found=h.find(row=>row.props['aria-label']===label);assert(found,`Missing ${label}`);return found;};
const change=async(label,next)=>{const target=node(label);assert(!target.props.disabled,`Disabled ${label}`);target.props.onChange({target:{value:String(next),checked:next,valueAsNumber:Number(next)}});h.render();await h.flush();};
const options=label=>h.nodes(node(label)).filter(row=>row.type==='option').map(row=>row.props.value);
const confirm=async()=>{await change('Подтверждение профиля ГМом',true);await h.click('Подтвердить профиль');};
async function fillRanged(weaponId='gun-a',loaded=6){
 await change('Строка оружия профиля',weaponId);await change('Тип профиля оружия','ranged');
 await change('Источник профиля ГМа','Core · явное решение ГМа');await change('Стрелковый тип','handgun');await change('Боевой навык профиля','Handgun');
 await change('Боеприпасы профиля','ammo-a');await change('Урон: число d6',3);await change('Добавка к урону',-1);await change('Точность WA',0);
 await change('Дальность, м',50);await change('ROF: выстрелов за весь раунд',2);await change('Вместимость магазина',8);await change('Заряжено сейчас',loaded);
 await change('Одиночных атак за одно действие',2);await change('Надёжность оружия','ST');await change('Класс оружия для неудачи','nonautomatic');await change('Режим: Одиночный',true);
}

// Backend-shaped guard: exact skill family, shared totals, all capability fields.
assert.equal(loadoutEditorError(data,valueOf([ranged(),ranged('gun-b',{loaded:5})],'gun-a')),null);
assert.deepEqual(loadoutPoolSummary(data,[ranged(),ranged('gun-b',{loaded:5})]),[{id:'ammo-a',name:'ammo-a',total:12,loaded:11,reserve:1}]);
assert.match(loadoutEditorError(data,valueOf([ranged(),ranged('gun-b',{loaded:7})])),/общий запас/);
assert.match(loadoutEditorError(data,valueOf([ranged(),ranged()])),/один профиль/);
assert.match(loadoutEditorError(data,valueOf([ranged('empty-gun')])),/положительным/);
assert.match(loadoutEditorError(data,valueOf([ranged('fake-gun')])),/положительным/);
assert.match(loadoutEditorError(data,valueOf([ranged()], 'missing')),/отсутствует/);
assert.deepEqual(matchingLoadoutSkills(data,'handgun').map(skill=>skill.name),['Handgun']);
assert.deepEqual(matchingLoadoutSkills({...data,skills:[...data.skills,data.skills[0]]},'handgun'),[]);
for(const change of [{skillName:'Dance',skillRank:10},{skillName:'Rifle',skillRank:3},{skillName:'Handgun',skillRank:5},{skillName:'',skillRank:1},{profileId:''},{damageDice:NaN},{damageBonus:101},{accuracy:-11},{range:10001},{loaded:9},{fireModes:[]},{singleActionCap:3},{reliability:''},{fumbleClass:''},{fireModes:['auto'],singleActionCap:0}])assert(loadoutEditorError(data,valueOf([ranged('gun-a',change)])),JSON.stringify(change));
assert.equal(loadoutEditorError(data,valueOf([ranged('gun-a',{skillName:'',skillRank:0})])),null);
assert.equal(loadoutEditorError(data,valueOf([ranged('gun-a',{weaponType:'shotgun',skillName:'Rifle',skillRank:3})])),null);
assert.equal(loadoutEditorError(data,valueOf([ranged('gun-a',{rof:30,fireModes:['auto'],singleActionCap:0,fumbleClass:'automatic'})])),null);
assert.equal(loadoutEditorError(data,valueOf([melee()])),null);
assert(loadoutEditorError(data,valueOf([{...melee(),skillKind:'melee'}])));

// A new profile has blank rules, empty modes and no automatic activation.
mount();assert.equal(calls,0);assert.equal(node('Активное оружие набора').props.value,'');
await h.click('Добавить профиль оружия');
assert.deepEqual(options('Строка оружия профиля'),['','gun-a','gun-b','blade']);
assert.equal(node('Урон: число d6').props.value,'');assert.equal(node('Добавка к урону').props.value,'');assert.equal(node('Точность WA').props.value,'');
assert.equal(node('Боевой навык профиля').props.disabled,true);assert.equal(h.button('Подтвердить профиль').props.disabled,true);
await confirm();assert.equal(value.weapons.length,0);assert.match(h.text(),/Заполни все поля явно/);
await fillRanged();assert.deepEqual(options('Боевой навык профиля'),['','__untrained__','Handgun']);
assert.deepEqual(options('Боеприпасы профиля'),['','ammo-a','ammo-b']);
assert.equal(node('Подтверждение профиля ГМом').props.checked,false,'Each field change clears prior confirmation');
assert.equal(node('Подтверждение профиля ГМом').props.required,true);
node('Подтверждение профиля ГМом').props.onInvalid();h.render();assert.match(h.text(),/отмени черновик/);
await confirm();assert.deepEqual(value.weapons,[ranged()]);assert.equal(value.activeWeaponId,null);
assert.equal(h.find(row=>row.props['data-loadout-draft']==='true'),undefined);
const first=structuredClone(value.weapons);await change('Активное оружие набора','gun-a');assert.deepEqual(value.weapons,first);await change('Активное оружие набора','');assert.equal(value.activeWeaponId,null);
await h.click('Добавить профиль оружия');assert(!options('Строка оружия профиля').includes('gun-a'));await fillRanged('gun-b',7);await confirm();assert.equal(value.weapons.length,1);assert.match(h.text(),/общий запас/);
await change('Заряжено сейчас',5);await confirm();assert.equal(value.weapons.length,2);assert.match(h.text().replace(/\s+/g,' '),/всего 12 − во всех магазинах 11 = резерв 1/);
assert.equal(value.weapons[1].weaponId,'gun-b','Quantity four is still one profile');

// Reopening saved magazines preserves every count. Shrinking capacity never clamps.
mount(valueOf([ranged(),ranged('gun-b',{loaded:5})],'gun-a'));
assert.equal(calls,4); // Two profile commits and two explicit active selections.
await h.click('Изменить профиль');assert.equal(node('Заряжено сейчас').props.value,'6');assert.equal(node('Заряжено сейчас').props.disabled,true);assert.equal(node('Боеприпасы профиля').props.disabled,true);
await change('Вместимость магазина',4);assert.equal(node('Заряжено сейчас').props.value,'6');await confirm();assert.equal(value.weapons[0].magazine,8);assert.match(h.text(),/Магазин не меняется автоматически/);
await change('Вместимость магазина',8);await change('Перенастройка магазинов ГМом',true);assert.equal(node('Заряжено сейчас').props.disabled,false);await change('Заряжено сейчас',4);await confirm();assert.equal(value.weapons[0].loaded,4);assert.equal(value.resetLoaded,true);
await change('Перенастройка магазинов ГМом',false);assert.equal(value.resetLoaded,true);assert.match(h.text(),/верни сохранённые магазины/);
assert.equal(value.weapons[1].loaded,5);
assert.match(loadoutEditorError(data,valueOf([ranged('gun-a',{loaded:4})]),[ranged()]),/перенастройки/);

// Ordinary melee uses only Melee/Fencing and emits no ranged-only keys.
mount();await h.click('Добавить профиль оружия');await change('Строка оружия профиля','blade');await change('Тип профиля оружия','melee');await change('Источник профиля ГМа','Core · обычное оружие');await change('Семейство рукопашного навыка','fencing');
assert.deepEqual(options('Боевой навык профиля'),['','__untrained__','Fencing']);assert(!h.find(row=>row.props['aria-label']==='Надёжность оружия'));
await change('Боевой навык профиля','Fencing');await change('Урон: число d6',2);await change('Добавка к урону',0);await change('Точность WA',1);await confirm();assert.deepEqual(value.weapons,[melee()]);
await change('Активное оружие набора','blade');await h.click('Убрать профиль');assert.deepEqual(value,valueOf());

// A saved empty pool is retained at zero. New profiles cannot bind that zero row.
const empty={...data,items:data.items.map(item=>item.id==='ammo-a'?{...item,quantity:0}:item)};
mount(valueOf([ranged('gun-a',{loaded:0})]),empty);await h.click('Изменить профиль');assert.equal(node('Заряжено сейчас').props.value,'0');assert(options('Боеприпасы профиля').includes('ammo-a'));assert.match(h.text().replace(/\s+/g,' '),/всего 0 − во всех магазинах 0 = резерв 0/);await h.click('Отменить черновик');assert.equal(value.weapons[0].loaded,0);

// Cancel/reopen discards local edits; disabled preparation cannot mutate data.
mount(valueOf([ranged()]));await h.click('Изменить профиль');await change('Урон: число d6',20);await h.click('Отменить черновик');await h.click('Изменить профиль');assert.equal(node('Урон: число d6').props.value,'3');await h.click('Отменить черновик');
mount(valueOf([ranged()]),data,true);assert(h.button('Добавить профиль оружия').props.disabled);assert(h.button('Изменить профиль').props.disabled);assert(h.button('Убрать профиль').props.disabled);assert(node('Активное оружие набора').props.disabled);assert(node('Перенастройка магазинов ГМом').props.disabled);
assert.deepEqual(data,sourceData,'The editor never changes inventory or skill rows');
assert.doesNotMatch(source,/window\.confirm|\.icon\b|\.equipped\b/,'No rules from appearance or equipped flags');
h.dispose();
console.log('Loadout editor passed: explicit blank profiles/GM source, REF families, bounded capabilities, single shared reserve, duplicate and over-allocation guards, saved-magazine reset protection, melee, cancel/reopen and disabled states. Hook harness only; no browser/device claim.');
