import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

installEnvironment();
const h=createHarness(),{CampaignDemo}=await loadModules(h);
let dirty=false,busy=false,networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error('Demo must not contact the network');};
function field(label,type){const node=h.find(n=>n.props['data-label']===label);assert(node,label);return h.nodes(node,[],false).find(n=>n.type===type);}
async function change(label,type,value){field(label,type).props.onChange({target:{value}});h.render();await h.flush();}
const cell=(x,y)=>h.find(n=>n.type==='button'&&n.props['data-cell']===`${x}:${y}`);
const submit=async()=>{const form=h.find(n=>n.type==='form'&&n.props['data-tour']==='scene-action');assert(form);form.props.onSubmit({preventDefault(){}});h.render();await h.flush();};

h.mount(CampaignDemo,{onDirtyChange:value=>{dirty=value;},onBusyChange:value=>{busy=value;}});await h.flush();
assert(h.text().includes('Сейчас ты смотришь экран ведущего'));
assert(h.text().includes('Турель за стеной'));
assert(h.text().includes('Учебный стол · без сервера'));
await h.click('Экран игрока');
assert(h.text().includes('Сейчас ты смотришь экран игрока'));
assert(!h.text().includes('Турель за стеной'),'Player view excludes hidden NPC names');
await h.click(cell(5,6));await h.click('Атаковать');
assert.equal(field('Цель','select').props.value,'guard');
await change('Что ты хочешь сделать','textarea','Заставляю охранника отойти от кейса.');assert(dirty);
await h.click('Экран ГМа');assert(h.text().includes('Переключить учебный экран?'));
await h.click('Вернуться');h.find(n=>n.type==='harness-AlertDialog').props.onOpenChange(false);h.render();await h.flush();assert(h.text().includes('Сейчас ты смотришь экран игрока'));
await submit();assert(!dirty);assert(!busy);
await h.click('Экран ГМа');await h.click('Разрешить действие');
await h.click('Экран игрока');
await change('Итог проверки','input','17');
await change('Урон до защиты — если нужен','input','9');
await h.click('Записать броски');
await h.click('Экран ГМа');
await change('Описание результата / ответ игроку','textarea','Охранник отступает. Ведущий описал последствия за столом.');
await h.click('Подтвердить результат');
await h.click('Экран игрока');assert(h.text().includes('Охранник отступает.'));
await h.click(cell(3,6));await h.click('Отправить заявку ГМу');
await h.click('Подтвердить');
assert(cell(2,6).props['aria-label'].includes('Вега'),'Move request does not move the pawn');
await h.click('Экран ГМа');await h.click('Разрешить действие');
await change('Описание результата / ответ игроку','textarea','Вега подходит к кейсу.');
await h.click('Подтвердить результат');await h.click('Экран игрока');
assert(cell(3,6).props['aria-label'].includes('Вега'),'GM confirmation moves the pawn');
assert.equal(networkCalls,0,'The actual demo/terminal/board make no real requests');
h.dispose();
console.log('PASS: actual demo/terminal/board GM-player roundtrip, target action, dice, result, approved movement, draft switch guard and network isolation.');
