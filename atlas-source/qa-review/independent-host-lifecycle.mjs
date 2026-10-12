import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,moduleUrl,transpile} from '../../web-source/scripts/ux-hook-harness.mjs';
const env=installEnvironment(),h=createHarness(),media=new EventTarget();
env.window.location={origin:'https://crew.example'};env.window.matchMedia=()=>media;media.matches=false;env.document.hidden=false;
Object.assign(env.document.documentElement.dataset,{palette:'carmine',treatment:'printed',digital:'on',playerMotion:'on'});
globalThis.__independentReact={...h.React,useLayoutEffect:h.React.useEffect};
const react=moduleUrl('const r=globalThis.__independentReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect,useLayoutEffect=r.useLayoutEffect;');
const help=moduleUrl('export const usePlayerSettings=()=>({animations:true});');
const style=moduleUrl(transpile(await readFile(new URL('../../web-source/lib/interface-style.ts',import.meta.url),'utf8')));
const nav=moduleUrl(transpile((await readFile(new URL('../../web-source/lib/native-navigation.ts',import.meta.url),'utf8')).replace("from 'react'",`from '${react}'`)));
const source=(await readFile(new URL('../../web-source/components/city-atlas.tsx',import.meta.url),'utf8')).replace("from 'react'",`from '${react}'`).replace("from '@/components/player-help'",`from '${help}'`).replace("from '@/lib/interface-style'",`from '${style}'`).replace("from '@/lib/native-navigation'",`from '${nav}'`);
const {CityAtlas}=await import(moduleUrl(transpile(source)));
const owner={postMessage(){}},child=new EventTarget();
const opening=()=>h.find(n=>n.props.className==='nc-atlas-opening',false);
const props={campaignId:42,campaignName:'Review',isGM:true,onExit(){}};
h.mount(CityAtlas,props);Object.assign(h.find(n=>n.type==='iframe',false).props.ref.current,{contentWindow:owner,contentDocument:child});
const ready=new Event('message');Object.defineProperties(ready,{origin:{value:'https://crew.example'},source:{value:owner},data:{value:{type:'nc-atlas:ready',version:1}}});env.window.dispatchEvent(ready);h.render();assert(opening());
// pagehide is a lifecycle gate in its own right; do not assume an earlier
// visibilitychange notification exists in a WebView/bfcache transition.
const pagehide=new Event('pagehide');Object.defineProperty(pagehide,'persisted',{value:true});env.window.dispatchEvent(pagehide);h.render();
assert.equal(opening(),undefined,'Persisted pagehide must remove the active Crew entry cue');
env.window.dispatchEvent(new Event('pageshow'));h.render();assert.equal(opening(),undefined,'Restoring the same document must not replay the entry cue');
h.dispose();assert.equal(env.timers.size,0);console.log('Independent host pagehide/pageshow cleanup passed.');
