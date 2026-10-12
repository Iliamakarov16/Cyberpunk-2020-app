"""Pure, bounded inventory-bound battle loadouts (no DB, roles, dice or costs).

The GM adapter supplies explicit profiles; names, icons, slots and equipped flags
never choose rules. One weapon item row represents one configured weapon even
when its quantity exceeds one. Character files and their item schema are unchanged.

Canonical state contains schemaVersion=1, weapons, activeWeaponId, ammoPools,
itemBindings, sheetVersion and legacy. Pool values are TOTAL inventory rounds,
including every loaded magazine. Reserve is always total minus all magazines in
that pool. Canonical weapons never store reserve. current_weapon returns a detached
compatibility view, so writing actor.weapon cannot change this authority.

All public functions return copies or scalars and leave their inputs unchanged.
LoadoutError exposes status/message for the HTTP adapter. The adapter must check
ownership and sheet/battle CAS versions BEFORE mutation, persist consume's delta
once, then rebind after its successful sheet CAS. Undo restores a saved state and
inventory together under those same CAS checks; this module cannot authorize undo.

New ranged profiles explicitly require fireModes, singleActionCap (shots in ONE
action), reliability and fumbleClass, independent of rof (round-wide shot budget).
These are GM-confirmed capabilities, not implementation of burst/auto rules.
Legacy migration preserves quantities, labels the result legacy, and permits only
a disclosed single-action cap of one until the GM confirms a new profile.
"""

import copy
import hashlib
import json
import re


SCHEMA_VERSION = 1
MAX_WEAPONS = 40
MAX_POOLS = 80
MAX_QUANTITY = 100000
MAX_VERSION = 10**9
MAX_SERIALIZED_BYTES = 256000
FIRE_MODES = ('single', 'burst', 'auto', 'suppress')
WEAPON_SKILLS = {'handgun': 'handgun', 'rifle': 'rifle', 'shotgun': 'rifle',
                 'smg': 'smg', 'heavy': 'heavy', 'archery': 'archery'}
# Exact supported translations from character-creation.ts / novice-rules.json.
# An arbitrary REF skill is not a shooting or fencing skill.
SKILL_ALIASES = {
    'handgun': frozenset(('handgun', 'пистолеты')),
    'rifle': frozenset(('rifle', 'винтовки', 'винтовки и ружья')),
    'smg': frozenset(('submachinegun', 'пистолеты-пулемёты')),
    'heavy': frozenset(('heavy weapons', 'тяжёлое оружие')),
    'archery': frozenset(('archery', 'стрельба из лука')),
    'melee': frozenset(('melee', 'ближний бой с оружием')),
    'fencing': frozenset(('fencing', 'фехтование')),
}
COMMON_CONFIG = frozenset(('weaponId', 'kind', 'profileId', 'weaponType',
                          'skillName', 'skillRank', 'damageDice', 'damageBonus', 'accuracy'))
RANGED_CONFIG = frozenset(('ammoItemId', 'range', 'rof', 'magazine', 'loaded',
                          'fireModes', 'singleActionCap', 'reliability', 'fumbleClass'))
COMMON_WEAPON = COMMON_CONFIG | {'id', 'name', 'skill'}
RANGED_WEAPON = (RANGED_CONFIG - {'loaded'}) | {'ammo'}
STATE_KEYS = frozenset(('schemaVersion', 'weapons', 'activeWeaponId', 'ammoPools',
                        'itemBindings', 'sheetVersion', 'legacy'))


class LoadoutError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)


def _fail(message, status=400):
    raise LoadoutError(status, message)


def _exact(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        _fail('Проверь поля подтверждённого набора оружия.')


def _integer(value, low, high, name='число'):
    if type(value) is not int or not low <= value <= high:
        _fail('Проверь ' + name + '.')
    return value


def _text(value, maximum=100, empty=False):
    if type(value) is not str or len(value) > maximum or (not value.strip() and not (empty and value == '')):
        _fail('Проверь название профиля или навыка.')
    if any(ord(char) < 32 for char in value):
        _fail('Название содержит управляющие символы.')
    try:
        value.encode('utf-8')
    except UnicodeError:
        _fail('Название содержит некорректный символ.')
    return value


def _identifier(value):
    if type(value) is not str or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', value):
        _fail('Проверь ID предмета из листа.')
    return value


def _version(value):
    return None if value is None else _integer(value, 0, MAX_VERSION, 'версию листа')


def _inventory(data):
    if type(data) is not dict or type(data.get('items')) is not list or len(data['items']) > 250:
        _fail('Проверь инвентарь листа.')
    result = {}
    for item in data['items']:
        if type(item) is not dict:
            _fail('Проверь строку инвентаря.')
        item_id = _identifier(item.get('id'))
        if item_id in result:
            _fail('У вещей должны быть разные ID.')
        _integer(item.get('quantity'), 0, MAX_QUANTITY, 'количество предметов')
        result[item_id] = item
    return result


def _item(inventory, item_id, category, positive=False):
    item = inventory.get(item_id)
    if not item or item.get('category') != category or positive and item['quantity'] < 1:
        _fail('Предмет оружия или строка патронов больше не доступны в листе.', 409)
    return item


def _fingerprint(item):
    value = copy.deepcopy(item)
    # Firing changes the ammo count; every other item field remains revision-bound.
    if value.get('category') == 'ammo':
        value.pop('quantity', None)
    try:
        encoded = json.dumps(value, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, UnicodeError):
        _fail('Строка инвентаря не может быть сохранена.')
    return hashlib.sha256(encoded).hexdigest()


def _skill_shape(name, rank, family=None):
    _text(name, empty=True)
    _integer(rank, 0, 10, 'ранг навыка')
    if name == '':
        if rank != 0:
            _fail('Без навыка разрешён только явно выбранный ранг 0.')
    elif family is not None and name.strip().casefold() not in SKILL_ALIASES[family]:
        _fail('Выбранный навык не относится к подтверждённому типу оружия.')


def _skill(data, name, rank, family=None):
    _skill_shape(name, rank, family)
    if name == '':
        return
    skills = data.get('skills')
    if type(skills) is not list or len(skills) > 150 or any(type(s) is not dict for s in skills):
        _fail('Проверь навыки листа.')
    rows = [s for s in skills if s.get('name') == name and s.get('stat') == 'REF']
    if len(rows) != 1 or type(rows[0].get('rank')) is not int or rows[0]['rank'] != rank:
        _fail('Название и ранг должны совпадать с одним боевым навыком REF в листе.', 409)


def _profile(value, legacy=False):
    for key, low, high in [('damageDice', 1, 20), ('damageBonus', -100, 100), ('accuracy', -10, 10)]:
        _integer(value.get(key), low, high, key)
    _text(value.get('profileId'))
    kind, weapon_type = value.get('kind'), value.get('weaponType')
    if kind == 'ranged':
        if type(weapon_type) is not str or weapon_type not in WEAPON_SKILLS and not (legacy and weapon_type == 'legacy'):
            _fail('Подтверди поддерживаемый тип стрелкового оружия.')
        family = WEAPON_SKILLS.get(weapon_type)
        for key, low, high in [('range', 1, 10000), ('rof', 1, 100), ('magazine', 1, 1000)]:
            _integer(value.get(key), low, high, key)
        _identifier(value.get('ammoItemId'))
        modes = value.get('fireModes')
        if type(modes) is not list or not 1 <= len(modes) <= len(FIRE_MODES) or any(type(m) is not str or m not in FIRE_MODES for m in modes) or len(set(modes)) != len(modes):
            _fail('Явно подтверди допустимые режимы огня.')
        _integer(value.get('singleActionCap'), 1 if 'single' in modes else 0,
                 value['rof'] if 'single' in modes else 0, 'предел одиночных атак')
        if 'burst' in modes and value['rof'] < 3:
            _fail('Очередь из трёх требует ROF не меньше 3.')
        if legacy and (modes != ['single'] or value['singleActionCap'] != 1):
            _fail('Старый профиль ограничен одиночной атакой до нового подтверждения ГМ.')
        if legacy:
            if value.get('reliability') is not None or value.get('fumbleClass') is not None:
                _fail('Надёжность и класс старого профиля требуют нового подтверждения ГМ.')
        elif value.get('reliability') not in ('VR', 'ST', 'UR') or value.get('fumbleClass') not in ('automatic', 'nonautomatic'):
            _fail('Явно подтверди надёжность и автоматический класс оружия.')
        elif any(mode in modes for mode in ('burst', 'auto', 'suppress')) and value['fumbleClass'] != 'automatic':
            _fail('Очередь, автоогонь и подавление требуют подтверждённого автоматического класса оружия.')
    elif kind == 'melee':
        if weapon_type != 'standard' or value.get('skillKind') not in ('melee', 'fencing'):
            _fail('Поддержан обычный профиль Melee/Fencing; особое оружие требует отдельных правил.')
        family = value['skillKind']
    else:
        _fail('Подтверди стрелковый или обычный рукопашный профиль.')
    _skill_shape(value.get('skillName'), value.get('skillRank'), family)
    return family


def _empty(sheet_version=None, legacy=False):
    return dict(schemaVersion=SCHEMA_VERSION, weapons=[], activeWeaponId=None,
                ammoPools={}, itemBindings={}, sheetVersion=_version(sheet_version), legacy=legacy)


def validate_state(state):
    """Check strict canonical shape and conservation; return a detached copy."""
    _exact(state, STATE_KEYS)
    if type(state['schemaVersion']) is not int or state['schemaVersion'] != SCHEMA_VERSION or type(state['legacy']) is not bool:
        _fail('Неподдерживаемая версия набора оружия.')
    _version(state['sheetVersion'])
    weapons, pools, bindings = state['weapons'], state['ammoPools'], state['itemBindings']
    if type(weapons) is not list or len(weapons) > MAX_WEAPONS or type(pools) is not dict or len(pools) > MAX_POOLS or type(bindings) is not dict:
        _fail('Слишком большой или некорректный набор оружия.')
    for item_id, total in pools.items():
        _identifier(item_id)
        _integer(total, 0, MAX_QUANTITY, 'общее количество патронов')
    seen, loaded = set(), {item_id: 0 for item_id in pools}
    for weapon in weapons:
        if type(weapon) is not dict:
            _fail('Проверь профиль оружия.')
        _exact(weapon, COMMON_WEAPON | (RANGED_WEAPON if weapon.get('kind') == 'ranged' else {'skillKind'}))
        item_id = _identifier(weapon['weaponId'])
        if weapon['id'] != item_id or item_id in seen or item_id in pools:
            _fail('ID оружия повторяется или совпадает с патронами.')
        seen.add(item_id)
        _text(weapon['name'])
        if weapon['skill'] != 'selectedWeapon':
            _fail('Боевой навык должен принадлежать выбранному профилю.')
        _profile(weapon, state['legacy'])
        if weapon['kind'] == 'ranged':
            count = _integer(weapon['ammo'], 0, weapon['magazine'], 'патроны в магазине')
            ammo_id = weapon['ammoItemId']
            if ammo_id not in pools:
                _fail('У магазина нет общего запаса патронов.')
            loaded[ammo_id] += count
    if state['activeWeaponId'] is not None:
        _identifier(state['activeWeaponId'])
        if state['activeWeaponId'] not in seen:
            _fail('Выбранное оружие отсутствует в подтверждённом наборе.', 409)
    if any(loaded[item_id] > total for item_id, total in pools.items()):
        _fail('Сумма заряженных магазинов превышает общее количество патронов.')
    expected = seen | set(pools)
    if set(bindings) != expected and not (state['legacy'] and not bindings):
        _fail('Привязки предметов не совпадают с набором оружия.')
    if any(type(value) is not str or not re.fullmatch(r'[0-9a-f]{64}', value) for value in bindings.values()):
        _fail('Некорректная привязка версии предмета.')
    return copy.deepcopy(state)


def validate_loadout(data, configs, activeWeaponId, previous=None, *, sheet_version=None, reset_loaded=False):
    """Validate GM profiles against actual inventory and skills, then normalize.

    Ranged config = COMMON_CONFIG + RANGED_CONFIG. Melee config = COMMON_CONFIG
    + skillKind ('melee'/'fencing'), weaponType='standard'. A previous magazine
    cannot be changed/rebound by preparation unless reset_loaded=True is explicitly
    authorized by the GM adapter. Pool totals ALWAYS come from the current sheet.
    """
    if type(configs) is not list or len(configs) > MAX_WEAPONS or type(reset_loaded) is not bool:
        _fail('Проверь подтверждённый набор оружия.')
    inventory = _inventory(data)
    prior = validate_state(previous) if previous is not None else None
    old = {w['id']: w for w in prior['weapons']} if prior else {}
    result = _empty(sheet_version)
    result['activeWeaponId'] = activeWeaponId
    for config in configs:
        if type(config) is not dict:
            _fail('Проверь профиль оружия.')
        kind = config.get('kind')
        _exact(config, COMMON_CONFIG | (RANGED_CONFIG if kind == 'ranged' else {'skillKind'}))
        family = _profile(config)
        weapon_id = _identifier(config['weaponId'])
        item = _item(inventory, weapon_id, 'weapon', positive=True)
        _text(item.get('name'))
        _skill(data, config['skillName'], config['skillRank'], family)
        weapon = copy.deepcopy(config)
        weapon.update(id=weapon_id, name=item['name'], skill='selectedWeapon')
        before = old.get(weapon_id)
        if before and not reset_loaded and before['kind'] == 'ranged' and (kind != 'ranged' or before['ammoItemId'] != config.get('ammoItemId')) and before['ammo']:
            _fail('Сначала явно разбери заряженный магазин при смене профиля или патронов.', 409)
        if kind == 'ranged':
            ammo_id = _identifier(config['ammoItemId'])
            ammo_item = _item(inventory, ammo_id, 'ammo')
            weapon['ammo'] = _integer(weapon.pop('loaded'), 0, weapon['magazine'], 'патроны в магазине')
            if before and before['kind'] == 'ranged' and not reset_loaded and weapon['ammo'] != before['ammo']:
                _fail('Подготовка не пополняет магазин: сохрани его состояние или явно подтверди сброс.', 409)
            result['ammoPools'][ammo_id] = ammo_item['quantity']
            result['itemBindings'][ammo_id] = _fingerprint(ammo_item)
        result['weapons'].append(weapon)
        result['itemBindings'][weapon_id] = _fingerprint(item)
    return validate_state(result)


def _find(state, weapon_id, active=False):
    _identifier(weapon_id)
    weapon = next((w for w in state['weapons'] if w['id'] == weapon_id), None)
    if weapon is None or active and state['activeWeaponId'] != weapon_id:
        _fail('Оружие отсутствует или больше не является выбранным.', 409)
    return weapon


def _reserve(state, ammo_id):
    if ammo_id not in state['ammoPools']:
        _fail('Общий запас патронов недоступен.', 409)
    return state['ammoPools'][ammo_id] - sum(w['ammo'] for w in state['weapons']
        if w['kind'] == 'ranged' and w['ammoItemId'] == ammo_id)


def reserve_for(state, ammo_item_id):
    """Return one reserve for the ammo item, never sum weapon-view reserves."""
    value = validate_state(state)
    return _reserve(value, _identifier(ammo_item_id))


def unarmed_weapon():
    """Legacy display shape only; no firearm or inventory authority."""
    return dict(id='unarmed', name='Без огнестрельного оружия', kind='unarmed',
                skill='selectedWeapon', ammo=0, reserve=0, magazine=1, weaponId=None,
                ammoItemId=None, skillName='', skillRank=0, damageDice=1, damageBonus=0,
                accuracy=0, range=1, rof=1, fireModes=[], singleActionCap=0, unarmed=True)


def current_weapon(state):
    """Detached actor.weapon view; null is unarmed, invalid ID never falls back."""
    value = validate_state(state)
    if value['activeWeaponId'] is None:
        return unarmed_weapon()
    weapon = _find(value, value['activeWeaponId'])
    if weapon['kind'] == 'ranged':
        weapon['reserve'] = _reserve(value, weapon['ammoItemId'])
    weapon['legacy'] = value['legacy']
    return weapon


def activate(state, weapon_id):
    """Select an existing item without changing magazines, pools or action costs."""
    value = validate_state(state)
    if weapon_id is not None:
        _find(value, weapon_id)
    value['activeWeaponId'] = weapon_id
    return value


def consume(state, weapon_id, rounds):
    """Consume loaded rounds and return (state, atomic sheet-inventory delta)."""
    value = validate_state(state)
    weapon = _find(value, weapon_id, active=True)
    if weapon['kind'] != 'ranged':
        _fail('У этого оружия нет стрелкового магазина.')
    _integer(rounds, 1, 1000, 'расход патронов')
    if rounds > weapon['ammo']:
        _fail('В выбранном магазине недостаточно патронов.', 409)
    weapon['ammo'] -= rounds
    value['ammoPools'][weapon['ammoItemId']] -= rounds
    return value, dict(ammoItemId=weapon['ammoItemId'], delta=-rounds)


def reload(state, weapon_id, count=None):
    """Move reserve into the selected magazine; never change inventory total."""
    value = validate_state(state)
    weapon = _find(value, weapon_id, active=True)
    if weapon['kind'] != 'ranged':
        _fail('У этого оружия нет стрелкового магазина.')
    available = min(weapon['magazine'] - weapon['ammo'], _reserve(value, weapon['ammoItemId']))
    if available <= 0:
        _fail('Магазин полон или запасных патронов нет.', 409)
    amount = available if count is None else _integer(count, 1, available, 'число патронов для перезарядки')
    weapon['ammo'] += amount
    return value


def remove_weapon(state, weapon_id):
    """Administrative unload/removal, not a gameplay drop action.

    The pool keeps all rounds. Removing a magazine releases its rounds to reserve.
    The adapter separately owns inventory item removal and any confirmation.
    """
    value = validate_state(state)
    _find(value, weapon_id)
    value['weapons'] = [w for w in value['weapons'] if w['id'] != weapon_id]
    value['itemBindings'].pop(weapon_id, None)
    if value['activeWeaponId'] == weapon_id:
        value['activeWeaponId'] = None
    return validate_state(value)


def _check_binding(state, data, sheet_version, check_version=True, allow_unbound=False):
    inventory = _inventory(data)
    _version(sheet_version)
    if check_version and state['sheetVersion'] is not None and sheet_version != state['sheetVersion']:
        _fail('Лист изменился после подтверждения набора оружия.', 409)
    expected = {w['id'] for w in state['weapons']} | set(state['ammoPools'])
    if expected and not state['itemBindings'] and not allow_unbound:
        _fail('Старый набор ещё не привязан к текущим строкам листа.', 409)
    for weapon in state['weapons']:
        _item(inventory, weapon['id'], 'weapon', positive=True)
        family = _profile(weapon, state['legacy'])
        _skill(data, weapon['skillName'], weapon['skillRank'], family)
    for ammo_id, total in state['ammoPools'].items():
        item = _item(inventory, ammo_id, 'ammo')
        if item['quantity'] != total:
            _fail('Общее количество патронов в листе изменилось.', 409)
    for item_id, fingerprint in state['itemBindings'].items():
        if item_id not in inventory or _fingerprint(inventory[item_id]) != fingerprint:
            _fail('Строка связанного предмета изменилась; нужно новое подтверждение ГМ.', 409)
    return inventory


def validate_binding(state, data, sheet_version=None):
    """Reject stale versions, foreign/missing items, changed skills and ammo drift."""
    _check_binding(validate_state(state), data, sheet_version)
    return True


def rebind(state, data, sheet_version):
    """Refresh only the revision after adapter CAS; never accept changed items.

    Pass post-persistence data whose ammo totals already match consume's result.
    This function is not permission to accept an external edit or skip old CAS.
    """
    value = validate_state(state)
    _integer(sheet_version, 0, MAX_VERSION, 'новую версию листа')
    if value['sheetVersion'] is not None and sheet_version < value['sheetVersion']:
        _fail('Нельзя вернуть привязку к старой версии листа.', 409)
    _check_binding(value, data, sheet_version, check_version=False)
    value['sheetVersion'] = _version(sheet_version)
    return value


def migrate_weapon(weapon, sheet_version=None, *, data=None):
    """Wrap ONE legacy actor.weapon exactly once, preserving loaded and reserve.

    For sheet actors pass data to establish bindings while the adapter checks its
    old sheet version. Without data, the explicitly legacy result is unbound and
    cannot validate_binding against a live sheet. Synthetic NPC pool IDs are local
    bookkeeping, never real inventory IDs. No current inventory refills a magazine.
    """
    value = _empty(sheet_version, legacy=True)
    if weapon is None:
        return value
    if type(weapon) is not dict:
        _fail('Проверь старый профиль оружия.')
    if weapon.get('unarmed') is True:
        for field in ('ammo', 'reserve'):
            if field in weapon:
                _integer(weapon[field], 0, 0, 'патроны у невооружённого участника')
        return value
    weapon_id = _identifier(weapon.get('id') if weapon.get('weaponId') is None else weapon['weaponId'])
    ammo_id = weapon.get('ammoItemId')
    if ammo_id is None:
        ammo_id = 'legacy-ammo-' + hashlib.sha256(weapon_id.encode('utf-8')).hexdigest()[:16]
    _identifier(ammo_id)
    loaded = _integer(weapon.get('ammo'), 0, 1000, 'патроны старого магазина')
    reserve = _integer(weapon.get('reserve'), 0, MAX_QUANTITY, 'старый запас патронов')
    normalized = {key: copy.deepcopy(weapon.get(key)) for key in
                  ('name', 'damageDice', 'damageBonus', 'accuracy', 'range', 'rof', 'magazine')}
    normalized.update(id=weapon_id, weaponId=weapon_id, kind='ranged', profileId='legacy-single-only',
        weaponType='legacy', skill='selectedWeapon', skillName=weapon.get('skillName', ''),
        skillRank=weapon.get('skillRank', 0), ammoItemId=ammo_id, ammo=loaded,
        fireModes=['single'], singleActionCap=1, reliability=None, fumbleClass=None)
    value.update(weapons=[normalized], activeWeaponId=weapon_id, ammoPools={ammo_id: loaded + reserve})
    value = validate_state(value)
    if data is not None:
        inventory = _check_binding(value, data, sheet_version, allow_unbound=True)
        value['itemBindings'] = {item_id: _fingerprint(inventory[item_id]) for item_id in (weapon_id, ammo_id)}
    return validate_state(value)


def serialize(state):
    """Stable, strict JSON snapshot suitable for persisted state/undo receipts."""
    value = json.dumps(validate_state(state), ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False)
    if len(value.encode('utf-8')) > MAX_SERIALIZED_BYTES:
        _fail('Слишком большой набор оружия.')
    return value


def deserialize(raw):
    """Read only this canonical schema; reject duplicate keys and non-JSON numbers."""
    if type(raw) is not str or len(raw) > MAX_SERIALIZED_BYTES:
        _fail('Некорректная запись набора оружия.')
    try:
        if len(raw.encode('utf-8')) > MAX_SERIALIZED_BYTES:
            _fail('Слишком большой набор оружия.')
        def pairs(rows):
            out = {}
            for key, value in rows:
                if key in out:
                    _fail('Повтор поля в записи набора оружия.')
                out[key] = value
            return out
        def constant(_):
            _fail('Некорректное число в записи набора оружия.')
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        _fail('Некорректная запись набора оружия.')
    return validate_state(value)
