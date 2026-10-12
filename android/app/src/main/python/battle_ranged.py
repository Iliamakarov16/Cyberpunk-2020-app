"""Pure Cyberpunk 2020 firing actions; no actors, armor, locations or persistence.

Source: CP2020 core pp. 43, 60, 98-99, 105-107, verified printed-page scans:
https://www.scribd.com/document/1041450615/Cyberpunk-2020-TTRPG-Rulebook
Weapon ROF is a ROUND limit,
not a grant of that many independent single shots without action penalties.
The adapter supplies confirmed weapon capabilities and a complete non-mode
``base`` for every target, including the SAME declared-action penalty for every
shot in that action. This module adds only the selected firing-mode modifier.

Public JSON contract:
  preview_ranged(profile, declaration, context)
  resolve_ranged(profile, declaration, context, rng)
  range_profile(distance, weapon_range)

Profile: rof (1..100), fireModes, singleActionCap (0..rof), damageDice
(1..20), damageBonus (-100..100), optional magazine (1..1000),
fumbleClass ('automatic'/'nonautomatic') and reliability ('VR'/'ST'/'UR').
Other profile fields belong to the loadout adapter and are ignored. Missing
fumble classification or automatic reliability is UNKNOWN, never inferred from
the name, ROF or chosen mode. Burst/auto require an automatic classification.

Declaration: {mode:'single'|'burst'|'auto', rounds:int,
  targets:[{id:str, base:int, difficulty:int, rangeBand:str, pointBlank?:bool}]}.
Single and burst presently support one target. Auto divides declared rounds
equally between unique targets, rounding each allocation down. The adapter
must check ownership, alive/ready status, visibility, facing, aim/scope exclusion
for auto, and stale state BEFORE calling. The kernel never validates a scene.

Context: {loaded:int, spentThisRound:int, rulings?:{...}}. All input is
validated before any RNG call. Unsupported/malformed declarations raise
ValueError; missing explicit GM conventions return status='needs_ruling',
committable=False, actionCost=0, bulletsSpent=0, rofConsumed=0 and no rolls.
Supported conventions are deliberately named in every receipt, not called RAW:
  burstHitRounding: 'floor'|'ceil' (the book prints 1d6/2 without rounding)
  autoTenRoundGroups: 'floor'|'ceil' (needed for fractional groups of ten)
  autoModifierBasis: 'allocated'|'declared' (multiple targets: the text is unclear)
  autoPointBlankModifier: integer -100..100 (PB auto modifier is unspecified)
  autoReducedRounds: 'allow-declared' (a reduced/partial-magazine auto action)
  autoAllocationRemainder: 'consume-unallocated' (uneven target allocation)
  jamAmmo: 'consume-declared' (all declared ammo is consumed even on a jam)
  nonautomaticFumbleAmmo: 'consume-attempted' (stop on table 5-10 and preserve
    attempted-shot consumption; any accidental extra discharge needs GM review)

Only relevant conventions are required/recorded. No partial 3-round burst is
supported. A jam stops subsequent attack rolls but the explicit jamAmmo ruling
keeps consumption known without rerolling. firedRounds=None then honestly
distinguishes unknown actual firing from GM-adjudicated resource expenditure.
For nonautomatic weapons, natural one fails the attack and rolls the ordinary
fumble-table d10: 1-4 has no further effect, while 5-10 requires GM adjudication.
Automatic weapons use the reliability check INSTEAD of that ordinary table.
A resolved receipt is not authority to skip outstanding GM consequences.
Grouped nonautomatic shots stop on table 5-10; later shots/damage are not rolled.

RNG is a callable returning a finite real number in [0, 1); invalid output is
rejected, never clamped. Natural ten adds exactly ONE d10, not an open-ended
explosion. All returned objects are detached; even an RNG error cannot mutate
inputs. Per-hit damage is raw d6 damage (maximum at point blank), before armor,
location, BTM and wounds. Target ordering defines attack-roll ordering; damage
rolls follow the attack/burst/reliability rolls for each attack.
"""

import copy
import math


SCHEMA_VERSION = 1
MAX_ROF = 100
MAX_TARGETS = 100
RANGE_DIFFICULTIES = {'pointBlank': 10, 'close': 15, 'medium': 20,
                      'long': 25, 'extreme': 30}
JAM_THRESHOLDS = {'VR': 3, 'ST': 5, 'UR': 8}
FIRE_MODES = ('single', 'burst', 'auto')
PROFILE_MODES = FIRE_MODES + ('suppress',)
RULING_CHOICES = {
    'burstHitRounding': ('floor', 'ceil'),
    'autoTenRoundGroups': ('floor', 'ceil'),
    'autoModifierBasis': ('allocated', 'declared'),
    'autoReducedRounds': ('allow-declared',),
    'autoAllocationRemainder': ('consume-unallocated',),
    'jamAmmo': ('consume-declared',),
    'nonautomaticFumbleAmmo': ('consume-attempted',),
}
ORDINARY_FUMBLE_EFFECTS = {5: 'dropped-weapon', 6: 'accidental-discharge',
                           7: 'jam-or-embedded', 8: 'self-injury',
                           9: 'ally-injury', 10: 'ally-injury'}


def _integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError('%s must be an integer in [%s, %s]' % (name, low, high))
    return value


def _number(value, name, low, high):
    if type(value) not in (int, float) or not low <= value <= high:
        raise ValueError('%s must be a finite number in [%s, %s]' % (name, low, high))
    return value


def _object(value, name, required, optional=()):
    if type(value) is not dict or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise ValueError('%s has missing or unsupported fields' % name)
    return value


def range_profile(distance, weapon_range):
    """Core DV bands with p.99 point blank through one meter.

    Returns None beyond extreme range. Distance must be a finite, nonnegative
    number, not a numeric string/bool; weapon range is positive and <=10000m.
    The p.99 table gives point blank as touching to 1m. The adapter measures
    distance; this helper does not choose cell centers or other grid geometry.
    R/4, R/2, R and 2R are printed distances. Assigning an exact endpoint to the
    nearer band is this helper's explicit boundary convention. No grid, facing,
    sight or target-validity assumptions are made here.
    """
    _number(distance, 'distance', 0, 10**9)
    _number(weapon_range, 'weapon_range', 0, 10000)
    if weapon_range == 0:
        raise ValueError('weapon_range must be positive')
    if distance <= 1:
        band = 'pointBlank'
    elif distance <= weapon_range / 4:
        band = 'close'
    elif distance <= weapon_range / 2:
        band = 'medium'
    elif distance <= weapon_range:
        band = 'long'
    elif distance <= weapon_range * 2:
        band = 'extreme'
    else:
        return None
    return dict(rangeBand=band, difficulty=RANGE_DIFFICULTIES[band],
                pointBlank=band == 'pointBlank')


def _validate(profile, declaration, context):
    if type(profile) is not dict:
        raise ValueError('profile must be an object')
    rof = _integer(profile.get('rof'), 'rof', 1, MAX_ROF)
    modes = profile.get('fireModes')
    if (type(modes) is not list or not 1 <= len(modes) <= len(PROFILE_MODES)
            or any(type(mode) is not str or mode not in PROFILE_MODES for mode in modes)
            or len(set(modes)) != len(modes)):
        raise ValueError('fireModes must explicitly list unique supported capabilities')
    cap = _integer(profile.get('singleActionCap'), 'singleActionCap',
                   1 if 'single' in modes else 0, rof if 'single' in modes else 0)
    _integer(profile.get('damageDice'), 'damageDice', 1, 20)
    _integer(profile.get('damageBonus'), 'damageBonus', -100, 100)
    magazine = _integer(profile['magazine'], 'magazine', 1, 1000) if 'magazine' in profile else 1000
    fumble_class = profile.get('fumbleClass')
    if fumble_class is not None and (type(fumble_class) is not str or fumble_class not in ('automatic', 'nonautomatic')):
        raise ValueError('fumbleClass must be automatic or nonautomatic, or unknown')
    reliability = profile.get('reliability')
    if reliability is not None and (type(reliability) is not str or reliability not in JAM_THRESHOLDS):
        raise ValueError('reliability must be VR, ST or UR, or unknown')
    if 'burst' in modes and rof < 3:
        raise ValueError('a burst-capable profile requires ROF of at least three')
    if fumble_class == 'nonautomatic' and any(mode in modes for mode in ('burst', 'auto', 'suppress')):
        raise ValueError('automatic capabilities conflict with nonautomatic classification')

    _object(declaration, 'declaration', ('mode', 'rounds', 'targets'))
    mode = declaration['mode']
    if type(mode) is not str or mode not in FIRE_MODES:
        raise ValueError('only single, burst and auto actions are supported')
    if mode not in modes:
        raise ValueError('the confirmed weapon does not support this firing mode')
    rounds = _integer(declaration['rounds'], 'rounds', 1, MAX_ROF)
    if mode == 'single' and rounds > cap:
        raise ValueError('single rounds exceed the explicit singleActionCap')
    if mode == 'burst' and rounds != 3:
        raise ValueError('a supported three-round burst requires exactly three rounds')
    targets = declaration['targets']
    if type(targets) is not list or not 1 <= len(targets) <= MAX_TARGETS:
        raise ValueError('targets must be a nonempty bounded list')
    if mode != 'auto' and len(targets) != 1:
        raise ValueError('single and burst currently require exactly one target')
    if len(targets) > rounds:
        raise ValueError('each auto target must receive at least one round')
    seen = set()
    for target in targets:
        _object(target, 'target', ('id', 'base', 'difficulty', 'rangeBand'), ('pointBlank',))
        target_id = target['id']
        if type(target_id) is not str or not 1 <= len(target_id) <= 128 or not target_id.strip() or any(ord(c) < 32 for c in target_id):
            raise ValueError('target id must be a nonempty bounded identifier')
        if target_id in seen:
            raise ValueError('target ids must be unique')
        seen.add(target_id)
        _integer(target['base'], 'target base', -1000, 1000)
        band = target['rangeBand']
        if type(band) is not str or band not in RANGE_DIFFICULTIES:
            raise ValueError('unknown rangeBand')
        _integer(target['difficulty'], 'target difficulty', 10, 30)
        if target['difficulty'] != RANGE_DIFFICULTIES[band]:
            raise ValueError('difficulty must match the canonical rangeBand DV')
        if 'pointBlank' in target and (type(target['pointBlank']) is not bool or target['pointBlank'] != (band == 'pointBlank')):
            raise ValueError('pointBlank must agree with rangeBand')

    _object(context, 'context', ('loaded', 'spentThisRound'), ('rulings',))
    loaded = _integer(context['loaded'], 'loaded', 0, magazine)
    spent = _integer(context['spentThisRound'], 'spentThisRound', 0, rof)
    if rounds > loaded:
        raise ValueError('declared rounds exceed the loaded magazine')
    if rounds + spent > rof:
        raise ValueError('declared rounds exceed remaining round ROF')
    rulings = context.get('rulings', {})
    _object(rulings, 'rulings', (), tuple(RULING_CHOICES) + ('autoPointBlankModifier',))
    for key, value in rulings.items():
        if key == 'autoPointBlankModifier':
            _integer(value, key, -100, 100)
        elif type(value) is not str or value not in RULING_CHOICES[key]:
            raise ValueError('unsupported explicit GM convention: ' + key)
    return rof, rounds, targets, rulings


def preview_ranged(profile, declaration, context):
    """Validate a declaration, show allocations/modifiers and required rulings.

    Does not roll or mutate anything. status='ready' is a preview, not a resolved
    receipt; its proposedActionCost/plannedBulletsSpent are only a plan.
    """
    rof, rounds, targets, rulings = _validate(profile, declaration, context)
    mode = declaration['mode']
    used, unresolved = {}, []

    def require(key, explanation):
        if key not in rulings:
            unresolved.append(dict(code=key, message=explanation,
                                   choices=list(RULING_CHOICES.get(key, ()))))
            return None
        used[key] = rulings[key]
        return rulings[key]

    fumble_class = profile.get('fumbleClass')
    if fumble_class is None:
        unresolved.append(dict(code='fumbleClass', message='Confirm automatic or nonautomatic fumble classification in the weapon profile.',
                               choices=['automatic', 'nonautomatic']))
    elif fumble_class == 'automatic':
        if profile.get('reliability') is None:
            unresolved.append(dict(code='reliability', message='Confirm VR, ST or UR reliability in the weapon profile.',
                                   choices=list(JAM_THRESHOLDS)))
        require('jamAmmo', 'Confirm how declared ammunition is consumed if this automatic weapon jams; the core does not specify an exact pre-jam count.')
    else:
        require('nonautomaticFumbleAmmo', 'Confirm consuming only attempted shots when an ordinary fumble interrupts this action; accidental extra discharges require separate adjudication.')

    if mode == 'burst':
        require('burstHitRounding', 'Choose explicit rounding for the printed 1d6/2 burst-hit rule.')
    allocated = rounds // len(targets) if mode == 'auto' else rounds
    remainder = rounds - allocated * len(targets)
    modifier_rounds = allocated
    if mode == 'auto':
        if rounds < rof - context['spentThisRound']:
            require('autoReducedRounds', 'Confirm the reduced or partial-magazine automatic-fire declaration.')
        if remainder:
            require('autoAllocationRemainder', 'Confirm consuming declared rounds left over after equal, rounded-down target allocation.')
        if len(targets) > 1 and any(target['rangeBand'] != 'pointBlank' for target in targets):
            basis = require('autoModifierBasis', 'Choose whether multi-target auto modifiers use rounds allocated to each target or the full declared burst; the text does not explicitly settle this.')
            modifier_rounds = rounds if basis == 'declared' else allocated if basis == 'allocated' else None
        if modifier_rounds is not None and modifier_rounds % 10 and any(target['rangeBand'] != 'pointBlank' for target in targets):
            require('autoTenRoundGroups', 'Choose explicit rounding for fractional groups of ten auto rounds under the selected modifier basis.')
        if any(target['rangeBand'] == 'pointBlank' for target in targets):
            require('autoPointBlankModifier', 'Set the point-blank automatic-fire modifier; do not silently borrow the Close modifier.')

    previews = []
    for target in targets:
        band = target['rangeBand']
        modifier = 0
        if mode == 'burst':
            modifier = 3 if band in ('close', 'medium') else 0
        elif mode == 'auto':
            if band == 'pointBlank':
                modifier = rulings.get('autoPointBlankModifier')
            elif modifier_rounds is None or modifier_rounds % 10 and 'autoTenRoundGroups' not in rulings:
                modifier = None
            else:
                groups = math.ceil(modifier_rounds / 10) if rulings.get('autoTenRoundGroups') == 'ceil' else modifier_rounds // 10
                modifier = groups if band == 'close' else -groups
        previews.append(dict(id=target['id'], base=target['base'],
                             difficulty=target['difficulty'], rangeBand=band,
                             pointBlank=band == 'pointBlank', allocatedRounds=allocated,
                             modifierRounds=modifier_rounds if mode == 'auto' and band != 'pointBlank' else None,
                             attackRollCount=rounds if mode == 'single' else 1,
                             modeModifier=modifier, attacks=[], hitCount=0))
    return dict(schemaVersion=SCHEMA_VERSION,
                status='needs_ruling' if unresolved else 'ready', committable=False,
                declaredAction=copy.deepcopy(declaration), requestedRounds=rounds,
                plannedBulletsSpent=rounds, proposedActionCost=1,
                actionCost=0, bulletsSpent=0, rofConsumed=0, firedRounds=0,
                loadedBefore=context['loaded'], spentThisRoundBefore=context['spentThisRound'],
                loadedAfter=context['loaded'], spentThisRoundAfter=context['spentThisRound'],
                unallocatedRounds=remainder, targets=previews, hitCount=0,
                rulingsUsed=used, unresolvedRulings=unresolved,
                needsGmAdjudication=False, fumbles=[], jam=None,
                actionInterrupted=False, interruptionReason=None,
                unexecutedRounds=0)


def _die(rng, sides):
    value = rng()
    if type(value) not in (int, float) or not 0 <= value < 1:
        raise ValueError('rng must return a finite number in [0, 1)')
    return math.floor(value * sides) + 1


def _damage(profile, target, rng):
    rolls = [] if target['pointBlank'] else [_die(rng, 6) for _ in range(profile['damageDice'])]
    raw = profile['damageDice'] * 6 if target['pointBlank'] else sum(rolls)
    subtotal = raw + profile['damageBonus']
    # An explicit nonnegative damage floor prevents a negative weapon bonus
    # from becoming healing or increasing armor. Preserve the signed subtotal.
    return dict(rolls=rolls, damageBeforeClamp=subtotal,
                rawDamage=max(0, subtotal), rawDamageFloor=0,
                maximum=target['pointBlank'])


def resolve_ranged(profile, declaration, context, rng):
    """Return a deterministic detached receipt; never apply it to battle state.

    If preview requires a convention, return it unchanged WITHOUT RNG use.
    Resolve a valid declaration as ONE action, with separate ROF/ammo consumption.
    Fumbles preserve raw checks and jam-clear turns for the GM. The adapter must
    authorize and atomically apply known effects, and surface every unresolved
    fumble consequence rather than advertising a complete fumble-table engine.
    """
    result = preview_ranged(profile, declaration, context)
    if result['status'] != 'ready':
        return result
    if not callable(rng):
        raise ValueError('rng must be callable')
    mode, rounds = declaration['mode'], declaration['rounds']
    halt_reason, attempted = None, 0
    for target in result['targets']:
        for index in range(target['attackRollCount']):
            if halt_reason:
                break
            attempted += 1 if mode == 'single' else target['allocatedRounds']
            roll = _die(rng, 10)
            bonus = _die(rng, 10) if roll == 10 else 0
            total = target['base'] + target['modeModifier'] + roll + bonus
            hit_count, hit_roll = 0, None
            success = roll != 1 and total >= target['difficulty']
            if success:
                if mode == 'single':
                    hit_count = 1
                elif mode == 'burst':
                    hit_roll = _die(rng, 6)
                    hit_count = ((hit_roll + 1) // 2 if context['rulings']['burstHitRounding'] == 'ceil' else hit_roll // 2)
                else:
                    # Equality is zero hits in the printed margin-above-DV rule.
                    hit_count = min(target['allocatedRounds'], max(0, total - target['difficulty']))
            attack = dict(index=index, roll=roll, bonus=bonus, base=target['base'],
                          modeModifier=target['modeModifier'], total=total,
                          difficulty=target['difficulty'], success=success,
                          hit=hit_count > 0, hitCount=hit_count,
                          burstHitRoll=hit_roll, damage=[], fumble=roll == 1)
            if roll == 1:
                fumble = dict(targetId=target['id'], attackIndex=index,
                              fumbleClass=profile['fumbleClass'],
                              reliability=profile.get('reliability'),
                              reliabilityRoll=None, jamThreshold=None,
                              jammed=False, clearTurns=None,
                              ordinaryTableApplied=profile['fumbleClass'] == 'nonautomatic',
                              fumbleTableRoll=None, effectCode=None,
                              requiresGmAdjudication=False,
                              note='Natural-one intended attack failure; automatic reliability replaces the ordinary fumble table.')
                if profile['fumbleClass'] == 'automatic':
                    check = _die(rng, 10)
                    threshold = JAM_THRESHOLDS[profile['reliability']]
                    jammed = check <= threshold
                    clear_turns = _die(rng, 6) if jammed else None
                    fumble.update(reliabilityRoll=check, jamThreshold=threshold,
                                  jammed=jammed, clearTurns=clear_turns,
                                  effectCode='jam' if jammed else 'none')
                    if jammed:
                        halt_reason = 'jam'
                        result['jam'] = dict(targetId=target['id'], attackIndex=index,
                                             reliability=profile['reliability'],
                                             roll=check, threshold=threshold,
                                             clearTurns=clear_turns,
                                             ammoConvention=result['rulingsUsed']['jamAmmo'])
                else:
                    table_roll = _die(rng, 10)
                    pending = table_roll >= 5
                    fumble.update(fumbleTableRoll=table_roll,
                                  effectCode=ORDINARY_FUMBLE_EFFECTS.get(table_roll, 'none'),
                                  requiresGmAdjudication=pending,
                                  note=('Preserved ordinary fumble-table result; consequences and any extra accidental-discharge ammunition require GM adjudication.'
                                        if pending else 'Ordinary fumble table 1-4: no further consequence beyond the failed attack.'))
                    if pending:
                        halt_reason = 'ordinary-fumble'
                result['fumbles'].append(fumble)
                result['needsGmAdjudication'] |= fumble['requiresGmAdjudication']
            attack['damage'] = [_damage(profile, target, rng) for _ in range(hit_count)]
            target['attacks'].append(attack)
            target['hitCount'] += hit_count
        target['skippedAttackRollCount'] = target['attackRollCount'] - len(target['attacks'])
        target['skippedDueToJam'] = target['skippedAttackRollCount'] > 0 and halt_reason == 'jam'
        target['skippedDueToFumble'] = target['skippedAttackRollCount'] > 0 and halt_reason == 'ordinary-fumble'
    consumed = attempted if halt_reason == 'ordinary-fumble' else rounds
    result.update(status='resolved', committable=True, actionCost=1,
                  bulletsSpent=consumed, rofConsumed=consumed,
                  firedRounds=None if result['jam'] or result['needsGmAdjudication'] else rounds,
                  loadedAfter=context['loaded'] - consumed,
                  spentThisRoundAfter=context['spentThisRound'] + consumed,
                  actionInterrupted=halt_reason is not None,
                  interruptionReason=halt_reason,
                  unexecutedRounds=rounds - attempted if halt_reason else 0,
                  hitCount=sum(target['hitCount'] for target in result['targets']))
    return result
