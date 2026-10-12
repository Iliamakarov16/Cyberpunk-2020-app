import assert from 'node:assert/strict';
import { fixture, expect, blank, snapshot } from './network-fixture.mjs';

// Exercise production route modules and every SQLite migration, in memory only.
// Covers effective access, public appearance, concurrency and portable consent resets.
const t = await fixture();
const { db, owner: gm, request, read, write } = t;
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function ok(value, label) { assert.ok(value, label); checks++; }
function denied(result, label) { ok(result.status >= 400 && result.status < 500, `${label}: ${JSON.stringify(result)}`); }
function keys(value, expected, label) { equal(Object.keys(value).sort(), [...expected].sort(), label); }
const portrait = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=';
const alice = await t.register('share_alice');
const bob = await t.register('share_bob');
const charlie = await t.register('share_charlie');
const pending = await t.register('share_pending');
const outsider = await t.register('share_outsider', 'gm');
const otherGm = await t.register('share_other_gm');
function item(id, name, slot, category='clothing', extra={}) {
  return { id, name, slot, category, icon: category==='weapon'?'pistol':category==='cyber'?'cyberarm':category==='ammo'?'ammo':slot==='outer'?'jacket':slot==='feet'?'boots':slot==='legs'?'pants':slot==='body'?'armor':slot==='head'?'helmet':'shirt', quantity:1, weight:1, equipped:true,
    description:'PRIVATE ITEM DESCRIPTION', source:'PRIVATE ITEM SOURCE', armor:null, modifiers:[], ...extra };
}
let aliceData = { ...blank('Алиса // visible identity'), cash: 987654, humanity: 31, notes:'PRIVATE SHEET NOTES', background:'PRIVATE LIFE STORY', condition:'PRIVATE MEDICAL CONDITION',
  appearance:{accent:'violet',portrait}, items:[
    item('jacket','Красная куртка','outer','armor',{armor:{type:'soft',coverage:{torso:18},ev:1,order:20}}),
    item('under','PRIVATE LOWER LAYER','inner'),
    item('legs','Синие брюки','legs'),
    item('boots','Высокие ботинки','feet'),
    item('pistol','Пистолет в руке','mainHand','weapon'),
    item('bag','PRIVATE BACKPACK CONTENT','bag','gear'),
    item('cyber','PRIVATE CYBERWARE','implant','cyber'),
    item('ammo','PRIVATE AMMUNITION','accessory','ammo'),
    item('empty','PRIVATE ZERO QUANTITY','eyes','clothing',{quantity:0}),
    item('unworn','PRIVATE UNWORN JACKET','outer','clothing',{equipped:false}),
    item('hidden','PRIVATE CONCEALED HAT','head','clothing',{visibility:'hidden'}),
    item('explicit','Видимый воротник','inner','clothing',{visibility:'visible'}),
  ] };
const source = (await write('/api/characters','POST',{data:aliceData},alice,201)).id;
const spare = (await write('/api/characters','POST',{data:blank('PRIVATE SPARE CHARACTER')},alice,201)).id;
const bobCharacter = (await write('/api/characters','POST',{data:blank('Боб')},bob,201)).id;
const charlieCharacter = (await write('/api/characters','POST',{data:blank('Чарли')},charlie,201)).id;
const pendingCharacter = (await write('/api/characters','POST',{data:blank('Заявка')},pending,201)).id;
const outsiderCharacter = (await write('/api/characters','POST',{data:blank('Другой стол')},outsider,201)).id;
const gameId = (await write('/api/campaigns','POST',{name:'Sharing privacy table'},gm,201)).id;
const gamePath = '/api/campaigns/'+gameId;
async function apply(campaignId, characterId, account, status='active') {
  const path='/api/campaigns/'+campaignId, game=await read(path, campaignId===gameId?gm:otherGm);
  await write('/api/campaigns/join','POST',{code:game.invite_code,character_id:characterId},account,201);
  if(status!=='pending')await roster(campaignId, characterId, status);
}
async function roster(campaignId, characterId, status) {
  const account=campaignId===gameId?gm:otherGm, path='/api/campaigns/'+campaignId, game=await read(path,account);
  return write(path+'/roster','POST',{version:game.version,character_id:characterId,status},account);
}
await apply(gameId,source,alice);
await apply(gameId,bobCharacter,bob);
await apply(gameId,charlieCharacter,charlie,'reserve');
await apply(gameId,pendingCharacter,pending,'pending');
const sheetPath='/api/characters/'+source;
const accessPath=sheetPath+'/access';
async function accessRow(campaignId=gameId) {
  const data=await read(accessPath,alice);
  keys(data,['campaigns'],'Access settings response excludes full private sheet');
  const row=data.campaigns.find(v=>v.campaign_id===campaignId);
  ok(row,'Access settings list linked campaign'); return row;
}
async function share(mode, playerIds=[], campaignId=gameId) {
  const before=await accessRow(campaignId);
  await write(accessPath,'PUT',{campaign_id:campaignId,version:before.version,mode,player_ids:playerIds},alice);
  const after=await accessRow(campaignId);
  equal(after.mode,mode,'Requested access mode persisted');
  equal(after.version,before.version+1,'Each grant has its own monotonically increasing CAS version');
  equal(after.player_ids,[...playerIds].sort((a,b)=>a-b),'Requested recipient identities persisted');
  return after;
}
function entry(game, characterId=source) { return game.roster.find(r=>r.character_id===characterId); }
function checkExterior(exterior, names) {
  ok(exterior,'Accepted peers receive exterior card');
  keys(exterior,['character_id','name','appearance','items'],'Exterior top-level strict allowlist');
  equal(exterior.character_id,source,'Exterior identifies character');
  equal(exterior.name,aliceData.name,'Exterior exposes character name');
  keys(exterior.appearance,['accent','portrait'],'Exterior appearance strict allowlist');
  equal(exterior.appearance,{accent:'violet',portrait},'Exterior preserves owner portrait');
  equal(exterior.items.map(i=>i.name).sort(),[...names].sort(),'Only externally visible positive worn items appear');
  for(const value of exterior.items)keys(value,['name','slot','icon'],'Exterior item excludes SP, EV, stats, description, source, quantity, value');
  const serialized=JSON.stringify(exterior);
  for(const secret of ['PRIVATE','987654','"humanity":','"stats":','"skills":','"background":','"condition":','"armor":','"modifiers":','"owner_id":'])ok(!serialized.includes(secret),'Exterior does not leak '+secret);
}

// Privacy is the default; a role preference never substitutes for campaign authority.
const initial=await accessRow();
equal(initial.mode,'private','Unconfigured sheets default private');
equal(initial.version,0,'Unconfigured grants have version 0');
equal(initial.player_ids,[],'Unconfigured selected list empty');
equal(initial.players.map(p=>p.id).sort((a,b)=>a-b),[bob.id,charlie.id].sort((a,b)=>a-b),'Picker includes accepted/reserve peers only');
for(const account of [bob,charlie,pending,outsider]) {
  denied(await request(sheetPath,'GET',undefined,account),'Private full sheet for '+account.username);
  denied(await request(accessPath,'GET',undefined,account),'Access settings stay owner-only for '+account.username);
  ok(!(await read('/api/characters',account)).some(c=>c.id===source),'Private full sheet omitted from '+account.username+' collection');
}
denied(await request(accessPath,'GET',undefined,gm),'Campaign GM cannot inspect owner sharing preferences');
equal((await read(sheetPath,gm)).can_edit,true,'GM still sees and edits campaign sheet');
equal((await read(sheetPath,alice)).can_delete,true,'Owner retains delete rights');
denied(await request('/api/characters/'+spare,'GET',undefined,gm),'GM receives no unrelated spare sheet');
const defaultBob=await read(gamePath,bob);
equal(entry(defaultBob).can_open,false,'Private full sheet cannot open from roster');
checkExterior(entry(defaultBob).exterior,['Красная куртка','Синие брюки','Высокие ботинки','Пистолет в руке','Видимый воротник']);
equal(entry(await read(gamePath,pending)),undefined,'Pending applicant cannot see accepted peer roster entries');
equal(entry(await read(gamePath,bob),pendingCharacter),undefined,'Accepted peer cannot see pending applicant identity');

// Grant validation cannot nominate an unrelated account, applicant, owner, or GM.
const beforeInvalid=snapshot(db,['characters','revisions','campaigns','character_sharing']);
for(const playerId of [pending.id,outsider.id,alice.id,gm.id,999999]) {
  denied(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'selected',player_ids:[playerId]},alice),'Reject ineligible sharing recipient '+playerId);
}
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'selected',player_ids:[bob.id,bob.id]},alice),400,'Reject duplicate recipients'); checks++;
denied(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'everyone',player_ids:[]},alice),'Reject unknown sharing mode');
denied(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'party',player_ids:[]},{...alice,csrf:''}),'Sharing writes require CSRF');
denied(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'party',player_ids:[]},bob),'Peer cannot change owner grants');
denied(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'party',player_ids:[]},gm),'GM cannot change owner grants');
equal(snapshot(db,['characters','revisions','campaigns','character_sharing']),beforeInvalid,'Rejected grants leave all sheet/campaign/access data unchanged');

// Recheck current ownership/participation in the transaction, after the earlier
// owner and campaign reads. A stale authorization snapshot is never sufficient.
const grantRaceBefore=snapshot(db,['campaigns','revisions','character_sharing']);
t.beforeBatch(raceDb=>raceDb.prepare("UPDATE campaign_characters SET status='pending' WHERE campaign_id=? AND character_id=?").run(gameId,source));
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'selected',player_ids:[bob.id]},alice),409,'Source ceases accepted participation before access write'); checks++;
equal(snapshot(db,['campaigns','revisions','character_sharing']),grantRaceBefore,'Participation race creates no grant or campaign change');
db.prepare("UPDATE campaign_characters SET status='active' WHERE campaign_id=? AND character_id=?").run(gameId,source);
const raceSourceLink=db.prepare('SELECT * FROM campaign_characters WHERE campaign_id=? AND character_id=?').get(gameId,source);
t.beforeBatch(raceDb=>raceDb.prepare('DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=?').run(gameId,source));
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'selected',player_ids:[bob.id]},alice),409,'Source withdraws before access write'); checks++;
equal(snapshot(db,['campaigns','revisions','character_sharing']),grantRaceBefore,'Withdrawal race creates no orphan grant or campaign change');
db.prepare('INSERT INTO campaign_characters(campaign_id,character_id,status,created) VALUES(?,?,?,?)').run(gameId,source,raceSourceLink.status,raceSourceLink.created);
t.beforeBatch(raceDb=>raceDb.prepare('UPDATE characters SET owner_id=? WHERE id=?').run(outsider.id,source));
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'selected',player_ids:[bob.id]},alice),409,'Owner changes before access write'); checks++;
equal(snapshot(db,['campaigns','revisions','character_sharing']),grantRaceBefore,'Ownership race creates no grant or campaign change');
db.prepare('UPDATE characters SET owner_id=? WHERE id=?').run(alice.id,source);

// Failure of the second statement rolls the first grant back, along with the
// campaign version, proving that a half-saved grant cannot be exposed.
db.exec(`CREATE TRIGGER block_sharing_campaign_bump BEFORE UPDATE ON campaigns WHEN OLD.id=${gameId} BEGIN SELECT RAISE(ABORT,'test access rollback'); END`);
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'party',player_ids:[]},alice),503,'Atomic grant transaction rollback'); checks++;
equal(snapshot(db,['campaigns','revisions','character_sharing']),grantRaceBefore,'Failed campaign version bump rolls back grant insertion');
db.exec('DROP TRIGGER block_sharing_campaign_bump');

// A selected peer gets read-only full data, while all other peers remain exterior-only.
const bobBefore=(await read('/api/sync',bob)).signature;
const gameBefore=await read(gamePath,gm);
const selected=await share('selected',[bob.id]);
ok((await read(gamePath,gm)).version>gameBefore.version,'Changing grant invalidates campaign sync version');
ok((await read('/api/sync',bob)).signature!==bobBefore,'Grant changes recipient sync signature');
const shared=await read(sheetPath,bob);
equal(shared.data.notes,'PRIVATE SHEET NOTES','Authorized recipient gets full sheet');
equal(shared.data.cash,987654,'Authorized recipient gets private numeric fields');
equal(shared.can_edit,false,'Shared recipient cannot edit');
equal(shared.can_delete,false,'Shared recipient cannot delete');
equal(shared.access,'shared','Full shared view identifies read-only access');
ok((await read('/api/characters',bob)).some(c=>c.id===source&&c.access==='shared'),'Shared full view appears in permitted collection');
equal(entry(await read(gamePath,bob)).can_open,true,'Selected peer can open full sheet');
equal(entry(await read(gamePath,charlie)).can_open,false,'Unselected peer sees appearance only');
for(const account of [charlie,pending,outsider])denied(await request(sheetPath,'GET',undefined,account),'Selected sharing does not authorize '+account.username);
denied(await request(sheetPath+'/history','GET',undefined,bob),'Full sharing does not expose revision actors/reasons/history');
const beforePeerMutation=snapshot(db,['characters','revisions','campaigns','character_sharing']);
denied(await request(sheetPath,'PUT',{version:shared.version,data:{...shared.data,cash:0},reason:'Unauthorized'},bob),'Shared recipient cannot save full sheet');
denied(await request(sheetPath,'DELETE',{version:shared.version},bob),'Shared recipient cannot delete full sheet');
denied(await request(accessPath,'PUT',{campaign_id:gameId,version:selected.version,mode:'party',player_ids:[]},bob),'Shared recipient cannot widen access');
denied(await request(gamePath+'/export','GET',undefined,bob),'Read-only sheet grant does not authorize GM campaign export');
equal(snapshot(db,['characters','revisions','campaigns','character_sharing']),beforePeerMutation,'Read-only peer mutations have no database effects');
equal((await read(sheetPath+'/history',alice)).length,1,'Owner history remains available');
equal((await read(sheetPath+'/history',gm)).length,1,'GM history remains available');

// Matching grant revision is mandatory, including first-write version 0 races.
const beforeStale=snapshot(db,['characters','revisions','campaigns','character_sharing']);
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:0,mode:'party',player_ids:[]},alice),409,'Stale access update'); checks++;
equal(snapshot(db,['characters','revisions','campaigns','character_sharing']),beforeStale,'Stale grant cannot increment campaign or overwrite recipient list');
expect(await request(accessPath,'PUT',{campaign_id:gameId,version:selected.version+1,mode:'private',player_ids:[]},alice),409,'Future access revision rejected'); checks++;

// Shared full sheet changes must refresh peers even if campaign version did not change.
const bobBeforeSheet=(await read('/api/sync',bob)).signature;
const own=await read(sheetPath,alice);
await write(sheetPath,'PUT',{version:own.version,data:{...own.data,cash:987655},reason:'PRIVATE REVISION REASON'},alice);
ok((await read('/api/sync',bob)).signature!==bobBeforeSheet,'Shared sheet revision participates in recipient sync signature');
equal((await read(sheetPath,bob)).data.cash,987655,'Shared peer receives current sheet revision');
denied(await request(sheetPath+'/history','GET',undefined,bob),'New revisions remain private from shared peer');

// Party mode includes reserve characters, excludes pending and unrelated accounts.
await share('party');
equal((await read(sheetPath,charlie)).access,'shared','Reserve peer participates in party sharing');
for(const account of [pending,outsider])denied(await request(sheetPath,'GET',undefined,account),'Party sharing excludes '+account.username);
equal(entry(await read(gamePath,charlie)).can_open,true,'Party grant exposed to reserve peer roster');

// Clothes reflect layering and deliberate visibility, without leaking mechanics.
let latest=await read(sheetPath,alice);
aliceData={...latest.data,items:[...latest.data.items,item('suit','Закрытый комбинезон','body')]};
await write(sheetPath,'PUT',{version:latest.version,data:aliceData},alice);
checkExterior(entry(await read(gamePath,charlie)).exterior,['Закрытый комбинезон','Высокие ботинки','Пистолет в руке','Видимый воротник']);
latest=await read(sheetPath,alice);
aliceData={...latest.data,items:latest.data.items.map(i=>i.id==='suit'?{...i,visibility:'hidden'}:i)};
await write(sheetPath,'PUT',{version:latest.version,data:aliceData},alice);
// A hidden outer layer still occludes covered inner garments physically.
checkExterior(entry(await read(gamePath,charlie)).exterior,['Высокие ботинки','Пистолет в руке','Видимый воротник']);

// Same character at another table does not carry grants across campaign boundaries.
const otherGameId=(await write('/api/campaigns','POST',{name:'Separate campaign'},otherGm,201)).id;
const otherPath='/api/campaigns/'+otherGameId;
await apply(otherGameId,source,alice);
await apply(otherGameId,outsiderCharacter,outsider);
equal((await accessRow(otherGameId)).mode,'private','New campaign has independent private access default');
denied(await request(sheetPath,'GET',undefined,outsider),'Party grant from campaign A cannot authorize campaign B peer');
equal(entry(await read(otherPath,outsider)).can_open,false,'Other campaign roster respects separate grant');
checkExterior(entry(await read(otherPath,outsider)).exterior,['Высокие ботинки','Пистолет в руке','Видимый воротник']);
equal((await read(sheetPath,otherGm)).can_edit,true,'Actual second campaign GM retains full rights');
await share('selected',[outsider.id],otherGameId);
equal((await read(sheetPath,outsider)).access,'shared','Explicit second campaign grant works');
await share('private',[],otherGameId);
denied(await request(sheetPath,'GET',undefined,outsider),'Revoking campaign B leaves no access through campaign A');
equal((await read(sheetPath,bob)).access,'shared','Revoking other campaign does not revoke campaign A');

// A retained campaign_members row without any accepted character grants no sheet access.
await roster(gameId,bobCharacter,'remove');
ok((await read(gamePath,bob)).is_member,'Removed-character account still has campaign membership');
denied(await request(sheetPath,'GET',undefined,bob),'Former party character cannot receive full party sharing');
ok(!(await read('/api/characters',bob)).some(c=>c.id===source),'Former party character full sheet disappears from collection');
ok(!entry(await read(gamePath,bob))?.exterior,'Former party character cannot continue receiving exterior updates');
await apply(gameId,bobCharacter,bob,'pending');
denied(await request(sheetPath,'GET',undefined,bob),'Pending reapplication does not restore former full access');
await roster(gameId,bobCharacter,'active');
equal((await read(sheetPath,bob)).access,'shared','Accepted party membership restores party mode');

// Revocation is immediate on every full-sheet entry point; exterior stays available.
const beforeRevoke=(await read('/api/sync',bob)).signature;
await share('private');
ok((await read('/api/sync',bob)).signature!==beforeRevoke,'Revocation changes sync signature');
for(const account of [bob,charlie]) {
  denied(await request(sheetPath,'GET',undefined,account),'Revoked peer direct read '+account.username);
  ok(!(await read('/api/characters',account)).some(c=>c.id===source),'Revoked full sheet omitted from '+account.username+' collection');
  const row=entry(await read(gamePath,account));
  equal(row.can_open,false,'Revoked full-sheet roster flag');
  checkExterior(row.exterior,['Высокие ботинки','Пистолет в руке','Видимый воротник']);
}
equal((await read(sheetPath,gm)).can_edit,true,'Revocation does not revoke campaign GM rights');
equal((await read(sheetPath,alice)).can_edit,true,'Revocation does not revoke owner rights');

// Appearance-only peers still need synchronization when the private owner
// changes a publicly visible item; their full-sheet access stays revoked.
const exteriorSyncBefore=(await read('/api/sync',bob)).signature;
const beforePublicClothesUpdate=await read(sheetPath,alice);
await write(sheetPath,'PUT',{version:beforePublicClothesUpdate.version,data:{...beforePublicClothesUpdate.data,items:beforePublicClothesUpdate.data.items.map(i=>i.id==='boots'?{...i,name:'Ботинки со следами краски'}:i)},reason:'PRIVATE STYLE NOTE'},alice);
ok((await read('/api/sync',bob)).signature!==exteriorSyncBefore,'Private exterior item update changes peer sync signature');
const changedExterior=entry(await read(gamePath,bob)).exterior;
ok(changedExterior.items.some(i=>i.name==='Ботинки со следами краски'),'Appearance-only peer receives newly visible outfit details');
ok(!JSON.stringify(changedExterior).includes('PRIVATE STYLE NOTE'),'Appearance change excludes private update reason');
denied(await request(sheetPath,'GET',undefined,bob),'Appearance synchronization does not restore full-sheet access');
ok(!(await read('/api/characters',bob)).some(c=>c.id===source),'Appearance synchronization keeps private sheet outside collection');

// Removing the source sheet prevents surviving grants from exposing it or its exterior.
await share('party');
await roster(gameId,source,'remove');
denied(await request(sheetPath,'GET',undefined,bob),'Source leaving party revokes shared full view');
equal(entry(await read(gamePath,bob)),undefined,'Source leaving party removes exterior');
denied(await request(accessPath,'PUT',{campaign_id:gameId,version:(await read(accessPath,alice)).campaigns.find(c=>c.campaign_id===gameId)?.version??0,mode:'party',player_ids:[]},alice),'Owner cannot grant sheet to a campaign it left');
const pendingSettings=await read('/api/characters/'+pendingCharacter+'/access',pending);
const pendingRow=pendingSettings.campaigns.find(c=>c.campaign_id===gameId);
equal(pendingRow.players,[],'Pending character settings reveal no accepted account identities');
denied(await request('/api/characters/'+pendingCharacter+'/access','PUT',{campaign_id:gameId,version:pendingRow?.version??0,mode:'party',player_ids:[]},pending),'Pending source cannot grant its full sheet to party');

// Legacy archives omit the newly optional visibility/portrait fields. Their
// canonical fingerprint remains valid and importing them must still work.
function canonical(value) {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const legacySource=await fixture();
const legacyPlayer=await legacySource.register('share_legacy_owner');
const legacyOtherPlayer=await legacySource.register('share_legacy_peer');
const legacyCharacter=(await legacySource.write('/api/characters','POST',{data:{...blank('Legacy sheet to transfer'),items:[item('legacyjacket','Legacy jacket','outer')]}},legacyPlayer,201)).id;
const legacyOtherCharacter=(await legacySource.write('/api/characters','POST',{data:blank('Legacy peer sheet')},legacyOtherPlayer,201)).id;
const legacyGame=(await legacySource.write('/api/campaigns','POST',{name:'Legacy archive test'},legacySource.owner,201)).id;
const legacyPath='/api/campaigns/'+legacyGame;
let legacyCampaign=await legacySource.read(legacyPath);
await legacySource.write('/api/campaigns/join','POST',{code:legacyCampaign.invite_code,character_id:legacyCharacter},legacyPlayer,201);
legacyCampaign=await legacySource.read(legacyPath);
await legacySource.write(legacyPath+'/roster','POST',{version:legacyCampaign.version,character_id:legacyCharacter,status:'active'},legacySource.owner);
legacyCampaign=await legacySource.read(legacyPath);
await legacySource.write('/api/campaigns/join','POST',{code:legacyCampaign.invite_code,character_id:legacyOtherCharacter},legacyOtherPlayer,201);
legacyCampaign=await legacySource.read(legacyPath);
await legacySource.write(legacyPath+'/roster','POST',{version:legacyCampaign.version,character_id:legacyOtherCharacter,status:'active'},legacySource.owner);
const legacyArchive=await legacySource.read(legacyPath+'/export');
for(const sheet of legacyArchive.content.characters)for(const data of [sheet.data,...sheet.revisions.map(r=>r.data)]) {
  delete data.appearance.portrait;
  for(const equipment of data.items)delete equipment.visibility;
}
legacyArchive.fingerprint=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(legacyArchive.content)))).toString('hex');
const legacyDest=await fixture();
const legacyBefore=snapshot(legacyDest.db,['campaigns','characters','revisions','campaign_characters']);
const legacyPreview=await legacyDest.write('/api/campaigns/import/preview','POST',{archive:legacyArchive});
equal(legacyPreview.mode,'new','Pre-visibility/portrait archive remains valid for import');
equal(snapshot(legacyDest.db,['campaigns','characters','revisions','campaign_characters']),legacyBefore,'Legacy preview creates no playable data');
const legacyImported=await legacyDest.write('/api/campaigns/import','POST',{archive:legacyArchive,token:legacyPreview.token});
equal(legacyImported.mode,'new','Legacy archive applies successfully');
const legacyRestored=(await legacyDest.read('/api/characters')).find(c=>c.data.name==='Legacy sheet to transfer');
ok(legacyRestored,'Legacy sheet survives import');
equal(legacyRestored.data.items[0].name,'Legacy jacket','Legacy equipment survives import');
equal((await legacyDest.read('/api/characters/'+legacyRestored.id+'/history')).length,1,'Legacy revision data remains compatible');
equal((await legacyDest.read('/api/characters/'+legacyRestored.id+'/access')).campaigns[0].mode,'private','Legacy archive does not invent public sharing rights');

// Imported sheets temporarily belong to the GM. Any grants made under that
// temporary ownership must be cleared when the actual player claims the sheet.
const recoveredOwner=await legacyDest.register('share_recovered_owner');
const recoveredPeer=await legacyDest.register('share_recovered_peer');
const legacyOwnerKey=legacyArchive.content.characters.find(c=>c.data.name==='Legacy sheet to transfer').ownerKey;
const legacyPeerKey=legacyArchive.content.characters.find(c=>c.data.name==='Legacy peer sheet').ownerKey;
const claimCodes=new Map(legacyImported.claimCodes.map(c=>[c.ownerKey,c.code]));
await legacyDest.write('/api/campaigns/claim','POST',{campaignUuid:legacyArchive.campaignUuid,code:claimCodes.get(legacyPeerKey)},recoveredPeer);
const importedSourcePath='/api/characters/'+legacyRestored.id;
const importedSourceAccess=await legacyDest.read(importedSourcePath+'/access');
await legacyDest.write(importedSourcePath+'/access','PUT',{campaign_id:legacyImported.id,version:importedSourceAccess.campaigns[0].version,mode:'party',player_ids:[]});
equal((await legacyDest.read(importedSourcePath,recoveredPeer)).access,'shared','Temporary owner can explicitly grant imported sheet before recovery');
const peerSignatureBeforeClaim=(await legacyDest.read('/api/sync',recoveredPeer)).signature;
const recovered=await legacyDest.write('/api/campaigns/claim','POST',{campaignUuid:legacyArchive.campaignUuid,code:claimCodes.get(legacyOwnerKey)},recoveredOwner);
equal(recovered.characterIds,[legacyRestored.id],'Recovery transfers the intended persistent sheet');
const recoveredSettings=await legacyDest.read(importedSourcePath+'/access',recoveredOwner);
equal(recoveredSettings.campaigns[0].mode,'private','Owner recovery revokes grants chosen by previous temporary owner');
equal(recoveredSettings.campaigns[0].version,0,'Recovered owner starts unconfigured grant revision');
denied(await legacyDest.request(importedSourcePath,'GET',undefined,recoveredPeer),'Former temporary-owner grant cannot expose recovered sheet');
ok((await legacyDest.read('/api/sync',recoveredPeer)).signature!==peerSignatureBeforeClaim,'Claim revocation invalidates peer sync signature');
const recoveredRoster=(await legacyDest.read('/api/campaigns/'+legacyImported.id,recoveredPeer)).roster.find(r=>r.character_id===legacyRestored.id);
equal(recoveredRoster.can_open,false,'Recovered sheet roster returns to exterior-only for peer');
equal(recoveredRoster.exterior.items.map(i=>i.name),['Legacy jacket'],'Recovered owner still exposes ordinary visible outfit');
equal((await legacyDest.read(importedSourcePath,recoveredOwner)).can_delete,true,'Recovered owner gets full ownership rights');
equal((await legacyDest.read(importedSourcePath)).can_edit,true,'GM keeps campaign rights after owner recovery');

console.log(`Character sharing API regression: ${checks} meaningful assertions passed.`);
