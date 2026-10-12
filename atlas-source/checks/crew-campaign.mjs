// Real atlas DOM + application scripts against the Crew HTTP contract.
// These checks do not claim native WebView, touch-layout, or live-server coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {JSDOM} from 'jsdom';
const scripts = ['data.js','streets-data.js','world-data.js','transit-data.js','cartography.js','app.js','transit.js','crew-campaign.js','crew-bridge.js'];
const source = name => fs.readFileSync(new URL('../public/' + name, import.meta.url),'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn, message = 'DOM operation completed') { for (let n = 0; n < 150; n++) { if (fn()) return; await sleep(10); } assert(fn(), message); }
const copy = value => JSON.parse(JSON.stringify(value));
function server() {
  const state = {id:7,name:'Ночная смена',revision:0,markers:[],role:'gm',denied:false,calls:[],commands:new Map(),mode:null,after:null,viewer:{id:3,username:'owner'}};
  function projection(view) {
    const gm = state.role === 'gm' && view !== 'player';
    return {id:state.id,viewer:copy(state.viewer),name:state.name,revision:state.revision,version:state.revision,campaignVersion:state.revision+1,role:gm?'gm':'player',canManage:gm,
      markers:state.markers.filter(m => gm || m.revealed).map(m => {const out=copy(m); if(!gm)delete out.secret; return out;})};
  }
  state.fetch = async (url, options = {}) => {
    const uri = new URL(url), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : undefined;
    const call = {url:uri.href,method,body:copy(body || null),credentials:options.credentials,headers:options.headers}; state.calls.push(call);
    assert.equal(uri.origin,'https://crew.example'); assert.equal(options.credentials,'same-origin');
    const response = (status, value) => ({status,ok:status>=200&&status<300,json:async()=>copy(value)});
    if (uri.pathname === '/api/me') return response(state.denied ? 401 : 200, state.denied ? {error:'Сеанс Crew закончился.'} : {id:state.viewer?.id ?? 3,username:state.viewer?.username ?? 'owner',role:state.role,csrf:'test_csrf_current_session_1234567890'});
    assert(uri.pathname.startsWith('/api/campaigns/'+state.id+'/atlas'));
    if (method !== 'GET') assert.equal(options.headers['X-CSRF-Token'],'test_csrf_current_session_1234567890','Actual Crew CSRF header is required for mutations');
    if (state.before) { const result = await state.before(call,options,response); if (result) return result; }
    if (state.denied) return response(403,{error:'Доступ к кампании отозван.'});
    if (method === 'GET') return response(200,projection(uri.searchParams.get('view')));
    if (state.role !== 'gm' || uri.searchParams.get('view') === 'player') return response(403,{error:'Только ведущий может менять карту.'});
    assert.deepEqual(Object.keys(body).sort(), (method === 'DELETE' ? ['expectedVersion','id'] : ['expectedVersion','id','marker']).sort());
    if (body.marker) assert.deepEqual(Object.keys(body.marker).sort(), ['name','description','secret','kind','color','x','y','map','placeId','revealed'].sort());
    const signature = JSON.stringify({method,path:uri.pathname,marker:body.marker});
    const old = state.commands.get(body.id);
    if (old) { assert.equal(old.signature,signature,'Same command ID must preserve method, marker, target'); return response(200,{...projection('gm'),duplicate:true,receipt:old.receipt,markerId:old.receipt.markerId}); }
    if (body.expectedVersion !== state.revision) return response(409,{error:'Карта изменилась. Обнови её и повтори действие.'});
    let id = uri.pathname.split('/').at(-1);
    if (method === 'POST') { id = randomUUID(); state.markers.push({id,...copy(body.marker),updated:Date.now()}); }
    else { const index=state.markers.findIndex(m=>m.id===id); if(index<0)return response(404,{error:'Метка удалена другим ведущим.'}); if(method==='DELETE')state.markers.splice(index,1);else state.markers[index]={id,...copy(body.marker),updated:Date.now()}; }
    state.revision++;
    const receipt = {commandId:body.id,type:{POST:'create',PUT:'update',DELETE:'delete'}[method],markerId:id,version:state.revision};
    state.commands.set(body.id,{signature,receipt});
    const result = response(200,{...projection('gm'),duplicate:false,receipt,markerId:id});
    if (state.after) { const after = state.after; state.after = null; return after(call,options,result); }
    return result;
  };
  state.projection=projection; return state;
}
const openDOMs=[];
function browser(backend,{mode='gm',hash='',fastTimeout=false,origin='https://crew.example',campaignId=7,initialStorage={}}={}) {
  const dom = new JSDOM(source('index.html'),{url:`${origin}/atlas/index.html?crew=1&campaignId=${campaignId}&mode=${mode}${hash}`,runScripts:'outside-only',pretendToBeVisual:true}), w=dom.window,d=w.document;
  const messages=[],links=[],intervals=[];
  const parent={postMessage:(message,origin)=>messages.push({message:copy(message),origin})}; Object.defineProperty(w,'parent',{value:parent});
  for (const [key,value] of Object.entries(initialStorage)) w.localStorage.setItem(key,value);
  w.AbortController=globalThis.AbortController;
  w.matchMedia=()=>({matches:false}); w.setInterval=(fn,delay)=>{intervals.push({fn,delay});return intervals.length;};w.clearInterval=()=>{};
  const timeout=w.setTimeout.bind(w); if(fastTimeout)w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===12000?30:ms,...args);
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:640,height:850,left:0,top:0}); w.SVGElement.prototype.getBoundingClientRect=w.HTMLElement.prototype.getBoundingClientRect;
  w.fetch=backend.fetch; Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>links.push(text)}});
  for(const script of scripts)w.eval(source(script));
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  const click=id=>{const el=d.getElementById(id);assert(el,`Missing button ${id}`);el.click();};
  const input=(id,value)=>{const el=d.getElementById(id);assert(el,`Missing field ${id}`);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const submit=()=>d.getElementById('marker-form').dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:d.getElementById('marker-save')}));
  const back=(origin='https://crew.example',sender=parent,version=1)=>w.dispatchEvent(new w.MessageEvent('message',{data:{type:'nc-crew:back',version},origin,source:sender}));
  const escape=()=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  const tick=()=>intervals.find(item=>item.delay===15000).fn();
  const ctx={dom,w,d,messages,links,click,input,submit,back,escape,tick,parent};openDOMs.push(ctx);return ctx;
}
const marker = (overrides={}) => ({id:randomUUID(),name:'Убежище',description:'Красная дверь',secret:'GM ONLY: засада',kind:'home',color:'#f0cd66',x:400.123456,y:370.654321,map:'city2020',placeId:null,revealed:false,updated:1,...overrides});
const ready = async ctx => until(()=>!ctx.w.NC_CREW_CAMPAIGN.getState().busy && ctx.d.getElementById('campaign-status').textContent.includes('Ночная смена'));
function editFirst(ctx) { ctx.click('campaign-open');ctx.d.querySelector('[data-marker-open]').click();ctx.d.querySelector('[data-marker-edit]').click(); }
function newMarker(ctx) { ctx.click('add-marker'); assert(!ctx.d.getElementById('placement-hint').hidden);ctx.w.NC_CAMPAIGN.pick({}, {point:[412.123456,379.987654],unit:.1,state:{map:'synthesis',master:true}}); }

try {
  // GM CRUD, exact coordinates, marker field whitelist, public export and authenticated links.
  const backend=server(), ctx=browser(backend); const {w,d,click,input,submit}=ctx; await ready(ctx);
  assert(w.NightCityAtlas.getContext().master); assert(!d.getElementById('add-marker').hidden); assert(!w.NC_CAMPAIGN.locked);
  assert(ctx.messages.some(item=>item.message.type==='nc-atlas:ready'));assert(ctx.messages.every(item=>item.origin==='https://crew.example'));
  newMarker(ctx);input('marker-name','Custom <img src=x onerror=alert(1)>');input('marker-description','Public clue');input('marker-secret','PRIVATE TEST SECRET');submit();
  await until(()=>d.querySelector('[data-marker-edit]'));
  assert.equal(backend.markers.length,1);assert.equal(backend.markers[0].x,412.123456);assert.equal(backend.markers[0].map,'city2020');assert.equal(w.NC_CAMPAIGN.getPlayerMarkers().length,0);assert(!d.querySelector('#modal-body img'));
  d.querySelector('[data-marker-edit]').click();input('marker-revealed',true);submit();await until(()=>d.querySelector('[data-marker-share]:not([disabled])'));
  assert.equal(w.NC_CAMPAIGN.getPlayerMarkers().length,1);assert(!JSON.stringify(w.NC_CAMPAIGN.getPlayerMarkers()).includes('PRIVATE TEST SECRET'));
  d.querySelector('[data-marker-share]').click();await until(()=>ctx.links.length===1);const url=new URL(ctx.links[0]);assert.equal(url.origin,'https://crew.example');assert.equal(url.pathname,'/atlas/index.html');assert.equal(url.searchParams.get('campaignId'),'7');assert.equal(url.searchParams.get('mode'),'player');assert.equal(url.hash,'#mark-'+backend.markers[0].id);assert(!url.search.includes('invite'));assert(!url.search.includes('token'));
  // Moving preserves unsaved text; cancel restores coordinates and draft rather than old persisted values.
  d.querySelector('[data-marker-edit]').click();input('marker-name','Draft before moving');input('marker-secret','NEW DRAFT SECRET');click('marker-move');assert(w.NC_CREW_CAMPAIGN.getState().dirty);click('cancel-placement');assert.equal(d.getElementById('marker-name').value,'Draft before moving');assert.equal(d.getElementById('marker-secret').value,'NEW DRAFT SECRET');
  click('marker-move');w.NC_CAMPAIGN.pick({}, {point:[515.333333,422.777777],unit:.1,state:{map:'synthesis',master:true}});assert.equal(d.getElementById('marker-name').value,'Draft before moving');submit();await until(()=>d.querySelector('[data-marker-edit]'));assert.equal(backend.markers[0].x,515.333333);assert.equal(backend.markers[0].secret,'NEW DRAFT SECRET');
  d.querySelector('[data-marker-edit]').click();input('marker-name','Survives delete cancel');click('marker-delete');click('keep-marker');assert.equal(d.getElementById('marker-name').value,'Survives delete cancel');click('marker-delete');click('confirm-marker-delete');await until(()=>backend.markers.length===0 && !w.NC_CREW_CAMPAIGN.getState().busy);assert(d.querySelector('#campaign-new-pin'));
  console.log('Crew DOM: GM CRUD, exact coordinates, move/cancel, delete/cancel, escaped HTML and authenticated sharing passed.');

  // Explicit player projection, including a defensive check against an accidentally overbroad server payload.
  const playerServer=server();playerServer.markers=[marker(),marker({name:'Public place',revealed:true})];playerServer.role='player';
  const player=browser(playerServer,{mode:'gm'});await ready(player);assert(!player.w.NightCityAtlas.getContext().master);assert(player.w.NC_CAMPAIGN.locked);assert(player.d.getElementById('add-marker').hidden);assert(player.d.getElementById('view-mode').hidden);assert(!player.d.documentElement.textContent.includes('GM ONLY'));assert.equal(player.w.NC_CAMPAIGN.getPlayerMarkers().length,1);
  playerServer.before=(call,opts,response)=>call.method==='GET'?response(200,{...playerServer.projection('player'),markers:[marker({name:'Hidden injected'}),marker({revealed:true,secret:'INJECTED SECRET'})]}):null;
  await player.w.NC_CREW_CAMPAIGN.refresh();player.click('campaign-open');assert(!player.d.getElementById('modal-body').textContent.includes('Hidden injected'));assert(!player.d.documentElement.textContent.includes('INJECTED SECRET'));assert(!JSON.stringify(player.w.NC_CAMPAIGN.getPlayerMarkers()).includes('INJECTED SECRET'));
  const detailServer=server();detailServer.role='player';detailServer.markers=[marker({revealed:true,name:'Visible marker',description:'Old public detail'})];const detailPlayer=browser(detailServer,{mode:'player'});await ready(detailPlayer);detailPlayer.click('campaign-open');detailPlayer.d.querySelector('[data-marker-open]').click();assert(detailPlayer.d.getElementById('modal-body').textContent.includes('Old public detail'));detailServer.markers[0].description='Fresh public detail';detailPlayer.tick();await until(()=>detailPlayer.d.getElementById('modal-body').textContent.includes('Fresh public detail'));assert(!detailPlayer.d.getElementById('modal-body').textContent.includes('Old public detail'));detailServer.markers[0].revealed=false;detailPlayer.tick();await until(()=>!detailPlayer.d.getElementById('modal').hasAttribute('open'));assert(!detailPlayer.d.documentElement.textContent.includes('Fresh public detail'));
  detailServer.markers[0].revealed=true;await detailPlayer.w.NC_CREW_CAMPAIGN.refresh();detailPlayer.click('campaign-open');detailPlayer.d.querySelector('[data-marker-open]').click();detailServer.markers=[];detailPlayer.tick();await until(()=>!detailPlayer.d.getElementById('modal').hasAttribute('open'));assert(!detailPlayer.d.documentElement.textContent.includes('Fresh public detail'));
  console.log('Crew DOM: server-owned roles and player secret/hidden-marker filtering passed.');

  // Stale writes reload but never replace the form; retry is explicit and uses the same immutable command ID.
  const conflictServer=server();conflictServer.markers=[marker()];const conflict=browser(conflictServer);await ready(conflict);editFirst(conflict);conflict.input('marker-name','My unsaved title');conflict.input('marker-secret','Preserved conflict secret');conflictServer.revision++;conflictServer.markers[0].description='Another device';conflict.submit();
  await until(()=>conflict.d.getElementById('marker-error')?.textContent.includes('Карта изменилась на другом устройстве'));
  assert.equal(conflict.d.getElementById('marker-name').value,'My unsaved title');assert.equal(conflict.d.getElementById('marker-secret').value,'Preserved conflict secret');assert(conflict.w.NC_CREW_CAMPAIGN.getState().dirty);
  const rejected=conflictServer.calls.find(call=>call.method==='PUT');assert.equal(rejected.body.expectedVersion,0);conflict.submit();await until(()=>conflict.d.querySelector('[data-marker-edit]'));const retried=conflictServer.calls.filter(call=>call.method==='PUT').at(-1);assert.equal(rejected.body.id,retried.body.id);assert.equal(retried.body.expectedVersion,1);assert.equal(conflictServer.markers[0].name,'My unsaved title');
  console.log('Crew DOM: 409 preserves drafts and uses explicit revision-aware retry passed.');

  // A server commit followed by a timed-out response is resolved by replay, never a second create.
  const timeoutServer=server(), timed=browser(timeoutServer,{fastTimeout:true});await ready(timed);newMarker(timed);timed.input('marker-name','One marker only');
  timeoutServer.after=(call,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new timed.w.DOMException('Aborted','AbortError')),{once:true}));timed.submit();
  await until(()=>timed.d.getElementById('marker-error')?.textContent.includes('не ответил вовремя'));
  assert.equal(timeoutServer.markers.length,1);assert(timed.d.getElementById('marker-name').disabled);assert(timed.w.NC_CREW_CAMPAIGN.getState().dirty);const command=timeoutServer.calls.find(call=>call.method==='POST');timed.submit();await until(()=>timed.d.querySelector('[data-marker-edit]'));assert.equal(timeoutServer.markers.length,1);assert.equal(timeoutServer.calls.filter(call=>call.method==='POST').at(-1).body.id,command.body.id);assert(!timed.w.NC_CREW_CAMPAIGN.getState().dirty);
  // Invalid JSON after commit is also ambiguous and must use the existing command.
  timed.d.querySelector('[data-marker-edit]').click();timed.input('marker-description','Changed once');timeoutServer.after=async(call,opts,result)=>({...result,json:async()=>{throw new SyntaxError('Invalid JSON');}});timed.submit();await until(()=>timed.d.getElementById('marker-error')?.textContent.includes('непонятный ответ'));const invalidCommand=timeoutServer.calls.filter(call=>call.method==='PUT').at(-1);timed.submit();await until(()=>timed.d.querySelector('[data-marker-edit]'));assert.equal(timeoutServer.calls.filter(call=>call.method==='PUT').at(-1).body.id,invalidCommand.body.id);
  const deleteRetryServer=server();deleteRetryServer.markers=[marker()];const deletionRetry=browser(deleteRetryServer,{fastTimeout:true});await ready(deletionRetry);editFirst(deletionRetry);deletionRetry.input('marker-name','');deletionRetry.click('marker-delete');deleteRetryServer.after=(call,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new deletionRetry.w.DOMException('Aborted','AbortError')),{once:true}));deletionRetry.click('confirm-marker-delete');await until(()=>deletionRetry.d.getElementById('marker-error')?.textContent.includes('не ответил вовремя'));assert.equal(deletionRetry.d.getElementById('marker-name').value,'');assert(deletionRetry.d.getElementById('marker-name').disabled);const deleting=deleteRetryServer.calls.find(call=>call.method==='DELETE');deletionRetry.submit();await until(()=>deletionRetry.d.getElementById('campaign-new-pin'));assert.equal(deleteRetryServer.calls.filter(call=>call.method==='DELETE').length,2);assert.equal(deleteRetryServer.calls.filter(call=>call.method==='DELETE').at(-1).body.id,deleting.body.id);assert.equal(deleteRetryServer.markers.length,0);
  console.log('Crew DOM: timeout and invalid-JSON retries retain command IDs and do not duplicate writes passed.');

  // Unsaved guards: close, native dialog cancel, Escape and native Back; every valid Back is acknowledged.
  const guardServer=server();guardServer.markers=[marker({revealed:true})];const guard=browser(guardServer);await ready(guard);editFirst(guard);guard.input('marker-name','Guarded draft');guard.click('modal-close');assert(guard.d.getElementById('crew-keep-draft'));guard.escape();assert.equal(guard.d.getElementById('marker-name').value,'Guarded draft');
  guard.d.getElementById('modal').dispatchEvent(new guard.w.Event('cancel',{cancelable:true}));assert(guard.d.getElementById('crew-keep-draft'));guard.click('crew-keep-draft');
  const before=guard.messages.length;guard.back('https://attacker.example');guard.back('https://crew.example',{});guard.back('https://crew.example',guard.parent,2);assert.equal(guard.messages.length,before);assert(guard.d.getElementById('marker-form'));
  guard.back();assert(guard.d.getElementById('crew-keep-draft'));guard.back();assert.equal(guard.d.getElementById('marker-name').value,'Guarded draft');assert.equal(guard.messages.filter(item=>item.message.type==='nc-atlas:back-handled').length,2);assert(!guard.messages.some(item=>item.message.type==='nc-atlas:exit'));
  guard.back();guard.click('crew-save-draft');await until(()=>!guard.w.NC_CREW_CAMPAIGN.getState().busy&&!guard.w.NC_CREW_CAMPAIGN.getState().dirty);assert.equal(guardServer.markers[0].name,'Guarded draft');assert(!guard.d.getElementById('modal').hasAttribute('open'));guard.back();assert.equal(guard.messages.filter(item=>item.message.type==='nc-atlas:exit').length,1);guard.back();assert.equal(guard.messages.filter(item=>item.message.type==='nc-atlas:exit').length,1);
  const clean=browser(guardServer);await ready(clean);editFirst(clean);clean.back();assert(!clean.d.getElementById('modal').hasAttribute('open'));assert(!clean.messages.some(item=>item.message.type==='nc-atlas:exit'));clean.back();assert.equal(clean.messages.filter(item=>item.message.type==='nc-atlas:exit').length,1);
  const discard=browser(guardServer);await ready(discard);newMarker(discard);discard.input('marker-name','Do not save');discard.back();discard.click('crew-discard-draft');assert(!discard.w.NC_CREW_CAMPAIGN.getState().dirty);assert.equal(guardServer.markers.length,1);
  const panels=browser(guardServer);await ready(panels);panels.click('catalog-toggle');panels.back();assert(panels.d.getElementById('catalog-panel').hidden);assert(!panels.messages.some(item=>item.message.type==='nc-atlas:exit'));panels.back();assert(panels.messages.some(item=>item.message.type==='nc-atlas:exit'));
  console.log('Crew DOM: Save/Discard/Cancel, Escape, native Back twice, drawer order and exact-source messaging passed.');

  // Polling never replaces edits, and role/access changes remove every secret immediately on observation.
  const pollServer=server();pollServer.markers=[marker()];const polling=browser(pollServer);await ready(polling);editFirst(polling);polling.input('marker-name','Polling must not replace this');let calls=pollServer.calls.length;polling.tick();await sleep(20);assert.equal(pollServer.calls.length,calls);assert.equal(polling.d.getElementById('marker-name').value,'Polling must not replace this');polling.back();polling.click('crew-discard-draft');Object.defineProperty(polling.d,'hidden',{configurable:true,value:true});polling.tick();assert.equal(pollServer.calls.length,calls);Object.defineProperty(polling.d,'hidden',{configurable:true,value:false});polling.tick();await until(()=>pollServer.calls.length>calls&&!polling.w.NC_CREW_CAMPAIGN.getState().busy);
  editFirst(polling);polling.click('marker-cancel');polling.click('campaign-open');polling.d.querySelector('[data-marker-open]').click();assert(polling.d.getElementById('modal-body').textContent.includes('GM ONLY'));pollServer.role='player';polling.tick();await until(()=>polling.w.NC_CAMPAIGN.locked);assert(!polling.d.documentElement.textContent.includes('GM ONLY'));assert(polling.d.getElementById('add-marker').hidden);assert(!polling.w.NightCityAtlas.getContext().master);
  const revokeServer=server();revokeServer.markers=[marker()];const revoked=browser(revokeServer);await ready(revoked);editFirst(revoked);revoked.input('marker-name','Draft before revoke');revokeServer.denied=true;revoked.submit();await until(()=>revoked.w.NC_CAMPAIGN.locked&&!revoked.w.NC_CREW_CAMPAIGN.getState().busy);assert(!revoked.d.documentElement.textContent.includes('GM ONLY'));assert(!revoked.d.getElementById('marker-form'));assert.equal(revoked.w.NC_CAMPAIGN.getPlayerMarkers().length,0);
  console.log('Crew DOM: visible-only polling, edit protection, role downgrade and write-time access revocation passed.');

  // Obsolete GM loads must never restore secrets after a mode change.
  const raceServer=server();raceServer.markers=[marker()];let release;
  raceServer.before=(call,opts,response)=>{if(call.method==='GET'&&new URL(call.url).searchParams.get('view')==='gm')return new Promise(resolve=>{release=()=>resolve(response(200,raceServer.projection('gm')));});return null;};
  const raced=browser(raceServer);await until(()=>release);raced.w.NightCityAtlas.setMode(false);await ready(raced);release();await sleep(40);assert(raced.w.NC_CAMPAIGN.locked);assert(!raced.w.NightCityAtlas.getContext().master);assert(!raced.d.documentElement.textContent.includes('GM ONLY'));assert.equal(raced.w.NC_CAMPAIGN.getPlayerMarkers().length,0);
  const visibleServer=server();visibleServer.markers=[marker({revealed:true})];const view=browser(visibleServer);await ready(view);editFirst(view);view.click('marker-cancel');view.click('campaign-open');view.d.querySelector('[data-marker-open]').click();assert(view.d.getElementById('modal-body').textContent.includes('GM ONLY'));view.w.NightCityAtlas.setMode(false);assert(!view.d.documentElement.textContent.includes('GM ONLY'));assert(!JSON.stringify(view.w.NC_CAMPAIGN.getPlayerMarkers()).includes('GM ONLY'));await ready(view);
  console.log('Crew DOM: obsolete-load suppression and synchronous player-view secret clearing passed.');
  // Deleted-marker recovery preserves a draft; removed-campaign 404 wipes it instead.
  const missingServer=server();missingServer.markers=[marker()];const missing=browser(missingServer);await ready(missing);editFirst(missing);missing.input('marker-name','Recovered draft');missingServer.markers=[];missing.submit();await until(()=>missing.d.getElementById('marker-error')?.textContent.includes('Метка была удалена'));assert.equal(missing.d.getElementById('marker-name').value,'Recovered draft');assert.equal(missing.d.getElementById('marker-save').textContent,'Сохранить как новую метку');missing.submit();await until(()=>missing.d.querySelector('[data-marker-edit]'));assert.equal(missingServer.markers.length,1);assert.equal(missingServer.markers[0].name,'Recovered draft');
  missing.d.querySelector('[data-marker-edit]').click();missing.input('marker-name','Campaign removed draft');missingServer.before=(call,opts,response)=>response(404,{error:'Кампания удалена.'});missing.submit();await until(()=>missing.w.NC_CAMPAIGN.locked&&!missing.w.NC_CREW_CAMPAIGN.getState().busy);assert(!missing.d.getElementById('marker-form'));assert(!missing.d.documentElement.textContent.includes('GM ONLY'));
  // Busy Back cannot discard an in-flight write, but always acknowledges the parent.
  const busyServer=server(), saving=browser(busyServer);await ready(saving);newMarker(saving);saving.input('marker-name','In flight');let finishWrite;
  busyServer.after=(call,opts,result)=>new Promise(resolve=>{finishWrite=()=>resolve(result);});saving.submit();await until(()=>finishWrite);saving.back();assert(saving.w.NC_CREW_CAMPAIGN.getState().busy);assert(!saving.messages.some(item=>item.message.type==='nc-atlas:exit'));assert(saving.messages.some(item=>item.message.type==='nc-atlas:back-handled'));saving.submit();assert.equal(busyServer.calls.filter(call=>call.method==='POST').length,1);finishWrite();await until(()=>saving.d.querySelector('[data-marker-edit]'));
  // Loopback URLs are not handed to players as if another device could open them.
  saving.dom.reconfigure({url:'http://127.0.0.1:8080/atlas/index.html?crew=1&campaignId=7&mode=gm'});saving.click('campaign-open');saving.click('campaign-share');assert.equal(saving.links.length,0);assert(saving.d.getElementById('modal-body').textContent.includes('только на устройстве ведущего'));
  // Brand and public API close routes get the same guard as the close button.
  const navServer=server();const nav=browser(navServer);await ready(nav);newMarker(nav);nav.input('marker-name','Navigation-safe draft');nav.w.NightCityAtlas.closeModal();assert(nav.d.getElementById('crew-keep-draft'));nav.click('crew-keep-draft');nav.d.querySelector('.brand').click();assert(nav.d.getElementById('crew-keep-draft'));nav.click('crew-keep-draft');assert.equal(nav.d.getElementById('marker-name').value,'Navigation-safe draft');
  const revokedURLs=[];nav.w.URL.createObjectURL=()=> 'blob:https://crew.example/test-export';nav.w.URL.revokeObjectURL=url=>revokedURLs.push(url);
  let resumes=0;const resize=nav.w.NightCityAtlas.resizeMap;nav.w.NightCityAtlas.resizeMap=()=>{resumes++;resize?.();};nav.w.dispatchEvent(new nav.w.MessageEvent('message',{source:{},origin:'https://crew.example',data:{type:'nc-crew:resume',version:1}}));nav.w.dispatchEvent(new nav.w.MessageEvent('message',{source:nav.parent,origin:'https://evil.example',data:{type:'nc-crew:resume',version:1}}));assert.equal(resumes,0);nav.w.dispatchEvent(new nav.w.MessageEvent('message',{source:nav.parent,origin:'https://crew.example',data:{type:'nc-crew:resume',version:1}}));assert.equal(resumes,1);
  const exportBlob=new nav.w.Blob(['{"safe":true}'],{type:'application/json'});
  assert(nav.w.NC_CREW_BRIDGE.download(exportBlob,'NightCity_Atlas_2020_Player.json'));assert(!nav.w.NC_CREW_BRIDGE.download(exportBlob,'../../unsafe.json'));assert(!nav.w.NC_CREW_BRIDGE.download('https://evil.example','NightCity_Atlas_2020.json'));const exportMessage=nav.messages.at(-1).message;assert.equal(exportMessage.type,'nc-atlas:download');assert.equal(exportMessage.url,'blob:https://crew.example/test-export');assert.equal(revokedURLs.length,0);
  nav.w.dispatchEvent(new nav.w.MessageEvent('message',{source:nav.parent,origin:'https://evil.example',data:{type:'nc-crew:download-complete',version:1,url:exportMessage.url}}));assert.equal(revokedURLs.length,0);nav.w.dispatchEvent(new nav.w.MessageEvent('message',{source:nav.parent,origin:'https://crew.example',data:{type:'nc-crew:download-complete',version:1,url:exportMessage.url}}));assert.equal(revokedURLs.length,1);
  const notes=browser(server());await ready(notes);const noteA=notes.w.NC_ATLAS_DATA.corePlaces[0].id,noteB=notes.w.NC_ATLAS_DATA.corePlaces[1].id;
  notes.w.NightCityAtlas.selectLocation(noteA);notes.input('local-notes','Immediate note A');notes.w.NightCityAtlas.selectLocation(noteB);notes.input('local-notes','Immediate note B');assert.equal(notes.w.localStorage.getItem('nc-atlas:crew-note:v1:3:owner:7:'+noteA),'Immediate note A');assert.equal(notes.w.localStorage.getItem('nc-atlas:crew-note:v1:3:owner:7:'+noteB),'Immediate note B');
  const originalSet=notes.w.Storage.prototype.setItem;notes.w.Storage.prototype.setItem=()=>{throw new notes.w.DOMException('Storage full','QuotaExceededError');};notes.d.getElementById('local-notes').value='Unsaved on full storage';notes.back();assert(!notes.messages.some(item=>item.message.type==='nc-atlas:exit'));assert.equal(notes.d.getElementById('local-notes').value,'Unsaved on full storage');assert(notes.w.NC_CREW_CAMPAIGN.getState().dirty);assert(notes.d.getElementById('notes-retry'));notes.w.Storage.prototype.setItem=originalSet;notes.click('notes-retry');assert.equal(notes.w.localStorage.getItem('nc-atlas:crew-note:v1:3:owner:7:'+noteB),'Unsaved on full storage');assert(notes.messages.some(item=>item.message.type==='nc-atlas:exit'));
  notes.d.getElementById('local-notes').value='Pagehide flush';notes.w.dispatchEvent(new notes.w.Event('pagehide'));assert.equal(notes.w.localStorage.getItem('nc-atlas:crew-note:v1:3:owner:7:'+noteB),'Pagehide flush');
  const scopedServer=server(),scoped=browser(scopedServer,{initialStorage:{['nc-atlas:note:'+noteA]:'LEGACY SHARED SECRET'}});await ready(scoped);scoped.w.NightCityAtlas.selectLocation(noteA);assert.equal(scoped.d.getElementById('local-notes').value,'','Never auto-migrate legacy shared notes');scoped.input('local-notes','Account A campaign 7');const accountAKey=scoped.d.getElementById('local-notes').dataset.noteKey;
  scopedServer.viewer={id:4,username:'other-owner'};await scoped.w.NC_CREW_CAMPAIGN.refresh();assert.equal(scoped.d.getElementById('local-notes').value,'');assert(!scoped.d.documentElement.textContent.includes('Account A campaign 7'));scoped.input('local-notes','Account B campaign 7');const accountBKey=scoped.d.getElementById('local-notes').dataset.noteKey;assert.notEqual(accountAKey,accountBKey);scopedServer.viewer={id:3,username:'owner'};await scoped.w.NC_CREW_CAMPAIGN.refresh();assert.equal(scoped.d.getElementById('local-notes').value,'Account A campaign 7');
  const allStorage=Object.fromEntries(Array.from({length:scoped.w.localStorage.length},(_,index)=>{const key=scoped.w.localStorage.key(index);return[key,scoped.w.localStorage.getItem(key)];}));const otherCampaignServer=server();otherCampaignServer.id=8;const otherCampaign=browser(otherCampaignServer,{campaignId:8,initialStorage:allStorage});await ready(otherCampaign);otherCampaign.w.NightCityAtlas.selectLocation(noteA);assert.equal(otherCampaign.d.getElementById('local-notes').value,'');otherCampaign.input('local-notes','Account A campaign 8');const accountACampaign8=otherCampaign.d.getElementById('local-notes').dataset.noteKey;assert.notEqual(accountACampaign8,accountAKey);otherCampaignServer.viewer={id:4,username:'other-owner'};await otherCampaign.w.NC_CREW_CAMPAIGN.refresh();assert.equal(otherCampaign.d.getElementById('local-notes').value,'');otherCampaign.input('local-notes','Account B campaign 8');assert.notEqual(otherCampaign.d.getElementById('local-notes').dataset.noteKey,accountBKey);
  const scopedSetItem=scoped.w.Storage.prototype.setItem;scoped.w.Storage.prototype.setItem=()=>{throw new scoped.w.DOMException('Full','QuotaExceededError');};scoped.input('local-notes','ACCOUNT A BUFFER ONLY');assert(scoped.w.NC_CREW_CAMPAIGN.getState().dirty);scoped.w.NightCityAtlas.showLocalNoteRecovery(()=>{});const staleCopy=scoped.d.getElementById('notes-copy');scopedServer.viewer={id:4,username:'other-owner'};await scoped.w.NC_CREW_CAMPAIGN.refresh();assert(!scoped.d.getElementById('notes-copy'));assert(!scoped.w.NC_CREW_CAMPAIGN.getState().dirty,'Other account buffer cannot block current account');assert.equal(scoped.d.getElementById('local-notes').value,'Account B campaign 7');staleCopy.click();assert.equal(scoped.links.length,0,'Stale recovery callback cannot copy a previous account draft');scoped.w.Storage.prototype.setItem=scopedSetItem;scopedServer.viewer={id:3,username:'owner'};await scoped.w.NC_CREW_CAMPAIGN.refresh();assert.equal(scoped.d.getElementById('local-notes').value,'ACCOUNT A BUFFER ONLY');assert(scoped.w.NC_CREW_CAMPAIGN.getState().dirty);assert(scoped.w.NightCityAtlas.flushLocalNotes());assert(!scoped.w.NC_CREW_CAMPAIGN.getState().dirty);
  scopedServer.viewer=null;await scoped.w.NC_CREW_CAMPAIGN.refresh();assert(!scoped.d.getElementById('local-notes'),'Missing verified viewer must hide notes');scopedServer.viewer={id:3,username:'owner'};await scoped.w.NC_CREW_CAMPAIGN.refresh();assert.equal(scoped.d.getElementById('local-notes').value,'ACCOUNT A BUFFER ONLY');scoped.w.NightCityAtlas.setMode(false);assert(!scoped.d.getElementById('local-notes'));await ready(scoped);assert(!scoped.d.documentElement.textContent.includes('LEGACY SHARED SECRET'));
  console.log('Crew DOM: two accounts × two campaigns isolate local notes; missing viewer/player view hide notes and legacy keys never migrate.');
  console.log('Crew DOM: JSON download origin/ack, immediate A/B local-note saves, full-storage exit guard and pagehide flush passed.');
  const identityServer=server(), identity=browser(identityServer);await ready(identity);newMarker(identity);identity.input('marker-name','Old account draft');identity.input('marker-secret','ACCOUNT A PRIVATE DRAFT');identityServer.viewer={id:4,username:'other-owner'};identity.submit();await until(()=>identity.w.NC_CAMPAIGN.locked&&!identity.w.NC_CREW_CAMPAIGN.getState().busy);assert.equal(identityServer.calls.filter(call=>call.method==='POST').length,0,'Never send prior-account draft with a new account session');assert(!identity.d.documentElement.textContent.includes('ACCOUNT A PRIVATE DRAFT'));assert(!identity.d.getElementById('marker-form'));assert(!identity.d.getElementById('local-notes'));
  console.log('Crew DOM: uncertain DELETE with empty title, refreshed/hidden/deleted player details and account-change write blocking passed.');
  console.log('Crew DOM: removed-marker recovery, removed-campaign clearing, busy Back, loopback sharing and navigation guards passed.');
  if (process.env.CREW_ATLAS_SOURCE) {
    // Optional end-to-end adapter test against real Crew HTTP + SQLite fixtures.
    // Session cookies travel only between this isolated fixture and its own host.
    const python = spawn('python3',['-u','-c',`
import json, sys
sys.path.insert(0, sys.argv[1] + '/tests')
from test_crew_atlas_http import CrewAtlasHTTP
fixture = CrewAtlasHTTP(methodName='runTest')
try:
    fixture.setUp()
    fixture.party()
    print(json.dumps(dict(port=fixture.port, owner=fixture.owner.cookie, player=fixture.peer.cookie,
        campaignId=int(fixture.base.split('/')[-1]))), flush=True)
    sys.stdin.readline()
finally:
    fixture.doCleanups()
`,process.env.CREW_ATLAS_SOURCE],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';python.stderr.on('data',part=>{stderr+=part;});
    try {
      const config = await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Real Crew fixture did not start: '+stderr)),20000);
        python.on('error',error=>{clearTimeout(timer);reject(error);});
        python.on('exit',code=>{if(!stdout.includes('\n')){clearTimeout(timer);reject(new Error('Real Crew fixture exited '+code+': '+stderr));}});
        python.stdout.on('data',part=>{stdout+=part;const line=stdout.split('\n')[0];if(stdout.includes('\n')){try{clearTimeout(timer);resolve(JSON.parse(line));}catch(error){clearTimeout(timer);reject(error);}}});
      });
      const origin='http://127.0.0.1:'+config.port, options={origin,campaignId:config.campaignId};
      const realBackend = cookie => ({fetch:async(url,opts={})=>{
        assert.equal(new URL(url).origin,origin);assert.equal(opts.credentials,'same-origin');
        return fetch(url,{...opts,headers:{...opts.headers,Cookie:cookie,Origin:origin}});
      }});
      const actual=browser(realBackend(config.owner),options);
      await until(()=>!actual.w.NC_CREW_CAMPAIGN.getState().busy&&!actual.w.NC_CAMPAIGN.locked,'Real GM membership verified');
      newMarker(actual);actual.input('marker-name','Real HTTP marker');actual.input('marker-secret','REAL HTTP PRIVATE');actual.submit();await until(()=>actual.d.querySelector('[data-marker-edit]'),'Real Crew CSRF-protected create');
      const stored=await (await fetch(origin+'/api/campaigns/'+config.campaignId+'/atlas',{headers:{Cookie:config.owner}})).json();assert.equal(stored.markers.length,1);assert.equal(stored.markers[0].x,412.123456);assert.equal(stored.markers[0].secret,'REAL HTTP PRIVATE');
      const actualPlayer=browser(realBackend(config.player),{...options,mode:'gm'});await until(()=>!actualPlayer.w.NC_CREW_CAMPAIGN.getState().busy);assert(actualPlayer.w.NC_CAMPAIGN.locked);assert.equal(actualPlayer.w.NC_CAMPAIGN.getPlayerMarkers().length,0);assert(!actualPlayer.d.documentElement.textContent.includes('REAL HTTP PRIVATE'));
      actual.d.querySelector('[data-marker-edit]').click();actual.input('marker-revealed',true);actual.submit();await until(()=>actual.d.querySelector('[data-marker-share]:not([disabled])'));await actualPlayer.w.NC_CREW_CAMPAIGN.refresh();assert.equal(actualPlayer.w.NC_CAMPAIGN.getPlayerMarkers().length,1);assert(!JSON.stringify(actualPlayer.w.NC_CAMPAIGN.getPlayerMarkers()).includes('REAL HTTP PRIVATE'));
      actual.d.querySelector('[data-marker-edit]').click();actual.click('marker-move');actual.w.NC_CAMPAIGN.pick({}, {point:[413.123456789,381.987654321],unit:.1,state:{map:'synthesis',master:true}});actual.submit();await until(()=>actual.d.querySelector('[data-marker-edit]'));actual.d.querySelector('[data-marker-edit]').click();actual.click('marker-delete');actual.click('confirm-marker-delete');await until(()=>actual.d.querySelector('#campaign-new-pin')&&!actual.w.NC_CREW_CAMPAIGN.getState().busy);await actualPlayer.w.NC_CREW_CAMPAIGN.refresh();assert.equal(actualPlayer.w.NC_CAMPAIGN.getPlayerMarkers().length,0);
      assert(!actual.messages.some(item=>JSON.stringify(item).includes('csrf')));assert(!actual.messages.some(item=>JSON.stringify(item).includes('REAL HTTP PRIVATE')));
      console.log('Crew live HTTP + real DOM: cookie sessions, /api/me CSRF, accepted-player roles, create/reveal/move/delete and secret separation passed.');
    } finally { python.stdin.end('done\n');await new Promise(resolve=>{if(python.exitCode!==null)return resolve();python.once('exit',resolve);setTimeout(()=>{python.kill('SIGTERM');resolve();},5000).unref();}); }
  } else console.log('Live Crew HTTP adapter check not run: set CREW_ATLAS_SOURCE to the Crew source root.');
  console.log('All Crew adapter and bridge checks passed.');
} finally { for(const ctx of openDOMs){ctx.w.NC_CREW_CAMPAIGN?.dispose();ctx.dom.window.close();} }
