import assert from 'node:assert/strict';
import { createHarness, installEnvironment, loadModules } from './ux-hook-harness.mjs';
import { createDemoScene } from '../lib/firefight/scene.mjs';
import { confirmedFixtureScene } from './combat-loadout-fixture.mjs';
import { clickBattleControl } from './battle-ui-navigation.mjs';

// Real SharedBattle transport/role boundary, BattleApp, and adjudication forms.
// Only HTTP responses and renderer are fixtures. No dice or pixel claims.
const env = installEnvironment(), h = createHarness(), retained = new Map();
globalThis.sessionStorage = { getItem: key => retained.get(key) || null, setItem: (key, value) => retained.set(key, value), removeItem: key => retained.delete(key) };
const { BattleApp, SharedBattle } = await loadModules(h, undefined, { actualSharedBattle: true });
let data, calls;
const failures = [];
const protection = () => ({ material: 'Проверенный ГМом материал', sp: 17, coveredZones: ['leftLeg', 'rightLeg'], blocksVision: false, movable: true, flippedCoveredZones: ['torso', 'leftArm', 'rightArm'], flippedBlocksVision: true });
const scene = () => data.battle.scene;
const table = () => scene().props.find(prop => prop.id === 'table-1');
const requests = () => calls.filter(call => call.path.endsWith('/commands'));
const previews = () => calls.filter(call => call.path.endsWith('/preview'));
const lastCommand = () => requests().at(-1)?.body;
const lastPreview = () => previews().at(-1)?.body.command;
const visible = label => h.find(node => node.props['aria-label'] === label);
const field = label => { const node = visible(label); assert(node, 'Missing ' + label); return node; };
const confirm = () => { const node = h.find(node => node.type === 'button' && node.props.className?.includes('confirm-action')); assert(node, 'Expected one preview confirmation'); return node; };
const change = async (label, value) => { field(label).props.onChange({ target: { value: String(value), valueAsNumber: Number(value), checked: value } }); h.render(); await h.flush(); };
const checkKnown = async (checked = true) => {
    const label = h.find(node => node.type === 'label' && h.text(node).includes('Подтверждаю допустимость атаки'));
    assert(label, 'Through-cover GM awareness control');
    h.nodes(label).find(node => node.type === 'input').props.onChange({ target: { checked } }); h.render(); await h.flush();
};
const pick = async cell => { globalThis.__battlePick(cell); h.render(); await h.flush(); };
const pickActor = id => { const actor = scene().actors.find(row => row.id === id); return pick({ actorId: id, x: actor.x, y: actor.y }); };
const pickTable = () => pick({ x: table().x, y: table().y });
const back = async () => { env.window.dispatchEvent(new Event('nightcity-battle-back', { cancelable: true })); h.render(); await h.flush(); };
const refresh = async () => { env.document.dispatchEvent(new Event('visibilitychange')); h.render(); await h.flush(); };

function seed(role = 'gm') {
    const s = confirmedFixtureScene(createDemoScene());
    Object.assign(s, { id: 'cover-ui-test', version: 21, phase: 'combat', round: 2, currentActorId: 'ray', order: ['ray', 'mira', 'guard-1', 'guard-2'], index: 0 });
    s.actors.forEach(actor => { actor.hidden = false; actor.heading = 0; });
    s.actors[0].x = 6; s.actors[0].y = 6;
    s.props.find(prop => prop.id === 'table-1').protection = protection();
    return { role, controlledActorIds: role === 'player' ? ['ray'] : [], viewerActorId: role === 'player' ? 'ray' : null, options: { characters: [] }, battle: { id: s.id, version: s.version, phase: s.phase, scene: s, pending: [], log: [], canUndo: true } };
}

function preview(command) {
    if (command.type === 'flip') return { ok: true, text: 'Подтвердить опрокидывание', footprint: { x: 6, y: 4, w: 2, h: 1 }, coveredZones: protection().flippedCoveredZones, blocksVision: true, actionCost: 1 };
    if (command.type === 'fire') {
        const ruling = command.gmFire, facingReady = typeof ruling?.turnToTarget === 'boolean';
        const throughReady = command.coverMode !== 'through' || ruling?.throughTargetKnown === true && Number.isInteger(ruling?.throughModifier) && Math.abs(ruling.throughModifier) <= 30;
        return { ok: true, text: 'Огневое действие', mode: command.mode, rounds: command.rounds, readyToRoll: facingReady && throughReady, requiresGmFireDecision: !facingReady || !throughReady, unresolvedRulings: [],
            lines: [{ cover: { id: 'table-1' } }],
            targets: command.targetIds.map(id => ({ id, base: 11, modeModifier: ruling?.throughModifier ?? 0, difficulty: 15, allocatedRounds: command.rounds })),
            ...(data.role === 'gm' ? { protectionReview: command.targetIds.map(targetId => ({ targetId, zones: [{ location: 'torso', armorSP: 14, steps: [{ outerSP: 17 }], effectiveSP: 22 }] })) } : {}),
        };
    }
    return { ok: false, error: 'Unsupported fixture preview: ' + command.type };
}

const api = async (path, method = 'GET', body) => {
    calls.push({ path, method, body: structuredClone(body) });
    if (method === 'GET') return structuredClone(data);
    assert.equal(method, 'POST');
    if (path.endsWith('/preview')) return { preview: preview(body.command) };
    assert(path.endsWith('/commands')); assert.equal(body.battleId, data.battle.id); assert.equal(body.expectedVersion, data.battle.version);
    if (body.type === 'declare') {
        assert.equal(data.role, 'player'); assert(!Object.hasOwn(body.action, 'gmFire'));
        data.battle.pending.push({ id: 'player-declaration', actorId: body.action.actorId, action: structuredClone(body.action), status: 'pending' });
    } else {
        assert.equal(data.role, 'gm', 'Production wrapper must preserve the player declaration boundary');
        if (body.type === 'configure-cover') {
            const target = body.target.propId ? scene().props.find(prop => prop.id === body.target.propId) : scene().tiles[body.target.y][body.target.x];
            assert.deepEqual(Object.keys(body.target).sort(), body.target.propId ? ['propId'] : ['x', 'y']); target.protection = structuredClone(body.profile);
        } else if (body.type === 'flip') {
            assert(preview(body).ok); Object.assign(table(), preview(body).footprint, { flipped: true }); scene().actors[0].actions++;
        } else if (body.type === 'fire') {
            assert(preview(body).readyToRoll, 'GM must explicitly settle facing and through-cover decisions before transport'); scene().actors[0].weapon.ammo -= body.rounds; scene().actors[0].actions++;
        } else if (body.type === 'confirm') {
            const declaration = data.battle.pending.find(row => row.id === body.declarationId); assert(declaration);
            assert(preview({ ...declaration.action, gmFire: body.gmFire }).readyToRoll); data.battle.pending = data.battle.pending.filter(row => row.id !== body.declarationId);
        } else if (body.type === 'armor-rule') scene().settings.stagedPenetration = body.enabled;
        else if (body.type === 'rules') scene().settings.cp2020Rulings = structuredClone(body.rulings);
        else assert.fail('Unexpected command ' + body.type);
    }
    data.battle.version++; scene().version = data.battle.version;
    return structuredClone(data);
};
async function mount(role = 'gm', configure = () => {}) {
    h.dispose(); retained.clear(); data = seed(role); calls = []; configure(data);
    h.mount(SharedBattle, { campaignId: 174, campaignName: 'Material cover fixture', accountId: role === 'gm' ? 1 : 2, api, onExit() {} }); await h.flush();
    assert(visible('Быстрые действия боя')); assert.equal(requests().length, 0);
}
async function run(name, work) { try { await work(); console.log('PASS ' + name); } catch (failure) { failures.push({ name, failure }); console.error('FAIL ' + name + ': ' + failure.message); } finally { h.dispose(); retained.clear(); } }
async function openEditor() { await pickTable(); assert(visible('Предмет на карте')); await h.click('Настроить укрытие'); assert(visible('Профиль укрытия')); }
async function setupThrough() {
    const button = h.buttons().find(node => node.props.className?.includes('hotbar-slot') && h.text(node).trim() === 'Атака'); assert(button);
    await h.click(button); assert(visible('Выбор атаки')); await change('Способ огня', 'through'); await h.click('Выбрать цель огня'); await pickActor('guard-1');
    assert(visible('Предпросмотр действия')); assert.equal(lastPreview().coverMode, 'through'); assert.deepEqual(lastPreview().targetIds, ['guard-1']);
}

await run('prop tap opens one object panel and only reviewed GM save writes cover', async () => {
    await mount('gm', response => { delete response.battle.scene.props[0].protection; });
    const before = structuredClone(scene()); await pickTable();
    assert.equal(h.nodes().filter(node => node.props['aria-label'] === 'Предмет на карте').length, 1); assert(!visible('Предпросмотр действия')); assert(!visible('Действия выбранного персонажа'));
    assert.equal(previews().length, 0); assert.equal(requests().length, 0);
    await h.click('Настроить укрытие'); assert(!visible('Предмет на карте')); assert.equal(field('Материал укрытия').props.value, ''); assert.equal(field('SP материала').props.value, '');
    await change('Материал укрытия', 'Выбранный материал'); await change('SP материала', 0); await change('Закрытые зоны · Торс', true);
    assert(h.button('Сохранить профиль укрытия').props.disabled); assert.equal(requests().length, 0); assert.deepEqual(scene(), before);
    await change('Подтверждение профиля укрытия ГМом', true); await h.click('Сохранить профиль укрытия');
    assert.equal(requests().length, 1); assert.equal(lastCommand().type, 'configure-cover'); assert.equal(lastCommand().expectedVersion, 21);
    assert.deepEqual(lastCommand().target, { propId: 'table-1' }); assert.deepEqual(lastCommand().profile, { material: 'Выбранный материал', sp: 0, coveredZones: ['torso'], blocksVision: false, movable: false, flippedCoveredZones: [], flippedBlocksVision: false });
    assert(visible('Предмет на карте')); assert(!visible('Профиль укрытия')); assert.deepEqual(scene().actors, before.actors); assert.deepEqual(table().protection, lastCommand().profile);
});

await run('dirty native Back and Stay retain cover draft, discard and reopen restore saved source', async () => {
    await mount(); await openEditor(); await change('SP материала', 23); await back(); assert(h.button('Продолжить настройку')); assert(!visible('Профиль укрытия'));
    await h.click('Продолжить настройку'); assert.equal(field('SP материала').props.value, 23); assert.equal(requests().length, 0);
    await back(); await h.click('Закрыть без сохранения'); assert(!visible('Профиль укрытия')); await openEditor(); assert.equal(field('SP материала').props.value, 17);
});

await run('remote version locks cover form and a previously captured Save handler', async () => {
    await mount(); await openEditor(); await change('SP материала', 23); await change('Подтверждение профиля укрытия ГМом', true);
    const staleSave = h.button('Сохранить профиль укрытия').props.onClick;
    data.battle.version++; scene().version++; table().protection.sp = 29; await refresh();
    assert.equal(field('SP материала').props.value, 23); assert(h.button('Сохранить профиль укрытия').props.disabled); assert.match(h.text(), /Сцена изменилась/);
    await staleSave(); await h.flush(); assert.equal(requests().length, 0); await back(); await h.click('Закрыть без сохранения'); await openEditor(); assert.equal(field('SP материала').props.value, 29);
});

await run('wall and door configuration submit only coordinates, material and SP', async () => {
    for (const [x, y] of [[2, 2], [7, 12]]) {
        await mount(); await pick({ x, y }); assert(visible('Предмет на карте')); await h.click('Настроить укрытие');
        assert(!visible('Закрытые зоны')); await change('Материал укрытия', 'Материал клетки'); await change('SP материала', 9); await change('Подтверждение профиля укрытия ГМом', true); await h.click('Сохранить профиль укрытия');
        assert.deepEqual(lastCommand().target, { x, y }); assert.deepEqual(lastCommand().profile, { material: 'Материал клетки', sp: 9 });
    }
});

await run('player object inspection exposes no material editor or GM rule controls', async () => {
    await mount('player'); await pickTable(); assert(visible('Предмет на карте')); assert(!h.button('Настроить укрытие')); assert(!visible('Профиль укрытия'));
    assert(!h.text().includes(protection().material)); assert.equal(requests().length, 0);
    await clickBattleControl(h, 'Правила и управление'); assert(!h.button('Включить дополнительный износ брони')); assert(!h.button('Выключить дополнительный износ брони')); assert(!visible('Броня за укрытием · необязательный износ'));
});

await run('movable table direction previews pinned footprint; only confirm sends flip', async () => {
    await mount(); const before = structuredClone(scene()); await pickTable(); await h.click('Опрокинуть ↑');
    assert(!visible('Предмет на карте')); assert(visible('Предпросмотр действия')); assert.equal(requests().length, 0); assert.deepEqual(scene(), before);
    assert.equal(lastPreview().type, 'flip'); assert.equal(lastPreview().propId, 'table-1'); assert.equal(lastPreview().facing, 270); assert.equal(lastPreview().actorId, 'ray');
    assert.deepEqual(globalThis.__battleRendered.propGhost, { x: 6, y: 4, w: 2, h: 1, type: 'table', facing: 270, flipped: true });
    await h.click(confirm()); assert.equal(requests().length, 1); assert.equal(lastCommand().type, 'flip'); assert.equal(lastCommand().expectedVersion, 21); assert.equal(table().flipped, true); assert.equal(scene().actors[0].actions, 1);
    assert.deepEqual(table().protection, before.props[0].protection, 'Flip never invents SP wear or a replacement profile');
});

await run('unconfigured, fixed and already flipped tables expose no flip action', async () => {
    for (const configure of [target => { delete target.protection; }, target => { target.protection.movable = false; }, target => { target.flipped = true; }]) {
        await mount('gm', response => configure(response.battle.scene.props[0])); await pickTable(); assert(!h.button('Опрокинуть ↑')); assert.equal(previews().length, 0); assert.equal(requests().length, 0);
    }
});

await run('through fire survives targeting and requires awareness, numeric modifier and facing', async () => {
    await mount(); const ammo = scene().actors[0].weapon.ammo; await setupThrough();
    assert(!Object.hasOwn(lastPreview(), 'gmFire')); assert(confirm().props.disabled); assert.equal(field('Модификатор обстоятельств прострела').props.value, '');
    assert.match(h.text().replace(/\s+/g, ' '), /броня 14 → укрытие 17 → итоговый SP 22/);
    await h.click('Без разворота'); assert(confirm().props.disabled); assert.deepEqual(lastPreview().gmFire, { turnToTarget: false });
    await checkKnown(); assert(confirm().props.disabled); await change('Модификатор обстоятельств прострела', -31); assert(confirm().props.disabled);
    await change('Модификатор обстоятельств прострела', -4); assert(!confirm().props.disabled);
    assert.deepEqual(lastPreview().gmFire, { turnToTarget: false, throughTargetKnown: true, throughModifier: -4 });
    await checkKnown(false); assert(confirm().props.disabled); await checkKnown();
    assert.equal(requests().length, 0); assert.equal(scene().actors[0].weapon.ammo, ammo); assert.equal(scene().actors[0].actions, 0);
    await h.click(confirm()); assert.equal(requests().length, 1); assert.equal(lastCommand().type, 'fire'); assert.equal(lastCommand().coverMode, 'through'); assert.deepEqual(lastCommand().targetIds, ['guard-1']); assert.deepEqual(lastCommand().gmFire, { turnToTarget: false, throughTargetKnown: true, throughModifier: -4 });
    assert.equal(scene().actors[0].weapon.ammo, ammo - 1); assert.equal(scene().actors[0].actions, 1);
});

await run('zero through modifier is explicit and selecting another target resets GM decisions', async () => {
    await mount(); await setupThrough(); await checkKnown(); await h.click('Подтвердить отсутствие дополнительного штрафа · 0');
    assert(confirm().props.disabled, 'Awareness and zero do not silently choose turning'); await h.click('Разворот · −2'); assert(!confirm().props.disabled);
    assert.deepEqual(lastPreview().gmFire, { turnToTarget: true, throughTargetKnown: true, throughModifier: 0 });
    await pickActor('guard-2'); assert.equal(lastPreview().coverMode, 'through'); assert.deepEqual(lastPreview().targetIds, ['guard-2']); assert(!Object.hasOwn(lastPreview(), 'gmFire')); assert(confirm().props.disabled); assert.equal(field('Модификатор обстоятельств прострела').props.value, '');
    assert.equal(requests().length, 0);
});

await run('real player transport declares through intent without private GM fields or costs', async () => {
    await mount('player'); const before = structuredClone(scene()); await setupThrough();
    assert(!h.button('Без разворота')); assert(!visible('Модификатор обстоятельств прострела')); assert.doesNotMatch(h.text(), /Защита по траектории/); assert(!confirm().props.disabled);
    await h.click(confirm()); assert.equal(requests().length, 1); assert.equal(lastCommand().type, 'declare'); assert.equal(lastCommand().expectedVersion, 21);
    assert.equal(lastCommand().action.type, 'fire'); assert.equal(lastCommand().action.coverMode, 'through'); assert.deepEqual(lastCommand().action.targetIds, ['guard-1']);
    for (const field of ['gmFire', 'gmMelee', 'turnToTarget', 'throughTargetKnown', 'throughModifier']) assert(!Object.hasOwn(lastCommand().action, field));
    assert.deepEqual(scene().actors, before.actors); assert.equal(data.battle.pending.length, 1);
});

await run('GM separately adjudicates a player through declaration before confirming it', async () => {
    await mount('gm', response => { response.battle.pending = [{ id: 'declared-through', status: 'pending', actorId: 'ray', action: { type: 'fire', actorId: 'ray', targetIds: ['guard-1'], mode: 'single', rounds: 1, coverMode: 'through', location: 'random' } }]; });
    await h.click('Заявки'); assert(h.button('Подтвердить и бросить').props.disabled); await h.click('Без разворота'); assert(h.button('Подтвердить и бросить').props.disabled);
    await checkKnown(); assert(h.button('Подтвердить и бросить').props.disabled); await h.click('Подтвердить отсутствие дополнительного штрафа · 0');
    assert(!h.button('Подтвердить и бросить').props.disabled); assert.equal(requests().length, 0); await h.click('Подтвердить и бросить');
    assert.equal(lastCommand().type, 'confirm'); assert.equal(lastCommand().declarationId, 'declared-through'); assert.deepEqual(lastCommand().gmFire, { turnToTarget: false, throughTargetKnown: true, throughModifier: 0 }); assert.equal(data.battle.pending.length, 0);
});

await run('optional armor wear toggle and cover wear convention are separate explicit commands', async () => {
    await mount(); await clickBattleControl(h, 'Правила и управление'); assert.equal(requests().length, 0);
    await h.click('Выключить дополнительный износ брони'); assert.equal(lastCommand().type, 'armor-rule'); assert.equal(lastCommand().enabled, false); assert.equal(scene().settings.stagedPenetration, false);
    await h.click('Включить дополнительный износ брони'); assert.equal(lastCommand().enabled, true); assert.equal(lastCommand().expectedVersion, 22);
    const previous = structuredClone(scene().settings.cp2020Rulings); await change('Броня за укрытием · необязательный износ', 'none'); assert.deepEqual(scene().settings.cp2020Rulings, previous); assert.equal(requests().length, 2);
    await h.click('Подтвердить соглашения сцены'); assert.equal(lastCommand().type, 'rules'); assert.deepEqual(lastCommand().rulings, { ...previous, coverArmorWear: 'none' }); assert.deepEqual(table().protection, protection());
});

await run('cover additions preserve explicit training preparation and dirty Back flow', async () => {
    const training = createDemoScene(); training.id = 'training-cover-regression'; training.version = 8; training.actors.forEach((actor, index) => { actor.characterId = -index - 1; });
    const trainingCommands = [], backRef = { current: null };
    h.mount(BattleApp, { scene: training, role: 'gm', training: true, backRef, onPreview: async () => ({ ok: false }), onCommand: async command => { trainingCommands.push(structuredClone(command)); return { ok: true }; } }); await h.flush();
    await clickBattleControl(h, 'Начать бой'); assert(visible('Учебное оружие и соглашения')); assert(!visible('Профиль укрытия')); assert(h.button('Подтвердить учебное оружие').props.disabled);
    await h.click('Выбрать учебный вариант'); backRef.current(); h.render(); await h.flush(); assert(h.button('Продолжить подготовку')); await h.click('Продолжить подготовку');
    assert.equal(field('Colt AMT 2000 · одиночных за действие').props.value, 1); await change('Подтверждение учебных профилей ГМом', true); await h.click('Подтвердить учебное оружие');
    assert.equal(trainingCommands.length, 1); assert.equal(trainingCommands[0].type, 'prepare-training-loadouts'); assert.equal(trainingCommands[0].expectedVersion, 8); assert.equal(trainingCommands[0].choices.length, 2); assert(!trainingCommands.some(command => command.type === 'start' || command.type === 'configure-cover'));
});

if (failures.length) { for (const { name, failure } of failures) console.error('\n' + name + '\n' + failure.stack); throw new Error(failures.length + ' battle cover UI regression(s) failed.'); }
console.log('Battle cover UI passed: actual object/editor navigation, dirty/stale guards, pinned cover commands, flip preview/confirm, explicit GM through decisions and target resets, production player declaration boundary, GM declaration review, optional armor commands, and unchanged training preparation. HTTP/renderer fixtures; no CP2020 math or browser/device claims.');
