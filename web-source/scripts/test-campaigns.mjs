import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {createTestModuleLoader} from './test-ts-loader.mjs';

// The same API source and generated SQL migrations used in production run here.
// When copied to scripts/, no environment override is needed.
const root = process.env.CAMPAIGN_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url));
const migrationFiles = readdirSync(join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort();
let fixtureNumber = 0;
function applyMigration(db, name) {
  db.exec(readFileSync(join(root, 'drizzle', name), 'utf8').replaceAll('--> statement-breakpoint', ''));
}
async function fixture(seedLegacy, inspectSchema) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of migrationFiles) {
    if (seedLegacy && name.startsWith('0002')) seedLegacy(db);
    applyMigration(db, name);
  }
  if (inspectSchema) inspectSchema(db);
  function statement(sql, args = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
  }
  globalThis.__CAMPAIGN_ENV = {
    DB: { prepare: statement, async batch(statements) {
      db.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    PUBLIC_ORIGIN: 'https://tracker.test',
  };
  globalThis.__CAMPAIGN_USER = { userId: 'campaign-test-owner', email: 'owner@example.test' };
  const modules=createTestModuleLoader({root,cacheTag:++fixtureNumber,transformSource:source=>source
    .replace("import { env } from 'cloudflare:workers';", 'const env=globalThis.__CAMPAIGN_ENV;')
    .replace("import { getChatGPTUser } from '../../chatgpt-auth';", 'const getChatGPTUser=async()=>globalThis.__CAMPAIGN_USER;')});
  const api=await modules.load('app/api/[[...path]]/route.ts');
  async function request(path, method = 'GET', data, account = {}) {
    const headers = { Origin: account.origin || 'https://tracker.test' };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (account.csrf) headers['X-CSRF-Token'] = account.csrf;
    if (account.cookie) headers.Cookie = account.cookie;
    const response = await api[method](new Request('https://tracker.test' + path, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    }));
    return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie() };
  }
  const me = await request('/api/me');
  expect(me, 200, 'Initialize account and runtime migration');
  const owner = { ...me.data, csrf: me.data.csrf, cookie: '' };
  return {
    db, owner, request,
    async register(username, mode = 'player') {
      const registered = await request('/api/register', 'POST', { username, mode, password: 'test-password-2020' });
      expect(registered, 201, `Register ${username}`);
      const cookie = registered.cookies.find(c => c.startsWith('nightcity_session=')).split(';')[0];
      const account = await request('/api/me', 'GET', undefined, { cookie });
      expect(account, 200, `Read ${username} account`);
      return { ...account.data, cookie };
    },
    async read(path, account = owner) { const result = await request(path, 'GET', undefined, account); expect(result, 200, `Read ${path}`); return result.data; },
    async write(path, method, data, account = owner, status = 200) { const result = await request(path, method, data, account); expect(result, status, `${method} ${path}`); return result.data; },
  };
}
function expect(response, status, label) {
  assert.equal(response.status, status, label + ': ' + JSON.stringify(response.data));
}
function snapshot(db, tables) {
  return JSON.stringify(Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
}
function blank(name) {
  return { name, role: 'Соло', special: 'Combat Sense', specialRank: 3, cash: 900, humanity: 60, wounds: 0,
    armorPenalty: 0, stats: { INT: 6, REF: 7, TECH: 5, COOL: 7, ATTR: 5, LUCK: 6, MA: 6, BODY: 6, EMP: 6 },
    armor: {}, skills: [], items: [], notes: 'Личная запись', background: '', condition: '' };
}
const t = await fixture();
const { db, owner, request, read, write } = t;

// Existing sample sheets are shared through a one-time legacy campaign.
const bootstrap = await read('/api/campaigns');
assert.equal(bootstrap.length, 1);
assert.equal((await read('/api/campaigns/' + bootstrap[0].id)).roster.length, 3);
assert.equal(db.prepare("SELECT value FROM meta WHERE key='campaign_migrated'").get().value, '1');
assert.equal((await read('/api/characters')).length, 3);

// A GM/player mode is an interface preference, never server administration.
const alice = await t.register('alice', 'gm');
const bob = await t.register('bob');
const charlie = await t.register('charlie');
assert.equal(alice.role, 'gm'); assert.equal(alice.admin, false);
assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(alice.id).role, 'player');
expect(await request('/api/users', 'GET', undefined, alice), 403, 'GM mode does not grant user administration');
expect(await request('/api/register', 'POST', { username: 'alice', password: 'test-password-2020', mode: 'gm' }), 409, 'Duplicate registration');
expect(await request('/api/mode', 'POST', { mode: 'admin' }, alice), 400, 'Unsupported mode');
expect(await request('/api/mode', 'POST', { mode: 'player' }, { ...alice, csrf: '' }), 403, 'Mode switching needs CSRF');
await write('/api/mode', 'POST', { mode: 'player' }, alice);
assert.equal((await read('/api/me', alice)).role, 'player');
const login = await request('/api/login', 'POST', { username: 'alice', password: 'test-password-2020', mode: 'gm' });
expect(login, 200, 'Mode selected at login');
const freshAliceCookie = login.cookies.find(c => c.startsWith('nightcity_session=')).split(';')[0];
assert.equal((await read('/api/me', { cookie: freshAliceCookie })).role, 'gm');
assert.equal((await read('/api/me', alice)).role, 'gm', 'Mode persists across sessions');
await write('/api/mode', 'POST', { mode: 'player' }, alice);
assert.equal((await read('/api/me', { cookie: freshAliceCookie })).role, 'player');
expect(await request('/api/users', 'GET', undefined, alice), 403, 'Returning to player does not change admin rights');
expect(await request('/api/characters/1', 'GET', undefined, alice), 404, 'Another GM mode user cannot read bootstrap group');

// Own collections remain private even from the original server administrator.
const a1 = await write('/api/characters', 'POST', { data: blank('Алиса — основной'), owner_id: owner.id }, alice, 201);
const a2 = await write('/api/characters', 'POST', { data: blank('Алиса — запасной') }, alice, 201);
const b1 = await write('/api/characters', 'POST', { data: blank('Боб'), owner_id: alice.id }, bob, 201);
const c1 = await write('/api/characters', 'POST', { data: blank('Чарли') }, charlie, 201);
const gmSheet = await write('/api/characters', 'POST', { data: blank('Собственный герой ведущего'), owner_id: bob.id }, owner, 201);
for (const [id, account] of [[a1.id, alice], [a2.id, alice], [b1.id, bob], [c1.id, charlie], [gmSheet.id, owner]]) {
  const sheet = await read('/api/characters/' + id, account);
  assert.equal(sheet.owner_id, account.id, 'Requested foreign owner_id is ignored');
  assert.equal(sheet.can_edit, true); assert.equal(sheet.can_delete, true);
}
for (const account of [owner, bob, charlie]) {
  expect(await request('/api/characters/' + a1.id, 'GET', undefined, account), 404, 'Personal sheet is private');
  expect(await request('/api/characters/' + a1.id + '/history', 'GET', undefined, account), 404, 'Personal history is private');
  assert.ok(!(await read('/api/characters', account)).some(c => c.id === a1.id));
}
const ownData = (await read('/api/characters/' + a1.id, alice)).data;
await write('/api/characters/' + a1.id, 'PUT', { version: 1, data: { ...ownData, cash: 1200 }, reason: 'До кампании' }, alice);
assert.equal((await read('/api/characters/' + a1.id + '/history', alice)).length, 2);

// Every account may own campaigns; changing the display mode does not revoke them.
const made = await write('/api/campaigns', 'POST', { name: 'Долг районной клиники', description: 'Открытая завязка' }, owner, 201);
const campaignPath = '/api/campaigns/' + made.id;
const ownCampaign = await write('/api/campaigns', 'POST', { name: 'Кампания Алисы' }, alice, 201);
assert.equal((await read('/api/campaigns/' + ownCampaign.id, alice)).is_gm, true);
expect(await request('/api/campaigns/' + ownCampaign.id, 'GET'), 404, 'Admin cannot inspect unrelated campaign');
let game = await read(campaignPath);
assert.match(game.invite_code, /^[A-Z0-9]{20}$/);
assert.equal(game.gm_notes, ''); assert.equal(game.ledger, '');
expect(await request(campaignPath, 'PUT', { version: game.version, name: game.name }, { ...owner, csrf: '' }), 403, 'Campaign writes need CSRF');
expect(await request(campaignPath, 'PUT', { version: game.version, name: game.name }, { ...owner, origin: 'https://other.test' }), 403, 'Cross-origin campaign write');
await write(campaignPath, 'PUT', { version: game.version, name: game.name, description: 'Общий бриф', gm_notes: 'Заказчик лжёт', ledger: 'Аванс 1000; долг 250' });
game = await read(campaignPath);
assert.equal(game.gm_notes, 'Заказчик лжёт'); assert.equal(game.ledger, 'Аванс 1000; долг 250');
const privateBefore = snapshot(db, ['campaigns']);
expect(await request(campaignPath, 'PUT', { version: game.version - 1, name: 'Старый черновик', gm_notes: 'Потерять секрет' }, owner), 409, 'Version conflict keeps GM notes');
assert.equal(snapshot(db, ['campaigns']), privateBefore);
expect(await request(campaignPath, 'GET', undefined, alice), 404, 'Without application the campaign is private');

// Codes tolerate human formatting but do not authorize applying another person's sheet.
const invite = game.invite_code;
expect(await request('/api/campaigns/join', 'POST', { code: 'NO-SUCH-CAMPAIGN', character_id: a1.id }, alice), 404, 'Invalid invite');
expect(await request('/api/campaigns/join', 'POST', { code: invite, character_id: b1.id }, alice), 404, 'Cannot apply a foreign sheet');
expect(await request('/api/campaigns/join', 'POST', { code: invite, character_id: a1.id }, { ...alice, csrf: '' }), 403, 'Join requires CSRF');
const formatted = invite.toLowerCase().match(/.{1,4}/g).join(' - ');
await write('/api/campaigns/join', 'POST', { code: formatted, character_id: a1.id }, alice, 201);
game = await read(campaignPath);
assert.equal(game.roster[0].status, 'pending'); assert.equal(game.members.length, 0);
let applicantView = await read(campaignPath, alice);
assert.equal(applicantView.is_member, false);
assert.deepEqual(applicantView.roster.map(r => r.character_id), [a1.id]);
for (const key of ['gm_notes', 'ledger', 'invite_code']) assert.equal(Object.hasOwn(applicantView, key), false, 'GM-only field ' + key);
assert.equal((await read('/api/characters/' + a1.id)).can_edit, false);
assert.equal((await read('/api/characters/' + a1.id)).can_delete, false);
expect(await request('/api/characters/' + a1.id, 'PUT', { version: 2, data: ownData }, owner), 403, 'Pending application is read-only for GM');
expect(await request('/api/characters/' + a1.id, 'DELETE', { version: 2 }, owner), 403, 'GM cannot destroy applicant personal sheet');
expect(await request(campaignPath, 'PUT', { version: game.version, name: 'Украденная кампания' }, alice), 403, 'Applicant cannot edit campaign');
const duplicateBefore = snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']);
expect(await request('/api/campaigns/join', 'POST', { code: invite, character_id: a1.id }, alice), 409, 'Duplicate application');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']), duplicateBefore);

// Pending users see only their own requests; stale decisions cannot mutate roster or membership.
await write('/api/campaigns/join', 'POST', { code: invite, character_id: b1.id }, bob, 201);
assert.deepEqual((await read(campaignPath, bob)).roster.map(r => r.character_id), [b1.id]);
assert.deepEqual((await read(campaignPath, alice)).roster.map(r => r.character_id), [a1.id]);
game = await read(campaignPath);
const rosterBefore = snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']);
expect(await request(campaignPath + '/roster', 'POST', { version: game.version - 1, character_id: b1.id, status: 'active' }, owner), 409, 'Stale approve with current = stale + 1');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']), rosterBefore, 'CAS must guard all subsequent roster/membership statements');
expect(await request(campaignPath + '/roster', 'POST', { version: game.version, character_id: b1.id, status: 'active' }, bob), 403, 'Player cannot approve own application');
expect(await request(campaignPath + '/roster', 'POST', { version: game.version, character_id: b1.id, status: 'pending' }, owner), 400, 'Unsupported roster transition');

// Actual SQLite rollback: campaign version and roster status remain intact on a mid-batch failure.
db.exec(`CREATE TRIGGER block_campaign_accept BEFORE UPDATE ON campaign_characters WHEN OLD.campaign_id=${made.id} AND OLD.character_id=${b1.id} AND NEW.status='active' BEGIN SELECT RAISE(ABORT,'test accept blocked'); END`);
expect(await request(campaignPath + '/roster', 'POST', { version: game.version, character_id: b1.id, status: 'active' }, owner), 503, 'Roster batch rollback');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']), rosterBefore);
db.exec('DROP TRIGGER block_campaign_accept');
await write(campaignPath + '/roster', 'POST', { version: game.version, character_id: a1.id, status: 'active' });
game = await read(campaignPath);
assert.ok(game.members.some(m => m.id === alice.id));
assert.equal((await read('/api/characters/' + a1.id)).can_edit, true);
assert.equal((await read('/api/characters/' + a1.id)).can_delete, false);
const aliceActive = await read('/api/characters/' + a1.id);
await write('/api/characters/' + a1.id, 'PUT', { version: aliceActive.version, data: { ...aliceActive.data, cash: 1400 }, reason: 'Награда ведущего' });
assert.equal((await read('/api/characters/' + a1.id + '/history', alice)).length, 3);
await write(campaignPath + '/roster', 'POST', { version: game.version, character_id: b1.id, status: 'active' });
game = await read(campaignPath);
assert.ok(game.members.some(m => m.id === bob.id));
const activeView = await read(campaignPath, alice);
assert.equal(activeView.is_member, true);
assert.ok(activeView.roster.some(r => r.character_id === b1.id && r.can_open === false));
expect(await request('/api/characters/' + b1.id, 'GET', undefined, alice), 404, 'Party membership does not expose another player full sheet');
expect(await request('/api/characters/' + a2.id, 'GET'), 404, 'Accepted player spare character stays private');
const reserveBefore = snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']);
expect(await request(campaignPath + '/roster', 'POST', { version: game.version - 1, character_id: b1.id, status: 'reserve' }, owner), 409, 'Stale reserve');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']), reserveBefore);
await write(campaignPath + '/roster', 'POST', { version: game.version, character_id: b1.id, status: 'reserve' });
game = await read(campaignPath);
assert.equal(game.roster.find(r => r.character_id === b1.id).status, 'reserve');
assert.equal((await read('/api/characters/' + b1.id)).can_edit, true, 'Reserve remains shared with campaign GM');

// Remove/withdraw are reversible participation changes: sheets and audit history survive.
const aHistory = JSON.stringify(await read('/api/characters/' + a1.id + '/history', alice));
const aVersion = (await read('/api/characters/' + a1.id, alice)).version;
const removeBefore = snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']);
expect(await request(campaignPath + '/roster', 'POST', { version: game.version - 1, character_id: a1.id, status: 'remove' }, owner), 409, 'Stale remove');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'campaign_members']), removeBefore);
await write(campaignPath + '/roster', 'POST', { version: game.version, character_id: a1.id, status: 'remove' });
expect(await request('/api/characters/' + a1.id, 'GET'), 404, 'Removing sheet revokes GM read rights immediately');
expect(await request('/api/characters/' + a1.id + '/history', 'GET'), 404, 'Removing sheet revokes GM history rights');
assert.equal((await read('/api/characters/' + a1.id, alice)).version, aVersion);
assert.equal(JSON.stringify(await read('/api/characters/' + a1.id + '/history', alice)), aHistory);
assert.equal((await read(campaignPath, alice)).is_member, true, 'Accepted account retains campaign membership without a character');
await write('/api/campaigns/join', 'POST', { code: invite, character_id: a1.id }, alice, 201);
game = await read(campaignPath);
await write(campaignPath + '/roster', 'POST', { version: game.version, character_id: a1.id, status: 'active' });
const bHistory = JSON.stringify(await read('/api/characters/' + b1.id + '/history', bob));
expect(await request(campaignPath + '/withdraw', 'POST', { character_id: b1.id }, alice), 404, 'Cannot withdraw foreign sheet');
await write(campaignPath + '/withdraw', 'POST', { character_id: b1.id }, bob);
expect(await request('/api/characters/' + b1.id, 'GET'), 404, 'Withdrawal revokes GM rights');
assert.equal(JSON.stringify(await read('/api/characters/' + b1.id + '/history', bob)), bHistory);
await write('/api/campaigns/join', 'POST', { code: invite, character_id: b1.id }, bob, 201);
game = await read(campaignPath);
await write(campaignPath + '/roster', 'POST', { version: game.version, character_id: b1.id, status: 'active' });

// Rotating the invite keeps the campaign and sheets but invalidates old links/codes.
game = await read(campaignPath);
const rotationBefore = snapshot(db, ['campaigns']);
expect(await request(campaignPath + '/invite', 'POST', { version: game.version - 1 }, owner), 409, 'Stale invite rotation');
assert.equal(snapshot(db, ['campaigns']), rotationBefore);
expect(await request(campaignPath + '/invite', 'POST', { version: game.version }, alice), 403, 'Player cannot rotate invite');
await write(campaignPath + '/invite', 'POST', { version: game.version });
game = await read(campaignPath);
assert.notEqual(game.invite_code, invite);
expect(await request('/api/campaigns/join', 'POST', { code: invite, character_id: c1.id }, charlie), 404, 'Old invitation is invalid');
await write('/api/campaigns/join', 'POST', { code: game.invite_code, character_id: c1.id }, charlie, 201);
assert.ok(!(await read(campaignPath, alice)).roster.some(r => r.character_id === c1.id), 'Members cannot see other pending applications');
assert.deepEqual((await read(campaignPath, charlie)).roster.map(r => r.character_id), [c1.id]);
const cHistory = JSON.stringify(await read('/api/characters/' + c1.id + '/history', charlie));
await write(campaignPath + '/withdraw', 'POST', { character_id: c1.id }, charlie);
expect(await request(campaignPath, 'GET', undefined, charlie), 404, 'Withdrawing an unaccepted request removes campaign access');
assert.equal(JSON.stringify(await read('/api/characters/' + c1.id + '/history', charlie)), cHistory);

// GM handover is offered only to accepted members and needs that specific user's consent.
game = await read(campaignPath);
expect(await request(campaignPath + '/transfer', 'POST', { version: game.version, user_id: charlie.id }, owner), 400, 'Cannot offer handover to nonmember');
expect(await request(campaignPath + '/transfer', 'POST', { version: game.version, user_id: owner.id }, owner), 400, 'Cannot hand over to self');
await write(campaignPath + '/transfer', 'POST', { version: game.version, user_id: bob.id });
game = await read(campaignPath);
assert.equal(game.transfer_to, bob.id);
expect(await request(campaignPath + '/transfer/accept', 'POST', { version: game.version }, alice), 403, 'Only named successor can accept');
const handoverBefore = snapshot(db, ['campaigns', 'campaign_members']);
expect(await request(campaignPath + '/transfer/accept', 'POST', { version: game.version - 1 }, bob), 409, 'Stale handover does not change GM or add predecessor membership');
assert.equal(snapshot(db, ['campaigns', 'campaign_members']), handoverBefore);
await write(campaignPath + '/transfer/accept', 'POST', { version: game.version }, bob);
const successorGame = await read(campaignPath, bob);
assert.equal(successorGame.gm_id, bob.id); assert.equal(successorGame.is_gm, true);
assert.equal(successorGame.transfer_to, null); assert.equal(successorGame.gm_notes, 'Заказчик лжёт');
assert.equal(successorGame.ledger, 'Аванс 1000; долг 250');
assert.ok(successorGame.members.some(m => m.id === owner.id), 'Previous GM stays a participant');
const predecessorGame = await read(campaignPath);
assert.equal(predecessorGame.is_gm, false); assert.equal(predecessorGame.is_member, true);
for (const key of ['gm_notes', 'ledger', 'invite_code']) assert.equal(Object.hasOwn(predecessorGame, key), false, 'Previous GM loses secret ' + key);
expect(await request('/api/characters/' + a1.id, 'GET'), 404, 'Previous GM loses access to foreign sheets');
expect(await request('/api/characters/' + a1.id, 'PUT', { version: aVersion, data: ownData }, owner), 404, 'Previous GM cannot edit foreign sheets');
assert.equal((await read('/api/characters/' + gmSheet.id)).owner_id, owner.id, 'Previous GM retains own personal sheets');
expect(await request('/api/characters/' + gmSheet.id, 'GET', undefined, bob), 404, 'Handover does not expose predecessor personal collection');
assert.equal((await read('/api/characters/' + a1.id, bob)).can_edit, true);
expect(await request(campaignPath, 'PUT', { version: successorGame.version, name: 'Вернуть права' }, owner), 403, 'Server admin cannot edit campaign after handover');
await write('/api/mode', 'POST', { mode: 'player' }, bob);
assert.equal((await read('/api/me', bob)).role, 'player');
assert.equal((await read(campaignPath, bob)).is_gm, true, 'Display mode does not silently surrender a campaign');
expect(await request('/api/users', 'GET', undefined, bob), 403, 'Owning a campaign does not grant administration');

// Deleting a personal sheet removes roster references atomically and advances affected campaign versions.
const disposable = await write('/api/characters', 'POST', { data: blank('Последний лист для удаления') }, charlie, 201);
await write('/api/campaigns/join', 'POST', { code: successorGame.invite_code, character_id: disposable.id }, charlie, 201);
let deletionGame = await read(campaignPath, bob);
await write(campaignPath + '/roster', 'POST', { version: deletionGame.version, character_id: disposable.id, status: 'active' }, bob);
deletionGame = await read(campaignPath, bob);
const disposablePath = '/api/characters/' + disposable.id;
expect(await request(disposablePath, 'DELETE', { version: 1 }, bob), 403, 'New GM also cannot delete a player personal sheet');
const deletionBefore = snapshot(db, ['campaigns', 'campaign_characters', 'characters', 'revisions']);
expect(await request(disposablePath, 'DELETE', { version: 2 }, charlie), 409, 'Stale deletion leaves campaign and roster unchanged');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'characters', 'revisions']), deletionBefore);
db.exec(`CREATE TRIGGER block_final_character_delete BEFORE DELETE ON characters WHEN OLD.id=${disposable.id} BEGIN SELECT RAISE(ABORT,'test final delete blocked'); END`);
expect(await request(disposablePath, 'DELETE', { version: 1 }, charlie), 503, 'Character delete rolls back campaign version and history on failure');
assert.equal(snapshot(db, ['campaigns', 'campaign_characters', 'characters', 'revisions']), deletionBefore);
db.exec('DROP TRIGGER block_final_character_delete');
await write(disposablePath, 'DELETE', { version: 1 }, charlie);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaign_characters WHERE character_id=?').get(disposable.id).n, 0);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(disposable.id).n, 0);
assert.equal((await read(campaignPath, bob)).version, deletionGame.version + 1);
assert.equal((await read(campaignPath, charlie)).is_member, true, 'An approved account remains a member after its last campaign sheet is deleted');
expect(await request(disposablePath, 'GET', undefined, charlie), 404, 'Deleted sheet gone from owner collection');
assert.ok((await read('/api/characters', alice)).some(c => c.id === a2.id), 'The untouched spare character survives every campaign operation');
globalThis.__CAMPAIGN_USER = null;
expect(await request('/api/me'), 401, 'Outer platform gate remains in force');
db.close();

// Schema migration itself does not migrate data. Runtime bootstrap migrates pre-existing sheets once.
const legacyData = blank('Прежний игрок');
let schemaOnlyChecked = false;
const legacy = await fixture(old => {
  old.prepare("INSERT INTO users(id,username,password,role) VALUES(1,'gm','not-used','gm'),(2,'oldplayer','not-used','player')").run();
  old.prepare("INSERT INTO meta(key,value) VALUES('owner_uid','campaign-test-owner'),('owner_csrf','legacy-csrf')").run();
  old.prepare('INSERT INTO characters(id,owner_id,data,version,updated) VALUES(11,2,?,3,100)').run(JSON.stringify(legacyData));
  old.prepare("INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(11,2,?,3,'Старая история',100)").run(JSON.stringify(legacyData));
}, schema => {
  assert.equal(schema.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n, 0, 'SQL migration contains schema only');
  assert.equal(schema.prepare('SELECT COUNT(*) AS n FROM campaign_characters').get().n, 0);
  assert.equal(schema.prepare("SELECT COUNT(*) AS n FROM meta WHERE key='campaign_migrated'").get().n, 0, 'Runtime migration marker is not pre-populated by SQL');
  schemaOnlyChecked = true;
});
assert.ok(schemaOnlyChecked);
const legacyCampaign = (await legacy.read('/api/campaigns'))[0];
assert.equal(legacyCampaign.id, 1);
const migratedView = await legacy.read('/api/campaigns/1');
assert.deepEqual(migratedView.roster.map(r => [r.character_id, r.status]), [[11, 'active']]);
assert.ok(migratedView.members.some(m => m.id === 2));
const migratedSheet = await legacy.read('/api/characters/11');
assert.equal(migratedSheet.version, 3); assert.deepEqual(migratedSheet.data, legacyData);
assert.equal((await legacy.read('/api/characters/11/history'))[0].reason, 'Старая история');
const afterMigration = await legacy.write('/api/characters', 'POST', { data: blank('Новый после переноса'), owner_id: 2 }, legacy.owner, 201);
await legacy.read('/api/me');
assert.equal(legacy.db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n, 1);
assert.equal(legacy.db.prepare('SELECT COUNT(*) AS n FROM campaign_characters').get().n, 1, 'Subsequent personal creations are never migrated into the old group');
assert.equal(legacy.db.prepare('SELECT COUNT(*) AS n FROM campaign_characters WHERE character_id=?').get(afterMigration.id).n, 0);
legacy.db.close();

// Existing but empty installations must not acquire an empty legacy campaign or auto-share later sheets.
const empty = await fixture(old => {
  old.prepare("INSERT INTO users(id,username,password,role) VALUES(1,'gm','not-used','gm')").run();
  old.prepare("INSERT INTO meta(key,value) VALUES('owner_uid','campaign-test-owner'),('owner_csrf','empty-csrf')").run();
});
assert.deepEqual(await empty.read('/api/campaigns'), []);
await empty.write('/api/characters', 'POST', { data: blank('Личный первый') }, empty.owner, 201);
await empty.read('/api/me');
assert.deepEqual(await empty.read('/api/campaigns'), []);
assert.equal(empty.db.prepare('SELECT COUNT(*) AS n FROM campaign_characters').get().n, 0);
empty.db.close();
console.log('Campaign API: registration, persistent GM/player modes without admin escalation, private personal sheets, scoped campaigns and secrets, invitations, pending/active/reserve participation, CAS conflicts, transactional rollback, withdrawal, GM handover, deletion cleanup and one-time legacy migration passed.');
