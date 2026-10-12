import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const projectRoot=process.env.NC_MOTION_PROJECT||fileURLToPath(new URL('..',import.meta.url));
const {createHarness,installEnvironment,moduleUrl,transpile}=await import(pathToFileURL(projectRoot+'/scripts/ux-hook-harness.mjs').href);

const env=installEnvironment(),h=createHarness();
const observers=new Set(),observedElements=new Set();
globalThis.MutationObserver=class {constructor(callback){this.callback=callback;observers.add(this);}observe(element){observedElements.add(element);}disconnect(){observers.delete(this);}};
const notifyAncestors=()=>{for(const observer of observers)observer.callback([]);h.render();};
const media=new EventTarget();media.matches=false;env.window.matchMedia=()=>media;
env.document.hidden=false;env.window.innerWidth=390;env.window.innerHeight=780;env.window.scrollX=0;env.window.scrollY=0;env.window.getComputedStyle=()=>({position:'fixed'});env.document.querySelector=()=>null;env.document.querySelectorAll=()=>[];
globalThis.__motionReact={...h.React,useLayoutEffect:h.React.useEffect};
globalThis.__motionPreferences={hints:true,tutorial:true,animations:true,ambient:'quiet'};
const react=moduleUrl('const r=globalThis.__motionReact;export default r;export const useState=r.useState,useEffect=r.useEffect,useLayoutEffect=r.useLayoutEffect,useRef=r.useRef;');
const help=moduleUrl('export const usePlayerSettings=()=>globalThis.__motionPreferences;');
const source=(await readFile(projectRoot+'/components/interface-motion.tsx','utf8')).replace("from 'react'",`from '${react}'`).replace("from '@/components/player-help'",`from '${help}'`);
// Geometry guards prevent the original full-screen, stretched-layer defect.
// They verify CSS contracts, not pixels or platform rendering.
const [legacyCSS,themeCSS]=await Promise.all([readFile(projectRoot+'/public/style.css','utf8'),readFile(projectRoot+'/public/dossier-theme.css','utf8')]);
const css=legacyCSS+'\n'+themeCSS;
const transitionRule=css.match(/\.nc-transition \{([^}]+)\}/)?.[1]??'';
assert.match(transitionRule,/position:fixed/,'Tiles use measured viewport coordinates, independent of document height');
assert.match(transitionRule,/pointer-events:none/,'Decorative tiles never intercept a tap');
assert.doesNotMatch(css.match(/\.nc-motion-content \{([^}]+)\}/)?.[1]??'',/z-index/,'Persistent fixed navigation must not be trapped below the tiles');
const ambientRule=css.match(/\.nc-ambient \{([^}]+)\}/)?.[1]??'';
assert.doesNotMatch(ambientRule,/animation|transition/,'Reading background remains stationary');
for(const rule of css.matchAll(/\.nc-ambient(?:::[\w-]+)?\s*\{([^}]+)\}/g))assert.doesNotMatch(rule[1],/animation|transition/,'Theme overrides do not add a looping background');
assert.match(themeCSS,/animation\s*:\s*nc-tile-release\s+var\(--nc-tile-duration\s*(?:,\s*460ms)?\)/,'The theme consumes the approved tile duration supplied by MotionSurface');
const keyframeStart=themeCSS.lastIndexOf('@keyframes nc-tile-release');
assert(keyframeStart>=0,'The theme supplies the B release sweep');
let depth=0,keyframeEnd=keyframeStart,opened=false;
for(;keyframeEnd<themeCSS.length;keyframeEnd++){if(themeCSS[keyframeEnd]==='{'){depth++;opened=true;}else if(themeCSS[keyframeEnd]==='}'&&--depth===0&&opened){keyframeEnd++;break;}}
const releaseKeyframe=themeCSS.slice(keyframeStart,keyframeEnd);
assert.match(releaseKeyframe,/clip-path\s*:\s*inset\(0 0 100% 0\)/,'Tiles open with the approved vertical sweep');
assert.doesNotMatch(releaseKeyframe,/scale\(/,'The new screen is revealed without shrinking slabs');
assert.doesNotMatch(source,/preserveAspectRatio|AmbientArt|TransitionArt/,'No stretched artwork');
assert.doesNotMatch(css,/\.nc-(?:scan-cover|shutter|signal-wave|transition-rail|network-cover)/,'Old waves and stretched masks are removed');
const {default:MotionSurface}=await import(moduleUrl(transpile(source)));
const React=globalThis.__motionReact;
function Field(){const ref=React.useRef(null);return React.createElement('input',{ref,name:'draft',defaultValue:'',autoComplete:'off'});}
function Fixture(props){return React.createElement('div',{hidden:props.hidden},React.createElement(MotionSurface,{theme:props.theme,navigationKey:props.route,entryRevision:props.entryRevision??0,enabled:props.enabled,fullscreen:true},React.createElement(MotionSurface,{theme:'signal',navigationKey:props.localRoute??'local',enabled:props.enabled},React.createElement(MotionSurface,{theme:'catalog',navigationKey:'nested',enabled:props.enabled},React.createElement(Field,{}),React.createElement('p',{},props.label)))));}
const surface=()=>h.find(n=>n.props?.className?.startsWith('nc-motion-surface'),false);
const transition=()=>h.find(n=>n.props?.className?.startsWith('nc-transition '),false);
const all=predicate=>h.nodes(h.tree,[],false).filter(predicate);
const backgrounds=()=>all(n=>n.props?.className==='nc-ambient');
const input=()=>h.find(n=>n.type==='input',false).props.ref.current;
let props={route:'sheet',theme:'bio',enabled:true,hidden:false,label:'Initial'};
const render=next=>{props={...props,...next};h.update(props);};
const finish=()=>{const n=transition();if(n){const element={};n.props.onAnimationEnd({target:element,currentTarget:element});h.render();}};
const navScope={};
const navigationTarget={closest:selector=>selector==='[data-motion-navigation]'?navScope:null};
const focus=target=>{surface().props.onFocusCapture({target,currentTarget:{contains:control=>control===navScope}});h.render();};
function SectionFixture({enabled=true}){
 const [section,setSection]=React.useState('sheet');
 return React.createElement(MotionSurface,{theme:section==='items'?'catalog':'bio',navigationKey:`character:001:${section}`,fullscreen:true,enabled,preserveFocusWithin:'[data-motion-navigation]'},
  React.createElement('nav',{'data-motion-navigation':true,'aria-label':'Разделы персонажа'},
   ...['sheet','items','implants'].map(value=>React.createElement('button',{key:value,'data-section':value,onMouseDown:()=>setSection(value),onFocus:()=>setSection(value)},value)),
   React.createElement('select',{'aria-label':'Раздел персонажа',value:section,onChange:event=>setSection(event.target.value)},...['sheet','items','implants'].map(value=>React.createElement('option',{key:value,value},value)))),
  React.createElement('section',{'data-open-section':section},React.createElement(Field,{})));
}

try{
 h.mount(Fixture,props);
 // The light harness recreates div host objects; observer hosts read live fixture visibility.
 for(const element of observedElements)element.closest=()=>props.hidden?{}:null;
 assert.equal(surface().props['data-moving'],'on');
 assert.equal(backgrounds().length,1,'Nested campaign and terminal surfaces cannot duplicate the viewport background');
 assert.equal(all(n=>n.type==='svg').length,0,'No artwork stretches across long content');
 assert.equal(transition(),undefined,'Initial mount does not introduce an unsolicited screen cover');
 const field=input();field.value='My unsaved draft';field.setSelectionRange(3,9,'backward');field.focus();
 const preserve=()=>{
  assert.equal(input(),field,'Decorative updates keep the mounted input');
  assert.equal(input().value,'My unsaved draft');
  assert.equal(env.document.activeElement,field,'Motion never steals focus');
  assert.deepEqual([field.selectionStart,field.selectionEnd,field.selectionDirection],[3,9,'backward']);
 };
 render({label:'Typed text and refreshed server version'});assert.equal(transition(),undefined);preserve();
 render({entryRevision:1});assert(transition(),'A prepared entry revision activates the reveal even when its route is unchanged');assert.equal(surface().props['data-entry-arrival'],'on');preserve();assert.equal(all(n=>n.props?.className==='nc-data-tile').length,20,'Entry keeps approved B geometry');finish();render({label:'Prepared entry stable'});assert.equal(transition(),undefined,'The consumed entrance never replays on a subsequent render');preserve();
 render({route:'items',theme:'catalog'});const first=transition();assert(first);assert.deepEqual([first.props.style.left,first.props.style.top,first.props.style.width,first.props.style.height],[0,64,390,716],'Tile bounds stop below the header and at the viewport edge');preserve();
 assert.equal(first.props['aria-hidden'],'true');
 assert.equal(first.props['data-kind'],'navigation');
 assert.equal(all(n=>n.props?.className==='nc-data-tile').length,0,'Navigation never replays the boot tile wall');
 assert.equal(all(n=>n.props?.className==='nc-panel-frame').length,1);
 assert.equal(all(n=>n.props?.className==='nc-panel-signal').length,1);
 assert.equal(env.timers.size,1);
 const firstTimer=[...env.timers.values()][0];
 assert.equal(first.props.style['--nc-motion-duration'],'220ms','Navigation has one short deck activation, not a loading wait');
 const content=all(n=>n.props?.className==='nc-motion-content');
 assert(content.every(n=>!n.props.hidden&&!n.props.inert&&!n.props['aria-hidden']&&!n.props.style&&!n.props.key),'Content stays readable, interactive and stationary');
 render({label:'Catalog search typed'});assert.equal(transition().props.key,first.props.key,'Editing does not restart the transition');preserve();
 render({route:'net',theme:'network'});assert(transition());assert.notEqual(transition().props.key,first.props.key);const latestKey=transition().props.key;assert.equal(env.timers.size,1,'Fast navigation cleans up the previous fallback');firstTimer();h.render();assert.equal(transition().props.key,latestKey,'Stale timer cannot remove the newer cue');const staleElement={};first.props.onAnimationEnd({target:staleElement,currentTarget:staleElement});h.render();assert.equal(transition().props.key,latestKey,'A stale animationend cannot clear the newer transition');preserve();
 finish();assert.equal(transition(),undefined);
 render({route:'tap-cancels'});assert(transition());surface().props.onPointerDownCapture();h.render();assert.equal(transition(),undefined,'A tap dismisses decoration immediately');preserve();
 render({route:'keys-cancel'});assert(transition());surface().props.onKeyDownCapture();h.render();assert.equal(transition(),undefined);preserve();
 render({route:'unscoped-focus-cancels'});assert(transition());focus(navigationTarget);assert.equal(transition(),undefined,'Without an explicit persistent navigation scope all focus still cancels');preserve();
 render({route:'tutorial-starts'});assert(transition());env.window.dispatchEvent(new CustomEvent('nightcity-start-tutorial',{detail:{id:'player-start'}}));h.render();assert.equal(transition(),undefined,'Starting guidance cancels motion');
 env.document.querySelector=selector=>selector.includes('tutorial')?{}:null;render({route:'tutorial-nav'});assert.equal(transition(),undefined,'Tutorial anchors remain unobscured');env.document.querySelector=()=>null;
 env.window.__motionTestRect={left:0,top:-800,right:390,bottom:600,width:390,height:1400};
 env.document.querySelectorAll=()=>[{closest:()=>null,getBoundingClientRect:()=>({top:550})}];
 render({route:'scrolled-sheet'});assert.deepEqual([transition().props.style.top,transition().props.style.height],[0,550],'Scrolled content stays visible while fixed bottom navigation is excluded');preserve();
 env.window.scrollY=5;env.window.dispatchEvent(new Event('scroll'));h.render();assert.equal(transition(),undefined,'Scrolling cancels stale measured geometry');
 render({route:'before-resize'});assert(transition());env.window.dispatchEvent(new Event('resize'));h.render();assert.equal(transition(),undefined,'Rotation cancels the old geometry');
 delete env.window.__motionTestRect;env.document.querySelectorAll=()=>[];



 // System changes take effect immediately and do not replay a consumed navigation.
 media.matches=true;media.dispatchEvent(new Event('change'));h.render();
 assert.equal(surface().props['data-moving'],'off');
 render({route:'notes',theme:'signal'});assert.equal(transition(),undefined);preserve();
 media.matches=false;media.dispatchEvent(new Event('change'));h.render();
 assert.equal(surface().props['data-moving'],'on');assert.equal(transition(),undefined);preserve();
 globalThis.__motionPreferences={...globalThis.__motionPreferences,animations:false,ambient:'vivid'};h.render();
 assert.equal(surface().props['data-moving'],'off');assert.equal(surface().props['data-ambient'],'vivid');assert.equal(backgrounds().length,1);assert.equal(transition(),undefined);preserve();
 globalThis.__motionPreferences={...globalThis.__motionPreferences,animations:true,ambient:'off'};h.render();
 assert.equal(surface().props['data-ambient'],'off');assert.equal(backgrounds().length,0);assert.equal(transition(),undefined);preserve();

 render({hidden:true,route:'hidden-net',theme:'network'});assert.equal(transition(),undefined,'A hidden terminal never starts a transition');
 render({hidden:false});assert.equal(transition(),undefined,'Revealing an unchanged section does not replay hidden navigation');preserve();
 render({route:'active-signal',theme:'signal'});assert(transition());
 render({hidden:true,route:'hidden-scene',theme:'tactical'});
 assert.equal(transition(),undefined,'Hidden navigation clears the preceding decorative transition');
 render({hidden:false});assert.equal(transition(),undefined);preserve();

 render({route:'new-scene'});assert(transition());
 render({hidden:true});notifyAncestors();assert.equal(surface().props['data-moving'],'off');assert.equal(transition(),undefined,'Ancestor visibility alone cancels the active layer');
 render({hidden:false});notifyAncestors();assert.equal(surface().props['data-moving'],'on');assert.equal(transition(),undefined,'Ancestor visibility return resumes the ambient without replay');preserve();
 render({route:'foreground-scene'});assert(transition());
 env.document.hidden=true;env.document.visibilityState='hidden';env.document.dispatchEvent(new Event('visibilitychange'));h.render();
 assert.equal(surface().props['data-moving'],'off');assert.equal(transition(),undefined);
 env.document.hidden=false;env.window.innerWidth=390;env.window.innerHeight=780;env.window.scrollX=0;env.window.scrollY=0;env.window.getComputedStyle=()=>({position:'fixed'});env.document.querySelector=()=>null;env.document.querySelectorAll=()=>[];env.document.visibilityState='visible';env.document.dispatchEvent(new Event('visibilitychange'));h.render();
 assert.equal(surface().props['data-moving'],'on');assert.equal(transition(),undefined);preserve();
 render({route:'last-route'});assert(transition());render({enabled:false});assert.equal(transition(),undefined);assert.equal(env.timers.size,0);preserve();
 render({enabled:true,localRoute:'local-notes'});assert(transition(),'Local navigation has its own bounded cue');preserve();
 const callback=[...env.timers.values()][0];env.timers.clear();callback();h.render();assert.equal(transition(),undefined,'Fallback removes cue without animationend');preserve();

 // Use actual MotionSurface with the order used by the persistent character
 // controls: select on mouse-down, commit the new section, then focus its tab.
 // The harness emits these DOM events explicitly; it does not emulate Radix.
 h.dispose();h.mount(SectionFixture);assert.equal(transition(),undefined);
 const sectionField=input();sectionField.value='Character draft survives navigation';sectionField.setSelectionRange(2,8,'forward');sectionField.focus();
 const preserveSection=()=>{assert.equal(input(),sectionField);assert.equal(input().value,'Character draft survives navigation');assert.equal(env.document.activeElement,sectionField);assert.deepEqual([sectionField.selectionStart,sectionField.selectionEnd,sectionField.selectionDirection],[2,8,'forward']);};
 const tab=value=>h.find(node=>node.type==='button'&&node.props['data-section']===value,false);
 const openSection=value=>{surface().props.onPointerDownCapture();tab(value).props.onMouseDown();h.render();};
 openSection('items');assert(transition(),'Mouse-down selection reveals the newly opened item section');const itemsKey=transition().props.key;
 focus(navigationTarget);assert.equal(transition().props.key,itemsKey,'The tab focus after its mouse-down commit does not erase the new reveal');preserveSection();
 focus(sectionField);assert.equal(transition(),undefined,'Focusing the actual content input dismisses its decorative cover immediately');preserveSection();
 surface().props.onKeyDownCapture();h.render();focus(navigationTarget);tab('implants').props.onFocus();h.render();assert(transition(),'Automatic activation after arrow-key focus opens another section');const implantsKey=transition().props.key;
 focus(navigationTarget);assert.equal(transition().props.key,implantsKey,'Arrow-key tab activation keeps its new cue after focus bubbles');preserveSection();
 surface().props.onKeyDownCapture();h.render();assert.equal(transition(),undefined,'A later key interaction dismisses the current decoration');
 const select=h.find(node=>node.type==='select',false);select.props.onChange({target:{value:'items'}});h.render();const selectorKey=transition().props.key;
 focus(navigationTarget);assert.equal(transition().props.key,selectorKey,'Returning focus to the native section selector preserves its navigation cue');preserveSection();
 surface().props.onFocusCapture({target:navigationTarget,currentTarget:{contains:()=>false}});h.render();assert.equal(transition(),undefined,'A matching navigation selector outside this surface does not receive the exemption');
 openSection('sheet');const oldSection=transition();const oldTimer=[...env.timers.values()][0];focus(navigationTarget);openSection('items');focus(navigationTarget);const rapidKey=transition().props.key;
 assert.notEqual(rapidKey,oldSection.props.key);oldTimer();h.render();assert.equal(transition().props.key,rapidKey,'Rapid section navigation retains only the most recent reveal');assert.equal(env.timers.size,1);preserveSection();
 h.update({enabled:false});assert.equal(transition(),undefined,'Busy or editor suppression removes the current section cue');openSection('implants');focus(navigationTarget);assert.equal(transition(),undefined);h.update({enabled:true});assert.equal(transition(),undefined,'A navigation consumed while a sheet editor was open does not replay');preserveSection();
 media.matches=true;media.dispatchEvent(new Event('change'));h.render();assert.equal(transition(),undefined);openSection('implants');focus(navigationTarget);assert.equal(transition(),undefined,'Preserving tab focus never bypasses reduced motion');
 media.matches=false;media.dispatchEvent(new Event('change'));h.render();assert.equal(transition(),undefined);
 env.document.hidden=true;env.document.dispatchEvent(new Event('visibilitychange'));h.render();openSection('sheet');focus(navigationTarget);assert.equal(transition(),undefined,'Hidden section navigation remains consumed without decoration');
 env.document.hidden=false;env.document.dispatchEvent(new Event('visibilitychange'));h.render();assert.equal(transition(),undefined);preserveSection();
 globalThis.__motionPreferences={...globalThis.__motionPreferences,animations:false};h.render();openSection('items');focus(navigationTarget);assert.equal(transition(),undefined,'The section selector cannot bypass the animation setting');preserveSection();
 console.log('Motion boundary: navigation-only transitions, active input preservation, hidden-route cancellation, settings/reduced-motion changes and page visibility passed. Single background ownership, approved B geometry, post-navigation tab and selector focus, direct input cancellation, stationary content and stale/fallback timers passed. CSS rendering and Radix DOM dispatch are not emulated.');
}finally{h.dispose();assert.equal(env.timers.size,0);assert.equal(observers.size,0);}
