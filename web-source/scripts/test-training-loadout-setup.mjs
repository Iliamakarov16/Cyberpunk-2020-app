import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHarness, installEnvironment, loadModules, moduleUrl, transpile } from './ux-hook-harness.mjs';
import { clickBattleControl, openBattleMenu } from './battle-ui-navigation.mjs';
import { createDemoScene } from '../lib/firefight/scene.mjs';
import { confirmedFixtureActor } from './combat-loadout-fixture.mjs';
import { trainingLoadoutGroups, trainingLoadoutDemoChoices, trainingLoadoutRequiredRulings, trainingLoadoutSetupError, trainingLoadoutRulingsError } from '../lib/firefight/training-loadout.mjs';

const seed = () => {
    const scene = createDemoScene(); scene.id = 'training-test'; scene.version = 12;
    scene.actors.forEach((actor, index) => { actor.characterId = -index - 1; });
    return scene;
};
const demo = scene => trainingLoadoutDemoChoices(trainingLoadoutGroups(scene).groups);
const fumbleRulings = { nonautomaticFumbleAmmo: 'consume-attempted', jamAmmo: 'consume-declared' };
const frozenInput = seed(), inputBefore = structuredClone(frozenInput);
const grouped = trainingLoadoutGroups(frozenInput);
assert.equal(grouped.error, null);
assert.deepEqual(grouped.groups.map(group => [group.weaponId, group.actors.map(actor => actor.id)]), [['colt-amt2000', ['ray', 'mira']], ['militech-ronin', ['guard-1', 'guard-2']]]);
assert.deepEqual(grouped.groups[0].actors.map(actor => [actor.loaded, actor.total]), [[8, 40], [8, 40]]);
assert.deepEqual(grouped.groups[1].actors.map(actor => [actor.loaded, actor.total]), [[35, 105], [35, 105]]);
assert.deepEqual(frozenInput, inputBefore, 'Grouping never mutates actor, sheet, magazine or pool data');
assert.equal(trainingLoadoutSetupError(frozenInput, demo(frozenInput), fumbleRulings), null);
assert.deepEqual(trainingLoadoutRequiredRulings(frozenInput, demo(frozenInput)), ['nonautomaticFumbleAmmo', 'jamAmmo']);

// Hidden actors participate; dead actors are skipped, but real sheets are refused.
const dead = seed(); dead.actors[0].status = 'dead';
assert.deepEqual(trainingLoadoutGroups(dead).groups[0].actors.map(actor => actor.id), ['mira']);
dead.actors[0].characterId = 23; assert.match(trainingLoadoutGroups(dead).error, /Реальные листы/);
for (const phase of ['combat', 'paused']) assert(trainingLoadoutGroups({ ...seed(), phase }).error);
assert.equal(trainingLoadoutGroups({ ...seed(), phase: 'ended' }).error, null);
for (const change of [{ id: 'unknown' }, { weaponId: 'other' }, { damageDice: 5 }, { damageBonus: 0 }, { accuracy: '0' }, { range: 49 }, { rof: 2 }, { magazine: 9 }, { ammo: 9 }, { reserve: -1 }]) {
    const scene = seed(); Object.assign(scene.actors[0].weapon, change); assert(trainingLoadoutGroups(scene).error, JSON.stringify(change));
}
const renamed = seed(); renamed.actors[0].weapon.name = 'Пистолет Рэя'; renamed.actors[0].weapon.ammo = 2; renamed.actors[0].weapon.reserve = 11;
assert.equal(trainingLoadoutGroups(renamed).error, null);
assert.deepEqual(trainingLoadoutGroups(renamed).groups[0].actors[0], { id: 'ray', name: 'Рэй', loaded: 2, total: 13, skillRank: 4 });
for (const change of [{ weaponJams: { gun: 1 } }, { unavailableWeapons: ['gun'] }, { droppedWeapons: [{}], weapon: { unarmed: true } }]) {
    const scene = seed(); Object.assign(scene.actors[0], change); assert.match(trainingLoadoutGroups(scene).error, /готовность/);
}
const partial = seed(); partial.actors[0] = confirmedFixtureActor(partial.actors[0]);
const partialBefore = structuredClone(partial);
assert.equal(trainingLoadoutGroups(partial).preserved[0].id, 'ray');
assert.deepEqual(trainingLoadoutGroups(partial).groups[0].actors.map(actor => actor.id), ['mira']);
assert.deepEqual(partial, partialBefore);
partial.actors[0].weaponJams = { gun: 1 }; assert.match(trainingLoadoutGroups(partial).error, /готовность/);

const legacy = seed(), old = legacy.actors[0];
old.weapon = { ...old.weapon, weaponId: old.weapon.id, ammoItemId: 'scene-ammo', kind: 'ranged', weaponType: 'legacy', skill: 'selectedWeapon', skillName: 'Handgun', skillRank: 4, legacy: true };
old.loadout = { legacy: true, activeWeaponId: old.weapon.id, weapons: [{ ...old.weapon }], ammoPools: { 'scene-ammo': 40 } };
assert.equal(trainingLoadoutGroups(legacy).error, null);
old.loadout.ammoPools['scene-ammo'] = 50; assert(trainingLoadoutGroups(legacy).error); old.loadout.ammoPools['scene-ammo'] = 40;
old.loadout.weapons.push({ ...old.weapon }); assert(trainingLoadoutGroups(legacy).error);

for (const patch of [{ fireModes: [] }, { fireModes: ['suppress'] }, { fireModes: ['single', 'single'] }, { singleActionCap: 2 }, { singleActionCap: true }, { fumbleClass: '' }, { fireModes: ['auto'], singleActionCap: 0, fumbleClass: 'nonautomatic' }, { fireModes: ['burst'], singleActionCap: 0, fumbleClass: 'automatic' }, { loaded: 8 }]) {
    const choices = demo(frozenInput); Object.assign(choices[0], patch); assert(trainingLoadoutSetupError(frozenInput, choices, fumbleRulings), JSON.stringify(patch));
}
assert(trainingLoadoutSetupError(frozenInput, [demo(frozenInput)[0]], fumbleRulings));
assert(trainingLoadoutSetupError(frozenInput, [demo(frozenInput)[0], demo(frozenInput)[0]], fumbleRulings));
assert(trainingLoadoutSetupError(frozenInput, demo(frozenInput), {}));
assert(trainingLoadoutRulingsError({ autoPointBlankModifier: 0.5 }));
assert(trainingLoadoutRulingsError({ unknown: 'choice' }));
const autoChoices = demo(frozenInput); autoChoices[1] = { ...autoChoices[1], fireModes: ['burst', 'auto'], singleActionCap: 0 };
assert.deepEqual(trainingLoadoutRequiredRulings(frozenInput, autoChoices), ['nonautomaticFumbleAmmo', 'jamAmmo', 'burstHitRounding', 'autoTenRoundGroups', 'autoModifierBasis', 'autoReducedRounds', 'autoAllocationRemainder', 'autoPointBlankModifier']);
const allRulings = { ...fumbleRulings, burstHitRounding: 'floor', autoTenRoundGroups: 'floor', autoModifierBasis: 'allocated', autoReducedRounds: 'allow-declared', autoAllocationRemainder: 'consume-unallocated', autoPointBlankModifier: 0 };
assert.equal(trainingLoadoutSetupError(frozenInput, autoChoices, allRulings), null);

// Real component hooks, event handlers and pinned command envelope.
installEnvironment(); const h = createHarness(); globalThis.__trainingLoadoutReact = h.React;
const react = moduleUrl('const r=globalThis.__trainingLoadoutReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect;');
const helper = moduleUrl(await readFile(new URL('../lib/firefight/training-loadout.mjs', import.meta.url), 'utf8'));
const source = await readFile(new URL('../components/battle/TrainingLoadoutSetup.jsx', import.meta.url), 'utf8');
const { default: TrainingLoadoutSetup } = await import(moduleUrl(transpile(source.replace("from 'react'", `from '${react}'`).replace("from '@/lib/firefight/training-loadout.mjs'", `from '${helper}'`))));
let props, commands, dirties, cancelled, responder;
const mount = (scene = seed(), disabled = false) => {
    h.dispose(); commands = []; dirties = []; cancelled = 0; responder = async () => ({ ok: true });
    props = { scene, disabled, onDirty: value => dirties.push(value), onCancel: () => cancelled++, onConfirm: async command => { commands.push(structuredClone(command)); return responder(command); } };
    h.mount(TrainingLoadoutSetup, props);
};
const field = label => { const node = h.find(node => node.props['aria-label'] === label); assert(node, 'Missing ' + label); return node; };
const change = async (label, value) => { field(label).props.onChange({ target: { value: String(value), checked: value } }); h.render(); await h.flush(); };
const review = () => change('Подтверждение учебных профилей ГМом', true);
const submit = () => h.button('Подтвердить учебное оружие');
mount();
assert(submit().props.disabled); assert.deepEqual(dirties, [false]);
assert.equal(field('Colt AMT 2000 · Одиночные').props.checked, false);
assert.equal(field('Militech Ronin · класс ошибки').props.value, '');
assert.equal(field('Подтверждение учебных профилей ГМом').props.disabled, true);
assert.equal(commands.length, 0);
await h.click('Выбрать учебный вариант');
assert.equal(field('Colt AMT 2000 · одиночных за действие').props.value, 1);
assert.equal(field('Militech Ronin · класс ошибки').props.value, 'automatic');
assert.equal(field('Подтверждение учебных профилей ГМом').props.checked, false);
assert(submit().props.disabled); assert.equal(dirties.at(-1), true);
assert(!h.find(node => node.props['aria-label'] === 'Автоогонь в упор · модификатор'));
await review(); assert(!submit().props.disabled); await h.click(submit());
assert.deepEqual(commands, [{ type: 'prepare-training-loadouts', battleId: 'training-test', expectedVersion: 12, choices: demo(props.scene), rulings: fumbleRulings }]);
assert.equal(dirties.at(-1), false); assert(submit().props.disabled); assert.equal(field('Учебное оружие и соглашения').props['data-training-loadout-draft'], 'false');
await submit().props.onClick(); assert.equal(commands.length, 1, 'Saved form cannot submit twice');
assert.deepEqual(props.scene, seed());

mount(); await h.click('Выбрать учебный вариант'); await review();
await change('Militech Ronin · Автоогонь', true);
assert.equal(field('Подтверждение учебных профилей ГМом').props.checked, false, 'Any change invalidates GM review');
assert.equal(field('Автоогонь в упор · модификатор').props.value, ''); assert(submit().props.disabled);
await change('Автоогонь · неполные десятки', 'floor'); await change('Автоогонь · база для нескольких целей', 'allocated');
await change('Автоогонь · уменьшенная очередь', 'allow-declared'); await change('Автоогонь · остаток между целями', 'consume-unallocated'); await change('Автоогонь в упор · модификатор', 0);
await review(); assert(!submit().props.disabled);
await change('Militech Ronin · Одиночные', false);
assert(!h.find(node => node.props['aria-label'] === 'Militech Ronin · одиночных за действие'));
await review(); await h.click(submit()); assert.equal(commands[0].choices[1].singleActionCap, 0);

const prior = seed(); prior.settings.cp2020Rulings = { punchRounding: 'up', autoPointBlankModifier: 17, burstHitRounding: 'ceil' };
mount(prior); await h.click('Выбрать учебный вариант');
assert.equal(field('Автоогонь в упор · модификатор').props.value, 17);
await review(); await h.click(submit()); assert.deepEqual(commands[0].rulings, { ...prior.settings.cp2020Rulings, ...fumbleRulings });

mount(); await h.click('Выбрать учебный вариант'); await review();
props = { ...props, scene: { ...props.scene, version: 13 } }; h.update(props);
assert.match(h.text(), /Сцена изменилась/); assert(submit().props.disabled); await submit().props.onClick(); assert.equal(commands.length, 0);
await h.click('Назад'); assert.equal(cancelled, 1);

mount(); await h.click('Выбрать учебный вариант'); await review();
let finish; responder = () => new Promise(resolve => { finish = resolve; });
const handler = submit().props.onClick; const pending = handler(); void handler(); h.render();
assert.equal(commands.length, 1); assert(h.button('Назад').props.disabled); assert(h.button('Подтверждаем…').props.disabled);
finish(false); await pending; await h.flush(); assert.match(h.text(), /не подтверждена/); assert.equal(dirties.at(-1), true); assert(!submit().props.disabled);
responder = async () => { throw new Error('Сеть недоступна'); }; await h.click(submit()); assert.match(h.text(), /Сеть недоступна/);
responder = async () => ({ ok: true }); await h.click(submit()); assert(submit().props.disabled);

mount(seed(), true); await h.button('Выбрать учебный вариант').props.onClick(); await review(); h.render(); assert.equal(dirties.at(-1), false); assert.equal(commands.length, 0); assert(submit().props.disabled);
mount(); await h.click('Выбрать учебный вариант'); await h.click('Назад'); assert.equal(cancelled, 1); mount(); assert.equal(field('Colt AMT 2000 · Одиночные').props.checked, false);
const readyScene = seed(); readyScene.actors = readyScene.actors.map(actor => confirmedFixtureActor(actor)); mount(readyScene);
assert.match(h.text(), /уже подготовлено/); assert(!h.button('Выбрать учебный вариант')); assert(submit().props.disabled);
const changedScene = seed(); changedScene.actors[0].weapon.rof = 2; mount(changedScene); assert.match(h.text(), /обычный редактор/); assert(submit().props.disabled);
assert(h.buttons().every(button => button.props.style.minHeight >= 44));
assert.doesNotMatch(source, /window\.confirm|configure-loadout|resetReadiness|resetLoaded/, 'No individual-sheet command, native confirm or readiness/ammo reset');
h.dispose();

// The production BattleApp opens the same guided form from Start. Transport and
// renderer are fixtures here; authoritative source/atomicity tests live in Python.
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { BattleApp } = await loadModules(h, undefined, { actualSharedBattle: true });
let battleProps, battleCommands, battleResponse, exits, manualOpens;
const mountBattle = async (overrides = {}) => {
    h.dispose(); battleCommands = []; exits = 0; manualOpens = 0;
    battleResponse = async () => ({ ok: true });
    battleProps = { scene: seed(), training: true, role: 'gm', onExit: () => exits++, onLoadout: () => manualOpens++, backRef: { current: null }, onPreview: async () => ({ ok: false }), onCommand: async command => { battleCommands.push(structuredClone(command)); return battleResponse(command); }, ...overrides };
    h.mount(BattleApp, battleProps); await h.flush();
};
const openGuide = async () => { await clickBattleControl(h, 'Начать бой'); assert(h.find(node => node.props['aria-label'] === 'Учебное оружие и соглашения')); };
const nativeBack = async () => { assert.equal(battleProps.backRef.current(), true); h.render(); await h.flush(); };
await mountBattle(); await openGuide(); assert.equal(battleCommands.length, 0, 'Start first asks for explicit profiles, without rolling initiative');
await h.click('Выбрать учебный вариант'); await nativeBack();
assert(h.button('Продолжить подготовку')); assert.equal(exits, 0);
await h.click('Продолжить подготовку'); assert.equal(field('Militech Ronin · класс ошибки').props.value, 'automatic');
assert.equal(field('Colt AMT 2000 · одиночных за действие').props.value, 1);
await review();
let finishBattle; battleResponse = () => new Promise(resolve => { finishBattle = resolve; });
const batchHandler = submit().props.onClick; const batchPending = batchHandler(); void batchHandler(); h.render(); await h.flush();
assert.equal(battleCommands.length, 1); assert.equal(battleCommands[0].type, 'prepare-training-loadouts');
assert.equal(battleCommands[0].battleId, 'training-test'); assert.equal(battleCommands[0].expectedVersion, 12);
assert.equal(battleCommands[0].choices.length, 2); assert.deepEqual(battleCommands[0].rulings, fumbleRulings);
await nativeBack(); assert(!h.button('Закрыть без сохранения'), 'Native Back cannot abandon an in-flight batch');
finishBattle({ ok: true }); await batchPending; await h.flush();
assert(h.find(node => node.props['aria-label'] === 'Управление боем')); assert(!h.find(node => node.props['aria-label'] === 'Учебное оружие и соглашения'));
assert(!battleCommands.some(command => command.type === 'start'), 'Preparing weapons does not silently start combat');

await mountBattle(); await openGuide(); await h.click('Выбрать учебный вариант'); await review();
const beforePollHandler = submit().props.onClick;
battleProps = { ...battleProps, scene: { ...battleProps.scene, version: 13 } }; h.update(battleProps); await h.flush();
assert(submit().props.disabled); assert.match(h.text(), /Сцена изменилась/);
await beforePollHandler(); await h.flush(); assert.equal(battleCommands.length, 0, 'Caller rejects a stale event handler before transport');
await nativeBack(); await h.click('Закрыть без сохранения'); assert(!h.find(node => node.props['aria-label'] === 'Учебное оружие и соглашения'));
await openGuide(); assert.equal(field('Colt AMT 2000 · Одиночные').props.checked, false, 'A reopened guide gets a fresh version and draft');

await mountBattle({ training: false }); await clickBattleControl(h, 'Начать бой');
assert(!h.find(node => node.props['aria-label'] === 'Учебное оружие и соглашения')); assert.equal(battleCommands.length, 0);
await mountBattle({ role: 'player', controlledIds: ['ray'] }); await openBattleMenu(h);
assert(!h.button('Подготовить учебный бой')); assert(!h.button('Начать бой')); assert.equal(battleCommands.length, 0);
await mountBattle({ online: false }); await openBattleMenu(h); assert(h.button('Начать бой').props.disabled);
const manualScene = seed(); manualScene.actors[0].weapon.damageDice = 3;
await mountBattle({ scene: manualScene }); await openGuide(); assert(submit().props.disabled); assert.match(h.text(), /обычный редактор/);
const manualButton = h.nodes().find(node => node.type === 'button' && h.text(node).trim() === 'Рэй'); assert(manualButton);
await h.click(manualButton); assert.equal(manualOpens, 1); assert.equal(battleCommands.length, 0);
h.dispose();
console.log('Training loadout setup passed: two read-only source groups, hidden/dead/synthetic bounds, source tampering, legacy/confirmed preservation, ammo, explicit demo/review, applicable rulings, pinned versions, repeated/failed sends and cancel/reopen. Production BattleApp Start, dirty Back/Stay, in-flight Back, stale event handler, manual-editor route and GM/training gates passed. Hook harness only; no browser/device claim.');
