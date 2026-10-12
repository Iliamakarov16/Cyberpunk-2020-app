import assert from 'node:assert/strict';
import {createHarness,installEnvironment,loadModules} from './ux-hook-harness.mjs';
const env=installEnvironment(),h=createHarness();
const {TransferPanel,CampaignHub}=await loadModules(h,undefined,{actualTransfer:true});
const archive={format:'night-city-campaign',campaignUuid:'11111111-1111-4111-8111-111111111111'};
const preview={token:'preview',campaignId:null,mode:'new',name:'Пока город помнит',characters:0,atlasMarkers:0,owners:[],conflicts:[]};
let calls=[],held=null,imports=0,opened=0,scenes=0,codes=[];
const api=async(path,method,body)=>{calls.push({path,method,body});if(held)return held.promise;if(path.endsWith('/preview'))return {...preview};if(path==='/api/campaigns/import'){imports++;return {id:7,mode:'new',campaignUuid:archive.campaignUuid,claimCodes:codes};}throw new Error(path);};
const props={me:{id:1,username:'GM'},api,onImported:async()=>{},onOpenCampaign:()=>opened++,onImportScene:()=>scenes++};
const file=(name='campaign.json',text=JSON.stringify(archive),size=text.length)=>({name,size,text:async()=>text});
async function choose(f){const input=h.find(n=>n.type==='input'&&n.props.type==='file');const target={files:f?[f]:[],value:'chosen'};input.props.onChange({target});h.render();await h.flush();assert.equal(target.value,'');}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const apply=()=>h.button('Добавить кампанию в мой аккаунт');
h.mount(TransferPanel,props);await h.flush();
assert(h.text().includes('.campaign.json'));assert(h.text().includes('.scene.json'));assert(h.text().includes('.sqlite3'));
await choose(file());assert(apply());assert.equal(calls.filter(c=>c.path==='/api/campaigns/import').length,0);
await choose(undefined);assert(apply(),'Cancelling picker retains intentional selected file');
for(const wrong of [file('bad.json','no json'),file('huge.json','{}',4e6),file('backup.sqlite3','binary'),file('kit.zip','binary'),file('scene.json',JSON.stringify({format:'nightcity-scene',schemaVersion:1,tiles:[]})),file('other.json','{}')]){
 await choose(wrong);assert(!apply(),'Rejected replacement invalidates previous apply');assert(h.find(n=>n.props.role==='alert'));await choose(file());assert(apply());
}
// Immediate repeated submission must use one one-time token and keep its success.
const onClick=apply().props.onClick;held=deferred();onClick();onClick();h.render();assert.equal(calls.filter(c=>c.path==='/api/campaigns/import').length,1);held.resolve({id:7,mode:'new',campaignUuid:archive.campaignUuid,claimCodes:[]});held=null;await h.flush();
assert(h.find(n=>n.props['aria-label']==='Кампания загружена'));assert(!apply());await h.click('Открыть кампанию');await h.click('Добавить поле боя из файла');assert.equal(opened,1);assert.equal(scenes,1);h.update({...props,campaignId:7});await h.flush();assert(h.find(n=>n.props['aria-label']==='Кампания загружена'));h.update({...props,campaignId:null});await h.flush();assert(!h.find(n=>n.props['aria-label']==='Кампания загружена'));h.update({...props,campaignId:8});await h.flush();assert(!h.find(n=>n.props['aria-label']==='Кампания загружена'));h.dispose();
// Account changes cannot resurrect old preview or success and never retain codes.
h.mount(TransferPanel,props);held=deferred();await choose(file());h.update({...props,me:{id:2,username:'Other'}});held.resolve(preview);held=null;await h.flush();assert(!apply());assert(!h.find(n=>n.props['aria-label']==='Кампания загружена'));h.dispose();
// Personal claim codes survive null → imported campaign navigation, then require explicit dismissal.
codes=[{ownerKey:'owner',label:'Player',code:'TEST-ONLY-CODE',characters:['Hero']}];h.mount(TransferPanel,props);await choose(file());await h.click('Добавить кампанию в мой аккаунт');h.update({...props,campaignId:7,isGM:true});await h.flush();assert(h.text().includes('TEST-ONLY-CODE'));assert(h.button('Открыть кампанию').props.disabled);assert(h.button('Добавить поле боя из файла').props.disabled);await h.click('Коды сохранены, закрыть');assert(!h.button('Открыть кампанию').props.disabled);h.update({...props,campaignId:7,me:{id:2,username:'Other'}});await h.flush();assert(!h.text().includes('TEST-ONLY-CODE'));h.dispose();
// Hub's real panel entry is prominent and remains guarded during a preview request.
const listApi=async(path,method,body)=>{if(path==='/api/campaigns')return [];return api(path,method,body);};
const hubProps={me:{id:1,username:'GM',role:'gm'},api:listApi,characters:[],open(){},createCharacter(){},navigationRevision:()=>0,refreshCharacters:async()=>{}};
h.mount(CampaignHub,hubProps);await h.flush();await h.click('Импорт кампании из файла');held=deferred();await choose(file());assert(h.button('Создать кампанию').props.disabled);assert(h.button('Ввести код').props.disabled);held.resolve(preview);held=null;await h.flush();await h.click('Ввести код');assert(h.text().includes('Есть незавершённая работа'));h.dispose();
console.log('Actual campaign import UI: format guidance, replacement/cancel, single submission, claim codes, account interruption and guarded prominent entry passed. Native picker pixels are not simulated.');
// An old import completion cannot navigate or refresh characters for the next account.
const {CampaignHub:StubbedHub}=await loadModules(h);let reads=0,refreshes=0;const gate=deferred(),hubCalls=[];
const accountApi=async path=>{hubCalls.push(path);if(path==='/api/campaigns'){reads++;return reads===2?gate.promise:[];}throw new Error(path);};
const accountProps={...hubProps,api:accountApi,refreshCharacters:async()=>{refreshes++;}};
h.mount(StubbedHub,accountProps);await h.flush();const panel=h.find(n=>n.props.onImported&&!n.props.onOpenBattle,false);assert(panel);const pending=panel.props.onImported(7);h.update({...accountProps,me:{id:2,username:'Other',role:'player'}});gate.resolve([]);await pending;await h.flush();assert.equal(refreshes,0);assert(!hubCalls.includes('/api/campaigns/7'));h.dispose();
console.log('Late hub import completion is account/navigation-bound.');
