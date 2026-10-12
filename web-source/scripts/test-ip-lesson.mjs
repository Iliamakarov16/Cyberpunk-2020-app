import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

installEnvironment();const h=createHarness();
const {Tracker,blank,skillImprovementCost}=await loadModules(h,undefined,{actualLearning:true});
// Book examples, the first-rank exception, and the normal rank limit.
assert.equal(skillImprovementCost({rank:0,multiplier:3}),10);
assert.equal(skillImprovementCost({rank:4,multiplier:1}),40);
assert.equal(skillImprovementCost({rank:5,multiplier:1}),50);
assert.equal(skillImprovementCost({rank:4,multiplier:3}),120);
assert.equal(skillImprovementCost({rank:10,multiplier:1}),null);
assert.equal(skillImprovementCost({rank:NaN,multiplier:1}),null);

const calls=[],data=blank('Вега','Фиксер');
data.skills=[{name:'Пистолеты',stat:'REF',rank:4,ip:38,multiplier:1}];
const saved=JSON.stringify(data);
globalThis.fetch=async(path,options={})=>{
 calls.push({path,method:options.method||'GET'});
 const value=path==='/api/me'?{id:2,username:'Adam',role:'player',csrf:'token',platform:true}
  :path==='/api/settings'?{hints:false,tutorial:false,animations:false}
  :path==='/api/characters'?[{id:21,owner_id:2,owner:'Adam',version:1,updated:100,data,can_edit:true}]
  :null;
 assert.notEqual(value,null,`Unexpected request: ${path}`);
 return new Response(JSON.stringify(value),{status:200});
};
h.mount(Tracker,{platformAuth:false});await h.flush();
await h.click(h.find(node=>node.props['data-tour']==='nav-learning'));
await h.click('ГМ: развитие навыков и IP');
assert(h.text().includes('Improvement Points'));
await h.click('Следующий шаг');assert(h.text().includes('Самостоятельная практика'));
await h.click('Следующий шаг');
assert(h.button('Потратить 40 IP').props.disabled);
const before=calls.length;
await h.click('Выдать 3 IP');
assert(h.text().includes('Теперь 41 IP'));
assert(h.button('3 IP начислены').props.disabled);
await h.click('Потратить 40 IP');
assert(h.text().includes('остался 1 IP'));
assert(h.text().includes('Ранг 2 · 6 IP'));
assert(h.button('Навык повышен до 5').props.disabled);
assert.equal(calls.length,before,'Lesson does not call the campaign or character API');
assert.equal(JSON.stringify(data),saved,'Lesson leaves the real character unchanged');
await h.click('Начать урок IP заново');
await h.click('Следующий шаг');await h.click('Следующий шаг');
assert(h.text().includes('Пока 38 IP'));
await h.click('Выдать 3 IP');await h.click('Потратить 40 IP');await h.click('Завершить урок');
assert(h.text().includes('Выбери короткую инструкцию'));
h.dispose();
console.log('IP lesson: Core costs; three-step flow; award/spend; replay; available with tutorials off; no real writes passed.');
