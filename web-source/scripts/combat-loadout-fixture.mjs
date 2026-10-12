// Explicit, synthetic server projections for UI hook tests. These fixtures are
// not an equipment inference engine or a substitute for inventory/CP2020 tests.
import assert from 'node:assert/strict';

export function confirmedFixtureActor(actor, overrides = {}) {
    const old = actor.weapon || {}, ammo = overrides.ammo ?? old.ammo ?? 8, reserve = overrides.reserve ?? old.reserve ?? 0;
    const weapon = {
        id: 'gun', weaponId: 'gun', name: old.name || 'Подтверждённый тестовый пистолет', kind: 'ranged', profileId: 'fixture-handgun', weaponType: 'handgun',
        skill: 'selectedWeapon', skillName: 'Handgun', skillRank: 4, damageDice: 4, damageBonus: 1, accuracy: 0,
        ammoItemId: 'ammo', range: 50, rof: 1, magazine: Math.max(8, ammo), fireModes: ['single'], singleActionCap: 1,
        reliability: 'ST', fumbleClass: 'nonautomatic', ammo,
        ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'reserve')),
    };
    const loadout = { schemaVersion: 1, weapons: [weapon], activeWeaponId: weapon.id, ammoPools: { [weapon.ammoItemId]: ammo + reserve }, itemBindings: { [weapon.weaponId]: '0'.repeat(64), [weapon.ammoItemId]: '1'.repeat(64) }, sheetVersion: actor.sheetVersion ?? 1, legacy: false };
    return { ...actor, stats: { ...actor.stats, selectedWeapon: weapon.skillRank }, loadout, weapon: { ...weapon, reserve, legacy: false, unarmed: false }, shotsByWeapon: {}, weaponJams: {}, unavailableWeapons: [] };
}

export function confirmedFixtureScene(scene) {
    return { ...scene, actors: scene.actors.map(actor => confirmedFixtureActor(actor)), settings: { ...scene.settings, cp2020Rulings: { nonautomaticFumbleAmmo: 'consume-attempted' } } };
}

export function fixtureFirePreview(command, { base = 7, difficulty = 15 } = {}) {
    assert.equal(command.type, 'fire', 'Current combat previews must use explicit firing actions');
    assert.equal(command.mode, 'single'); assert.equal(command.rounds, 1);
    assert(Array.isArray(command.targetIds) && command.targetIds.length === 1);
    const turn = command.gmFire?.turnToTarget;
    return { ok: true, text: 'Огневое действие', mode: command.mode, rounds: command.rounds, readyToRoll: true,
        requiresGmFireDecision: typeof turn !== 'boolean', turnPenalty: turn ? -2 : 0, unresolvedRulings: [],
        rulingsUsed: { nonautomaticFumbleAmmo: 'consume-attempted' },
        targets: command.targetIds.map(id => ({ id, base: base + (turn ? -2 : 0), difficulty, rangeBand: 'close', modeModifier: 0, allocatedRounds: command.rounds })) };
}

export async function beginFixtureFire(h) {
    const attack = h.buttons().find(node => node.props.className?.includes('hotbar-slot') && h.text(node).trim() === 'Атака');
    assert(attack, 'A confirmed loadout exposes Attack in the hotbar');
    await h.click(attack);
    assert(h.find(node => node.props['aria-label'] === 'Выбор атаки'));
    assert.equal(h.find(node => node.props['aria-label'] === 'Режим огня').props.value, 'single');
    assert.equal(h.find(node => node.props['aria-label'] === 'Патронов в действии').props.value, 1);
    await h.click('Выбрать цель огня');
}

export function fixtureConfirmButton(h) {
    const button = h.find(node => node.type === 'button' && node.props.className?.includes('confirm-action'));
    assert(button, 'Authoritative preview exposes one confirmation button');
    return button;
}

export async function confirmFixtureFire(h, turnToTarget = false) {
    await h.click(turnToTarget ? 'Разворот · −2' : 'Без разворота');
    await h.click(fixtureConfirmButton(h));
}
