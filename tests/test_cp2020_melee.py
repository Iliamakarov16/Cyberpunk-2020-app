"""Source-based CP2020 melee tests, not parity with the old shooting engine.

Printed references: BODY categories p29 and damage table p112; opposed ties,
automatic failures and single extra critical die p42; fumble outcomes p43;
distinct Brawling/Fencing/Melee/Martial Arts skills pp50–51; unarmed formulas
p111; style damage and active Dodge p112. Punch rounding, zero raw-damage floor
and automatic-failure opposition are explicitly tested application conventions.
No assertion relies on the damaged local pp99–100 or on Cyberpunk RED.
"""

import copy
import itertools
import json
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'android/app/src/main/python'))
import cp2020_melee as melee


def d10(face):
    return (face - .5) / 10


def d6(face):
    return (face - .5) / 6


class Rolls:
    def __init__(self, *values):
        self.values = list(values)
        self.calls = 0

    def __call__(self):
        if self.calls == len(self.values):
            raise AssertionError('Unexpected extra random draw')
        value = self.values[self.calls]
        self.calls += 1
        return value


def skill(kind='brawling', rank=4, name=None, **fields):
    return dict(kind=kind, name=kind if name is None else name, rank=rank, **fields)


def attack(**fields):
    return dict(dict(technique='kick', ref=8, body=8, skill=skill(), modifier=0), **fields)


def defense(**fields):
    return dict(dict(ref=5, skill=skill('melee', 3), modifier=0, activeDodge=False), **fields)


def weapon(**fields):
    return dict(dict(weaponType='standard', damageDice=2, damageBonus=1, accuracy=0), **fields)


class SourceBasedMelee(unittest.TestCase):
    def test_body_damage_table_boundaries_pp29_112_not_btm(self):
        expected = {2: -2, 3: -1, 4: -1, 5: 0, 6: 0, 7: 0, 8: 1, 9: 1,
                    10: 2, 11: 4, 12: 4, 13: 6, 14: 6, 15: 8, 16: 8, 20: 8, 100: 8}
        for body, bonus in expected.items():
            with self.subTest(body=body):
                self.assertEqual(melee.body_damage_bonus(body), bonus)
        # The old shooting helper is a damage-reduction BTM, a different table.
        self.assertEqual(melee.body_damage_bonus(2), -2)
        self.assertEqual(melee.body_damage_bonus(10), 2)

    def test_equal_opposed_totals_defender_wins_p42(self):
        rng = Rolls(d10(6), d10(6))
        result = melee.resolve_melee(attack(ref=5, skill=skill(rank=3)), defense(), rng)
        self.assertEqual((result['attackTotal'], result['defenseTotal']), (14, 14))
        self.assertFalse(result['hit'])
        self.assertEqual(result['outcome'], 'defender-wins-tie')
        self.assertEqual(result['rawDamage'], 0)
        self.assertEqual(result['damageRolls'], [])
        self.assertIsNone(result['damageBeforeClamp'])
        self.assertEqual(rng.calls, 2)

    def test_regular_rolls_follow_strict_greater_opposition_p111(self):
        for ref_delta, a_die, d_die in itertools.product(range(-3, 4), range(2, 10), range(2, 10)):
            a = attack(ref=5 + ref_delta, skill=skill(rank=3))
            hit = 8 + ref_delta + a_die > 8 + d_die
            rng = Rolls(d10(a_die), d10(d_die), *([d6(4)] if hit else []))
            result = melee.resolve_melee(a, defense(), rng)
            with self.subTest(ref_delta=ref_delta, attack_die=a_die, defense_die=d_die):
                self.assertEqual(result['hit'], hit)
                self.assertEqual(result['rawDamage'], 5 if hit else 0)
                self.assertEqual(rng.calls, 3 if hit else 2)

    def test_skill_selection_is_single_and_not_maximized_pp41_50_51(self):
        selected = attack(skill=skill('brawling', 1, name='Brawling'))
        preview = melee.preview_melee(selected, defense(skill=skill('athletics', 2)))
        self.assertEqual(preview['attackBase'], 9)
        self.assertEqual(preview['defenseBase'], 7)
        self.assertEqual(preview['attackerSkill']['name'], 'Brawling')
        self.assertEqual(preview['defenderSkill']['kind'], 'athletics')
        selected['skills'] = [skill('martialArts', 10, style='Karate', techniqueBonus=2)]
        with self.assertRaises(ValueError):
            melee.preview_melee(selected, defense())

    def test_brawling_rank_never_adds_damage_p50(self):
        for rank in (0, 1, 5, 10):
            result = melee.resolve_melee(attack(ref=20, skill=skill(rank=rank)), defense(),
                                         Rolls(d10(5), d10(5), d6(4)))
            self.assertEqual(result['rawDamage'], 5)
            self.assertEqual(result['skillDamageBonus'], 0)

    def test_punch_requires_selected_rounding_no_hidden_default_p111(self):
        with self.assertRaises(ValueError):
            melee.preview_melee(attack(technique='punch'), defense())
        for face, mode in itertools.product(range(1, 7), ('down', 'up')):
            result = melee.resolve_melee(attack(technique='punch', punchRounding=mode), defense(),
                                         Rolls(d10(7), d10(2), d6(face)))
            rounded = face // 2 if mode == 'down' else (face + 1) // 2
            self.assertEqual(result['rawDamage'], rounded + 1)
            self.assertEqual(result['receipt']['inputs']['conventions']['punchRounding'], mode)
            self.assertEqual(result['damageRolls'], [face])

    def test_kick_is_d6_plus_body_p111(self):
        for face in range(1, 7):
            result = melee.resolve_melee(attack(), defense(), Rolls(d10(7), d10(2), d6(face)))
            self.assertEqual(result['rawDamage'], face + 1)

    def test_martial_style_attack_bonus_and_rank_damage_are_distinct_pp51_112(self):
        for style in ('Karate', 'Choi Li Fut'):
            for technique in ('punch', 'kick'):
                fields = dict(technique=technique, skill=skill('martialArts', 4, style=style, techniqueBonus=2))
                if technique == 'punch':
                    fields['punchRounding'] = 'down'
                result = melee.resolve_melee(attack(**fields), defense(), Rolls(d10(5), d10(5), d6(4)))
                self.assertEqual(result['attack']['base'], 8 + 4 + 2)
                self.assertEqual(result['skillDamageBonus'], 4)
                self.assertEqual(result['rawDamage'], (2 if technique == 'punch' else 4) + 1 + 4)
                self.assertEqual(result['receipt']['inputs']['attackerSkill']['style'], style)

    def test_other_martial_style_not_borrowed_and_no_registry_guess(self):
        a = attack(skill=skill('martialArts', 2, name='My selected style', style='Explicit GM style', techniqueBonus=0))
        result = melee.resolve_melee(a, defense(), Rolls(d10(9), d10(2), d6(4)))
        self.assertEqual(result['attack']['base'], 10)
        self.assertEqual(result['rawDamage'], 7)
        self.assertEqual(result['receipt']['inputs']['attackerSkill']['rank'], 2)

    def test_defense_skill_and_style_bonus_are_explicit_p111(self):
        for kind in ('melee', 'fencing', 'dodge', 'athletics'):
            result = melee.preview_melee(attack(), defense(skill=skill(kind, 2)))
            self.assertEqual(result['defenseBase'], 7)
            self.assertEqual(result['defenderSkill']['kind'], kind)
        chosen = skill('martialArts', 2, style='Choi Li Fut', techniqueBonus=1)
        preview = melee.preview_melee(attack(), defense(skill=chosen))
        self.assertEqual(preview['defenseBase'], 8)
        self.assertEqual(preview['defenseStyleBonus'], 1)

    def test_weapon_damage_accuracy_and_body_not_weapon_skill_rank_p112(self):
        for kind in ('melee', 'fencing'):
            a = attack(technique='weapon', modifier=-3, skill=skill(kind, 10),
                       weapon=weapon(accuracy=2, damageBonus=1))
            result = melee.resolve_melee(a, defense(), Rolls(d10(5), d10(5), d6(2), d6(5)))
            self.assertEqual(result['attack']['base'], 8 + 10 + 2 - 3)
            self.assertEqual(result['rawDamage'], 2 + 5 + 1 + 1)
            self.assertEqual(result['skillDamageBonus'], 0)

    def test_explicit_specialized_martial_weapon_retains_used_style_rank_p51(self):
        a = attack(technique='weapon', skill=skill('martialArts', 3, style='GM-confirmed weapon style', techniqueBonus=0),
                   weapon=weapon(damageDice=1, damageBonus=0))
        result = melee.resolve_melee(a, defense(), Rolls(d10(8), d10(2), d6(3)))
        self.assertEqual(result['rawDamage'], 3 + 1 + 3)

    def test_supplied_wounded_ref_is_used_once_without_recomputing(self):
        ordinary = melee.preview_melee(attack(ref=9), defense(ref=9))
        wounded = melee.preview_melee(attack(ref=5), defense(ref=3))
        self.assertEqual(ordinary['attackBase'] - wounded['attackBase'], 4)
        self.assertEqual(ordinary['defenseBase'] - wounded['defenseBase'], 6)
        with self.assertRaises(ValueError):
            melee.preview_melee(attack(wounds=10), defense())

    def test_active_dodge_incoming_minus_two_separate_from_defense_p112(self):
        before = melee.preview_melee(attack(), defense())
        dodging = melee.preview_melee(attack(), defense(activeDodge=True))
        self.assertEqual(dodging['attackBase'], before['attackBase'] - 2)
        self.assertEqual(dodging['defenseBase'], before['defenseBase'])
        self.assertEqual(dodging['activeDodgeLaterActionStep'], -3)
        self.assertEqual(before['activeDodgeLaterActionStep'], 0)

    def test_modifiers_are_separate_and_tie_compares_final_totals(self):
        a = attack(modifier=-4)
        d = defense(modifier=2)
        result = melee.resolve_melee(a, d, Rolls(d10(7), d10(5)))
        self.assertEqual(result['attackTotal'], 15)
        self.assertEqual(result['defenseTotal'], 15)
        self.assertEqual(result['outcome'], 'defender-wins-tie')

    def test_nonpositive_raw_damage_not_minimum_one_before_armor(self):
        for face in (1, 2, 3, 4, 5):
            result = melee.resolve_melee(attack(technique='punch', body=2, punchRounding='down'), defense(),
                                         Rolls(d10(9), d10(2), d6(face)))
            self.assertTrue(result['hit'])
            self.assertEqual(result['damageBeforeClamp'], face // 2 - 2)
            self.assertEqual(result['rawDamage'], 0)
            self.assertEqual(result['receipt']['inputs']['conventions']['rawDamageFloor'], 0)
            self.assertFalse(result['receipt']['armorApplied'])
            self.assertFalse(result['receipt']['btmApplied'])
            self.assertFalse(result['receipt']['locationMultiplierApplied'])

    def test_no_red_armor_halving_or_mono_specials_sneak_into_kernel(self):
        for special in ('mono', 'monoknife', 'monokatana', 'slice-and-dice', 'cyberbeast', 'cybersnake'):
            with self.subTest(special=special), self.assertRaises(ValueError):
                melee.preview_melee(attack(technique='weapon', skill=skill('melee'),
                                           weapon=weapon(weaponType=special)), defense())
        for extra in ({'armor': 12}, {'armorDivisor': 2}, {'doubleDamageOn10': True}):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(**extra), defense())


class CriticalAndFumbleRules(unittest.TestCase):
    def test_natural_ten_one_extra_ten_does_not_recurse_p42(self):
        rng = Rolls(d10(10), d10(10), d10(2), d6(6))
        result = melee.resolve_melee(attack(), defense(), rng)
        self.assertEqual((result['attack']['roll'], result['attack']['bonus']), (10, 10))
        self.assertEqual(result['attackTotal'], 32)
        self.assertEqual(rng.calls, 4)

    def test_extra_one_is_not_fumble_p42(self):
        rng = Rolls(d10(10), d10(1), d10(2), d6(6))
        result = melee.resolve_melee(attack(), defense(), rng)
        self.assertEqual(result['attack']['bonus'], 1)
        self.assertFalse(result['attack']['automaticFailure'])
        self.assertEqual(result['fumbles'], [])
        self.assertEqual(rng.calls, 4)

    def test_defender_also_gets_exactly_one_critical_bonus_p42(self):
        rng = Rolls(d10(9), d10(10), d10(10))
        result = melee.resolve_melee(attack(), defense(), rng)
        self.assertEqual(result['defenseTotal'], 28)
        self.assertFalse(result['hit'])
        self.assertEqual(rng.calls, 3)

    def test_critical_is_not_automatic_win_against_higher_total(self):
        result = melee.resolve_melee(attack(ref=0, skill=skill(rank=0)), defense(ref=20, skill=skill('melee', 10)),
                                     Rolls(d10(10), d10(1), d10(9)))
        self.assertEqual(result['attackTotal'], 11)
        self.assertEqual(result['defenseTotal'], 39)
        self.assertFalse(result['hit'])

    def test_attacker_natural_one_fails_even_with_higher_total_p42(self):
        rng = Rolls(d10(1), d10(4), d10(2))
        result = melee.resolve_melee(attack(ref=40, skill=skill(rank=10)), defense(), rng)
        self.assertGreater(result['attackTotal'], result['defenseTotal'])
        self.assertFalse(result['hit'])
        self.assertEqual(result['outcome'], 'attack-failed')
        self.assertEqual(result['fumbles'][0]['roll'], 4)
        self.assertFalse(result['requiresGmResolution'])
        self.assertEqual(rng.calls, 3)

    def test_fumble_table_is_rolled_once_and_does_not_critical_chain(self):
        rng = Rolls(d10(1), d10(10), d10(2))
        result = melee.resolve_melee(attack(), defense(), rng)
        self.assertFalse(result['hit'])
        self.assertEqual(result['attack']['fumbleRoll'], 10)
        self.assertEqual(result['attack']['bonus'], 0)
        self.assertTrue(result['requiresGmResolution'])
        self.assertEqual(rng.calls, 3)

    def test_defense_failure_convention_is_explicit_not_total_comparison(self):
        a = attack(ref=0, modifier=-100, skill=skill(rank=0))
        d = defense(ref=40, skill=skill('melee', 10))
        result = melee.resolve_melee(a, d, Rolls(d10(2), d10(1), d10(5), d6(4)))
        self.assertLess(result['attackTotal'], result['defenseTotal'])
        self.assertTrue(result['hit'])
        self.assertEqual(result['outcome'], 'defense-failed')
        self.assertTrue(result['requiresGmResolution'])
        self.assertIn('otherwise-defense-failure-loses',
                      result['receipt']['inputs']['conventions']['automaticFailureOpposition'])

    def test_double_fumble_no_intended_hit_and_both_separate_consequences(self):
        result = melee.resolve_melee(attack(), defense(), Rolls(d10(1), d10(8), d10(1), d10(9)))
        self.assertFalse(result['hit'])
        self.assertEqual(result['rawDamage'], 0)
        self.assertEqual([(f['side'], f['roll']) for f in result['fumbles']], [('attack', 8), ('defense', 9)])
        self.assertTrue(result['requiresGmResolution'])
        self.assertFalse(result['receipt']['fumbleConsequencesComplete'])
        self.assertNotIn('accidentalDamage', result)

    def test_fumble_pending_only_when_table_has_further_consequence_p43(self):
        for fumble in range(1, 11):
            result = melee.resolve_melee(attack(), defense(), Rolls(d10(1), d10(fumble), d10(5)))
            self.assertEqual(result['requiresGmResolution'], fumble >= 5)
            self.assertEqual(result['fumbles'][0]['requiresGmResolution'], fumble >= 5)
            self.assertEqual(result['receipt']['fumbleConsequencesComplete'], fumble < 5)


class InputAndPurityBoundaries(unittest.TestCase):
    def test_unsupported_techniques_reject_before_rng_no_fallback(self):
        for technique in ('parry', 'block', 'grapple', 'throw', 'hold', 'escape', 'choke', 'sweep', 'trip', 'disarm',
                          'pistol-whip', 'shoot', '', None, [], {}, True):
            rng = Rolls()
            with self.subTest(technique=technique), self.assertRaises(ValueError):
                melee.resolve_melee(attack(technique=technique), defense(), rng)
            self.assertEqual(rng.calls, 0)

    def test_invalid_body_rank_stats_modifiers_and_booleans_reject(self):
        invalid = [attack(body=x) for x in (True, False, None, '8', 8.0, -1, 0, 1)]
        invalid += [attack(ref=x) for x in (True, False, None, '8', 8.0, -1)]
        invalid += [attack(modifier=x) for x in (True, None, '0', 1.0, float('nan'))]
        invalid += [attack(skill=skill(rank=x)) for x in (True, None, '4', 4.0, -1, 11)]
        for a in invalid:
            rng = Rolls()
            with self.subTest(attack=a), self.assertRaises(ValueError):
                melee.resolve_melee(a, defense(), rng)
            self.assertEqual(rng.calls, 0)
        for flag in (0, 1, None, '', 'false', []):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(), defense(activeDodge=flag))

    def test_cross_family_skill_and_bonus_leak_rejects(self):
        for kind in ('melee', 'fencing', 'dodge', 'athletics', 'handgun'):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(skill=skill(kind)), defense())
        for kind in ('brawling', 'handgun'):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(technique='weapon', skill=skill(kind), weapon=weapon()), defense())
        for kind in ('brawling', 'handgun', 'parry'):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(), defense(skill=skill(kind)))
        for extra in ({'style': 'Karate'}, {'techniqueBonus': 2}, {'techniqueBonus': 0}):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(skill=skill(**extra)), defense())

    def test_martial_arts_needs_style_and_bonus_never_infers_them(self):
        invalid = [skill('martialArts'), skill('martialArts', style='Karate'),
                   skill('martialArts', techniqueBonus=2), skill('martialArts', style='', techniqueBonus=2)]
        invalid += [skill('martialArts', style='Karate', techniqueBonus=x) for x in (True, None, '2', -1, 5)]
        for selected in invalid:
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(skill=selected), defense())
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(), defense(skill=selected))

    def test_names_valid_and_explicit_untrained_zero_supported(self):
        preview = melee.preview_melee(attack(skill=skill(rank=0, name='')), defense(skill=skill('melee', 0, name='')))
        self.assertEqual(preview['attackBase'], 8)
        self.assertEqual(preview['defenseBase'], 5)
        for name in ('', ' ', 'a' * 101, None, 3):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(skill=skill(name=name) if name is not None else dict(kind='brawling', rank=4, name=None)), defense())

    def test_strict_object_fields_and_required_choices(self):
        for malformed in (None, [], '', 1, True, {}):
            with self.assertRaises(ValueError):
                melee.preview_melee(malformed, defense())
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(), malformed)
        for field in attack():
            a = attack()
            del a[field]
            with self.assertRaises(ValueError):
                melee.preview_melee(a, defense())
        for a in (attack(punchRounding='down'), attack(weapon=weapon()),
                  attack(technique='punch', punchRounding='nearest'),
                  attack(technique='weapon', skill=skill('melee'))):
            with self.assertRaises(ValueError):
                melee.preview_melee(a, defense())
        for field in defense():
            d = defense()
            del d[field]
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(), d)

    def test_weapon_roll_count_is_bounded_and_all_fields_strict(self):
        for dice in (0, -1, True, '2', 2.0, 21, 10000000):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(technique='weapon', skill=skill('melee'), weapon=weapon(damageDice=dice)), defense())
        for field, value in (('damageBonus', True), ('accuracy', 1.2), ('damageSides', 10), ('range', 1), ('special', 'mono')):
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(technique='weapon', skill=skill('melee'), weapon=weapon(**{field: value})), defense())
        for field in weapon():
            w = weapon()
            del w[field]
            with self.assertRaises(ValueError):
                melee.preview_melee(attack(technique='weapon', skill=skill('melee'), weapon=w), defense())

    def test_bad_rng_values_fail_instead_of_clamping_or_coercion(self):
        for value in (None, True, False, '0.5', [], {}, -.001, 1, 1.01, 10 ** 1000,
                      float('nan'), float('inf'), -float('inf')):
            with self.subTest(value=str(value)[:25]), self.assertRaises(ValueError):
                melee.resolve_melee(attack(), defense(), lambda: value)
        with self.assertRaises(ValueError):
            melee.resolve_melee(attack(), defense(), None)

    def test_rng_boundaries_map_to_first_and_last_faces(self):
        # First value is the automatic-failure face, next is its table roll.
        result = melee.resolve_melee(attack(), defense(), Rolls(0, .9999999999999999, d10(2)))
        self.assertEqual((result['attack']['roll'], result['attack']['fumbleRoll']), (1, 10))

    def test_preview_resolution_and_returned_receipt_cannot_mutate_inputs(self):
        a = attack(skill=skill('martialArts', style='Karate', techniqueBonus=2))
        d = defense()
        before = copy.deepcopy((a, d))
        first = melee.resolve_melee(a, d, Rolls(d10(8), d10(2), d6(3)))
        second = melee.resolve_melee(a, d, Rolls(d10(8), d10(2), d6(3)))
        self.assertEqual(first, second)
        self.assertEqual((a, d), before)
        first['receipt']['inputs']['attackerSkill']['rank'] = 10
        first['receipt']['resolution']['attack']['total'] = -999
        self.assertEqual((a, d), before)
        self.assertNotEqual(first['attack']['total'], -999)

    def test_receipt_json_complete_sources_and_seeded_reproducibility(self):
        a, d = attack(), defense()
        first = melee.resolve_melee(a, d, random.Random(713).random)
        second = melee.resolve_melee(a, d, random.Random(713).random)
        self.assertEqual(first, second)
        self.assertEqual(json.loads(json.dumps(first)), first)
        self.assertEqual(first['receipt']['sourcePages'], [29, 42, 43, 50, 51, 111, 112])
        self.assertEqual(first['receipt']['resolution'], {k: v for k, v in first.items() if k != 'receipt'})
        self.assertEqual(first['receipt']['inputs']['attackerSkill'], a['skill'])
        self.assertEqual(first['receipt']['inputs']['defenderSkill'], d['skill'])


if __name__ == '__main__':
    unittest.main()
