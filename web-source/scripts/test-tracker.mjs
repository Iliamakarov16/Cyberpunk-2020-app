import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {createTestModuleLoader} from './test-ts-loader.mjs';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
function statement(sql,args=[]) {
  return {bind(...values){return statement(sql,values)},
    async first(){return sqlite.prepare(sql).get(...args)??null},
    async all(){return {results:sqlite.prepare(sql).all(...args)}},
    async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}},
  };
}
globalThis.__TRACKER_ENV={DB:{prepare:statement,async batch(statements){
  sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}
}},PUBLIC_ORIGIN:'https://tracker.test'};
globalThis.__TRACKER_USER={userId:'test-owner',email:'owner@example.test'};
const modules=createTestModuleLoader({transformSource:source=>source
  .replace("import { env } from 'cloudflare:workers';",'const env=globalThis.__TRACKER_ENV;')
  .replace("import { getChatGPTUser } from '../../chatgpt-auth';",'const getChatGPTUser=async()=>globalThis.__TRACKER_USER;')});
const api=await modules.load('app/api/[[...path]]/route.ts');
async function request(path,method='GET',data,csrf='',cookie='') {
  const headers={'Origin':'https://tracker.test'};
  if(data!==undefined)headers['Content-Type']='application/json';
  if(csrf)headers['X-CSRF-Token']=csrf;
  if(cookie)headers.Cookie=cookie;
  const request=new Request('https://tracker.test'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  const response=await api[method](request);
  return {status:response.status,data:await response.json(),cookies:response.headers.getSetCookie()};
}
const owner=await request('/api/me');assert.equal(owner.status,200);assert.equal(owner.data.platform,true);
const csrf=owner.data.csrf;
const seeded=await request('/api/characters');assert.equal(seeded.data.length,3);
const original=structuredClone(seeded.data[0].data);
assert.equal((await request('/api/characters/1','PUT',{data:original,version:1})).status,403);
original.cash=1900;
const saved=await request('/api/characters/1','PUT',{data:original,version:1,reason:'Тестовая награда'},csrf);
assert.equal(saved.status,200);assert.equal(saved.data.version,2);
assert.equal((await request('/api/characters/1','PUT',{data:original,version:1},csrf)).status,409);
const history=await request('/api/characters/1/history');assert.equal(history.data.length,2);assert.equal(history.data[0].reason,'Тестовая награда');
assert.equal((await request('/api/users','POST',{username:'player',password:'test-password-2020'},csrf)).status,201);
const accounts=await request('/api/users');const player=accounts.data.find(u=>u.username==='player');
const signedIn=await request('/api/login','POST',{username:'player',password:'test-password-2020'});assert.equal(signedIn.status,200);
const cookie=signedIn.cookies.find(x=>x.startsWith('nightcity_session=')).split(';')[0];
const me=await request('/api/me','GET',undefined,'',cookie);assert.equal(me.data.role,'player');assert.equal(me.data.platform,false);
const created=await request('/api/characters','POST',{data:{...original,name:'Игрок'},owner_id:1},me.data.csrf,cookie);assert.equal(created.status,201);
const owned=await request('/api/characters','GET',undefined,'',cookie);assert.equal(owned.data.length,1);
assert.equal(owned.data[0].id,created.data.id);
assert.equal((await request('/api/users','GET',undefined,'',cookie)).status,403);
assert.equal((await request('/api/characters/1/history','GET',undefined,'',cookie)).status,404);
assert.equal((await request('/api/characters/1','PUT',{data:original,version:2},me.data.csrf,cookie)).status,404);
const fresh={...owned.data[0].data,cash:2200};
assert.equal((await request('/api/characters/'+created.data.id,'PUT',{data:fresh,version:1},me.data.csrf,cookie)).status,200);
const revised=await request('/api/characters/'+created.data.id+'/history','GET',undefined,'',cookie);assert.equal(revised.data.length,2);
const defaultPreferences={hints:true,tutorial:true,animations:true,ambient:'quiet'};
const legacyPreferences={hints:false,tutorial:false,animations:true};
const preferences={...legacyPreferences,ambient:'vivid'};
assert.deepEqual((await request('/api/settings')).data,defaultPreferences);
assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,defaultPreferences);
const versionsBefore=(await request('/api/characters')).data.map(c=>[c.id,c.version]);
const revisionCount=sqlite.prepare('SELECT COUNT(*) AS n FROM revisions').get().n;
assert.equal((await request('/api/settings','PUT',preferences,'',cookie)).status,403);
assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,defaultPreferences,'CSRF rejection leaves settings unchanged');
// Stored preferences from older releases and an older client's first PUT gain the quiet default.
sqlite.prepare('INSERT INTO player_settings(user_id,data,updated) VALUES(?,?,?)').run(player.id,JSON.stringify(legacyPreferences),1);
assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,{...legacyPreferences,ambient:'quiet'});
assert.deepEqual((await request('/api/settings','PUT',legacyPreferences,me.data.csrf,cookie)).data,{...legacyPreferences,ambient:'quiet'});
assert.deepEqual((await request('/api/settings','PUT',preferences,me.data.csrf,cookie)).data,preferences);
assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,preferences);
for(const ambient of ['off','quiet','vivid']){
 const next={...preferences,ambient};
 assert.deepEqual((await request('/api/settings','PUT',next,me.data.csrf,cookie)).data,next);
 assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,next);
}
for(const invalid of [{hints:false,tutorial:false}, {...preferences,hints:0}, {...preferences,user_id:1}, {...preferences,unknown:true}, {...preferences,ambient:'bright'}, {...preferences,ambient:null}, {...preferences,ambient:true}, {...preferences,ambient:3}]){
 const stored=sqlite.prepare('SELECT data,updated FROM player_settings WHERE user_id=?').get(player.id);
 assert.equal((await request('/api/settings','PUT',invalid,me.data.csrf,cookie)).status,400);
 assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,preferences,'Invalid payload never changes persisted preferences');
 assert.deepEqual(sqlite.prepare('SELECT data,updated FROM player_settings WHERE user_id=?').get(player.id),stored,'Invalid payload does not write the settings row');
}
const legacyUpdate={hints:true,tutorial:false,animations:false};
assert.deepEqual((await request('/api/settings','PUT',legacyUpdate,me.data.csrf,cookie)).data,{...legacyUpdate,ambient:'vivid'},'An older client preserves the selected background');
assert.deepEqual((await request('/api/settings','GET',undefined,'',cookie)).data,{...legacyUpdate,ambient:'vivid'});
assert.deepEqual((await request('/api/settings','PUT',preferences,me.data.csrf,cookie)).data,preferences);
assert.deepEqual((await request('/api/settings')).data,defaultPreferences,'Player preferences remain account-specific');
const newSession=await request('/api/login','POST',{username:'player',password:'test-password-2020'});
const secondCookie=newSession.cookies.find(x=>x.startsWith('nightcity_session=')).split(';')[0];
assert.deepEqual((await request('/api/settings','GET',undefined,'',secondCookie)).data,preferences);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,revisionCount);
assert.deepEqual((await request('/api/characters')).data.map(c=>[c.id,c.version]),versionsBefore);
const logout=await request('/api/logout','POST',{},me.data.csrf,cookie);assert.equal(logout.status,200);
assert.equal((await request('/api/me','GET',undefined,'','nightcity_signed_out=1')).status,401);
assert.equal((await request('/api/owner-login','POST',{},'','nightcity_signed_out=1')).status,200);
const invalid={...original,cash:-1};assert.equal((await request('/api/characters/1','PUT',{data:invalid,version:2},csrf)).status,400);
const v2={...original,armorMode:'equipment',evAdjustment:-1,appearance:{accent:'teal'},items:[{id:'test-jacket',name:'Куртка',category:'armor',quantity:1,weight:2,equipped:true,slot:'outer',icon:'jacket',description:'Сохранить описание',source:'Core',armor:{type:'soft',coverage:{torso:14,rightArm:14,leftArm:14},ev:0,order:20},modifiers:[{stat:'COOL',value:-1,label:'Проверка',source:'Решение ведущего'}]}]};
assert.equal((await request('/api/characters/1','PUT',{data:v2,version:2},csrf)).status,200);
const reread=(await request('/api/characters')).data.find(c=>c.id===1).data;
assert.equal(reread.schemaVersion,2);assert.equal(reread.armorMode,'equipment');assert.equal(reread.evAdjustment,-1);assert.equal(reread.appearance.accent,'teal');assert.equal(reread.items[0].armor.coverage.rightArm,14);assert.equal(reread.items[0].armor.coverage.head,0);assert.equal(reread.items[0].modifiers[0].source,'Решение ведущего');assert.equal(reread.items[0].id,'test-jacket');
const badEffects=structuredClone(v2);badEffects.items[0].modifiers[0].source='';
assert.equal((await request('/api/characters/1','PUT',{data:badEffects,version:3},csrf)).status,400);
const duplicate=structuredClone(v2);duplicate.items.push(duplicate.items[0]);assert.equal((await request('/api/characters/1','PUT',{data:duplicate,version:3},csrf)).status,400);
assert.equal((await request('/api/characters')).data.find(c=>c.id===1).version,3);
assert.equal((await request('/api/characters/1/history')).data.length,3);
// Deletion is versioned and atomic, including the complete history.
const deleteMe=await request('/api/me','GET',undefined,'',secondCookie);
const disposable=await request('/api/characters','POST',{data:{...original,name:'Удалить игроком'},owner_id:1},deleteMe.data.csrf,secondCookie);
const deletePath='/api/characters/'+disposable.data.id;
const untouchedHistory=sqlite.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=1').get().n;
assert.equal((await request(deletePath,'DELETE',{version:1},'',secondCookie)).status,403);
assert.equal((await request('/api/characters/1','DELETE',{version:3},deleteMe.data.csrf,secondCookie)).status,404);
for(const payload of [{}, {version:'1'}, {version:0}, {version:1.2}, {version:true}, {version:1,owner_id:1}])assert.equal((await request(deletePath,'DELETE',payload,deleteMe.data.csrf,secondCookie)).status,400);
assert.equal((await request(deletePath,'PUT',{data:{...original,name:'Удалить игроком',cash:99},version:1},deleteMe.data.csrf,secondCookie)).status,200);
assert.equal((await request(deletePath,'DELETE',{version:1},deleteMe.data.csrf,secondCookie)).status,409);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(disposable.data.id).n,2);
assert.equal(sqlite.prepare('SELECT version FROM characters WHERE id=?').get(disposable.data.id).version,2);
assert.deepEqual((await request(deletePath,'DELETE',{version:2},deleteMe.data.csrf,secondCookie)).data,{ok:true});
assert.equal(sqlite.prepare('SELECT id FROM characters WHERE id=?').get(disposable.data.id),undefined);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(disposable.data.id).n,0);
assert.equal((await request(deletePath,'DELETE',{version:2},deleteMe.data.csrf,secondCookie)).status,404);
const gmDisposable=await request('/api/characters','POST',{data:{...original,name:'Удалить ведущим'},owner_id:player.id},csrf);
const gmDeletePath='/api/characters/'+gmDisposable.data.id;
sqlite.exec(`CREATE TRIGGER block_test_delete BEFORE DELETE ON characters WHEN OLD.id=${gmDisposable.data.id} BEGIN SELECT RAISE(ABORT,'delete blocked'); END`);
assert.equal((await request(gmDeletePath,'DELETE',{version:1},csrf)).status,503);
assert.equal(sqlite.prepare('SELECT version FROM characters WHERE id=?').get(gmDisposable.data.id).version,1);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(gmDisposable.data.id).n,1);
sqlite.exec('DROP TRIGGER block_test_delete');
assert.equal((await request(gmDeletePath,'DELETE',{version:1},csrf)).status,200);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(gmDisposable.data.id).n,0);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=1').get().n,untouchedHistory);
assert.equal((await request('/api/characters')).data.find(c=>c.id===1).version,3);
// A player can independently create several sheets, but cannot assign them to another account.
const ownOne=await request('/api/characters','POST',{data:{...original,name:'Новый вне пачки'},owner_id:1},deleteMe.data.csrf,secondCookie);
const ownTwo=await request('/api/characters','POST',{data:{...original,name:'Ещё один герой'}},deleteMe.data.csrf,secondCookie);
assert.equal(ownOne.status,201);assert.equal(ownTwo.status,201);
const ownSheets=(await request('/api/characters','GET',undefined,'',secondCookie)).data;
for(const id of [ownOne.data.id,ownTwo.data.id])assert.equal(ownSheets.find(c=>c.id===id).owner_id,player.id);
assert.ok(ownSheets.some(c=>c.id===created.data.id),'Creating another sheet keeps the old sheet');
assert.equal((await request('/api/characters/'+ownOne.data.id,'DELETE',{version:1},deleteMe.data.csrf,secondCookie)).status,200);
assert.ok((await request('/api/characters','GET',undefined,'',secondCookie)).data.some(c=>c.id===ownTwo.data.id),'Deleting one sheet preserves the others');
globalThis.__TRACKER_USER=null;assert.equal((await request('/api/me')).status,401);
sqlite.close();
console.log('Tracker API: seed, save, history, version conflict, CSRF, player access, owner login and isolated persistent player settings, versioned deletion, atomic rollback and player-created multiple sheets passed.');
