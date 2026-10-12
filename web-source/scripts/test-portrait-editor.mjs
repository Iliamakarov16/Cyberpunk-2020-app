import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHarness,installEnvironment,moduleUrl,transpile} from './ux-hook-harness.mjs';

const modelUrl=moduleUrl(transpile(await readFile(new URL('../lib/character-appearance.ts',import.meta.url),'utf8')));
const model=await import(modelUrl);
const oldPortrait='data:image/jpeg;base64,/9j/AA';
const valid={fit:'cover',x:25,y:70,zoom:175,height:380,effect:'foil'};
assert.equal(model.normalizePortraitFrame(undefined),undefined);
assert.deepEqual(model.normalizeCharacterAppearance({accent:'teal',portrait:oldPortrait}),{accent:'teal',portrait:oldPortrait},'Legacy metadata remains absent');
assert(model.isPortraitFrame(valid));
for(const bad of [null,[],{}, {...valid,x:-1},{...valid,y:101},{...valid,zoom:99},{...valid,zoom:301},{...valid,height:219},{...valid,height:521},{...valid,x:1.5},{...valid,x:true},{...valid,fit:'fill'},{...valid,effect:'arbitrary-animation'},{...valid,extra:'private'}])assert(!model.isPortraitFrame(bad),JSON.stringify(bad));
assert.deepEqual(model.normalizePortraitFrame({fit:'injected',x:-100,y:200,zoom:Infinity,height:NaN,effect:'url(evil)'}),{...model.DEFAULT_PORTRAIT_FRAME,x:0,y:100});
for(const unsafe of ['https://server.invalid/portrait.png','data:image/svg+xml;base64,PHN2Zz4=','data:text/html;base64,PGgxPg==',oldPortrait+'\n','data:image/png;base64,'+'A'.repeat(100000)])assert(!model.isSafePortrait(unsafe));
assert.deepEqual(model.normalizeCharacterAppearance({accent:'injected',portrait:'javascript:alert(1)',private:'secret'}),{accent:'rust'});
const equipment=[
 {name:'Куртка',slot:'outer',icon:'jacket',category:'armor',equipped:true,quantity:1,visibility:'default',description:'private'},
 {name:'Футболка',slot:'inner',icon:'shirt',category:'clothes',equipped:true,quantity:1,visibility:'default'},
 {name:'Скрытый имплант',slot:'implant',icon:'cyber',category:'cyber',equipped:true,quantity:1,visibility:'default'},
 {name:'Рюкзак',slot:'bag',icon:'gear',category:'gear',equipped:true,quantity:1,visibility:'default'},
];
const exterior=model.exteriorCard(21,{name:'Вега',appearance:{accent:'violet',portrait:oldPortrait,portraitFrame:valid,secret:'private'},items:equipment});
assert.deepEqual(exterior.appearance,{accent:'violet',portrait:oldPortrait,portraitFrame:valid});assert.deepEqual(exterior.items,[{name:'Куртка',slot:'outer',icon:'jacket'}],'Appearance framing does not alter wardrobe visibility or reveal private item data');

const env=installEnvironment(),h=createHarness(),media=new EventTarget();media.matches=false;
env.window.matchMedia=()=>media;env.document.hidden=false;env.window.innerWidth=390;env.window.innerHeight=780;
const focused={value:'unchanged private draft'};env.document.activeElement=focused;
globalThis.__portraitReact=h.React;globalThis.__portraitSettings={animations:true,ambient:'quiet'};
const reactUrl=moduleUrl('const r=globalThis.__portraitReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect,useId=r.useId;');
const geometryUrl=moduleUrl(transpile(await readFile(new URL('../lib/portrait-frame.ts',import.meta.url),'utf8')));
const geometry=await import(geometryUrl);
const slotsUrl=moduleUrl("export const SLOTS={outer:'Верхняя одежда',inner:'Под одеждой',bag:'Рюкзак',implant:'Имплант'};");
const iconsUrl=moduleUrl("export const UserRound=props=>({type:'svg',props:{...props,children:[]}});");
const wardrobeUrl=moduleUrl('export const IllustratedIcon=()=>null;');
const helpUrl=moduleUrl('export const usePlayerSettings=()=>globalThis.__portraitSettings;');
const modules=new Map([['react',reactUrl],['lucide-react',iconsUrl],['@/lib/tracker',slotsUrl],['@/lib/character-appearance',modelUrl],['@/lib/portrait-frame',geometryUrl],['@/components/paper-doll',wardrobeUrl],['@/components/player-help',helpUrl]]);
const source=await readFile(new URL('../components/character-exterior.tsx',import.meta.url),'utf8');
const compiled=moduleUrl(transpile(source.replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from '${modules.get(name)}'`)));
const {CharacterPortrait,PortraitEditor,PortraitPicker,preparePortraitFile}=await import(compiled);
const imageBefore=globalThis.Image,createBefore=env.document.createElement,createObjectBefore=URL.createObjectURL,revokeBefore=URL.revokeObjectURL;
const decodeRequests=[],draws=[],revoked=[];let fileSequence=0;
globalThis.Image=class {naturalWidth=1200;naturalHeight=1800;decode(){return this.src.startsWith('blob:')?new Promise(resolve=>decodeRequests.push(resolve)):Promise.resolve();}};
URL.createObjectURL=()=>`blob:portrait-test-${++fileSequence}`;URL.revokeObjectURL=value=>revoked.push(value);
let canvas;
env.document.createElement=tag=>tag==='canvas'?(canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){draws.push(args);}}),toDataURL:()=>oldPortrait}):createBefore(tag);
const range=key=>h.find(node=>node.type==='input'&&node.props.type==='range'&&node.props.id.endsWith('-'+key));
const setRange=(key,value)=>{range(key).props.onChange({target:{value:String(value)}});h.render();};
const radio=value=>h.find(node=>node.type==='input'&&node.props.type==='radio'&&node.props.value===value);
const chooseRadio=value=>{radio(value).props.onChange();h.render();};
const pick=()=>h.find(node=>node.type==='input'&&node.props.type==='file');
const original={accent:'teal',portrait:oldPortrait,portraitFrame:{...model.DEFAULT_PORTRAIT_FRAME}};
let commits=[],cancels=0;
try{
 h.mount(PortraitEditor,{name:'Вега',appearance:original,onChange:value=>commits.push(value),onCancel:()=>cancels++});await h.flush();
 setRange('zoom',220);setRange('x',20);setRange('height',420);chooseRadio('foil');chooseRadio('violet');
 assert.equal(commits.length,0,'Live preview never mutates the sheet');assert.equal(original.portraitFrame.zoom,100);assert.equal(original.accent,'teal');
 await h.click('Отмена');assert.equal(cancels,1);assert.equal(commits.length,0);
 h.dispose();h.mount(PortraitEditor,{name:'Вега',appearance:original,onChange:value=>commits.push(value),onCancel:()=>cancels++});await h.flush();
 setRange('zoom',180);setRange('y',80);chooseRadio('scan');await h.click('Применить к листу');
 assert.equal(commits.length,1);assert.equal(commits[0].portrait,oldPortrait,'Framing never destructively re-encodes an existing portrait');assert.deepEqual(commits[0].portraitFrame,{...model.DEFAULT_PORTRAIT_FRAME,zoom:180,y:80,effect:'scan'});assert.equal(draws.length,0);
 chooseRadio('cover');setRange('zoom',200);setRange('x',50);setRange('y',50);
 const preview=()=>h.find(node=>node.props.className==='nc-portrait-preview');let captured=false;
 const pointerTarget={getBoundingClientRect:()=>({width:200,height:340}),setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 preview().props.onPointerDown({pointerId:1,button:0,clientX:10,clientY:20,currentTarget:pointerTarget,preventDefault(){}});h.render();assert(captured);
 preview().props.onPointerMove({pointerId:1,clientX:10+25.333333,clientY:54,currentTarget:pointerTarget,preventDefault(){}});h.render();assert.equal(range('x').props.value,40);assert.equal(range('y').props.value,40,'Preview drag and persisted geometry use the same position model');
 preview().props.onPointerUp({pointerId:1,currentTarget:pointerTarget});h.render();assert(!captured);assert.equal(preview().props['data-dragging'],'false');

 // A vertical-phone editor must show the saved portrait viewport, excluding its stat rail.
 h.dispose();commits=[];const viewportWidth=222,previewHeight=240,previewWidth=viewportWidth*previewHeight/340;
 env.window.__motionTestRect={left:0,top:0,width:previewWidth,height:previewHeight};
 const portraitProps={name:'Вега',appearance:{...original,portraitFrame:{...model.DEFAULT_PORTRAIT_FRAME,fit:'cover',effect:'scan'}},viewportWidth,onChange:value=>commits.push(value),onCancel:()=>cancels++};
 h.mount(PortraitEditor,portraitProps);await h.flush();
 assert.equal(preview().props.style.aspectRatio,'222 / 340');assert.equal(preview().props.style.height,undefined,'Preview height scales with its true card aspect');assert.equal(parseFloat(preview().props.style['--portrait-preview-width']),previewWidth);
 const portraitImage=()=>h.find(node=>node.type==='img'&&node.props.className==='character-portrait');
 portraitImage().props.onLoad({currentTarget:{naturalWidth:1200,naturalHeight:1800}});h.render();
 let scaled=portraitImage().props.style;let saved=geometry.getPortraitLayout({imageWidth:1200,imageHeight:1800,width:viewportWidth,height:340,...portraitProps.appearance.portraitFrame});
 for(const key of ['width','height','left','top'])assert(Math.abs(scaled[key]/(previewHeight/340)-saved[key])<1e-8,`Preview and saved ${key} agree before editing`);
 const mobileTarget={getBoundingClientRect:()=>({width:previewWidth,height:previewHeight}),setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 preview().props.onPointerDown({pointerId:5,button:0,isPrimary:true,clientX:20,clientY:30,currentTarget:mobileTarget,preventDefault(){}});h.render();assert(captured);
 preview().props.onPointerMove({pointerId:5,clientX:20,clientY:38,currentTarget:mobileTarget,preventDefault(){}});h.render();assert.equal(range('zoom').props.value,110,'A fitted vertical axis opens a small crop on the first real drag');assert.notEqual(range('y').props.value,50,'Vertical drag visibly moves the fitted portrait');
 preview().props.onPointerCancel({pointerId:99,currentTarget:mobileTarget});h.render();assert(captured,'An unrelated pointer cannot cancel the active drag');
 preview().props.onPointerCancel({pointerId:5,currentTarget:mobileTarget});h.render();assert(!captured);assert.equal(preview().props['data-dragging'],'false');
 setRange('x',20);setRange('y',80);await h.click('Центрировать');assert.equal(range('x').props.value,50);assert.equal(range('y').props.value,50);assert.equal(range('zoom').props.value,110);assert.equal(radio('cover').props.checked,true);assert.equal(radio('scan').props.checked,true,'Center does not discard crop style');
 preview().props.onPointerDown({pointerId:7,button:0,clientX:20,clientY:30,currentTarget:mobileTarget,preventDefault(){}});h.render();assert(captured);setRange('height',420);assert(!captured);assert.equal(preview().props['data-dragging'],'false','Changing the viewport cancels stale pointer geometry');
 setRange('height',340);h.update({...portraitProps,viewportWidth:300});await h.flush();assert.equal(preview().props.style.aspectRatio,'300 / 340','A new host width updates the preview aspect');
 h.update(portraitProps);await h.flush();await h.click('Применить к листу');assert.equal(commits.length,1);assert.equal(commits[0].portrait,oldPortrait);
 scaled={...portraitImage().props.style};env.window.__motionTestRect={left:0,top:0,width:viewportWidth,height:340};h.dispose();h.mount(CharacterPortrait,{name:'Вега',appearance:commits[0],large:true});await h.flush();portraitImage().props.onLoad({currentTarget:{naturalWidth:1200,naturalHeight:1800}});h.render();saved=portraitImage().props.style;
 for(const key of ['width','height','left','top'])assert(Math.abs(scaled[key]/(previewHeight/340)-saved[key])<1e-8,`Applied preview and saved ${key} agree`);
 delete env.window.__motionTestRect;

 h.dispose();commits=[];h.mount(PortraitEditor,{name:'Вега',appearance:{accent:'rust'},onChange:value=>commits.push(value),onCancel:()=>cancels++});await h.flush();
 pick().props.onChange({target:{files:[new Blob(['safe pixels'],{type:'image/png'})],value:'portrait.png'}});h.render();await h.flush();
 assert(h.button('Применить к листу').props.disabled,'Upload preparation cannot commit a half-prepared asset');chooseRadio('blue');setRange('height',440);setRange('zoom',160);
 decodeRequests.shift()();await h.flush();assert.equal(canvas.width,640);assert.equal(canvas.height,960,'Downsizing preserves the full source aspect ratio');assert.deepEqual(draws.at(-1).slice(1),[0,0,640,960],'No central source crop is performed');
 assert.equal(commits.length,0);await h.click('Применить к листу');assert.equal(commits.length,1);assert.equal(commits[0].accent,'blue','Late image preparation preserves the newer card controls');assert.equal(commits[0].portraitFrame.height,440);assert.equal(commits[0].portraitFrame.zoom,160);assert(model.isSafePortrait(commits[0].portrait));

 h.dispose();commits=[];h.mount(PortraitEditor,{name:'Вега',appearance:original,onChange:value=>commits.push(value),onCancel:()=>cancels++});await h.flush();
 pick().props.onChange({target:{files:[new Blob(['safe pixels'],{type:'image/png'})],value:'portrait.png'}});h.render();await h.flush();await h.click('Отмена');h.dispose();decodeRequests.shift()();await h.flush();assert.equal(commits.length,0,'Cancelled decode cannot update the sheet or a later editor');assert.equal(revoked.length,2,'Every upload releases its object URL');
 await assert.rejects(()=>preparePortraitFile(new Blob(['svg'],{type:'image/svg+xml'})),/PNG, JPEG/);

 h.mount(CharacterPortrait,{name:'Вега',appearance:{accent:'violet',portrait:oldPortrait,portraitFrame:valid},large:true});await h.flush();
 const card=()=>h.find(node=>node.props.className?.includes('nc-portrait-card'));
 assert.equal(card().type,'div','Shared/readonly portrait has no editing control');assert.equal(card().props['data-portrait-motion'],'on');assert.equal(env.document.activeElement,focused,'Framing and effects never steal focus');
 env.document.hidden=true;env.document.dispatchEvent(new Event('visibilitychange'));h.render();assert.equal(card().props['data-portrait-motion'],'off');
 env.document.hidden=false;env.document.dispatchEvent(new Event('visibilitychange'));h.render();assert.equal(card().props['data-portrait-motion'],'on');media.matches=true;media.dispatchEvent(new Event('change'));h.render();assert.equal(card().props['data-portrait-motion'],'off');media.matches=false;media.dispatchEvent(new Event('change'));h.render();
 globalThis.__portraitSettings={animations:false};h.render();assert.equal(card().props['data-portrait-motion'],'off');
 h.dispose();let edits=0,openedViewport;env.window.__motionTestRect={width:222,height:340};h.mount(CharacterPortrait,{name:'Вега',appearance:{accent:'rust'},large:true,onEdit:viewport=>{edits++;openedViewport=viewport;}});await h.flush();assert.equal(card().type,'button');assert.equal(card().props['aria-label'],'Добавить портрет · Вега');await h.click(card());assert.equal(edits,1,'The complete blank portrait field opens editing by click/keyboard button activation');assert.deepEqual(openedViewport,{width:222,height:340},'Activation reports the inner portrait viewport rather than its full dossier');delete env.window.__motionTestRect;

 h.dispose();let legacy=[];h.mount(PortraitPicker,{onChange:value=>legacy.push(value)});await h.flush();pick().props.onChange({target:{files:[new Blob(['pixels'],{type:'image/webp'})],value:'portrait.webp'}});h.render();await h.flush();decodeRequests.shift()();await h.flush();assert.deepEqual(legacy,[oldPortrait],'Legacy standalone picker keeps its callback contract');
 const css=await readFile(new URL('../public/portrait-editor.css',import.meta.url),'utf8');assert.match(css,/\.nc-portrait-finish \{[^}]*pointer-events:none/);assert.match(css,/data-portrait-motion="on"/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/data-can-drag="true"[^}]*touch-action:none/);assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 console.log('Portrait editor: matched vertical-phone preview/saved crop, Center preserving style, fitted-axis autozoom, pointer cancellation, viewport updates; legacy-safe framing, Apply/Cancel/upload isolation, readonly and motion gates passed. CSS source contracts verified; no browser pixels emulated.');
}finally{h.dispose();globalThis.Image=imageBefore;env.document.createElement=createBefore;URL.createObjectURL=createObjectBefore;URL.revokeObjectURL=revokeBefore;}
