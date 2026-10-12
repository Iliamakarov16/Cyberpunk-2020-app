import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
const env=installEnvironment(),h=createHarness();
const {Tracker}=await loadModules(h,undefined,{actualLearning:true});
const requests=[];
globalThis.fetch=async(path,options={})=>{
 requests.push({path,method:options.method||'GET'});
 const result=path==='/api/me'?{id:2,username:'player',role:'player',csrf:'token',platform:true}:path==='/api/settings'?{hints:false,tutorial:false,animations:false}:path==='/api/characters'?[]:path==='/api/campaigns'?[]:null;
 assert.notEqual(result,null,`Unexpected ${path}`);return new Response(JSON.stringify(result),{status:200});
};
h.mount(Tracker,{platformAuth:false});await h.flush();
await h.click('Уроки и справка');
assert(h.find(n=>n.props['data-tour']==='session-start-guide'));
for(const term of ['Safari','Карта Найт-Сити','Не списывай их второй раз','Автоматического подбора','прежний аккаунт','Личные заметки карты','Сохрани полную копию'])assert(h.text().includes(term),term);
await h.click(h.find(n=>n.props['data-tour']==='nav-home'));await h.click('Уроки и справка');
assert(h.find(n=>n.props['data-tour']==='session-start-guide'),'Guide reopens even with hints and automatic tutorials disabled');
assert(requests.every(x=>x.method==='GET'),'Reading onboarding cannot write account, sheet or campaign data');
h.dispose();console.log('Session onboarding: actual Tracker→LearningCenter→Home→reopen, hints disabled, Safari/join/map/authoritative battle/save/loot boundaries and no mutations passed.');
