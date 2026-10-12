import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHarness,installEnvironment,loadModules,moduleUrl,transpile} from './ux-hook-harness.mjs';

const style=await import(moduleUrl(transpile(await readFile(new URL('../lib/interface-style.ts',import.meta.url),'utf8'))));
assert.deepEqual(style.interfaceStyle({palette:'bogus',treatment:'bogus',digital:'false',bootVariant:'bogus'}),style.DEFAULT_INTERFACE_STYLE);
assert.equal(style.interfaceStyle({bootEnabled:false,digital:false}).bootEnabled,false);
const legacy=new Map([['nc20.dossier.appearance.v1',JSON.stringify({palette:'maelstrom',treatment:'clean',digital:false})],['nc20.dossier.boot.v1','"signature"']]);
assert.deepEqual(style.readInterfaceStyle({getItem:key=>legacy.get(key)||null}),{palette:'maelstrom',treatment:'clean',digital:false,bootVariant:'signature',bootEnabled:true});
const init=await readFile(new URL('../public/appearance-init.js',import.meta.url),'utf8');
for(const value of [null,'{',JSON.stringify({palette:'amber',treatment:'raw',digital:false}),JSON.stringify({palette:'injected',treatment:'injected',digital:'on'})]){
 const dataset={palette:'carmine',treatment:'printed',digital:'on'};
 vm.runInNewContext(init,{document:{documentElement:{dataset}},localStorage:{getItem:key=>key===style.STYLE_KEY?value:null}});
 const expected=style.readInterfaceStyle({getItem:key=>key===style.STYLE_KEY?value:null});
 assert.deepEqual(dataset,{palette:expected.palette,treatment:expected.treatment,digital:expected.digital?'on':'off'});
}

const env=installEnvironment(),h=createHarness();
const media=new EventTarget();media.matches=false;env.window.matchMedia=()=>media;
env.document.hidden=false;env.window.innerWidth=390;env.window.innerHeight=780;
env.window.scrollX=0;env.window.scrollY=0;env.window.getComputedStyle=()=>({position:'fixed'});
env.document.querySelector=()=>null;env.document.querySelectorAll=()=>[];
const transitions=()=>h.nodes(h.tree,[],false).filter(node=>node.props?.className?.startsWith('nc-transition '));
const finishTransition=()=>{for(const node of transitions()){const element={};node.props.onAnimationEnd({target:element,currentTarget:element});}h.render();};
const completeGate=async()=>{const gate=h.find(node=>node.type==='harness-deck-connection');assert(gate?.props.autoContinue&&gate.props.ready&&!gate.props.error);assert(!h.button('Войти в досье'),'Automatic startup has no second entry button');gate.props.onContinue();h.render();await h.flush();};
env.storage.set(style.STYLE_KEY,JSON.stringify({...style.DEFAULT_INTERFACE_STYLE,bootVariant:'stream'}));
const {Tracker,blank}=await loadModules(h,undefined,{actualMotion:true});
const character={id:21,owner_id:2,owner:'Adam',version:1,updated:100,data:blank('Вега','Фиксер'),can_edit:true};
const requests=[];let resolveCharacters;
globalThis.fetch=async(path,options={})=>{
 requests.push({path,method:options.method||'GET'});
 const result=path==='/api/me'?{id:2,username:'Adam',role:'player',csrf:'token',platform:true}:path==='/api/settings'?{hints:false,tutorial:false,animations:true}:path==='/api/characters'?await new Promise(resolve=>{resolveCharacters=resolve;}):path==='/api/campaigns'?[]:null;
 assert.notEqual(result,null,`Unexpected ${path}`);return new Response(JSON.stringify(result),{status:200});
};
h.mount(Tracker,{platformAuth:false});await h.flush();
let gate=h.find(node=>node.type==='harness-deck-connection');
assert(gate,'Authenticated data preparation opens the real connection gate');
assert.equal(gate.props.ready,false);assert.equal(gate.props.variant,'stream');assert(!h.find(node=>node.props['aria-label']==='Главное меню'),'Menu cannot be used while data is pending');
assert(!h.find(node=>node.type==='harness-tutorial',false)?.props.enabled);
resolveCharacters([character]);await h.flush();
assert.equal(h.find(node=>node.type==='harness-deck-connection').props.ready,true);
await completeGate();assert(h.find(node=>node.props['aria-label']==='Главное меню'));
assert(!h.find(node=>node.type==='harness-deck-connection'));
assert.equal(transitions().length,1,'Normal entry starts the actual 760ms release after revealing its hidden ancestor');
assert.equal(h.find(node=>node.props?.className==='nc-motion-surface nc-motion-global').props['data-entry-arrival'],'on');
assert.equal(h.nodes().filter(node=>node.props?.className==='nc-data-tile').length,20);
assert.equal(h.find(node=>node.props?.className==='nc-registry-marks').props['aria-hidden'],'true');
assert.equal(h.find(node=>node.props?.className==='nc-registry-marks').props['data-moving'],'on');
finishTransition();assert.equal(transitions().length,0);
await h.click(h.find(node=>node.props['data-tour']==='nav-personal'));await h.click('Вега');await h.click('Увеличить ранения на один');
assert(h.find(node=>node.props.className==='savebar nc-savebar-compact'),'A dirty sheet exposes the compact save controls');
await h.click(h.find(node=>node.props['aria-label']==='Аккаунт'));await h.click('Оформление и настройки');
const before=requests.length;
const palette=h.find(node=>node.type==='input'&&node.props.value==='ultraviolet');palette.props.onChange();h.render();await h.flush();
assert.equal(env.document.documentElement.dataset.palette,'ultraviolet');
assert.equal(JSON.parse(env.storage.get(style.STYLE_KEY)).palette,'ultraviolet');
assert.equal(requests.length,before,'Device appearance never writes to campaign/character/settings API');
assert(h.find(node=>node.props.className?.includes('nc-dossier-heading'),false),'The dirty sheet remains mounted behind settings');
await h.click('Посмотреть загрузку');assert(h.find(node=>node.type==='harness-deck-connection'));
assert(!h.find(node=>node.props.className?.includes('nc-dossier-heading')));
await h.click('Вернуться к настройкам');assert(h.find(node=>node.props.className==='interface-appearance'),'Preview returns to appearance settings');assert.equal(transitions().length,0,'Returning from loader preview never plays a workspace-entry release');
h.find(node=>node.type==='harness-Sheet').props.onOpenChange(false);h.render();await h.flush();
assert(h.find(node=>node.props.className==='savebar nc-savebar-compact'),'Preview does not discard the dirty sheet');
assert.equal(requests.length,before,'Preview does not refetch account or mutate data');
h.dispose();

// A failed real data load must remain retryable; no visual completion grants access.
let failing=true;globalThis.fetch=async path=>new Response(JSON.stringify(path==='/api/me'?{id:2,username:'Adam',role:'player',csrf:'token'}:path==='/api/characters'?[character]:path==='/api/settings'?(failing?{error:'Данные временно недоступны'}:{animations:false}):[]),{status:path==='/api/settings'&&failing?503:200});
h.mount(Tracker,{platformAuth:false});await h.flush();
gate=h.find(node=>node.type==='harness-deck-connection');assert.equal(gate.props.ready,false);assert.equal(gate.props.error,'Данные временно недоступны');
failing=false;gate.props.onRetry();await h.flush();assert.equal(h.find(node=>node.type==='harness-deck-connection').props.ready,true);
await completeGate();assert(h.find(node=>node.props['aria-label']==='Главное меню'));assert.equal(transitions().length,0,'Disabled animation stays immediate after real data retry');
h.dispose();
env.storage.set(style.STYLE_KEY,JSON.stringify({...style.DEFAULT_INTERFACE_STYLE,bootEnabled:false}));
h.mount(Tracker,{platformAuth:false});await h.flush();
assert(h.find(node=>node.props['aria-label']==='Главное меню'),'Disabling the connection animation opens the prepared menu directly');assert.equal(transitions().length,0,'Disabled startup never adds an entrance layer');
await h.click('Настройки');
const bootSetting=h.find(node=>node.type==='label'&&h.text(node).includes('Пропускать загрузку'));
h.nodes(bootSetting).find(node=>node.type==='input').props.onChange({target:{checked:false}});h.render();await h.flush();
assert(!h.find(node=>node.type==='harness-deck-connection'),'Enabling future startup animation does not interrupt the current session');
h.dispose();
console.log('Interface entry: prepaint/storage validation and migration; actual data/error/retry gate; no hidden menu access; local theme persistence; preview returns to settings without API writes or losing draft passed.');

// Skip, reduced-motion and off ambient exercise the real root and surface together.
env.storage.set(style.STYLE_KEY,JSON.stringify(style.DEFAULT_INTERFACE_STYLE));
let prefs={animations:true,ambient:'quiet'};
globalThis.fetch=async path=>new Response(JSON.stringify(path==='/api/me'?{id:2,username:'Adam',role:'player',csrf:'token'}:path==='/api/characters'?[character]:path==='/api/settings'?prefs:[]),{status:200});
for(const mode of ['skip','reduced','animations-off']){
 media.matches=mode==='reduced';prefs={animations:mode!=='animations-off',ambient:'quiet'};
 h.mount(Tracker,{platformAuth:false});await h.flush();
 gate=h.find(node=>node.type==='harness-deck-connection');assert(gate);
 if(mode==='skip'){gate.props.onSkip();h.render();await h.flush();}else await completeGate();
 assert(h.find(node=>node.props['aria-label']==='Главное меню'));
 assert.equal(transitions().length,0,`${mode} opens directly without a second animation`);
 assert.equal(h.find(node=>node.props?.className==='nc-registry-marks').props['data-moving'],mode==='skip'?'on':'off');
 h.dispose();
}
media.matches=false;prefs={animations:true,ambient:'off'};
h.mount(Tracker,{platformAuth:false});await h.flush();await completeGate();
let marks=h.find(node=>node.props?.className==='nc-registry-marks');assert.equal(marks.props['data-moving'],'off');assert.equal(marks.props['data-ambient'],'off');
finishTransition();h.dispose();prefs={animations:true,ambient:'quiet'};h.mount(Tracker,{platformAuth:false});await h.flush();await completeGate();finishTransition();assert.equal(h.find(node=>node.props?.className==='nc-registry-marks').props['data-moving'],'on');env.document.hidden=true;env.document.dispatchEvent(new Event('visibilitychange'));h.render();
assert.equal(h.find(node=>node.props?.className==='nc-registry-marks',false).props['data-moving'],'off');
env.document.hidden=false;env.document.dispatchEvent(new Event('visibilitychange'));h.render();assert.equal(transitions().length,0,'Returning to the page never replays entrance');assert.equal(h.find(node=>node.props?.className==='nc-registry-marks').props['data-moving'],'on');media.matches=true;media.dispatchEvent(new Event('change'));h.render();assert.equal(h.find(node=>node.props?.className==='nc-registry-marks').props['data-moving'],'off','System motion reduction immediately stops registration marks');
h.dispose();
console.log('Real Tracker + MotionSurface: one normal entrance, immediate skip/reduced/off startup, preview draft retention, aria-hidden ambient gating and no return replay passed.');

const themeCSS=await readFile(new URL('../public/dossier-theme.css',import.meta.url),'utf8');
assert.match(themeCSS,/\.nc-dossier-heading\.character-heading \{display:grid;grid-template-columns:minmax\(0,1fr\) 5\.7rem/);
assert.match(themeCSS,/\.nc-dossier-portrait>\.avatar\.large \.character-portrait \{[^}]*object-fit:contain/);
assert.match(themeCSS,/\.nc-dossier-identity>\.nc-dossier-stat-rail \{grid-column:2;grid-row:3;[^}]*grid-template-rows:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(themeCSS,/@media\(max-width:23em\) \{[\s\S]*min-height:300px/);
assert.match(themeCSS,/\.nc-registry-marks \{[^}]*pointer-events:none/);
assert.match(themeCSS,/animation:nc-quiet-carrier 14s linear 2s infinite/);
assert.match(themeCSS,/animation:nc-packet-register 17s steps\(1,end\) 5s infinite/);
assert.match(themeCSS,/data-entry-arrival="on"[^}]*\.nc-type-fragment \{animation:nc-register-type/);
assert.doesNotMatch(themeCSS,/\.nc-type-source[^{}]*\{[^}]*animation/,'Readable source remains stationary');
console.log('CSS contracts: portrait-heavy dossier, 300px narrow fallback, contain artwork, 44px edits, decorative-only restrained ambient/arrival validated; pixels are not emulated.');
