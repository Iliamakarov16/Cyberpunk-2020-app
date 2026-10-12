import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const projectRoot=fileURLToPath(new URL('..',import.meta.url));

const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
export const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
export const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText;

export function installEnvironment(){
 const window=new EventTarget(),document=new EventTarget(),storage=new Map([['nc20.interface.v1',JSON.stringify({bootEnabled:false})]]),timers=new Map();let nextTimer=1;
 const timer=fn=>{const id=nextTimer++;timers.set(id,fn);return id;};
 Object.assign(window,{setInterval:timer,clearInterval:id=>timers.delete(id),setTimeout:timer,clearTimeout:id=>timers.delete(id),scrollTo(){}});
 Object.assign(document,{querySelector:()=>null,visibilityState:'visible',documentElement:{dataset:{}},body:{style:{overflow:''},appendChild(){}},createElement:()=>({click(){},remove(){}}),modelContext:null});
 Object.assign(globalThis,{window,document,setTimeout:timer,clearTimeout:id=>timers.delete(id),setInterval:timer,clearInterval:id=>timers.delete(id),requestAnimationFrame:fn=>{fn();return nextTimer++;},cancelAnimationFrame(){}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{}},onLine:true}});
 return {window,document,storage,timers};
}

export function createHarness(){
 const components=new Map(),inputNodes=new Map();let scope=null,pending=[],visited=new Set(),inputVisited=new Set(),rootComponent,rootProps,tree,changed=false,renderNumber=0;
 const nextHook=()=>{const record=components.get(scope.key);return [record,scope.cursor++];};
 const sameDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const React={
  Fragment:'harness-fragment',
  createElement(type,props,...children){return {type,props:{...(props||{}),children}};},
  useState(initial){const [record,index]=nextHook();if(!(index in record.hooks)){const hook={kind:'state',value:typeof initial==='function'?initial():initial};hook.set=value=>{if(!record.mounted)return;const next=typeof value==='function'?value(hook.value):value;if(!Object.is(next,hook.value)){hook.value=next;changed=true;}};record.hooks[index]=hook;}const hook=record.hooks[index];return [hook.value,hook.set];},
  useRef(initial){const [record,index]=nextHook();if(!(index in record.hooks))record.hooks[index]={kind:'ref',value:{current:initial}};return record.hooks[index].value;},
  useMemo(fn,deps){const [record,index]=nextHook();if(!(index in record.hooks)||!sameDeps(record.hooks[index].deps,deps))record.hooks[index]={kind:'memo',value:fn(),deps};return record.hooks[index].value;},
  useCallback(fn,deps){return React.useMemo(()=>fn,deps);},
  useEffect(fn,deps){const [record,index]=nextHook();let hook=record.hooks[index];if(!hook){hook={kind:'effect',deps:undefined,cleanup:null};record.hooks[index]=hook;}if(!sameDeps(hook.deps,deps)){hook.deps=deps;pending.push(()=>{hook.cleanup?.();hook.cleanup=fn()||null;});}},
  useId(){return React.useMemo(()=>`harness-id-${scope.key.replace(/[^\w]/g,'-')}`,[]);},
 };
 function materialize(node,path='root',hidden=false,tabValue){
  if(node==null||typeof node!=='object')return node;
  if(Array.isArray(node))return node.map((item,index)=>materialize(item,path+'/'+(item?.props?.key??index),hidden,tabValue));
  if(typeof node.type==='function'){
   const key=path+'/'+node.type.name+':'+(node.props.key??'');visited.add(key);
   let record=components.get(key);if(!record){record={hooks:[],mounted:true};components.set(key,record);}record.mounted=true;
   const previous=scope;scope={key,cursor:0};const rendered=node.type(node.props);scope=previous;
   return materialize(rendered,path+'/content',hidden,tabValue);
  }
  hidden=hidden||!!node.props.hidden;
  if(node.type==='harness-tabs')tabValue=node.props.value;
  if(node.type==='harness-tab-content'&&tabValue!==node.props.value)hidden=true;
  if(node.props.ref&&typeof node.props.ref==='object'){
   let host=['input','iframe'].includes(node.type)?inputNodes.get(path):null;
   if(!host)host={value:'',style:{setProperty(name,value){this[name]=value;},removeProperty(name){const previous=this[name]||'';delete this[name];return previous;}},selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollTo(){},focus(options){document.activeElement=this;this.focusOptions=options;},setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},querySelector(){return null;},querySelectorAll(){return [];},scrollIntoView(){}};
   Object.assign(host,{closest:()=>hidden?{}:null,getBoundingClientRect:()=>window.__motionTestRect??{left:0,top:64,right:390,bottom:1400,width:390,height:1336},getClientRects:()=>hidden?[]:[{}]});
   if(['input','iframe'].includes(node.type)){inputVisited.add(path);inputNodes.set(path,host);}
   node.props.ref.current=host;
  }
  return {...node,hidden,props:{...node.props,children:materialize(node.props.children,path+'/children',hidden,tabValue)}};
 }
 function render(){
  for(let cycle=0;cycle<60;cycle++){
   changed=false;visited=new Set();inputVisited=new Set();pending=[];renderNumber++;
   tree=materialize({type:rootComponent,props:{...rootProps,children:[]}});
   for(const [key,record] of components){if(!visited.has(key)&&record.mounted){record.mounted=false;for(const hook of record.hooks)if(hook?.kind==='effect')hook.cleanup?.();components.delete(key);}}
   for(const path of inputNodes.keys())if(!inputVisited.has(path))inputNodes.delete(path);
   const effects=pending;pending=[];for(const effect of effects)effect();
   if(!changed)return tree;
  }
  throw new Error('Hook harness exceeded 60 synchronous render cycles');
 }
 async function flush(){for(let index=0;index<14;index++){await Promise.resolve();render();}return tree;}
 function mount(component,props={}){rootComponent=component;rootProps=props;return render();}
 function update(props){rootProps=props;return render();}
 function dispose(){for(const record of components.values()){record.mounted=false;for(const hook of record.hooks)if(hook?.kind==='effect')hook.cleanup?.();}components.clear();inputNodes.clear();}
 function nodes(node=tree,result=[],visible=true){const visit=value=>{if(value==null||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)visit(item);return;}if(visible&&value.hidden)return;result.push(value);visit(value.props.children);};visit(node);return result;}
 function text(node=tree,visible=true){const visit=value=>{if(value==null||typeof value==='boolean')return '';if(typeof value!=='object')return String(value);if(Array.isArray(value))return value.map(visit).join(' ');if(visible&&value.hidden)return '';return visit(value.props.children);};return visit(node);}
 const find=(predicate,visible=true)=>nodes(tree,[],visible).find(predicate);
 const buttons=()=>nodes().filter(node=>node.type==='button');
 function button(label){return buttons().find(node=>text(node).replace(/\s+/g,' ').includes(label)||node.props['aria-label']===label);}
 async function click(label){const node=typeof label==='string'?button(label):label;if(!node)throw new Error(`Missing button: ${label}`);if(node.props.disabled)throw new Error(`Disabled button: ${text(node)}`);const result=node.props.onClick?.({preventDefault(){}});render();await result;return flush();}
 return {React,mount,update,render,flush,dispose,nodes,text,find,buttons,button,click,get tree(){return tree;},get renderNumber(){return renderNumber;}};
}

export async function loadModules(harness,root=projectRoot,options={}){
 globalThis.__uxHarnessReact=harness.React;
 const fakeReact=moduleUrl('const r=globalThis.__uxHarnessReact;export default r;export const useState=r.useState,useRef=r.useRef,useMemo=r.useMemo,useCallback=r.useCallback,useEffect=r.useEffect,useLayoutEffect=r.useEffect,useId=r.useId;export const memo=c=>c;');
 const sources=new Map();for(const path of ['app/tracker.tsx','components/character-exterior.tsx','components/campaign-hub.tsx','components/campaign-terminal.tsx','components/battle-board.tsx','components/battle-editor.tsx','components/campaign-demo.tsx','components/learning-center.tsx','components/ip-lesson.tsx','components/start-menu.tsx','components/account-recovery.tsx','components/record-shell.tsx'])sources.set(path,await readFile(root+'/'+path,'utf8'));
 if(options.actualSharedBattle){sources.set('components/shared-battle.tsx',await readFile(root+'/components/shared-battle.tsx','utf8'));for(const name of ['BattleApp','CombatFeedback','NetControls'])sources.set('components/battle/'+name+'.jsx',await readFile(root+'/components/battle/'+name+'.jsx','utf8'));}
 if(options.actualTransfer)sources.set('components/transfer-panel.tsx',await readFile(root+'/components/transfer-panel.tsx','utf8'));
 if(options.actualWardrobe)sources.set('components/paper-doll.tsx',await readFile(root+'/components/paper-doll.tsx','utf8'));
 const iconNames=new Set();for(const source of sources.values()){const match=source.match(/import\s*\{([^}]+)\}\s*from ['"]lucide-react['"]/);if(match)for(const name of match[1].split(',').map(value=>value.trim()))if(!name.startsWith('type '))iconNames.add(name);}
 const fakeIcons=moduleUrl([...iconNames].map(name=>`export const ${name}=props=>({type:'svg',props:{...props,children:[]}});`).join('\n'));
 const pass=name=>`export const ${name}=props=>({type:'harness-${name}',props});`;
 const uiNames=['Sheet','SheetContent','SheetHeader','SheetTitle','SheetDescription','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription','AlertDialog','AlertDialogContent','AlertDialogHeader','AlertDialogTitle','AlertDialogDescription','AlertDialogFooter','AlertDialogCancel','AlertDialogAction'];
 const ui=moduleUrl(uiNames.map(name=>['Sheet','Dialog','AlertDialog'].includes(name)?`export const ${name}=props=>props.open?({type:'harness-${name}',props}):null;`:name==='AlertDialogAction'||name==='AlertDialogCancel'?`export const ${name}=props=>({type:'button',props});`:pass(name)).join('\n'));
 const tabs=moduleUrl("export const Tabs=props=>({type:'harness-tabs',props});export const TabsContent=props=>({type:'harness-tab-content',props});export const TabsList=props=>({type:'div',props});export const TabsTrigger=props=>({type:'button',props});");
 const help=moduleUrl("export const HelpProvider=props=>({type:'harness-help-provider',props});export const PlayerField=props=>({type:'harness-field',props:{...props,'data-label':props.label}});export const usePlayerSettings=()=>({hints:true,tutorial:true,animations:false});export const HelpHint=()=>null,Guidance=()=>null,SectionTutorial=()=>null,HelpCenter=()=>null,SettingsPanel=props=>({type:'harness-settings',props});");
 const generic=moduleUrl("export default props=>({type:'harness-external',props});export const IllustratedIcon=()=>null;");
 const motion=moduleUrl("export default props=>({type:'harness-motion',props});export const RegistryMarks=props=>({type:'harness-registry',props});");
 const network=moduleUrl("export const CLIENT_API_VERSION=1;export default props=>({type:'harness-network',props});");
 const learning=moduleUrl("export default props=>({type:'harness-learning',props});");
 const guided=moduleUrl("export const startTutorial=id=>globalThis.window.dispatchEvent(new CustomEvent('nightcity-start-tutorial',{detail:{id}}));export default props=>({type:'harness-tutorial',props});");
 const creation=moduleUrl("export default props=>({type:'harness-creation',props});");
 const battleLib=moduleUrl(transpile(await readFile(root+'/lib/battle.ts','utf8')));
 const exteriorModel=moduleUrl(transpile(await readFile(root+'/lib/character-appearance.ts','utf8')));
 const trackerLib=moduleUrl(transpile((await readFile(root+'/lib/tracker.ts','utf8')).replace("from './character-appearance'",`from '${exteriorModel}'`)));
 const settingsLib=moduleUrl(transpile(await readFile(root+'/lib/player-settings.ts','utf8')));
 const versionLib=moduleUrl(transpile(await readFile(root+'/lib/app-version.ts','utf8')));
 const appearanceLib=moduleUrl(transpile(await readFile(root+'/lib/interface-style.ts','utf8')));
 const boot=moduleUrl("export default props=>({type:'harness-deck-connection',props:{...props,children:props.autoContinue?[]:[{type:'button',props:{type:'button',disabled:!props.ready||!!props.error,onClick:props.onContinue,children:[props.continueLabel||'Войти в досье']}}]}});");
 const wardrobe=moduleUrl("export const SLOT_ART={};export const wornInSlot=()=>[];");
 const catalog=moduleUrl("export const catalogDescription=row=>row.description||'';export const catalogSource=row=>row.source||'';");
 const validation=moduleUrl("export const armorDraftError=()=>null;");
 const modules=new Map([
  ['react',fakeReact],['lucide-react',fakeIcons],['@/lib/battle',battleLib],['@/lib/tracker',trackerLib],['@/lib/player-settings',settingsLib],['@/lib/wardrobe',wardrobe],['@/lib/catalog',catalog],['@/lib/editor-validation',validation],
  ['@/components/player-help',help],['@/components/interface-motion',motion],['@/components/network-status',network],['@/components/learning-center',learning],['@/components/guided-tutorial',guided],['@/components/guided-creation',creation],['@/components/ui/tabs',tabs],['@/lib/interface-style',appearanceLib],['@/lib/app-version',versionLib],['@/components/deck-connection',boot],
 ]);
 function compile(source){return moduleUrl(transpile(source.replace(/import ['"][^'"]+\.css['"];?/g,'').replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from '${modules.get(name)||(name.includes('/ui/')?ui:generic)}'`)));}
 if(options.actualMotion){
  const motionHelp=moduleUrl("export const HelpProvider=props=>{globalThis.__uxHarnessMotionPreferences=props.value;return {type:'harness-help-provider',props};};export const PlayerField=props=>({type:'harness-field',props:{...props,'data-label':props.label}});export const usePlayerSettings=()=>globalThis.__uxHarnessMotionPreferences;export const HelpHint=()=>null,Guidance=()=>null,SectionTutorial=()=>null,HelpCenter=()=>null,SettingsPanel=props=>({type:'harness-settings',props});");
  modules.set('@/components/player-help',motionHelp);
  modules.set('@/components/interface-motion',compile(await readFile(root+'/components/interface-motion.tsx','utf8')));
 }
 if(options.actualDeck){
  modules.set('@/lib/loading-rhythm',compile(await readFile(root+'/lib/loading-rhythm.ts','utf8')));
  modules.set('@/components/deck-connection',compile(await readFile(root+'/components/deck-connection.tsx','utf8')));
 }
 if(options.actualWardrobe){
  modules.set('@/lib/wardrobe',compile(await readFile(root+'/lib/wardrobe.ts','utf8')));
  modules.set('@/lib/catalog-visuals',compile(await readFile(root+'/lib/catalog-visuals.ts','utf8')));
  modules.set('@/components/paper-doll',compile(sources.get('components/paper-doll.tsx')));
 }
 if(options.actualTransfer)modules.set('@/components/transfer-panel',compile(sources.get('components/transfer-panel.tsx')));
 modules.set('@/lib/native-navigation',compile(await readFile(root+'/lib/native-navigation.ts','utf8')));
 modules.set('@/components/city-atlas',options.actualAtlas?compile(await readFile(root+'/components/city-atlas.tsx','utf8')):moduleUrl("export const CityAtlas=props=>({type:'harness-city-atlas',props});"));
 modules.set('@/components/battle-invitations',options.actualInvitations?compile(await readFile(root+'/components/battle-invitations.tsx','utf8')):moduleUrl('export default ()=>null;'));
 if(options.actualSharedBattle){
  modules.set('@/lib/battle-transfer',moduleUrl(transpile(await readFile(root+'/lib/battle-transfer.ts','utf8'))));
  const sceneModule=moduleUrl(await readFile(root+'/lib/firefight/scene.mjs','utf8'));
  modules.set('@/lib/firefight/scene.mjs',sceneModule);modules.set('./scene.mjs',sceneModule);
  const actorAppearances=compile(await readFile(root+'/lib/firefight/appearances.mjs','utf8'));
  modules.set('@/lib/firefight/appearances.mjs',actorAppearances);modules.set('./firefight/appearances.mjs',actorAppearances);
  modules.set('./tracker',trackerLib);
  modules.set('@/lib/shared-battle',compile(await readFile(root+'/lib/shared-battle.ts','utf8')));
  modules.set('@/lib/firefight/props.mjs',moduleUrl(await readFile(root+'/lib/firefight/props.mjs','utf8')));
  modules.set('@/lib/firefight/heading.mjs',moduleUrl(await readFile(root+'/lib/firefight/heading.mjs','utf8')));
  modules.set('@/lib/firefight/event-queue.mjs',moduleUrl(await readFile(root+'/lib/firefight/event-queue.mjs','utf8')));
  modules.set('@/lib/firefight/display.mjs',compile(await readFile(root+'/lib/firefight/display.mjs','utf8')));
  modules.set('@/lib/firefight/net.mjs',compile(await readFile(root+'/lib/firefight/net.mjs','utf8')));
  modules.set('@/lib/firefight/audio.mjs',moduleUrl("export class BattleAudio {shot(){globalThis.__battleShots=(globalThis.__battleShots||0)+1;}dispose(){}}"));
  modules.set('@/lib/firefight/renderer.mjs',moduleUrl("export class BattleRenderer { constructor(canvas,onPick){globalThis.__battleRenderers=(globalThis.__battleRenderers||0)+1;globalThis.__battlePick=onPick;}setData(data,effect){globalThis.__battleRendered=data;globalThis.__battleEffectCalls?.push(effect?structuredClone(effect):null);}dispose(){}zoom(){}fit(){}center(){}}"));
  modules.set('./Dialog',ui);modules.set('@/components/battle/Dialog',ui);
  modules.set('@/components/ui/switch',moduleUrl("export const Switch=props=>({type:'input',props:{...props,type:'checkbox',onChange:e=>props.onCheckedChange(e.target.checked)}});"));
  modules.set('@/components/ui/select',moduleUrl("export const Select=props=>({type:'harness-select',props});export const SelectContent=props=>({type:'harness-select-content',props});export const SelectItem=props=>({type:'harness-select-item',props});export const SelectTrigger=props=>({type:'harness-select-trigger',props});export const SelectValue=()=>null;"));
  modules.set('@/lib/firefight/training-loadout.mjs',moduleUrl(await readFile(root+'/lib/firefight/training-loadout.mjs','utf8')));
  modules.set('./TrainingLoadoutSetup',compile(await readFile(root+'/components/battle/TrainingLoadoutSetup.jsx','utf8')));
  modules.set('./CoverProfileEditor',compile(await readFile(root+'/components/battle/CoverProfileEditor.jsx','utf8')));
  modules.set('./CombatAdjudication',compile(await readFile(root+'/components/battle/CombatAdjudication.jsx','utf8')));
  for(const name of ['CombatFeedback','NetControls'])modules.set('./'+name,compile(sources.get('components/battle/'+name+'.jsx')));
  modules.set('@/components/battle/BattleApp',compile(sources.get('components/battle/BattleApp.jsx')));
  modules.set('@/components/battle/SceneTools',compile(await readFile(root+'/components/battle/SceneTools.tsx','utf8')));
  modules.set('@/components/battle/LoadoutEditor',compile(await readFile(root+'/components/battle/LoadoutEditor.tsx','utf8')));
  modules.set('@/components/shared-battle',compile(sources.get('components/shared-battle.tsx')));
 }

 modules.set('@/components/record-shell',compile(sources.get('components/record-shell.tsx')));
 modules.set('@/components/account-recovery',compile(sources.get('components/account-recovery.tsx')));
 modules.set('@/components/signal-type',compile(await readFile(root+'/components/signal-type.tsx','utf8')));
 modules.set('@/components/appearance-settings',compile(await readFile(root+'/components/appearance-settings.tsx','utf8')));
 modules.set('@/lib/character-appearance',exteriorModel);
 modules.set('@/lib/portrait-frame',compile(await readFile(root+'/lib/portrait-frame.ts','utf8')));
 const exteriorUrl=compile(sources.get('components/character-exterior.tsx'));modules.set('@/components/character-exterior',exteriorUrl);modules.set('./character-exterior',exteriorUrl);
 const accessUrl=compile(await readFile(root+'/components/character-access.tsx','utf8'));modules.set('@/components/character-access',accessUrl);
 const boardUrl=compile(sources.get('components/battle-board.tsx'));modules.set('@/components/battle-board',boardUrl);modules.set('./battle-board',boardUrl);
 const boardEditorUrl=compile(sources.get('components/battle-editor.tsx'));modules.set('@/components/battle-editor',boardEditorUrl);
 const terminalUrl=compile(sources.get('components/campaign-terminal.tsx'));modules.set('@/components/campaign-terminal',terminalUrl);
 const demoModel=compile(await readFile(root+'/lib/campaign-demo.ts','utf8'));modules.set('@/lib/campaign-demo',demoModel);
 const demoUrl=compile(sources.get('components/campaign-demo.tsx'));modules.set('@/components/campaign-demo',demoUrl);
 if(options.actualLearning){modules.set('@/components/ip-lesson',compile(sources.get('components/ip-lesson.tsx')));modules.set('@/components/training-lab',moduleUrl("export const TrainingLab=props=>({type:'harness-training',props});"));modules.set('@/components/learning-center',compile(sources.get('components/learning-center.tsx')));}
 const hubUrl=compile(sources.get('components/campaign-hub.tsx'));modules.set('@/components/campaign-hub',hubUrl);
 modules.set('@/components/start-menu',compile(sources.get('components/start-menu.tsx')));
 const trackerUrl=compile(sources.get('app/tracker.tsx')+(options.accountForms?'\nexport { AccountForm, PasswordField };':''));
 const [Tracker,CampaignHub,CampaignTerminal,BattleBoard,BattleEditor,CampaignDemo,lib]=await Promise.all([import(trackerUrl),import(hubUrl),import(terminalUrl),import(boardUrl),import(boardEditorUrl),import(demoUrl),import(trackerLib)]);
 return {...(options.actualTransfer?{TransferPanel:(await import(modules.get('@/components/transfer-panel'))).default}:{}),...(options.actualAtlas?{CityAtlas:(await import(modules.get('@/components/city-atlas'))).CityAtlas}:{}),...(options.actualInvitations?{BattleInvitations:(await import(modules.get('@/components/battle-invitations'))).default}:{}),...(options.actualSharedBattle?{BattleApp:(await import(modules.get('@/components/battle/BattleApp'))).default,SharedBattle:(await import(modules.get('@/components/shared-battle'))).default,sharedBattleLib:await import(modules.get('@/lib/shared-battle'))}:{}),...(options.actualMotion?{MotionSurface:(await import(modules.get('@/components/interface-motion'))).default}:{}),...(await import(exteriorUrl)),CharacterAccess:(await import(accessUrl)).default,Tracker:Tracker.default,CampaignHub:CampaignHub.default,CampaignTerminal:CampaignTerminal.default,BattleBoard:BattleBoard.default,BattleEditor:BattleEditor.default,CampaignDemo:CampaignDemo.default,...(options.accountForms?{AccountForm:Tracker.AccountForm,PasswordField:Tracker.PasswordField}:{}),...lib};
}
