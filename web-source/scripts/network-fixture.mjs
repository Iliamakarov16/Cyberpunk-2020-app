import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {createTestModuleLoader} from './test-ts-loader.mjs';

// The same API source and generated SQL migrations used in production run here.
// When copied to scripts/, no environment override is needed.
const root = process.env.CAMPAIGN_TEST_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  let readHook = null;
  async function beforeRead(sql,args) {if(readHook&&readHook.predicate(sql,args)){const hook=readHook;readHook=null;await hook.run(db);}}
  function statement(sql, args = []) {
    if(args.length>100)throw new Error('D1 test ceiling: maximum 100 bound parameters per query ('+args.length+')');
    if(Buffer.byteLength(sql,'utf8')>100000)throw new Error('D1 test ceiling: SQL exceeds 100000 bytes');
    if(args.some(v=>typeof v==='string'&&Buffer.byteLength(v,'utf8')>2000000))throw new Error('D1 test ceiling: string value exceeds 2000000 bytes');
    return {
      bind(...values) { return statement(sql, values); },
      async first() { await beforeRead(sql,args); return db.prepare(sql).get(...args) ?? null; },
      async all() { await beforeRead(sql,args); return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
  }
  let batchHook = null;
  globalThis.__CAMPAIGN_ENV = {
    DB: { prepare: statement, async batch(statements) {
      if(batchHook) {const hook=batchHook; batchHook=null; await hook(db);}
      db.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    PUBLIC_ORIGIN: 'https://tracker.test',
  };
  globalThis.__CAMPAIGN_USER = { userId: 'campaign-test-owner', email: 'owner@example.test' };
  const unique = ++fixtureNumber;
  const modules=createTestModuleLoader({root,cacheTag:unique,transformSource:source=>source
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
    db, owner, request, beforeBatch(hook){batchHook=hook;}, beforeRead(predicate,run){readHook={predicate,run};},
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

export { fixture, expect, snapshot, blank, root };
