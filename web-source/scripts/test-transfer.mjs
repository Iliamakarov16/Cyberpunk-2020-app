import assert from 'node:assert/strict';
import {fixture, expect, snapshot, blank} from './network-fixture.mjs';
function denied(result,label) {assert.ok(result.status>=400&&result.status<500,label+': '+JSON.stringify(result));}
const uuid=()=>crypto.randomUUID();
async function setupCampaign(t, players) {
  const made=await t.write('/api/campaigns','POST',{name:'Travel campaign',description:'Public briefing'},t.owner,201);
  const path='/api/campaigns/'+made.id;
  let game=await t.read(path);
  const chars={};
  for(const [name,{account,status='active'}] of Object.entries(players)) {
    const character=(await t.write('/api/characters','POST',{data:blank(name)},account,201)).id;
    chars[name]=character;
    await t.write('/api/campaigns/join','POST',{code:game.invite_code,character_id:character},account,201);
    if(status!=='pending') {game=await t.read(path);await t.write(path+'/roster','POST',{version:game.version,character_id:character,status});}
  }
  game=await t.read(path);
  await t.write(path,'PUT',{version:game.version,name:game.name,description:game.description,gm_notes:'SECRET IMPORTED GM NOTES',ledger:'Clinic owes 400'});
  return {id:made.id,path,chars};
}
async function workspaceCommand(t,path,command,fields={},account=t.owner) {
  const ws=await t.read(path+'/workspace',account);
  return t.write(path+'/workspace','POST',{version:ws.version,command,...fields},account);
}
const source=await fixture();
const alice=await source.register('transfer_alice');
const bob=await source.register('transfer_bob');
const pending=await source.register('transfer_pending');
const scene=await setupCampaign(source,{Alice:{account:alice},Bob:{account:bob},Pending:{account:pending,status:'pending'},GM:{account:source.owner}});
const {path,chars}=scene;
const contactId=uuid();
await workspaceCommand(source,path,'contact.save',{contact:{id:contactId,name:'Mara',phone:'555-01-20',description:'Fixer',notes:'SECRET FIXER',recipients:[chars.Alice]}});
await workspaceCommand(source,path,'message.send',{contactId,characterIds:[chars.Alice],body:'PRIVATE ALICE COMMUNICATION'});
for(let i=0;i<4;i++) {
  const c=await source.read('/api/characters/'+chars.Alice,alice);
  await source.write('/api/characters/'+chars.Alice,'PUT',{version:c.version,data:{...c.data,cash:c.data.cash+100},reason:'Source change '+i},alice);
}
const archive=await source.read(path+'/export');
assert.equal(archive.format,'night-city-campaign');assert.equal(archive.formatVersion,1);assert.equal(archive.apiVersion,1);
assert.match(archive.campaignUuid,/^[a-f0-9-]{36}$/);
assert.match(archive.fingerprint,/^[a-f0-9]{64}$/);
assert.equal(archive.content.campaign.gm_notes,'SECRET IMPORTED GM NOTES');
assert.ok(JSON.stringify(archive).includes('PRIVATE ALICE COMMUNICATION'));
assert.ok(!JSON.stringify(archive).includes('test-password-2020'));
assert.ok(!JSON.stringify(archive).includes('nightcity_session'));
const privateSnapshot=snapshot(source.db,['campaigns','characters','revisions','campaign_members','campaign_characters','campaign_workspaces']);
for(const player of [alice,bob,pending]) {
  denied(await source.request(path+'/export','GET',undefined,player),'Only GM exports archive');
  denied(await source.request(path+'/backups','GET',undefined,player),'Only GM reads backups');
}
assert.equal(snapshot(source.db,['campaigns','characters','revisions','campaign_members','campaign_characters','campaign_workspaces']),privateSnapshot);

// Export is coherent even if sheet state or GM authority changes during capture.
const captureSheet=source.db.prepare('SELECT * FROM characters WHERE id=?').get(chars.Alice);
source.beforeRead(sql=>sql==='SELECT * FROM campaign_workspaces WHERE campaign_id=?',db=>db.prepare('UPDATE characters SET version=version+1,data=? WHERE id=?').run(JSON.stringify({...JSON.parse(captureSheet.data),cash:9876}),chars.Alice));
expect(await source.request(path+'/export','GET',undefined,source.owner),409,'Export rejects a sheet changed during capture');
source.db.prepare('UPDATE characters SET version=?,data=? WHERE id=?').run(captureSheet.version,captureSheet.data,chars.Alice);
source.beforeRead(sql=>sql==='SELECT * FROM campaign_workspaces WHERE campaign_id=?',db=>db.prepare('UPDATE campaigns SET gm_id=? WHERE id=?').run(bob.id,scene.id));
expect(await source.request(path+'/export','GET',undefined,source.owner),403,'Export rechecks current GM before returning secret archive');
source.db.prepare('UPDATE campaigns SET gm_id=? WHERE id=?').run(source.owner.id,scene.id);

// Same username on a different server does not silently bind character ownership.
const dest=await fixture();
const sameNamedAlice=await dest.register('transfer_alice');
const realAlice=await dest.register('recovered_alice');
const realBob=await dest.register('recovered_bob');
const recoveredPending=await dest.register('recovered_pending');
const preview=await dest.write('/api/campaigns/import/preview','POST',{archive});
assert.equal(preview.mode,'new');assert.equal(preview.campaignId,null);
assert.equal((await dest.read('/api/campaigns')).length,1,'Preview creates no playable campaign');
const imported=await dest.write('/api/campaigns/import','POST',{archive,token:preview.token});
assert.equal(imported.mode,'new');
const destPath='/api/campaigns/'+imported.id;
const preclaimExport=await dest.read(destPath+'/export');
assert.equal(preclaimExport.fingerprint,archive.fingerprint,'Unclaimed temporary ownership does not alter portable campaign fingerprint');
const preclaimPreview=await dest.write('/api/campaigns/import/preview','POST',{archive});
assert.equal(preclaimPreview.mode,'unchanged');
const preclaimData=snapshot(dest.db,['campaigns','characters','revisions','campaign_workspaces']);
const preclaimUnchanged=await dest.write('/api/campaigns/import','POST',{archive,token:preclaimPreview.token});
assert.equal(preclaimUnchanged.mode,'unchanged');
assert.equal(snapshot(dest.db,['campaigns','characters','revisions','campaign_workspaces']),preclaimData);
const importedGame=await dest.read(destPath);
assert.notEqual(importedGame.invite_code,(await source.read(path)).invite_code,'Imported campaign gets a fresh invite');
assert.ok(!(await dest.read('/api/characters',sameNamedAlice)).some(c=>c.data.name==='Alice'),'Display username never assigns ownership');
assert.equal((await dest.read('/api/campaigns',sameNamedAlice)).length,0,'Matching name alone grants no campaign access');
assert.equal((await dest.read(destPath+'/workspace')).data.contacts.find(c=>c.id===contactId).notes,'SECRET FIXER');
assert.equal((await dest.read(destPath+'/workspace')).data.messages.filter(m=>m.body==='PRIVATE ALICE COMMUNICATION').length,1);
denied(await dest.request('/api/campaigns/import','POST',{archive,token:preview.token},dest.owner), 'Import preview is one-time');
const aliceOwner=archive.content.characters.find(c=>c.data.name==='Alice').ownerKey;
const bobOwner=archive.content.characters.find(c=>c.data.name==='Bob').ownerKey;
const pendingOwner=archive.content.characters.find(c=>c.data.name==='Pending').ownerKey;
const codes=new Map(imported.claimCodes.map(c=>[c.ownerKey,c.code]));
assert.ok(codes.get(aliceOwner));assert.ok(codes.get(bobOwner));assert.ok(codes.get(pendingOwner));
denied(await dest.request('/api/campaigns/claim','POST',{campaignUuid:uuid(),code:codes.get(aliceOwner)},realAlice),'Claim code scoped to campaign UUID');
const recoveredAlice=await dest.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:codes.get(aliceOwner)},realAlice);
assert.equal(recoveredAlice.characterIds.length,1);
const destAliceId=recoveredAlice.characterIds[0];
assert.equal((await dest.read('/api/characters/'+destAliceId,realAlice)).owner_id,realAlice.id);
denied(await dest.request('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:codes.get(aliceOwner)},sameNamedAlice),'Claim code is single-use');
await dest.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:codes.get(bobOwner)},realBob);
await dest.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:codes.get(pendingOwner)},recoveredPending);
denied(await dest.request(destPath+'/workspace','GET',undefined,recoveredPending),'Recovering pending sheet does not approve pending player');
assert.equal((await dest.read(destPath,recoveredPending)).is_member,false);
const aliceSheet=await dest.read('/api/characters/'+destAliceId,realAlice);
const history=await dest.read('/api/characters/'+destAliceId+'/history',realAlice);
assert.equal(history.length,5,'Full revisions preserved');
assert.ok(aliceSheet.version>=Math.max(...history.map(r=>r.version)),'Imported CAS version coherent with restored full history');
const aliceWorkspace=await dest.read(destPath+'/workspace',realAlice);
assert.ok(JSON.stringify(aliceWorkspace).includes('PRIVATE ALICE COMMUNICATION'));
assert.ok(!JSON.stringify(aliceWorkspace).includes('SECRET FIXER'));
assert.ok(!JSON.stringify(aliceWorkspace).includes('SECRET IMPORTED GM NOTES'));
assert.equal(aliceWorkspace.data.messages[0].characterId,destAliceId,'Workspace character refs remapped to destination local IDs');
await dest.write('/api/characters/'+destAliceId,'PUT',{version:aliceSheet.version,data:{...aliceSheet.data,cash:2222},reason:'Local Wi-Fi session'},realAlice);
await workspaceCommand(dest,destPath,'message.reply',{contactId,characterId:destAliceId,body:'Reply made on local Wi-Fi',requestId:uuid()},realAlice);
const returned=await dest.read(destPath+'/export');
assert.equal(returned.campaignUuid,archive.campaignUuid,'Campaign stable UUID survives cross-server transfer');
assert.ok(returned.ancestors.includes(archive.fingerprint),'Archive records actual exported ancestor');
assert.equal(returned.content.characters.find(c=>c.data.name==='Alice').ownerKey,aliceOwner,'Stable portable owner key survives recovery to differently named user');

// The authoritative source updates same campaign and preserves existing actual owners.
const returnPreview=await source.write('/api/campaigns/import/preview','POST',{archive:returned});
assert.equal(returnPreview.mode,'update');assert.equal(returnPreview.campaignId,scene.id);
const update=await source.write('/api/campaigns/import','POST',{archive:returned,token:returnPreview.token});
assert.equal(update.id,scene.id);assert.equal(update.mode,'update');
const backOnSource=await source.read('/api/characters/'+chars.Alice,alice);
assert.equal(backOnSource.owner_id,alice.id,'Return import never replaces original local owner with temporary/remote account');
assert.equal(backOnSource.data.cash,2222);
assert.ok(JSON.stringify(await source.read(path+'/workspace',alice)).includes('Reply made on local Wi-Fi'));
const backups=await source.read(path+'/backups');assert.equal(backups.length,1);
const previous=await source.read(path+'/backups/'+backups[0].id);
assert.equal(previous.fingerprint,archive.fingerprint,'Update stores exact prior campaign as backup');
denied(await source.request(path+'/backups/'+backups[0].id,'GET',undefined,alice),'Backup secrets GM-only');

// Identical restore is idempotent and does not bump playable data versions.
const identical=await source.read(path+'/export');
const samePreview=await source.write('/api/campaigns/import/preview','POST',{archive:identical});
assert.equal(samePreview.mode,'unchanged');
const sameBefore=snapshot(source.db,['campaigns','characters','revisions','campaign_members','campaign_characters','campaign_workspaces']);
const unchanged=await source.write('/api/campaigns/import','POST',{archive:identical,token:samePreview.token});
assert.equal(unchanged.mode,'unchanged');
assert.equal(snapshot(source.db,['campaigns','characters','revisions','campaign_members','campaign_characters','campaign_workspaces']),sameBefore);

// Preview token is tied to actor and exact content; hash damage rejected before writes.
denied(await source.request('/api/campaigns/import/preview','POST',{archive:identical},bob),'Member cannot inspect or update existing imported campaign');
const damaged=structuredClone(identical);damaged.content.campaign.gm_notes='Tampered after export';
denied(await source.request('/api/campaigns/import/preview','POST',{archive:damaged},source.owner), 'Archive SHA256 verified');
const stolenPreview=await source.write('/api/campaigns/import/preview','POST',{archive:identical});
denied(await source.request('/api/campaigns/import','POST',{archive:identical,token:stolenPreview.token},bob),'Preview token cannot be borrowed by another account');

// A shared-sheet dependency is checked both in preview and again inside atomic batch.
const secondary=await source.write('/api/campaigns','POST',{name:'Other group sharing Alice'},source.owner,201);
let localAdvance=await dest.read('/api/characters/'+destAliceId,realAlice);
await dest.write('/api/characters/'+destAliceId,'PUT',{version:localAdvance.version,data:{...localAdvance.data,cash:2500},reason:'More local play'},realAlice);
const nextArchive=await dest.read(destPath+'/export');
source.db.prepare("INSERT INTO campaign_characters(campaign_id,character_id,status,created) VALUES(?,?,'active',?)").run(secondary.id,chars.Alice,Math.floor(Date.now()/1000));
const sharedPreview=await source.write('/api/campaigns/import/preview','POST',{archive:nextArchive});
assert.equal(sharedPreview.mode,'conflict');
assert.ok(sharedPreview.conflicts.some(c=>c.includes('Other group sharing Alice')),'Preview names the shared-sheet dependency');
source.db.prepare('DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=?').run(secondary.id,chars.Alice);
const racePreview=await source.write('/api/campaigns/import/preview','POST',{archive:nextArchive});
assert.equal(racePreview.mode,'update');
const dependencyBefore=snapshot(source.db,['campaigns','characters','revisions','campaign_workspaces','campaign_transfer_backups']);
source.beforeBatch(db=>db.prepare("INSERT INTO campaign_characters(campaign_id,character_id,status,created) VALUES(?,?,'active',?)").run(secondary.id,chars.Alice,Math.floor(Date.now()/1000)));
expect(await source.request('/api/campaigns/import','POST',{archive:nextArchive,token:racePreview.token},source.owner),409,'Shared-sheet dependency inserted between preview and batch rejected');
assert.equal(snapshot(source.db,['campaigns','characters','revisions','campaign_workspaces','campaign_transfer_backups']),dependencyBefore,'Dependency race does not partially restore sheets or create backup');
source.db.prepare('DELETE FROM campaign_characters WHERE campaign_id=? AND character_id=?').run(secondary.id,chars.Alice);

// Mid-batch failure restores all domain state and keeps the preview usable.
const importRollbackBefore=snapshot(source.db,['campaigns','characters','revisions','campaign_workspaces','campaign_members','campaign_characters','campaign_transfer_backups','imported_revision_labels']);
source.db.exec(`CREATE TRIGGER block_import_workspace BEFORE UPDATE ON campaign_workspaces WHEN OLD.campaign_id=${scene.id} BEGIN SELECT RAISE(ABORT,'intentional import test rollback'); END`);
expect(await source.request('/api/campaigns/import','POST',{archive:nextArchive,token:racePreview.token},source.owner),503,'Full import transaction rollback');
assert.equal(snapshot(source.db,['campaigns','characters','revisions','campaign_workspaces','campaign_members','campaign_characters','campaign_transfer_backups','imported_revision_labels']),importRollbackBefore);
source.db.exec('DROP TRIGGER block_import_workspace');

// A GM switch after pre-read cannot authorize a write from the former GM.
source.beforeBatch(db=>db.prepare('UPDATE campaigns SET gm_id=? WHERE id=?').run(bob.id,scene.id));
expect(await source.request('/api/campaigns/import','POST',{archive:nextArchive,token:racePreview.token},source.owner),409,'GM permission rechecked at import commit');
assert.equal((await source.read('/api/characters/'+chars.Alice,alice)).data.cash,2222);
source.db.prepare('UPDATE campaigns SET gm_id=? WHERE id=?').run(source.owner.id,scene.id);
await source.write('/api/campaigns/import','POST',{archive:nextArchive,token:racePreview.token});
assert.equal((await source.read('/api/characters/'+chars.Alice,alice)).data.cash,2500);

// A destination edited after a valid preview invalidates its old token.
localAdvance=await dest.read('/api/characters/'+destAliceId,realAlice);
await dest.write('/api/characters/'+destAliceId,'PUT',{version:localAdvance.version,data:{...localAdvance.data,cash:2600},reason:'Archive after preview'},realAlice);
const previewArchive=await dest.read(destPath+'/export');
const expiringPreview=await source.write('/api/campaigns/import/preview','POST',{archive:previewArchive});
assert.equal(expiringPreview.mode,'update');
const editedGame=await source.read(path);
await source.write(path,'PUT',{version:editedGame.version,name:editedGame.name,description:editedGame.description,gm_notes:editedGame.gm_notes+' Changed after preview',ledger:editedGame.ledger});
const expiredBefore=snapshot(source.db,['campaigns','characters','revisions','campaign_workspaces','campaign_transfer_backups']);
expect(await source.request('/api/campaigns/import','POST',{archive:previewArchive,token:expiringPreview.token},source.owner),409,'Destination state changed after preview');
assert.equal(snapshot(source.db,['campaigns','characters','revisions','campaign_workspaces','campaign_transfer_backups']),expiredBefore);

// Both servers edited after common snapshot: conflict preview never applies a branch.
const sourceFork=await source.read('/api/characters/'+chars.Alice,alice);
await source.write('/api/characters/'+chars.Alice,'PUT',{version:sourceFork.version,data:{...sourceFork.data,cash:3333},reason:'Internet branch'},alice);
const destFork=await dest.read('/api/characters/'+destAliceId,realAlice);
await dest.write('/api/characters/'+destAliceId,'PUT',{version:destFork.version,data:{...destFork.data,cash:4444},reason:'Offline branch'},realAlice);
const offlineFork=await dest.read(destPath+'/export');
const forkPreview=await source.write('/api/campaigns/import/preview','POST',{archive:offlineFork});
assert.equal(forkPreview.mode,'conflict');assert.ok(forkPreview.conflicts.length);
const forkBefore=snapshot(source.db,['campaigns','characters','revisions','campaign_members','campaign_characters','campaign_workspaces','campaign_transfer_backups']);
expect(await source.request('/api/campaigns/import','POST',{archive:offlineFork,token:forkPreview.token},source.owner),409,'Divergent branches blocked');
assert.equal(snapshot(source.db,['campaigns','characters','revisions','campaign_members','campaign_characters','campaign_workspaces','campaign_transfer_backups']),forkBefore);

// A new importing server gets claim codes; exporting before recovery preserves labels.
const unclaimed=await fixture();
const unclaimedPreview=await unclaimed.write('/api/campaigns/import/preview','POST',{archive});
const unclaimedApplied=await unclaimed.write('/api/campaigns/import','POST',{archive,token:unclaimedPreview.token});
const reExported=await unclaimed.read('/api/campaigns/'+unclaimedApplied.id+'/export');
assert.equal(reExported.content.characters.find(c=>c.data.name==='Alice').ownerKey,aliceOwner);
assert.equal(reExported.content.owners.find(o=>o.key===aliceOwner).label,'transfer_alice');
assert.ok(reExported.content.members.includes(aliceOwner));
// Ownership recovery remains available after an agreed GM handover.
const handoverBob=await unclaimed.register('handover_bob');
const handoverAlice=await unclaimed.register('handover_alice');
const unclaimedCodes=new Map(unclaimedApplied.claimCodes.map(c=>[c.ownerKey,c.code]));
await unclaimed.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:unclaimedCodes.get(bobOwner)},handoverBob);
const unclaimedPath='/api/campaigns/'+unclaimedApplied.id;
let handoverGame=await unclaimed.read(unclaimedPath);
await unclaimed.write(unclaimedPath+'/transfer','POST',{version:handoverGame.version,user_id:handoverBob.id});
handoverGame=await unclaimed.read(unclaimedPath,handoverBob);
await unclaimed.write(unclaimedPath+'/transfer/accept','POST',{version:handoverGame.version},handoverBob);
const handedExport=await unclaimed.read(unclaimedPath+'/export',handoverBob);
assert.equal(handedExport.content.campaign.gmOwnerKey,bobOwner,'GM handover uses the existing source owner key instead of another server user UUID');
const postHandoverRecovery=await unclaimed.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:unclaimedCodes.get(aliceOwner)},handoverAlice);
assert.equal(postHandoverRecovery.characterIds.length,1,'Unclaimed sheet can be recovered after GM handover');
assert.equal((await unclaimed.read('/api/characters/'+postHandoverRecovery.characterIds[0],handoverAlice)).owner_id,handoverAlice.id);
console.log('Transfer new-server recovery, privacy, full history, same-server return, backups, lineage, and branch conflict tests passed.');

// Twenty linked sheets force guard chunks; SQLite fixture enforces D1's 100-bind cap.
const largeSource=await fixture();
const largeCampaign=await largeSource.write('/api/campaigns','POST',{name:'Large transfer guard test'},largeSource.owner,201);
const largePath='/api/campaigns/'+largeCampaign.id;
let largeGame=await largeSource.read(largePath);
for(let i=0;i<20;i++) {
  const made=await largeSource.write('/api/characters','POST',{data:blank('Large '+String(i).padStart(2,'0'))},largeSource.owner,201);
  await largeSource.write('/api/campaigns/join','POST',{code:largeGame.invite_code,character_id:made.id},largeSource.owner,201);
  largeGame=await largeSource.read(largePath);
  await largeSource.write(largePath+'/roster','POST',{version:largeGame.version,character_id:made.id,status:'active'});
}
await largeSource.read(largePath+'/workspace');
const largeArchive=await largeSource.read(largePath+'/export');
assert.equal(largeArchive.content.characters.length,20);
const largeDest=await fixture();
const largePreview=await largeDest.write('/api/campaigns/import/preview','POST',{archive:largeArchive});
const largeImport=await largeDest.write('/api/campaigns/import','POST',{archive:largeArchive,token:largePreview.token});
const largeDestPath='/api/campaigns/'+largeImport.id;
const largeChanged=(await largeDest.read('/api/characters')).find(c=>c.data.name==='Large 00');
await largeDest.write('/api/characters/'+largeChanged.id,'PUT',{version:largeChanged.version,data:{...largeChanged.data,cash:777},reason:'Large roundtrip'});
const largeReturned=await largeDest.read(largeDestPath+'/export');
const largeReturnPreview=await largeSource.write('/api/campaigns/import/preview','POST',{archive:largeReturned});
assert.equal(largeReturnPreview.mode,'update');
await largeSource.write('/api/campaigns/import','POST',{archive:largeReturned,token:largeReturnPreview.token});
assert.equal((await largeSource.read('/api/characters')).find(c=>c.data.name==='Large 00').data.cash,777);
console.log('Twenty-sheet import guards remain within D1 query limits.');
