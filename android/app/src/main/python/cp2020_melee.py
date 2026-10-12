"""Pure, bounded Cyberpunk 2020 opposed-melee resolution.

Primary source: Cyberpunk 2020, second edition, printed pp. 29, 42–43,
50–51 and 111–112. The user-supplied scan's pp. 99–100 are damaged and are
not a source for this module. No RED melee/armor rules are substituted.

Supported attacks are punch, kick and an explicitly ordinary d6-based melee
weapon. The caller supplies the already-wounded REF, exactly one selected
skill for each participant, approved modifiers and any declared active Dodge.
Martial Arts requires an explicit, separately learned style and the applicable
GM-verified technique bonus. This module never searches for a better skill.

This is not a complete combat engine: authorization, weapon ownership, reach,
facing, turn/action costs, armor/BTM, hit locations, wounds, saves, persistence,
and actual fumble consequences belong to the authoritative adapter. Parry,
grapples, throws, holds, escapes, chokes, trips, disarms, mono-edge weapons,
cyberbeasts and other special weapon rules are deliberately unsupported.

``preview_melee(attack, defense)`` validates all inputs without rolling.
``resolve_melee(attack, defense, rng)`` takes a callback returning a finite
number in [0, 1). Dice are consumed in this order: attack primary/extra die,
defense primary/extra die, then damage dice only on an intended hit. An extra
die is either a single critical bonus or the mandatory fumble-table roll.

The JSON receipt preserves source-backed rules separately from conventions:
the explicit punch rounding choice; clamping negative raw damage to zero;
and failed-defense precedence. An attacking natural 1 never lands its intended
attack, including when both sides fumble. An otherwise valid attack defeats a
natural-1 defense. Any accidental injury from a fumble is a separate outcome.
Fumble rolls 5–10 require GM resolution; none of their physical consequences
are invented here. Receipts with ``requiresGmResolution`` are not complete
resolution of every consequence and must remain visibly pending in the adapter.
"""

import copy
import math


RULES_VERSION = 'cp2020-core-melee-v1'
SUPPORTED_TECHNIQUES = ('punch', 'kick', 'weapon')
ATTACK_SKILLS = ('brawling', 'melee', 'fencing', 'martialArts')
DEFENSE_SKILLS = ('melee', 'fencing', 'martialArts', 'dodge', 'athletics')
SOURCE_PAGES = (29, 42, 43, 50, 51, 111, 112)
MAX_WEAPON_DICE = 20  # Application input bound, not a universal weapon rule.


def _exact(value, required, optional=(), label='object'):
    if type(value) is not dict:
        raise ValueError(label + ' must be an object')
    if set(required) - set(value) or set(value) - set(required) - set(optional):
        raise ValueError(label + ' contains missing or unsupported fields')


def _integer(value, label, minimum=None, maximum=None):
    if type(value) is not int or (minimum is not None and value < minimum) or (
            maximum is not None and value > maximum):
        raise ValueError(label + ' is outside its integer range')
    return value


def _text(value, label, allow_empty=False):
    if type(value) is not str or len(value) > 100 or (not allow_empty and not value.strip()):
        raise ValueError(label + ' must be a nonempty name of at most 100 characters')
    return value.strip()


def _skill(value, allowed, label):
    _exact(value, ('kind', 'name', 'rank'), ('style', 'techniqueBonus'), label)
    kind = value['kind']
    if type(kind) is not str or kind not in allowed:
        raise ValueError(label + ' has an unsupported skill kind')
    rank = _integer(value['rank'], label + '.rank', 0, 10)
    name = _text(value['name'], label + '.name', allow_empty=rank == 0 and kind != 'martialArts')
    result = dict(kind=kind, name=name, rank=rank)
    if kind == 'martialArts':
        if 'style' not in value or 'techniqueBonus' not in value:
            raise ValueError(label + ' requires the selected style and verified technique bonus')
        result['style'] = _text(value['style'], label + '.style')
        result['techniqueBonus'] = _integer(value['techniqueBonus'], label + '.techniqueBonus', 0, 4)
    elif 'style' in value or 'techniqueBonus' in value:
        raise ValueError(label + ': Martial Arts bonuses cannot be attached to another skill')
    return result


def body_damage_bonus(body):
    """Melee damage addition (pp. 29, 112), deliberately distinct from BTM.

    BODY 1 has no category in the verified table and needs a separate ruling;
    it is rejected instead of extrapolated. The last printed band is 15+.
    """
    _integer(body, 'BODY', 2)
    for upper, bonus in ((2, -2), (4, -1), (7, 0), (9, 1), (10, 2),
                         (12, 4), (14, 6)):
        if body <= upper:
            return bonus
    return 8


def preview_melee(attack, defense):
    """Return a fresh JSON-compatible formula preview; never consume RNG.

    Attack fields: technique, ref, body, skill, modifier; punch additionally
    requires punchRounding='down'|'up'; weapon additionally requires weapon
    {weaponType:'standard', damageDice, damageBonus, accuracy}.

    Defense fields: ref, skill, modifier, activeDodge (bool). Its selected
    Martial Arts technique bonus, if any, is a GM ruling for this defense;
    supplying one does not enable Parry or its object/breakage mechanics.
    Active Dodge imposes -2 on the incoming attack, not on the opposed defense.
    The adapter handles the dodger's later actions and -3 action step.
    """
    _exact(attack, ('technique', 'ref', 'body', 'skill', 'modifier'),
           ('punchRounding', 'weapon'), 'attack')
    _exact(defense, ('ref', 'skill', 'modifier', 'activeDodge'), label='defense')
    technique = attack['technique']
    if type(technique) is not str or technique not in SUPPORTED_TECHNIQUES:
        raise ValueError('unsupported melee technique; no fallback attack is permitted')
    attack_ref = _integer(attack['ref'], 'attack.ref', 0)
    defense_ref = _integer(defense['ref'], 'defense.ref', 0)
    attack_modifier = _integer(attack['modifier'], 'attack.modifier')
    defense_modifier = _integer(defense['modifier'], 'defense.modifier')
    attack_skill = _skill(attack['skill'], ATTACK_SKILLS, 'attack.skill')
    defense_skill = _skill(defense['skill'], DEFENSE_SKILLS, 'defense.skill')
    if type(defense['activeDodge']) is not bool:
        raise ValueError('defense.activeDodge must be an explicit boolean')
    body_bonus = body_damage_bonus(attack['body'])
    rounding = None
    if technique == 'punch':
        rounding = attack.get('punchRounding')
        if type(rounding) is not str or rounding not in ('down', 'up'):
            raise ValueError('punch requires an explicit up/down rounding convention')
    elif 'punchRounding' in attack:
        raise ValueError('punchRounding only applies to a punch')

    weapon = None
    if technique == 'weapon':
        if attack_skill['kind'] not in ('melee', 'fencing', 'martialArts'):
            raise ValueError('a weapon requires an appropriate explicitly selected weapon skill')
        weapon = attack.get('weapon')
        _exact(weapon, ('weaponType', 'damageDice', 'damageBonus', 'accuracy'), label='weapon')
        if type(weapon['weaponType']) is not str or weapon['weaponType'] != 'standard':
            raise ValueError('unsupported special melee weapon profile')
        weapon = dict(weaponType='standard',
                      damageDice=_integer(weapon['damageDice'], 'weapon.damageDice', 1, MAX_WEAPON_DICE),
                      damageBonus=_integer(weapon['damageBonus'], 'weapon.damageBonus'),
                      accuracy=_integer(weapon['accuracy'], 'weapon.accuracy'))
    else:
        if 'weapon' in attack:
            raise ValueError('unarmed techniques cannot carry weapon damage or accuracy')
        if attack_skill['kind'] not in ('brawling', 'martialArts'):
            raise ValueError('punch/kick requires Brawling or one selected Martial Arts style')

    accuracy = weapon['accuracy'] if weapon else 0
    active_dodge = -2 if defense['activeDodge'] else 0
    skill_damage = attack_skill['rank'] if attack_skill['kind'] == 'martialArts' else 0
    attack_style_bonus = attack_skill.get('techniqueBonus', 0)
    defense_style_bonus = defense_skill.get('techniqueBonus', 0)
    return dict(
        rulesVersion=RULES_VERSION, technique=technique,
        attackRef=attack_ref, defenseRef=defense_ref, body=attack['body'],
        attackerSkill=attack_skill, defenderSkill=defense_skill,
        attackModifier=attack_modifier, defenseModifier=defense_modifier,
        attackStyleBonus=attack_style_bonus, defenseStyleBonus=defense_style_bonus,
        accuracy=accuracy, activeDodge=defense['activeDodge'], activeDodgePenalty=active_dodge,
        activeDodgeLaterActionStep=-3 if defense['activeDodge'] else 0,
        attackBase=attack_ref + attack_skill['rank'] + attack_style_bonus + accuracy + attack_modifier + active_dodge,
        defenseBase=defense_ref + defense_skill['rank'] + defense_style_bonus + defense_modifier,
        damageDice=weapon['damageDice'] if weapon else 1,
        damageSides=6, weaponDamageBonus=weapon['damageBonus'] if weapon else 0,
        bodyDamageBonus=body_bonus, skillDamageBonus=skill_damage,
        punchRounding=rounding, weapon=weapon,
        conventions=dict(punchRounding=rounding, rawDamageFloor=0,
                         automaticFailureOpposition='attacker-failure-prevents-intended-hit; otherwise-defense-failure-loses'),
        sourcePages=list(SOURCE_PAGES))


def _die(rng, sides):
    value = rng()
    if type(value) not in (int, float) or not 0 <= value < 1 or not math.isfinite(value):
        raise ValueError('RNG must return a finite number in [0, 1)')
    return math.floor(value * sides) + 1


def _opposed_roll(base, rng):
    roll = _die(rng, 10)
    bonus = _die(rng, 10) if roll == 10 else 0
    fumble = _die(rng, 10) if roll == 1 else None
    return dict(base=base, roll=roll, bonus=bonus, total=base + roll + bonus,
                automaticFailure=roll == 1, fumbleRoll=fumble)


def resolve_melee(attack, defense, rng):
    """Resolve the intended opposed attack and return an auditable receipt.

    ``rawDamage`` is pre-armor, pre-BTM and pre-hit-location damage, including
    BODY and only the used Martial Arts style's rank. It is zero on a miss.
    ``damageBeforeClamp`` records the signed formula subtotal on a hit and is
    None on a miss. No minimum-one rule is applied before penetration.

    ``fumbles`` always records mandatory table rolls. For 5–10 the adapter
    must retain an unresolved GM consequence instead of declaring all effects
    complete. A failed intended attack may still cause accidental fumble harm.
    """
    preview = preview_melee(attack, defense)
    if not callable(rng):
        raise ValueError('rng must be callable')
    attack_roll = _opposed_roll(preview['attackBase'], rng)
    defense_roll = _opposed_roll(preview['defenseBase'], rng)
    if attack_roll['automaticFailure']:
        hit, outcome = False, 'attack-failed'
    elif defense_roll['automaticFailure']:
        hit, outcome = True, 'defense-failed'
    elif attack_roll['total'] > defense_roll['total']:
        hit, outcome = True, 'hit'
    elif attack_roll['total'] == defense_roll['total']:
        hit, outcome = False, 'defender-wins-tie'
    else:
        hit, outcome = False, 'defended'

    fumbles = []
    for side, roll in (('attack', attack_roll), ('defense', defense_roll)):
        if roll['fumbleRoll'] is not None:
            pending = roll['fumbleRoll'] >= 5
            fumbles.append(dict(side=side, roll=roll['fumbleRoll'],
                                requiresGmResolution=pending,
                                consequence='gm-adjudication-required' if pending else 'no-additional-effect',
                                sourcePages=[42, 43]))

    damage_rolls = [_die(rng, 6) for _ in range(preview['damageDice'])] if hit else []
    dice_damage = sum(damage_rolls) if hit else None
    if hit and preview['technique'] == 'punch':
        dice_damage = (dice_damage // 2 if preview['punchRounding'] == 'down'
                       else (dice_damage + 1) // 2)
    subtotal = (dice_damage + preview['weaponDamageBonus'] + preview['bodyDamageBonus'] +
                preview['skillDamageBonus']) if hit else None
    raw_damage = max(0, subtotal) if hit else 0
    pending = any(fumble['requiresGmResolution'] for fumble in fumbles)
    result = dict(rulesVersion=RULES_VERSION, technique=preview['technique'],
                  hit=hit, outcome=outcome, attack=attack_roll, defense=defense_roll,
                  attackTotal=attack_roll['total'], defenseTotal=defense_roll['total'],
                  damageRolls=damage_rolls, diceDamage=dice_damage,
                  weaponDamageBonus=preview['weaponDamageBonus'],
                  bodyDamageBonus=preview['bodyDamageBonus'], skillDamageBonus=preview['skillDamageBonus'],
                  damageBeforeClamp=subtotal, rawDamage=raw_damage,
                  fumbles=fumbles, requiresGmResolution=pending)
    result['receipt'] = dict(
        rulesVersion=RULES_VERSION, source='Cyberpunk 2020, second edition',
        sourcePages=list(SOURCE_PAGES), inputs=preview,
        diceOrder='attack-primary/extra, defense-primary/extra, successful-hit-damage',
        armorApplied=False, btmApplied=False, locationMultiplierApplied=False,
        fumbleConsequencesComplete=not pending,
        resolution=copy.deepcopy(result))
    return result
