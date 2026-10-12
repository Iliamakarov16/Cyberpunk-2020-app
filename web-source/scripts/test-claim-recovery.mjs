import assert from 'node:assert/strict';
import {fixture,expect,snapshot,blank} from './network-fixture.mjs';
function denied(result,label){assert.ok(result.status>=400&&result.status<500,label+': '+JSON.stringify(result));}
const source=await fixture();
const alice=await source.register('code_alice');
const bob=await source.register('code_bob');
const game=await source.write('/api/campaigns','POST',{name:'Dropped import response recovery'},source.owner,201);
const sourcePath='/api/campaigns/'+game.id;
let initial=await source.read(sourcePath);
for(const [name,account] of [['Alice',alice],['Bob',bob]]) {
  const c=await source.write('/api/characters','POST',{data:blank(name)},account,201);
  await source.write('/api/campaigns/join','POST',{code:initial.invite_code,character_id:c.id},account,201);
  initial=await source.read(sourcePath);
  await source.write(sourcePath+'/roster','POST',{version:initial.version,character_id:c.id,status:'active'});
}
const archive=await source.read(sourcePath+'/export');
const dest=await fixture();
const recoveredAlice=await dest.register('code_recovered_alice');
const recoveredBob=await dest.register('code_recovered_bob');
const preview=await dest.write('/api/campaigns/import/preview','POST',{archive});
const imported=await dest.write('/api/campaigns/import','POST',{archive,token:preview.token});
// Pretend the successful body never reached the browser; only the campaign survives.
const path='/api/campaigns/'+imported.id;
const recoveryPath=path+'/portable/reissue-claims';
let campaign=await dest.read(path);
await dest.write(path,'PUT',{version:campaign.version,name:campaign.name,description:'Recovery test started',gm_notes:campaign.gm_notes,ledger:campaign.ledger});
campaign=await dest.read(path);
const before=snapshot(dest.db,['campaigns','campaign_portable_owners','characters']);
denied(await dest.request(recoveryPath,'POST',{version:campaign.version},recoveredAlice),'Only current GM can regenerate private codes');
denied(await dest.request(recoveryPath,'POST',{version:campaign.version},{...dest.owner,csrf:''}),'Recovery requires CSRF');
expect(await dest.request(recoveryPath,'POST',{version:campaign.version-1},dest.owner),409,'Recovery stale campaign CAS');
assert.equal(snapshot(dest.db,['campaigns','campaign_portable_owners','characters']),before);

// A trigger failure rolls back all rotated hashes and the companion campaign version.
const rollbackBefore=snapshot(dest.db,['campaigns','campaign_portable_owners','characters']);
dest.db.exec(`CREATE TRIGGER block_code_rotation BEFORE UPDATE ON campaign_portable_owners WHEN OLD.campaign_id=${imported.id} AND OLD.user_id IS NULL BEGIN SELECT RAISE(ABORT,'intentional code rotation rollback'); END`);
expect(await dest.request(recoveryPath,'POST',{version:campaign.version},dest.owner),503,'Code hash rotation rollback');
assert.equal(snapshot(dest.db,['campaigns','campaign_portable_owners','characters']),rollbackBefore);
dest.db.exec('DROP TRIGGER block_code_rotation');
const regenerated=await dest.write(recoveryPath,'POST',{version:campaign.version});
assert.equal(regenerated.campaignUuid,archive.campaignUuid);
assert.equal(regenerated.claimCodes.length,2);
assert.equal(regenerated.version,campaign.version+1);
assert.equal((await dest.read(path)).version,regenerated.version);
const aliceKey=archive.content.characters.find(c=>c.data.name==='Alice').ownerKey;
const bobKey=archive.content.characters.find(c=>c.data.name==='Bob').ownerKey;
const originalCodes=new Map(imported.claimCodes.map(c=>[c.ownerKey,c.code]));
const rotatedCodes=new Map(regenerated.claimCodes.map(c=>[c.ownerKey,c.code]));
assert.notEqual(rotatedCodes.get(aliceKey),originalCodes.get(aliceKey));
assert.notEqual(rotatedCodes.get(bobKey),originalCodes.get(bobKey));
expect(await dest.request('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:originalCodes.get(aliceKey)},recoveredAlice),404,'Superseded code cannot claim ownership');
const aliceClaim=await dest.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:rotatedCodes.get(aliceKey)},recoveredAlice);
assert.equal(aliceClaim.characterIds.length,1);
const aliceId=aliceClaim.characterIds[0];
const aliceBefore=await dest.read('/api/characters/'+aliceId,recoveredAlice);
campaign=await dest.read(path);
const secondRotation=await dest.write(recoveryPath,'POST',{version:campaign.version});
assert.deepEqual(secondRotation.claimCodes.map(c=>c.ownerKey),[bobKey],'Already claimed ownership is never reset or assigned a fresh code');
assert.equal((await dest.read('/api/characters/'+aliceId,recoveredAlice)).version,aliceBefore.version);
expect(await dest.request('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:rotatedCodes.get(bobKey)},recoveredBob),404,'Previous unused code invalid after rotation');

// Recovery remains under the newly accepted GM after campaign handover.
campaign=await dest.read(path);
await dest.write(path+'/transfer','POST',{version:campaign.version,user_id:recoveredAlice.id});
campaign=await dest.read(path,recoveredAlice);
await dest.write(path+'/transfer/accept','POST',{version:campaign.version},recoveredAlice);
campaign=await dest.read(path,recoveredAlice);
const transferredBefore=snapshot(dest.db,['campaigns','campaign_portable_owners']);
denied(await dest.request(recoveryPath,'POST',{version:campaign.version},dest.owner),'Former GM cannot regenerate codes');
assert.equal(snapshot(dest.db,['campaigns','campaign_portable_owners']),transferredBefore);
const handedRotation=await dest.write(recoveryPath,'POST',{version:campaign.version},recoveredAlice);
assert.equal(handedRotation.claimCodes.length,1);
assert.equal(handedRotation.claimCodes[0].ownerKey,bobKey);
const bobClaim=await dest.write('/api/campaigns/claim','POST',{campaignUuid:archive.campaignUuid,code:handedRotation.claimCodes[0].code},recoveredBob);
assert.equal(bobClaim.characterIds.length,1);
assert.equal((await dest.read('/api/characters/'+bobClaim.characterIds[0],recoveredBob)).owner_id,recoveredBob.id);
campaign=await dest.read(path,recoveredAlice);
const noUnclaimed=await dest.write(recoveryPath,'POST',{version:campaign.version},recoveredAlice);
assert.deepEqual(noUnclaimed.claimCodes,[]);
assert.equal((await dest.read(path,recoveredAlice)).version,campaign.version,'No remaining codes leaves data version unchanged');
console.log('Lost import response recovery: GM-only code rotation, CAS, rollback, old-code invalidation, claimed-owner preservation, and handover tests passed.');
