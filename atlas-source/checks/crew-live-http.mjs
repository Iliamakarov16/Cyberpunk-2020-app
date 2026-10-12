import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
const fixture=JSON.parse(fs.readFileSync(0,'utf8'));
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const nativeFetch=globalThis.fetch,origin=`http://127.0.0.1:${fixture.port}`,base=`/api/campaigns/${fixture.campaignId}/atlas`;
const requests=[];
async function get(cookie){const r=await nativeFetch(origin+base,{headers:{Cookie:cookie,Origin:origin}});assert.equal(r.status,200);return r.json();}
async function until(condition,label){for(let i=0;i<400;i++){if(condition())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out: '+label);}
async function open(cookie,mode='gm'){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(read('public/index.html'),{url:`${origin}/atlas/index.html?crew=1&campaignId=${fixture.campaignId}&mode=${mode}`,runScripts:'outside-only',virtualConsole:vc,pretendToBeVisual:true});
 const w=dom.window,d=w.document;
 w.AbortController=globalThis.AbortController;w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.getBoundingClientRect=w.SVGElement.prototype.getBoundingClientRect=()=>({width:390,height:850,left:0,top:0});
 w.fetch=async(url,init={})=>{assert.equal(new URL(url,origin).origin,origin);const h=new Headers(init.headers);h.set('Cookie',cookie);h.set('Origin',origin);if(init.method&&init.method!=='GET'){assert(h.get('X-CSRF-Token'),'Actual browser adapter must supply Crew CSRF token');requests.push({method:init.method,path:new URL(url,origin).pathname});}return nativeFetch(url,{...init,headers:h});};
 for(const file of ['theme.js','data.js','streets-data.js','world-data.js','transit-data.js','cartography.js','app.js','transit.js','crew-campaign.js','crew-bridge.js'])w.eval(read('public/'+file));
 d.dispatchEvent(new w.Event('DOMContentLoaded'));
 await until(()=>!w.NC_CREW_CAMPAIGN.getState().busy,'initial actual HTTP load');
 return {dom,w,d,errors,close(){w.NC_CREW_CAMPAIGN.dispose();dom.window.close();}};
}
const gm=await open(fixture.ownerCookie),player=await open(fixture.playerCookie);
try{
 assert(gm.w.NightCityAtlas.getContext().master);assert(!player.w.NightCityAtlas.getContext().master,'Forged gm query does not confer campaign role');
 gm.w.NightCityAtlas.selectLocation('core-39');
 const expectedPoint=Array.from(gm.w.NightCityAtlas.getContext().point);
 gm.d.querySelector('[data-action="campaign-mark"]').click();
 assert(gm.d.getElementById('marker-form'),'Canonical location starts real Crew editor');
 function input(id,value){const el=gm.d.getElementById(id);el.value=value;el.dispatchEvent(new gm.w.Event('input',{bubbles:true}));}
 input('marker-name','LIVE-ADAPTER-CANONICAL');input('marker-secret','PRIVATE-LIVE-GM-NOTE');input('marker-description','Known public description');
 gm.d.getElementById('marker-form').dispatchEvent(new gm.w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>!gm.w.NC_CREW_CAMPAIGN.getState().busy&&!gm.d.getElementById('marker-form'),'authenticated create');
 let state=await get(fixture.ownerCookie);assert.equal(state.markers.length,1);let marker=state.markers[0];assert.equal(marker.name,'LIVE-ADAPTER-CANONICAL');assert.equal(marker.secret,'PRIVATE-LIVE-GM-NOTE');assert.deepEqual([marker.x,marker.y],expectedPoint);assert.equal(marker.placeId,'core-39');assert.equal(marker.map,'city2020');
 assert.deepEqual((await get(fixture.playerCookie)).markers,[],'Hidden marker absent from actual player HTTP');
 gm.d.querySelector('[data-marker-edit]').click();
 const reveal=gm.d.getElementById('marker-revealed');reveal.checked=true;reveal.dispatchEvent(new gm.w.Event('change',{bubbles:true}));
 gm.d.getElementById('marker-move').click();gm.w.NC_CAMPAIGN.pick(new gm.w.Event('pointerup'),{point:[233.123456789012,612.987654321098],unit:1,state:{map:'synthesis',plan:'B2',master:true}});
 gm.d.getElementById('marker-form').dispatchEvent(new gm.w.Event('submit',{bubbles:true,cancelable:true}));
 await until(()=>!gm.w.NC_CREW_CAMPAIGN.getState().busy&&!gm.d.getElementById('marker-form'),'real HTTP update/reveal/move');
 state=await get(fixture.ownerCookie);marker=state.markers[0];assert.equal(marker.x,233.123456789012);assert.equal(marker.y,612.987654321098);assert.equal(marker.revealed,true);
 const publicState=await get(fixture.playerCookie);assert.equal(publicState.markers.length,1);assert(!('secret' in publicState.markers[0]));
 await player.w.NC_CREW_CAMPAIGN.refresh();assert.equal(player.w.NC_CAMPAIGN.getPlayerMarkers().length,1);assert(!JSON.stringify(player.w.NC_CAMPAIGN.getPlayerMarkers()).includes('PRIVATE-LIVE'));
 gm.d.querySelector('[data-marker-edit]').click();gm.d.getElementById('marker-delete').click();gm.d.getElementById('confirm-marker-delete').click();
 await until(()=>!gm.w.NC_CREW_CAMPAIGN.getState().busy&&!gm.d.getElementById('confirm-marker-delete'),'real HTTP delete');
 assert.deepEqual((await get(fixture.ownerCookie)).markers,[]);assert.deepEqual((await get(fixture.playerCookie)).markers,[]);
 assert.deepEqual(requests.map(r=>r.method),['POST','PUT','DELETE']);assert.deepEqual(gm.errors,[]);assert.deepEqual(player.errors,[]);
 console.log('Actual Crew HTTP + real adapter/JSDOM: session CSRF, canonical create, exact-coordinate move/reveal, private player projection, forged role rejection and delete passed.');
}finally{gm.close();player.close();}
