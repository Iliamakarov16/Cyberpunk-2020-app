import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.js';
const db=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(p=>p.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const env={DB:{prepare(sql){assert(!/;\s*\S/.test(sql),'One prepared SQL statement');const statement=db.prepare(sql);return{bind(...args){return{async first(){return statement.get(...args)||null},async all(){return{results:statement.all(...args)}},async run(){return statement.run(...args)}}}}} ,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}}};
async function call(path='',{user='gm-one',method='GET',body,origin}={}){const req=new Request('https://atlas.example/api/campaigns'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(origin?{origin}:{}),'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const response=await worker.fetch(req,env,{});return{status:response.status,data:await response.json()}}
const c=(await call('',{method:'POST',body:{name:'Night City 2020'}})).data;assert(c.id&&c.invite);const originalInvite=c.invite;
const payload={name:'Безопасный дом',description:'Дверь с красной лампой',secret:'СЕКРЕТ: агент внутри',x:400.123,y:370.45,map:'city2020',revealed:false,kind:'home',color:'#f0cd66'};
const hidden=await call('/'+c.id+'/markers',{method:'POST',body:payload});assert.equal(hidden.status,201);
const open=await call('/'+c.id+'/markers',{method:'POST',body:{...payload,name:'Бар',revealed:true}});assert.equal(open.status,201);
let gm=await call('/'+c.id);assert.equal(gm.data.markers.length,2);assert(gm.data.markers.every(m=>m.secret===payload.secret));assert.equal(gm.data.invite,c.invite);assert.equal(gm.data.markers[0].x,payload.x);
let p=await call('/'+c.id+'?invite='+c.invite,{user:'player'});assert.equal(p.data.markers.length,1);assert(!JSON.stringify(p.data).includes('СЕКРЕТ'));assert(!('invite'in p.data));assert.equal(p.data.canManage,false);
assert.equal((await call('/'+c.id+'?invite='+c.invite+'&view=gm',{user:'player'})).data.role,'player');
assert.equal((await call('/'+c.id+'?view=player')).data.markers.length,1);
assert.equal((await call('/'+c.id,{user:'player'})).status,403);
assert.equal((await call('/'+c.id+'/markers?invite='+c.invite,{user:'player',method:'POST',body:payload})).status,403);
assert.equal((await call('/'+c.id+'/markers/'+hidden.data.id+'?invite='+c.invite,{user:'player',method:'DELETE'})).status,403);
assert.equal((await call('/'+c.id+'/markers',{method:'POST',body:payload,origin:'https://attacker.example'})).status,403);
assert.equal((await call('/'+c.id+'/markers',{method:'POST',body:{...payload,x:NaN}})).status,400);
assert.equal((await call('/'+c.id+'/markers',{method:'POST',body:{...payload,x:1025}})).status,400);
assert.equal((await call('/'+c.id+'/markers/'+hidden.data.id,{method:'PUT',body:{...payload,revealed:true}})).status,200);
p=await call('/'+c.id+'?invite='+c.invite,{user:'player'});assert.equal(p.data.markers.length,2);assert(!p.data.markers.some(m=>'secret'in m));
const rotation=await call('/'+c.id+'/invite',{method:'POST',body:{}});assert(rotation.data.invite!==originalInvite);assert.equal((await call('/'+c.id+'?invite='+originalInvite,{user:'player'})).status,403);
await call('/'+c.id+'/markers/'+hidden.data.id,{method:'DELETE'});assert.equal((await call('/'+c.id+'?invite='+rotation.data.invite,{user:'player'})).data.markers.length,1);
assert.equal((await call('',{user:null,method:'POST',body:{name:'No identity'}})).status,401);
assert.equal((await call()).data.campaigns.length,1);assert.equal((await call('',{user:'player'})).data.campaigns.length,0);
console.log('Campaign storage, role separation, reveal/hide, revocation and write authorization passed.');

// DOM interaction checks use JSDOM; this is not native-browser or touch layout QA.
const {JSDOM}=await import('jsdom');
const copyLinks=[];
function browser(url,user){
 const dom=new JSDOM(fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),{url,runScripts:'outside-only'}),w=dom.window;
 w.matchMedia=()=>({matches:false});w.setInterval=()=>0;w.HTMLElement.prototype.getBoundingClientRect=()=>({width:640,height:850,left:0,top:0});w.SVGElement.prototype.getBoundingClientRect=w.HTMLElement.prototype.getBoundingClientRect;
 w.fetch=async(u,opts={})=>worker.fetch(new Request(String(u),{...opts,headers:{...opts.headers,'oai-authenticated-user-id':user}}),env,{});
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async s=>copyLinks.push(s)}});
 for(const script of ['data.js','streets-data.js','world-data.js','transit-data.js','cartography.js','app.js','transit.js','campaign.js'])w.eval(fs.readFileSync(new URL('../public/'+script,import.meta.url),'utf8'));
 return dom;
}
async function until(predicate){for(let n=0;n<80;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10))}assert(predicate(),'UI operation completed')}
const gmDOM=browser('https://atlas.example/','gm-two'),w=gmDOM.window,d=w.document;
d.getElementById('campaign-open').click();d.getElementById('campaign-name').value='UI campaign';d.getElementById('campaign-create').dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:d.querySelector('#campaign-create button')}));
await until(()=>d.getElementById('campaign-new-pin'));assert(w.NightCityAtlas.getContext().master);d.getElementById('campaign-new-pin').click();assert(!d.getElementById('placement-hint').hidden);
assert(w.NC_CAMPAIGN.pick({},{point:[400,370],unit:.1,state:{map:'synthesis',master:true}}));d.getElementById('marker-name').value='Custom UI place';d.getElementById('marker-description').value='Public clue';d.getElementById('marker-secret').value='UI PRIVATE SECRET';
d.getElementById('marker-form').dispatchEvent(new w.SubmitEvent('submit',{cancelable:true,submitter:d.getElementById('marker-save')}));await until(()=>d.querySelector('[data-marker-edit]'));assert(d.getElementById('modal-body').textContent.includes('UI PRIVATE SECRET'));assert.equal(w.NC_CAMPAIGN.getPlayerMarkers().length,0);
d.querySelector('[data-marker-edit]').click();d.getElementById('marker-revealed').checked=true;d.getElementById('marker-form').dispatchEvent(new w.SubmitEvent('submit',{cancelable:true,submitter:d.getElementById('marker-save')}));await until(()=>d.querySelector('[data-marker-share]:not([disabled])'));assert.equal(w.NC_CAMPAIGN.getPlayerMarkers().length,1);assert.equal(w.NC_CAMPAIGN.getPlayerMarkers()[0].map,'city2020');assert(!JSON.stringify(w.NC_CAMPAIGN.getPlayerMarkers()).includes('UI PRIVATE SECRET'));
d.querySelector('[data-marker-share]').click();await until(()=>copyLinks.length);const sharedURL=copyLinks.at(-1);assert(sharedURL.includes('mode=player')&&sharedURL.includes('invite='));assert(!sharedURL.includes('PRIVATE'));
const playerDOM=browser(sharedURL,'player-ui'),pd=playerDOM.window.document;await until(()=>!pd.getElementById('campaign-status').hidden);assert(pd.getElementById('add-marker').hidden);assert(pd.getElementById('view-mode').hidden);assert(!pd.documentElement.textContent.includes('UI PRIVATE SECRET'));assert.equal(playerDOM.window.NC_CAMPAIGN.getPlayerMarkers().length,1);
for(const a of w.NC_TRANSIT.stations)for(const b of w.NC_TRANSIT.stations){const r=w.NC_TRANSIT.route(a.id,b.id);assert(r);assert.equal(r.stations[0],a.id);assert.equal(r.stations.at(-1),b.id);assert.equal(r.fare,r.stops*.25)}
d.getElementById('metro-open').click();assert(d.getElementById('metro-form'));assert(d.querySelectorAll('#metro-from option').length===25);d.getElementById('metro-from').value='metro-pacifica';d.getElementById('metro-to').value='metro-city-center';d.getElementById('metro-form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert(d.getElementById('metro-result').textContent.includes('City Center'));
gmDOM.window.close();playerDOM.window.close();console.log('DOM flow: create campaign, place/save/reveal marker, player link, secret omission and all 625 metro routes passed.');
