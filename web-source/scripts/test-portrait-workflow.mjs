import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

const env=installEnvironment(),h=createHarness(),media=new EventTarget();
media.matches=false;env.window.matchMedia=()=>media;env.document.hidden=false;
const {Tracker,blank}=await loadModules(h);
const me={id:2,username:'Adam',role:'player',csrf:'test-token',platform:true};
let character={id:21,owner_id:2,owner:'Adam',version:1,updated:100,data:blank('Вега','Фиксер'),can_edit:true};
character.data.notes='Личный черновик';
const calls=[];let acknowledge;
const reply=value=>new Response(JSON.stringify(value),{status:200});
globalThis.fetch=async(path,options={})=>{
 const method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
 if(path==='/api/me')return reply(me);
 if(path==='/api/settings')return reply({hints:false,tutorial:false,animations:false});
 if(path==='/api/campaigns')return reply(character.can_edit===false?[{id:10,name:'Стол',gm_id:1,gm:'ГМ',version:1,updated:100,is_gm:false,is_member:true}]:[]);
 if(path==='/api/campaigns/10')return reply({id:10,name:'Стол',gm_id:1,gm:'ГМ',version:1,updated:100,is_gm:false,is_member:true,roster:[{character_id:21,owner_id:1,owner:'ГМ',name:'Вега',role:'Фиксер',status:'active',can_open:true}]});
 if(path==='/api/characters')return reply([character]);
 if(path==='/api/characters/21'&&method==='GET')return reply(character);
 if(path==='/api/characters/21'&&method==='PUT')return new Promise(resolve=>{
  acknowledge=()=>{character={...character,version:character.version+1,data:structuredClone(body.data)};resolve(reply({version:character.version,updated:200}));};
 });
 throw new Error(`Unexpected ${method} ${path}`);
};
const savebar=()=>h.find(n=>n.props.className==='savebar nc-savebar-compact');
const sheet=()=>h.find(n=>n.type==='harness-Sheet');
const range=key=>h.find(n=>n.type==='input'&&n.props.type==='range'&&n.props.id.endsWith('-'+key));
const setRange=(key,value)=>{range(key).props.onChange({target:{value:String(value)}});h.render();};
const choose=value=>{const n=h.find(n=>n.type==='input'&&n.props.type==='radio'&&n.props.value===value);assert(n);n.props.onChange();h.render();};
const writes=()=>calls.filter(n=>n.method==='PUT');
async function open(){h.mount(Tracker,{platformAuth:false});await h.flush();await h.click(h.find(n=>n.props['data-tour']==='nav-personal'));await h.click('Вега');}

await open();assert(!savebar(),'Clean sheets have no fixed save footer');
env.window.__motionTestRect={left:0,top:0,right:222,bottom:340,width:222,height:340};
await h.click('Добавить портрет · Вега');assert(sheet());assert(h.find(n=>n.props.className==='nc-portrait-editor'),'Blank portrait opens its own editor directly');
assert.equal(h.find(n=>n.props.className==='nc-portrait-preview').props.style.aspectRatio,'222 / 340','The root supplies the actual portrait width instead of the wider editor width');
setRange('height',420);setRange('zoom',175);choose('foil');choose('blue');
assert(!savebar(),'Editor preview does not mutate the sheet');assert.equal(writes().length,0);
await h.click('Отмена');assert(!sheet());assert(!savebar());
await h.click('Добавить портрет · Вега');assert.equal(range('height').props.value,340);assert.equal(range('zoom').props.value,100,'Cancelled changes are discarded');

// Use the real asynchronous file picker and preserve the whole source aspect.
const originalImage=globalThis.Image,originalElement=env.document.createElement,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
const raster='data:image/jpeg;base64,/9j/AA';let revoked=0;
globalThis.Image=class{naturalWidth=1200;naturalHeight=1800;decode(){return Promise.resolve();}};
URL.createObjectURL=()=> 'blob:workflow-portrait';URL.revokeObjectURL=()=>revoked++;
env.document.createElement=tag=>tag==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=>raster}:originalElement(tag);
try{
 const input=h.find(n=>n.type==='input'&&n.props.type==='file');
 input.props.onChange({target:{files:[new Blob(['pixels'],{type:'image/png'})],value:'portrait.png'}});h.render();await h.flush();
 assert.equal(revoked,1);
 setRange('height',420);setRange('zoom',175);setRange('x',20);setRange('y',70);choose('cover');choose('foil');choose('blue');
 await h.click('Центрировать');assert.equal(range('x').props.value,50);assert.equal(range('y').props.value,50);assert.equal(range('zoom').props.value,175);assert.equal(range('height').props.value,420);assert.equal(writes().length,0,'Centering affects only the appearance draft');
 setRange('x',20);setRange('y',70);
 await h.click('Применить к листу');assert(!sheet());assert(savebar(),'Apply creates a normal sheet draft');
 const portrait=h.find(n=>n.props['aria-label']==='Настроить портрет · Вега');assert(portrait);assert.equal(portrait.type,'button');assert.equal(portrait.props['data-effect'],'foil');
 const header=h.find(n=>n.props.className==='character-heading nc-dossier-heading');assert.equal(header.props.style['--nc-custom-portrait-height'],'420px');
 assert.equal(writes().length,0,'Only explicit sheet save writes to the server');
 const details=h.nodes(savebar()).find(n=>n.type==='details');assert(details);assert.equal(details.props.open,undefined,'Save comment is a closed native disclosure');
 const inner=h.nodes(savebar()).find(n=>n.props.className==='savebar-inner');assert(!inner.props.children.flat().some(n=>n?.type==='input'),'Comment is not a permanent second footer row');
 assert(h.find(n=>n.props['aria-label']==='Действия персонажа'),'Everyday actions are directly below the character');
 await h.click('Проверка');assert(sheet());sheet().props.onOpenChange(false);h.render();await h.flush();assert(savebar(),'Opening a check preserves appearance draft');
 await h.click(h.find(n=>n.props['data-tour']==='sheet-save'));assert(acknowledge);assert(h.find(n=>n.props['data-tour']==='sheet-save').props.disabled,'Busy save blocks duplicate writes');
 assert.equal(writes().length,1);const sent=writes()[0].body;
 assert.deepEqual(sent.data.appearance,{accent:'blue',portrait:raster,portraitFrame:{fit:'cover',x:20,y:70,zoom:175,height:420,effect:'foil'}});
 assert.equal(sent.data.notes,'Личный черновик','Portrait editing preserves private sheet data');
 acknowledge();await h.flush();assert(!savebar(),'Acknowledged save releases the footer');
 await h.click('Настроить портрет · Вега');assert.equal(range('height').props.value,420);assert.equal(range('zoom').props.value,175);assert.equal(range('x').props.value,20);
 await h.click('Отмена');assert(!savebar());h.dispose();
 await open();await h.click('Настроить портрет · Вега');assert.equal(range('height').props.value,420,'A fresh server read keeps the selected frame');await h.click('Отмена');
 h.dispose();character={...character,owner_id:1,owner:'ГМ',can_edit:false,access:'shared'};
 h.mount(Tracker,{platformAuth:false});await h.flush();await h.click(h.find(n=>n.props['data-tour']==='nav-campaigns'));await h.click('Стол');await h.click('Партия');await h.click('Лист');
 assert(!h.find(n=>n.props['aria-label']==='Настроить портрет · Вега'),'Shared readonly dossier offers no portrait mutation');
 const readonly=h.find(n=>n.props.className==='character-heading nc-dossier-heading');assert.equal(readonly.props.style['--nc-custom-portrait-height'],'420px','Shared dossier respects chosen card size');assert(!savebar());
 console.log('Portrait workflow: direct blank/image editing, local cancel/apply, real full-image picker, single-row draft footer, explicit guarded save and refresh, everyday actions, preserved private data and readonly framing passed.');
}finally{h.dispose();globalThis.Image=originalImage;env.document.createElement=originalElement;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
