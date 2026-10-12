"""Server-authoritative, bounded CP2020 shared firefight.

The accepted original tactical engine is the rules reference. All mutations and
randomness are authoritative; players declare actions for GM approval. Views and
previews are filtered. No client scene snapshots or client undo are accepted.
"""
import copy
import hashlib
import heapq
import json
import math
import secrets
import time
import uuid
import battle_vision
import battle_loadout
import cp2020_melee
import battle_ranged
import battle_cover
import battle_cover_scene
import battle_ballistics

ZONES = ['head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']
FACES = ['head', 'torso', 'torso', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'rightLeg', 'leftLeg', 'leftLeg']
# Stable cosmetic IDs: the original 0–3 and eight additional appearances.
# Appearance never chooses or modifies an NPC's authoritative stat template.
MAX_SPRITE_ID = 11
# Square-grid scenery. w/h are occupied cells from a top-left integer anchor.
# Vehicles use fixed footprints; swapping w/h encodes a 90-degree rotation.
# They use the original movement and lower-body cover rules, never vehicle rules.
PROP_CATALOG = {
    'table': dict(w=2, h=1, label='Стол'),
    'counter': dict(w=5, h=1, label='Стойка'),
    'barrel': dict(w=1, h=1, label='Бочка'),
    'crate': dict(w=1, h=1, label='Ящик'),
    'car': dict(w=4, h=2, label='Машина'),
    'van': dict(w=5, h=2, label='Фургон'),
}


def prop_footprint(kind, orientation='horizontal'):
    if type(kind) is not str or kind not in PROP_CATALOG or not (orientation in ('horizontal', 'vertical') or type(orientation) is int and orientation in (0, 90, 180, 270)):
        fail('Неизвестный предмет или направление.')
    entry = PROP_CATALOG[kind]
    return (entry['h'], entry['w']) if orientation in ('vertical', 90, 270) else (entry['w'], entry['h'])


def rectangles_overlap(a, b):
    return a['x'] < b['x'] + b['w'] and b['x'] < a['x'] + a['w'] and a['y'] < b['y'] + b['h'] and b['y'] < a['y'] + a['h']


RULES_NOTE = ('Ранения, патроны и однозначно сопоставленный SP сохраняются транзакционно. '
              'Ручной SP и один действующий слой изнашиваются в листе; для нескольких слоёв или переопределённого SP нужен ручной разбор ГМа. '
              'Кубики бросает сервер. Лист отмечает до 40 ранений; полный урон и состояние сохраняются в бою.')
TRAINING_NOTE = ('TRAINING · Учебный бой. Вымышленные участники, ранения и патроны хранятся отдельно. '
                 'Реальные листы, кампания и её бой не изменяются. Движение, стрельбу, перезарядку и Сеть рассчитывает сервер. Износ брони в демонстрации включён.')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS shared_battles (
 campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
 battle_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shared_battle_commands (
 campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 command_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 battle_id TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL,
 PRIMARY KEY(campaign_id, command_id));
CREATE TABLE IF NOT EXISTS training_battles (
 campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
 battle_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS training_battle_commands (
 campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 command_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 battle_id TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL,
 PRIMARY KEY(campaign_id, command_id));
'''


class BattleError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message
        super().__init__(message)


def fail(message, status=400):
    raise BattleError(status, message)


def exact(raw, keys, optional=()):
    if not isinstance(raw, dict) or set(raw) - set(keys) - set(optional) or set(keys) - set(raw):
        fail('Проверь поля команды боя.')


def integer(value, minimum, maximum, label='число'):
    if type(value) is not int or not minimum <= value <= maximum:
        fail('Проверь ' + label + '.')
    return value


def label(value, limit=100):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        fail('Проверь название или идентификатор.')
    return value.strip()


def heading(value):
    if type(value) is not int or value not in battle_vision.HEADING_VECTORS:
        fail('Направление: 0, 45, 90, 135, 180, 225, 270 или 315 градусов.')
    return value


def set_heading(actor, value):
    actor['heading'] = heading(value)
    dx = battle_vision.HEADING_VECTORS[value][0]
    if dx:
        actor['facing'] = -1 if dx < 0 else 1


def heading_towards(actor, target):
    # Eight directions are an application convention. Mid-sector ties round
    # clockwise; movement path segments themselves are exact grid directions.
    dx, dy = target['x'] - actor['x'], target['y'] - actor['y']
    return int(math.floor((math.degrees(math.atan2(dy, dx)) + 22.5) / 45)) % 8 * 45 if dx or dy else battle_vision.actor_heading(actor)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def d10(rng):
    return min(10, max(1, math.floor(rng() * 10) + 1))


def wound_info(wounds):
    if wounds == 0:
        return 0, 0, -1
    if wounds <= 4:
        return 1, 0, -1
    if wounds <= 8:
        return 2, 1, -1
    if wounds <= 12:
        return 3, 2, -1
    level = (wounds - 13) // 4
    return 4 + level, 3 + level, level


def effective_ref(actor):
    band = wound_info(actor['wounds'])[0]
    ref = actor['stats']['ref']
    return math.ceil(ref / 3) if band >= 4 else math.ceil(ref / 2) if band == 3 else max(0, ref - 2) if band == 2 else ref


def body_modifier(body):
    return 0 if body <= 2 else 1 if body <= 4 else 2 if body <= 7 else 3 if body <= 9 else 4 if body == 10 else 5


def range_difficulty(distance, distance_range):
    for maximum, difficulty in [(1, 10), (distance_range / 4, 15), (distance_range / 2, 20), (distance_range, 25), (distance_range * 2, 30)]:
        if distance <= maximum:
            return difficulty
    return math.inf


def resolve_hit(target, raw_damage, location, settings, rng, protection=None):
    sp = target['armor'][location]
    penetration = protection['penetration'] if protection is not None else max(0, raw_damage - sp)
    composite=bool(protection and any(step['outerSP']>0 for step in protection['steps']))
    metadata=dict(coverProtection=copy.deepcopy(protection),coverComposite=composite,coverArmorWear=settings.get('cp2020Rulings',{}).get('coverArmorWear')) if protection is not None else {}
    wear_allowed=not composite or settings.get('cp2020Rulings',{}).get('coverArmorWear')=='body'
    btm = body_modifier(target['stats']['body'])
    if not penetration:
        return dict(rawDamage=raw_damage, sp=sp, penetration=0, btm=btm, damage=0, location=location,
                    stunRoll=None, stunLimit=None, targetStatus=target['status'], deathCause=None,**metadata)
    damage = max(1, penetration - btm) * (2 if location == 'head' else 1)
    target['wounds'] += damage
    if settings.get('stagedPenetration') and sp > 0 and wear_allowed:
        target['armor'][location] -= 1
    immediate_death_roll = death_cause = None
    if location == 'head' and damage > 8:
        target['status'], death_cause = 'dead', 'head'
    elif location != 'torso' and damage > 8:
        if location not in target['destroyed']:
            target['destroyed'].append(location)
        immediate_death_roll = d10(rng)
        if immediate_death_roll > target['stats']['body']:
            target['status'], death_cause = 'dead', 'limb-shock'
    limit = target['stats']['body'] - wound_info(target['wounds'])[1]
    roll = None if target['status'] == 'dead' else d10(rng)
    if roll is not None and roll > limit:
        target['status'] = 'stunned'
    return dict(rawDamage=raw_damage, sp=sp, penetration=penetration, btm=btm, damage=damage, location=location,
                stunRoll=roll, stunLimit=limit, immediateDeathRoll=immediate_death_roll,
                targetStatus=target['status'], deathCause=death_cause,**metadata)


def prop_at(scene, x, y):
    return next((p for p in scene['props'] if p['x'] <= x < p['x'] + p['w'] and p['y'] <= y < p['y'] + p['h']), None)


def line_of_fire(scene, actor, target):
    cells, seen = [], set()
    steps = math.ceil(math.hypot(actor['x'] - target['x'], actor['y'] - target['y']) * 12)
    for i in range(1, steps):
        x = math.floor(actor['x'] + .5 + (target['x'] - actor['x']) * i / steps)
        y = math.floor(actor['y'] + .5 + (target['y'] - actor['y']) * i / steps)
        if (x, y) not in seen and (x, y) not in [(actor['x'], actor['y']), (target['x'], target['y'])]:
            seen.add((x, y)); cells.append((x, y))
    blocked = any(scene['tiles'][y][x]['type'] == 'wall' or (scene['tiles'][y][x]['type'] == 'door' and not scene['tiles'][y][x]['open']) for x, y in cells)
    cover = None
    for x, y in cells:
        p = prop_at(scene, x, y)
        if p and p['cover'] and max(abs(target['x'] - max(p['x'], min(target['x'], p['x'] + p['w'] - 1))), abs(target['y'] - max(p['y'], min(target['y'], p['y'] + p['h'] - 1)))) <= 1:
            cover = p
            break
    return dict(blocked=blocked, cover=cover, exposed=[z for z in ZONES if not cover or 'Leg' not in z])


def find_actor(scene, aid):
    actor = next((a for a in scene['actors'] if a['id'] == aid), None)
    if not actor:
        fail('Персонаж боя недоступен.', 404)
    return actor


def walkable(scene, x, y, exclude=None):
    if type(x) is not int or type(y) is not int or not (0 <= x < scene['width'] and 0 <= y < scene['height']):
        return False
    tile = scene['tiles'][y][x]
    return not (tile['type'] == 'wall' or (tile['type'] == 'door' and not tile['open']) or prop_at(scene, x, y) or any(a['id'] != exclude and a['x'] == x and a['y'] == y and a['status'] != 'dead' for a in scene['actors']))


def valid_placement(scene, actor):
    # Corpses do not occupy a cell in the original engine; preparation must
    # preserve that rule regardless of participant serialization order.
    terrain = dict(scene, actors=[]) if actor['status'] == 'dead' else scene
    return walkable(terrain, actor['x'], actor['y'], actor['id'])


def preview_shot(scene, cmd, gm=False):
    actor, target = find_actor(scene, cmd['actorId']), find_actor(scene, cmd['targetId'])
    if scene['phase'] != 'combat' or not scene['order'] or scene['order'][scene['index']] != actor['id']:
        fail('Сейчас не ход этого персонажа.', 409)
    if actor['status'] != 'active':
        fail('Персонаж не может стрелять: погиб или оглушён.', 409)
    if target['id'] == actor['id'] or target['status'] == 'dead' or (target['hidden'] and not gm):
        fail('Выбери доступную живую цель.')
    if actor.get('loadout') is not None:fail('Подтверждённый профиль использует огневое действие с режимом и правилами критической ошибки; прежний выстрел недоступен.')
    weapon=sync_weapon(actor)
    if weapon.get('kind')=='melee' or weapon.get('unarmed'): fail('Подготовь огнестрельное оружие.')
    spent=actor.get('shotsByWeapon',{}).get(weapon['id'],0) if actor.get('loadout') is not None else actor['shots']
    if actor['weapon']['ammo'] < 1 or spent >= actor['weapon']['rof']:
        fail('Нет патронов или исчерпана скорострельность.', 409)
    line = line_of_fire(scene, actor, target)
    if line['blocked']:
        fail('Линию огня перекрывает стена или закрытая дверь.')
    location = cmd.get('location', 'random')
    if location not in ['random'] + ZONES:
        fail('Неизвестная часть тела.')
    if location != 'random' and location not in line['exposed']:
        fail('Эту часть тела закрывает укрытие.')
    distance = math.hypot(actor['x'] - target['x'], actor['y'] - target['y']) * scene['tileMeters']
    difficulty = range_difficulty(distance, actor['weapon']['range'])
    if not math.isfinite(difficulty):
        fail('Цель вне дальности оружия.')
    called = 0 if location == 'random' else -4
    base = effective_ref(actor) + actor['stats'].get(actor['weapon']['skill'], 0) + actor['weapon']['accuracy'] - 3 * actor['actions'] + called - (2 if cmd.get('turnToTarget') is True else 0)
    return dict(distance=distance, difficulty=difficulty, base=base, called=called, cover=bool(line['cover']))


def resolve_shot(scene, cmd, rng):
    preview = preview_shot(scene, cmd, True)
    actor, target = find_actor(scene, cmd['actorId']), find_actor(scene, cmd['targetId'])
    roll = d10(rng)
    bonus = d10(rng) if roll == 10 else 0
    total = preview['base'] + roll + bonus
    hit = roll != 1 and total >= preview['difficulty']
    if actor.get('loadout') is not None:
        actor['loadout'], _ = loadout_call(battle_loadout.consume, actor['loadout'], actor['loadout']['activeWeaponId'], 1); sync_weapon(actor)
    else:
        actor['weapon']['ammo'] -= 1
    actor['shots'] += 1; actor['actions'] += 1
    if actor.get('loadout') is not None:
        spent=actor.setdefault('shotsByWeapon',{});spent[actor['weapon']['id']]=spent.get(actor['weapon']['id'],0)+1
    set_heading(actor, heading_towards(actor, target))
    details = dict(kind='shoot', actorIds=[actor['id'], target['id']], base=preview['base'], targetStatus=target['status'],
                   pointBlank=preview['distance'] <= 1, from_={'x': actor['x'], 'y': actor['y']},
                   to={'x': target['x'], 'y': target['y']}, roll=roll, bonus=bonus, total=total, difficulty=preview['difficulty'], hit=hit)
    details['from'] = details.pop('from_')
    if 'turnToTarget' in cmd:
        details.update(turnToTarget=cmd['turnToTarget'], turnPenalty=-2 if cmd['turnToTarget'] else 0)
    if hit:
        location = cmd.get('location', 'random')
        if location == 'random':
            exposed = line_of_fire(scene, actor, target)['exposed']
            faces = [face for face in FACES if face in exposed]
            location = faces[min(len(faces) - 1, math.floor(rng() * len(faces)))]
        rolls = [] if details['pointBlank'] else [min(6, max(1, math.floor(rng() * 6) + 1)) for _ in range(actor['weapon']['damageDice'])]
        damage = actor['weapon']['damageDice'] * 6 + actor['weapon']['damageBonus'] if details['pointBlank'] else sum(rolls) + actor['weapon']['damageBonus']
        details.update(resolve_hit(target, damage, location, scene['settings'], rng))
        details['damageRolls'] = rolls
        details['text'] = actor['name'] + ' → ' + target['name'] + ': ' + str(details['damage']) + ' урона.'
    else:
        details['text'] = actor['name'] + ' → ' + target['name'] + ': ' + ('критический промах.' if roll == 1 else 'промах.')
    return details


def add_event(scene, details):
    # The bounded log length stops growing at 150; it cannot identify multiple
    # events in one command. Persist a unique suffix and replay that exact ID.
    event = dict(id='event-' + str(scene['version'] + 1) + '-' + uuid.uuid4().hex, round=scene['round'], **details)
    scene['log'].append(event)
    scene['log'] = scene['log'][-150:]
    return event


def initiative(scene, rng):
    for actor in scene['actors']:
        actor.update(actions=0, shots=0, moved=False)
        if actor.get('loadout') is not None:actor['shotsByWeapon']={}
        actor.pop('spentTurnClearing',None)
        if actor.get('net'):
            actor['net']['controlUsed'] = False
        if actor['status'] != 'dead':
            actor['initiative'] = d10(rng) + effective_ref(actor) + actor['stats']['combatSense']
    live = sorted((a for a in scene['actors'] if a['status'] != 'dead'), key=lambda a: (-a['initiative'], -a['stats']['combatSense'], -effective_ref(a), a['id']))
    scene['order'], scene['index'] = [a['id'] for a in live], 0


def save_check(scene, actor, rng, recovery=False):
    if actor['status'] == 'dead':
        return
    _, stun, mortal = wound_info(actor['wounds'])
    if not recovery and mortal >= 0 and not actor['stabilized']:
        if d10(rng) > actor['stats']['body'] - mortal:
            actor['status'] = 'dead'
            add_event(scene, dict(text=actor['name'] + ': смертельный шок.', actorIds=[actor['id']], kind='death'))
            return
    if recovery and actor['status'] == 'stunned':
        success = d10(rng) <= actor['stats']['body'] - stun
        if success:
            actor['status'] = 'active'
        add_event(scene, dict(text=actor['name'] + (': приходит в себя.' if success else ': остаётся оглушён.'), actorIds=[actor['id']], kind='recovery' if success else 'stun'))


def next_turn(scene, rng):
    save_check(scene, find_actor(scene, scene['order'][scene['index']]), rng)
    for _ in range(50):
        scene['index'] += 1
        if scene['index'] >= len(scene['order']):
            scene['round'] += 1
            initiative(scene, rng)
            add_event(scene, dict(text='Раунд ' + str(scene['round']) + '. Новая инициатива.', actorIds=[], kind='round'))
        if not scene['order']:
            scene['phase'] = 'ended'
            return
        actor = find_actor(scene, scene['order'][scene['index']])
        if actor['status'] != 'dead':
            if actor['status'] == 'stunned':
                save_check(scene, actor, rng, True)
            return


# Original combat commands plus bounded scenery paint extensions. Network wrappers are validated separately.
ACTOR_FIELDS = {
    'move': ['actorId', 'x', 'y'], 'shoot': ['actorId', 'targetId'], 'reload': ['actorId'],
    'interact': ['actorId', 'x', 'y'], 'connect': ['actorId', 'deviceId'],
    'disconnect': ['actorId'], 'scan': ['actorId'], 'control': ['actorId', 'deviceId', 'operation'],
    'end': ['actorId'], 'face': ['actorId', 'heading'], 'switch': ['actorId', 'weaponId'], 'melee': ['actorId', 'targetId', 'technique', 'skillName'], 'fire':['actorId','mode','rounds','targetIds'], 'unjam':['actorId'], 'flip':['actorId','propId','facing'],
}
GM_FIELDS = {'place': ['actorId', 'x', 'y'], 'start': [], 'pause': [], 'resume': [],
             'finish': [], 'hide': ['actorId'], 'paint': ['x', 'y', 'paint'], 'door': ['x', 'y'], 'add': [], 'import-scene': ['document'], 'resolve-fumble': ['sourceCommandId','note','effects'], 'rules':['rulings'], 'configure-loadout':['actorId','config'], 'prepare-training-loadouts':['choices','rulings'], 'configure-cover':['target','profile'], 'armor-rule':['enabled']}
CONTROLLERS = {
    'genie': dict(id='genie', name='Genie', strength=5, type='door'),
    'crystalBall': dict(id='crystalBall', name='Crystal Ball', strength=4, type='camera'),
    'soundmachine': dict(id='soundmachine', name='Soundmachine', strength=4, type='speaker'),
}


def adjacent(a, b):
    return max(abs(a['x'] - b['x']), abs(a['y'] - b['y'])) <= 1


def distance_meters(scene, a, b):
    return math.hypot(a['x'] - b['x'], a['y'] - b['y']) * scene['tileMeters']


def hit_chance(base, difficulty):
    return min(.9, max(0, sum(.1 for n in range(2, 10) if base + n >= difficulty) +
                       sum(.01 for n in range(1, 11) if base + 10 + n >= difficulty)))


def find_path(scene, actor, x, y):
    """Stable Dijkstra: original neighbour order and no corner cutting."""
    if not walkable(scene, x, y, actor['id']):
        return None
    start, goal = (actor['x'], actor['y']), (x, y)
    costs, previous, serial = {start: 0}, {}, 0
    queue = [(0, serial, start)]
    while queue:
        cost, _, current = heapq.heappop(queue)
        if cost > costs[current]:
            continue
        if current == goal:
            path = []
            while current != start:
                path.append(dict(x=current[0], y=current[1]))
                current = previous[current]
            return dict(path=list(reversed(path)), distance=cost)
        cx, cy = current
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
            to = (cx + dx, cy + dy)
            if not walkable(scene, *to, actor['id']):
                continue
            if dx and dy and (not walkable(scene, cx + dx, cy, actor['id']) or not walkable(scene, cx, cy + dy, actor['id'])):
                continue
            new_cost = cost + math.hypot(dx, dy) * scene['tileMeters']
            if new_cost < costs.get(to, math.inf):
                costs[to], previous[to] = new_cost, current
                serial += 1
                heapq.heappush(queue, (new_cost, serial, to))
    return None


def validate_action(command):
    if not isinstance(command, dict) or not isinstance(command.get('type'), str) or command['type'] not in {**ACTOR_FIELDS, **GM_FIELDS}:
        fail('Неизвестная команда боя.')
    kind = command['type']
    optional = ['gmFire','location','coverMode'] if kind=='fire' else ['gmMelee'] if kind == 'melee' else ['location', 'turnToTarget'] if kind == 'shoot' else ['config', 'templateId', 'name', 'x', 'y', 'hidden', 'sprite', 'heading'] if kind == 'add' else ['acknowledgeManualWear'] if kind == 'import-scene' else ['orientation', 'facing'] if kind == 'paint' else []
    exact(command, ['type'] + (ACTOR_FIELDS.get(kind) or GM_FIELDS.get(kind, [])), optional)
    for key in ('actorId', 'targetId', 'deviceId', 'templateId', 'name','propId'):
        if key in command:
            label(command[key])
    if kind == 'paint' and 'orientation' in command:
        if command['orientation'] not in ('horizontal', 'vertical') or command['paint'] not in ('table', 'counter', 'barrel', 'crate', 'car', 'van'):
            fail('Проверь направление предмета.')
    if kind == 'paint' and 'facing' in command:
        if type(command['facing']) is not int or command['facing'] not in (0, 90, 180, 270) or type(command['paint']) is not str or command['paint'] not in PROP_CATALOG or 'orientation' in command:
            fail('Проверь направление предмета: 0, 90, 180 или 270 градусов.')
    if 'turnToTarget' in command and type(command['turnToTarget']) is not bool:
        fail('ГМ должен явно выбрать, является ли этот выстрел атакой с разворотом.')
    if kind == 'rules':validate_rules_profile(command['rulings'])
    if kind=='armor-rule' and type(command['enabled']) is not bool:fail('Явно выбери дополнительное правило износа брони.')
    if kind=='configure-cover':validate_cover_target(command['target']);validate_cover_profile(command['target'],command['profile'])
    if kind=='flip' and (type(command['facing']) is not int or command['facing'] not in (0,90,180,270)):fail('Выбери сторону опрокидывания.')
    if kind=='prepare-training-loadouts':
        validate_training_choices(command['choices'])
        validate_rules_profile(command['rulings'])
    if kind=='configure-loadout':
        exact(command['config'],['weapons','activeWeaponId'],['resetLoaded','resetReadiness'])
        if 'resetReadiness' in command['config'] and type(command['config']['resetReadiness']) is not bool:fail('Подтверди восстановление готовности явно.')
    if kind == 'fire':
        if command.get('coverMode','exposed') not in ('exposed','through'):fail('Выбери огонь по открытым зонам либо прострел.')
        if command['mode'] not in ('single','burst','auto'):fail('Выбери поддержанный режим огня.')
        integer(command['rounds'],1,100,'число объявленных патронов')
        targets=command['targetIds']
        if not isinstance(targets,list) or not 1<=len(targets)<=20:fail('Проверь цели огневого действия.')
        for aid in targets:label(aid)
        if len(set(targets))!=len(targets):fail('Цель указана дважды.')
        if command.get('location','random') not in ['random']+ZONES or command['mode']!='single' and command.get('location','random')!='random':fail('Выбор части тела доступен одиночному режиму.')
        if 'gmFire' in command:
            exact(command['gmFire'],['turnToTarget'],['rulings','throughModifier','throughTargetKnown'])
            if type(command['gmFire']['turnToTarget']) is not bool:fail('ГМ должен подтвердить разворот для этой атаки.')
            if 'rulings' in command['gmFire']:validate_rules_profile(command['gmFire']['rulings'])
            if 'throughTargetKnown' in command['gmFire'] and command['gmFire']['throughTargetKnown'] is not True:fail('ГМ должен подтвердить допустимость атаки через преграду.')
            if 'throughModifier' in command['gmFire']:integer(command['gmFire']['throughModifier'],-30,30,'модификатор прострела')
    if kind == 'resolve-fumble':
        label(command['sourceCommandId']);label(command['note'],1000)
        if not isinstance(command['effects'],list) or len(command['effects'])>20:fail('Проверь последствия критической ошибки.')
        ids=set()
        for effect in command['effects']:
            exact(effect,['actorId','finalDamage','dropWeapon','additionalActions'],['finalStatus'])
            if 'finalStatus' in effect and effect['finalStatus'] not in ('stunned','dead'):fail('Проверь итоговое состояние последствия.')
            aid=label(effect['actorId']);integer(effect['finalDamage'],0,1000,'итоговые ранения');integer(effect['additionalActions'],0,10,'дополнительные действия')
            if aid in ids or type(effect['dropWeapon']) is not bool:fail('Проверь список последствий.')
            ids.add(aid)
    if kind == 'melee':
        if command['technique'] not in ('punch', 'kick', 'weapon') or type(command['skillName']) is not str or len(command['skillName']) > 100:
            fail('Проверь вид рукопашной атаки и выбранный навык.')
        if 'gmMelee' in command: validate_melee_ruling(command['gmMelee'])
    if kind == 'switch' and command['weaponId'] is not None:
        label(command['weaponId'], 64)
    if kind == 'face' or kind == 'add' and 'heading' in command:
        heading(command['heading'])
    if kind == 'shoot' and command.get('location', 'random') not in ['random'] + ZONES:
        fail('Неизвестная часть тела.')
    if ('x' in command) != ('y' in command):
        fail('Укажи обе координаты.')
    if 'x' in command:
        integer(command['x'], 0, 59, 'координату X'); integer(command['y'], 0, 59, 'координату Y')
    if 'acknowledgeManualWear' in command and type(command['acknowledgeManualWear']) is not bool:
        fail('Проверь подтверждение ручного разбора SP.')
    if kind == 'add' and 'hidden' in command and type(command['hidden']) is not bool:
        fail('Проверь видимость НПС.')
    if kind == 'add' and 'sprite' in command:
        integer(command['sprite'], 0, MAX_SPRITE_ID, 'внешность НПС')
        if 'templateId' not in command:
            fail('Для внешности НПС выбери шаблон характеристик.')
    if kind == 'add' and 'config' in command and any(k in command for k in ('templateId', 'name', 'x', 'y', 'hidden', 'sprite', 'heading')):
        fail('Выбери добавление листа либо шаблона НПС.')
    return command



def cover_call(function,*args):
    try:return function(*args)
    except ValueError as error:fail('Проверь укрытие: '+str(error))


def validate_cover_target(target):
    if type(target) is not dict:fail('Выбери предмет, стену или дверь.')
    if set(target)=={'propId'}:label(target['propId']);return target
    exact(target,['x','y']);integer(target['x'],0,59);integer(target['y'],0,59)
    return target


def validate_cover_profile(target,profile):
    return cover_call(battle_cover_scene.validate_prop_protection if 'propId' in target else battle_cover_scene.validate_tile_protection,profile)


def cover_target(scene,target):
    validate_cover_target(target)
    if 'propId' in target:
        item=next((p for p in scene['props'] if p['id']==target['propId']),None)
        if item is None:fail('Предмет больше не найден.',409)
        return item
    x,y=target['x'],target['y']
    if not (0<=x<scene['width'] and 0<=y<scene['height']) or scene['tiles'][y][x]['type'] not in ('wall','door'):fail('Выбери стену или дверь.')
    return scene['tiles'][y][x]


def preview_face(actor, cmd):
    value = heading(cmd['heading'])
    return dict(ok=True, type='face', text='Повернуться', fromHeading=battle_vision.actor_heading(actor), heading=value,
            rulingNote='Поворот меняет обзор. ГМ отдельно решает, применяется ли к конкретной атаке «Разворот к цели −2»; отдельная цена поворота здесь не назначается.')




def validate_rules_profile(raw):
    if type(raw) is not dict: fail('Проверь соглашения этой сцены.')
    choices=dict(battle_ranged.RULING_CHOICES,punchRounding=('down','up'),coverArmorWear=('none','body'))
    if set(raw)-set(choices)-{'autoPointBlankModifier'}: fail('Неизвестное соглашение правил.')
    for key,value in raw.items():
        if key=='autoPointBlankModifier': integer(value,-100,100,'модификатор автоматического огня в упор')
        elif type(value) is not str or value not in choices[key]: fail('Подтверди соглашение '+key+'.')
    return copy.deepcopy(raw)


def fire_spec(scene,cmd,gm=True):
    actor=find_actor(scene,cmd['actorId']);weapon=sync_weapon(actor)
    if actor.get('loadout') is None or weapon.get('kind')!='ranged' or weapon.get('legacy'):
        fail('Сначала ГМ должен подтвердить профиль, режимы и надёжность оружия в подготовке.')
    if weapon['id'] in actor.get('unavailableWeapons',[]):fail('Оружие недоступно после критической ошибки.',409)
    if actor.get('weaponJams',{}).get(weapon['id'],0):fail('Оружие заклинило. Сначала устрани задержку либо смени оружие.')
    ruling=cmd.get('gmFire');turn_penalty=-2 if ruling and ruling['turnToTarget'] else 0
    rules=dict(scene['settings'].get('cp2020Rulings',{}));rules.update((ruling or {}).get('rulings',{}))
    cover_rules=dict(rules);rules.pop('punchRounding',None);rules.pop('coverArmorWear',None)
    cover_mode=cmd.get('coverMode','exposed')
    targets=[];lines={}
    for aid in cmd['targetIds']:
        target=find_actor(scene,aid)
        if aid==actor['id'] or target['status']=='dead' or target['hidden'] and not gm:fail('Выбери доступные живые цели.')
        line=battle_ballistics.trace_cover(scene,actor,target)
        location=cmd.get('location','random')
        if cover_mode=='exposed':
            if line['blocked']:fail('Преграда перекрывает огонь по открытой цели. Для прострела ГМ должен настроить материал и подтвердить обстоятельства.')
            if not line['exposed'] or location!='random' and location not in line['exposed']:fail('Эту часть тела закрывает укрытие; выбери открытую зону либо прострел.')
        else:
            try:
                for zone in (ZONES if location=='random' else [location]):
                    layers=battle_ballistics.protection_layers(line,zone)
                    if scene['settings'].get('stagedPenetration') and any(v['sp']>0 for v in layers) and cover_rules.get('coverArmorWear') not in ('none','body'):
                        fail('ГМ должен выбрать соглашение об износе носимой брони за укрытием.')
            except ValueError as error:fail('Для прострела настрой SP всех преград: '+str(error))
        distance=distance_meters(scene,actor,target);band=battle_ranged.range_profile(distance,weapon['range'])
        if band is None:fail('Цель вне дальности оружия.')
        targets.append(dict(id=aid,base=effective_ref(actor)+weapon['skillRank']+weapon['accuracy']-3*actor['actions']+turn_penalty+(ruling.get('throughModifier',0) if ruling and cover_mode=='through' else 0)+(-4 if location!='random' else 0),**band))
        lines[aid]=line
    declaration=dict(mode=cmd['mode'],rounds=cmd['rounds'],targets=targets)
    context=dict(loaded=weapon['ammo'],spentThisRound=actor.get('shotsByWeapon',{}).get(weapon['id'],0),rulings=rules)
    try:preview=battle_ranged.preview_ranged(weapon,declaration,context)
    except ValueError as error:fail('Проверь огневое действие: '+str(error))
    return actor,weapon,declaration,context,lines,preview


def preview_fire_action(scene,cmd,gm=True):
    actor,weapon,declaration,context,lines,result=fire_spec(scene,cmd,gm)
    # Kernel has no actor/private sheet data; its target IDs were authorized.
    out=dict(ok=True,text='Огневое действие',mode=cmd['mode'],rounds=cmd['rounds'],requiresGmFireDecision='gmFire' not in cmd,
        readyToRoll=result['status']=='ready' and (cmd.get('coverMode','exposed')!='through' or 'throughModifier' in cmd.get('gmFire',{}) and cmd.get('gmFire',{}).get('throughTargetKnown') is True),coverMode=cmd.get('coverMode','exposed'),requiresGmThroughDecision=cmd.get('coverMode','exposed')=='through' and ('throughModifier' not in cmd.get('gmFire',{}) or cmd.get('gmFire',{}).get('throughTargetKnown') is not True),targets=copy.deepcopy(result['targets']),unresolvedRulings=copy.deepcopy(result['unresolvedRulings']),
        rulingsUsed=copy.deepcopy(result['rulingsUsed']),actionCost=1,penalty=-3*actor['actions'],turnPenalty=-2 if cmd.get('gmFire',{}).get('turnToTarget') else 0)
    out['lines']=[dict(targetId=aid,cover=dict(x=line['cover']['x'],y=line['cover']['y']) if isinstance(line.get('cover'),dict) else bool(line.get('cover')),blocked=bool(line['blocked'])) for aid,line in lines.items()]
    if len(out['lines'])==1:out['line']={k:v for k,v in out['lines'][0].items() if k!='targetId'}
    if gm and cmd.get('coverMode')=='through':
        out['protectionReview']=[dict(targetId=aid,zones=[dict(location=zone,armorSP=find_actor(scene,aid)['armor'][zone],**{k:v for k,v in battle_cover.resolve_protection(0,find_actor(scene,aid)['armor'][zone],battle_ballistics.protection_layers(line,zone)).items() if k in ('effectiveSP','steps')}) for zone in (ZONES if cmd.get('location','random')=='random' else [cmd['location']])]) for aid,line in lines.items()]
    return out


def resolve_fire_action(scene,cmd,rng):
    actor,weapon,declaration,context,lines,preview=fire_spec(scene,cmd,True)
    if 'gmFire' not in cmd or preview['status']!='ready' or cmd.get('coverMode','exposed')=='through' and ('throughModifier' not in cmd['gmFire'] or cmd['gmFire'].get('throughTargetKnown') is not True):fail('ГМ должен подтвердить разворот и необходимые соглашения до броска.')
    result=battle_ranged.resolve_ranged(weapon,declaration,context,rng)
    wid=weapon['id'];ammo_id=weapon['ammoItemId']
    if result['bulletsSpent']:
        actor['loadout'],_=loadout_call(battle_loadout.consume,actor['loadout'],wid,result['bulletsSpent']);sync_weapon(actor)
    actor['actions']+=result['actionCost'];actor['shots']+=result['rofConsumed'];actor.setdefault('shotsByWeapon',{})[wid]=result['spentThisRoundAfter']
    impacts=[];total_damage=0;attempted_ids=[];visuals=[]
    for entry in result['targets']:
        if not entry['attacks']:continue
        attempted_ids.append(entry['id'])
        target=find_actor(scene,entry['id']);set_heading(actor,heading_towards(actor,target));before_count=len(impacts)
        for attack in entry['attacks']:
            for hit in attack['damage']:
                location=cmd.get('location','random')
                if location=='random':
                    faces=FACES if cmd.get('coverMode','exposed')=='through' else [face for face in FACES if face in lines[target['id']]['exposed']];location=faces[min(len(faces)-1,math.floor(rng()*len(faces)))]
                layers=battle_ballistics.protection_layers(lines[target['id']],location) if cmd.get('coverMode','exposed')=='through' else []
                protection=battle_cover.resolve_protection(hit['rawDamage'],target['armor'][location],layers) if layers else None
                settings=copy.deepcopy(scene['settings']);settings.setdefault('cp2020Rulings',{}).update(cmd['gmFire'].get('rulings',{}))
                impact=dict(actorId=target['id'],damageRolls=hit['rolls'],**resolve_hit(target,hit['rawDamage'],location,settings,rng,protection))
                impacts.append(impact);total_damage+=impact['damage']
        own_impacts=impacts[before_count:]
        visuals.append(dict(kind='shoot',visualOnly=True,actorIds=[actor['id'],target['id']],from_={'x':actor['x'],'y':actor['y']},to={'x':target['x'],'y':target['y']},hit=any(a['hitCount'] for a in entry['attacks']),damage=sum(h['damage'] for h in own_impacts),location=own_impacts[-1]['location'] if own_impacts else 'torso',roll=entry['attacks'][-1]['roll'],targetStatus=target['status'],text='Огневое действие: подтверждённая траектория.'))
    if result['jam']:actor.setdefault('weaponJams',{})[wid]=result['jam']['clearTurns']
    if result['needsGmAdjudication']:
        scene.setdefault('unresolvedFumbles',[]).append(dict(commandId=cmd['id'],actorIds=[actor['id']]+cmd['targetIds'],receipt=copy.deepcopy(result)))
    final_target=find_actor(scene,attempted_ids[-1])
    return dict(kind='shoot',effectSuppressed=True,_visualEvents=visuals,actorIds=[actor['id']]+attempted_ids,mode=cmd['mode'],hit=bool(result['hitCount']),damage=total_damage,
        from_={'x':actor['x'],'y':actor['y']},to={'x':final_target['x'],'y':final_target['y']},
        coverMode=cmd.get('coverMode','exposed'),throughModifier=cmd['gmFire'].get('throughModifier') if cmd.get('coverMode','exposed')=='through' else None,turnToTarget=cmd['gmFire']['turnToTarget'],turnPenalty=-2 if cmd['gmFire']['turnToTarget'] else 0,
        rounds=result['bulletsSpent'],hits=result['hitCount'],impacts=impacts,ammoChanges=[dict(actorId=actor['id'],ammoItemId=ammo_id,delta=-result['bulletsSpent'])] if result['bulletsSpent'] else [],
        rangedReceipt=result,requiresGmResolution=result['needsGmAdjudication'],
        text=actor['name']+': '+str(result['bulletsSpent'])+' патронов, '+str(result['hitCount'])+' попаданий, '+str(total_damage)+' урона.'+(' Задержка оружия.' if result['jam'] else '')+(' Требуется разбор критической ошибки.' if result['needsGmAdjudication'] else ''))


def validate_melee_ruling(raw):
    exact(raw, ['defenseSkillName', 'defenseSkillKind', 'defenderAware', 'attackModifier', 'defenseModifier'],
          ['punchRounding', 'attackTechniqueBonus', 'defenseTechniqueBonus'])
    if type(raw['defenseSkillName']) is not str or len(raw['defenseSkillName']) > 100 or raw['defenseSkillKind'] not in cp2020_melee.DEFENSE_SKILLS:
        fail('ГМ должен явно выбрать применимый навык защиты.')
    if type(raw['defenderAware']) is not bool or not raw['defenderAware']:
        fail('Обычная встречная защита требует осведомлённого защитника; засаду нужно разбирать отдельно.')
    integer(raw['attackModifier'], -30, 30, 'модификатор атаки'); integer(raw['defenseModifier'], -30, 30, 'модификатор защиты')
    for key in ('attackTechniqueBonus', 'defenseTechniqueBonus'):
        if key in raw: integer(raw[key], 0, 4, 'бонус приёма выбранного стиля')
    if 'punchRounding' in raw and raw['punchRounding'] not in ('down', 'up'):
        fail('Для удара рукой ГМ выбирает округление d6/2.')
    return raw


def selected_melee_skill(actor, name, kind=None, bonus=None):
    if name == '':
        if kind not in ('brawling', 'melee', 'fencing', 'dodge', 'athletics'):
            fail('Выбери применимый навык либо явно неподготовленную проверку.')
        return dict(name='', kind=kind, rank=0)
    skills = [s for s in actor.get('meleeSkills', []) if s['name'] == name]
    if len(skills) != 1 or kind is not None and skills[0]['kind'] != kind:
        fail('Выбранный рукопашный навык не совпадает с листом.', 409)
    result = copy.deepcopy(skills[0])
    if result['kind'] == 'martialArts':
        if bonus is None: fail('ГМ должен подтвердить бонус конкретного приёма этого стиля.')
        result.update(style=result['name'], techniqueBonus=integer(bonus, 0, 4))
    elif bonus is not None:
        fail('Бонус боевого стиля не применяется к другому навыку.')
    return result


def preview_melee_action(scene, cmd, gm=True):
    actor, target = find_actor(scene, cmd['actorId']), find_actor(scene, cmd['targetId'])
    if actor['id'] == target['id'] or target['status'] == 'dead' or target['hidden'] and not gm:
        fail('Выбери доступную живую цель рукопашной атаки.')
    if target['status'] != 'active':
        fail('Защита оглушённого участника требует отдельного решения ГМа; обычная встречная проверка недоступна.')
    distance = distance_meters(scene, actor, target)
    # Bounded grid reach is disclosed as an application convention, not a new
    # universal weapon statistic. No attack crosses a wall or a sealed corner.
    if not adjacent(actor, target) or distance > 1.5 or (target['x'],target['y']) not in battle_vision.visible_cells(scene,actor):
        fail('Нужна соседняя доступная цель в пределах 1,5 м без стены между вами.')
    weapon = sync_weapon(actor)
    armed = cmd['technique'] == 'weapon'
    if armed:
        if weapon['id'] in actor.get('unavailableWeapons',[]):fail('Оружие недоступно после критической ошибки.',409)
        if weapon.get('kind') != 'melee' or cmd['skillName'] != weapon['skillName']:
            fail('Подготовь подтверждённое рукопашное оружие и его навык.')
        attack_kind = weapon['skillKind']
    else:
        choices = [s for s in actor.get('meleeSkills', []) if s['name'] == cmd['skillName']]
        attack_kind = choices[0]['kind'] if len(choices)==1 else 'brawling' if cmd['skillName']=='' else None
        if attack_kind not in ('brawling', 'martialArts'): fail('Для удара рукой или ногой выбери Драку либо изученный стиль.')
    ruling = cmd.get('gmMelee')
    if ruling is None:
        # A player may declare intent without seeing the defender's private REF
        # or skills. The GM separately chooses and verifies the defense.
        out = dict(ok=True, text='Рукопашная атака', distance=distance, technique=cmd['technique'], requiresGmMeleeDecision=True,
                   rulingNote='Противопоставленные REF + выбранный навык + d10; ничья в пользу защитника. Досягаемость соседней клетки 1,5 м — ограничение сетки приложения.')
        if gm: out['defenseOptions'] = copy.deepcopy(target.get('meleeSkills', []))
        return out
    validate_melee_ruling(ruling)
    ruling=copy.deepcopy(ruling)
    if cmd['technique']=='punch' and 'punchRounding' not in ruling and 'punchRounding' in scene['settings'].get('cp2020Rulings',{}):ruling['punchRounding']=scene['settings']['cp2020Rulings']['punchRounding']
    attack_skill = selected_melee_skill(actor, cmd['skillName'], attack_kind, ruling.get('attackTechniqueBonus'))
    defense_skill = selected_melee_skill(target, ruling['defenseSkillName'], ruling['defenseSkillKind'], ruling.get('defenseTechniqueBonus'))
    attack = dict(technique=cmd['technique'], ref=effective_ref(actor), body=actor['stats']['body'], skill=attack_skill,
                  modifier=-3*actor['actions']+ruling['attackModifier'])
    if cmd['technique']=='punch': attack['punchRounding']=ruling.get('punchRounding')
    if armed: attack['weapon']={k:weapon[k] for k in ('weaponType','damageDice','damageBonus','accuracy')}
    defense = dict(ref=effective_ref(target), skill=defense_skill, modifier=ruling['defenseModifier'], activeDodge=False)
    try: formula=cp2020_melee.preview_melee(attack,defense)
    except ValueError as error: fail('Проверь решение ГМа по рукопашной: '+str(error))
    return dict(ok=True,text='Рукопашная атака',distance=distance,technique=cmd['technique'],requiresGmMeleeDecision=False,
                attackBase=formula['attackBase'],defenseBase=formula['defenseBase'],_attack=attack,_defense=defense,
                rulingNote='Активное уклонение, парирование предметом и особые приёмы здесь не разрешаются автоматически.')


def resolve_melee_action(scene, cmd, rng):
    preview=preview_melee_action(scene,cmd,True)
    if preview.get('requiresGmMeleeDecision'): fail('Перед броском ГМ должен подтвердить защиту и спорные параметры.')
    actor,target=find_actor(scene,cmd['actorId']),find_actor(scene,cmd['targetId'])
    result=cp2020_melee.resolve_melee(preview['_attack'],preview['_defense'],rng)
    actor['actions']+=1;set_heading(actor,heading_towards(actor,target))
    event=dict(kind='melee',actorIds=[actor['id'],target['id']],technique=cmd['technique'],hit=result['hit'],
        from_={'x':actor['x'],'y':actor['y']},to={'x':target['x'],'y':target['y']},
        attackTotal=result['attackTotal'],defenseTotal=result['defenseTotal'],rawDamage=result['rawDamage'],
        damageRolls=result['damageRolls'],meleeReceipt=result['receipt'],requiresGmResolution=result['requiresGmResolution'],
        targetStatus=target['status'])
    event['from']=event.pop('from_')
    if result['hit']:
        location=FACES[min(9,math.floor(rng()*10))]
        event.update(resolve_hit(target,result['rawDamage'],location,scene['settings'],rng))
    event['text']=actor['name']+' → '+target['name']+': '+(str(event.get('damage',0))+' урона в рукопашной.' if result['hit'] else 'рукопашная атака отражена.')
    if result['requiresGmResolution']:
        event['text']+=' Критическая ошибка: последствия требуют отдельного решения ГМа.'
        scene.setdefault('unresolvedFumbles',[]).append(dict(commandId=cmd['id'],actorIds=event['actorIds'],receipt=copy.deepcopy(result['receipt'])))
    return event


def preview_action(scene, cmd, gm=True):
    """Return only safe scalars, map geometry and explicitly known NET data.

    Unlike original previewCommand, this never returns full actor or target
    objects. Callers check session ownership before this function.
    """
    kind = cmd['type']
    if kind not in ACTOR_FIELDS and kind not in GM_FIELDS:
        fail('Неизвестная команда боя.')
    actor = find_actor(scene, cmd['actorId']) if 'actorId' in cmd else None
    if scene.get('unresolvedFumbles') and kind not in ('resolve-fumble','pause','finish','rules'):
        fail('Сначала ГМ должен разобрать сохранённую критическую ошибку или отменить действие.',409)
    out = dict(ok=True)
    if kind in GM_FIELDS:
        if not gm:
            fail('Это действие доступно только ведущему кампании.', 403)
        if kind=='rules':return dict(ok=True,text='Сохранить соглашения сцены',rulings=validate_rules_profile(cmd['rulings']))
        if kind=='armor-rule':return dict(ok=True,text='Выбрать дополнительный износ брони',enabled=cmd['enabled'])
        if kind=='configure-cover':
            item=cover_target(scene,cmd['target']);profile=validate_cover_profile(cmd['target'],cmd['profile'])
            if 'propId' in cmd['target']:cover_call(battle_cover_scene.validate_prop_state,{**item,'protection':profile})
            return dict(ok=True,text='Подтвердить материал и защиту преграды',target=copy.deepcopy(cmd['target']),profile=profile)
        if kind == 'resolve-fumble':
            if not any(r['commandId']==cmd['sourceCommandId'] for r in scene.get('unresolvedFumbles',[])):
                fail('Критическая ошибка уже разобрана либо не найдена.',409)
            for effect in cmd['effects']:
                affected=find_actor(scene,effect['actorId'])
                if affected['status']=='dead' and effect.get('finalStatus')=='stunned':fail('Разбор ошибки не может оживить погибшего участника.')
            return dict(ok=True,text='Записать решение ГМа',note=cmd['note'],effects=copy.deepcopy(cmd['effects']))
        if kind in ('place', 'paint', 'add', 'start', 'import-scene','configure-loadout','prepare-training-loadouts') and scene['phase'] not in ('preparation', 'ended'):
            fail('Изменяй сцену до или после боя.', 409)
        if kind=='prepare-training-loadouts':
            plans=training_loadout_plan(scene,cmd['choices'])
            return dict(ok=True,text='Подготовить учебный бой',actorIds=[a['id'] for a,_,_ in plans],rulings=validate_rules_profile(cmd['rulings']))
        if kind=='configure-loadout':
            configured_scene_loadout(actor,cmd['config'])
            return dict(ok=True,text='Подтвердить набор оружия НПС / тренировки')
        if kind == 'place':
            if not walkable(scene, cmd['x'], cmd['y'], actor['id']):
                fail('Клетка занята или непроходима.')
            out.update(to=dict(x=cmd['x'], y=cmd['y']), text='Разместить')
        elif kind == 'start':
            unconfirmed=[a for a in scene['actors'] if a['status']!='dead' and not a['weapon'].get('unarmed') and (a.get('loadout') is None or a['weapon'].get('legacy'))]
            if unconfirmed:fail('Подтверди оружие по правилам 2020: '+', '.join(a['name'] for a in unconfirmed)+'. Название и ROF не определяют режимы.',409)
            live = [a for a in scene['actors'] if a['status'] != 'dead']
            if len(live) < 2:
                fail('Добавь хотя бы двух живых участников.', 409)
            if any(not walkable(scene, a['x'], a['y'], a['id']) for a in live):
                fail('Проверь стартовые позиции.')
            out['text'] = 'Начать бой'
        elif kind == 'pause' and scene['phase'] != 'combat':
            fail('Бой не идёт.', 409)
        elif kind == 'resume' and scene['phase'] != 'paused':
            fail('Бой не на паузе.', 409)
        elif kind == 'finish' and scene['phase'] not in ('preparation', 'combat', 'paused'):
            fail('Этот бой уже завершён.', 409)
        elif kind == 'paint':
            if type(cmd['x']) is not int or type(cmd['y']) is not int or not (0 <= cmd['x'] < scene['width'] and 0 <= cmd['y'] < scene['height']) or cmd['paint'] not in ('floor', 'wall', 'door', *PROP_CATALOG):
                fail('Некорректная клетка или инструмент.')
            w, h = prop_footprint(cmd['paint'], cmd.get('facing', cmd.get('orientation', 'horizontal'))) if cmd['paint'] in PROP_CATALOG else (1, 1)
            if cmd['x'] + w > scene['width'] or cmd['y'] + h > scene['height']:
                fail('Предмет целиком должен помещаться на карте.')
            if any(cmd['x'] <= a['x'] < cmd['x'] + w and cmd['y'] <= a['y'] < cmd['y'] + h for a in scene['actors']):
                fail('Сначала перемести персонажа.')
            # Preserve original single-cell paint/erase behavior. New scenery
            # never silently removes an adjacent prop, door, wall or NET device.
            if cmd['paint'] in ('table', 'counter', 'barrel', 'car', 'van'):
                footprint = dict(x=cmd['x'], y=cmd['y'], w=w, h=h)
                if any(rectangles_overlap(footprint, p) for p in scene['props']) or any(scene['tiles'][y][x]['type'] != 'floor' for y in range(cmd['y'], cmd['y'] + h) for x in range(cmd['x'], cmd['x'] + w)):
                    fail('Для предмета нужен свободный участок пола без стен, дверей и других предметов.')
                if any(cmd['x'] <= d['x'] < cmd['x'] + w and cmd['y'] <= d['y'] < cmd['y'] + h for d in scene.get('devices', [])):
                    fail('Сначала перемести сетевое устройство.')
                if len(scene['props']) >= 200:
                    fail('Слишком много предметов на карте.')
                out['footprint'] = footprint
            elif cmd['paint'] == 'crate' and 'facing' in cmd:
                out['footprint'] = dict(x=cmd['x'],y=cmd['y'],w=w,h=h)
        elif kind == 'hide' and actor['team'] == 'crew':
            fail('Скрывать можно НПС.')
        elif kind == 'add' and len(scene['actors']) >= 20:
            fail('В сцене уже 20 участников.')
        if kind == 'door':
            tile = tile_at(scene, cmd['x'], cmd['y'])
            if not tile or tile['type'] != 'door':
                fail('Здесь нет двери.')
            if tile['open'] and any(a['x'] == cmd['x'] and a['y'] == cmd['y'] for a in scene['actors']):
                fail('В проёме стоит персонаж.')
        out.setdefault('text', 'Изменить сцену')
        return out
    if kind == 'face' and gm and scene['phase'] in ('preparation', 'ended') and actor['status'] == 'active':
        return preview_face(actor, cmd)
    if scene['phase'] != 'combat' or not scene['order'] or scene['order'][scene['index']] != actor['id']:
        fail('Сейчас не ход этого персонажа или бой на паузе.', 409)
    if kind == 'end':
        return dict(ok=True, text='Завершить ход')
    if actor['status'] != 'active':
        fail('Персонаж погиб или оглушён. Заверши ход для проверки восстановления.', 409)
    if kind == 'face':
        return preview_face(actor, cmd)
    penalty = -3 * actor['actions']
    if actor.get('spentTurnClearing'):
        fail('Этот ход занят устранением задержки. Заверши ход.',409)
    if kind=='fire':return preview_fire_action(scene,cmd,gm)
    if kind=='flip':
        result=cover_call(battle_cover_scene.preview_flip,scene,actor,cmd['propId'],cmd['facing'])
        protection=cover_call(battle_cover_scene.active_prop_protection,result['after'])
        return dict(ok=True,text='Опрокинуть стол · одно действие после решения ГМа',propId=cmd['propId'],facing=cmd['facing'],footprint=result['footprint'],coveredZones=protection['coveredZones'],blocksVision=protection['blocksVision'],actionCost=1)
    if kind=='unjam':
        weapon=sync_weapon(actor);remaining=actor.get('weaponJams',{}).get(weapon['id'],0)
        if not remaining:fail('У выбранного оружия нет задержки.')
        return dict(ok=True,text='Устранять задержку',remainingTurns=remaining,turnWork=True)
    if kind == 'melee':
        return {k:v for k,v in preview_melee_action(scene,cmd,gm).items() if not k.startswith('_')}
    if kind == 'shoot':
        p = preview_shot(scene, cmd, gm)
        line = line_of_fire(scene, actor, find_actor(scene, cmd['targetId']))
        return dict(ok=True, text='Выстрелить', **p, penalty=penalty, turnToTarget=cmd.get('turnToTarget'),
                    turnPenalty=-2 if cmd.get('turnToTarget') is True else 0, requiresGmFacingDecision='turnToTarget' not in cmd, chance=hit_chance(p['base'], p['difficulty']),
                    location=cmd.get('location', 'random'), line=dict(blocked=False,
                    cover={k: line['cover'][k] for k in ('x', 'y')} if line['cover'] else None, exposed=line['exposed']))
    if kind == 'move':
        if actor['moved']:
            fail('Перемещение уже выполнено в этом раунде.', 409)
        route = find_path(scene, actor, cmd['x'], cmd['y'])
        if not route or not route['path']:
            fail('Нет свободного пути к этой клетке.')
        if route['distance'] > actor['stats']['ma'] * 3 + .00001:
            fail('Слишком далеко: предел ' + str(actor['stats']['ma'] * 3) + ' м за раунд.')
        return dict(ok=True, text='Переместиться', **route, penalty=penalty, to=dict(x=cmd['x'], y=cmd['y']))
    if kind == 'switch':
        if actor.get('loadout') is None:
            fail('Сначала ГМ должен подтвердить набор оружия из листа.')
        if cmd['weaponId'] in actor.get('unavailableWeapons',[]):fail('Это оружие выронено или недоступно; сначала ГМ должен восстановить его готовность.')
        chosen = loadout_call(battle_loadout.activate, actor['loadout'], cmd['weaponId'])
        if chosen['activeWeaponId'] == actor['loadout']['activeWeaponId']:
            fail('Это оружие уже подготовлено.')
        weapon = loadout_call(battle_loadout.current_weapon, chosen)
        return dict(ok=True, text='Сменить оружие', weaponId=cmd['weaponId'], weaponName=weapon['name'], penalty=penalty, actionCost=1)
    if kind == 'reload':
        weapon = sync_weapon(actor)
        if weapon['id'] in actor.get('unavailableWeapons',[]):fail('Оружие недоступно после критической ошибки.',409)
        if weapon.get('kind') == 'melee' or weapon.get('unarmed'):
            fail('У этого оружия нет магазина.')
        if weapon['ammo'] >= weapon['magazine']:
            fail('Магазин уже полон.')
        if weapon['reserve'] <= 0:
            fail('Запасных патронов нет.')
        return dict(ok=True, text='Перезарядить', penalty=penalty, count=min(weapon['magazine'] - weapon['ammo'], weapon['reserve']))
    if kind == 'interact':
        tile = tile_at(scene, cmd['x'], cmd['y'])
        if not tile or tile['type'] != 'door':
            fail('Выбери дверь.')
        if not adjacent(actor, cmd):
            fail('Подойди к двери.')
        if tile['open'] and any(a['x'] == cmd['x'] and a['y'] == cmd['y'] for a in scene['actors']):
            fail('Проём занят.')
        return dict(ok=True, text='Закрыть дверь' if tile['open'] else 'Открыть дверь', penalty=penalty)
    if kind in ('connect', 'disconnect', 'scan', 'control'):
        net = actor.get('net')
        if not net or not net.get('deck') or actor['stats'].get('interface', 0) <= 0:
            fail('Нужны дека и навык Interface.')
        devices = scene.get('devices', [])
        port = next((d for d in devices if d['id'] == net['linkedPortId'] and d['type'] == 'port'), None)
        if kind == 'connect':
            target = next((d for d in devices if d['id'] == cmd['deviceId'] and d['type'] == 'port'), None)
            if not target or not adjacent(actor, target):
                fail('Подойди к порту деки: нужна соседняя клетка.')
            if net['linkedPortId'] == target['id']:
                fail('Дека уже подключена.')
            return dict(ok=True, text='Подключить деку', device=safe_device(target))
        if not port or not adjacent(actor, port):
            fail('Сначала подключи деку к соседнему порту.')
        if kind in ('disconnect', 'scan'):
            return dict(ok=True, text='Отключить деку' if kind == 'disconnect' else 'Найти устройства', device=safe_device(port))
        device = next((d for d in devices if d['id'] == cmd['deviceId'] and d['type'] != 'port'), None)
        if not device or device['networkId'] != port['networkId'] or device['id'] not in net['knownDeviceIds']:
            fail('Устройство ещё не найдено или недоступно.')
        if net['controlUsed']:
            fail('Одна попытка управления за раунд — ограничение этой версии.', 409)
        program = next((p for p in CONTROLLERS.values() if p['type'] == device['type'] and p['id'] in net['programIds']), None)
        if not program:
            fail('В деке нет подходящей Controller-программы.')
        tile = tile_at(scene, device['x'], device['y'])
        if device['type'] == 'door' and (not tile or tile['type'] != 'door'):
            fail('Дверь больше не существует.')
        operation = ('close' if tile['open'] else 'open') if device['type'] == 'door' else 'observe' if device['type'] == 'camera' else 'off' if device['active'] else 'on'
        if cmd['operation'] != operation:
            fail('Устройство не поддерживает такую команду.')
        if operation == 'close' and any(a['x'] == device['x'] and a['y'] == device['y'] and a['status'] != 'dead' for a in scene['actors']):
            fail('В проёме стоит персонаж.')
        texts = dict(close='Закрыть дверь', open='Открыть дверь', observe='Посмотреть через камеру', on='Включить тревогу', off='Выключить объявление')
        return dict(ok=True, text=texts[operation], device=safe_device(device), program=copy.deepcopy(program), chance=program['strength'] / 10)
    fail('Неизвестное действие.')


def tile_at(scene, x, y):
    if type(x) is int and type(y) is int and 0 <= x < scene['width'] and 0 <= y < scene['height']:
        return scene['tiles'][y][x]
    return None


def safe_device(device):
    return {key: device[key] for key in ('id', 'name', 'type', 'x', 'y')}


def apply_action(scene, cmd, rng, gm=True, training=False, added_actor=None, private_vision=False):
    """Mutates a transaction-owned scene after preview; no persistence of sheets."""
    p = preview_action(scene, cmd, gm)
    kind = cmd['type']
    actor = find_actor(scene, cmd['actorId']) if 'actorId' in cmd else None
    if kind=='prepare-training-loadouts':
        if not training:fail('Общая учебная подготовка доступна только в изолированной тренировке.',403)
        plans=training_loadout_plan(scene,cmd['choices'])
        for participant,inventory,loadout in plans:
            participant['loadout']=loadout;participant['sceneInventory']=inventory;sync_weapon(participant)
            participant['meleeSkills']=melee_skills_from_sheet(scene_actor_inventory(participant))
        scene['settings']['cp2020Rulings']={**scene['settings'].get('cp2020Rulings',{}),**validate_rules_profile(cmd['rulings'])}
        return add_event(scene,dict(kind='loadout',actorIds=[a['id'] for a,_,_ in plans],trainingPreparation=True,choices=copy.deepcopy(cmd['choices']),rulings=copy.deepcopy(scene['settings']['cp2020Rulings']),text='ГМ подтвердил учебные профили всех перечисленных участников. Реальные листы и запас патронов не изменены.'))
    if kind=='configure-loadout':
        inventory=scene_actor_inventory(actor)
        actor['loadout']=configured_scene_loadout(actor,cmd['config']);actor['sceneInventory']=inventory;sync_weapon(actor)
        if cmd['config'].get('resetReadiness'):
            for key in ('weaponJams','unavailableWeapons','droppedWeapons'):actor.pop(key,None)
        actor['meleeSkills']=melee_skills_from_sheet(scene_actor_inventory(actor))
        return add_event(scene,dict(kind='loadout',actorIds=[actor['id']],text=actor['name']+': ГМ подтвердил профиль оружия сцены.'))
    if kind=='configure-cover':
        item=cover_target(scene,cmd['target']);item['protection']=validate_cover_profile(cmd['target'],cmd['profile'])
        return add_event(scene,dict(kind='cover-settings',actorIds=[],text='ГМ уточнил материал, покрытие и свойства преграды.',target=copy.deepcopy(cmd['target']),profile=copy.deepcopy(item['protection'])))
    if kind=='armor-rule':
        scene['settings']['stagedPenetration']=cmd['enabled']
        return add_event(scene,dict(kind='rules',actorIds=[],text='Дополнительный износ брони: '+('включён.' if cmd['enabled'] else 'выключен.')))
    if kind=='flip':
        result=cover_call(battle_cover_scene.preview_flip,scene,actor,cmd['propId'],cmd['facing'])
        scene['props']=[result['after'] if prop['id']==cmd['propId'] else prop for prop in scene['props']]
        actor['actions']+=1
        return add_event(scene,dict(kind='flip',actorIds=[actor['id']],propId=cmd['propId'],facing=cmd['facing'],at=dict(x=result['after']['x'],y=result['after']['y']),before=result['before'],after=result['after'],text='Стол опрокинут после подтверждения ГМа; новое укрытие действует на карте.'))
    if kind=='rules':
        scene['settings']['cp2020Rulings']=validate_rules_profile(cmd['rulings'])
        return add_event(scene,dict(kind='rules',actorIds=[],text='ГМ явно подтвердил соглашения сцены; следующие броски сохранят применённые значения.'))
    if kind=='fire':
        result=resolve_fire_action(scene,cmd,rng)
        for visual in result.pop('_visualEvents',[]):
            visual['from']=visual.pop('from_');add_event(scene,visual)
        result['from']=result.pop('from_');return add_event(scene,result)
    if kind=='unjam':
        wid=actor['weapon']['id'];actor['weaponJams'][wid]-=1;actor['spentTurnClearing']=True
        return add_event(scene,dict(kind='unjam',actorIds=[actor['id']],remainingTurns=actor['weaponJams'][wid],text=actor['name']+': устранение задержки, осталось ходов '+str(actor['weaponJams'][wid])+'.'))
    if kind == 'resolve-fumble':
        impacts=[]
        for effect in cmd['effects']:
            affected=find_actor(scene,effect['actorId']);affected['wounds']+=effect['finalDamage'];affected['actions']+=effect['additionalActions']
            if effect['dropWeapon']:
                if affected.get('loadout') is not None:
                    wid=affected['loadout']['activeWeaponId']
                    if wid is not None:affected.setdefault('unavailableWeapons',[]).append(wid)
                    affected['loadout']=loadout_call(battle_loadout.activate,affected['loadout'],None);sync_weapon(affected)
                elif not affected['weapon'].get('unarmed'):
                    affected.setdefault('droppedWeapons',[]).append(copy.deepcopy(affected['weapon']));affected['weapon']=battle_loadout.unarmed_weapon()
            if effect['finalDamage']:
                if affected['status']!='dead' and d10(rng)>affected['stats']['body']-wound_info(affected['wounds'])[1]:affected['status']='stunned'
                impacts.append(dict(actorId=affected['id'],damage=effect['finalDamage']))
            if 'finalStatus' in effect:affected['status']=effect['finalStatus']
        scene['unresolvedFumbles']=[r for r in scene.get('unresolvedFumbles',[]) if r['commandId']!=cmd['sourceCommandId']]
        return add_event(scene,dict(kind='adjudication',actorIds=[e['actorId'] for e in cmd['effects']],text='ГМ разобрал критическую ошибку: '+cmd['note'],impacts=impacts,sourceCommandId=cmd['sourceCommandId']))
    if kind == 'start':
        return start_scene(scene, rng)
    if kind == 'shoot':
        return add_event(scene, resolve_shot(scene, cmd, rng))
    if kind == 'melee':
        return add_event(scene, resolve_melee_action(scene,cmd,rng))
    if kind == 'end':
        event = add_event(scene, dict(kind='end', actorIds=[actor['id']], text=actor['name'] + ' завершает ход.'))
        next_turn(scene, rng)
        return event
    details = dict(kind=kind, actorIds=[actor['id']] if actor else [])
    if kind in ('pause', 'resume', 'finish'):
        scene['phase'] = dict(pause='paused', resume='combat', finish='ended')[kind]
        details['text'] = dict(pause='ГМ поставил бой на паузу.', resume='Бой продолжается.', finish='Бой завершён. Последствия сохранены.')[kind]
    elif kind == 'face':
        previous_heading = battle_vision.actor_heading(actor)
        set_heading(actor, cmd['heading'])
        details.update(fromHeading=previous_heading, heading=actor['heading'], text=actor['name'] + ': поворот на ' + str(actor['heading']) + '°.')
    elif kind in ('move', 'place'):
        old = dict(x=actor['x'], y=actor['y'])
        actor.update(x=cmd['x'], y=cmd['y'])
        details.update(from_=old, to=dict(x=actor['x'], y=actor['y']))
        details['from'] = details.pop('from_')
        if kind == 'move':
            last = p['path'][-2] if len(p['path']) > 1 else old
            set_heading(actor, heading_towards(last, p['path'][-1]))
            actor.update(moved=True, actions=actor['actions'] + 1)
            details.update(path=p['path'], text=actor['name'] + ': перемещение ' + format(p['distance'], '.1f') + ' м.')
            if actor.get('net', {}).get('linkedPortId'):
                port = next((d for d in scene.get('devices', []) if d['id'] == actor['net']['linkedPortId']), None)
                if not port or not adjacent(actor, port):
                    actor['net'].update(linkedPortId=None, knownDeviceIds=[])
        else:
            details['text'] = actor['name'] + ': стартовая позиция изменена.'
    elif kind == 'switch':
        actor['loadout'] = loadout_call(battle_loadout.activate, actor['loadout'], cmd['weaponId']); sync_weapon(actor)
        actor['actions'] += 1
        details.update(weaponId=cmd['weaponId'], text=actor['name'] + ': готовит ' + actor['weapon']['name'] + '.')
    elif kind == 'reload':
        if actor.get('loadout') is not None:
            actor['loadout'] = loadout_call(battle_loadout.reload, actor['loadout'], actor['loadout']['activeWeaponId']); sync_weapon(actor)
        else:
            actor['weapon']['ammo'] += p['count']; actor['weapon']['reserve'] -= p['count']
        actor['actions'] += 1
        details['text'] = actor['name'] + ': перезарядка, ' + str(actor['weapon']['ammo']) + ' патронов в магазине.'
    elif kind in ('interact', 'door'):
        tile = scene['tiles'][cmd['y']][cmd['x']]
        tile['open'] = not tile['open']
        if kind == 'interact':
            actor['actions'] += 1
        details.update(kind='door', at=dict(x=cmd['x'], y=cmd['y']), text=(actor['name'] + ': ' if actor else 'ГМ: ') + ('дверь открыта.' if tile['open'] else 'дверь закрыта.'))
    elif kind == 'hide':
        actor['hidden'] = not actor['hidden']
        details.update(kind='visibility', text=actor['name'] + (' скрыт от игроков.' if actor['hidden'] else ' показан игрокам.'))
    elif kind == 'paint':
        x, y, paint = cmd['x'], cmd['y'], cmd['paint']
        scene['devices'] = [d for d in scene.get('devices', []) if not (d['type'] == 'door' and d['x'] == x and d['y'] == y and paint != 'door')]
        scene['props'] = [p for p in scene['props'] if not (p['x'] <= x < p['x'] + p['w'] and p['y'] <= y < p['y'] + p['h'])]
        scene['tiles'][y][x] = dict(type='floor' if paint in PROP_CATALOG else paint, zone='bar')
        if paint == 'door':
            scene['tiles'][y][x]['open'] = False
        if paint in PROP_CATALOG:
            w, h = prop_footprint(paint, cmd.get('facing', cmd.get('orientation', 'horizontal')))
            scene['props'].append(dict(id=cmd.get('id', 'paint-' + str(scene['version'] + 1)), type=paint, x=x, y=y, w=w, h=h, cover=True, label=PROP_CATALOG[paint]['label'], **({'facing': cmd['facing']} if 'facing' in cmd else {})))
        details['text'] = 'ГМ изменил карту.'
    elif kind == 'add':
        if training and added_actor is None:
            template = next((a for a in scene['actors'] if a['team'] == 'hostile'), scene['actors'][0] if scene['actors'] else None)
            if not template:
                fail('Нет учебного шаблона участника.')
            positions = [dict(x=x, y=y) for y in range(1, scene['height']) for x in range(1, scene['width']) if walkable(scene, x, y)]
            if not positions:
                fail('На карте нет свободного места.')
            added_actor = copy.deepcopy(template)
            aid = 'npc-' + str(scene['version'] + 1)
            added_actor.update(id=aid, characterId=-(scene['version'] + 100), name='Охранник ' + str(sum(a['team'] == 'hostile' for a in scene['actors']) + 1),
                               team='hostile', sprite=2, hidden=True, status='active', wounds=0, destroyed=[], actions=0, shots=0, moved=False,
                               **positions[len(positions) // 2])
        if not added_actor:
            fail('Добавь участника из актуального листа с подтверждёнными параметрами.')
        scene['actors'].append(added_actor)
        details.update(actorIds=[added_actor['id']], text='Добавлен участник сцены.')
    elif kind in ('connect', 'disconnect', 'scan', 'control'):
        actor['actions'] += 1
        net = actor['net']
        if kind == 'connect':
            net.update(linkedPortId=p['device']['id'], knownDeviceIds=[])
            details.update(text=actor['name'] + ': дека подключена к порту.', at=dict(x=p['device']['x'], y=p['device']['y']))
        elif kind == 'disconnect':
            net.update(linkedPortId=None, knownDeviceIds=[])
            details['text'] = actor['name'] + ': дека отключена.'
        elif kind == 'scan':
            port = next(d for d in scene['devices'] if d['id'] == net['linkedPortId'])
            found = [d for d in scene['devices'] if d['type'] != 'port' and d['networkId'] == port['networkId'] and distance_meters(scene, actor, d) <= 400]
            net['knownDeviceIds'] = [d['id'] for d in found]
            details.update(count=len(found), text=actor['name'] + ': Locate Remote, найдено устройств: ' + str(len(found)) + '.')
        else:
            net['controlUsed'] = True
            roll = d10(rng); success = roll <= p['program']['strength']
            device = next(d for d in scene['devices'] if d['id'] == p['device']['id'])
            revealed = []
            if success:
                if device['type'] == 'door':
                    scene['tiles'][device['y']][device['x']]['open'] = cmd['operation'] == 'open'
                elif device['type'] == 'speaker':
                    device['active'] = cmd['operation'] == 'on'
                elif device['type'] == 'camera':
                    device['active'] = True
                    revealed = [a for a in scene['actors'] if a['hidden'] and a['status'] != 'dead' and distance_meters(scene, device, a) <= device['range'] and not line_of_fire(scene, device, a)['blocked']]
                    if private_vision:
                        camera_cells=battle_vision.visible_cells(scene,device)
                        observed=[a for a in scene['actors'] if a['status']!='dead' and (a['x'],a['y']) in camera_cells and distance_meters(scene,device,a)<=device['range']]
                        net['cameraIntel']=dict(deviceName=device['name'],round=scene['round'],version=scene['version']+1,actors=[{k:copy.deepcopy(a[k]) for k in ('id','name','sprite','x','y','status')} for a in observed])
                        revealed=[]
                    else:
                        for a in revealed:
                            a['hidden'] = False
            details.update(actorIds=[actor['id']] + [a['id'] for a in revealed], at=dict(x=device['x'], y=device['y']),
                           roll=roll, strength=p['program']['strength'], success=success, operation=cmd['operation'], deviceType=device['type'], program=p['program']['name'],
                           text=actor['name'] + ': ' + p['program']['name'] + ' → ' + device['name'] + ', d10 ' + str(roll) + ' / STR ' + str(p['program']['strength']) + (' — команда выполнена.' if success else ' — сбой управления.'))
    return add_event(scene, details)


def sheet_actor(actor):
    return type(actor.get('characterId')) is int and actor['characterId'] > 0


def armor_mapping(data, armor):
    """Narrow reversible map, never choose a layer for aggregated/overridden SP."""
    result = {}
    for zone in ZONES:
        confirmed = armor[zone]
        if data['armorMode'] == 'manual':
            source = data['armor'][zone]
            result[zone] = dict(mode='manual' if confirmed == source else 'manual-review', sourceSP=source,
                                reason='' if confirmed == source else 'Подтверждённый SP отличается от ручного SP листа.')
            continue
        layers = [i for i in data['items'] if i['equipped'] and i['quantity'] > 0 and i.get('armor') and i['armor']['coverage'][zone] > 0]
        if not layers:
            result[zone] = dict(mode='none' if confirmed == 0 else 'manual-review', sourceSP=0,
                                reason='' if confirmed == 0 else 'В листе нет действующего слоя с таким SP.')
        elif len(layers) == 1:
            item, source = layers[0], layers[0]['armor']['coverage'][zone]
            result[zone] = dict(mode='item' if confirmed == source else 'manual-review', sourceSP=source, itemId=item['id'],
                                reason='' if confirmed == source else 'Подтверждённый SP отличается от единственного слоя листа.')
        else:
            result[zone] = dict(mode='manual-review', sourceSP=None,
                                reason='Несколько слоёв: SP сцены изнашивается, изменение конкретных слоёв в листе подтверждает ГМ вручную.')
    return result


NPC_TEMPLATES = [
    dict(id='guard-rifle', name='Охранник с винтовкой', description='Исходный охранник бара: Militech Ronin, 5d6, магазин 35, штатная броня демонстрации.'),
    dict(id='solo-pistol', name='Стрелок с пистолетом', description='Исходные параметры Рэя: Colt AMT 2000, 4d6+1, магазин 8, штатная броня демонстрации.'),
    dict(id='netrunner', name='Нетраннер', description='Исходные параметры Миры: Colt AMT 2000, Interface 4, дека с тремя Controller-программами.'),
]


def npc_template_id(actor):
    origin = actor.get('origin')
    template = origin.get('templateId') if isinstance(origin, dict) else None
    if isinstance(template, str) and template in {t['id'] for t in NPC_TEMPLATES}:
        return template
    return {'ray': 'solo-pistol', 'mira': 'netrunner', 'guard-1': 'guard-rifle', 'guard-2': 'guard-rifle'}.get(actor['id']) or (
        'guard-rifle' if actor['id'].startswith('npc-') and isinstance(actor.get('weapon'), dict) and actor['weapon'].get('id') == 'militech-ronin' else None)


def first_free(scene, x=1, y=1):
    positions = [(cx, cy) for cy in range(scene['height']) for cx in range(scene['width']) if walkable(scene, cx, cy)]
    if not positions:
        fail('На карте нет свободного места.')
    return min(positions, key=lambda pos: (abs(pos[0] - x) + abs(pos[1] - y), pos[1], pos[0]))


def make_npc(campaign, scene, config):
    template = config.get('templateId')
    if template not in {t['id'] for t in NPC_TEMPLATES}:
        fail('Выбери известный шаблон НПС.')
    original, _ = training_scene(campaign, 0, lambda: .5)
    index = {'solo-pistol': 0, 'netrunner': 1, 'guard-rifle': 2}[template]
    actor = copy.deepcopy(original['actors'][index])
    sprite = integer(config.get('sprite', actor['sprite']), 0, MAX_SPRITE_ID, 'внешность НПС')
    name = label(config.get('name', next(t['name'] for t in NPC_TEMPLATES if t['id'] == template)))
    hidden = config.get('hidden', True)
    team = config.get('team', 'hostile')
    if type(hidden) is not bool or team not in ('crew', 'hostile') or (team == 'crew' and hidden):
        fail('Проверь команду и видимость НПС.')
    if ('x' in config) != ('y' in config):
        fail('Для позиции НПС нужны обе координаты.')
    if 'x' in config:
        x, y = integer(config['x'], 0, scene['width'] - 1), integer(config['y'], 0, scene['height'] - 1)
        if not walkable(scene, x, y):
            fail('Клетка НПС занята или непроходима.')
    else:
        x, y = first_free(scene, scene['width'] // 2, scene['height'] // 2)
    actor.update(id='npc-' + str(uuid.uuid4()), characterId=None, sheetVersion=None, ownerId=campaign['gm_id'],
                 name=name, hidden=hidden, team=team, sprite=sprite, x=x, y=y, origin=dict(kind='npc', templateId=template))
    set_heading(actor, config.get('heading', 0))
    return actor


def equipment_stats(data):
    """Same equipped modifiers and EV semantics as frontend lib/tracker.ts."""
    active = [i for i in data['items'] if i['equipped'] and i['quantity'] > 0]
    stats = dict(data['stats'])
    for item in active:
        for modifier in item['modifiers']:
            stats[modifier['stat']] += modifier['value']
    layering_ev = 0
    for zone in ZONES:
        ordinary = sum(1 for i in active if i['armor'] and i['armor']['coverage'][zone] > 0 and i['armor']['type'] != 'skinweave')
        layering_ev = max(layering_ev, 3 if ordinary > 2 else 1 if ordinary > 1 else 0)
    ev = data['armorPenalty'] if data['armorMode'] == 'manual' else max(0, sum(i['armor']['ev'] for i in active if i['armor']) + layering_ev + data['evAdjustment'])
    stats['REF'] -= ev
    return {key: max(0, value) for key, value in stats.items()}


def eligible(db, campaign, cid):
    row = db.execute('SELECT * FROM characters WHERE id=?', (cid,)).fetchone()
    if not row or not (row['owner_id'] == campaign['gm_id'] or db.execute("SELECT 1 FROM campaign_characters WHERE campaign_id=? AND character_id=? AND status IN ('active','reserve')", (campaign['id'], cid)).fetchone()):
        fail('Лист больше не доступен в этой кампании.', 409)
    return row



def loadout_call(function, *args, **kwargs):
    try: return function(*args, **kwargs)
    except battle_loadout.LoadoutError as error: fail(error.message, error.status)


def sync_weapon(actor):
    if actor.get('loadout') is not None:
        actor['weapon'] = loadout_call(battle_loadout.current_weapon, actor['loadout'])
        actor['stats']['selectedWeapon'] = actor['weapon'].get('skillRank', 0)
    return actor['weapon']


def prepare_loadout(data, config, version, original=None):
    exact(config, ['weapons', 'activeWeaponId'], ['resetLoaded'])
    prior=original.get('loadout') if original else None
    if prior is None and original and not original.get('weapon',{}).get('unarmed'):
        prior=loadout_call(battle_loadout.migrate_weapon, original['weapon'], original['sheetVersion'], data=data)
    return loadout_call(battle_loadout.validate_loadout, data, config['weapons'], config['activeWeaponId'],
        prior, sheet_version=version, reset_loaded=config.get('resetLoaded', False))


def scene_actor_inventory(actor):
    """Synthetic scene inventory only; never infer a real character's gear."""
    if actor['characterId'] is not None and actor['characterId'] >= 0: fail('Набор реального персонажа меняется через его подготовку.',403)
    if actor.get('sceneInventory') is not None:
        data=copy.deepcopy(actor['sceneInventory'])
        for item in data['items']:
            if item['category']=='ammo' and item['id'] in actor.get('loadout',{}).get('ammoPools',{}):item['quantity']=actor['loadout']['ammoPools'][item['id']]
        return data
    skills=[]
    for key,name in [('handgun','Handgun'),('rifle','Rifle'),('smg','Submachinegun'),('heavy','Heavy Weapons'),('archery','Archery')]:
        if key in actor['stats']:skills.append(dict(id='scene-'+key,stat='REF',name=name,rank=actor['stats'][key]))
    skills.extend(dict(id='scene-melee-'+str(i),stat='REF',name=row['name'],rank=row['rank']) for i,row in enumerate(actor.get('meleeSkills',[])) if row['name'] not in {r['name'] for r in skills})
    items=[]
    loadout=actor.get('loadout')
    if loadout is not None:
        for weapon in loadout['weapons']:
            items.append(dict(id=weapon['weaponId'],name=weapon['name'],category='weapon',quantity=1))
        items.extend(dict(id=aid,name='Боеприпасы сцены',category='ammo',quantity=total) for aid,total in loadout['ammoPools'].items())
    else:
        weapon=actor['weapon']
        if not weapon.get('unarmed'):
            items=[dict(id=weapon.get('weaponId') or weapon['id'],name=weapon['name'],category='weapon',quantity=1),
                dict(id=weapon.get('ammoItemId') or 'ammo-'+weapon['id'],name='Боеприпасы сцены',category='ammo',quantity=weapon['ammo']+weapon['reserve'])]
    suggestions={}
    weapon=actor['weapon']
    if loadout is None and not weapon.get('unarmed'):
        family={'handgun':'Handgun','rifle':'Rifle','smg':'Submachinegun','heavy':'Heavy Weapons','archery':'Archery'}.get(weapon['skill'])
        if family:
            wid=weapon.get('weaponId') or weapon['id']
            suggestion=dict(weaponId=wid,kind='ranged',weaponType=weapon['skill'],skillName=family,skillRank=actor['stats'][weapon['skill']],ammoItemId=weapon.get('ammoItemId') or 'ammo-'+weapon['id'],profileId='Исходная сцена: числа сохранены; режимы и класс ошибки подтверждает ГМ')
            suggestion.update({key:str(weapon[key]) for key in ('damageDice','damageBonus','accuracy','range','rof','magazine')})
            suggestion['loaded']=str(weapon['ammo'])
            if weapon['id'] in ('colt-amt2000','militech-ronin'):suggestion.update(reliability='VR',profileId='Core 2020 p61–63: числа и VR; режимы / класс ошибки — решение ГМа')
            suggestions[wid]=suggestion
    return dict(name=actor['name'],items=items,skills=skills,profileSuggestions=suggestions)


def configured_scene_loadout(actor,config):
    data=scene_actor_inventory(actor)
    if config['activeWeaponId'] in actor.get('unavailableWeapons',[]) and not config.get('resetReadiness'):fail('Оружие недоступно после критической ошибки. ГМ должен явно подтвердить его готовность.',409)
    previous=actor.get('loadout')
    if previous is None and not actor['weapon'].get('unarmed'):
        weapon=copy.deepcopy(actor['weapon']);weapon.update(weaponId=weapon.get('weaponId') or weapon['id'],ammoItemId=weapon.get('ammoItemId') or 'ammo-'+weapon['id'])
        family={'handgun':'Handgun','rifle':'Rifle','smg':'Submachinegun','heavy':'Heavy Weapons','archery':'Archery'}.get(weapon['skill'])
        weapon.update(skillName=family or '',skillRank=actor['stats'].get(weapon['skill'],0) if family else 0)
        previous=loadout_call(battle_loadout.migrate_weapon,weapon,0,data=data)
    return loadout_call(battle_loadout.validate_loadout,data,config['weapons'],config['activeWeaponId'],previous,sheet_version=0,reset_loaded=config.get('resetLoaded',False))


# Only verified numeric source facts live here. Mode capabilities and automatic
# fumble classification remain explicit GM choices; the artwork grants none.
TRAINING_WEAPON_FACTS = {
    'colt-amt2000': dict(weaponType='handgun',skillName='Handgun',damageDice=4,damageBonus=1,accuracy=0,range=50,rof=1,magazine=8,reliability='VR'),
    'militech-ronin': dict(weaponType='rifle',skillName='Rifle',damageDice=5,damageBonus=0,accuracy=1,range=400,rof=30,magazine=35,reliability='VR'),
}


def validate_training_choices(choices):
    if type(choices) is not list or not 1<=len(choices)<=len(TRAINING_WEAPON_FACTS):
        fail('Подтверди учебный профиль каждого показанного вида оружия.')
    seen=set()
    for choice in choices:
        exact(choice,['weaponId','fireModes','singleActionCap','fumbleClass'])
        wid=choice['weaponId'];label(wid,64)
        if wid not in TRAINING_WEAPON_FACTS or wid in seen:fail('Неизвестный или повторный учебный профиль.')
        seen.add(wid)
        modes=choice['fireModes']
        if type(modes) is not list or not modes or any(type(mode) is not str or mode not in ('single','burst','auto') for mode in modes) or len(set(modes))!=len(modes):
            fail('Подтверди поддержанные режимы учебного оружия.')
        cap=integer(choice['singleActionCap'],0,TRAINING_WEAPON_FACTS[wid]['rof'],'одиночный предел')
        if ('single' in modes)!=(cap>0):fail('Одиночный предел должен соответствовать выбранным режимам.')
        if choice['fumbleClass'] not in ('automatic','nonautomatic'):fail('ГМ должен выбрать класс критической ошибки.')
        if ('burst' in modes or 'auto' in modes) and choice['fumbleClass']!='automatic':fail('Burst / auto требуют явно подтверждённого автоматического класса.')
        if 'burst' in modes and TRAINING_WEAPON_FACTS[wid]['rof']<3:fail('ROF этого учебного оружия не допускает три патрона.')
    return choices


def training_loadout_plan(scene,choices):
    """All-or-nothing synthetic preparation; never creates gear or refills it."""
    validate_training_choices(choices)
    by_id={row['weaponId']:row for row in choices}
    needed=set();participants=[]
    for actor in scene['actors']:
        if actor['characterId'] is not None and actor['characterId']>=0:
            fail('Учебная подготовка не применяется к реальным листам.',403)
        if actor['status']=='dead':continue
        if any(value>0 for value in actor.get('weaponJams',{}).values()) or actor.get('unavailableWeapons') or actor.get('droppedWeapons'):
            fail(actor['name']+': сначала явно восстанови готовность оружия в отдельном редакторе.',409)
        previous=actor.get('loadout')
        if previous is not None and not previous.get('legacy'):continue
        if previous is not None and (len(previous.get('weapons',[]))!=1 or previous.get('activeWeaponId')!=previous['weapons'][0]['id']):
            fail(actor['name']+': прежний сложный набор требует отдельного редактора оружия.',409)
        weapon=actor['weapon']
        if weapon.get('unarmed'):continue
        wid=weapon.get('weaponId') or weapon['id'];facts=TRAINING_WEAPON_FACTS.get(wid)
        if weapon.get('weaponId') and weapon['id']!=weapon['weaponId']:fail(actor['name']+': идентификаторы оружия требуют отдельной проверки.',409)
        if facts is None or any(type(weapon.get(key)) is not int or weapon[key]!=facts[key] for key in ('damageDice','damageBonus','accuracy','range','rof','magazine')):
            fail(actor['name']+': изменённый или неизвестный профиль требует отдельного редактора оружия.',409)
        needed.add(wid);participants.append((actor,weapon,wid,facts))
    if not participants:fail('Все доступные учебные участники уже подготовлены.',409)
    if set(by_id)!=needed:fail('Состав учебных профилей изменился. Открой подготовку заново.',409)
    plans=[]
    for actor,weapon,wid,facts in participants:
        data=scene_actor_inventory(actor);aid=weapon.get('ammoItemId') or 'ammo-'+weapon['id']
        skill=next((s for s in data['skills'] if s['name']==facts['skillName'] and s['stat']=='REF'),None)
        if skill is None:fail(actor['name']+': навык требует отдельного подтверждения.',409)
        profile=dict(facts,weaponId=wid,kind='ranged',ammoItemId=aid,skillRank=skill['rank'],loaded=weapon['ammo'],
            profileId='Core 2020 p61–63: числа / VR; режимы и класс ошибки явно выбраны ГМом для тренировки',
            **{k:v for k,v in by_id[wid].items() if k!='weaponId'})
        config=dict(weapons=[profile],activeWeaponId=wid)
        plans.append((actor,data,configured_scene_loadout(actor,config)))
    return plans


MELEE_SKILL_NAMES = {
    'brawling': ('brawling', 'драка'), 'melee': ('melee', 'ближний бой с оружием'),
    'fencing': ('fencing', 'фехтование'), 'dodge': ('dodge & escape', 'уклонение и освобождение'),
    'athletics': ('athletics', 'атлетика'),
    'martialArts': ('aikido','айкидо','animal kung fu','звериное кунг-фу','boxing','бокс','capoeira','капоэйра',
        'choi li fut','чой ли фут','judo','дзюдо','karate','карате','tae kwon do','тхэквондо',
        'thai kick boxing','тайский бокс','wrestling','борьба'),
}


def melee_skills_from_sheet(data):
    # Only actual named REF skills; choosing a defense is a separate GM decision.
    skills = []
    for row in data.get('skills', []):
        if row.get('stat') != 'REF': continue
        name = row['name'].strip().casefold()
        family = next((kind for kind, aliases in MELEE_SKILL_NAMES.items() if name in aliases), None)
        if family: skills.append(dict(kind=family, name=row['name'], rank=row['rank']))
    return skills


def weapon_from_sheet(data, config):
    if config is None:
        return dict(id='unarmed', name='Без огнестрельного оружия', skill='handgun', ammo=0, reserve=0, magazine=1,
                    weaponId=None, ammoItemId=None, skillName='', skillRank=0, damageDice=1, damageBonus=0,
                    accuracy=0, range=1, rof=1, unarmed=True)
    if not isinstance(config, dict) or 'magazine' not in config or 'loaded' not in config:
        fail('Подтверди ёмкость магазина и число заряженных патронов; запас считается из общего количества в листе.')
    exact(config, ['weaponId', 'ammoItemId', 'skillName', 'skillRank', 'damageDice', 'damageBonus', 'accuracy', 'range', 'rof', 'magazine', 'loaded'])
    weapon_id, ammo_id = label(config['weaponId'], 64), label(config['ammoItemId'], 64)
    item = next((i for i in data['items'] if i['id'] == weapon_id and i['category'] == 'weapon' and i['quantity'] > 0), None)
    ammo = next((i for i in data['items'] if i['id'] == ammo_id and i['category'] == 'ammo'), None)
    if not item or not ammo:
        fail('Укажи существующее оружие и отдельную строку патронов из листа.')
    skills = [s for s in data['skills'] if s['name'] == config['skillName'] and s['stat'] == 'REF']
    untrained = config['skillName'] == '' and type(config['skillRank']) is int and config['skillRank'] == 0
    if not untrained and (len(skills) != 1 or type(config['skillRank']) is not int or skills[0]['rank'] != config['skillRank']):
        fail('Название и ранг должны совпадать с одним навыком REF в листе.')
    skill_name, skill_rank = ('', 0) if untrained else (skills[0]['name'], skills[0]['rank'])
    magazine = integer(config['magazine'], 1, 1000, 'ёмкость магазина')
    loaded = integer(config['loaded'], 0, min(magazine, ammo['quantity']), 'патроны в магазине (часть общего количества)')
    result = dict(id=weapon_id, name=item['name'], skill='handgun', ammo=loaded, reserve=ammo['quantity'] - loaded, magazine=magazine,
                  weaponId=weapon_id, ammoItemId=ammo_id, skillName=skill_name, skillRank=skill_rank)
    for key, low, high in [('damageDice', 1, 20), ('damageBonus', -100, 100), ('accuracy', -10, 10), ('range', 1, 10000), ('rof', 1, 100)]:
        result[key] = integer(config[key], low, high, key)
    return result


def actor_from_sheet(row, config, original=None):
    data = json.loads(row['data'])
    stats = equipment_stats(data)
    weapon = weapon_from_sheet(data, config['weapon'])
    sense = integer(config['combatSense'], 0, 10, 'Боевой инстинкт')
    if sense and (not data['special'] or sense != data['specialRank']):
        fail('Боевой инстинкт должен быть 0 либо подтверждённым особым навыком из листа.')
    armor = config['armor']
    exact(armor, ZONES)
    armor = {zone: integer(armor[zone], 0, 200, 'SP') for zone in ZONES}
    actor = dict(armorPersistence=armor_mapping(data, armor), origin=dict(kind='sheet'), id='character-' + str(row['id']), characterId=row['id'], name=data['name'], ownerId=row['owner_id'], sheetVersion=row['version'],
                team=config['team'], hidden=config['hidden'], sprite=config['sprite'], x=config['x'], y=config['y'],
                facing=1, heading=heading(config.get('heading', 0)), status='active', wounds=data['wounds'], destroyed=[], stabilized=False,
                stats=dict(ref=stats['REF'], ma=stats['MA'], body=stats['BODY'], combatSense=sense, handgun=weapon['skillRank'], rifle=0),
                armor=armor, weapon=weapon, actions=0, shots=0, moved=False, initiative=0, meleeSkills=melee_skills_from_sheet(data))
    if 'loadout' in config:
        actor['loadout'] = prepare_loadout(data, config['loadout'], row['version'], original)
        sync_weapon(actor)
    elif original and original.get('loadout') is not None:
        # Older clients may edit geometry but cannot erase or refill magazines.
        actor['loadout'] = loadout_call(battle_loadout.rebind, original['loadout'], data, row['version'])
        sync_weapon(actor)
    return actor


def validate_devices(scene, devices):
    if not isinstance(devices, list) or len(devices) > 40:
        fail('Допустимо до 40 сетевых устройств.')
    result = []
    for d in devices:
        exact(d, ['id', 'name', 'type', 'networkId', 'x', 'y'], ['range', 'active'])
        for key in ('id', 'name', 'networkId'):
            label(d[key])
        integer(d['x'], 0, scene['width'] - 1); integer(d['y'], 0, scene['height'] - 1)
        if d['type'] not in ('port', 'door', 'camera', 'speaker'):
            fail('Неизвестный тип сетевого устройства.')
        if d['type'] == 'door' and scene['tiles'][d['y']][d['x']]['type'] != 'door':
            fail('Сетевую дверь нужно поставить на дверь карты.')
        if d['type'] in ('camera', 'speaker') and type(d.get('active')) is not bool:
            fail('Укажи состояние устройства.')
        if d['type'] == 'camera':
            integer(d.get('range'), 1, 400, 'дальность камеры')
        result.append(copy.deepcopy(d))
    if len({d['id'] for d in result}) != len(result):
        fail('Повтор ID сетевого устройства.')
    return result


def net_from_sheet(data, config):
    exact(config, ['deckItemId', 'interfaceRank', 'programIds'])
    deck_id = label(config['deckItemId'], 64)
    if not any(i['id'] == deck_id and i['quantity'] > 0 for i in data['items']):
        fail('Выбери существующую деку из инвентаря.')
    rank = integer(config['interfaceRank'], 1, 10, 'Interface')
    interface_names = ('interface', 'интерфейс')
    ranks = [s['rank'] for s in data['skills'] if s['name'].strip().lower() in interface_names]
    if data.get('special', '').strip().lower() in interface_names:
        ranks.append(data['specialRank'])
    if rank not in ranks:
        fail('Ранг Interface должен совпадать с подтверждённым навыком в листе.')
    programs = config['programIds']
    if not isinstance(programs, list) or len(programs) > 3 or any(type(p) is not str or p not in CONTROLLERS for p in programs) or len(set(programs)) != len(programs):
        fail('Подтверди Controller-программы деки: Genie, Crystal Ball, Soundmachine.')
    return dict(deck=True, deckItemId=deck_id, programIds=copy.deepcopy(programs), linkedPortId=None, knownDeviceIds=[], controlUsed=False), rank


def prepare(db, campaign, payload, version, previous=None):
    if previous and previous.get('unresolvedFumbles'):fail('Сначала разбери сохранённые критические ошибки. Новая подготовка их не стирает.',409)
    exact(payload, ['id', 'expectedVersion', 'type', 'name', 'width', 'height', 'tileMeters', 'actors'], ['tiles', 'props', 'devices', 'settings', 'preserveNpcIds', 'acknowledgeManualWear'])
    width, height = integer(payload['width'], 4, 60), integer(payload['height'], 4, 60)
    meters = payload['tileMeters']
    if type(meters) not in (int, float) or not .1 <= meters <= 10:
        fail('Масштаб клетки должен быть от 0,1 до 10 м.')
    tiles = payload.get('tiles', [[{'type': 'floor'} for _ in range(width)] for _ in range(height)])
    if not isinstance(tiles, list) or len(tiles) != height or any(not isinstance(row, list) or len(row) != width for row in tiles):
        fail('Проверь размер карты.')
    normalized_tiles = []
    for row in tiles:
        normalized_row = []
        for tile in row:
            exact(tile, ['type'], ['open', 'zone','protection'])
            if tile['type'] not in ['floor', 'wall', 'door'] or ('zone' in tile and (not isinstance(tile['zone'], str) or len(tile['zone']) > 100)):
                fail('Некорректная клетка.')
            if tile['type'] == 'door' and type(tile.get('open')) is not bool:
                fail('Для двери укажи открыта ли она.')
            if 'protection' in tile:
                if tile['type'] not in ('wall','door'):fail('SP преграды задаётся стене или двери.')
                cover_call(battle_cover_scene.validate_tile_protection,tile['protection'])
            normalized_row.append({k: copy.deepcopy(v) for k, v in tile.items() if k in ('type', 'open', 'zone','protection')})
        normalized_tiles.append(normalized_row)
    props = payload.get('props', [])
    if not isinstance(props, list) or len(props) > 200:
        fail('Слишком много предметов на карте.')
    for prop in props:
        exact(prop, ['id', 'type', 'x', 'y', 'w', 'h', 'cover'], ['label', 'facing','protection','flipped'])
        label(prop['id']); label(prop.get('label', 'Предмет'));cover_call(battle_cover_scene.validate_prop_state,prop)
        if type(prop['type']) is not str or prop['type'] not in PROP_CATALOG or type(prop['cover']) is not bool:
            fail('Проверь предмет на карте.')
        integer(prop['x'], 0, width - 1); integer(prop['y'], 0, height - 1)
        integer(prop['w'], 1, width - prop['x']); integer(prop['h'], 1, height - prop['y'])
        if 'facing' in prop:
            if type(prop['facing']) is not int or prop['facing'] not in (0, 90, 180, 270):
                fail('Направление предмета: 0, 90, 180 или 270 градусов.')
            if prop['type'] in ('car', 'van') and (prop['w'], prop['h']) != prop_footprint(prop['type'], prop['facing']):
                fail('Направление машины не соответствует занятой площади.')
        if prop['type'] in ('car', 'van') and (prop['w'], prop['h']) not in (prop_footprint(prop['type']), prop_footprint(prop['type'], 'vertical')):
            fail('Размер машины: 4×2 или 2×4 клетки; фургона: 5×2 или 2×5 клеток.')
    for prop in props:
        if prop['type'] in ('car', 'van'):
            if any(normalized_tiles[y][x]['type'] != 'floor' for y in range(prop['y'], prop['y'] + prop['h']) for x in range(prop['x'], prop['x'] + prop['w'])) or any(other is not prop and rectangles_overlap(prop, other) for other in props):
                fail('Машина или фургон должны стоять на свободном полу без пересечения стен, дверей и других предметов.')
    if len({p['id'] for p in props}) != len(props):
        fail('Повтор ID предмета.')
    actors = payload['actors']
    if not isinstance(actors, list) or len(actors) > 20:
        fail('На карте может быть от 0 до 20 участников; для начала боя нужны хотя бы двое.')
    scene = dict(schemaVersion=1, id=str(uuid.uuid4()), name=label(payload['name']), subtitle='Совместный бой кампании', version=version,
                 phase='preparation', round=0, index=0, order=[], width=width, height=height, tileMeters=meters,
                 tiles=normalized_tiles, props=copy.deepcopy(props), actors=[], devices=[], settings={'stagedPenetration': True}, log=[], pending=[])
    if 'settings' in payload:
        exact(payload['settings'], ['stagedPenetration'], ['cp2020Rulings'])
        if 'cp2020Rulings' in payload['settings']:validate_rules_profile(payload['settings']['cp2020Rulings'])
        if type(payload['settings']['stagedPenetration']) is not bool:
            fail('Проверь настройку износа брони.')
        scene['settings'] = copy.deepcopy(payload['settings'])
    elif previous:
        # Old clients omitting settings must not silently change existing rules.
        scene['settings'] = copy.deepcopy(previous['settings'])
    scene['devices'] = validate_devices(scene, payload.get('devices', []))
    previous_pcs = {a['characterId']: a for a in (previous or {}).get('actors', []) if sheet_actor(a)}
    for config in actors:
        exact(config, ['characterId', 'version', 'x', 'y', 'team', 'hidden', 'sprite', 'weapon', 'armor', 'combatSense'], ['net', 'heading', 'loadout', 'resetReadiness'])
        cid = integer(config['characterId'], 1, 10**9)
        integer(config['version'], 1, 10**9)
        if type(config['hidden']) is not bool or config['team'] not in ['crew', 'hostile'] or (config['team'] == 'crew' and config['hidden']):
            fail('Проверь команду и видимость участника.')
        integer(config['sprite'], 0, MAX_SPRITE_ID); integer(config['x'], 0, width - 1); integer(config['y'], 0, height - 1)
        row = eligible(db, campaign, cid)
        if row['version'] != config['version']:
            fail('Лист изменился. Обнови подготовку и подтверди параметры заново.', 409)
        if any(a['characterId'] == cid for a in scene['actors']):
            fail('Один лист нельзя добавить в бой дважды.')
        original = previous_pcs.get(cid)
        actor = actor_from_sheet(row, config, original)
        if 'resetReadiness' in config and type(config['resetReadiness']) is not bool:fail('Проверь подтверждение готовности оружия.')
        if original:
            if not config.get('resetReadiness',False):
                for key in ('weaponJams','unavailableWeapons','droppedWeapons'):
                    if key in original:actor[key]=copy.deepcopy(original[key])
            if actor['weapon']['id'] in actor.get('unavailableWeapons',[]):fail('Выбранное оружие выронено. Выбери другое либо явно подтверди восстановление готовности.',409)
            # Preparation edits cannot revive or heal scene-only consequences.
            for key in ('status', 'destroyed', 'stabilized', 'facing'):
                actor[key] = copy.deepcopy(original[key])
            # Personal sheets cap wounds at 40; retain combat totals unless the
            # GM explicitly confirms a newer live sheet revision.
            if actor['sheetVersion'] == original['sheetVersion']:
                actor['wounds'] = original['wounds']
        set_heading(actor, config['heading'] if 'heading' in config else battle_vision.actor_heading(original) if original else 0)
        if not valid_placement(scene, actor):
            fail('Стартовая клетка занята или непроходима.')
        if config.get('net') is not None:
            actor['net'], actor['stats']['interface'] = net_from_sheet(json.loads(row['data']), config['net'])
        scene['actors'].append(actor)
    # Stable references are allocated only inside an explicit mutating preparation.
    # Blueprint preview calls this adapter with actors=[], so reads never allocate.
    for actor in scene['actors']:
        db.execute('INSERT OR IGNORE INTO user_portability VALUES(?,?)', (actor['ownerId'], str(uuid.uuid4())))
        owner_key = db.execute('SELECT uuid FROM user_portability WHERE user_id=?', (actor['ownerId'],)).fetchone()[0]
        db.execute('INSERT OR IGNORE INTO character_portability VALUES(?,?,?)', (actor['characterId'], str(uuid.uuid4()), owner_key))
    return scene


def start_scene(scene, rng):
    """Shared initiative transition; preparing an empty map is intentionally valid."""
    if scene['phase'] not in ('preparation', 'ended'):
        fail('Этот бой уже начат.', 409)
    if not 2 <= sum(a['status'] != 'dead' for a in scene['actors']) <= 20:
        fail('Для начала боя нужно от 2 до 20 живых участников.', 409)
    for actor in scene['actors']:
        if actor['status'] != 'dead' and not walkable(scene, actor['x'], actor['y'], actor['id']):
            fail('Проверь стартовые позиции.')
    scene['phase'] = 'combat'; scene['round'] += 1
    initiative(scene, rng)
    if find_actor(scene, scene['order'][0])['status'] == 'stunned':
        save_check(scene, find_actor(scene, scene['order'][0]), rng, True)
    return add_event(scene, dict(kind='start', actorIds=[], text='Бой начат. Раунд ' + str(scene['round']) + '.'))


def training_scene(campaign, version, rng):
    """Original bar geometry and stats; revision 3 removes only default manual hiding.

    The original demo begins in preparation. Opening an old saved training run
    does not call this function: only creation or explicit training-reset does.
    """
    width, height = 24, 16
    tiles = [[dict(type='floor', zone='street' if y >= 13 else 'bar') for x in range(width)] for y in range(height)]
    def wall(x, y):
        tiles[y][x] = dict(type='wall', zone='bar')
    for x in range(2, 22):
        wall(x, 2); wall(x, 12)
    for y in range(2, 13):
        wall(2, y); wall(21, y)
    for x in range(17, 21):
        wall(x, 6)
    for y in range(3, 6):
        wall(17, y)
    tiles[6][18] = dict(type='door', open=False, zone='bar')
    tiles[12][7] = dict(type='door', open=True, zone='bar')
    for y in range(3, 6):
        for x in range(18, 21):
            tiles[y][x]['zone'] = 'office'
    props = [dict(id=pid, type=kind, x=x, y=y, w=w, h=h, cover=True, label=name)
             for pid, kind, x, y, w, h, name in [
        ('table-1', 'table', 6, 5, 2, 1, 'Стол'), ('table-2', 'table', 7, 8, 2, 1, 'Стол'),
        ('table-3', 'table', 12, 9, 2, 1, 'Стол'), ('table-4', 'table', 18, 10, 2, 1, 'Стол'),
        ('bar-1', 'counter', 11, 4, 5, 1, 'Барная стойка'), ('crate-1', 'crate', 10, 8, 1, 1, 'Ящик'),
        ('crate-2', 'crate', 19, 3, 1, 1, 'Ящик'), ('barrel-1', 'barrel', 3, 4, 1, 1, 'Бочка'),
        ('barrel-2', 'barrel', 20, 11, 1, 1, 'Бочка')]]
    pistol = dict(id='colt-amt2000', name='Colt AMT 2000', category='Пистолет', skill='handgun', accuracy=0,
                  damageDice=4, damageBonus=1, magazine=8, rof=1, range=50, ammo=8, reserve=32)
    rifle = dict(id='militech-ronin', name='Militech Ronin', category='Винтовка', skill='rifle', accuracy=1,
                 damageDice=5, damageBonus=0, magazine=35, rof=30, range=400, ammo=35, reserve=70)
    actors = []
    for index, (aid, name, team, sprite, x, y, stats) in enumerate([
        ('ray', 'Рэй', 'crew', 0, 6, 10, (7, 5, 8, 2, 4, 4, 0)),
        ('mira', 'Мира', 'crew', 1, 8, 10, (6, 6, 6, 0, 4, 2, 4)),
        ('guard-1', 'Охранник', 'hostile', 2, 16, 8, (5, 4, 7, 0, 4, 3, 0)),
        ('guard-2', 'Охранник у подсобки', 'hostile', 2, 19, 5, (6, 4, 7, 0, 4, 3, 0)),
    ]):
        armor = dict(zip(ZONES, [0, 18, 16, 16, 14, 14] if team == 'crew' else [10, 14, 14, 14, 12, 12]))
        actor = dict(id=aid, characterId=-(index + 1), ownerId=campaign['gm_id'], sheetVersion=0,
                     name=name, team=team, sprite=sprite, x=x, y=y, hidden=False, status='active',
                     wounds=0, destroyed=[], facing=1, heading=0, stats=dict(zip(['ref', 'ma', 'body', 'combatSense', 'handgun', 'rifle', 'interface'], stats)),
                     armor=armor, weapon=copy.deepcopy(pistol if team == 'crew' else rifle),
                     actions=0, shots=0, moved=False, initiative=0, stabilized=False)
        if aid == 'mira':
            actor['net'] = dict(deck=True, programIds=['genie', 'crystalBall', 'soundmachine'], linkedPortId=None, knownDeviceIds=[], controlUsed=False)
        actors.append(actor)
    devices = [
        dict(id='bar-port', name='Порт деки', type='port', networkId='bar-network', x=9, y=10),
        dict(id='office-door', name='Дверь подсобки', type='door', networkId='bar-network', x=18, y=6),
        dict(id='entrance-door', name='Входная дверь', type='door', networkId='bar-network', x=7, y=12),
        dict(id='office-camera', name='Камера подсобки', type='camera', networkId='bar-network', x=20, y=4, range=6, active=True),
        dict(id='bar-speaker', name='Громкая связь', type='speaker', networkId='bar-network', x=12, y=3, active=False),
    ]
    scene = dict(schemaVersion=1, id=str(uuid.uuid4()), demoRevision=3, name='Последняя остановка',
                 subtitle='TRAINING · Бар · Найт-Сити · 2020', version=version,
                 phase='preparation', round=0, index=0, order=[], width=width, height=height, tileMeters=1,
                 tiles=tiles, props=props, actors=actors, devices=devices,
                 settings={'stagedPenetration': True}, log=[], pending=[])
    event = add_event(scene, dict(kind='prepare', actorIds=[], text='TRAINING: бар готов. Реальные листы не меняются.'))
    return scene, event


def check_sheet(db, campaign, actor):
    if actor.get('origin', {}).get('kind') == 'npc' and actor.get('characterId') is None:
        return None
    row = eligible(db, campaign, actor['characterId'])
    if row['owner_id'] != actor['ownerId'] or row['version'] != actor['sheetVersion']:
        fail('Лист участника изменился вне боя. Отклони заявку, заверши бой и подготовь новый по свежим листам.', 409)
    return row


def persist_combat_effects(db, campaign, scene, command_id, user_id, now, *, ammo_changes=(), impacts=()):
    """Apply one authoritative action to sheets in a single surrounding transaction.

    Ammo changes are (actorId, ammoItemId, negative delta). Impacts are
    (targetId, mutable hit receipt), in resolution order. Each sheet gets ONE
    narrow update/revision even for many bullets, locations or shared pools.
    Nothing commits here; command dedup, scene write and undo share the caller's
    transaction. External edits reject before any authoritative result commits.
    """
    plans = {}
    def plan_for(aid):
        actor = find_actor(scene, aid)
        if aid not in plans:
            row = check_sheet(db, campaign, actor)
            plans[aid] = dict(actor=actor, row=row, data=json.loads(row['data']) if row else None, changed=False)
        return plans[aid]
    # Preflight every affected sheet before even planning changes.
    for aid, _, _ in ammo_changes: plan_for(aid)
    for aid, _ in impacts: plan_for(aid)
    for aid, ammo_id, delta in ammo_changes:
        if type(delta) is not int or delta >= 0:
            fail('Некорректный расход патронов.')
        plan = plan_for(aid)
        if plan['row'] is None: continue
        ammo = next((i for i in plan['data']['items'] if i['id'] == ammo_id and i['category'] == 'ammo'), None)
        if not ammo or type(ammo['quantity']) is not int or ammo['quantity'] + delta < 0:
            fail('Строка патронов изменилась.', 409)
        ammo['quantity'] += delta
        plan['changed'] = True
    for aid, hit in impacts:
        plan = plan_for(aid); target, data = plan['actor'], plan['data']
        damage = hit.get('damage', 0)
        if type(damage) is not int or damage < 0: fail('Некорректное последствие попадания.')
        if data is not None and damage:
            data['wounds'] = min(40, data['wounds'] + damage); plan['changed'] = True
        if hit.get('coverComposite') and hit.get('coverArmorWear')!='body':continue
        if not (scene['settings'].get('stagedPenetration') and hit.get('penetration', 0) > 0 and hit.get('sp', 0) > 0):
            continue
        zone = hit['location']; mapping = target.get('armorPersistence', {}).get(zone, {})
        is_npc = target.get('origin', {}).get('kind') == 'npc'
        mode = 'scene' if is_npc else mapping.get('mode', 'manual-review')
        persisted = mode in ('manual', 'item') and data is not None
        # Each penetrating hit loses one SP. Do not use the final scene SP for
        # earlier hits in a multi-hit action.
        wear = dict(zone=zone, before=hit['sp'], after=hit['sp'] - 1, mode=mode,
                    persisted=persisted, requiresManualUpdate=not is_npc and not persisted,
                    reason=mapping.get('reason', '') if not is_npc else 'НПС хранится только в сцене.')
        hit['armorWear'] = wear
        add_event(scene,dict(kind='armor-wear',actorIds=[target['id']],location=zone,armorWear=copy.deepcopy(wear),text='Износ брони: SP '+str(wear['before'])+' → '+str(wear['after'])+'.'))
        if wear['requiresManualUpdate']:
            previous = target.setdefault('wearPending', {}).get(zone)
            target['wearPending'][zone] = dict(amount=(previous['amount'] if previous else 0) + 1,
                sourceSP=previous['sourceSP'] if previous else hit['sp'], resultSP=wear['after'], reason=wear['reason'])
        if not persisted: continue
        if mode == 'manual':
            if data['armorMode'] != 'manual' or data['armor'][zone] != wear['before']:
                fail('Ручной SP изменился; износ не перезапишет лист.', 409)
            data['armor'][zone] = wear['after']
        else:
            layers = [i for i in data['items'] if i['equipped'] and i['quantity'] > 0 and i.get('armor') and i['armor']['coverage'][zone] > 0]
            if data['armorMode'] != 'equipment' or len(layers) != 1 or layers[0]['id'] != mapping.get('itemId') or layers[0]['armor']['coverage'][zone] != wear['before']:
                fail('Источник SP изменился; износ не перезапишет слой.', 409)
            layers[0]['armor']['coverage'][zone] = wear['after']
        plan['changed'] = True
    for plan in plans.values():
        actor, row, data = plan['actor'], plan['row'], plan['data']
        if row is None or not plan['changed']: continue
        changed = db.execute('UPDATE characters SET data=?,version=version+1,updated=? WHERE id=? AND version=?',
                             (encoded(data), now, row['id'], row['version']))
        if changed.rowcount != 1: fail('Лист изменился одновременно с действием боя.', 409)
        actor['sheetVersion'] = row['version'] + 1
        if actor.get('loadout') is not None:
            actor['loadout'] = loadout_call(battle_loadout.rebind, actor['loadout'], data, actor['sheetVersion']); sync_weapon(actor)
        actor['armorPersistence'] = armor_mapping(data, actor['armor'])
        db.execute('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,?,?,?)',
                   (row['id'], user_id, encoded(data), row['version'] + 1, 'Бой ' + scene['id'] + ': патроны / ранения / подтверждённый износ SP, заявка ' + command_id[:60], now))
    return [p['actor']['id'] for p in plans.values() if p['row'] is not None and p['changed']]


def persist_shot(db, campaign, scene, declaration, user_id, event, now):
    actor = find_actor(scene, declaration['actorId'])
    return persist_combat_effects(db, campaign, scene, declaration['id'], user_id, now,
        ammo_changes=[(actor['id'], actor['weapon'].get('ammoItemId'), -1)],
        impacts=[(declaration['targetId'], event)])


def role_context(db, user, cid):
    campaign = db.execute('SELECT * FROM campaigns WHERE id=?', (cid,)).fetchone()
    if not campaign:
        fail('Кампания не найдена.', 404)
    gm = campaign['gm_id'] == user['id']
    if not gm:
        if not db.execute('SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?', (cid, user['id'])).fetchone() or not db.execute("SELECT 1 FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=? AND c.owner_id=? AND cc.status IN ('active','reserve')", (cid, user['id'])).fetchone():
            fail('Бой доступен после принятия твоего персонажа в кампанию.', 403)
    return campaign, gm


def character_key(db, actor):
    if not sheet_actor(actor):
        return None
    row = db.execute('SELECT uuid FROM character_portability WHERE character_id=?', (actor['characterId'],)).fetchone()
    return row[0] if row else None


def export_blueprint(db, scene):
    document = dict(format='nightcity-scene', schemaVersion=1,
                    **{k: copy.deepcopy(scene[k]) for k in ('name', 'width', 'height', 'tileMeters', 'tiles', 'props', 'devices', 'settings')},
                    characters=[], npcs=[])
    warnings = ['Это шаблон подготовки: реальные ресурсы и история не экспортируются; НПС при импорте создаются заново по шаблонам; их подтверждённые наборы оружия не входят в этот формат. Полная резервная копия сервера сохраняет их.']
    for actor in scene['actors']:
        placement = {k: actor[k] for k in ('name', 'x', 'y', 'team', 'hidden', 'sprite')}
        placement['heading'] = battle_vision.actor_heading(actor)
        if sheet_actor(actor):
            key = character_key(db, actor)
            if key:
                document['characters'].append(dict(characterKey=key, **placement))
            else:
                warnings.append(actor['name'] + ': нет переносимого идентификатора; позиция листа не включена.')
        else:
            template = npc_template_id(actor)
            if template:
                document['npcs'].append(dict(templateId=template, **placement))
            else:
                warnings.append(actor['name'] + ': неизвестный учебный шаблон не включён.')
    return document, warnings


def normalize_blueprint(raw):
    if not isinstance(raw, dict):
        fail('Файл сцены должен содержать JSON-объект.')
    if raw.get('format') == 'nightcity-scene':
        exact(raw, ['format', 'schemaVersion', 'name', 'width', 'height', 'tileMeters', 'tiles', 'props', 'devices', 'settings', 'characters', 'npcs'])
        if type(raw['schemaVersion']) is not int or raw['schemaVersion'] != 1:
            fail('Неизвестная версия шаблона сцены.')
        document, warnings = copy.deepcopy(raw), []
    elif type(raw.get('schemaVersion')) is int and raw['schemaVersion'] == 1 and 'actors' in raw and not raw.get('format'):
        # Legacy accepted original module: geometry is portable, authority is not.
        # Old version/order/log/RNG IDs/wounds/ammo/stats/ownership are discarded.
        for key in ('name', 'width', 'height', 'tileMeters', 'tiles', 'props'):
            if key not in raw:
                fail('В исходной сцене отсутствует геометрия.')
        if not isinstance(raw['actors'], list) or len(raw['actors']) > 20:
            fail('В исходной сцене слишком много участников.')
        if not isinstance(raw.get('settings', {}), dict):
            fail('Некорректные настройки исходной сцены.')
        document = dict(format='nightcity-scene', schemaVersion=1,
                        **{k: copy.deepcopy(raw[k]) for k in ('name', 'width', 'height', 'tileMeters', 'tiles', 'props')},
                        devices=copy.deepcopy(raw.get('devices', [])), settings=dict(stagedPenetration=raw.get('settings', {}).get('stagedPenetration') is True), characters=[], npcs=[])
        warnings = ['Исходный schemaVersion 1 используется как шаблон: старые версии, ресурсы, характеристики, очередь и история не восстанавливаются.']
        for actor in raw['actors']:
            if not isinstance(actor, dict) or not isinstance(actor.get('id'), str):
                fail('Некорректный участник исходной сцены.')
            template = npc_template_id(actor)
            if template:
                document['npcs'].append(dict(templateId=template, heading=battle_vision.actor_heading(actor), **{k: actor.get(k) for k in ('name', 'x', 'y', 'team', 'hidden', 'sprite')}))
            else:
                warnings.append(str(actor.get('name', 'Участник'))[:100] + ': нераспознанная фигура не импортируется; живые листы остаются на сервере.')
    else:
        fail('Поддерживается шаблон nightcity-scene v1 либо исходная сцена schemaVersion 1.')
    for key, fields in [('characters', ['characterKey']), ('npcs', ['templateId'])]:
        entries = document[key]
        if not isinstance(entries, list) or len(entries) > 20:
            fail('Допустимо до 20 записей участников в шаблоне.')
        seen = set()
        for entry in entries:
            exact(entry, fields + ['name', 'x', 'y', 'team', 'hidden', 'sprite'], ['heading'])
            if 'heading' in entry: heading(entry['heading'])
            label(entry['name']); label(entry[fields[0]])
            integer(entry['x'], 0, 59); integer(entry['y'], 0, 59); integer(entry['sprite'], 0, MAX_SPRITE_ID)
            if entry['team'] not in ('crew', 'hostile') or type(entry['hidden']) is not bool or entry['team'] == 'crew' and entry['hidden']:
                fail('Проверь команду и видимость фигуры в шаблоне.')
            if key == 'characters':
                if entry['characterKey'] in seen:
                    fail('Повтор идентификатора листа в шаблоне.')
                seen.add(entry['characterKey'])
            elif entry['templateId'] not in {t['id'] for t in NPC_TEMPLATES}:
                fail('Неизвестный шаблон НПС в файле.')
    return document, warnings


def manual_wear(scene):
    return [actor for actor in (scene or {}).get('actors', []) if actor.get('wearPending')]


def acknowledge_manual_wear(old_scene, replacement, acknowledged, require=True):
    pending = manual_wear(old_scene)
    if type(acknowledged) is not bool:
        fail('Проверь подтверждение ручного переноса SP.')
    if pending and not acknowledged and require:
        fail('Есть неперенесённый износ SP. Сначала проверь зоны и явно подтверди ручной разбор перед заменой сцены.', 409)
    if not pending or not acknowledged:
        return
    for actor in pending:
        add_event(replacement, dict(kind='manual-armor-ack', actorIds=[actor['id']],
                  text=actor['name'] + ': ГМ подтвердил ручной разбор износа SP; это не автоматическое изменение слоёв.',
                  armorWearPending=copy.deepcopy(actor['wearPending'])))


def import_blueprint(db, campaign, scene, raw):
    if scene.get('unresolvedFumbles'):fail('Сначала разбери критическую ошибку; импорт её не стирает.',409)
    if scene['phase'] not in ('preparation', 'ended'):
        fail('Импорт доступен только до или после боя.', 409)
    document, warnings = normalize_blueprint(raw)
    replacement = prepare(db, campaign, dict(id='validate-blueprint', expectedVersion=scene['version'], type='prepare', actors=[],
                         **{k: document[k] for k in ('name', 'width', 'height', 'tileMeters', 'tiles', 'props', 'devices', 'settings')}), scene['version'])
    replacement.update(id=scene['id'], blueprintRevision=1)
    real = [a for a in scene['actors'] if sheet_actor(a)]
    if len(real) + len(document['npcs']) > 20:
        fail('Живые листы и импортируемые НПС вместе превышают 20 участников.')
    by_key = {character_key(db, a): a for a in real if character_key(db, a)}
    placements = {p['characterKey']: p for p in document['characters']}
    for key, placement in placements.items():
        if key not in by_key:
            warnings.append(placement['name'] + ': сопоставленного текущего участника нет; ссылка не добавляет и не изменяет лист.')
    for original in real:
        check_sheet(db, campaign, original)
        actor = copy.deepcopy(original)
        placement = placements.get(character_key(db, original))
        if placement:
            for key in ('x', 'y', 'team', 'hidden', 'sprite'):
                actor[key] = placement[key]
            if 'heading' in placement: set_heading(actor, placement['heading'])
        if not valid_placement(replacement, actor):
            actor['x'], actor['y'] = first_free(replacement, actor['x'], actor['y'])
            warnings.append(actor['name'] + ': позиция перенесена на свободную клетку ' + str(actor['x']) + ', ' + str(actor['y']) + '.')
        actor.update(actions=0, shots=0, moved=False, initiative=0)
        if actor.get('net'):
            actor['net'].update(linkedPortId=None, knownDeviceIds=[], controlUsed=False)
        # Pending manual wear is acknowledged separately before replacement.
        actor.pop('wearPending', None)
        replacement['actors'].append(actor)
    for entry in document['npcs']:
        config = copy.deepcopy(entry)
        if not walkable(replacement, config['x'], config['y']):
            config['x'], config['y'] = first_free(replacement, config['x'], config['y'])
            warnings.append(config['name'] + ': НПС перенесён на свободную клетку ' + str(config['x']) + ', ' + str(config['y']) + '.')
        actor = make_npc(campaign, replacement, config)
        replacement['actors'].append(actor)
    warnings.append('Все текущие реальные участники и их ресурсы сохранены; НПС созданы заново по фиксированным шаблонам.')
    warnings.append('Износ SP в новой подготовке: ' + ('включён.' if replacement['settings']['stagedPenetration'] else 'выключен.'))
    if manual_wear(scene):
        warnings.append('Есть неперенесённый износ SP: перед заменой требуется отдельное подтверждение ручного разбора.')
    summary = dict(name=replacement['name'], width=replacement['width'], height=replacement['height'],
                   actorCount=len(replacement['actors']), npcCount=len(document['npcs']), deviceCount=len(replacement['devices']), characterCount=len(real))
    return replacement, summary, warnings


def project_event(event, visible, owned, gm, observer_id=None, private=False):
    if event.get('kind')=='armor-wear' and not gm and (not event.get('actorIds') or event['actorIds'][0] not in owned):return None
    if private and (event.get('kind')=='visibility' or not observer_id or observer_id not in event.get('_seenBy', [])):
        return None
    if not gm and not private and any(aid not in visible for aid in event.get('actorIds', [])):
        return None
    if gm:
        return {k:copy.deepcopy(v) for k,v in event.items() if k not in ('_seenBy','_spatialSeenBy','_propSeenBy')}
    allowed = ['visualOnly','effectSuppressed','heading', 'fromHeading', 'id', 'round', 'text', 'actorIds', 'kind', 'from', 'to', 'path', 'hit', 'damage', 'location', 'targetStatus', 'deathCause', 'success', 'operation', 'deviceType']
    own = bool(event.get('actorIds')) and event['actorIds'][0] in owned
    if own:
        allowed += ['mode','rounds','hits','remainingTurns','technique','attackTotal','defenseTotal','requiresGmResolution','turnToTarget', 'turnPenalty', 'roll', 'bonus', 'total', 'base', 'difficulty', 'rawDamage', 'damageRolls', 'pointBlank', 'strength', 'program', 'at', 'count']
    if len(event.get('actorIds', [])) > 1 and event['actorIds'][1] in owned:
        allowed += ['armorWear']
    if event.get('kind')=='armor-wear' and own:allowed+=['armorWear']
    if event.get('kind')=='flip' and observer_id in event.get('_propSeenBy',[]):allowed+=['propId']
    if event.get('kind') == 'manual-armor-ack' and own:
        allowed += ['armorWearPending']
    result = {k: copy.deepcopy(v) for k, v in event.items() if k in allowed}
    if private and observer_id not in event.get('_spatialSeenBy',[]):
        for key in ('from','to','at','path'): result.pop(key,None)
    if not own:
        result['text'] = {'flip':'Наблюдаемое опрокидывание стола.','face':'Наблюдаемый поворот.','move':'Наблюдаемое перемещение.','switch':'Наблюдаемая смена оружия.','melee':'Наблюдаемая рукопашная атака.','reload':'Наблюдаемая перезарядка.','shoot':'Наблюдаемый выстрел.','end':'Участник завершает ход.','door':'Дверь изменила состояние.'}.get(event.get('kind'), result.get('text','Событие боя.'))
    if event.get('kind')=='adjudication':result['text']='ГМ разобрал критическую ошибку; подтверждённые последствия сохранены.'
    if event.get('kind') == 'control' and not own:
        result['text'] = 'Контроль устройства: ' + ('команда выполнена.' if event.get('success') else 'управление не удалось.')
    if event.get('kind') == 'scan' and not own:
        result['text'] = 'Нетраннер выполнил поиск устройств.'
    return result


def owned_ids(db, user, campaign, gm, scene):
    accepted = {r[0] for r in db.execute("SELECT cc.character_id FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id WHERE cc.campaign_id=? AND cc.status IN ('active','reserve') AND c.owner_id=?", (campaign['id'], user['id']))}
    return {a['id'] for a in scene['actors'] if a['ownerId'] == user['id'] and (gm or a['characterId'] in accepted)}


VISION_NOTE = ('Личный обзор: передняя полуплоскость 180° от плеч выбранного персонажа, до стен, закрытых дверей и предметов, которым ГМ назначил непрозрачность; открытая дверь пропускает взгляд. '
               'Восемь направлений и граница обзора — соглашения сетки. '
               'Обзор союзников не объединяется, память исследованной карты не ведётся. Дальность зрения, освещение и проверки скрытности CP2020 здесь не моделируются; скрытие ГМа сохраняется.')


def observer_visibility(scene, observer):
    cells = battle_vision.actor_visible_cells(scene, observer) if observer and observer.get('status') == 'active' else frozenset()
    visible = {a['id'] for a in scene['actors'] if observer and (a['id'] == observer['id'] or not a['hidden'] and (a['x'], a['y']) in cells)}
    return cells, visible


def vision_context(db, user, campaign, scene, viewer_actor_id=None):
    owned = owned_ids(db, user, campaign, False, scene)
    choices = [a for a in scene['actors'] if a['id'] in owned]
    if viewer_actor_id is not None and (type(viewer_actor_id) is not str or viewer_actor_id not in owned):
        fail('Этот обзор недоступен твоему аккаунту.', 403)
    observer = next((a for a in choices if a['id'] == viewer_actor_id), None) if viewer_actor_id is not None else next(iter(choices), None)
    cells, visible = observer_visibility(scene, observer)
    return observer, cells, visible, choices


def event_cells(event):
    points = [event[k] for k in ('from', 'to', 'at') if isinstance(event.get(k), dict)] + event.get('path', [])
    return {(p['x'], p['y']) for p in points if isinstance(p, dict) and type(p.get('x')) is int and type(p.get('y')) is int}


def stamp_event_audiences(scene, before, old_ids):
    # Historical visibility is fixed at the event, never recomputed from who is
    # visible later. Existing un-stamped logs remain GM-only after the update.
    observers = [a for a in scene['actors'] if a.get('ownerId') is not None]
    for event in scene['log']:
        if event['id'] in old_ids or '_seenBy' in event or not event['id'].startswith('event-' + str(scene['version'] + 1) + '-'):
            continue
        seen,spatial,prop_seen = [],[],[]
        for observer in observers:
            cells, visible = observer_visibility(scene, observer)
            prior = next((a for a in (before or {}).get('actors', []) if a['id'] == observer['id']), None)
            if prior:
                old_cells, old_visible = observer_visibility(before, prior)
                cells, visible = cells | old_cells, visible | old_visible
            if event_cells(event) <= cells: spatial.append(observer['id'])
            if event.get('kind')=='flip':
                rectangles=[event.get(key) for key in ('before','after')]
                if all(isinstance(rect,dict) and all((x,y) in cells for y in range(rect['y'],rect['y']+rect['h']) for x in range(rect['x'],rect['x']+rect['w'])) for rect in rectangles):prop_seen.append(observer['id'])
            ids = event.get('actorIds', [])
            own = bool(ids) and ids[0] == observer['id']
            public = event.get('kind') in ('start', 'round', 'pause', 'resume', 'finish', 'prepare', 'import', 'undo')
            if (own and set(ids) <= visible) or (ids and set(ids) <= visible and event_cells(event) <= cells) or (not ids and public):
                seen.append(observer['id'])
        event['_seenBy'] = seen
        event['_spatialSeenBy'] = spatial
        if event.get('kind')=='flip':event['_propSeenBy']=prop_seen


def player_preview(scene, action, result, cells):
    out = copy.deepcopy(result)
    out.pop('protectionReview',None)
    if action['type'] == 'move' and any((p['x'], p['y']) not in cells for p in out.get('path', [])):
        fail('Маршрут выходит за личный обзор. Подойди к границе видимости коротким перемещением.')
    cover=out.get('line',{}).get('cover')
    if isinstance(cover,dict) and (cover.get('x'),cover.get('y')) not in cells: out['line']['cover']=True
    for line in out.get('lines',[]):
        cover=line.get('cover')
        if isinstance(cover,dict) and (cover.get('x'),cover.get('y')) not in cells:line['cover']=True
    if isinstance(out.get('device'), dict) and (out['device'].get('x'), out['device'].get('y')) not in cells:
        out['device'] = {k:v for k,v in out['device'].items() if k not in ('x', 'y')}
    return out


def projection(db, user, campaign, gm, scene, training=False, viewer_actor_id=None):
    options = []
    if gm and not training:
        rows = db.execute("SELECT DISTINCT c.* FROM characters c LEFT JOIN campaign_characters cc ON cc.character_id=c.id AND cc.campaign_id=? AND cc.status IN ('active','reserve') WHERE c.owner_id=? OR cc.character_id IS NOT NULL ORDER BY c.id", (campaign['id'], user['id']))
        options = [dict(id=r['id'], name=json.loads(r['data'])['name'], owner_id=r['owner_id'], version=r['version'], data=json.loads(r['data']), supportedArmor=True) for r in rows]
    out = dict(role='gm' if gm else 'player', controlledActorIds=[], battle=None, options={'characters': options, **({'npcTemplates': copy.deepcopy(NPC_TEMPLATES)} if gm else {})},
               rulesNote=TRAINING_NOTE if training else RULES_NOTE)
    if training:
        out.update(training=True, demoCompatible=bool(scene and (scene.get('blueprintRevision') == 1 or scene.get('demoRevision') == 3 and {'ray', 'mira', 'guard-1', 'guard-2'} <= {a['id'] for a in scene['actors']})))
    if not scene:
        if not gm and viewer_actor_id is not None: fail('Этот обзор недоступен твоему аккаунту.',403)
        out.update(viewerActorId=None,viewerActors=[])
        return out
    observer,cells,visible,choices = (None,frozenset(),{a['id'] for a in scene['actors']},[]) if gm else vision_context(db,user,campaign,scene,viewer_actor_id)
    owned = owned_ids(db,user,campaign,gm,scene) if gm else {observer['id']} if observer else set()
    out['controlledActorIds'] = [a['id'] for a in scene['actors'] if a['id'] in owned]
    out.update(viewerActorId=observer['id'] if observer else None,viewerActors=[dict(id=a['id'],name=a['name']) for a in choices])
    if gm:
        out['options']['sceneLoadouts']=[dict(actorId=a['id'],data=scene_actor_inventory(a)) for a in scene['actors'] if a['characterId'] is None or a['characterId']<0]
    if not gm: out['rulesNote'] = VISION_NOTE + ' ' + out['rulesNote']
    # Internal undo contains original sheets and hidden actors. It never crosses
    # the transport boundary, including GM replies, receipts or previews.
    if not training and not scene.get('settings', {}).get('stagedPenetration'):
        out['rulesNote'] = ('В этой сохранённой сцене износ SP выключен. ' + (VISION_NOTE + ' ' if not gm else '') + RULES_NOTE)
    view = {k: copy.deepcopy(v) for k, v in scene.items() if k not in ('pending', '_undo', 'appliedCommandIds', 'unresolvedFumbles')}
    if not gm:
        view['tiles']=[[copy.deepcopy(t) if (x,y) in cells else {'type':'unknown'} for x,t in enumerate(row)] for y,row in enumerate(scene['tiles'])]
        for row in view['tiles']:
            for tile in row:tile.pop('protection',None)
        view['props'],edges=[],[]
        for prop in scene['props']:
            footprint={(x,y) for y in range(prop['y'],prop['y']+prop['h']) for x in range(prop['x'],prop['x']+prop['w'])}
            if footprint <= cells:
                public=copy.deepcopy(prop)
                if 'protection' in public:public['protection']={k:v for k,v in public['protection'].items() if k not in ('sp','material')}
                view['props'].append(public)
            else: edges.extend(dict(x=x,y=y,cover=bool(prop.get('cover'))) for x,y in sorted(footprint & cells))
        # A partially visible object exposes only occupied visible cells, not
        # its offscreen origin, name, type or complete dimensions.
        view['vision']=dict(actorId=observer['id'] if observer else None,cells=[list(cell) for cell in sorted(cells)],obstacles=edges,model='los180',heading=battle_vision.actor_heading(observer))
    view['awaitingGmResolution']=bool(scene.get('unresolvedFumbles'))
    if gm: view['unresolvedFumbles']=copy.deepcopy(scene.get('unresolvedFumbles',[]))
    view['actors'] = []
    for actor in scene['actors']:
        if actor['id'] not in visible:
            continue
        if gm or actor['id'] in owned:
            record = {k: copy.deepcopy(v) for k, v in actor.items() if k != 'ownerId'}
        else:
            record = {k: actor[k] for k in ['id', 'characterId', 'name', 'team', 'sprite', 'x', 'y', 'hidden', 'facing', 'status']}
        record['heading'] = battle_vision.actor_heading(actor)
        view['actors'].append(record)
    known = {did for a in scene['actors'] if a['id'] in owned for did in a.get('net', {}).get('knownDeviceIds', [])}
    view['devices'] = []
    for d in scene.get('devices', []):
        if gm or (d['x'],d['y']) in cells and (d['type']=='port' or d['id'] in known):
            view['devices'].append(copy.deepcopy(d))
        elif d['id'] in known:
            view['devices'].append(dict(id=d['id'],name=d['name'],type=d['type'],remoteOnly=True))
    current = scene['order'][scene['index']] if scene['order'] else None
    view['order'] = [aid for aid in scene['order'] if aid in visible]
    view['index'] = view['order'].index(current) if current in view['order'] else -1
    view['currentActorId'] = current if current in visible else None
    view['gmTurn'] = bool(current and current not in visible and scene['phase'] in ('combat', 'paused'))
    view['log'] = [record for event in scene['log'] if (record := project_event(event, visible, owned, gm, observer['id'] if observer else None, private=not gm)) is not None]
    pending = []
    for declaration in scene.get('pending', []):
        action = declaration.get('action') or dict(type='shoot',actorId=declaration['actorId'],targetId=declaration.get('targetId'),location=declaration.get('location','random'))
        if not gm:
            if declaration['actorId'] not in owned or action.get('targetId') and action['targetId'] not in visible or any(aid not in visible for aid in action.get('targetIds',[])):
                continue
            if action['type'] in ('move','interact') and (action.get('x'),action.get('y')) not in cells:
                continue
            if not event_cells(declaration.get('preview',{})) <= cells:
                continue
        record={k:copy.deepcopy(v) for k,v in declaration.items() if k != 'declaredBy'}
        if not gm and record.get('preview'):
            record['preview']=player_preview(scene,action,record['preview'],cells)
        pending.append(record)
    out['battle'] = dict(id=scene['id'], version=scene['version'], phase=scene['phase'], scene=view,
                         pending=pending, log=view['log'], canUndo=bool(gm and scene.get('_undo') and not scene.get('pending')))
    return out


def active_battles(db, user):
    """Lightweight in-app invitations: no training, hidden metadata or outsiders."""
    db.execute('BEGIN')
    accepted = {}
    rows = db.execute("SELECT cc.campaign_id, cc.character_id FROM campaign_characters cc JOIN characters c ON c.id=cc.character_id JOIN campaign_members cm ON cm.campaign_id=cc.campaign_id AND cm.user_id=c.owner_id WHERE c.owner_id=? AND cc.status IN ('active','reserve')", (user['id'],))
    for row in rows:
        accepted.setdefault(row[0], set()).add(row[1])
    invitations = []
    # A single caller may have many old campaigns; the query never reads unrelated
    # scenes, and only active/paused summaries leave this process.
    for cid, cids in accepted.items():
        row = db.execute('SELECT b.data,c.name FROM shared_battles b JOIN campaigns c ON c.id=b.campaign_id WHERE b.campaign_id=?', (cid,)).fetchone()
        if not row:
            continue
        scene = json.loads(row[0])
        actor_ids = [a['id'] for a in scene['actors'] if a['characterId'] in cids and a['ownerId'] == user['id']]
        if scene['phase'] in ('combat', 'paused') and actor_ids:
            invitations.append(dict(campaignId=cid, campaignName=row[1], battleId=scene['id'], battleName=scene['name'],
                                    version=scene['version'], phase=scene['phase'], actorIds=actor_ids))
    return dict(battles=sorted(invitations, key=lambda b: b['campaignId']))


def authorize_action(db, user, campaign, gm, scene, command, training=False, viewer_actor_id=None):
    if command['type']=='prepare-training-loadouts' and not training:fail('Общая учебная подготовка доступна только в изолированной тренировке.',403)
    if command['type']=='shoot':fail('Прежний одиночный алгоритм закрыт для новых атак. ГМ должен подтвердить набор оружия и использовать огневое действие по 2020.',409)
    if not gm and 'gmFire' in command:
        fail('Соглашения огневого действия и разворот подтверждает ведущий.',403)
    if not gm and command['type']=='fire':
        if any(aid not in vision_context(db,user,campaign,scene,viewer_actor_id)[2] for aid in command['targetIds']):fail('Цель недоступна.')
    if not gm and 'gmMelee' in command:
        fail('Защиту и модификаторы рукопашной подтверждает ведущий.',403)
    if not gm and 'turnToTarget' in command:
        fail('Модификатор атаки с разворотом назначает ведущий.', 403)
    if command['type'] in GM_FIELDS and not gm:
        fail('Это действие доступно только ведущему кампании.', 403)
    observer,cells,visible,_ = vision_context(db,user,campaign,scene,viewer_actor_id) if not gm else (None,frozenset(),set(),[])
    owned = {observer['id']} if observer else set()
    if not gm and not observer: fail('Для этого обзора нужен свой принятый персонаж в сцене.',403)
    if not gm and command['type'] in ('move','interact') and (command.get('x'),command.get('y')) not in cells:
        fail('Клетка находится за пределами личного обзора.')
    if not gm and command['type']=='flip':
        prop=next((p for p in scene['props'] if p['id']==command['propId']),None)
        if prop is None or not {(x,y) for y in range(prop['y'],prop['y']+prop['h']) for x in range(prop['x'],prop['x']+prop['w'])}<=cells:fail('Предмет недоступен.')
    if not gm and 'deviceId' in command:
        known=set(observer.get('net',{}).get('knownDeviceIds',[]))
        if not any(d['id']==command['deviceId'] and ((d['x'],d['y']) in cells if command['type']=='connect' else d['id'] in known) for d in scene.get('devices',[])):
            fail('Устройство недоступно.')
    if 'actorId' in command:
        if not gm and command['actorId'] not in owned:
            fail('Ты управляешь только своим принятым персонажем.', 403)
        find_actor(scene, command['actorId'])
    if not gm and 'targetId' in command and command['targetId'] not in visible:
        fail('Цель недоступна.')
    if not gm and command['type']=='move':
        route=find_path(scene,observer,command['x'],command['y'])
        if route and any((p['x'],p['y']) not in cells for p in route['path']):
            fail('Маршрут выходит за личный обзор. Подойди к границе видимости коротким перемещением.')
        # Do not disclose detours caused by an actor the observer cannot see.
        known_scene=dict(scene,actors=[a for a in scene['actors'] if a['id'] in visible])
        known_route=find_path(known_scene,observer,command['x'],command['y'])
        if route!=known_route: fail('Маршрут сейчас недоступен.')
    if not training and command['type'] != 'finish':
        if command['type'] == 'start':
            participants = scene['actors']
        elif command['type']=='resolve-fumble':
            participants=[find_actor(scene,e['actorId']) for e in command['effects']]
        elif command['type']=='fire':
            participants=[find_actor(scene,aid) for aid in [command['actorId']]+command['targetIds']]
        else:
            participants = [find_actor(scene, command[key]) for key in ('actorId', 'targetId') if key in command]
        for actor in participants:
            # Reject hidden references before their revision could become an oracle.
            if not gm and actor['hidden'] and actor['id'] not in owned_ids(db, user, campaign, gm, scene):
                fail('Цель недоступна.')
            row = check_sheet(db, campaign, actor)
            if row is not None and actor.get('loadout') is not None:
                loadout_call(battle_loadout.validate_binding, actor['loadout'], json.loads(row['data']), row['version'])


def capture_undo(scene):
    previous = {k: copy.deepcopy(v) for k, v in scene.items() if k != '_undo'}
    # A resolved intent is not requeued by undo. The player may submit a new one.
    previous['pending'] = []
    return dict(scene=previous, sheets=[])


def capture_action_sheets(db, campaign, scene, actor_ids):
    return [dict(id=row['id'], ownerId=row['owner_id'], beforeData=row['data'], beforeVersion=row['version'])
            for aid in dict.fromkeys(actor_ids)
            for row in [check_sheet(db, campaign, find_actor(scene, aid))] if row is not None]


def capture_shot_sheets(db, campaign, scene, command):
    return capture_action_sheets(db, campaign, scene, (command['actorId'], command['targetId']))


def restore_undo(db, campaign, scene, user_id, now, training):
    undo = scene.get('_undo')
    if not undo or scene.get('pending'):
        fail('Нет доступного последнего действия для отмены.', 409)
    if not training:
        for actor in scene['actors']:
            check_sheet(db, campaign, actor)
    restored = copy.deepcopy(undo['scene'])
    restored['version'] = scene['version']
    for saved in undo['sheets']:
        row = eligible(db, campaign, saved['id'])
        if row['version'] != saved['afterVersion'] or row['owner_id'] != saved['ownerId']:
            fail('Лист изменился после действия. Отмена не перезапишет изменения.', 409)
        version = row['version'] + 1
        changed = db.execute('UPDATE characters SET data=?,version=?,updated=? WHERE id=? AND version=?',
                             (saved['beforeData'], version, now, row['id'], row['version']))
        if changed.rowcount != 1:
            fail('Лист изменился одновременно с отменой.', 409)
        db.execute('INSERT INTO revisions(character_id,actor_id,data,version,reason,created) VALUES(?,?,?,?,?,?)',
                   (row['id'], user_id, saved['beforeData'], version, 'Бой ' + scene['id'] + ': отмена последнего действия (новая ревизия)', now))
        for actor in restored['actors']:
            if actor['characterId'] == row['id']:
                actor['sheetVersion'] = version
                if actor.get('loadout') is not None:
                    actor['loadout'] = loadout_call(battle_loadout.rebind, actor['loadout'], json.loads(saved['beforeData']), version); sync_weapon(actor)
    # Unchanged sheets retain their live revision, never a client's revision.
    versions = {a['id']: a['sheetVersion'] for a in scene['actors']}
    changed_ids = {s['id'] for s in undo['sheets']}
    for actor in restored['actors']:
        if actor['characterId'] not in changed_ids and actor['id'] in versions:
            actor['sheetVersion'] = versions[actor['id']]
    restored.pop('_undo', None)
    event = add_event(restored, dict(kind='undo', actorIds=[], text='ГМ отменил последнее действие. Создана новая версия.'))
    return restored, event


def prepared_addition(db, campaign, scene, config):
    if not config:
        fail('Для нового участника укажи актуальный лист и подтверждённые параметры.')
    temporary = prepare(db, campaign, dict(id='add-validation', expectedVersion=scene['version'], type='prepare',
                        name=scene['name'], width=scene['width'], height=scene['height'], tileMeters=scene['tileMeters'],
                        tiles=scene['tiles'], props=scene['props'], actors=[config]), scene['version'])
    actor = temporary['actors'][0]
    if any(a['characterId'] == actor['characterId'] for a in scene['actors']):
        fail('Один лист нельзя добавить в бой дважды.')
    if not walkable(scene, actor['x'], actor['y']):
        fail('Стартовая клетка занята или непроходима.')
    return actor


def api(handler, db, user, cid, method, payload, commands=False, rng=None, training=False, preview=False, viewer_actor_id=None):
    rng = rng or secrets.SystemRandom().random
    if method not in ('GET', 'POST') or ((commands or preview) and method != 'POST'):
        fail('Команда не поддерживается.', 405)
    db.execute('BEGIN IMMEDIATE' if method == 'POST' and not preview else 'BEGIN')
    campaign, gm = role_context(db, user, cid)
    if training and not gm:
        fail('Учебный бой доступен только ведущему этой кампании.', 403)
    battle_table = 'training_battles' if training else 'shared_battles'
    command_table = 'training_battle_commands' if training else 'shared_battle_commands'
    row = db.execute('SELECT * FROM ' + battle_table + ' WHERE campaign_id=?', (cid,)).fetchone()
    scene = json.loads(row['data']) if row else None
    if scene:
        for actor in scene['actors']:
            if 'heading' not in actor: actor['heading'] = battle_vision.actor_heading(actor)
            if actor.get('loadout') is not None: sync_weapon(actor)
            if 'meleeSkills' not in actor and sheet_actor(actor):
                sheet=db.execute('SELECT data,version FROM characters WHERE id=?',(actor['characterId'],)).fetchone()
                if sheet and sheet['version']==actor['sheetVersion']:actor['meleeSkills']=melee_skills_from_sheet(json.loads(sheet['data']))
    before_vision={k:copy.deepcopy(scene[k]) for k in ('width','height','tiles','props','actors')} if scene and method=='POST' and not preview else None
    old_event_ids={e['id'] for e in scene.get('log',[])} if scene else set()
    if not gm and scene: vision_context(db,user,campaign,scene,viewer_actor_id)
    if method == 'GET':
        return projection(db, user, campaign, gm, scene, training, viewer_actor_id)
    if preview:
        exact(payload, ['battleId', 'expectedVersion', 'command'])
        integer(payload['expectedVersion'], 0, 10**12, 'версию боя')
        if not scene or payload['battleId'] != scene['id'] or payload['expectedVersion'] != scene['version']:
            fail('Бой изменился. Обнови состояние и выбери действие снова.', 409)
        if isinstance(payload['command'], dict) and payload['command'].get('type') == 'export-scene':
            exact(payload['command'], ['type'])
            if not gm:
                fail('Экспорт подготовки доступен только ведущему.', 403)
            document, warnings = export_blueprint(db, scene)
            return dict(battleId=scene['id'], version=scene['version'], preview=dict(ok=True, document=document, warnings=warnings))
        action = validate_action(payload['command'])
        authorize_action(db, user, campaign, gm, scene, action, training, viewer_actor_id)
        if action['type'] == 'import-scene':
            _, summary, warnings = import_blueprint(db, campaign, scene, action['document'])
            return dict(battleId=scene['id'], version=scene['version'], preview=dict(ok=True, summary=summary, warnings=warnings, requiresManualWearAcknowledgement=bool(manual_wear(scene))))
        if action['type'] == 'add' and 'templateId' in action:
            preview_action(scene, action, gm)
            npc = make_npc(campaign, scene, action)
            return dict(battleId=scene['id'], version=scene['version'], preview=dict(ok=True, text='Добавить НПС: ' + npc['name'], to=dict(x=npc['x'], y=npc['y']), summary=dict(name=npc['name'], templateId=action['templateId'], sprite=npc['sprite'])))
        try:
            result = preview_action(scene, action, gm)
            if not gm: result=player_preview(scene,action,result,vision_context(db,user,campaign,scene,viewer_actor_id)[1])
        except BattleError as error:
            result = dict(ok=False, error=error.message)
        return dict(battleId=scene['id'], version=scene['version'], preview=result)
    if not isinstance(payload, dict):
        fail('Проверь поля команды боя.')
    command_id = label(payload.get('id'))
    integer(payload.get('expectedVersion'), 0, 10**12, 'версию боя')
    kind = payload.get('type')
    if not isinstance(kind, str):
        fail('Укажи тип команды.')
    setup_commands = ('training-start', 'training-reset') if training else ('prepare',)
    if (commands and kind in setup_commands) or (not commands and kind not in setup_commands):
        fail('Команда отправлена не по тому адресу.')
    request_hash = hashlib.sha256(encoded({k: v for k, v in payload.items() if k != 'expectedVersion'}).encode()).hexdigest()
    prior = db.execute('SELECT * FROM ' + command_table + ' WHERE campaign_id=? AND command_id=?', (cid, command_id)).fetchone()
    if prior:
        if prior['user_id'] != user['id'] or prior['request_hash'] != request_hash:
            fail('Этот ID команды уже использован с другими данными.', 409)
        out = projection(db, user, campaign, gm, scene, training, viewer_actor_id)
        receipt = json.loads(prior['result'])
        if 'event' in receipt and out['battle']:
            receipt['event'] = project_event(receipt['event'], {a['id'] for a in out['battle']['scene']['actors']}, set(out['controlledActorIds']), gm, out.get('viewerActorId'), private=not gm)
        out.update(duplicate=True, receipt=receipt)
        return out
    version = row['version'] if row else 0
    if payload['expectedVersion'] != version:
        fail('Бой изменился. Обнови состояние и повтори действие.', 409)
    if kind not in ('declare-shot', 'declare') and not gm:
        fail('Это действие доступно только ведущему кампании.', 403)
    now, advance, event = int(time.time()), True, None
    if training and kind in setup_commands:
        exact(payload, ['id', 'expectedVersion', 'type'])
        if kind == 'training-start' and scene:
            advance = False
        else:
            scene, event = training_scene(campaign, version, rng)
    elif kind == 'prepare' and not training:
        if scene and scene['phase'] not in ('preparation', 'ended'):
            fail('Сначала заверши текущий бой.', 409)
        previous = scene
        replacement = prepare(db, campaign, payload, version, previous)
        preserve = payload.get('preserveNpcIds', [a['id'] for a in (previous or {}).get('actors', []) if a.get('origin', {}).get('kind') == 'npc'])
        if not isinstance(preserve, list) or len(preserve) > 20 or any(not isinstance(aid, str) for aid in preserve) or len(set(preserve)) != len(preserve):
            fail('Проверь список сохраняемых НПС.')
        for aid in preserve:
            npc = next((a for a in (previous or {}).get('actors', []) if a['id'] == aid and a.get('origin', {}).get('kind') == 'npc'), None)
            if not npc:
                fail('Сохраняемый НПС больше не находится в этой сцене.', 409)
            if not valid_placement(replacement, npc):
                fail(npc['name'] + ': сохранённая позиция занята на новой карте. Сначала перемести НПС либо явно убери его из подготовки.')
            replacement['actors'].append(copy.deepcopy(npc))
        if len(replacement['actors']) > 20:
            fail('В сцене вместе с НПС может быть не больше 20 участников.')
        acknowledge_manual_wear(previous, replacement, payload.get('acknowledgeManualWear', False))
        scene = replacement
        event = add_event(scene, dict(kind='prepare', actorIds=[], text='ГМ подготовил общий бой.'))
    else:
        if not scene or payload.get('battleId') != scene['id']:
            fail('Этот бой больше не активен.', 409)
        required = ['id', 'battleId', 'expectedVersion', 'type']
        if kind == 'undo':
            exact(payload, required)
            scene, event = restore_undo(db, campaign, scene, user['id'], now, training)
        elif kind in ('declare', 'declare-shot'):
            if kind == 'declare':
                exact(payload, required + ['action'])
                action = validate_action(payload['action'])
                if action['type'] not in ACTOR_FIELDS:
                    fail('Игрок может объявить только действие персонажа.', 403)
            else:
                exact(payload, required + ['actorId', 'targetId', 'location'])
                action = validate_action(dict(type='shoot', actorId=payload['actorId'], targetId=payload['targetId'], location=payload['location']))
            authorize_action(db, user, campaign, gm, scene, action, training, viewer_actor_id)
            if scene.get('pending'):
                fail('ГМ ещё не разобрал предыдущую заявку.', 409)
            result = preview_action(scene, action, gm)
            if not gm: result=player_preview(scene,action,result,vision_context(db,user,campaign,scene,viewer_actor_id)[1])
            declaration = dict(id=command_id, actorId=action['actorId'], action=copy.deepcopy(action),
                               status='pending', declaredBy=user['id'], preview=result)
            if action['type'] == 'shoot':
                declaration.update(targetId=action['targetId'], location=action.get('location', 'random'))
            scene['pending'].append(declaration)
            scene.pop('_undo', None)
        elif kind == 'reject':
            exact(payload, required + ['declarationId'])
            declaration = next((d for d in scene['pending'] if d['id'] == payload['declarationId']), None)
            if not declaration:
                fail('Заявка уже разобрана или не найдена.', 409)
            scene['pending'].remove(declaration)
            scene.pop('_undo', None)
            event = add_event(scene, dict(kind='reject', actorIds=[declaration['actorId']], text='ГМ отклонил заявку.'))
        else:
            declaration = None
            if kind == 'confirm':
                exact(payload, required + ['declarationId'], ['turnToTarget','gmMelee','gmFire'])
                declaration = next((d for d in scene['pending'] if d['id'] == payload['declarationId']), None)
                if not declaration:
                    fail('Заявка уже разобрана или не найдена.', 409)
                action = copy.deepcopy(declaration.get('action') or dict(type='shoot', actorId=declaration['actorId'], targetId=declaration['targetId'], location=declaration['location']))
                if action['type']=='fire':
                    action['gmFire']=payload.get('gmFire');validate_action(action)
                elif 'gmFire' in payload:fail('Решение по стрельбе относится только к огневому действию.')
                if action['type'] == 'melee':
                    action['gmMelee']=validate_melee_ruling(payload.get('gmMelee'))
                elif 'gmMelee' in payload:
                    fail('Решение по рукопашной относится только к рукопашной атаке.')
                if action['type'] == 'shoot':
                    if type(payload.get('turnToTarget')) is not bool:
                        fail('Перед выстрелом ГМ должен явно выбрать: без разворота или атака с разворотом −2.')
                    action['turnToTarget'] = payload['turnToTarget']
                elif 'turnToTarget' in payload:
                    fail('Модификатор разворота допускается только для выстрела.')
            else:
                action = validate_action({k: v for k, v in payload.items() if k not in ('id', 'battleId', 'expectedVersion')})
                exact(payload, required + list(ACTOR_FIELDS.get(kind, GM_FIELDS.get(kind, []))),
                      ['gmFire','location','coverMode'] if kind=='fire' else ['gmMelee'] if kind == 'melee' else ['location', 'turnToTarget'] if kind == 'shoot' else ['config', 'templateId', 'name', 'x', 'y', 'hidden', 'sprite', 'heading'] if kind == 'add' else ['acknowledgeManualWear'] if kind == 'import-scene' else ['orientation', 'facing'] if kind == 'paint' else [])
                if scene['pending'] and action['type']!='rules':
                    fail('Сначала подтверди или отклони ожидающую заявку.', 409)
            if declaration and declaration.get('declaredBy') != user['id']:
                declarer=db.execute('SELECT * FROM users WHERE id=?',(declaration['declaredBy'],)).fetchone()
                if not declarer: fail('Автор заявки больше недоступен.',403)
                _,declarer_gm=role_context(db,declarer,cid)
                authorize_action(db,declarer,campaign,declarer_gm,scene,{k:v for k,v in action.items() if k not in ('turnToTarget','gmMelee','gmFire')},training,action['actorId'])
            authorize_action(db, user, campaign, gm, scene, action, training, viewer_actor_id)
            if action['type']=='melee' and 'gmMelee' not in action:
                fail('Перед броском ГМ должен подтвердить защиту и параметры рукопашной.')
            if action['type'] == 'shoot' and type(action.get('turnToTarget')) is not bool:
                fail('Перед выстрелом ГМ должен явно выбрать: без разворота или атака с разворотом −2.')
            undo = capture_undo(scene)
            before_sheets = capture_shot_sheets(db, campaign, scene, action) if action['type'] in ('shoot','melee') and not training else []
            if action['type']=='fire' and not training:
                before_sheets=capture_action_sheets(db,campaign,scene,[action['actorId']]+action['targetIds'])
            if action['type']=='resolve-fumble' and not training:
                before_sheets=capture_action_sheets(db,campaign,scene,[e['actorId'] for e in action['effects']])
            added_actor = None
            if action['type'] == 'add':
                if 'templateId' in action:
                    added_actor = make_npc(campaign, scene, action)
                elif not training:
                    added_actor = prepared_addition(db, campaign, scene, action.get('config'))
            if action['type'] == 'import-scene':
                previous = scene
                scene, _, _ = import_blueprint(db, campaign, previous, action['document'])
                acknowledge_manual_wear(previous, scene, action.get('acknowledgeManualWear', False))
                event = add_event(scene, dict(kind='import', actorIds=[], text='ГМ заменил подготовку из шаблона. Реальные ресурсы не изменены.'))
            else:
                event = apply_action(scene, dict(action, id=command_id), rng, gm, training, added_actor, private_vision=not training)
            if action['type'] == 'shoot' and not training:
                persist_shot(db, campaign, scene, dict(action, id=declaration['id'] if declaration else command_id), user['id'], event, now)
            if action['type']=='fire' and not training:
                persist_combat_effects(db,campaign,scene,declaration['id'] if declaration else command_id,user['id'],now,ammo_changes=[(a['actorId'],a['ammoItemId'],a['delta']) for a in event['ammoChanges']],impacts=[(h['actorId'],h) for h in event['impacts']])
            if action['type']=='resolve-fumble' and not training:
                persist_combat_effects(db,campaign,scene,command_id,user['id'],now,impacts=[(h['actorId'],h) for h in event['impacts']])
            if action['type']=='melee' and not training:
                persist_combat_effects(db,campaign,scene,declaration['id'] if declaration else command_id,user['id'],now,impacts=[(action['targetId'],event)])
            if declaration:
                scene['pending'].remove(declaration)
            for saved in before_sheets:
                after = db.execute('SELECT version FROM characters WHERE id=?', (saved['id'],)).fetchone()[0]
                if after != saved['beforeVersion']:
                    saved['afterVersion'] = after
                    undo['sheets'].append(saved)
            scene['_undo'] = undo
    stamp_event_audiences(scene,before_vision,old_event_ids)
    scene['version'] = version + int(advance)
    if row and advance:
        changed = db.execute('UPDATE ' + battle_table + ' SET battle_id=?,version=?,data=?,updated=? WHERE campaign_id=? AND version=?', (scene['id'], scene['version'], encoded(scene), now, cid, version))
        if changed.rowcount != 1:
            fail('Бой изменился одновременно с командой.', 409)
    elif not row:
        db.execute('INSERT INTO ' + battle_table + ' VALUES(?,?,?,?,?)', (cid, scene['id'], scene['version'], encoded(scene), now))
    receipt = dict(commandId=command_id, type=kind, version=scene['version'], battleId=scene['id'])
    if event:
        receipt['event'] = event
        if event.get('kind') == 'shoot': receipt['turnToTarget'] = event['turnToTarget']
    db.execute('INSERT INTO ' + command_table + ' VALUES(?,?,?,?,?,?,?)', (cid, command_id, user['id'], scene['id'], request_hash, encoded(receipt), now))
    if not training:
        handler.bump_campaign(db, cid)
    out = projection(db, user, campaign, gm, scene, training, viewer_actor_id)
    if event:
        receipt['event'] = project_event(event, {a['id'] for a in out['battle']['scene']['actors']}, set(out['controlledActorIds']), gm, out.get('viewerActorId'), private=not gm)
    out.update(duplicate=False, receipt=receipt)
    db.commit()
    return out
