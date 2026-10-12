import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';

const env=installEnvironment(),h=createHarness();
const {AccountForm}=await loadModules(h,undefined,{accountForms:true});
const originalFormData=globalThis.FormData;
const submissions=[];
let activeForm;
globalThis.FormData=class {
 constructor(form){assert.equal(form,activeForm,'Submit reads the active form');}
 *[Symbol.iterator](){for(const input of h.nodes().filter(node=>node.type==='input'))yield [input.props.name,input.props.ref?.current.value??'test_user'];}
};
const input=name=>h.find(node=>node.type==='input'&&node.props.name===name);
const toggle=name=>h.find(node=>node.type==='button'&&node.props['aria-controls']===input(name).props.id);
const form=()=>h.find(node=>node.type==='form');

try{
 for(const mode of ['login','register','new','reset','password']){
  h.dispose();env.document.activeElement=null;
  h.mount(AccountForm,{mode,submit:async values=>{submissions.push(values);}});
  const names=mode==='password'?['old','new']:['password'];
  const username=input('username');
  assert.equal(!!username,['login','register','new'].includes(mode),`${mode}: username availability`);
  if(username){
   assert.equal(username.props.autoCapitalize,'none');
   assert.equal(username.props.autoCorrect,'off');
   assert.equal(username.props.spellCheck,false);
   assert.equal(username.props.enterKeyHint,'next');
   assert.equal(username.props.autoComplete,mode==='login'?'username':'off');
  }
  assert.equal(h.nodes().filter(node=>node.type==='input'&&node.props.ref).length,names.length);
  for(const name of names){
   const before=input(name),host=before.props.ref.current,id=before.props.id;
   const oldSubmissionCount=submissions.length;
   assert.equal(before.props.type,'password',`${mode}/${name}: masked initially`);
   assert.equal(before.props.autoComplete,mode==='login'||name==='old'?'current-password':'new-password');
   assert.equal(before.props.minLength,mode==='login'||name==='old'?undefined:12);
   assert.equal(before.props.maxLength,256);
   assert.equal(before.props.required,true);
   assert.equal(before.props.autoCapitalize,'none');
   assert.equal(before.props.autoCorrect,'off');
   assert.equal(before.props.spellCheck,false);
   assert.equal(before.props.enterKeyHint,name==='old'?'next':'go');
   assert(h.find(node=>node.type==='label'&&node.props.htmlFor===id),'Password label stays associated with its input');
   assert.equal(toggle(name).props.type,'button','Reveal never submits the form');
   assert.equal(toggle(name).props['aria-pressed'],false);
   assert(toggle(name).props['aria-label'].startsWith('Показать'));
   let prevented=false;
   toggle(name).props.onPointerDown({preventDefault(){prevented=true;}});
   assert(prevented,'Touch press preserves the focused input');

   host.value='sample-password-2020';
   host.setSelectionRange(2,8,'backward');host.focus();
   await h.click(toggle(name));
   assert.equal(input(name).props.type,'text');
   assert.equal(input(name).props.id,id);
   assert.equal(input(name).props.ref.current,host,'Reveal preserves the existing input');
   assert.equal(host.value,'sample-password-2020');
   assert.equal(env.document.activeElement,host);
   assert.deepEqual([host.selectionStart,host.selectionEnd,host.selectionDirection],[2,8,'backward']);
   assert.deepEqual(host.focusOptions,{preventScroll:true});
   assert.equal(toggle(name).props['aria-pressed'],true);
   assert(toggle(name).props['aria-label'].startsWith('Скрыть'));
   for(const other of names.filter(value=>value!==name))assert.equal(input(other).props.type,'password','Current and new passwords reveal independently');

   await h.click(toggle(name));
   assert.equal(input(name).props.type,'password');
   assert.equal(input(name).props.ref.current,host);
   assert.deepEqual([host.selectionStart,host.selectionEnd,host.selectionDirection],[2,8,'backward']);
   assert.equal(submissions.length,oldSubmissionCount,'Reveal/hide does not call submit');

   const keyboardButton={};env.document.activeElement=keyboardButton;
   await h.click(toggle(name));
   assert.equal(env.document.activeElement,keyboardButton,'Keyboard activation does not steal focus from the reveal button');
   await h.click(toggle(name));
  }

  await h.click(toggle(names[0]));
  activeForm={};let prevented=false;
  await form().props.onSubmit({currentTarget:activeForm,preventDefault(){prevented=true;}});
  await h.flush();
  assert(prevented);
  const expected=Object.fromEntries(names.map(name=>[name,'sample-password-2020']));
  if(username)expected.username='test_user';
  assert.deepEqual(submissions.at(-1),expected,`${mode}: revealed passwords still submit under the original field names`);
 }

 h.dispose();let finish;
 h.mount(AccountForm,{mode:'register',submit:()=>new Promise(resolve=>{finish=resolve;})});
 const host=input('password').props.ref.current;host.value='sample-password-2020';host.focus();
 activeForm={};const pending=form().props.onSubmit({currentTarget:activeForm,preventDefault(){}});
 h.render();
 assert.equal(h.find(node=>node.type==='button'&&node.props.type==='submit').props.disabled,true);
 assert.equal(input('password').props.ref.current,host,'Pending state keeps the field mounted');
 assert.equal(host.value,'sample-password-2020');
 await h.click(toggle('password'));
 assert.equal(input('password').props.type,'text','Password reveal also works during a pending request');
 finish();await pending;await h.flush();
 assert.equal(input('password').props.ref.current,host);
 assert.equal(h.find(node=>node.type==='button'&&node.props.type==='submit').props.disabled,false);

 console.log('Account forms: all 5 modes, independent password visibility, no accidental submit, field attributes, focus/selection preservation and pending-state stability passed. Samsung IME is not emulated.');
}finally{
 h.dispose();globalThis.FormData=originalFormData;
}
