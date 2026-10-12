import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=process.env.NC_NETWORK_PROJECT||fileURLToPath(new URL('..',import.meta.url));
const {createHarness,installEnvironment,moduleUrl,transpile}=await import(pathToFileURL(root+'/scripts/ux-hook-harness.mjs').href);
const versionsSource=await readFile(root+'/lib/app-version.ts','utf8');
const versionsUrl=moduleUrl(transpile(versionsSource));
const {APP_VERSION,API_VERSION,isNewerVersion}=await import(versionsUrl);
const source=await readFile(root+'/components/network-status.tsx','utf8');
const workerSource=await readFile(root+'/public/sw.js','utf8');
const offlineSource=await readFile(root+'/public/offline.html','utf8');
assert.equal(offlineSource.match(/name="night-city-offline-shell" content="([^"]+)"/)?.[1],APP_VERSION,'The offline screen release stays in sync');
assert.equal(workerSource.match(/const VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1],APP_VERSION,'The offline worker release cannot drift from the shared client/API release');
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event {constructor(type,init={}){super(type,init);this.detail=init.detail;}};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
let sequence=0;
async function fixture(options={}){
 const env=installEnvironment(),h=createHarness(),id=++sequence;
 const media=new EventTarget();media.matches=false;
 env.window.matchMedia=()=>media;env.window.isSecureContext=options.secure!==false;
 let reloads=0,activations=0,workerUpdates=0,syncCalls=0;
 env.window.location={reload:()=>reloads++};
 Object.assign(navigator,{userAgent:'Network status regression',platform:'Linux',maxTouchPoints:0});
 const sw=new EventTarget(),reg=new EventTarget(),installing=new EventTarget();
 sw.controller=options.controller===false?null:{};
 reg.waiting=options.waiting?{postMessage:message=>{assert.deepEqual(message,{type:'ACTIVATE_UPDATE'});activations++;}}:null;
 reg.installing=installing;
 const state={signature:'initial',version:options.version??APP_VERSION,apiVersion:options.apiVersion??API_VERSION,dirty:false,syncGate:null,updateGate:null,syncAfter:null,error:null};
 reg.update=async()=>{workerUpdates++;if(state.updateGate)await state.updateGate.promise;};
 sw.register=async(path,configuration)=>{assert.equal(path,'/sw.js');assert.deepEqual(configuration,{scope:'/',updateViaCache:'none'});return reg;};
 if(options.worker!==false)navigator.serviceWorker=sw;
 const nativeMessages=[];
 if(options.native)env.window.NightCityNative={postMessage:message=>nativeMessages.push(message)};
 globalThis['__networkReact'+id]=h.React;
 const react=moduleUrl(`const r=globalThis.__networkReact${id};export default r;export const useState=r.useState,useEffect=r.useEffect,useRef=r.useRef;`);
 const iconNames=source.match(/import\s*\{([^}]+)\}\s*from ['"]lucide-react['"]/)?.[1].split(',').map(value=>value.trim())||[];
 const icons=moduleUrl(iconNames.map(name=>`export const ${name}=props=>({type:'svg',props:{...props,children:[]}});`).join('\n'));
 const ui=moduleUrl("export const Sheet=props=>props.open?({type:'harness-sheet',props}):null;export const SheetContent=props=>({type:'div',props});export const SheetHeader=props=>({type:'header',props});export const SheetTitle=props=>({type:'h2',props});export const SheetDescription=props=>({type:'p',props});");
 const imports=new Map([['react',react],['lucide-react',icons],['@/components/ui/sheet',ui],['@/lib/app-version',versionsUrl]]);
 const compiled=transpile(source.replace(/from ['"]([^'"]+)['"]/g,(_,name)=>{assert(imports.has(name),'New dependency needs a deliberate fixture: '+name);return `from '${imports.get(name)}'`;})+`\n// fixture ${id}`);
 const module=await import(moduleUrl(compiled));
 assert.equal(module.CLIENT_VERSION,APP_VERSION,'Component version cannot drift from the shared release version');
 assert.equal(module.CLIENT_API_VERSION,API_VERSION);
 const apiCalls=[];
 const api=async(path,method)=>{
  assert(method===undefined||method==='GET','Observer must not mutate state');apiCalls.push(path);
  if(state.error)throw state.error;
  if(path==='/api/version')return {version:state.version,apiVersion:state.apiVersion};
  assert.equal(path,'/api/sync');const signature=state.signature;if(state.syncGate)await state.syncGate.promise;return {signature};
 };
 const onSync=async()=>{syncCalls++;if(state.syncAfter)await state.syncAfter();};
 const props=()=>({dirty:state.dirty,api,onSync});
 h.mount(module.default,props());await h.flush();
 const wake=async()=>{env.window.dispatchEvent(new Event('focus'));await h.flush();};
 const dirty=async(value)=>{state.dirty=value;h.update(props());await h.flush();};
 const open=async()=>{if(!h.find(n=>n.type==='harness-sheet'))await h.click(h.find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('Связь и сервер:')));};
 const updateButton=()=>h.button('Обновить экран');
 const updateNotice=()=>h.find(n=>n.props.className==='network-update');
 const close=()=>{h.dispose();assert.equal(env.timers.size,0,'Dispose cancels polling, worker checks and update fallback');};
 return {env,h,state,sw,reg,installing,apiCalls,nativeMessages,wake,dirty,open,updateButton,updateNotice,close,get reloads(){return reloads;},get activations(){return activations;},get workerUpdates(){return workerUpdates;},get syncCalls(){return syncCalls;}};
}

// Numeric comparison is independent of lexicographic ordering and refuses ambiguous builds.
for(const [candidate,current,expected] of [
 ['0.13.0','0.13.0',false],['0.12.0','0.13.0',false],['0.9.0','0.13.0',false],
 ['0.13.1','0.13.0',true],['0.14.0','0.13.0',true],['1.0.0','0.13.0',true],
 ['1.10.0','1.9.0',true],['1.2.0','1.9.0',false],
 ['0.13','0.13.0',false],['0.14.0-preview','0.13.0',false],['invalid','0.13.0',false],['0.14.0','invalid',false],
])assert.equal(isNewerVersion(candidate,current),expected,`${candidate} vs ${current}`);

const currentParts=APP_VERSION.split('.').map(Number);
const nextPatch=[currentParts[0],currentParts[1],currentParts[2]+1].join('.');
for(const version of [APP_VERSION,'0.12.0','0.9.0','invalid']){
 const f=await fixture({version});
 try{
  assert.equal(f.h.find(n=>n.type==='harness-sheet'),undefined,'Healthy startup never opens a service panel');
  assert.equal(f.h.buttons().length,1,'Healthy connection uses one compact header control');
  assert.doesNotMatch(f.h.text(),/Экран актуален|localhost|Установка на телефон/,'Service instructions are not inserted above the menu');
  await f.open();assert.equal(f.updateNotice(),undefined,`Equal, older and ambiguous server releases do not claim an update: ${version}`);
  assert.equal(f.updateButton(),undefined);
  const panel=f.h.find(n=>n.props?.onCloseAutoFocus);let prevented=false;panel.props.onCloseAutoFocus({preventDefault(){prevented=true;}});assert(prevented);assert.equal(f.env.document.activeElement,f.h.button('Связь').props.ref.current,'Closing connection details restores trigger focus');
  assert(f.apiCalls.includes('/api/version')&&f.apiCalls.includes('/api/sync'));
 }finally{f.close();}
}
{
 const f=await fixture({version:nextPatch});
 try{assert.match(f.h.text(),/Обновление/);await f.open();assert(f.updateNotice());assert(f.updateButton());assert.equal(f.updateButton().props.disabled,false);}finally{f.close();}
}

// Changed server signatures wait for drafts; the observer still runs with its sheet closed.
{
 const f=await fixture();
 try{
  f.state.signature='new-data';await f.dirty(true);await f.wake();assert.equal(f.syncCalls,0);
  assert.match(f.h.text(),/Изменения/);await f.open();assert.match(f.h.text(),/черновик/);
  await f.dirty(false);assert.equal(f.syncCalls,1);await f.wake();assert.equal(f.syncCalls,1,'Already applied signatures are not repeated');
  const gate=deferred();f.state.signature='in-flight';f.state.syncGate=gate;
  await f.wake();await f.dirty(true);gate.resolve();await f.h.flush();assert.equal(f.syncCalls,1,'Typing while GET is in flight prevents automatic draft replacement');
  f.state.syncGate=null;await f.dirty(false);assert.equal(f.syncCalls,2);
  f.state.signature='post-sync-race';f.state.syncAfter=async()=>{await f.dirty(true);};await f.wake();await f.h.flush();assert.equal(f.syncCalls,3);
  f.state.syncAfter=null;await f.dirty(false);assert.equal(f.syncCalls,4,'A signature is not marked applied if a draft appeared during onSync');
  f.env.document.visibilityState='hidden';f.env.document.dispatchEvent(new Event('visibilitychange'));await f.h.flush();
  const before=f.apiCalls.length;await f.wake();assert.equal(f.apiCalls.length,before,'Hidden tabs do not poll');
  f.env.document.visibilityState='visible';f.env.document.dispatchEvent(new Event('visibilitychange'));await f.h.flush();assert(f.apiCalls.length>before);
 }finally{f.close();}
}
{
 const f=await fixture({apiVersion:API_VERSION+1});
 try{f.state.signature='incompatible-data';await f.wake();assert.equal(f.syncCalls,0);await f.open();assert.match(f.h.text(),/несовместимы/);assert(f.updateNotice(),'API incompatibility remains actionable even when release strings are equal');}finally{f.close();}
}

// First PWA installation is not an update; updates never reload other tabs automatically.
{
 const f=await fixture({waiting:true,controller:false});
 try{await f.open();assert.equal(f.updateNotice(),undefined,'Waiting first-install worker must not show a false update');f.sw.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,0);}finally{f.close();}
}
{
 const f=await fixture();
 try{
  await f.open();assert.equal(f.updateNotice(),undefined);
  f.reg.waiting={postMessage:()=>{}};f.reg.dispatchEvent(new Event('updatefound'));f.installing.dispatchEvent(new Event('statechange'));await f.h.flush();
  assert(f.updateNotice(),'A newly waiting worker is discovered through the actual registration lifecycle');
 }finally{f.close();}
}
{
 const f=await fixture({waiting:true});
 try{
  await f.open();assert(f.updateNotice());f.sw.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,0,'An update approved in another tab cannot reload this tab');
  await f.dirty(true);assert.equal(f.updateButton().props.disabled,true);
  f.updateButton().props.onClick();await f.h.flush();assert.equal(f.workerUpdates,0);assert.equal(f.activations,0,'Dirty state is checked in the handler as well as disabled UI');
  await f.dirty(false);const gate=deferred();f.state.updateGate=gate;
  await f.h.click(f.updateButton());await f.dirty(true);gate.resolve();await f.h.flush();
  assert.equal(f.activations,0);assert.equal(f.reloads,0,'A draft created while reg.update awaits must cancel activation');
  f.state.updateGate=null;await f.dirty(false);await f.h.click(f.updateButton());assert.equal(f.activations,1);
  await f.dirty(true);f.sw.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,0,'Even explicit approval cannot reload over a later draft');
  await f.dirty(false);f.sw.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,0,'A cancelled approval cannot reload later without another explicit request');
  assert.equal(f.updateButton().props.disabled,false,'A draft-blocked controller change re-enables explicit update');
  await f.h.click(f.updateButton());f.sw.dispatchEvent(new Event('controllerchange'));assert.equal(f.reloads,1);
 }finally{f.close();}
}
{
 const f=await fixture({waiting:true});
 try{
  await f.open();const before=new Set(f.env.timers.keys());await f.h.click(f.updateButton());
  const fallback=[...f.env.timers].filter(([id])=>!before.has(id));assert.equal(fallback.length,1,'Explicit approval owns one controller-change fallback');
  const [timer,callback]=fallback[0];f.env.timers.delete(timer);callback();assert.equal(f.reloads,1,'A browser that delays controllerchange can still apply an explicitly requested screen update');
 }finally{f.close();}
}
{
 const f=await fixture({waiting:true});
 try{
  await f.open();const gate=deferred();f.state.updateGate=gate;await f.h.click(f.updateButton());gate.reject(new Error('Connection dropped'));await f.h.flush();
  assert.equal(f.reloads,0);assert.equal(f.activations,0);assert.equal(f.updateButton().props.disabled,false,'A failed update check can be retried');assert.match(f.h.text(),/Не удалось проверить обновление/);
 }finally{f.close();}
}
{
 const f=await fixture({worker:false,secure:false,version:nextPatch});
 try{await f.open();assert.equal(f.reloads,0);await f.h.click(f.updateButton());assert.equal(f.reloads,1,'Local HTTP without a worker reloads only after explicit approval');}finally{f.close();}
}

// Failed connections remain visible and retryable without covering the game.
{
 const f=await fixture();
 try{
  f.env.window.dispatchEvent(new Event('offline'));navigator.onLine=false;await f.wake();await f.open();assert.match(f.h.text(),/Сервер на связи/,'An internet-offline heuristic cannot hide a reachable LAN server');
  f.state.error=new Error('Server stopped');await f.wake();assert.match(f.h.text(),/Восстанови Wi/);
  f.state.error=null;await f.h.click('Проверить связь');assert.match(f.h.text(),/Сервер на связи/);
 }finally{f.close();}
}
{
 const f=await fixture();
 try{f.state.error=Object.assign(new Error('Session expired'),{status:401});await f.wake();assert.match(f.h.text(),/Нужен вход/);await f.open();assert.match(f.h.text(),/истёк/);assert(f.h.button('Проверить связь'));f.state.error=null;await f.h.click('Проверить связь');assert.match(f.h.text(),/Сервер на связи/);}finally{f.close();}
}

// The former native toolbar's connection command remains available from the single web control.
{
 const f=await fixture();
 try{
  await f.open();assert.equal(f.h.button('Настроить сервер или локальную игру'),undefined);
  const messages=[];f.env.window.NightCityNative={postMessage:message=>messages.push(message)};f.env.window.dispatchEvent(new Event('night-city-native-ready'));await f.h.flush();
  await f.h.click('Настроить сервер или локальную игру');assert.deepEqual(messages,['connection'],'Native bridge injected after mount becomes usable through the advertised readiness event');
 }finally{f.close();}
}
{
 const f=await fixture({native:true});
 try{await f.open();assert.doesNotMatch(f.h.text(),/Установка на телефон/);await f.h.click('Настроить сервер или локальную игру');assert.deepEqual(f.nativeMessages,['connection']);await f.dirty(true);assert.equal(f.h.button('Настроить сервер или локальную игру').props.disabled,true);}finally{f.close();}
}

// Exercise the actual API endpoint, not a duplicate release literal.
process.env.CAMPAIGN_TEST_ROOT=root;
const {fixture:apiFixture}=await import(pathToFileURL(root+'/scripts/network-fixture.mjs').href);
const integrated=await apiFixture();
const apiVersion=await integrated.read('/api/version');
assert.deepEqual({version:apiVersion.version,apiVersion:apiVersion.apiVersion},{version:APP_VERSION,apiVersion:API_VERSION},'Client and real Site API must share a release contract');
const apiSync=await integrated.read('/api/sync');assert.equal(apiSync.version,APP_VERSION);
console.log('PASS: actual NetworkStatus quiet startup, equal/older/newer versions, shared API release, dirty/in-flight sync, API incompatibility, first-install worker, explicit update/controller guards, connection retry, native server access and cleanup. Hook behavior is exercised; CSS layout and phone rendering are not emulated.');
