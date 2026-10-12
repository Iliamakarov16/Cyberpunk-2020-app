// Read-only presentation/validation for the training-only GM batch. The server
// owns authorization, exact source matching, inventory binding and atomic writes.
// Source numbers are deliberately separate from explicitly reviewed demo choices.
export const TRAINING_WEAPON_SOURCES = Object.freeze({
    'colt-amt2000': Object.freeze({ weaponId: 'colt-amt2000', name: 'Colt AMT 2000', skill: 'handgun', skillName: 'Handgun', damageDice: 4, damageBonus: 1, accuracy: 0, range: 50, rof: 1, magazine: 8, reliability: 'VR', source: 'Core 2020 · стр. 61–63' }),
    'militech-ronin': Object.freeze({ weaponId: 'militech-ronin', name: 'Militech Ronin', skill: 'rifle', skillName: 'Rifle', damageDice: 5, damageBonus: 0, accuracy: 1, range: 400, rof: 30, magazine: 35, reliability: 'VR', source: 'Core 2020 · стр. 61–63' }),
});

export const TRAINING_RULING_FIELDS = Object.freeze([
    { key: 'nonautomaticFumbleAmmo', label: 'Обычная критическая ошибка · патроны', choices: [['consume-attempted', 'Списать только предпринятые выстрелы']], help: 'Случайный дополнительный выстрел требует отдельного решения ГМа.' },
    { key: 'jamAmmo', label: 'Задержка автоматики · патроны', choices: [['consume-declared', 'Списать все объявленные патроны']], help: 'Это соглашение о расходе: core не задаёт число выстрелов до задержки.' },
    { key: 'burstHitRounding', label: 'Очередь · округление попаданий d6/2', choices: [['floor', 'Вниз'], ['ceil', 'Вверх']], help: 'Направление округления в core не задано.' },
    { key: 'autoTenRoundGroups', label: 'Автоогонь · неполные десятки', choices: [['floor', 'Только полные десятки'], ['ceil', 'Неполную десятку считать полной']], help: 'Соглашение для модификатора от неполных групп по 10 патронов.' },
    { key: 'autoModifierBasis', label: 'Автоогонь · база для нескольких целей', choices: [['allocated', 'Патроны каждой цели'], ['declared', 'Все объявленные патроны']], help: 'Текст core не разрешает эту неоднозначность явно.' },
    { key: 'autoReducedRounds', label: 'Автоогонь · уменьшенная очередь', choices: [['allow-declared', 'Разрешить объявленное число патронов']], help: 'Включая неполный магазин и очередь короче оставшегося ROF.' },
    { key: 'autoAllocationRemainder', label: 'Автоогонь · остаток между целями', choices: [['consume-unallocated', 'Списать нераспределённый остаток']], help: 'После равного распределения с округлением вниз.' },
    { key: 'autoPointBlankModifier', label: 'Автоогонь в упор · модификатор', min: -100, max: 100, help: 'Явное целое число. Core не задаёт этот модификатор; 0 тоже требует решения.' },
    {key:'coverArmorWear',label:'Броня за укрытием · износ',choices:[['none','Без автоматического износа'],['body','Износ носимой брони']],help:'Сохранённое соглашение сцены.'},
    { key: 'punchRounding', label: 'Удар рукой · округление d6/2', choices: [['down', 'Вниз'], ['up', 'Вверх']], help: 'Сохранённое соглашение для рукопашной.' },
]);

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const numericKeys = ['damageDice', 'damageBonus', 'accuracy', 'range', 'rof', 'magazine'];
const manual = 'Открой обычный редактор снаряжения участника: быстрая подготовка не меняет неизвестные или изменённые профили.';
const confirmed = actor => record(actor.loadout) && actor.loadout.legacy === false && actor.weapon?.legacy !== true;

/** This cannot prove the transport is training. The caller MUST gate by training
 * and GM authority; the authoritative command checks both again. */
export function trainingLoadoutGroups(scene) {
    const groups = [], preserved = [];
    const fail = error => ({ groups, preserved, error });
    if (!record(scene) || !['preparation', 'ended'].includes(scene.phase) || !Array.isArray(scene.actors)) return fail('Подготовка оружия доступна до боя или после его завершения.');
    for (const actor of scene.actors) {
        if (!record(actor)) return fail(manual);
        if (actor.characterId != null && (!Number.isInteger(actor.characterId) || actor.characterId >= 0) || ['character', 'sheet'].includes(actor.origin?.kind)) return fail('Быстрая подготовка доступна только учебным участникам. Реальные листы меняются в подготовке кампании.');
        if (actor.status === 'dead') continue;
        const actorError = message => fail((actor.name || actor.id || 'Участник') + ': ' + message);
        if (actor.droppedWeapons?.length || actor.unavailableWeapons?.length || Object.values(actor.weaponJams || {}).some(value => value > 0)) return actorError('Сначала явно подтверди готовность оружия в снаряжении: есть выпавшее оружие или задержка.');
        if (confirmed(actor)) { preserved.push({ id: actor.id, name: actor.name || actor.id }); continue; }
        if (actor.loadout != null && (!actor.loadout.legacy || !Array.isArray(actor.loadout.weapons) || actor.loadout.weapons.length !== 1 || actor.loadout.activeWeaponId !== actor.loadout.weapons[0]?.id)) return actorError(manual);
        const weapon = actor.weapon;
        if (weapon?.unarmed) continue;
        if (!record(weapon)) return actorError(manual);
        const source = Object.hasOwn(TRAINING_WEAPON_SOURCES, weapon.id) ? TRAINING_WEAPON_SOURCES[weapon.id] : null;
        if (!source || numericKeys.some(key => weapon[key] !== source[key]) || weapon.weaponId != null && weapon.weaponId !== weapon.id || actor.loadout != null && actor.loadout.activeWeaponId !== weapon.id) return actorError(manual);
        const migrated = actor.loadout?.legacy === true;
        const inventorySkills = actor.sceneInventory?.skills?.filter(skill => skill.stat === 'REF' && skill.name === source.skillName);
        const skillRank = inventorySkills ? inventorySkills.length === 1 ? inventorySkills[0].rank : null : actor.stats?.[source.skill];
        if (!integer(skillRank, 0, 10) || !integer(weapon.ammo, 0, source.magazine) || !integer(weapon.reserve, 0, 100000) || weapon.ammo + weapon.reserve > 100000) return actorError(manual);
        if (migrated && actor.loadout.ammoPools?.[weapon.ammoItemId] !== weapon.ammo + weapon.reserve) return actorError(manual);
        let group = groups.find(row => row.weaponId === source.weaponId);
        if (!group) { group = { ...source, actors: [] }; groups.push(group); }
        group.actors.push({ id: actor.id, name: actor.name || actor.id, loaded: weapon.ammo, total: weapon.ammo + weapon.reserve, skillRank });
    }
    return { groups, preserved, error: null };
}

/** Explicitly chosen teaching aid, never a claimed canonical weapon capability. */
export function trainingLoadoutDemoChoices(groups) {
    return groups.map(group => ({ weaponId: group.weaponId, fireModes: ['single'], singleActionCap: 1, fumbleClass: group.weaponId === 'militech-ronin' ? 'automatic' : 'nonautomatic' }));
}

export function trainingLoadoutRequiredRulings(scene, choices = []) {
    const needed = new Set();
    const weapons = [...choices, ...(scene?.actors || []).filter(actor => actor.status !== 'dead' && confirmed(actor)).flatMap(actor => actor.loadout.weapons || [])];
    for (const weapon of weapons) {
        if (weapon.kind === 'melee') continue;
        if (weapon.fumbleClass === 'automatic') needed.add('jamAmmo');
        if (weapon.fumbleClass === 'nonautomatic') needed.add('nonautomaticFumbleAmmo');
        if (weapon.fireModes?.includes('burst')) needed.add('burstHitRounding');
        if (weapon.fireModes?.includes('auto')) for (const key of ['autoTenRoundGroups', 'autoModifierBasis', 'autoReducedRounds', 'autoAllocationRemainder', 'autoPointBlankModifier']) needed.add(key);
    }
    return TRAINING_RULING_FIELDS.filter(field => needed.has(field.key)).map(field => field.key);
}

export function trainingLoadoutRulingsError(rulings) {
    if (!record(rulings)) return 'Проверь соглашения сцены.';
    for (const [key, value] of Object.entries(rulings)) {
        const field = TRAINING_RULING_FIELDS.find(row => row.key === key);
        if (!field || (field.choices ? !field.choices.some(([choice]) => choice === value) : !integer(value, field.min, field.max))) return 'Проверь соглашения сцены: допустимы только перечисленные варианты и целый модификатор от −100 до 100.';
    }
    return null;
}

export function trainingLoadoutSetupError(scene, choices, rulings) {
    const { groups, error } = trainingLoadoutGroups(scene);
    if (error) return error;
    if (!groups.length) return 'Учебные профили уже подтверждены. Соглашения можно изменить в меню сцены.';
    if (!Array.isArray(choices) || choices.length !== groups.length || new Set(choices.map(choice => choice?.weaponId)).size !== groups.length) return 'Подтверди выбор для каждого типа учебного оружия.';
    for (const choice of choices) {
        const group = groups.find(row => row.weaponId === choice?.weaponId);
        if (!record(choice) || !group || Object.keys(choice).some(key => !['weaponId', 'fireModes', 'singleActionCap', 'fumbleClass'].includes(key))) return 'Проверь выбор учебного оружия.';
        if (!Array.isArray(choice.fireModes) || !choice.fireModes.length || choice.fireModes.some(mode => !['single', 'burst', 'auto'].includes(mode)) || new Set(choice.fireModes).size !== choice.fireModes.length) return 'Явно выбери режимы огня для каждого типа оружия.';
        if (choice.fireModes.includes('burst') && group.rof < 3) return 'Очередь из трёх требует ROF не меньше 3.';
        const single = choice.fireModes.includes('single');
        if (!integer(choice.singleActionCap, single ? 1 : 0, single ? group.rof : 0)) return 'Подтверди предел одиночных выстрелов за действие: от 1 до ROF, либо 0 без одиночного режима.';
        if (!['automatic', 'nonautomatic'].includes(choice.fumbleClass)) return 'Явно выбери класс критической ошибки для каждого типа оружия.';
        if (choice.fireModes.some(mode => mode !== 'single') && choice.fumbleClass !== 'automatic') return 'Очередь и автоогонь требуют автоматического класса критической ошибки.';
    }
    const rulingError = trainingLoadoutRulingsError(rulings);
    if (rulingError) return rulingError;
    if (trainingLoadoutRequiredRulings(scene, choices).some(key => !Object.hasOwn(rulings, key))) return 'Подтверди применимые соглашения сцены, чтобы выбранные режимы были доступны с первого выстрела.';
    return null;
}
