import assert from 'node:assert/strict';
import { fixture, expect, snapshot, blank } from './network-fixture.mjs';

// Execute the actual integrated Site API and every generated SQLite migration.
// All changes live in :memory:. No external services, accounts, or production data.
const t = await fixture();
const { db, owner, request, read, write } = t;
const alice = await t.register('network_alice');
const bob = await t.register('network_bob');
const charlie = await t.register('network_charlie');
const accounts = { alice, bob, charlie };
const chars = {};
for(const [key, account] of Object.entries(accounts)) {
  chars[key] = (await write('/api/characters','POST',{data:blank(key)},account,201)).id;
}
chars.aliceSecond = (await write('/api/characters','POST',{data:blank('alice second')},alice,201)).id;
const campaign = await write('/api/campaigns','POST',{name:'Network privacy test',description:'Public briefing'},owner,201);
const path = '/api/campaigns/'+campaign.id;
const workspacePath = path+'/workspace';
let game = await read(path);
for(const [key, account] of Object.entries(accounts)) {
  await write('/api/campaigns/join','POST',{code:game.invite_code,character_id:chars[key]},account,201);
}
await write('/api/campaigns/join','POST',{code:game.invite_code,character_id:chars.aliceSecond},alice,201);
for(const character_id of [chars.alice,chars.aliceSecond,chars.bob]) {
  game = await read(path);
  await write(path+'/roster','POST',{version:game.version,character_id,status:'active'});
}
function denied(result, label) {
  assert.ok(result.status>=400&&result.status<500,label+': '+JSON.stringify(result));
}
function contains(value,text) { return JSON.stringify(value).includes(text); }
async function command(command, fields={}, account=owner, overrides={}) {
  const ws = await read(workspacePath,account);
  return write(workspacePath,'POST',{version:ws.version,command,...fields,...overrides},account);
}
function id() { return crypto.randomUUID(); }

// Version endpoint is anonymous; authenticated sync never embeds secret sheets/notes.
const version = await read('/api/version');
assert.equal(version.version,'0.17.7');
assert.equal(version.apiVersion,1);
const sync = await read('/api/sync',alice);
assert.equal(typeof sync.signature,'string');
assert.equal(sync.version,'0.17.7');
assert.ok(!contains(sync,'Public briefing'));

// Unrelated user's private campaigns/sheets do not influence this user's signature.
const aliceSignatureBefore=(await read('/api/sync',alice)).signature;
await write('/api/campaigns','POST',{name:'SECRET unrelated Bob campaign'},bob,201);
await write('/api/characters','POST',{data:blank('SECRET unrelated Bob sheet')},bob,201);
assert.equal((await read('/api/sync',alice)).signature,aliceSignatureBefore,'Sync signature is scoped, not global database freshness');

// Pending applicants cannot read/write workspace even if account is in GM UI mode.
denied(await request(workspacePath,'GET',undefined,charlie),'Pending workspace read');
await write('/api/mode','POST',{mode:'gm'},charlie);
denied(await request(workspacePath,'POST',{version:1,command:'scene.save',name:'Stolen scene',active:true,targets:[]},charlie),'GM mode grants no workspace authority');
const init = await read(workspacePath);
assert.equal(init.is_gm,true);
assert.equal(init.data.contacts.length,0);
assert.deepEqual((await read(workspacePath,alice)).characters.map(c=>c.id).sort((a,b)=>a-b),[chars.alice,chars.aliceSecond].sort((a,b)=>a-b));

const contactId=id(),bobContactId=id(),placeId=id(),assetId=id();
const contact={id:contactId,name:'Mara',phone:'555-01-20',description:'Fixer',notes:'SECRET NPC KNOWS THE TRAITOR',recipients:[chars.alice]};
await command('contact.save',{contact});
await command('contact.save',{contact:{id:bobContactId,name:'Bob only contact',phone:'555-01-21',description:'',notes:'SECRET BOB CONTACT',recipients:[chars.bob]}});
const aliceContact = (await read(workspacePath,alice)).data.contacts.find(c=>c.id===contactId);
assert.ok(aliceContact);
assert.equal(Object.hasOwn(aliceContact,'notes'),false,'NPC GM notes must be absent, not blank');
assert.ok(!(await read(workspacePath,bob)).data.contacts.some(c=>c.id===contactId));
assert.ok(!(await read(workspacePath,alice)).data.contacts.some(c=>c.id===bobContactId));
assert.ok((await read(workspacePath)).data.contacts.some(c=>c.notes==='SECRET NPC KNOWS THE TRAITOR'));
for(const [commandName, fields] of [
  ['contact.save',{contact:{...contact,notes:'Stolen'}}],
  ['contact.delete',{id:contactId}],
  ['message.send',{contactId,characterIds:[chars.alice],body:'Spoof NPC'}],
  ['scene.save',{name:'Stolen',active:true,targets:[]}],
]) denied(await request(workspacePath,'POST',{version:(await read(workspacePath,alice)).version,command:commandName,...fields},alice),'Player blocked '+commandName);

// GM can only assign currently approved character IDs; pending/foreign IDs fail.
for(const recipient of [chars.charlie,999999999]) {
  const before=await read(workspacePath);
  denied(await request(workspacePath,'POST',{version:before.version,command:'contact.save',contact:{...contact,id:id(),recipients:[recipient]}},owner),'Invalid contact recipient');
  assert.equal((await read(workspacePath)).version,before.version);
}

// Per-character contacts mean owning two sheets cannot spoof the other sheet.
await command('message.send',{contactId,characterIds:[chars.alice],body:'SECRET ALICE MESSAGE'});
assert.ok(contains(await read(workspacePath,alice),'SECRET ALICE MESSAGE'));
assert.ok(!contains(await read(workspacePath,bob),'SECRET ALICE MESSAGE'));
const wsAlice=await read(workspacePath,alice);
for(const characterId of [chars.aliceSecond,chars.bob]) {
  denied(await request(workspacePath,'POST',{version:wsAlice.version,command:'message.reply',contactId,characterId,body:'Illegal reply',requestId:id()},alice),'Unassigned or foreign character reply');
}
const retryId=id();
const replyPayload={version:wsAlice.version,command:'message.reply',contactId,characterId:chars.alice,body:'Physical dice at the table',requestId:retryId};
const reply=await request(workspacePath,'POST',replyPayload,alice);
expect(reply,200,'Assigned character replies');
const afterReply=await read(workspacePath);
const afterReplyCampaign=(await read(path)).version;
expect(await request(workspacePath,'POST',replyPayload,alice),200,'Retry same request succeeds once');
assert.equal((await read(workspacePath)).data.messages.filter(m=>m.body===replyPayload.body).length,1,'Retry must not create duplicate messages');
assert.equal((await read(workspacePath)).version,afterReply.version,'Retry does not bump workspace version');
assert.equal((await read(path)).version,afterReplyCampaign,'Retry does not bump campaign version');
denied(await request(workspacePath,'POST',{...replyPayload,body:'Changed under same request key'},alice),'Idempotency key cannot be reused for different command content');

// Stale CAS rejected before any mutation, including companion campaign version.
const staleBefore=await read(workspacePath);
const staleCampaign=await read(path);
expect(await request(workspacePath,'POST',{version:staleBefore.version-1,command:'message.send',contactId,characterIds:[chars.alice],body:'STALE MESSAGE'},owner),409,'Stale workspace write');
assert.equal((await read(workspacePath)).version,staleBefore.version);
assert.equal((await read(path)).version,staleCampaign.version);
assert.ok(!contains(await read(workspacePath),'STALE MESSAGE'));
denied(await request(workspacePath,'POST',{version:staleBefore.version,command:'message.reply',contactId,characterId:chars.alice,body:'No CSRF'}, {...alice,csrf:''}),'Workspace write needs CSRF');

// A real SQLite mid-batch failure rolls back workspace and campaign versions.
const rollbackBefore=snapshot(db,['campaigns','campaign_workspaces']);
const rollbackVersion=(await read(workspacePath)).version;
db.exec(`CREATE TRIGGER block_workspace_save BEFORE UPDATE ON campaign_workspaces WHEN OLD.campaign_id=${campaign.id} BEGIN SELECT RAISE(ABORT,'intentional workspace test rollback'); END`);
expect(await request(workspacePath,'POST',{version:rollbackVersion,command:'message.send',contactId,characterIds:[chars.alice],body:'ROLLBACK MESSAGE'},owner),503,'Workspace atomic rollback');
assert.equal(snapshot(db,['campaigns','campaign_workspaces']),rollbackBefore);
db.exec('DROP TRIGGER block_workspace_save');

// A permission change between pre-read and SQL batch must invalidate the write.
const raceBefore=(await read(workspacePath));
t.beforeBatch(db=>db.prepare('UPDATE campaigns SET gm_id=? WHERE id=?').run(bob.id,campaign.id));
denied(await request(workspacePath,'POST',{version:raceBefore.version,command:'message.send',contactId,characterIds:[chars.alice],body:'RACE OLD GM MESSAGE'},owner),'GM authority rechecked inside mutation batch');
assert.equal((await read(workspacePath,bob)).version,raceBefore.version);
assert.ok(!contains(await read(workspacePath,bob),'RACE OLD GM MESSAGE'));
db.prepare('UPDATE campaigns SET gm_id=? WHERE id=?').run(owner.id,campaign.id);

// Locations and assets follow character visibility rather than account mode.
await command('place.save',{place:{id:placeId,name:'PRIVATE BOB ADDRESS',address:'Watson 55',description:'',x:25,y:70,recipients:[chars.bob]}});
assert.ok(!contains(await read(workspacePath,alice),'PRIVATE BOB ADDRESS'));
assert.ok(contains(await read(workspacePath,bob),'PRIVATE BOB ADDRESS'));
await command('asset.save',{asset:{id:assetId,kind:'vehicle',name:'Group van',ownerCharacterId:chars.alice,access:[chars.bob],location:'Garage',condition:'Working',cost:1000,upkeep:50,notes:'Garage key in console',contents:'Ammo case'}});
assert.ok((await read(workspacePath,alice)).data.assets.some(a=>a.id===assetId),'Asset owner sees vehicle');
assert.ok((await read(workspacePath,bob)).data.assets.some(a=>a.id===assetId),'Granted access sees vehicle');

// Scene declarations preserve rules arbitration and hidden targets.
const visibleTarget=id(),hiddenTarget=id();
for(const targets of [[],[{id:hiddenTarget,name:'Hidden',kind:'device',description:'',visible:false}]]) {
  const before=await read(workspacePath);
  const result=await request(workspacePath,'POST',{version:before.version,command:'scene.save',name:'Unready',active:true,targets},owner);
  assert.equal(result.status,400,'Cannot open a scene without an available target');
  assert.equal((await read(workspacePath)).version,before.version,'Rejected open preserves the workspace');
}
await command('scene.save',{name:'Clinic encounter',active:true,targets:[
  {id:visibleTarget,name:'Visible guard',kind:'person',description:'By the door',visible:true},
  {id:hiddenTarget,name:'SECRET HIDDEN TURRET',kind:'device',description:'Secret ambush',visible:false},
]});
assert.ok(!contains(await read(workspacePath,alice),'SECRET HIDDEN TURRET'));
const actionRequest=id();
await command('action.submit',{characterId:chars.alice,targetId:visibleTarget,kind:'attack',description:'Aim at guard',tool:'Pistol',roll:null,damage:null,requestId:actionRequest},alice);
let ws=await read(workspacePath);
let action=ws.data.scene.actions.find(a=>a.description==='Aim at guard');
assert.ok(action);assert.equal(action.status,'submitted');
for(const fields of [{roll:0,damage:null},{roll:null,damage:0}]) {
  const result=await request(workspacePath,'POST',{version:ws.version,command:'action.submit',characterId:chars.alice,targetId:visibleTarget,kind:'attack',description:'Too early',tool:'',...fields,requestId:id()},alice);
  assert.equal(result.status,400,'Even zero dice must wait for approval');
}
assert.equal((await request(workspacePath,'POST',{version:ws.version,command:'action.roll',id:action.id,roll:0,damage:null},alice)).status,409,'Owned pending action cannot receive dice');
assert.equal((await read(workspacePath)).version,ws.version,'Early dice do not mutate the workspace');
assert.ok(!(await read(workspacePath,bob)).data.scene.actions.some(a=>a.id===action.id),'Other players cannot inspect unconfirmed declaration');
for(const fields of [
  {characterId:chars.bob,targetId:visibleTarget},
  {characterId:chars.alice,targetId:hiddenTarget},
]) denied(await request(workspacePath,'POST',{version:ws.version,command:'action.submit',kind:'attack',description:'Illegal target',tool:'Pistol',roll:7,damage:4,...fields,requestId:id()},alice),'Foreign actor or hidden target');
denied(await request(workspacePath,'POST',{version:ws.version,command:'action.approve',id:action.id},alice),'Player cannot approve own action');
await command('action.approve',{id:action.id});
await command('action.roll',{id:action.id,roll:7,damage:9},alice);
ws=await read(workspacePath);
action=ws.data.scene.actions.find(a=>a.id===action.id);
assert.equal(action.roll,7);assert.equal(action.damage,9);
denied(await request(workspacePath,'POST',{version:ws.version,command:'action.roll',id:action.id,roll:10,damage:99},bob),'Other player cannot change dice');
const sheetBefore=await read('/api/characters/'+chars.alice,alice);
await command('action.resolve',{id:action.id,result:'Guard falls behind the counter'});
const resolved=await read(workspacePath,alice);
assert.equal(resolved.data.scene.actions.find(a=>a.id===action.id).status,'resolved');
assert.equal((await read('/api/characters/'+chars.alice,alice)).version,sheetBefore.version,'Narrative resolution does not invent automatic rules or sheet mutations');
await command('action.undo',{id:action.id});
const undone=(await read(workspacePath)).data.scene.actions.find(a=>a.id===action.id);
assert.equal(undone.status,'approved');assert.equal(undone.result,'');

// Roster removal revokes contacts/replies even if old messages retain IDs.
game=await read(path);
await write(path+'/roster','POST',{version:game.version,character_id:chars.alice,status:'remove'});
const removedView=await read(workspacePath,alice);
assert.ok(!removedView.data.contacts.some(c=>c.id===contactId));
assert.ok(!contains(removedView,'SECRET ALICE MESSAGE'));
denied(await request(workspacePath,'POST',{version:removedView.version,command:'message.reply',contactId,characterId:chars.alice,body:'After roster removal'},alice),'Removed character cannot reply');

// GM handover grants secret access to the new GM and immediately revokes the old.
game=await read(path);
await write(path+'/transfer','POST',{version:game.version,user_id:bob.id});
game=await read(path,bob);
await write(path+'/transfer/accept','POST',{version:game.version},bob);
const oldGmResponse=await request(workspacePath,'GET',undefined,owner);
denied(oldGmResponse,'Former GM without approved own character cannot read workspace');
assert.ok(!contains(oldGmResponse,'SECRET NPC KNOWS THE TRAITOR'));
const newGmView=await read(workspacePath,bob);
assert.equal(newGmView.is_gm,true);
assert.ok(contains(newGmView,'SECRET NPC KNOWS THE TRAITOR'));
denied(await request(workspacePath,'POST',{version:newGmView.version,command:'contact.delete',id:contactId},owner),'Former GM loses mutation permission');
const oldGmSync=await read('/api/sync',owner);
assert.equal(typeof oldGmSync.signature,'string');
assert.ok(!contains(oldGmSync,'SECRET NPC KNOWS THE TRAITOR'));
console.log('Network workspace privacy, idempotency, CAS, manual action flow, and handover tests passed.');
