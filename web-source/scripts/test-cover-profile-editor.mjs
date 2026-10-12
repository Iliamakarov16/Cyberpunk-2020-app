import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHarness, installEnvironment, moduleUrl, transpile } from './ux-hook-harness.mjs';

installEnvironment();
const h = createHarness(); globalThis.__coverProfileReact = h.React;
const react = moduleUrl('const r=globalThis.__coverProfileReact;export default r;export const useState=r.useState,useRef=r.useRef,useEffect=r.useEffect;');
const source = await readFile(new URL('../components/battle/CoverProfileEditor.jsx', import.meta.url), 'utf8');
const { default: CoverProfileEditor, coverProfileError, COVER_ZONE_OPTIONS } = await import(moduleUrl(transpile(source.replace("from 'react'", `from '${react}'`))));
const table = () => ({ propId: 'table-7', type: 'table', name: 'Стол у окна' });
const profile = () => ({ material: 'Материал, проверенный ГМом', sp: 17, coveredZones: ['leftLeg', 'rightLeg'], blocksVision: false, movable: true, flippedCoveredZones: ['torso', 'leftArm', 'rightArm'], flippedBlocksVision: true });
const tile = () => ({ x: 2, y: 3, type: 'wall' });
const tileProfile = () => ({ material: 'Материал стены', sp: 31 });
const zones = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
assert.deepEqual(COVER_ZONE_OPTIONS.map(([zone]) => zone), zones);
assert.equal(coverProfileError(table(), profile()), null);
assert.equal(coverProfileError(tile(), tileProfile()), null);
assert.equal(coverProfileError({ ...tile(), type: 'door' }, { material: 'Прозрачный материал', sp: 0 }), null);
for (const value of [null, false, [], {}, { ...profile(), hp: 20 }, { ...profile(), tableSP: 20 }]) assert(coverProfileError(table(), value));
for (const key of Object.keys(profile())) { const value = profile(); delete value[key]; assert(coverProfileError(table(), value), 'Required ' + key); }
for (const value of ['', ' ', 'x'.repeat(101), 42, null]) assert(coverProfileError(table(), { ...profile(), material: value }));
assert.equal(coverProfileError(table(), { ...profile(), material: 'x'.repeat(100) }), null);
for (const value of ['', '17', true, false, null, -1, 1001, 0.5, NaN, Infinity]) assert(coverProfileError(table(), { ...profile(), sp: value }), 'Invalid SP ' + value);
for (const value of [0, 1000]) assert.equal(coverProfileError(table(), { ...profile(), sp: value }), null);
for (const key of ['coveredZones', 'flippedCoveredZones']) {
    for (const value of [null, {}, 'head', ['head', 'head'], ['tail'], ['torso', false]]) assert(coverProfileError(table(), { ...profile(), [key]: value }));
    for (const value of [[], zones]) assert.equal(coverProfileError(table(), { ...profile(), [key]: value }), null);
}
for (const key of ['blocksVision', 'movable', 'flippedBlocksVision']) for (const value of [1, 'false', null]) assert(coverProfileError(table(), { ...profile(), [key]: value }));
for (const type of ['counter', 'barrel', 'crate', 'car', 'van']) {
    assert(coverProfileError({ propId: 'stationary', type }, profile()));
    assert.equal(coverProfileError({ propId: 'stationary', type }, { ...profile(), movable: false }), null);
}
for (const target of [null, {}, { propId: '', type: 'table' }, { propId: true, type: 'table' }, { propId: 'p', type: 'unknown' }, { ...tile(), x: -1 }, { ...tile(), y: 0.5 }, { ...tile(), x: '2' }]) assert(coverProfileError(target, profile()));
assert(coverProfileError(tile(), profile()), 'Tile schema rejects all prop fields');
assert(coverProfileError(table(), tileProfile()), 'Prop schema requires explicit geometry and vision fields');

let props, commands, dirties, cancelled, responder;
const mount = (target = table(), savedProfile, disabled = false) => {
    h.dispose(); commands = []; dirties = []; cancelled = 0; responder = async () => ({ ok: true });
    props = { target, profile: savedProfile, disabled, onDirty: value => dirties.push(value), onCancel: () => cancelled++, onConfirm: async command => { commands.push(structuredClone(command)); return responder(command); } };
    h.mount(CoverProfileEditor, props);
};
const field = label => { const node = h.find(node => node.props['aria-label'] === label); assert(node, 'Missing ' + label); return node; };
const change = async (label, value) => { field(label).props.onChange({ target: { value: String(value), checked: value } }); h.render(); await h.flush(); };
const review = () => change('Подтверждение профиля укрытия ГМом', true);
const submit = () => h.button('Сохранить профиль укрытия');
const fillMaterial = async (material = 'Материал выбран ГМом', sp = 0) => { await change('Материал укрытия', material); await change('SP материала', sp); };

// New profiles have no invented material or SP. False and empty physical
// settings become explicit only through the final GM review.
mount();
assert.equal(field('Материал укрытия').props.value, ''); assert.equal(field('SP материала').props.value, '');
assert.deepEqual(dirties, [false]); assert(submit().props.disabled); assert(field('Подтверждение профиля укрытия ГМом').props.disabled);
await review(); assert.equal(field('Подтверждение профиля укрытия ГМом').props.checked, false);
assert.equal(field('Преграждает обзор').props.checked, false); assert.equal(field('Стол можно двигать и опрокидывать').props.checked, false);
for (const [, label] of COVER_ZONE_OPTIONS) { assert.equal(field('Закрытые зоны · ' + label).props.checked, false); assert.equal(field('После опрокидывания · ' + label).props.checked, false); }
await fillMaterial(); assert.equal(dirties.at(-1), true); assert(submit().props.disabled);
await review(); assert(!submit().props.disabled);
await h.click(submit());
assert.deepEqual(commands, [{ target: table(), profile: { material: 'Материал выбран ГМом', sp: 0, coveredZones: [], blocksVision: false, movable: false, flippedCoveredZones: [], flippedBlocksVision: false } }]);
assert.equal(dirties.at(-1), false); assert.equal(field('Профиль укрытия').props['data-cover-profile-draft'], 'false');
assert(submit().props.disabled); await submit().props.onClick(); assert.equal(commands.length, 1);
assert.match(h.text(), /Профиль укрытия сохранён/);

// Existing profiles remain exact editable values, with independent normal and
// flipped geometry/opacity. Changing any field invalidates the review.
const originalTarget = table(), originalProfile = profile();
mount(originalTarget, originalProfile); assert.deepEqual(dirties, [false]);
assert.equal(field('Материал укрытия').props.value, originalProfile.material); assert.equal(field('SP материала').props.value, 17);
assert(field('Закрытые зоны · Левая нога').props.checked); assert(field('После опрокидывания · Торс').props.checked);
assert.equal(field('Преграждает обзор').props.checked, false); assert(field('После опрокидывания преграждает обзор').props.checked);
await review(); await change('Закрытые зоны · Голова', true); assert.equal(field('Подтверждение профиля укрытия ГМом').props.checked, false);
await change('После опрокидывания · Голова', true); await change('После опрокидывания · Левая рука', false);
await change('Преграждает обзор', true); await change('После опрокидывания преграждает обзор', false); await change('Стол можно двигать и опрокидывать', false);
await review(); await h.click(submit());
assert.deepEqual(commands[0], { target: originalTarget, profile: { ...originalProfile, coveredZones: ['head', 'leftLeg', 'rightLeg'], blocksVision: true, movable: false, flippedCoveredZones: ['head', 'torso', 'rightArm'], flippedBlocksVision: false } });
assert.deepEqual(originalTarget, table()); assert.deepEqual(originalProfile, profile(), 'Editing never changes incoming profile arrays');

// Empty numeric input stays missing, never becomes 0. Invalid values cannot be
// reviewed, including event calls that bypass HTML numeric bounds.
mount(); await fillMaterial('Материал');
for (const value of ['', -1, 1001, 0.5, 'abc']) {
    await change('SP материала', value); await review(); assert(submit().props.disabled); assert.equal(commands.length, 0);
}
await change('SP материала', 1000); await review(); assert(!submit().props.disabled);
await change('Материал укрытия', ' '.repeat(3)); assert(submit().props.disabled);
await change('Материал укрытия', 'x'.repeat(101)); assert(submit().props.disabled);
await change('Материал укрытия', 'x'.repeat(100)); await review(); assert(!submit().props.disabled);

// A pristine existing profile becomes clean again when a value is reverted;
// review alone is an unsaved decision until acknowledged by transport.
mount(table(), profile()); await change('SP материала', 18); assert.equal(dirties.at(-1), true);
await change('SP материала', 17); assert.equal(dirties.at(-1), false); await review(); assert.equal(dirties.at(-1), true);
await h.click('Назад'); assert.equal(cancelled, 1); assert.equal(commands.length, 0); h.dispose(); assert.equal(dirties.at(-1), false);
mount(); assert.equal(field('SP материала').props.value, '');

// Failure retains every edit/review and supports an explicit retry. Copies
// passed to a transport can be mutated without damaging the draft.
mount(table(), profile()); await change('SP материала', 19); await review();
responder = async command => { command.target.propId = 'transport-mutation'; command.profile.coveredZones.push('head'); return { ok: false, error: 'Сервер отклонил профиль' }; };
await h.click(submit()); assert.match(h.text(), /Сервер отклонил профиль/); assert.equal(dirties.at(-1), true);
assert.equal(field('SP материала').props.value, 19); assert.equal(field('Закрытые зоны · Голова').props.checked, false); assert(!submit().props.disabled);
responder = async () => { throw new Error('Сеть недоступна'); }; await h.click(submit()); assert.match(h.text(), /Сеть недоступна/);
responder = async () => undefined; await h.click(submit()); assert.match(h.text(), /Сохранение не подтверждено/);
await change('SP материала', 20); assert.doesNotMatch(h.text(), /Сохранение не подтверждено/); assert(submit().props.disabled);
responder = async () => ({ ok: true }); await review(); await h.click(submit()); assert.equal(commands.at(-1).target.propId, 'table-7');
assert.equal(commands.at(-1).profile.sp, 20); assert.equal(dirties.at(-1), false);

// Same-tick duplicate submit, Back and stale input handlers cannot abandon or
// alter an in-flight command. A successful result cannot be sent twice.
mount(table(), profile()); await review();
let finish; responder = () => new Promise(resolve => { finish = resolve; });
const handler = submit().props.onClick, oldMaterial = field('Материал укрытия').props.onChange, oldBack = h.button('Назад').props.onClick;
const pending = handler(); void handler(); oldBack(); oldMaterial({ target: { value: 'Случайный ввод' } }); h.render();
assert.equal(commands.length, 1); assert.equal(cancelled, 0); assert(h.button('Назад').props.disabled); assert(h.button('Сохраняем…').props.disabled);
assert.equal(field('Материал укрытия').props.value, profile().material);
finish({ ok: true }); await pending; await h.flush(); await handler(); assert.equal(commands.length, 1);

// A changed target or source profile is never silently substituted. Old
// handlers consult current lock state as well as the pinned target.
for (const patch of [{ target: { propId: 'other-table', type: 'table' } }, { target: { ...table(), type: 'crate' } }, { profile: { ...profile(), sp: 77 } }]) {
    mount(table(), profile()); await change('SP материала', 22); await review(); const previousHandler = submit().props.onClick;
    props = { ...props, ...patch }; h.update(props); await h.flush();
    assert.match(h.text(), /профиль изменился/); assert.equal(field('SP материала').props.value, 22); assert(submit().props.disabled);
    await previousHandler(); assert.equal(commands.length, 0); await h.click('Назад'); assert.equal(cancelled, 1);
}
mount(table(), profile()); await review();
props = { ...props, target: { ...table(), name: 'Новое отображаемое имя' }, profile: Object.fromEntries(Object.entries(profile()).reverse()) }; h.update(props);
assert.doesNotMatch(h.text(), /профиль изменился/); await h.click(submit()); assert.deepEqual(commands[0].target, table(), 'Display changes do not redirect or replace the pinned target');
mount(table(), profile()); await review(); const beforeDisabled = submit().props.onClick;
props = { ...props, disabled: true }; h.update(props); await beforeDisabled(); await review(); assert.equal(commands.length, 0); assert(h.button('Назад').props.disabled);
mount(table(), profile(), true); await change('SP материала', 99); await review(); assert.equal(field('SP материала').props.value, 17); assert.deepEqual(dirties, [false]);

// Tiles submit the exact minimal schema. Stationary props do not acquire table
// controls; unknown targets cannot send, but can be dismissed.
for (const type of ['wall', 'door']) {
    mount({ ...tile(), type }); assert(!h.find(node => node.props['aria-label'] === 'Закрытые зоны'));
    assert(!h.find(node => node.props['aria-label'] === 'Преграждает обзор')); await fillMaterial('Материал клетки', 5); await review(); await h.click(submit());
    assert.deepEqual(commands[0], { target: { ...tile(), type }, profile: { material: 'Материал клетки', sp: 5 } });
}
mount(tile(), tileProfile()); assert.equal(field('SP материала').props.value, 31); await review(); await h.click(submit()); assert.deepEqual(commands[0].profile, tileProfile());
for (const type of ['counter', 'barrel', 'crate', 'car', 'van']) {
    mount({ propId: type + '-1', type }); assert(!h.find(node => node.props['aria-label'] === 'Стол можно двигать и опрокидывать'));
    assert(!h.find(node => node.props['aria-label'] === 'После опрокидывания')); await fillMaterial(); await review(); await h.click(submit()); assert.equal(commands[0].profile.movable, false);
}
mount(null); assert(submit().props.disabled); await submit().props.onClick(); assert.equal(commands.length, 0); await h.click('Назад'); assert.equal(cancelled, 1);

// Callback replacement and disposal clear the current caller's dirty marker;
// completing a disposed form does not alter a reopened form.
mount(table(), profile()); await review(); const laterDirties = []; props = { ...props, onDirty: value => laterDirties.push(value) }; h.update(props);
let completeDisposed; responder = () => new Promise(resolve => { completeDisposed = resolve; }); const disposedPending = submit().props.onClick(); h.dispose();
assert.equal(laterDirties.at(-1), false); const dirtyCount = laterDirties.length; completeDisposed({ ok: true }); await disposedPending; assert.equal(laterDirties.length, dirtyCount);
mount(); assert.equal(field('SP материала').props.value, ''); assert.deepEqual(dirties, [false]);

// Small visible groups and touch-sized labels/buttons. Outer dialog owns
// scrolling; these checks are structural, not browser/device layout claims.
assert(h.buttons().every(button => button.props.style.minHeight >= 44 && button.props.style.minWidth >= 44));
assert(h.nodes().filter(node => node.type === 'label' && node.props.className === 'adjudication-check').every(node => node.props.style.minHeight >= 44));
assert(h.nodes().filter(node => node.type === 'input' && node.props.type !== 'checkbox').every(node => node.props.style.minHeight >= 44));
assert(!h.nodes().some(node => node.type === 'details' || ['auto', 'scroll'].includes(node.props.style?.overflowY)));
assert.match(h.text(), /SP отвечает за баллистическую защиту/); assert.match(h.text(), /HP и автоматическое снижение SP укрытия не задаются/);
assert.doesNotMatch(source, /window\.confirm|tableSP|fetch\(|\.hp\s*=|\.sp\s*[-+]=/);
h.dispose();
console.log('Cover profile editor passed: exact prop/tile schemas, explicit material/SP/GM review, all six zones, independent flipped geometry/vision, stationary restrictions, source preservation, dirty/cancel/reopen, stale target/profile/handler locks, duplicate and failed saves, retry, unmount, and touch/scroll structure. Real component hook harness; no browser/device claim.');
