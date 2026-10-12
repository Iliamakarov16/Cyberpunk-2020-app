"""Source-based CP2020 ordinary protection tests, independent of scene/UI.

Core p. 101 specifies inside-out pairwise combination; p. 102 gives the
difference table and strict penetration definition; p. 103 supplies cover SPs.
Zero-as-absence and bounded JSON validation are application contracts, not new
printed material rules. No assertion grants generic cover HP or staged wear.
"""

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'android/app/src/main/python'))
import battle_cover as cover


def layer(identifier, sp):
    return dict(id=identifier, sp=sp)


class ProportionalSP(unittest.TestCase):
    def test_all_printed_difference_boundaries_p102(self):
        # Independent literal expectations from the six printed table rows.
        cases = [(1, 1, 6), (1, 5, 10), (1, 6, 10), (1, 9, 13),
                 (1, 10, 13), (1, 15, 18), (1, 16, 18), (1, 21, 23),
                 (1, 22, 23), (1, 27, 28), (1, 28, 28), (1, 1000, 1000)]
        for inner, outer, expected in cases:
            with self.subTest(inner=inner, outer=outer):
                self.assertEqual(cover.combine_sp(inner, outer), expected)
                self.assertEqual(cover.combine_sp(outer, inner), expected)

    def test_difference_table_uses_larger_sp_not_outer_sp(self):
        self.assertEqual(cover.combine_sp(18, 5), 21)
        self.assertEqual(cover.combine_sp(5, 18), 21)
        self.assertEqual(cover.combine_sp(35, 5), 35)

    def test_pair_is_commutative_even_though_stacks_are_not(self):
        for inner in range(61):
            for outer in range(61):
                self.assertEqual(cover.combine_sp(inner, outer),
                                 cover.combine_sp(outer, inner))

    def test_zero_is_absent_never_an_extra_layer(self):
        for sp in (0, 1, 4, 5, 8, 14, 20, 26, 27, 1000):
            with self.subTest(sp=sp):
                self.assertEqual(cover.combine_sp(0, sp), sp)
                self.assertEqual(cover.combine_sp(sp, 0), sp)

    def test_public_pair_boundaries_and_no_unprinted_result_clamp(self):
        self.assertEqual(cover.combine_sp(1000, 1000), 1005)
        self.assertEqual(cover.combine_sp(0, 1000), 1000)


class OrderedProtection(unittest.TestCase):
    def test_armor_18_and_wood_door_5_is_21_not_23(self):
        result = cover.resolve_protection(25, 18, [layer('wood-door', 5)])
        self.assertEqual(result['effectiveSP'], 21)
        self.assertEqual(result['penetration'], 4)
        self.assertTrue(result['penetrated'])
        self.assertEqual(result['steps'], [dict(layerId='wood-door', innerSP=18,
                                               outerSP=5, difference=13,
                                               bonus=3, effectiveSP=21)])

    def test_literal_three_layer_receipts_preserve_inside_out_order_p101(self):
        result = cover.resolve_protection(30, 5, [layer('inner', 5), layer('outer', 10)])
        self.assertEqual(result['effectiveSP'], 15)
        self.assertEqual(result['steps'], [
            dict(layerId='inner', innerSP=5, outerSP=5, difference=0, bonus=5, effectiveSP=10),
            dict(layerId='outer', innerSP=10, outerSP=10, difference=0, bonus=5, effectiveSP=15),
        ])
        reverse = cover.resolve_protection(30, 5, [layer('outer', 10), layer('inner', 5)])
        self.assertEqual(reverse['effectiveSP'], 17)
        self.assertEqual(reverse['steps'], [
            dict(layerId='outer', innerSP=5, outerSP=10, difference=5, bonus=4, effectiveSP=14),
            dict(layerId='inner', innerSP=14, outerSP=5, difference=9, bonus=3, effectiveSP=17),
        ])
        self.assertNotEqual(result['effectiveSP'], reverse['effectiveSP'])

    def test_cover_only_starts_at_first_positive_layer_without_phantom_armor(self):
        result = cover.resolve_protection(20, 0, [layer('door', 5), layer('wall', 5)])
        self.assertEqual(result['effectiveSP'], 10)
        self.assertEqual(result['steps'][0], dict(layerId='door', innerSP=0,
                                                outerSP=5, difference=5,
                                                bonus=0, effectiveSP=5))
        self.assertEqual(result['steps'][1]['bonus'], 5)

    def test_explicit_zero_layers_preserve_order_without_changing_protection(self):
        result = cover.resolve_protection(25, 18, [layer('empty', 0),
                                                 layer('door', 5), layer('spent', 0)])
        self.assertEqual(result['effectiveSP'], 21)
        self.assertEqual([s['layerId'] for s in result['steps']], ['empty', 'door', 'spent'])
        self.assertEqual([s['bonus'] for s in result['steps']], [0, 3, 0])
        self.assertEqual([s['effectiveSP'] for s in result['steps']], [18, 21, 21])

    def test_all_absent_protection_retains_zero(self):
        for armor_sp, layers in [(0, []), (0, [layer('empty', 0)]),
                                 (0, [layer('a', 0), layer('b', 0)])]:
            result = cover.resolve_protection(7, armor_sp, layers)
            self.assertEqual(result['effectiveSP'], 0)
            self.assertEqual(result['penetration'], 7)
            self.assertTrue(result['penetrated'])
            self.assertTrue(all(s['bonus'] == 0 for s in result['steps']))

    def test_real_cover_values_do_not_imply_material_destruction(self):
        # Core p103: sheetrock / ordinary wood door SP5; steel door SP20.
        for identifier, sp, expected in [('sheetrock', 5, 5), ('wood-door', 5, 5),
                                          ('steel-door', 20, 20)]:
            result = cover.resolve_protection(50, 0, [layer(identifier, sp)])
            self.assertEqual(result['effectiveSP'], expected)
            self.assertEqual(result['penetration'], 50 - expected)
            self.assertEqual(result['steps'][0]['outerSP'], sp)
            self.assertEqual(set(result['steps'][0]),
                             {'layerId', 'innerSP', 'outerSP', 'difference', 'bonus', 'effectiveSP'})

    def test_sixteen_layers_and_aggregate_above_input_bound_remain_valid(self):
        layers = [layer(str(i), 1000) for i in range(16)]
        result = cover.resolve_protection(1000000, 1000, layers)
        self.assertEqual(len(result['steps']), 16)
        self.assertEqual([s['effectiveSP'] for s in result['steps']],
                         [1005, 1009, 1012, 1015, 1017, 1019, 1021, 1022,
                          1023, 1024, 1025, 1026, 1027, 1027, 1027, 1027])
        self.assertEqual(result['effectiveSP'], 1027)
        self.assertEqual(result['penetration'], 998973)


class DamageBeforeBTM(unittest.TestCase):
    def test_literal_armor_example_p101_without_cover(self):
        for raw, residual in ((14, 0), (18, 0), (22, 4)):
            result = cover.resolve_protection(raw, 18, [])
            self.assertEqual(result['penetration'], residual)
            self.assertEqual(result['penetrated'], residual > 0)
            self.assertEqual(result['steps'], [])

    def test_exact_effective_sp_stops_only_excess_penetrates_p102(self):
        for raw, residual, penetrated in [(0, 0, False), (20, 0, False),
                                          (21, 0, False), (22, 1, True), (50, 29, True)]:
            result = cover.resolve_protection(raw, 18, [layer('door', 5)])
            self.assertEqual(result['penetration'], residual)
            self.assertIs(result['penetrated'], penetrated)
            self.assertEqual(result['rawDamage'], raw)
            self.assertEqual(result['armorSP'], 18)

    def test_zero_damage_against_zero_protection_does_not_penetrate(self):
        result = cover.resolve_protection(0, 0, [])
        self.assertEqual(result['penetration'], 0)
        self.assertIs(result['penetrated'], False)

    def test_receipt_is_explicitly_before_btm_and_location_effects(self):
        result = cover.resolve_protection(30, 0, [])
        self.assertEqual(result['penetration'], 30)
        self.assertEqual(result['damageStage'], 'before-btm-and-location-effects')
        self.assertEqual(result['sourcePages'], [101, 102, 103])
        self.assertEqual(result['rulesVersion'], 'cp2020-core-cover-v1')

    def test_repeated_attacks_do_not_automatically_wear_armor_or_cover(self):
        layers = [layer('door', 5)]
        first = cover.resolve_protection(99, 18, layers)
        second = cover.resolve_protection(99, 18, layers)
        self.assertEqual(first, second)
        self.assertEqual(first['effectiveSP'], 21)
        self.assertEqual(layers, [layer('door', 5)])


class StrictValidationAndPurity(unittest.TestCase):
    def test_sp_inputs_reject_bool_fractional_negative_and_out_of_bound_values(self):
        invalid = [True, False, None, '', '5', 5.0, 5.5, -1, 1001,
                   float('nan'), float('inf'), -float('inf'), [], {}]
        for bad in invalid:
            with self.subTest(bad=bad):
                for args in [(bad, 5), (5, bad)]:
                    with self.assertRaises(ValueError):
                        cover.combine_sp(*args)
                with self.assertRaises(ValueError):
                    cover.resolve_protection(10, bad, [])
                with self.assertRaises(ValueError):
                    cover.resolve_protection(10, 5, [layer('door', bad)])

    def test_raw_damage_is_strict_nonnegative_integer_with_explicit_bound(self):
        for bad in [True, False, None, '10', 10.0, 10.5, -1, 1000001,
                    float('nan'), float('inf'), -float('inf'), [], {}]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    cover.resolve_protection(bad, 5, [])
        self.assertEqual(cover.resolve_protection(1000000, 0, [])['penetration'], 1000000)

    def test_cover_collection_must_be_an_explicit_bounded_ordered_list(self):
        for bad in [None, {}, (), 'door', 5, True, {1, 2},
                    [layer(str(i), 1) for i in range(17)]]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    cover.resolve_protection(10, 5, bad)

    def test_layer_schema_does_not_silently_accept_special_ammo_or_structural_hp(self):
        invalid = [None, [], 'door', 5, {'id': 'door'}, {'sp': 5}, {},
                   dict(id='door', sp=5, hp=20), dict(id='door', sp=5, ammo='AP'),
                   dict(id='door', sp=5, material='steel'), dict(id='door', sp=5, extra=None)]
        for bad in invalid:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    cover.resolve_protection(10, 5, [bad])

    def test_layer_ids_are_nonblank_strings_and_unique(self):
        for bad in ['', ' ', '\n\t', 3, True, False, None, [], {}]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    cover.resolve_protection(10, 5, [layer(bad, 5)])
        with self.assertRaises(ValueError):
            cover.resolve_protection(10, 5, [layer('same', 0), layer('same', 5)])
        result = cover.resolve_protection(10, 5, [layer(' дверь ', 5)])
        self.assertEqual(result['steps'][0]['layerId'], ' дверь ')

    def test_valid_inputs_remain_unchanged_and_result_has_no_input_aliases(self):
        layers = [layer('inner', 5), layer('outer', 10)]
        original = copy.deepcopy(layers)
        result = cover.resolve_protection(30, 5, layers)
        self.assertEqual(layers, original)
        layers[0]['sp'] = 999
        layers.reverse()
        self.assertEqual(result['steps'][0]['outerSP'], 5)
        result['steps'][0]['outerSP'] = 200
        result['steps'][0]['layerId'] = 'changed'
        self.assertEqual(layers[1], layer('inner', 999))
        another = cover.resolve_protection(30, 5, original)
        self.assertEqual(another['steps'][0]['outerSP'], 5)
        self.assertEqual(another['steps'][0]['layerId'], 'inner')

    def test_invalid_later_layer_does_not_change_prior_input(self):
        layers = [layer('valid', 5), dict(id='invalid', sp=5, hp=20)]
        original = copy.deepcopy(layers)
        with self.assertRaises(ValueError):
            cover.resolve_protection(30, 5, layers)
        self.assertEqual(layers, original)

    def test_result_is_json_compatible_and_every_call_has_fresh_metadata(self):
        first = cover.resolve_protection(30, 5, [layer('door', 5)])
        self.assertEqual(json.loads(json.dumps(first)), first)
        first['sourcePages'].append(999)
        first['steps'].clear()
        second = cover.resolve_protection(30, 5, [layer('door', 5)])
        self.assertEqual(second['sourcePages'], [101, 102, 103])
        self.assertEqual(len(second['steps']), 1)


if __name__ == '__main__':
    unittest.main()
