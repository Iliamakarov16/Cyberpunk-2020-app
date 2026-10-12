import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHarness, moduleUrl, transpile } from './ux-hook-harness.mjs';

const h = createHarness();
globalThis.__combatAdjudicationReact = h.React;
const react = moduleUrl('const r=globalThis.__combatAdjudicationReact;export default r;export const useRef=r.useRef,useState=r.useState;');
const source = await readFile(new URL('../components/battle/CombatAdjudication.jsx', import.meta.url), 'utf8');
const { MeleeRuling, meleeRulingReady, RulesProfileEditor, rulesProfileReady, FumbleReview } = await import(moduleUrl(transpile(source.replace("from 'react'", `from '${react}'`))));
const actor = { id: 'a', name: 'Рэй', weapon: { kind: 'ranged', skillName: 'Handgun' }, meleeSkills: [{ kind: 'brawling', name: 'Драка', rank: 5 }, { kind: 'martialArts', name: 'Каратэ', rank: 8 }, { kind: 'melee', name: 'Ближний бой с оружием', rank: 3 }] };
const target = { id: 'b', name: 'Охранник', meleeSkills: [{ kind: 'dodge', name: 'Уклонение и освобождение', rank: 3 }, { kind: 'athletics', name: 'Атлетика', rank: 9 }, { kind: 'martialArts', name: 'Бокс', rank: 6 }, { kind: 'brawling', name: 'Драка', rank: 8 }] };
const base = { defenseSkillName: '', defenseSkillKind: 'dodge', defenderAware: true, attackModifier: 0, defenseModifier: 0 };
const control = label => { const node = h.find(node => node.props['aria-label'] === label); assert(node, 'Missing control: ' + label); return node; };
const change = async (label, value, checked = false) => { const node = typeof label === 'string' ? control(label) : label; node.props.onChange({ target: checked ? { checked: value } : { value: String(value) } }); h.render(); await h.flush(); };
const checkbox = text => { const label = h.find(node => node.type === 'label' && h.text(node).includes(text)); assert(label, text); return h.nodes(label).find(node => node.type === 'input' && node.props.type === 'checkbox'); };
const options = node => h.nodes(node).filter(child => child.type === 'option');
const noOverlays = () => assert(!h.nodes().some(node => node.type === 'form' || node.props.role === 'dialog' || String(node.type).includes('Dialog')), 'Embedded controls never stack a dialog or nest a form');

// The helper never turns unknown, malformed, inferred, or stale decisions into approval.
assert.equal(meleeRulingReady(null, actor, 'kick'), false);
assert.equal(meleeRulingReady({}, actor, 'kick'), false);
assert.equal(meleeRulingReady(base, actor, 'kick'), true);
assert.equal(meleeRulingReady(base, actor, 'punch'), false);
assert.equal(meleeRulingReady({ ...base, punchRounding: 'up' }, actor, 'punch'), true);
for (const bad of [
    { ...base, defenseSkillKind: 'brawling' }, { ...base, defenseSkillName: ' ' },
    { ...base, defenderAware: false }, { ...base, defenderAware: 1 },
    { ...base, attackModifier: '0' }, { ...base, defenseModifier: 31 },
    { ...base, attackModifier: -31 }, { ...base, defenseModifier: 0.5 },
    { ...base, activeDodge: true }, { ...base, punchRounding: 'floor' },
    { ...base, attackTechniqueBonus: 0 }, { ...base, defenseTechniqueBonus: 0 },
    { ...base, defenseSkillKind: 'martialArts' },
]) assert.equal(meleeRulingReady(bad, actor, 'kick'), false, JSON.stringify(bad));
assert.equal(meleeRulingReady(base, actor, 'grapple'), false);
assert.equal(meleeRulingReady(base, actor, 'kick', 'Неизвестный стиль'), false);
assert.equal(meleeRulingReady(base, actor, 'kick', 'Ближний бой с оружием'), false);
assert.equal(meleeRulingReady(base, actor, 'kick', 'Каратэ'), false);
assert.equal(meleeRulingReady({ ...base, attackTechniqueBonus: 0 }, actor, 'kick', 'Каратэ'), true, 'A verified style bonus may explicitly be zero');
assert.equal(meleeRulingReady({ ...base, attackTechniqueBonus: 5 }, actor, 'kick', 'Каратэ'), false);
const armed = { ...actor, weapon: { kind: 'melee', skillName: 'Ближний бой с оружием', skillKind: 'melee' } };
assert.equal(meleeRulingReady(base, armed, 'weapon'), true, 'Weapon uses its bound actual skill');
assert.equal(meleeRulingReady(base, armed, 'weapon', 'Драка'), false);
assert.equal(meleeRulingReady(base, { ...armed, weapon: { ...armed.weapon, skillKind: 'fencing' } }, 'weapon'), false);

// Controlled melee edits emit no guessed values, including no highest defense.
let ruling = null, changes = [];
let meleeProps = { actor, target, technique: 'punch', value: ruling, skillName: 'Драка', onChange: next => { ruling = next; changes.push(next); h.update({ ...meleeProps, value: ruling }); } };
h.mount(MeleeRuling, meleeProps); await h.flush();
assert.equal(changes.length, 0, 'Mount never manufactures a ruling');
assert.equal(control('Навык защиты').props.value, '');
assert(!options(control('Навык защиты')).some(option => h.text(option).includes('Драка')), 'Brawling is not an allowed defense');
assert(options(control('Навык защиты')).some(option => option.props.value === '["dodge",""]'), 'REF-only defense is an explicit choice');
assert.equal(control('Модификатор атаки').props.value, '');
await change('Навык защиты', '["dodge",""]');
assert.deepEqual(ruling, { defenseSkillName: '', defenseSkillKind: 'dodge' });
await change(checkbox('Защитник осознаёт атаку'), true, true);
await h.click('Обычные условия');
assert.equal(meleeRulingReady(ruling, actor, 'punch', 'Драка'), false);
await change('Округление удара рукой', 'down');
assert.equal(meleeRulingReady(ruling, actor, 'punch', 'Драка'), true);
assert(!has(ruling, 'activeDodge'));
await change('Навык защиты', '["martialArts","Бокс"]');
assert.equal(meleeRulingReady(ruling, actor, 'punch', 'Драка'), false);
await change('Бонус приёма защиты · Бокс', 0);
assert.equal(meleeRulingReady(ruling, actor, 'punch', 'Драка'), true);
await change('Навык защиты', '["athletics","Атлетика"]');
assert(!has(ruling, 'defenseTechniqueBonus'), 'A different defense never inherits Martial Arts bonuses');
await change('Модификатор атаки', '');
assert.equal(meleeRulingReady(ruling, actor, 'punch', 'Драка'), false, 'Clearing a number never becomes zero');
await h.click('Сбросить решение'); assert.equal(ruling, null);
noOverlays();
for (const node of h.nodes().filter(node => ['button', 'select', 'summary', 'input'].includes(node.type) && node.props.type !== 'checkbox')) assert(node.props.style.minHeight >= 44, '44px touch target');
h.dispose();
meleeProps = { ...meleeProps, technique: 'kick', skillName: 'Каратэ', value: base, onChange: next => changes.push(next), disabled: true };
h.mount(MeleeRuling, meleeProps); const before = changes.length;
control('Бонус приёма атаки · Каратэ').props.onChange({ target: { value: '4' } });
h.button('Сбросить решение').props.onClick();
assert.equal(changes.length, before, 'Disabled state is checked by mutation handlers too');
h.dispose();

// Scene conventions stay absent until chosen, with exact current backend choices.
let profile = {}, profileChanges = [];
const rulesProps = { value: profile, onChange: next => { profile = next; profileChanges.push(next); h.update({ ...rulesProps, value: profile }); } };
h.mount(RulesProfileEditor, rulesProps); await h.flush();
assert.equal(profileChanges.length, 0); assert.equal(rulesProfileReady({}), true);
const backend = JSON.parse(execFileSync('python3', ['-c', "import json,battle_ranged;print(json.dumps(battle_ranged.RULING_CHOICES))"], { env: { ...process.env, PYTHONPATH: fileURLToPath(new URL('../../android/app/src/main/python', import.meta.url)) }, encoding: 'utf8' }));
const allSelects = h.nodes().filter(node => node.type === 'select');
assert.equal(allSelects.length, Object.keys(backend).length + 2, 'Every ranged convention, punch rounding and composite armor wear is editable');
for (const [index, [key, choices]] of Object.entries(backend).entries()) {
    const select = allSelects[index+1]; assert.deepEqual(options(select).map(option => option.props.value), ['', ...choices], key);
    await change(select.props['aria-label'], choices[0]); assert.equal(profile[key], choices[0]);
    await change(select.props['aria-label'], ''); assert(!has(profile, key), 'Unset means absent, not null or a default');
}
await change('Броня за укрытием · необязательный износ','none');assert.equal(profile.coverArmorWear,'none');assert(rulesProfileReady(profile));
await change('Броня за укрытием · необязательный износ','body');assert.equal(profile.coverArmorWear,'body');assert(rulesProfileReady(profile));
assert(!rulesProfileReady({coverArmorWear:'all-layers'}));
await change('Удар рукой · округление d6/2', 'up'); assert.equal(profile.punchRounding, 'up');
await change('Автоогонь в упор · модификатор', 0); assert.equal(profile.autoPointBlankModifier, 0); assert(rulesProfileReady(profile));
await change('Автоогонь в упор · модификатор', 101); assert(!rulesProfileReady(profile)); assert(h.find(node => node.props.role === 'alert'));
await change('Автоогонь в упор · модификатор', ''); assert(!has(profile, 'autoPointBlankModifier')); assert(rulesProfileReady(profile));
for (const bad of [null, [], { madeUp: 0 }, { jamAmmo: 'guess' }, { autoPointBlankModifier: '0' }, { autoPointBlankModifier: NaN }, { autoPointBlankModifier: -101 }]) assert.equal(rulesProfileReady(bad), false);
await h.click('Сбросить соглашения'); assert.deepEqual(profile, {}); noOverlays();
h.dispose();
h.mount(RulesProfileEditor, { ...rulesProps, disabled: true });
const changeCount = profileChanges.length; await change('Автоогонь в упор · модификатор', 3); h.button('Сбросить соглашения').props.onClick(); assert.equal(profileChanges.length, changeCount); h.dispose();

// Fumble table receipts persist while bounded consequences are reviewed.
const entry = { commandId: 'command-1', receipt: { bulletsSpent: 1, unexecutedRounds: 2, fumbles: [{ targetId: 'b', fumbleTableRoll: 8, effectCode: 'self-injury' }] } };
const actors = [actor, target]; let sent = [], release;
const reviewProps = { entry, actors, onResolve: async command => { sent.push(command); return { ok: true }; } };
h.mount(FumbleReview, reviewProps); await h.flush(); assert.equal(sent.length, 0); assert(h.button('Записать решение ГМа').props.disabled);
assert.match(h.text(), /таблица d10: 8/); assert.match(h.text(), /ранение себя/); assert.match(h.text(), /Уже списано патронов:\s+1/);
await change('Решение ГМа', '   '); assert(h.button('Записать решение ГМа').props.disabled);
await change('Решение ГМа', 'ГМ проверил последствия по таблице.'); assert(!h.button('Записать решение ГМа').props.disabled, 'A note may explicitly resolve no numerical consequences');
await h.click('Добавить последствие'); assert(h.button('Записать решение ГМа').props.disabled, 'No actor is guessed');
await change('Участник последствия 1', 'a');
await change('Итоговые ранения · 1', 7); await change('Дополнительные действия · 1', 2); await change(checkbox('Выпало текущее оружие'), true, true);
await change('Итоговое состояние · 1', 'stunned');
await h.click('Добавить последствие');
assert(options(control('Участник последствия 2')).find(option => option.props.value === 'a').props.disabled, 'Same actor cannot be entered twice');
await change('Участник последствия 2', 'a'); assert(h.button('Записать решение ГМа').props.disabled, 'Handler bypass cannot submit duplicate actors');
await change('Участник последствия 2', 'b');
await change('Итоговые ранения · 2', 1001); assert(h.button('Записать решение ГМа').props.disabled);
await change('Итоговые ранения · 2', ''); assert(h.button('Записать решение ГМа').props.disabled);
await change('Итоговые ранения · 2', 0);
await change('Дополнительные действия · 2', 11); assert(h.button('Записать решение ГМа').props.disabled);
await change('Дополнительные действия · 2', 0);
assert.match(h.text(), /после брони, BTM/); assert.match(h.text(), /не вычитает её повторно/);
const gate = new Promise(resolve => { release = resolve; });
h.update({ ...reviewProps, onResolve: async command => { sent.push(command); await gate; return { ok: true }; } });
const submit = h.button('Записать решение ГМа').props.onClick;
const first = submit(); const second = submit(); h.render();
assert.equal(sent.length, 1, 'Repeated taps use a synchronous in-flight guard');
release(); await Promise.all([first, second]); await h.flush();
assert.deepEqual(sent[0], { type: 'resolve-fumble', sourceCommandId: 'command-1', note: 'ГМ проверил последствия по таблице.', effects: [{ actorId: 'a', finalDamage: 7, dropWeapon: true, additionalActions: 2, finalStatus: 'stunned' }, { actorId: 'b', finalDamage: 0, dropWeapon: false, additionalActions: 0 }] });
assert(h.button('Записать решение ГМа').props.disabled, 'Acknowledged resolution cannot be resubmitted while the scene updates');
assert.match(h.text(), /таблица d10: 8/); noOverlays();

// Changing to another pending command cannot reuse the old note/effects.
const meleeEntry = { commandId: 'command-2', receipt: { resolution: { fumbles: [{ side: 'defense', roll: 9, requiresGmResolution: true }] } } };
h.update({ ...reviewProps, entry: meleeEntry }); await h.flush();
assert.equal(control('Решение ГМа').props.value, ''); assert(!h.find(node => node.props['aria-label'] === 'Участник последствия 1'));
assert.match(h.text(), /Защита\s+· таблица d10: 9/);
await change('Решение ГМа', 'Последствий нет: ГМ проверил ситуацию.');
h.update({ ...reviewProps, entry: meleeEntry, onResolve: async () => { throw new Error('Версия сцены изменилась'); } });
await h.click('Записать решение ГМа'); assert.match(h.text(), /Версия сцены изменилась/); assert(!h.button('Записать решение ГМа').props.disabled); assert(control('Решение ГМа').props.value, 'Rejected submission keeps the draft');
h.update({ ...reviewProps, entry: meleeEntry, disabled: true }); const sentBefore = sent.length;
await h.button('Записать решение ГМа').props.onClick(); assert.equal(sent.length, sentBefore);
h.dispose();

// Upper bounds, optional status removal, removed actors, and lifecycle reset.
const crowd = Array.from({ length: 25 }, (_, index) => ({ id: 'npc-' + index, name: 'НПС ' + index }));
h.mount(FumbleReview, { ...reviewProps, actors: crowd });
for (let index = 0; index < 20; index++) await h.click('Добавить последствие');
assert(h.button('Добавить последствие').props.disabled, 'At most twenty bounded effects');
h.dispose();
sent = []; h.mount(FumbleReview, reviewProps); await change('Решение ГМа', 'Итоговое ранение проверено.'); await h.click('Добавить последствие');
await change('Участник последствия 1', 'a'); await change('Итоговое состояние · 1', 'dead'); await change('Итоговое состояние · 1', '');
h.update({ ...reviewProps, actors: [target] }); assert(h.button('Записать решение ГМа').props.disabled, 'Removed actors cannot retain valid effects');
h.update(reviewProps); await h.click('Записать решение ГМа'); assert(!has(sent[0].effects[0], 'finalStatus'), 'Cleared optional status is omitted from the exact payload');
h.dispose();
h.mount(FumbleReview, reviewProps); assert.equal(control('Решение ГМа').props.value, ''); h.dispose();

function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
console.log('Combat adjudication: explicit melee defenses/style bonuses, exact backend conventions, bounded GM fumble effects, visible receipts, disabled/repeated/stale/error flows passed. Hook harness; no browser rendering claimed.');
