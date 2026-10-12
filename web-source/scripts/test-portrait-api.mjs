import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,expect,blank,snapshot} from './network-fixture.mjs';

// Real API modules and SQLite migrations: no mocked validator or portable format.
let checks=0;
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const status=(response,expected,label)=>{expect(response,expected,label);checks++;};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const portrait='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=';
const firstFrame={fit:'contain',x:0,y:100,zoom:100,height:220,effect:'off'};
const t=await fixture();
const alice=await t.register('portrait_owner');
const bob=await t.register('portrait_peer');
const data={...blank('Портрет с кадрированием'),cash:987654,notes:'PRIVATE PORTRAIT NOTES',background:'PRIVATE PORTRAIT BACKGROUND',condition:'PRIVATE PORTRAIT CONDITION',
  appearance:{accent:'violet',portrait,portraitFrame:firstFrame}};
const created=await t.write('/api/characters','POST',{data},alice,201);
const sheetPath='/api/characters/'+created.id;
let sheet=await t.read(sheetPath,alice);
equal(sheet.data.appearance,data.appearance,'POST and GET preserve all six frame fields exactly');
equal(sheet.version,1,'Creating a framed portrait starts at version 1');
equal(JSON.parse(t.db.prepare('SELECT data FROM revisions WHERE character_id=?').get(created.id).data).appearance,data.appearance,'Creation revision preserves exact framing');

// Every allowed fit/effect pair, plus both inclusive bounds for every number.
const effects=['off','foil','scan','pulse','tilt'];
const frames=[firstFrame];
for(const fit of ['contain','cover'])for(const [index,effect] of effects.entries()) {
  const high=(fit==='cover')!==(index%2===0);
  const frame={fit,x:high?100:0,y:high?0:100,zoom:high?300:100,height:high?520:220,effect};
  await t.write(sheetPath,'PUT',{version:sheet.version,data:{...sheet.data,appearance:{accent:'violet',portrait,portraitFrame:frame}},reason:`Frame ${fit}/${effect}`},alice);
  sheet=await t.read(sheetPath,alice);
  frames.push(frame);
  equal(sheet.data.appearance,{accent:'violet',portrait,portraitFrame:frame},`PUT/GET exact ${fit}/${effect} and inclusive bounds`);
  equal(sheet.version,frames.length,'Each accepted framing update advances one version');
}
const storedFrames=t.db.prepare('SELECT data FROM revisions WHERE character_id=? ORDER BY version').all(created.id).map(row=>JSON.parse(row.data).appearance.portraitFrame);
equal(storedFrames,frames,'Every accepted framing state is persisted independently in full revisions');

// Optional metadata is absent on old sheets and remains absent after other edits.
const legacy=await t.write('/api/characters','POST',{data:{...blank('Старый портрет'),appearance:{accent:'teal',portrait}}},alice,201);
const legacyPath='/api/characters/'+legacy.id;
let legacySheet=await t.read(legacyPath,alice);
ok(!Object.hasOwn(legacySheet.data.appearance,'portraitFrame'),'Legacy POST/GET does not invent portrait metadata');
await t.write(legacyPath,'PUT',{version:legacySheet.version,data:{...legacySheet.data,notes:'Legacy unrelated edit'}},alice);
legacySheet=await t.read(legacyPath,alice);
ok(!Object.hasOwn(legacySheet.data.appearance,'portraitFrame'),'Unrelated legacy save keeps metadata absent');
for(const row of t.db.prepare('SELECT data FROM revisions WHERE character_id=?').all(legacy.id))ok(!Object.hasOwn(JSON.parse(row.data).appearance,'portraitFrame'),'Legacy revision stays byte-shape compatible');

// The API must reject malformed metadata instead of silently repairing a draft.
const invalid=[];
for(const field of Object.keys(firstFrame)) {
  const frame={...firstFrame};delete frame[field];invalid.push([`missing ${field}`,frame]);
}
invalid.push(['extra field',{...firstFrame,opacity:1}],['unknown replacement field',{fit:'contain',x:50,y:50,zoom:100,height:340,unknown:'off'}]);
for(const frame of [null,[],[...Object.values(firstFrame)],true,false,1,'frame'])invalid.push([`wrong frame type ${JSON.stringify(frame)}`,frame]);
for(const fit of ['stretch','',null,true,1])invalid.push([`invalid fit ${JSON.stringify(fit)}`,{...firstFrame,fit}]);
for(const effect of ['glitch','',null,true,1])invalid.push([`invalid effect ${JSON.stringify(effect)}`,{...firstFrame,effect}]);
for(const [field,min,max] of [['x',0,100],['y',0,100],['zoom',100,300],['height',220,520]]) {
  for(const value of [null,true,false,String(min),min+.5,min-1,max+1])invalid.push([`invalid ${field} ${JSON.stringify(value)}`,{...firstFrame,[field]:value}]);
}
const immutable=snapshot(t.db,['characters','revisions']);
for(const [label,frame] of invalid)for(const method of ['POST','PUT']) {
  const rejected={...sheet.data,appearance:{...sheet.data.appearance,portraitFrame:frame}};
  const result=await t.request(method==='POST'?'/api/characters':sheetPath,method,{data:rejected,...(method==='PUT'?{version:sheet.version}:{})},alice);
  status(result,400,`${method} rejects ${label}`);
  equal(snapshot(t.db,['characters','revisions']),immutable,`${method} rejection leaves every character and revision unchanged: ${label}`);
}

// An accepted peer gets a public exterior with the chosen framing, never stats.
const peer=(await t.write('/api/characters','POST',{data:blank('Участник')},bob,201)).id;
const game=(await t.write('/api/campaigns','POST',{name:'Portrait transfer and privacy'},t.owner,201)).id;
const gamePath='/api/campaigns/'+game;
async function accept(characterId,account,state='active') {
  let campaign=await t.read(gamePath);
  await t.write('/api/campaigns/join','POST',{code:campaign.invite_code,character_id:characterId},account,201);
  campaign=await t.read(gamePath);
  await t.write(gamePath+'/roster','POST',{version:campaign.version,character_id:characterId,status:state});
}
await accept(created.id,alice);
await accept(legacy.id,alice,'reserve');
await accept(peer,bob);
const roster=(await t.read(gamePath,bob)).roster;
const publicRow=roster.find(row=>row.character_id===created.id);
equal(publicRow.can_open,false,'Exterior framing does not grant access to the private full sheet');
equal(Object.keys(publicRow.exterior).sort(),['appearance','character_id','items','name'],'Exterior uses its dedicated public allowlist');
equal(Object.keys(publicRow.exterior.appearance).sort(),['accent','portrait','portraitFrame'],'Public appearance adds only framing metadata');
equal(publicRow.exterior.appearance,sheet.data.appearance,'Public card retains owner-selected fit, position, size and effect');
equal(Object.keys(publicRow.exterior.appearance.portraitFrame).sort(),Object.keys(firstFrame).sort(),'Public frame retains exactly the six approved fields');
for(const secret of ['PRIVATE','987654','"stats":','"notes":','"cash":','"humanity":','"skills":','"background":','"condition":'])ok(!JSON.stringify(publicRow.exterior).includes(secret),'Exterior excludes '+secret);
const denied=await t.request(sheetPath,'GET',undefined,bob);
ok(denied.status>=400&&denied.status<500,'Peer still cannot fetch the private full sheet');
ok(!Object.hasOwn(roster.find(row=>row.character_id===legacy.id).exterior.appearance,'portraitFrame'),'Public legacy exterior does not fabricate framing');

// JSON transfer preserves every current/revision frame and the canonical hash.
const archive=JSON.parse(JSON.stringify(await t.read(gamePath+'/export')));
const exported=archive.content.characters.find(character=>character.data.name===data.name);
equal(exported.data.appearance,sheet.data.appearance,'Campaign export preserves the current framed portrait');
equal(exported.revisions.map(revision=>revision.data.appearance.portraitFrame),frames,'Campaign export preserves every distinct historical frame');
equal(createHash('sha256').update(canonical(archive.content)).digest('hex'),archive.fingerprint,'Portable fingerprint covers the exact appearance and revision content');
const oldExported=archive.content.characters.find(character=>character.data.name===legacySheet.data.name);
ok(!Object.hasOwn(oldExported.data.appearance,'portraitFrame'),'Legacy campaign export keeps metadata absent');
for(const revision of oldExported.revisions)ok(!Object.hasOwn(revision.data.appearance,'portraitFrame'),'Legacy portable revisions keep metadata absent');

const dest=await fixture();
const untouched=snapshot(dest.db,['characters','revisions','campaigns','campaign_characters']);
for(const target of ['current','revision']) {
  const damaged=structuredClone(archive);
  const character=damaged.content.characters.find(character=>character.uuid===exported.uuid);
  const appearance=target==='current'?character.data.appearance:character.revisions[0].data.appearance;
  appearance.portraitFrame.x=appearance.portraitFrame.x===0?1:0;
  status(await dest.request('/api/campaigns/import/preview','POST',{archive:damaged},dest.owner),400,`Changed ${target} framing invalidates the unchanged fingerprint`);
  equal(snapshot(dest.db,['characters','revisions','campaigns','campaign_characters']),untouched,'Damaged framing archive causes no domain writes');
}
const preview=await dest.write('/api/campaigns/import/preview','POST',{archive});
equal(preview.mode,'new','Valid framed campaign can be previewed on another server');
equal(preview.sourceFingerprint,archive.fingerprint,'Preview retains the exact source fingerprint');
const imported=await dest.write('/api/campaigns/import','POST',{archive,token:preview.token});
equal(imported.mode,'new','Valid framed campaign imports normally');
const roundTrip=await dest.read('/api/campaigns/'+imported.id+'/export');
equal(roundTrip.fingerprint,archive.fingerprint,'Re-export fingerprint is unchanged after framed campaign transfer');
equal(roundTrip.content,archive.content,'Current data, complete historical data and all framing numbers survive exact round-trip');
const destinationSheet=(await dest.read('/api/characters')).find(character=>character.data.name===data.name);
equal(destinationSheet.data.appearance,sheet.data.appearance,'Imported character GET preserves the current framed portrait');
equal(dest.db.prepare('SELECT data FROM revisions WHERE character_id=? ORDER BY version').all(destinationSheet.id).map(row=>JSON.parse(row.data).appearance.portraitFrame),frames,'Imported SQLite history preserves each original framing state');
console.log(`Portrait API: ${checks} assertions passed for exact framing, strict POST/PUT rejection without writes, legacy omission, exterior privacy and full campaign/history/fingerprint transfer.`);
