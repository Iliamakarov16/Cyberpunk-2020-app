import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
const env=installEnvironment(),h=createHarness();env.window.location={origin:'http://crew.test'};
const {CityAtlas}=await loadModules(h,undefined,{actualAtlas:true});
let exits=0,selections=[];const props={campaignId:42,campaignName:'Бар',isGM:true,onExit:()=>exits++,onSelection:value=>selections.push(value)};
h.mount(CityAtlas,props);await h.flush();const iframe=()=>h.find(n=>n.type==='iframe',false);const messages=[];const source={postMessage:(...args)=>messages.push(args)};iframe().props.ref.current.contentWindow=source;
assert.match(iframe().props.src,/campaignId=42/);assert.match(iframe().props.src,/mode=gm/);
function send(data,{origin='http://crew.test',sender=source}={}){const event=new Event('message');Object.defineProperties(event,{origin:{value:origin},source:{value:sender},data:{value:data}});env.window.dispatchEvent(event);}
async function back(){const event=new Event('nightcity-atlas-back',{cancelable:true});env.window.dispatchEvent(event);h.render();await h.flush();assert(event.defaultPrevented);}
send({type:'nc-atlas:ready',version:1},{origin:'https://intruder.test'});await h.flush();assert(h.text().includes('Открываем'));send({type:'nc-atlas:exit',version:1},{sender:{}});assert.equal(exits,0);
send({type:'nc-atlas:ready',version:1});await h.flush();assert(!h.text().includes('Открываем'));assert(messages.some(([data,origin])=>data.type==='nc-crew:theme'&&origin==='http://crew.test'));
// Live document appearance wins even when persistence is unavailable/stale.
for(const palette of ['carmine','ultraviolet','amber','maelstrom','original']){
 Object.assign(env.document.documentElement.dataset,{palette,treatment:'raw',digital:'off'});
 env.window.dispatchEvent(new Event('nightcity-interface-change'));
 const [message,origin]=messages.at(-1);assert.equal(origin,'http://crew.test');
 assert.deepEqual(JSON.parse(message.settings),{palette,treatment:'raw',digital:false});
}
send({type:'nc-atlas:state',version:1,dirty:true,busy:false});await back();assert.equal(messages.at(-1)[0].type,'nc-crew:back');assert.equal(exits,0,'Native Back asks the iframe to protect its draft instead of unmounting it');
send({type:'nc-atlas:back-handled',version:1});await h.flush();assert.equal(exits,0);
let downloads=[],fetches=[];env.document.createElement=()=>({click(){downloads.push({url:this.href,name:this.download});}});
const createObjectURL=URL.createObjectURL;URL.createObjectURL=()=> 'blob:http://crew.test/parent-copy';
globalThis.fetch=async url=>{fetches.push(url);return new Response('{"catalog":[]}',{headers:{'Content-Type':'application/json'}});};
send({type:'nc-atlas:download',version:1,url:'https://intruder.test/secret.json',filename:'Atlas.json'});
send({type:'nc-atlas:download',version:1,url:'blob:https://intruder.test/blob',filename:'Atlas.json'});
send({type:'nc-atlas:download',version:1,url:'blob:http://crew.test/blob',filename:'../../secret.json'});await h.flush();assert.equal(fetches.length,0);
send({type:'nc-atlas:download',version:1,url:'blob:http://crew.test/child',filename:'NightCity_Atlas_2020.json'});await h.flush();await new Promise(resolve=>process.nextTick(resolve));await h.flush();
assert.deepEqual(fetches,['blob:http://crew.test/child']);assert.deepEqual(downloads,[{url:'blob:http://crew.test/parent-copy',name:'NightCity_Atlas_2020.json'}]);assert(messages.some(([data])=>data.type==='nc-crew:download-complete'&&data.url==='blob:http://crew.test/child'));
URL.createObjectURL=createObjectURL;
send({type:'nc-atlas:selection',version:1,id:'area',name:'Место',district:'Центр',epoch:2020,canonical:true,sourceCode:null,positionBasis:'source-plan'});assert.equal(selections.length,1);
h.update({...props,suspended:true});assert(!h.find(n=>n.type==='iframe'),'Battle can cover the atlas without unmounting its editor');assert(iframe());h.update(props);assert.equal(iframe().props.ref.current.contentWindow,source);assert.equal(messages.at(-1)[0].type,'nc-crew:resume','Returning from battle explicitly refreshes map viewport without recreating its state');
iframe().props.onError();h.render();await h.flush();await h.click('Повторить загрузку');assert(h.text().includes('Перезагрузить карту?'),'Retry cannot silently discard a dirty editor');await h.click('Остаться');assert.equal(iframe().props.ref.current.contentWindow,source);await back();assert(h.text().includes('Вернуться из карты?'));assert.equal(exits,0);await h.click('Остаться');assert(!h.find(n=>n.props.role==='dialog'));await back();await h.click('Закрыть карту');assert.equal(exits,1);h.dispose();
console.log('Atlas host: strict origin/source/version boundary, campaign context, themed ready handoff, native Back draft delegation, suspended iframe retention and failed-frame exit confirmation passed. No pixel claim.');
