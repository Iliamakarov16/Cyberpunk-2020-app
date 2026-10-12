import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

// UI chrome must inherit the same five dossier palettes. Tactical map artwork
// intentionally remains independent; this is not a browser pixel comparison.
const css=await readFile(new URL('../public/shared-battle.css',import.meta.url),'utf8');
const original=await readFile(new URL('../components/battle/battle.css',import.meta.url),'utf8');
assert.doesNotMatch(original,/(?:^|[}\n])\s*(?:html|body|:root)[\s,{]/,'Original fullscreen CSS must not affect ordinary pages');
assert.match(original,/\.nc-firefight \.scene-header\{background:var\(--nc-surface\)/);
assert.match(original,/\.nc-firefight \.battle-hud\{background:var\(--nc-surface\)/);
assert.match(original,/\.nc-battle-dialog-overlay\{[^}]*z-index:640/,'Game modals must sit above fullscreen map');
assert.match(original,/\.nc-firefight\.game-select-menu\{z-index:670/);
const dossier=await readFile(new URL('../public/dossier-theme.css',import.meta.url),'utf8');
assert.doesNotMatch(css,/#(?:[0-9a-f]{3,8})\b|\b(?:rgb|hsl)a?\(/i,'Battle chrome must not hard-code another palette');
for(const [,token] of css.matchAll(/var\((--[\w-]+)/g))assert(dossier.includes(token+':'),`Undefined shared theme token ${token}`);
assert.match(css,/\.nc-shared-battle\{[^}]*background:var\(--nc-ink\);color:var\(--nc-text\);font-family:inherit/);
assert.match(css,/button\.primary\{[^}]*background:var\(--nc-action\);color:var\(--nc-on-action\)/);

const env=installEnvironment(),h=createHarness();
const {Tracker,blank}=await loadModules(h,undefined,{actualSharedBattle:true});
const key='nc20.interface.v1';
const character={id:11,owner_id:2,owner:'Solo Tester',version:1,updated:100,data:blank('Тест','Соло'),can_edit:true};
const campaign={id:10,name:'Проверка оформления',description:'',gm_id:2,gm:'Solo Tester',version:1,updated:100,is_gm:true,is_member:true,transfer_to:null};
const requests=[];
const reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(path,config={})=>{
 assert(!config.method||config.method==='GET','Appearance/navigation must never mutate campaign or character data');requests.push(path);
 if(path==='/api/me')return reply({id:2,username:'Solo Tester',role:'player',csrf:'fixture',platform:false});
 if(path==='/api/settings')return reply({hints:false,tutorial:false,animations:false});
 if(path==='/api/characters')return reply([character]);
 if(path==='/api/campaigns')return reply([campaign]);
 if(path==='/api/campaigns/10')return reply({...campaign,roster:[]});
 if(path==='/api/campaigns/10/workspace')return reply({version:1,updated:100,is_gm:true,characters:[],data:{schemaVersion:1,contacts:[],messages:[],places:[],assets:[],scene:{id:'test',name:'Тест',active:false,targets:[],actions:[],log:[]}}});
 if(path==='/api/campaigns/10/battle')return reply({role:'gm',controlledActorIds:[],battle:null,options:{characters:[]}});
 throw new Error('Unexpected '+path);
};
for(const [i,palette] of ['carmine','ultraviolet','amber','maelstrom','original'].entries()){
 const appearance={palette,treatment:['clean','printed','raw'][i%3],digital:i%2===0,bootEnabled:false,bootVariant:['channel','stream','signature'][i%3]};
 const saved=JSON.stringify(appearance);env.storage.set(key,saved);
 const unchanged=()=>{assert.equal(env.storage.get(key),saved);assert.deepEqual(Object.fromEntries(['palette','treatment','digital'].map(k=>[k,env.document.documentElement.dataset[k]])),{palette,treatment:appearance.treatment,digital:appearance.digital?'on':'off'});};
 h.mount(Tracker,{platformAuth:false});await h.flush();unchanged();
 await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));await h.click(campaign.name);
 for(let pass=0;pass<2;pass++){
  await h.click(h.find(n=>n.props['data-campaign-shortcut']==='shared-battle'));
  assert(h.find(n=>n.props['aria-label']==='Совместный бой кампании'));unchanged();
  env.window.dispatchEvent(new Event('night-city-native-ready'));await h.flush();unchanged();
  await h.click('К кампании');unchanged();
 }
 h.dispose();h.mount(Tracker,{platformAuth:false});await h.flush();unchanged();h.dispose();
}
console.log('Battle appearance: no private chrome colors, all theme tokens defined; five palettes, texture/digital/boot settings retained across battle enter/exit/re-entry, native-ready event and page remount; no campaign writes. Pixel/device QA not emulated.');
