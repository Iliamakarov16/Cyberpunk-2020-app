import assert from 'node:assert/strict';
import { createHarness, installEnvironment, loadModules } from './ux-hook-harness.mjs';
import { createDemoScene } from '../lib/firefight/scene.mjs';
import { clickBattleControl, showBattleActorActions } from './battle-ui-navigation.mjs';

// Real SharedBattle, BattleApp, and adjudication forms; renderer and HTTP are
// fixtures. This exercises the command boundary, not CP2020 dice mathematics.
const env = installEnvironment(), h = createHarness();
const retained = new Map();
globalThis.sessionStorage = { getItem: key => retained.get(key) || null, setItem: (key, value) => retained.set(key, value), removeItem: key => retained.delete(key) };
const { SharedBattle } = await loadModules(h, undefined, { actualSharedBattle: true });
const failures = [];
let data, calls, previewOverride;
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const scene = () => data.battle.scene;
const shooter = () => scene().actors.find(actor => actor.id === 'ray');
const requests = () => calls.filter(call => call.path.endsWith('/commands'));
const previews = () => calls.filter(call => call.path.endsWith('/preview'));
const lastCommand = () => requests().at(-1)?.body;
const lastPreview = () => previews().at(-1)?.body.command;
const visible = label => h.find(node => node.props['aria-label'] === label);
const input = label => { const node = visible(label); assert(node, 'Missing control: ' + label); return node; };
const confirm = () => h.find(node => node.type === 'button' && node.props.className?.includes('confirm-action'));
const text = () => h.text().replace(/\s+/g, ' ');
const change = async (label, value) => { input(label).props.onChange({ target: { value: String(value), valueAsNumber: value === '' ? NaN : Number(value) } }); h.render(); await h.flush(); };
const check = async labelText => { const label = h.find(node => node.type === 'label' && h.text(node).includes(labelText)); assert(label, labelText); const node = h.nodes(label).find(child => child.type === 'input' && child.props.type === 'checkbox'); node.props.onChange({ target: { checked: true } }); h.render(); await h.flush(); };
const pick = async id => { const actor = scene().actors.find(actor => actor.id === id); globalThis.__battlePick({ actorId: id, x: actor.x, y: actor.y }); h.render(); await h.flush(); };
const hotbar = label => { const button = h.buttons().find(node => node.props.className?.includes('hotbar-slot') && h.text(node).trim() === label); assert(button, label); return button; };
const back = async () => { env.window.dispatchEvent(new Event('nightcity-battle-back', { cancelable: true })); h.render(); await h.flush(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const error = message => Object.assign(new Error(message), { status: 409 });

function seed(role = 'gm') {
    const s = createDemoScene();
    s.version = 12; s.phase = 'combat'; s.round = 2; s.currentActorId = 'ray'; s.order = ['ray', 'guard-1', 'guard-2']; s.index = 0;
    s.actors = s.actors.filter(actor => actor.id !== 'mira');
    s.actors.forEach((actor, index) => { actor.hidden = false; actor.x = 6 + index; actor.y = 10; actor.heading = 0; });
    const rifle = { id: 'rifle-confirmed', name: 'Подтверждённый автомат', kind: 'ranged', category: 'Винтовка', skill: 'rifle', skillName: 'Винтовки', skillRank: 4, ammoItemId: 'ammo-rifle', ammo: 12, reserve: 30, magazine: 20, damageDice: 5, damageBonus: 0, accuracy: 1, range: 400, rof: 20, singleActionCap: 3, fireModes: ['single', 'burst', 'auto', 'suppress'], fumbleClass: 'automatic', reliability: 'ST' };
    const knife = { id: 'knife-confirmed', name: 'Подтверждённый нож', kind: 'melee', skillName: 'Ближний бой с оружием', skillKind: 'melee', skillRank: 3, weaponType: 'standard', damageDice: 1, damageBonus: 0, accuracy: 0 };
    Object.assign(s.actors[0], { weapon: structuredClone(rifle), loadout: { schemaVersion: 1, weapons: [rifle, knife], activeWeaponId: rifle.id }, shotsByWeapon: {}, weaponJams: {}, unavailableWeapons: [], meleeSkills: [{ kind: 'brawling', name: 'Драка', rank: 4 }, { kind: 'martialArts', name: 'Каратэ', rank: 2 }, { kind: 'melee', name: 'Ближний бой с оружием', rank: 3 }] });
    s.actors[1].meleeSkills = [{ kind: 'dodge', name: 'Уклонение и освобождение', rank: 4 }, { kind: 'athletics', name: 'Атлетика', rank: 8 }];
    s.settings.cp2020Rulings = { jamAmmo: 'consume-declared', nonautomaticFumbleAmmo: 'consume-attempted', burstHitRounding: 'floor', autoTenRoundGroups: 'floor', autoModifierBasis: 'allocated', autoReducedRounds: 'allow-declared', autoAllocationRemainder: 'consume-unallocated', autoPointBlankModifier: 0, punchRounding: 'down' };
    s.awaitingGmResolution = false; if (role === 'gm') s.unresolvedFumbles = [];
    return { role, controlledActorIds: role === 'player' ? ['ray'] : [], viewerActorId: role === 'player' ? 'ray' : null, options: { characters: [] }, battle: { id: 'foundation-test', version: s.version, phase: s.phase, scene: s, pending: [], log: [], canUndo: true } };
}

function preview(command) {
    const actor = scene().actors.find(actor => actor.id === command.actorId);
    if (scene().awaitingGmResolution && !['rules', 'resolve-fumble'].includes(command.type)) return { ok: false, error: 'Сначала разбери критическую ошибку.' };
    if (actor?.spentTurnClearing && command.type !== 'end') return { ok: false, error: 'Этот ход занят устранением задержки. Заверши ход.' };
    if (command.type === 'fire') {
        assert(!has(command, 'targetId'), 'Foundation fire uses targetIds, not old per-bullet targetId');
        assert(['single', 'burst', 'auto'].includes(command.mode)); assert(command.targetIds.length > 0);
        if (command.rounds > actor.weapon.ammo || command.rounds > actor.weapon.rof - (actor.shotsByWeapon[actor.weapon.id] || 0) || command.mode === 'single' && command.rounds > actor.weapon.singleActionCap || command.mode === 'burst' && command.rounds !== 3) return { ok: false, error: 'Объявленное число патронов превышает подтверждённый предел.' };
        const required = ['jamAmmo'];
        if (command.mode === 'burst') required.push('burstHitRounding');
        if (command.mode === 'auto') {
            if (command.rounds < actor.weapon.rof - (actor.shotsByWeapon[actor.weapon.id] || 0)) required.push('autoReducedRounds');
            if (command.targetIds.length > 1) required.push('autoModifierBasis');
            if (command.rounds % command.targetIds.length) required.push('autoAllocationRemainder');
            const basis = scene().settings.cp2020Rulings.autoModifierBasis === 'declared' ? command.rounds : Math.floor(command.rounds / command.targetIds.length);
            if (basis % 10) required.push('autoTenRoundGroups');
        }
        const unresolved = required.filter(key => !has(scene().settings.cp2020Rulings, key)).map(code => ({ code, message: 'Нужно соглашение ' + code + '.' }));
        return { ok: true, text: 'Огневое действие', mode: command.mode, rounds: command.rounds, readyToRoll: !unresolved.length, requiresGmFireDecision: !command.gmFire, unresolvedRulings: unresolved, targets: command.targetIds.map(id => ({ id, base: command.gmFire?.turnToTarget ? 10 : 12, difficulty: 15, rangeBand: 'close', modeModifier: command.mode === 'burst' ? 3 : 0, allocatedRounds: command.mode === 'auto' ? Math.floor(command.rounds / command.targetIds.length) : command.rounds })) };
    }
    if (command.type === 'melee') {
        const ruling = command.gmMelee;
        if (!ruling) return { ok: true, text: 'Рукопашная атака', distance: 1, requiresGmMeleeDecision: true };
        assert.equal(ruling.defenderAware, true); assert(!has(ruling, 'activeDodge'));
        assert(Number.isInteger(ruling.attackModifier) && Number.isInteger(ruling.defenseModifier));
        if (command.technique === 'punch') assert(['down', 'up'].includes(ruling.punchRounding));
        return { ok: true, text: 'Рукопашная атака', distance: 1, requiresGmMeleeDecision: false, attackBase: 11, defenseBase: ruling.defenseSkillName ? 9 : 5 };
    }
    if (command.type === 'switch') return { ok: true, text: 'Сменить оружие', weaponId: command.weaponId, weaponName: actor.loadout.weapons.find(weapon => weapon.id === command.weaponId)?.name || 'Без оружия', actionCost: 1 };
    if (command.type === 'unjam') return { ok: true, text: 'Устранять задержку', remainingTurns: actor.weaponJams[actor.weapon.id], turnWork: true };
    return { ok: true, text: 'Выполнить', distance: 1, path: [] };
}

const api = async (path, method = 'GET', body) => {
    calls.push({ path, method, body: structuredClone(body) });
    if (method === 'GET') return structuredClone(data);
    assert.equal(method, 'POST');
    if (path.endsWith('/preview')) return { preview: await (previewOverride ? previewOverride(body.command) : preview(body.command)) };
    assert(path.endsWith('/commands')); assert.equal(body.battleId, data.battle.id); assert.equal(body.expectedVersion, data.battle.version);
    if (scene().awaitingGmResolution && !['resolve-fumble', 'rules', 'pause', 'finish', 'undo'].includes(body.type)) throw error('Сначала разбери критическую ошибку.');
    if (body.type === 'declare') {
        assert.equal(data.role, 'player'); assert(!has(body.action, 'gmFire') && !has(body.action, 'gmMelee') && !has(body.action, 'turnToTarget'));
        data.battle.pending.push({ id: 'declared-' + data.battle.version, actorId: body.action.actorId, action: structuredClone(body.action), status: 'pending' });
    } else if (body.type === 'confirm') {
        const declared = data.battle.pending.find(item => item.id === body.declarationId); assert(declared);
        if (declared.action.type === 'fire') assert.equal(typeof body.gmFire?.turnToTarget, 'boolean');
        if (declared.action.type === 'melee') assert(body.gmMelee);
        data.battle.pending = data.battle.pending.filter(item => item.id !== body.declarationId);
    } else if (body.type === 'fire') {
        assert.equal(typeof body.gmFire?.turnToTarget, 'boolean'); assert(preview(body).readyToRoll);
        shooter().weapon.ammo -= body.rounds; shooter().loadout.weapons[0].ammo -= body.rounds; shooter().actions++;
        shooter().shotsByWeapon[shooter().weapon.id] = (shooter().shotsByWeapon[shooter().weapon.id] || 0) + body.rounds;
    } else if (body.type === 'melee') { assert(body.gmMelee); shooter().actions++; }
    else if (body.type === 'switch') { shooter().loadout.activeWeaponId = body.weaponId; shooter().weapon = structuredClone(shooter().loadout.weapons.find(weapon => weapon.id === body.weaponId)); shooter().actions++; }
    else if (body.type === 'unjam') { shooter().weaponJams[shooter().weapon.id]--; shooter().spentTurnClearing = true; }
    else if (body.type === 'rules') scene().settings.cp2020Rulings = structuredClone(body.rulings);
    else if (body.type === 'resolve-fumble') { scene().unresolvedFumbles = scene().unresolvedFumbles.filter(entry => entry.commandId !== body.sourceCommandId); scene().awaitingGmResolution = !!scene().unresolvedFumbles.length; }
    data.battle.version++; scene().version = data.battle.version;
    return structuredClone(data);
};

const props = { campaignId: 174, campaignName: 'Combat foundation fixture', accountId: 1, api, onExit() {} };
async function mount(role = 'gm', configure = () => {}) {
    data = seed(role); calls = []; previewOverride = null; retained.clear(); configure(data);
    h.mount(SharedBattle, { ...props, accountId: role === 'player' ? 2 : 1 }); await h.flush();
    assert(visible('Быстрые действия боя')); assert.equal(requests().length, 0, 'Opening a confirmed scene never mutates it');
}
async function run(name, work) { try { await work(); console.log('PASS ' + name); } catch (failure) { failures.push({ name, failure }); console.error('FAIL ' + name + ': ' + failure.message); } finally { h.dispose(); retained.clear(); } }
async function setupFire(mode = 'single', rounds = 1) {
    await h.click(hotbar('Атака')); assert(visible('Выбор атаки')); assert(!h.find(node => node.type === 'harness-Dialog'), 'Attack setup stays in the map panel');
    await change('Режим огня', mode); if (mode !== 'burst') await change('Патронов в действии', rounds);
    await h.click('Выбрать цель огня'); assert(!visible('Выбор атаки')); await pick('guard-1');
}
async function setupMelee(technique = 'punch', skill = 'Драка') {
    await h.click(hotbar('Атака')); await change('Приём рукопашной', technique); if (technique !== 'weapon') await change('Навык рукопашной атаки', skill);
    await h.click('Выбрать цель рукопашной'); await pick('guard-1');
}
async function chooseDefense() { await change('Навык защиты', '["dodge",""]'); await check('Защитник осознаёт атаку'); await h.click('Обычные условия · 0 / 0'); }
function spaceKey() { const event = new Event('keydown', { cancelable: true }); Object.defineProperties(event, { key: { value: ' ' }, code: { value: 'Space' }, repeat: { value: false }, target: { value: { tagName: 'CANVAS', closest: () => null } } }); env.window.dispatchEvent(event); h.render(); return event; }

await run('grouped single fire requires explicit GM decision and one authoritative command', async () => {
    await mount(); await setupFire('single', 3);
    assert.equal(lastPreview().type, 'fire'); assert.equal(lastPreview().rounds, 3); assert(!has(lastPreview(), 'gmFire')); assert(confirm().props.disabled);
    assert.equal(shooter().weapon.ammo, 12); assert.equal(shooter().actions, 0); assert.equal(requests().length, 0);
    await h.click('Разворот · −2'); assert.deepEqual(lastPreview().gmFire, { turnToTarget: true }); assert(!confirm().props.disabled);
    await h.click(confirm()); const command = lastCommand(); assert.equal(command.type, 'fire'); assert.equal(command.mode, 'single'); assert.equal(command.rounds, 3); assert.deepEqual(command.targetIds, ['guard-1']); assert.equal(command.location, 'random'); assert.deepEqual(command.gmFire, { turnToTarget: true }); assert(!has(command, 'turnToTarget')); assert(!has(command, 'targetId'));
    assert.equal(requests().length, 1); assert.equal(shooter().actions, 1); assert.equal(shooter().weapon.ammo, 9); assert.equal(shooter().shotsByWeapon['rifle-confirmed'], 3);
});

await run('burst selection fixes three rounds and never exposes unsupported suppression', async () => {
    await mount(); await h.click(hotbar('Атака')); assert(!h.nodes(input('Режим огня')).some(node => node.type === 'option' && node.props.value === 'suppress'));
    await change('Режим огня', 'burst'); assert.equal(input('Патронов в действии').props.value, 3); assert(input('Патронов в действии').props.disabled);
    await h.click('Выбрать цель огня'); await pick('guard-1'); assert(confirm().props.disabled); await h.click('Без разворота'); await h.click(confirm());
    assert.equal(lastCommand().mode, 'burst'); assert.equal(lastCommand().rounds, 3); assert.equal(lastCommand().location, 'random'); assert.equal(shooter().actions, 1);
});

await run('auto target changes reset facing and ignore delayed obsolete previews', async () => {
    await mount(); await setupFire('auto', 10);
    const held = deferred(); previewOverride = command => command.gmFire ? held.promise : preview(command);
    await h.click('Без разворота'); await pick('guard-2'); assert.deepEqual(lastPreview().targetIds, ['guard-1', 'guard-2']); assert(!has(lastPreview(), 'gmFire')); assert(confirm().props.disabled);
    held.resolve({ ok: true, text: 'OBSOLETE', readyToRoll: true, targets: [{ id: 'guard-1', base: 999, modeModifier: 0, difficulty: 1, allocatedRounds: 10 }] }); await h.flush();
    assert(!text().includes('999')); assert(confirm().props.disabled);
    previewOverride = null; await h.click('Разворот · −2'); await h.click(confirm()); assert.equal(lastCommand().rounds, 10); assert.deepEqual(lastCommand().targetIds, ['guard-1', 'guard-2']);
});

for (const type of ['fire', 'melee']) await run('player ' + type + ' declaration carries intent only', async () => {
    await mount('player'); const before = structuredClone(shooter());
    if (type === 'fire') await setupFire('burst'); else await setupMelee('kick', 'Каратэ');
    assert(!h.button('Без разворота')); assert(!visible('Навык защиты')); assert(!has(lastPreview(), 'gmFire') && !has(lastPreview(), 'gmMelee'));
    assert.equal(h.text(confirm()).trim(), 'Отправить ГМу'); assert(!confirm().props.disabled); await h.click(confirm());
    const command = lastCommand(); assert.equal(command.type, 'declare'); assert.equal(command.action.type, type); assert(!has(command.action, 'gmFire') && !has(command.action, 'gmMelee') && !has(command.action, 'turnToTarget'));
    assert.deepEqual(shooter(), before, 'A declaration does not consume or simulate anything locally');
    if (type === 'melee') assert.equal(command.action.skillName, 'Каратэ'); else assert.equal(command.action.rounds, 3);
});

await run('opposed melee needs chosen defense despite saved punch convention', async () => {
    await mount(); await setupMelee(); assert(confirm().props.disabled); assert.equal(input('Навык защиты').props.value, ''); assert.equal(input('Округление удара рукой').props.value, 'down'); assert(!has(lastPreview(), 'gmMelee'));
    await chooseDefense(); assert(!confirm().props.disabled); assert.equal(lastPreview().gmMelee.defenseSkillName, ''); assert.equal(lastPreview().gmMelee.defenseSkillKind, 'dodge'); assert.equal(lastPreview().gmMelee.punchRounding, 'down'); assert.match(text(), /11 \+ d10 против 5 \+ d10/);
    assert.equal(shooter().actions, 0); await h.click(confirm()); assert.equal(lastCommand().type, 'melee'); assert.equal(lastCommand().skillName, 'Драка'); assert(!has(lastCommand().gmMelee, 'activeDodge')); assert.equal(shooter().actions, 1);
});

await run('selected martial style requires explicit zero bonus before opposed preview', async () => {
    await mount(); await setupMelee('kick', 'Каратэ'); await chooseDefense(); assert(confirm().props.disabled); assert(!has(lastPreview(), 'gmMelee'));
    await change('Бонус приёма атаки · Каратэ', 0); assert(!confirm().props.disabled); assert.equal(lastPreview().gmMelee.attackTechniqueBonus, 0); await h.click(confirm()); assert.equal(lastCommand().skillName, 'Каратэ');
});

await run('weapon switching is previewed, cancellable, and preserves magazines', async () => {
    await mount(); await showBattleActorActions(h); await h.click('Сменить оружие'); assert(visible('Смена оружия'));
    assert(h.button('Подтверждённый автомат').props.disabled); await h.click('Подтверждённый нож'); assert.equal(lastPreview().type, 'switch'); assert.equal(lastPreview().weaponId, 'knife-confirmed'); assert.equal(shooter().weapon.id, 'rifle-confirmed'); assert.equal(requests().length, 0);
    await h.click('Отменить выбор'); assert.equal(shooter().loadout.activeWeaponId, 'rifle-confirmed');
    await showBattleActorActions(h); await h.click('Сменить оружие'); await h.click('Подтверждённый нож'); await h.click(confirm());
    assert.equal(lastCommand().type, 'switch'); assert.equal(lastCommand().weaponId, 'knife-confirmed'); assert.equal(shooter().loadout.weapons[0].ammo, 12); assert.equal(shooter().weapon.id, 'knife-confirmed');
    await h.click(hotbar('Атака')); assert.equal(input('Приём рукопашной').props.value, 'weapon'); assert(!visible('Навык рукопашной атаки')); await h.click('Выбрать цель рукопашной'); await pick('guard-1'); assert.equal(lastPreview().skillName, 'Ближний бой с оружием');
});

await run('jammed weapon has an explicit one-turn clearing intent', async () => {
    await mount('gm', response => { response.battle.scene.actors[0].weaponJams['rifle-confirmed'] = 2; });
    await h.click(hotbar('Атака')); assert(h.button('Выбрать цель огня').props.disabled); await back(); await showBattleActorActions(h); await h.click('Устранить задержку');
    assert.equal(lastPreview().type, 'unjam'); assert.equal(shooter().weaponJams['rifle-confirmed'], 2); assert.match(text(), /После подтверждения нужно завершить ход/); await h.click(confirm());
    assert.equal(lastCommand().type, 'unjam'); assert.equal(shooter().weaponJams['rifle-confirmed'], 1); assert(shooter().spentTurnClearing); assert(!h.button('Завершить ход').props.disabled);
});

await run('scene conventions persist only after explicit save and feed later punches', async () => {
    await mount('gm', response => { response.battle.scene.settings.cp2020Rulings = {}; });
    await clickBattleControl(h, 'Правила и управление'); await change('Удар рукой · округление d6/2', 'up'); await change('Задержка автоматики · расход патронов', 'consume-declared'); assert.deepEqual(scene().settings.cp2020Rulings, {}); assert.equal(requests().length, 0);
    await change('Автоогонь в упор · модификатор', 101); assert(h.button('Подтвердить соглашения сцены').props.disabled); await change('Автоогонь в упор · модификатор', '');
    await h.click('Подтвердить соглашения сцены'); assert.equal(lastCommand().type, 'rules'); assert.deepEqual(lastCommand().rulings, { punchRounding: 'up', jamAmmo: 'consume-declared' }); assert.equal(lastCommand().expectedVersion, 12); assert.deepEqual(scene().settings.cp2020Rulings, lastCommand().rulings);
    await back(); await setupMelee(); assert.equal(input('Округление удара рукой').props.value, 'up'); assert(confirm().props.disabled, 'Saved rounding is not blanket permission to choose defense');
});

await run('GM fire declaration requires separate facing and resolved scene conventions', async () => {
    await mount('gm', response => { response.battle.scene.settings.cp2020Rulings = {}; response.battle.pending = [{ id: 'fire-declared', actorId: 'ray', status: 'pending', action: { type: 'fire', actorId: 'ray', mode: 'burst', rounds: 3, targetIds: ['guard-1'], location: 'random' } }]; });
    await h.click('Заявки'); assert(h.button('Подтвердить и бросить').props.disabled); await h.click('Без разворота'); assert(h.button('Подтвердить и бросить').props.disabled); assert(h.button('Соглашения сцены'));
    await h.click('Соглашения сцены'); await change('Задержка автоматики · расход патронов', 'consume-declared'); await change('Очередь · округление попаданий d6/2', 'floor'); await h.click('Подтвердить соглашения сцены'); await back(); await h.click('Заявки'); assert(h.button('Подтвердить и бросить').props.disabled, 'Reopening a declaration requires an explicit per-attack decision');
    await h.click('Разворот · −2'); await h.click('Подтвердить и бросить'); assert.equal(lastCommand().type, 'confirm'); assert.equal(lastCommand().declarationId, 'fire-declared'); assert.deepEqual(lastCommand().gmFire, { turnToTarget: true }); assert(!has(lastCommand(), 'gmMelee'));
});

await run('GM melee declaration is separately adjudicated against its actual target', async () => {
    await mount('gm', response => { response.battle.pending = [{ id: 'melee-declared', actorId: 'ray', status: 'pending', action: { type: 'melee', actorId: 'ray', targetId: 'guard-1', technique: 'kick', skillName: 'Каратэ' } }]; });
    await h.click('Заявки'); assert(h.button('Подтвердить и бросить').props.disabled); await chooseDefense(); assert(h.button('Подтвердить и бросить').props.disabled); await change('Бонус приёма атаки · Каратэ', 0); assert(!h.button('Подтвердить и бросить').props.disabled);
    await h.click('Подтвердить и бросить'); assert.equal(lastCommand().declarationId, 'melee-declared'); assert.equal(lastCommand().gmMelee.attackTechniqueBonus, 0); assert.equal(lastCommand().gmMelee.defenseSkillName, ''); assert(!has(lastCommand(), 'gmFire'));
});

function addFumble(response) {
    response.battle.scene.awaitingGmResolution = true;
    if (response.role === 'gm') response.battle.scene.unresolvedFumbles = [{ commandId: 'fumble-source', actorIds: ['ray', 'guard-1'], receipt: { fumbles: [{ fumbleTableRoll: 8, effectCode: 'self-injury', targetId: 'guard-1' }], bulletsSpent: 1 } }];
}
await run('pending fumble gates actions until an explicit visible GM resolution', async () => {
    await mount('gm', addFumble); assert(hotbar('Атака').props.disabled); assert(hotbar('Идти').props.disabled); assert(h.button('Завершить ход').props.disabled);
    await h.click('Разобрать критическую ошибку'); assert.match(text(), /таблица d10: 8/); assert(h.button('Записать решение ГМа').props.disabled);
    await change('Решение ГМа', 'ГМ проверил ситуацию: дополнительных последствий нет.'); await h.click('Записать решение ГМа');
    assert.equal(lastCommand().type, 'resolve-fumble'); assert.equal(lastCommand().sourceCommandId, 'fumble-source'); assert.deepEqual(lastCommand().effects, []); assert.equal(scene().awaitingGmResolution, false); await back(); assert(!hotbar('Атака').props.disabled);
});
await run('player projected fumble gate needs no private receipt', async () => {
    await mount('player', addFumble); assert(!has(scene(), 'unresolvedFumbles')); assert(hotbar('Атака').props.disabled); assert(h.button('Завершить ход').props.disabled); assert(!h.button('Разобрать критическую ошибку')); assert(!visible('Решение ГМа'));
});
for (const role of ['gm', 'player']) await run(role + ' Space cannot bypass unresolved-fumble End gate', async () => {
    await mount(role, addFumble); assert(h.button('Завершить ход').props.disabled); spaceKey(); await h.flush(); assert.equal(requests().length, 0, 'Keyboard must honor the same pending-fumble gate as the disabled End button');
});

await run('burst-only profile opens with exactly three rounds',async()=>{
 await mount('gm',response=>{response.battle.scene.actors[0].weapon.fireModes=['burst'];});await h.click(hotbar('Атака'));assert.equal(input('Режим огня').props.value,'burst');assert.equal(input('Патронов в действии').props.value,3);assert(!h.button('Выбрать цель огня').props.disabled);
});
await run('unsupported suppression-only profile cannot target a fictitious single mode',async()=>{
 await mount('gm',response=>{response.battle.scene.actors[0].weapon.fireModes=['suppress'];});await h.click(hotbar('Атака'));assert(h.button('Выбрать цель огня').props.disabled);assert(!h.button('Выбрать цель рукопашной').props.disabled);
});
await run('remaining ROF and single-action cap gate targeting before the server',async()=>{
 await mount('gm');await h.click(hotbar('Атака'));await change('Патронов в действии',4);assert(h.button('Выбрать цель огня').props.disabled);await change('Режим огня','auto');assert.equal(input('Патронов в действии').props.value,12);assert(!h.button('Выбрать цель огня').props.disabled);
});

if (failures.length) {
    for (const { name, failure } of failures) console.error('\n' + name + '\n' + failure.stack);
    throw new Error(failures.length + ' combat foundation UI regression(s) failed.');
}
console.log('Combat foundation UI: confirmed loadouts, grouped fire modes, player intent boundary, explicit opposed defense, switch/unjam, saved conventions, declaration review, and pending-fumble gates passed. Actual components; HTTP/renderer mocked, no dice or browser-rendering claim.');
