"""Deterministic CP2020 ranged receipts, independent of actors/DB/UI/armor.

Core references: pp. 60, 98, 105-107. Explicit GM-convention tests intentionally
do not mislabel ambiguous rounding or jam expenditure as printed rules.
"""

import copy
import json
import math
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'android/app/src/main/python'))
import battle_ranged as ranged


def profile(**changes):
    value = dict(rof=30, fireModes=['single', 'burst', 'auto'], singleActionCap=2,
                 damageDice=1, damageBonus=0, magazine=100,
                 fumbleClass='automatic', reliability='ST')
    value.update(changes)
    if 'fireModes' not in changes:
        if value['fumbleClass'] == 'nonautomatic':
            value['fireModes'] = ['single']
        elif type(value['rof']) is int and value['rof'] < 3:
            value['fireModes'] = ['single', 'auto']
    return value


def target(band='close', base=15, **changes):
    value = dict(id='target-a', base=base, rangeBand=band,
                 difficulty=ranged.RANGE_DIFFICULTIES[band])
    value.update(changes)
    return value


def declaration(mode='single', rounds=1, targets=None):
    return dict(mode=mode, rounds=rounds, targets=[target()] if targets is None else targets)


def context(loaded=100, spent=0, **rulings):
    conventions = dict(jamAmmo='consume-declared',
                       nonautomaticFumbleAmmo='consume-attempted')
    conventions.update(rulings)
    return dict(loaded=loaded, spentThisRound=spent,
                rulings=conventions)


class Dice:
    """Explicit (sides, face) draws, raising if the kernel draws too many dice."""
    def __init__(self, *rolls):
        self.rolls = list(rolls)
        self.calls = 0

    def __call__(self):
        if self.calls >= len(self.rolls):
            raise AssertionError('Unexpected extra RNG draw')
        sides, face = self.rolls[self.calls]
        self.calls += 1
        assert 1 <= face <= sides
        return (face - .5) / sides


class RangeBands(unittest.TestCase):
    def test_all_boundaries_and_just_beyond_each(self):
        for distance, band in [(0, 'pointBlank'), (1, 'pointBlank'),
                               (math.nextafter(1, math.inf), 'close'), (25, 'close'),
                               (math.nextafter(25, math.inf), 'medium'), (50, 'medium'),
                               (math.nextafter(50, math.inf), 'long'), (100, 'long'),
                               (math.nextafter(100, math.inf), 'extreme'), (200, 'extreme')]:
            with self.subTest(distance=distance):
                value = ranged.range_profile(distance, 100)
                self.assertEqual(value, dict(rangeBand=band,
                                            difficulty=ranged.RANGE_DIFFICULTIES[band],
                                            pointBlank=band == 'pointBlank'))
        self.assertIsNone(ranged.range_profile(math.nextafter(200, math.inf), 100))

    def test_boundaries_scale_with_confirmed_range_not_a_weapon_type(self):
        for maximum in (4, 16, 50, 400, 10000):
            for distance, band in [(maximum / 4, 'close'), (maximum / 2, 'medium'),
                                   (maximum, 'long'), (maximum * 2, 'extreme')]:
                self.assertEqual(ranged.range_profile(distance, maximum)['rangeBand'],
                                 'pointBlank' if distance <= 1 else band)

    def test_invalid_ranges_and_distances(self):
        for bad in (None, True, False, '10', [], {}, -1, float('nan'), float('inf'), -float('inf'), 10**100):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    ranged.range_profile(bad, 100)
                with self.assertRaises(ValueError):
                    ranged.range_profile(10, bad)
        with self.assertRaises(ValueError):
            ranged.range_profile(10, 0)


class RangedSingles(unittest.TestCase):
    def test_grouped_semiauto_is_one_action_and_same_penalty_per_bullet(self):
        for previous_actions in (0, 1, 2, 5):
            non_mode_base = 19 - 3 * previous_actions
            rng = Dice((10, 4), (6, 2), (10, 4), (6, 2)) if non_mode_base + 4 >= 15 else Dice((10, 4), (10, 4))
            result = ranged.resolve_ranged(profile(), declaration(rounds=2, targets=[target(base=non_mode_base)]), context(), rng)
            attacks = result['targets'][0]['attacks']
            self.assertEqual([a['base'] for a in attacks], [non_mode_base] * 2)
            self.assertEqual([a['total'] for a in attacks], [non_mode_base + 4] * 2)
            self.assertEqual(result['actionCost'], 1)
            self.assertEqual(result['bulletsSpent'], 2)
            self.assertEqual(result['rofConsumed'], 2)
            self.assertEqual(rng.calls, len(rng.rolls))

    def test_rof_does_not_grant_thirty_single_attacks(self):
        for count in (3, 10, 30):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(rof=30, singleActionCap=2), declaration(rounds=count), context())
        with self.assertRaises(ValueError):
            ranged.preview_ranged(profile(singleActionCap=None), declaration(), context())

    def test_explicit_single_only_profile_does_not_gain_burst_or_auto_from_rof(self):
        confirmed = profile(fireModes=['single'], singleActionCap=1,
                            fumbleClass='nonautomatic', reliability=None)
        for mode in ('burst', 'auto'):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(confirmed, declaration(mode, 3), context())

    def test_single_hit_at_equality_in_every_band(self):
        for band, dv in ranged.RANGE_DIFFICULTIES.items():
            rng = Dice((10, 5)) if band == 'pointBlank' else Dice((10, 5), (6, 4))
            result = ranged.resolve_ranged(profile(), declaration(targets=[target(band, dv - 5)]), context(), rng)
            attack = result['targets'][0]['attacks'][0]
            self.assertEqual(attack['total'], dv)
            self.assertEqual(result['hitCount'], 1)
            self.assertEqual(attack['modeModifier'], 0)
            self.assertEqual(rng.calls, len(rng.rolls))

    def test_miss_spends_one_bullet_and_one_action_without_damage_rng(self):
        rng = Dice((10, 2))
        result = ranged.resolve_ranged(profile(), declaration(targets=[target(base=0)]), context(), rng)
        self.assertEqual((result['bulletsSpent'], result['actionCost'], result['hitCount']), (1, 1, 0))
        self.assertEqual(result['targets'][0]['attacks'][0]['damage'], [])
        self.assertEqual(rng.calls, 1)

    def test_natural_ten_adds_exactly_one_d10_even_when_bonus_is_ten(self):
        rng = Dice((10, 10), (10, 10), (6, 3))
        result = ranged.resolve_ranged(profile(), declaration(targets=[target(base=0)]), context(), rng)
        attack = result['targets'][0]['attacks'][0]
        self.assertEqual((attack['roll'], attack['bonus'], attack['total']), (10, 10, 20))
        self.assertEqual(attack['damage'], [dict(rolls=[3], rawDamage=3, maximum=False,
                                                damageBeforeClamp=3, rawDamageFloor=0)])
        self.assertEqual(rng.calls, 3)

    def test_point_blank_maximum_raw_damage_has_no_damage_rolls(self):
        rng = Dice((10, 5))
        result = ranged.resolve_ranged(profile(damageDice=4, damageBonus=2),
                                      declaration(targets=[target('pointBlank', 5)]), context(), rng)
        self.assertEqual(result['targets'][0]['attacks'][0]['damage'],
                         [dict(rolls=[], rawDamage=26, maximum=True,
                               damageBeforeClamp=26, rawDamageFloor=0)])
        self.assertEqual(rng.calls, 1)

    def test_damage_dice_are_separate_for_each_hit(self):
        rng = Dice((10, 5), (6, 1), (6, 2), (10, 5), (6, 5), (6, 6))
        result = ranged.resolve_ranged(profile(damageDice=2, damageBonus=1), declaration(rounds=2), context(), rng)
        attacks = result['targets'][0]['attacks']
        self.assertEqual([a['damage'][0]['rawDamage'] for a in attacks], [4, 12])
        self.assertEqual([a['damage'][0]['rolls'] for a in attacks], [[1, 2], [5, 6]])

    def test_negative_damage_bonus_preserves_subtotal_but_cannot_heal(self):
        result = ranged.resolve_ranged(profile(damageBonus=-100), declaration(), context(), Dice((10, 5), (6, 1)))
        damage = result['targets'][0]['attacks'][0]['damage'][0]
        self.assertEqual((damage['damageBeforeClamp'], damage['rawDamage'], damage['rawDamageFloor']), (-99, 0, 0))
        point_blank = ranged.resolve_ranged(profile(damageBonus=-100),
                                            declaration(targets=[target('pointBlank')]), context(), Dice((10, 5)))
        damage = point_blank['targets'][0]['attacks'][0]['damage'][0]
        self.assertEqual((damage['damageBeforeClamp'], damage['rawDamage']), (-94, 0))

    def test_consumption_obeys_loaded_and_remaining_rof_without_clamping(self):
        for loaded, spent, rounds in [(0, 0, 1), (1, 0, 2), (10, 30, 1), (10, 29, 2)]:
            with self.subTest(loaded=loaded, spent=spent, rounds=rounds):
                with self.assertRaises(ValueError):
                    ranged.resolve_ranged(profile(), declaration(rounds=rounds), context(loaded, spent), Dice())
        result = ranged.resolve_ranged(profile(), declaration(rounds=2, targets=[target(base=0)]), context(2, 28), Dice((10, 2), (10, 2)))
        self.assertEqual((result['loadedAfter'], result['spentThisRoundAfter']), (0, 30))

    def test_all_groupings_conserve_resources_and_charge_exactly_one_action(self):
        for cap in range(1, 11):
            for count in range(1, cap + 1):
                rng = Dice(*[(10, 2)] * count)
                result = ranged.resolve_ranged(profile(singleActionCap=cap),
                                              declaration(rounds=count, targets=[target(base=-100)]),
                                              context(loaded=count, spent=30 - count), rng)
                self.assertEqual((result['bulletsSpent'], result['rofConsumed'], result['actionCost']), (count, count, 1))
                self.assertEqual((result['loadedAfter'], result['spentThisRoundAfter']), (0, 30))
                self.assertEqual(rng.calls, count)


class RangedBursts(unittest.TestCase):
    def test_exactly_three_rounds_one_target_one_attack_one_action(self):
        for invalid in (1, 2, 4, 6):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration('burst', invalid), context(burstHitRounding='ceil'))
        with self.assertRaises(ValueError):
            ranged.preview_ranged(profile(), declaration('burst', 3, [target(), target(id='b')]), context(burstHitRounding='ceil'))
        rng = Dice((10, 5), (6, 6), (6, 2), (6, 3), (6, 4))
        result = ranged.resolve_ranged(profile(), declaration('burst', 3), context(burstHitRounding='ceil'), rng)
        self.assertEqual((result['actionCost'], result['bulletsSpent'], result['hitCount']), (1, 3, 3))
        self.assertEqual(len(result['targets'][0]['attacks']), 1)
        self.assertEqual(rng.calls, 5)

    def test_bonus_is_only_close_and_medium_at_every_boundary(self):
        for band in ranged.RANGE_DIFFICULTIES:
            result = ranged.preview_ranged(profile(), declaration('burst', 3, [target(band)]), context(burstHitRounding='floor'))
            self.assertEqual(result['targets'][0]['modeModifier'], 3 if band in ('close', 'medium') else 0)

    def test_each_d6_face_under_each_explicit_rounding_convention(self):
        for convention in ('floor', 'ceil'):
            for face in range(1, 7):
                hits = face // 2 if convention == 'floor' else (face + 1) // 2
                rng = Dice((10, 5), (6, face), *[(6, 4)] * hits)
                result = ranged.resolve_ranged(profile(), declaration('burst', 3), context(burstHitRounding=convention), rng)
                self.assertEqual(result['hitCount'], hits)
                self.assertEqual(result['targets'][0]['attacks'][0]['burstHitRoll'], face)
                self.assertEqual(result['rulingsUsed']['burstHitRounding'], convention)
                self.assertLessEqual(result['hitCount'], result['bulletsSpent'])
                self.assertEqual(rng.calls, 2 + hits)

    def test_missing_rounding_returns_reviewable_receipt_before_rng(self):
        rng = Dice()
        result = ranged.resolve_ranged(profile(), declaration('burst', 3), context(), rng)
        self.assertEqual(result['status'], 'needs_ruling')
        self.assertEqual([r['code'] for r in result['unresolvedRulings']], ['burstHitRounding'])
        self.assertEqual((result['bulletsSpent'], result['actionCost']), (0, 0))
        self.assertEqual(rng.calls, 0)

    def test_no_burst_hit_roll_on_failed_attack(self):
        rng = Dice((10, 2))
        result = ranged.resolve_ranged(profile(), declaration('burst', 3, [target(base=-100)]), context(burstHitRounding='floor'), rng)
        self.assertEqual(result['hitCount'], 0)
        self.assertIsNone(result['targets'][0]['attacks'][0]['burstHitRoll'])
        self.assertEqual(result['bulletsSpent'], 3)
        self.assertEqual(rng.calls, 1)

    def test_short_magazine_or_short_remaining_rof_does_not_become_partial_burst(self):
        for loaded, spent in ((2, 0), (100, 28)):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration('burst', 3), context(loaded, spent, burstHitRounding='ceil'))


class RangedAuto(unittest.TestCase):
    def test_multitarget_modifier_basis_is_explicit_and_auditable(self):
        action = declaration('auto', 30, [target(id='a'), target(id='b'), target(id='c')])
        pending = ranged.resolve_ranged(profile(), action, context(), Dice())
        self.assertEqual([r['code'] for r in pending['unresolvedRulings']], ['autoModifierBasis'])
        self.assertEqual([t['modeModifier'] for t in pending['targets']], [None] * 3)
        for basis, used_rounds, modifier in [('allocated', 10, 1), ('declared', 30, 3)]:
            preview = ranged.preview_ranged(profile(), action, context(autoModifierBasis=basis))
            self.assertEqual(preview['status'], 'ready')
            self.assertEqual(preview['rulingsUsed']['autoModifierBasis'], basis)
            self.assertEqual([t['allocatedRounds'] for t in preview['targets']], [10] * 3)
            self.assertEqual([t['modifierRounds'] for t in preview['targets']], [used_rounds] * 3)
            self.assertEqual([t['modeModifier'] for t in preview['targets']], [modifier] * 3)

    def test_declared_modifier_basis_never_increases_hit_allocation_cap(self):
        action = declaration('auto', 30, [target(base=1000, id='a'), target(base=1000, id='b')])
        rng = Dice((10, 5), *[(6, 2)] * 15, (10, 5), *[(6, 2)] * 15)
        result = ranged.resolve_ranged(profile(), action, context(autoModifierBasis='declared'), rng)
        self.assertEqual([t['hitCount'] for t in result['targets']], [15, 15])
        self.assertEqual([t['modeModifier'] for t in result['targets']], [3, 3])
        self.assertEqual(result['hitCount'], result['bulletsSpent'])

    def test_point_blank_only_multitarget_needs_no_irrelevant_tens_or_basis_rule(self):
        preview = ranged.preview_ranged(profile(),
                                       declaration('auto', 30, [target('pointBlank', id='a'), target('pointBlank', id='b')]),
                                       context(autoPointBlankModifier=0))
        self.assertEqual(preview['status'], 'ready')
        self.assertNotIn('autoModifierBasis', preview['rulingsUsed'])
        self.assertNotIn('autoTenRoundGroups', preview['rulingsUsed'])

    def test_range_modifiers_use_allocated_tens_and_never_single_action_penalties(self):
        for band, sign in [('close', 1), ('medium', -1), ('long', -1), ('extreme', -1)]:
            for count in (10, 20, 30):
                result = ranged.preview_ranged(profile(rof=count), declaration('auto', count, [target(band)]), context())
                self.assertEqual(result['status'], 'ready')
                self.assertEqual(result['targets'][0]['modeModifier'], sign * count // 10)
                self.assertEqual(result['targets'][0]['base'], 15)

    def test_fullauto_equality_means_zero_hits_at_all_bands(self):
        for band in ranged.RANGE_DIFFICULTIES:
            modifier = 2 if band == 'close' else 0 if band == 'pointBlank' else -2
            dv = ranged.RANGE_DIFFICULTIES[band]
            rng = Dice((10, 5))
            result = ranged.resolve_ranged(profile(rof=20),
                                          declaration('auto', 20, [target(band, dv - 5 - modifier)]),
                                          context(autoPointBlankModifier=0), rng)
            attack = result['targets'][0]['attacks'][0]
            self.assertEqual(attack['total'], dv)
            self.assertTrue(attack['success'])
            self.assertFalse(attack['hit'])
            self.assertEqual(result['hitCount'], 0)
            self.assertEqual((result['actionCost'], result['bulletsSpent']), (1, 20))
            self.assertEqual(rng.calls, 1)

    def test_margin_counts_hits_and_caps_at_allocated_bullets(self):
        for margin in (1, 2, 9, 10, 11, 100):
            hits = min(10, margin)
            rng = Dice((10, 5), *[(6, 2)] * hits)
            result = ranged.resolve_ranged(profile(rof=10),
                                          declaration('auto', 10, [target(base=15 + margin - 5 - 1)]), context(), rng)
            self.assertEqual(result['hitCount'], hits)
            self.assertEqual(rng.calls, 1 + hits)

    def test_multiple_targets_equal_allocation_separate_attack_rolls(self):
        targets = [target(base=10, id='a'), target('medium', 16, id='b'), target('long', 21, id='c')]
        rng = Dice((10, 5), (6, 1), (10, 7), (6, 2), (6, 3), (10, 8), (6, 4), (6, 5), (6, 6))
        result = ranged.resolve_ranged(profile(), declaration('auto', 30, targets), context(autoModifierBasis='allocated'), rng)
        self.assertEqual([t['allocatedRounds'] for t in result['targets']], [10, 10, 10])
        self.assertEqual([t['hitCount'] for t in result['targets']], [1, 2, 3])
        self.assertEqual([t['attacks'][0]['roll'] for t in result['targets']], [5, 7, 8])
        self.assertEqual((result['bulletsSpent'], result['actionCost']), (30, 1))
        self.assertEqual(result['hitCount'], 6)
        self.assertEqual(rng.calls, 9)

    def test_uneven_allocation_requires_explicit_remainder_consumption(self):
        gun = profile(rof=31)
        action = declaration('auto', 31, [target(base=100, id=str(i)) for i in range(3)])
        preview = ranged.preview_ranged(gun, action, context(autoModifierBasis='allocated'))
        self.assertEqual(preview['status'], 'needs_ruling')
        self.assertEqual([r['code'] for r in preview['unresolvedRulings']], ['autoAllocationRemainder'])
        self.assertEqual(preview['unallocatedRounds'], 1)
        self.assertEqual([t['allocatedRounds'] for t in preview['targets']], [10, 10, 10])
        rng = Dice(*sum(([(10, 5)] + [(6, 2)] * 10 for _ in range(3)), []))
        result = ranged.resolve_ranged(gun, action, context(autoAllocationRemainder='consume-unallocated', autoModifierBasis='allocated'), rng)
        self.assertEqual((result['hitCount'], result['bulletsSpent']), (30, 31))
        self.assertEqual(result['rulingsUsed']['autoAllocationRemainder'], 'consume-unallocated')

    def test_fractional_tens_need_explicit_rounding_and_use_allocated_not_total(self):
        for count, expected in ((1, (0, 1)), (9, (0, 1)), (11, (1, 2)), (19, (1, 2)), (21, (2, 3))):
            for band, sign in [('close', 1), ('medium', -1), ('long', -1), ('extreme', -1)]:
                action = declaration('auto', count, [target(band)])
                preview = ranged.preview_ranged(profile(rof=count, singleActionCap=1), action, context())
                self.assertEqual([r['code'] for r in preview['unresolvedRulings']], ['autoTenRoundGroups'])
                self.assertIsNone(preview['targets'][0]['modeModifier'])
                for convention, groups in zip(('floor', 'ceil'), expected):
                    result = ranged.preview_ranged(profile(rof=count, singleActionCap=1), action, context(autoTenRoundGroups=convention))
                    self.assertEqual(result['targets'][0]['modeModifier'], sign * groups)
        divided = ranged.preview_ranged(profile(), declaration('auto', 30, [target(id='a'), target(id='b')]), context(autoTenRoundGroups='floor', autoModifierBasis='allocated'))
        self.assertEqual([t['modeModifier'] for t in divided['targets']], [1, 1])

    def test_point_blank_requires_its_own_explicit_modifier_not_close_bonus(self):
        action = declaration('auto', 30, [target('pointBlank')])
        preview = ranged.preview_ranged(profile(), action, context())
        self.assertEqual([r['code'] for r in preview['unresolvedRulings']], ['autoPointBlankModifier'])
        self.assertIsNone(preview['targets'][0]['modeModifier'])
        for modifier in (-3, 0, 3):
            result = ranged.preview_ranged(profile(), action, context(autoPointBlankModifier=modifier))
            self.assertEqual(result['targets'][0]['modeModifier'], modifier)
            self.assertEqual(result['rulingsUsed']['autoPointBlankModifier'], modifier)

    def test_reduced_auto_and_partial_magazine_are_explicit_never_silently_clamped(self):
        for loaded in (20, 100):
            preview = ranged.preview_ranged(profile(), declaration('auto', 20), context(loaded))
            self.assertEqual([r['code'] for r in preview['unresolvedRulings']], ['autoReducedRounds'])
            result = ranged.resolve_ranged(profile(), declaration('auto', 20, [target(base=0)]),
                                          context(loaded, autoReducedRounds='allow-declared'), Dice((10, 2)))
            self.assertEqual(result['loadedAfter'], loaded - 20)
            self.assertEqual(result['bulletsSpent'], 20)
        with self.assertRaises(ValueError):
            ranged.preview_ranged(profile(), declaration('auto', 30), context(20, autoReducedRounds='allow-declared'))

    def test_auto_can_use_exact_remaining_round_rof_without_reduced_ruling(self):
        preview = ranged.preview_ranged(profile(), declaration('auto', 20), context(50, 10))
        self.assertEqual(preview['status'], 'ready')
        self.assertNotIn('autoReducedRounds', preview['rulingsUsed'])

    def test_aim_scope_and_arbitrary_modifier_fields_are_not_silently_accepted(self):
        for key in ('aim', 'aimTurns', 'scope', 'scopeBonus', 'actionPenalty'):
            action = declaration('auto', 30)
            action[key] = 3
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), action, context())
            action = declaration('auto', 30)
            action['targets'][0][key] = 3
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), action, context())


class RangedFumbles(unittest.TestCase):
    def test_all_nonautomatic_fumble_table_faces_preserved_and_only_five_up_pending(self):
        for face in range(1, 11):
            rng = Dice((10, 1), (10, face))
            result = ranged.resolve_ranged(profile(fumbleClass='nonautomatic'), declaration(), context(), rng)
            fumble = result['fumbles'][0]
            self.assertTrue(fumble['ordinaryTableApplied'])
            self.assertEqual(fumble['fumbleTableRoll'], face)
            self.assertEqual(fumble['requiresGmAdjudication'], face >= 5)
            self.assertEqual(result['needsGmAdjudication'], face >= 5)
            self.assertEqual(result['actionInterrupted'], face >= 5)
            self.assertEqual(result['bulletsSpent'], 1)
            self.assertEqual(result['actionCost'], 1)
            self.assertEqual(rng.calls, 2)

    def test_ordinary_fumble_five_up_halts_group_and_consumes_only_attempts(self):
        for table_roll in range(5, 11):
            for before in range(3):
                gun = profile(fumbleClass='nonautomatic', singleActionCap=4)
                draws = sum(([(10, 5), (6, 3)] for _ in range(before)), []) + [(10, 1), (10, table_roll)]
                rng = Dice(*draws)
                result = ranged.resolve_ranged(gun, declaration(rounds=4), context(), rng)
                t = result['targets'][0]
                self.assertEqual((result['requestedRounds'], result['bulletsSpent'], result['rofConsumed']), (4, before + 1, before + 1))
                self.assertEqual(result['loadedAfter'], 100 - before - 1)
                self.assertEqual(result['hitCount'], before)
                self.assertEqual(len(t['attacks']), before + 1)
                self.assertEqual(t['skippedAttackRollCount'], 3 - before)
                self.assertEqual(result['unexecutedRounds'], 3 - before)
                self.assertTrue(t['skippedDueToFumble'])
                self.assertFalse(t['skippedDueToJam'])
                self.assertEqual(result['interruptionReason'], 'ordinary-fumble')
                self.assertEqual(result['rulingsUsed']['nonautomaticFumbleAmmo'], 'consume-attempted')
                self.assertEqual(rng.calls, len(draws))

    def test_ordinary_table_one_to_four_does_not_abort_remaining_grouped_shots(self):
        for table_roll in range(1, 5):
            rng = Dice((10, 1), (10, table_roll), (10, 9), (6, 5))
            result = ranged.resolve_ranged(profile(fumbleClass='nonautomatic'), declaration(rounds=2), context(), rng)
            self.assertEqual(result['hitCount'], 1)
            self.assertEqual(result['bulletsSpent'], 2)
            self.assertFalse(result['actionInterrupted'])
            self.assertFalse(result['needsGmAdjudication'])
            self.assertEqual(result['targets'][0]['attacks'][1]['roll'], 9)
            self.assertEqual(rng.calls, 4)

    def test_automatic_reliability_success_does_not_abort_remaining_grouped_shots(self):
        rng = Dice((10, 1), (10, 6), (10, 9), (6, 5))
        result = ranged.resolve_ranged(profile(), declaration(rounds=2), context(), rng)
        self.assertEqual(result['hitCount'], 1)
        self.assertEqual(result['bulletsSpent'], 2)
        self.assertFalse(result['actionInterrupted'])
        self.assertFalse(result['needsGmAdjudication'])
        self.assertEqual(rng.calls, 4)

    def test_natural_one_always_misses_even_with_overwhelming_total(self):
        rng = Dice((10, 1), (10, 5))
        result = ranged.resolve_ranged(profile(fumbleClass='nonautomatic'),
                                      declaration(targets=[target(base=1000)]), context(), rng)
        attack = result['targets'][0]['attacks'][0]
        self.assertEqual(attack['total'], 1001)
        self.assertFalse(attack['success'])
        self.assertEqual(result['hitCount'], 0)
        self.assertTrue(result['needsGmAdjudication'])
        self.assertTrue(result['fumbles'][0]['requiresGmAdjudication'])
        self.assertEqual(result['fumbles'][0]['fumbleTableRoll'], 5)
        self.assertTrue(result['fumbles'][0]['ordinaryTableApplied'])
        self.assertIsNone(result['fumbles'][0]['reliabilityRoll'])
        self.assertIsNone(result['jam'])
        self.assertEqual(rng.calls, 2)

    def test_automatic_classification_controls_check_even_in_single_mode(self):
        rng = Dice((10, 1), (10, 6))
        result = ranged.resolve_ranged(profile(), declaration(), context(), rng)
        self.assertEqual(result['fumbles'][0]['reliabilityRoll'], 6)
        self.assertFalse(result['fumbles'][0]['jammed'])
        self.assertFalse(result['fumbles'][0]['ordinaryTableApplied'])
        self.assertFalse(result['needsGmAdjudication'])
        self.assertEqual(rng.calls, 2)
        self.assertIsNone(result['jam'])

    def test_every_reliability_face_and_clear_duration_boundaries(self):
        for reliability, threshold in [('VR', 3), ('ST', 5), ('UR', 8)]:
            for check in range(1, 11):
                for clear in (1, 6):
                    jammed = check <= threshold
                    draws = [(10, 1), (10, check)] + ([(6, clear)] if jammed else [])
                    rng = Dice(*draws)
                    result = ranged.resolve_ranged(profile(reliability=reliability), declaration(), context(), rng)
                    fumble = result['fumbles'][0]
                    self.assertEqual((fumble['jamThreshold'], fumble['jammed']), (threshold, jammed))
                    self.assertEqual(fumble['clearTurns'], clear if jammed else None)
                    self.assertEqual(result['bulletsSpent'], 1)
                    self.assertEqual(result['firedRounds'], None if jammed else 1)
                    self.assertFalse(result['needsGmAdjudication'])
                    self.assertFalse(fumble['requiresGmAdjudication'])
                    self.assertIsNone(fumble['fumbleTableRoll'])
                    self.assertEqual(rng.calls, len(draws))

    def test_jam_halts_grouped_shots_but_explicit_consumption_is_whole_declaration(self):
        rng = Dice((10, 1), (10, 2), (6, 4))
        result = ranged.resolve_ranged(profile(), declaration(rounds=2), context(), rng)
        t = result['targets'][0]
        self.assertEqual(len(t['attacks']), 1)
        self.assertEqual(t['skippedAttackRollCount'], 1)
        self.assertTrue(t['skippedDueToJam'])
        self.assertEqual((result['bulletsSpent'], result['rofConsumed'], result['actionCost']), (2, 2, 1))
        self.assertEqual(result['jam']['ammoConvention'], 'consume-declared')
        self.assertIsNone(result['firedRounds'])
        self.assertEqual(rng.calls, 3)

    def test_multi_target_jam_preserves_prior_hits_and_stops_later_target_rolls(self):
        targets = [target(id=str(i), base=10) for i in range(3)]
        rng = Dice((10, 5), (6, 4), (10, 1), (10, 5), (6, 3))
        result = ranged.resolve_ranged(profile(), declaration('auto', 30, targets), context(autoModifierBasis='allocated'), rng)
        self.assertEqual([t['hitCount'] for t in result['targets']], [1, 0, 0])
        self.assertEqual([len(t['attacks']) for t in result['targets']], [1, 1, 0])
        self.assertEqual([t['skippedDueToJam'] for t in result['targets']], [False, False, True])
        self.assertEqual((result['bulletsSpent'], result['loadedAfter']), (30, 70))
        self.assertEqual(result['jam']['targetId'], '1')
        self.assertEqual(result['jam']['clearTurns'], 3)
        self.assertEqual(rng.calls, 5)

    def test_missing_fumble_class_reliability_or_jam_consumption_never_rolls(self):
        cases = [(profile(fumbleClass=None), context(), ['fumbleClass']),
                 (profile(reliability=None), context(), ['reliability']),
                 (profile(), dict(loaded=100, spentThisRound=0), ['jamAmmo']),
                 (profile(fumbleClass='nonautomatic'), dict(loaded=100, spentThisRound=0), ['nonautomaticFumbleAmmo'])]
        for gun, state, missing in cases:
            rng = Dice()
            result = ranged.resolve_ranged(gun, declaration(), state, rng)
            self.assertEqual(result['status'], 'needs_ruling')
            self.assertEqual([r['code'] for r in result['unresolvedRulings']], missing)
            self.assertFalse(result['committable'])
            self.assertEqual((result['actionCost'], result['bulletsSpent'], result['rofConsumed']), (0, 0, 0))
            self.assertEqual(rng.calls, 0)

    def test_nonautomatic_needs_no_reliability_or_jam_convention(self):
        result = ranged.preview_ranged(profile(fumbleClass='nonautomatic', reliability=None),
                                       declaration(), dict(loaded=10, spentThisRound=0,
                                                           rulings=dict(nonautomaticFumbleAmmo='consume-attempted')))
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['rulingsUsed'], dict(nonautomaticFumbleAmmo='consume-attempted'))

    def test_nonautomatic_profile_cannot_claim_burst_or_auto(self):
        for mode, count in [('burst', 3), ('auto', 30)]:
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(fumbleClass='nonautomatic'), declaration(mode, count), context())

    def test_contradictory_capabilities_rejected_even_when_current_mode_is_single(self):
        for mode in ('burst', 'auto', 'suppress'):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(fumbleClass='nonautomatic', fireModes=['single', mode]), declaration(), context())
        with self.assertRaises(ValueError):
            ranged.preview_ranged(profile(rof=2, fireModes=['single', 'burst']), declaration(), context())


class RangedValidationAndPurity(unittest.TestCase):
    def test_seeded_cross_mode_resource_hit_and_purity_invariants(self):
        rng = random.Random(2020)
        for _ in range(500):
            fumble_class = rng.choice(('automatic', 'nonautomatic'))
            mode = rng.choice(ranged.FIRE_MODES) if fumble_class == 'automatic' else 'single'
            count = 3 if mode == 'burst' else rng.randrange(1, 101)
            target_count = rng.randrange(1, min(count, 8) + 1) if mode == 'auto' else 1
            gun = profile(rof=100, singleActionCap=100, fumbleClass=fumble_class,
                          reliability=rng.choice(('VR', 'ST', 'UR')))
            targets = [target(rng.choice(tuple(ranged.RANGE_DIFFICULTIES)), rng.randrange(-30, 61), id=str(i)) for i in range(target_count)]
            action = declaration(mode, count, targets)
            state = context(burstHitRounding=rng.choice(('floor', 'ceil')),
                            autoTenRoundGroups=rng.choice(('floor', 'ceil')),
                            autoModifierBasis=rng.choice(('allocated', 'declared')),
                            autoPointBlankModifier=rng.randrange(-5, 6),
                            autoReducedRounds='allow-declared',
                            autoAllocationRemainder='consume-unallocated')
            before = copy.deepcopy((gun, action, state))
            result = ranged.resolve_ranged(gun, action, state, rng.random)
            self.assertEqual(result['status'], 'resolved')
            self.assertEqual((gun, action, state), before)
            self.assertEqual(result['actionCost'], 1)
            self.assertGreaterEqual(result['bulletsSpent'], 1)
            self.assertLessEqual(result['bulletsSpent'], count)
            self.assertEqual(result['bulletsSpent'], result['rofConsumed'])
            self.assertEqual(result['loadedAfter'] + result['bulletsSpent'], state['loaded'])
            self.assertEqual(result['spentThisRoundAfter'], state['spentThisRound'] + result['rofConsumed'])
            self.assertLessEqual(result['hitCount'], result['bulletsSpent'])
            self.assertEqual(result['hitCount'], sum(len(a['damage']) for t in result['targets'] for a in t['attacks']))
            for t in result['targets']:
                self.assertLessEqual(t['hitCount'], t['allocatedRounds'])
                self.assertTrue(all(a['base'] == t['base'] for a in t['attacks']))
            json.dumps(result, allow_nan=False)

    def test_all_inputs_and_receipts_are_detached_and_json_serializable(self):
        gun, action, state = profile(), declaration('burst', 3), context(burstHitRounding='ceil')
        before = copy.deepcopy((gun, action, state))
        preview = ranged.preview_ranged(gun, action, state)
        result = ranged.resolve_ranged(gun, action, state, Dice((10, 5), (6, 3), (6, 4), (6, 6)))
        self.assertEqual((gun, action, state), before)
        json.dumps(preview, allow_nan=False)
        json.dumps(result, allow_nan=False)
        result['declaredAction']['targets'][0]['base'] = 999
        result['rulingsUsed']['burstHitRounding'] = 'floor'
        preview['targets'][0]['base'] = 222
        self.assertEqual((gun, action, state), before)

    def test_invalid_rng_is_rejected_without_mutating_input(self):
        for bad in (None, True, False, '0.5', [], {}, -0.01, 1, 2, float('nan'), float('inf')):
            gun, action, state = profile(), declaration(), context()
            before = copy.deepcopy((gun, action, state))
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    ranged.resolve_ranged(gun, action, state, lambda: bad)
                self.assertEqual((gun, action, state), before)
        with self.assertRaises(ValueError):
            ranged.resolve_ranged(profile(), declaration(), context(), None)

    def test_invalid_later_rng_cannot_leave_partially_applied_resources(self):
        gun, action, state = profile(), declaration(rounds=2), context()
        before = copy.deepcopy((gun, action, state))
        draws = iter((.5, .5, 1))
        with self.assertRaises(ValueError):
            ranged.resolve_ranged(gun, action, state, lambda: next(draws))
        self.assertEqual((gun, action, state), before)

    def test_rng_valid_endpoints_have_correct_die_faces(self):
        result = ranged.resolve_ranged(profile(fumbleClass='nonautomatic'), declaration(), context(), lambda: 0)
        self.assertEqual(result['targets'][0]['attacks'][0]['roll'], 1)
        result = ranged.resolve_ranged(profile(), declaration(), context(), lambda: math.nextafter(1, 0))
        attack = result['targets'][0]['attacks'][0]
        self.assertEqual((attack['roll'], attack['bonus']), (10, 10))
        self.assertEqual(attack['damage'][0]['rolls'], [6])

    def test_malformed_integer_fields_are_not_coerced_or_clamped(self):
        for key, low, high in [('rof', 1, 100), ('singleActionCap', 1, 30),
                               ('damageDice', 1, 20), ('damageBonus', -100, 100), ('magazine', 1, 1000)]:
            for bad in (None, True, False, '1', 1.0, [], {}, low - 1, high + 1, 10**100):
                with self.subTest(key=key, bad=bad):
                    with self.assertRaises(ValueError):
                        ranged.preview_ranged(profile(**{key: bad}), declaration(), context())
        for bad in (None, True, False, '1', 1.0, [], {}, 0, 101, 10**100):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration(rounds=bad), context())

    def test_bad_shapes_capabilities_modes_and_state_fields(self):
        for gun in (None, [], 'profile'):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(gun, declaration(), context())
        for modes in (None, [], 'single', ['single', 'single'], [['single']], [True], ['laser']):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(fireModes=modes), declaration(), context())
        for bad in (None, True, 'ST ', 'standard', 3, [], {}):
            if bad is not None:
                with self.assertRaises(ValueError):
                    ranged.preview_ranged(profile(reliability=bad), declaration(), context())
        for mode in ('suppress', 'aim', 'semiauto', 'fullauto', None, True, [], {}):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration(mode), context())
        for action in (None, [], {}, dict(mode='single'), dict(declaration(), extra=True)):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), action, context())
        for state in (None, [], {}, dict(loaded=100), dict(context(), actorId='a')):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration(), state)
        for key in ('loaded', 'spentThisRound'):
            for bad in (None, True, '1', 1.0, [], {}, -1, 10**100):
                state = context()
                state[key] = bad
                with self.assertRaises(ValueError):
                    ranged.preview_ranged(profile(), declaration(), state)

    def test_target_fields_bands_duplicates_and_zero_allocations(self):
        for targets in (None, [], {}, [None], [target()] * 101):
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration(targets=targets) if targets is not None else dict(mode='single', rounds=1, targets=None), context())
        for changes in [dict(id=''), dict(id=' '), dict(id='bad\nid'), dict(id=1), dict(id='x' * 129),
                        dict(base=True), dict(base=1.5), dict(base=float('nan')), dict(base=1001),
                        dict(rangeBand='Close'), dict(rangeBand=[]), dict(difficulty=16),
                        dict(difficulty=True), dict(pointBlank=True), dict(pointBlank=0)]:
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    ranged.preview_ranged(profile(), declaration(targets=[target(**changes)]), context())
        with self.assertRaises(ValueError):
            ranged.preview_ranged(profile(), declaration('auto', 30, [target(), target()]), context())
        with self.assertRaises(ValueError):
            ranged.preview_ranged(profile(rof=1, singleActionCap=1), declaration('auto', 1, [target(id='a'), target(id='b')]), context())

    def test_only_known_explicit_rulings_are_accepted(self):
        for rulings in (None, [], {'burstRounding': 'floor'}, {'burstHitRounding': 'nearest'},
                        {'autoTenRoundGroups': 'fractional'}, {'jamAmmo': 'guess'},
                        {'autoReducedRounds': True}, {'autoPointBlankModifier': True},
                        {'autoPointBlankModifier': 1.5}, {'autoPointBlankModifier': 101}):
            state = context()
            state['rulings'] = rulings
            with self.assertRaises(ValueError):
                ranged.preview_ranged(profile(), declaration(), state)

    def test_irrelevant_conventions_are_not_claimed_as_used(self):
        result = ranged.preview_ranged(profile(), declaration(),
                                       context(burstHitRounding='floor', autoTenRoundGroups='ceil',
                                               autoPointBlankModifier=5, autoReducedRounds='allow-declared',
                                               autoAllocationRemainder='consume-unallocated'))
        self.assertEqual(result['rulingsUsed'], dict(jamAmmo='consume-declared'))

    def test_preview_never_claims_applied_resources_or_rolls(self):
        result = ranged.preview_ranged(profile(), declaration(rounds=2), context())
        self.assertEqual(result['status'], 'ready')
        self.assertFalse(result['committable'])
        self.assertEqual((result['actionCost'], result['bulletsSpent'], result['rofConsumed']), (0, 0, 0))
        self.assertEqual((result['proposedActionCost'], result['plannedBulletsSpent']), (1, 2))
        self.assertEqual(result['targets'][0]['attacks'], [])
        self.assertEqual(result['loadedBefore'], result['loadedAfter'])


if __name__ == '__main__':
    unittest.main()
