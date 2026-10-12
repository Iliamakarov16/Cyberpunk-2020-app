import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

// Exercise the real account form, data initialization, connection scene and entry surface together.
const env=installEnvironment(),h=createHarness(),frames=new Map(),timers=new Map();
let now=0,nextId=1;
globalThis.performance={now:()=>now};
globalThis.requestAnimationFrame=callback=>{const id=nextId++;frames.set(id,callback);return id;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const timeout=(callback,delay=0)=>{const id=nextId++;timers.set(id,{callback,due:now+delay});return id;};
const clear=id=>timers.delete(id);
Object.assign(globalThis,{setTimeout:timeout,clearTimeout:clear});
Object.assign(env.window,{setTimeout:timeout,clearTimeout:clear,innerWidth:390,innerHeight:780,scrollX:0,scrollY:0,getComputedStyle:()=>({position:'fixed'})});
const media=new EventTarget();media.matches=false;env.window.matchMedia=()=>media;
Object.assign(env.document,{hidden:false,activeElement:env.document.body,querySelector:()=>null,querySelectorAll:()=>[]});
const commands=[];env.window.NightCityNative={postMessage:value=>commands.push(value)};
const appearance={palette:'ultraviolet',treatment:'printed',digital:true,bootVariant:'stream',bootEnabled:true};
env.storage.set('nc20.interface.v1',JSON.stringify(appearance));
const {Tracker,blank}=await loadModules(h,undefined,{actualMotion:true,actualDeck:true});
const character={id:21,owner_id:2,owner:'test_operator',version:1,updated:100,data:blank('Вега','Фиксер'),can_edit:true};
const account={id:2,username:'test_operator',role:'player',csrf:'test-csrf'};
const stage=()=>h.find(node=>node.props.className==='nc-boot-stage');
const menu=()=>h.find(node=>node.props['aria-label']==='Главное меню');
const transitions=()=>h.nodes(h.tree,[],false).filter(node=>node.props.className?.startsWith('nc-transition '));
const advance=async ms=>{
 now+=ms;
 const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);
 for(const [id,timer] of [...timers])if(timer.due<=now){timers.delete(id);timer.callback();}
 h.render();await h.flush();
};
const finishTransition=()=>{for(const node of transitions()){const element={};node.props.onAnimationEnd({target:element,currentTarget:element});}h.render();};
let authenticated=false,holdCharacters=true,releaseCharacters,settingsFail=false;
const requests=[];
globalThis.fetch=async(path,options={})=>{
 const method=options.method||'GET';requests.push({path,method});
 if(path==='/api/login'){
  assert.equal(method,'POST');const fields=JSON.parse(options.body);
  assert.equal(fields.username,'test_operator');assert.equal(fields.password,'sample-password-2020');
  authenticated=true;return new Response('{}',{status:200});
 }
 if(path==='/api/me')return new Response(JSON.stringify(authenticated?account:{error:'Войди в аккаунт'}),{status:authenticated?200:401});
 if(path==='/api/characters'){
  const result=holdCharacters?await new Promise(resolve=>{releaseCharacters=resolve;}):[character];
  return new Response(JSON.stringify(result),{status:200});
 }
 if(path==='/api/settings')return new Response(JSON.stringify(settingsFail?{error:'Данные временно недоступны'}:{animations:true,ambient:'quiet',tutorial:false}),{status:settingsFail?503:200});
 if(path==='/api/campaigns')return new Response('[]',{status:200});
 assert.fail(`Unexpected request ${method} ${path}`);
};
const originalFormData=globalThis.FormData;
globalThis.FormData=class{*[Symbol.iterator](){yield ['username','test_operator'];yield ['password','sample-password-2020'];}};
try{
 h.mount(Tracker,{platformAuth:false});await h.flush();
 assert(h.find(node=>node.props['aria-label']==='Вход в личную кибердеку'));
 assert.equal(env.document.documentElement.dataset.palette,'ultraviolet');
 assert(commands.includes('palette-ultraviolet'),'Selected appearance reaches the native screen before sign-in');
 const form=h.find(node=>node.type==='form');assert(form);
 const pending=form.props.onSubmit({currentTarget:{},preventDefault(){}});h.render();await h.flush();
 assert.equal(requests.filter(item=>item.path==='/api/login').length,1);
 assert(stage());assert(!menu(),'Workspace is inaccessible while the account data is pending');
 await advance(7000);
 assert.equal(stage().props['data-phase'],'waiting');assert(!menu());
 assert(!h.button('Войти в досье'),'Actual connection screen has no second entry action');
 releaseCharacters([character]);await pending;await h.flush();
 assert.equal(stage().props['data-phase'],'ready');assert(!menu());
 await advance(359);assert(stage());assert(!menu(),'Visible success confirmation lasts360ms');
 await advance(1);assert(menu());assert(!stage());
 assert.equal(transitions().length,1,'Real automatic completion produces one actual entry reveal');
 assert.equal(h.nodes().filter(node=>node.props.className==='nc-data-tile').length,20);
 assert.equal(env.document.documentElement.dataset.palette,'ultraviolet');
 assert.equal(JSON.parse(env.storage.get('nc20.interface.v1')).palette,'ultraviolet');
 assert(commands.filter(value=>value.startsWith('palette-')).every(value=>value==='palette-ultraviolet'),'The palette remains consistent throughout authentication and handoff');
 assert.equal(requests.filter(item=>item.path==='/api/login').length,1,'No second credential request during handoff');
 finishTransition();await advance(1000);assert.equal(transitions().length,0,'The entry reveal cannot replay');
 h.dispose();assert.equal(frames.size,0);assert.equal(timers.size,0);

 // A restored (or native first-setup) session uses the same automatic entry, without a login form.
 holdCharacters=false;const restoredStart=requests.length;
 h.mount(Tracker,{platformAuth:false});await h.flush();assert(stage());
 assert(!h.find(node=>node.props['aria-label']==='Вход в личную кибердеку'));
 await advance(7000);assert.equal(stage().props['data-phase'],'ready');
 await advance(360);assert(menu());assert.equal(transitions().length,1);
 assert(requests.slice(restoredStart).every(item=>item.method==='GET'),'Restored session never sends credentials again');
 finishTransition();h.dispose();

 // Failed data cannot be bypassed by elapsed animation; retry then skip waits for real readiness.
 settingsFail=true;
 h.mount(Tracker,{platformAuth:false});await h.flush();assert.equal(stage().props['data-phase'],'error');
 await advance(8000);assert(!menu());assert.equal(transitions().length,0);
 assert(!h.button('Войти в досье'));assert(h.text().includes('Данные временно недоступны'));
 settingsFail=false;holdCharacters=true;
 await h.click('Повторить подключение');assert(!menu());
 await h.click('Пропустить анимацию');assert.equal(stage().props['data-phase'],'waiting');assert(!menu());
 releaseCharacters([character]);await h.flush();assert(menu());assert(!stage());
 assert.equal(transitions().length,0,'A pending skip suppresses both optional animation stages');
 assert.equal(requests.filter(item=>item.path==='/api/login').length,1,'Data retry reuses the authenticated session');
 h.dispose();assert.equal(frames.size,0);assert.equal(timers.size,0);
 console.log('Actual Tracker + account form + DeckConnection + MotionSurface: one login POST, pending data gate,360ms automatic handoff, one20-tile entrance, stable native/web palette, session restoration, failed-data retry and pending skip passed.');
}finally{h.dispose();globalThis.FormData=originalFormData;}
