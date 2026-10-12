"""Cover ray geometry, exact protection ordering and configured prop vision.

Material/SP and zone profiles are explicit fixtures, not canonical furniture
statistics. Core pp. 101–103 numerical SP expectations use battle_cover's
separate source-verified kernel. Visible hit-location selection belongs to the
authoritative adapter; this module tests the exposed-zone information it uses.
"""

import copy
from fractions import Fraction
import itertools
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / 'android/app/src/main/python'
sys.path.insert(0, str(PYTHON))
import battle_ballistics as ballistics
import battle_cover
import battle_cover_scene
import battle_vision


def scene(width=10, height=7):
    return dict(width=width, height=height,
                tiles=[[dict(type='floor') for _ in range(width)] for _ in range(height)],
                props=[], actors=[], devices=[])


def profile(**changes):
    result = dict(material='GM-selected material', sp=5,
                  coveredZones=['torso'], blocksVision=False, movable=False,
                  flippedCoveredZones=['rightLeg', 'leftLeg'], flippedBlocksVision=True)
    result.update(changes)
    return result


def prop(identifier='cover', x=3, y=3, **changes):
    result = dict(id=identifier, type='crate', x=x, y=y, w=1, h=1,
                  cover=True, protection=profile())
    result.update(changes)
    return result


def tile(kind='wall', sp=5, material='GM-selected wall', **changes):
    result = dict(type=kind, protection=dict(material=material, sp=sp))
    result.update(changes)
    return result


def trace(state, actor=None, target=None):
    return ballistics.trace_cover(state, dict(x=0, y=3) if actor is None else actor,
                                  dict(x=8, y=3) if target is None else target)


def oracle_intersects(origin, target, cell):
    """Independent exact rational segment / closed unit-square oracle."""
    low, high = Fraction(0), Fraction(1)
    for a, b, c in zip(origin, target, cell):
        delta = 2 * (b - a)
        left, right = 2 * c - (2 * a + 1), 2 * c + 2 - (2 * a + 1)
        if not delta:
            if not left <= 0 <= right:
                return False
            continue
        first, last = sorted((Fraction(left, delta), Fraction(right, delta)))
        low, high = max(low, first), min(high, last)
        if low > high:
            return False
    return True


class ConfiguredZoneCoverage(unittest.TestCase):
    def test_open_ray_exposes_all_zones_and_has_no_protection(self):
        result = trace(scene())
        self.assertEqual(result, dict(barriers=[], blocked=False,
                                      exposed=list(ballistics.ZONES), cover=None))
        self.assertEqual(ballistics.protection_layers(result, 'torso'), [])

    def test_explicit_zones_are_independent_of_opacity_legacy_flag_and_sp(self):
        for opaque, legacy_cover, sp, zones in itertools.product(
                (False, True), (False, True), (0, 5), ([], ['head'], ['torso', 'leftArm'])):
            state = scene()
            state['props'] = [prop(cover=legacy_cover, protection=profile(
                sp=sp, coveredZones=zones, blocksVision=opaque))]
            result = trace(state)
            self.assertIs(result['blocked'], opaque)
            self.assertEqual(result['exposed'], [z for z in ballistics.ZONES if z not in zones])
            self.assertEqual(len(result['barriers']), int(bool(zones) or opaque))
            for location in ballistics.ZONES:
                self.assertEqual(ballistics.protection_layers(result, location),
                                 [dict(id='prop:cover', sp=sp)] if location in zones else [])

    def test_configured_cover_applies_along_ray_without_an_adjacency_guess(self):
        state = scene()
        state['props'] = [prop(x=2, protection=profile(coveredZones=['head', 'torso']))]
        result = trace(state)
        self.assertEqual(result['exposed'], ['rightArm', 'leftArm', 'rightLeg', 'leftLeg'])
        self.assertEqual(ballistics.protection_layers(result, 'head'), [dict(id='prop:cover', sp=5)])

    def test_off_ray_configured_prop_contributes_neither_cover_nor_opacity(self):
        state = scene()
        state['props'] = [prop(y=2, protection=profile(blocksVision=True,
                                                     coveredZones=list(ballistics.ZONES)))]
        self.assertEqual(trace(state), trace(scene()))

    def test_flipped_profile_uses_exact_zones_and_opacity_without_changing_material_sp(self):
        state = scene()
        state['props'] = [prop(type='table', w=2, h=1, facing=90,
                               protection=profile(movable=True, sp=20,
                                                  coveredZones=['rightLeg'],
                                                  flippedCoveredZones=['torso', 'leftArm']))]
        flat = trace(state)
        state['props'][0]['flipped'] = True
        flipped = trace(state)
        self.assertFalse(flat['blocked'])
        self.assertTrue(flipped['blocked'])
        self.assertEqual(flat['barriers'][0]['coveredZones'], ['rightLeg'])
        self.assertEqual(flipped['barriers'][0]['coveredZones'], ['torso', 'leftArm'])
        self.assertEqual(flat['barriers'][0]['sp'], flipped['barriers'][0]['sp'])
        self.assertEqual(flat['barriers'][0]['material'], flipped['barriers'][0]['material'])

    def test_multiple_profiles_union_exposure_but_only_location_layers_protect(self):
        state = scene()
        state['props'] = [prop('far', x=2, protection=profile(sp=10, coveredZones=['head'])),
                          prop('near', x=6, protection=profile(sp=5, coveredZones=['torso']))]
        result = trace(state)
        self.assertEqual(result['exposed'], ['rightArm', 'leftArm', 'rightLeg', 'leftLeg'])
        self.assertEqual(ballistics.protection_layers(result, 'head'), [dict(id='prop:far', sp=10)])
        self.assertEqual(ballistics.protection_layers(result, 'torso'), [dict(id='prop:near', sp=5)])
        self.assertEqual(ballistics.protection_layers(result, 'leftLeg'), [])


class WallAndDoorLayers(unittest.TestCase):
    def test_closed_door_blocks_all_zones_open_door_contributes_nothing(self):
        for configured, opened in itertools.product((False, True), (False, True)):
            state = scene()
            door = dict(type='door', open=opened)
            if configured:
                door['protection'] = dict(material='GM-selected steel', sp=20)
            state['tiles'][3][4] = door
            result = trace(state)
            self.assertIs(result['blocked'], not opened)
            self.assertEqual(result['exposed'], list(ballistics.ZONES) if opened else [])
            if opened:
                self.assertEqual(ballistics.protection_layers(result, 'torso'), [])
            elif configured:
                self.assertEqual(ballistics.protection_layers(result, 'torso'),
                                 [dict(id='tile:4:3', sp=20)])
            else:
                with self.assertRaisesRegex(ValueError, 'not configured'):
                    ballistics.protection_layers(result, 'torso')

    def test_adjacent_identical_wall_cells_form_one_numerical_layer(self):
        state = scene()
        for x in (2, 3, 4):
            state['tiles'][3][x] = tile()
        result = trace(state)
        self.assertEqual(len(result['barriers']), 1)
        self.assertEqual(result['barriers'][0]['enter'], 1.5 / 8)
        self.assertEqual(result['barriers'][0]['exit'], 4.5 / 8)
        layers = ballistics.protection_layers(result, 'torso')
        self.assertEqual(layers, [dict(id='tile:2:3', sp=5)])
        receipt = battle_cover.resolve_protection(30, 18, layers)
        self.assertEqual((receipt['effectiveSP'], receipt['penetration']), (21, 9))

    def test_identical_walls_separated_by_floor_remain_two_layers(self):
        state = scene()
        state['tiles'][3][2] = tile()
        state['tiles'][3][4] = tile()
        result = trace(state)
        layers = ballistics.protection_layers(result, 'torso')
        self.assertEqual(layers, [dict(id='tile:4:3', sp=5), dict(id='tile:2:3', sp=5)])
        receipt = battle_cover.resolve_protection(30, 18, layers)
        self.assertEqual((receipt['effectiveSP'], receipt['penetration']), (23, 7))

    def test_adjacent_walls_different_material_or_sp_never_merge(self):
        for material, sp in (('another material', 5), ('GM-selected wall', 6),
                             ('another material', 6)):
            state = scene()
            state['tiles'][3][2] = tile()
            state['tiles'][3][3] = tile(sp=sp, material=material)
            result = trace(state)
            self.assertEqual(len(result['barriers']), 2)
            self.assertEqual(ballistics.protection_layers(result, 'torso'),
                             [dict(id='tile:3:3', sp=sp), dict(id='tile:2:3', sp=5)])

    def test_doors_never_merge_with_same_profile_wall_or_each_other(self):
        for kinds in (('wall', 'door'), ('door', 'wall'), ('door', 'door')):
            state = scene()
            for x, kind in zip((2, 3), kinds):
                state['tiles'][3][x] = tile(kind=kind, **({'open': False} if kind == 'door' else {}))
            result = trace(state)
            self.assertEqual(len(result['barriers']), 2)
            self.assertEqual(len(ballistics.protection_layers(result, 'torso')), 2)

    def test_open_door_is_a_gap_between_identical_walls(self):
        state = scene()
        state['tiles'][3][2] = tile()
        state['tiles'][3][3] = tile(kind='door', open=True)
        state['tiles'][3][4] = tile()
        self.assertEqual(len(trace(state)['barriers']), 2)

    def test_zero_sp_is_configured_absence_without_erasing_geometric_barrier(self):
        state = scene()
        state['tiles'][3][4] = tile(sp=0)
        result = trace(state)
        self.assertTrue(result['blocked'])
        self.assertEqual(result['exposed'], [])
        layers = ballistics.protection_layers(result, 'torso')
        self.assertEqual(layers, [dict(id='tile:4:3', sp=0)])
        receipt = battle_cover.resolve_protection(25, 18, layers)
        self.assertEqual((receipt['effectiveSP'], receipt['penetration']), (18, 7))

    def test_unknown_wall_sp_never_becomes_zero_or_invented_material(self):
        state = scene()
        state['tiles'][3][4] = dict(type='wall')
        result = trace(state)
        self.assertIsNone(result['barriers'][0]['sp'])
        self.assertIsNone(result['barriers'][0]['material'])
        for location in ballistics.ZONES:
            with self.assertRaisesRegex(ValueError, 'not configured'):
                ballistics.protection_layers(result, location)


class TargetOutwardProtection(unittest.TestCase):
    def test_physical_order_not_prop_input_order_or_sp_sort_controls_numeric_result(self):
        state = scene()
        far = prop('far', x=2, protection=profile(sp=10))
        near = prop('near', x=6, protection=profile(sp=5))
        for props in ([far, near], [near, far]):
            state['props'] = props
            result = trace(state)
            self.assertEqual([item['id'] for item in result['barriers']], ['prop:far', 'prop:near'])
            layers = ballistics.protection_layers(result, 'torso')
            self.assertEqual(layers, [dict(id='prop:near', sp=5), dict(id='prop:far', sp=10)])
            receipt = battle_cover.resolve_protection(30, 5, layers)
            self.assertEqual((receipt['effectiveSP'], receipt['penetration']), (15, 15))
            reverse = battle_cover.resolve_protection(30, 5, list(reversed(layers)))
            self.assertEqual(reverse['effectiveSP'], 17)

    def test_reversing_shot_reverses_physical_layer_order(self):
        state = scene()
        state['props'] = [prop('left', x=2), prop('right', x=6)]
        forward = ballistics.protection_layers(trace(state), 'torso')
        reverse = ballistics.protection_layers(trace(state, dict(x=8, y=3), dict(x=0, y=3)), 'torso')
        self.assertEqual(forward, list(reversed(reverse)))

    def test_mixed_prop_wall_door_layers_are_ordered_target_outward(self):
        state = scene()
        state['props'] = [prop('near', x=6, protection=profile(sp=10))]
        state['tiles'][3][2] = tile(kind='door', open=False, sp=20)
        state['tiles'][3][4] = tile(sp=5)
        self.assertEqual(ballistics.protection_layers(trace(state), 'torso'),
                         [dict(id='prop:near', sp=10), dict(id='tile:4:3', sp=5),
                          dict(id='tile:2:3', sp=20)])

    def test_layer_limit_applies_to_hit_location_not_unrelated_coverage(self):
        state = scene(60)
        state['props'] = [prop(str(i), x=1 + 2 * i) for i in range(17)]
        result = trace(state, target=dict(x=59, y=3))
        self.assertEqual(ballistics.protection_layers(result, 'head'), [])
        with self.assertRaisesRegex(ValueError, '16'):
            ballistics.protection_layers(result, 'torso')
        state['props'].pop()
        self.assertEqual(len(ballistics.protection_layers(
            trace(state, target=dict(x=59, y=3)), 'torso')), 16)

    def test_unknown_location_is_rejected_without_coercion(self):
        result = trace(scene())
        for value in ('Torso', 'leg', 'random', None, True, [], {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ballistics.protection_layers(result, value)


class CornerTraversal(unittest.TestCase):
    def test_non_45_degree_sealed_corner_blocks_from_both_sides(self):
        for point in ((1, 1), (2, 0)):
            state = scene(5, 3)
            state['tiles'][point[1]][point[0]] = tile()
            for origin, target in (((0, 0), (3, 1)), ((3, 1), (0, 0))):
                result = trace(state, dict(zip(('x', 'y'), origin)), dict(zip(('x', 'y'), target)))
                self.assertTrue(result['blocked'])
                self.assertEqual(len(result['barriers']), 1)
                self.assertEqual(result['barriers'][0]['enter'], .5)
                self.assertEqual(result['barriers'][0]['exit'], .5)
                self.assertNotIn(target, battle_vision.visible_cells(state, dict(zip(('x', 'y'), origin))))

    def test_corner_touching_identical_wall_intervals_merge_as_one_solid_barrier(self):
        state = scene(5, 3)
        for x, y in ((1, 0), (1, 1), (2, 0), (2, 1)):
            state['tiles'][y][x] = tile()
        result = trace(state, dict(x=0, y=0), dict(x=3, y=1))
        self.assertEqual(len(result['barriers']), 1)
        self.assertAlmostEqual(result['barriers'][0]['enter'], 1 / 6)
        self.assertAlmostEqual(result['barriers'][0]['exit'], 5 / 6)

    def test_single_wall_intersections_match_independent_rational_oracle(self):
        cells = list(itertools.product(range(5), repeat=2))
        for origin in ((0, 0), (0, 4), (4, 0), (4, 4)):
            for target in cells:
                if target == origin:
                    continue
                for blocker in cells:
                    if blocker in (origin, target):
                        continue
                    state = scene(5, 5)
                    state['tiles'][blocker[1]][blocker[0]] = tile()
                    result = trace(state, dict(zip(('x', 'y'), origin)),
                                   dict(zip(('x', 'y'), target)))
                    self.assertEqual(bool(result['barriers']), oracle_intersects(origin, target, blocker),
                                     (origin, target, blocker))

    def test_prop_corner_contact_matches_tile_and_geometric_vision(self):
        for point in ((1, 1), (2, 0)):
            state = scene(5, 3)
            state['props'] = [prop(x=point[0], y=point[1],
                                   protection=profile(blocksVision=True))]
            result = trace(state, dict(x=0, y=0), dict(x=3, y=1))
            self.assertTrue(result['blocked'])
            self.assertNotIn((3, 1), battle_vision.visible_cells(state, dict(x=0, y=0)))


class LegacyAdjacentExposure(unittest.TestCase):
    def test_legacy_near_target_cover_hides_only_legs_without_material_sp(self):
        state = scene()
        legacy = prop(x=7)
        del legacy['protection']
        state['props'] = [legacy]
        result = trace(state)
        self.assertFalse(result['blocked'])
        self.assertEqual(result['exposed'], ['head', 'torso', 'rightArm', 'leftArm'])
        self.assertEqual(result['barriers'][0]['coveredZones'], ['rightLeg', 'leftLeg'])
        self.assertIsNone(result['barriers'][0]['sp'])
        self.assertEqual(ballistics.protection_layers(result, 'torso'), [])
        for location in ('rightLeg', 'leftLeg'):
            with self.assertRaisesRegex(ValueError, 'not configured'):
                ballistics.protection_layers(result, location)

    def test_legacy_prop_far_from_target_or_not_on_ray_does_not_hide_legs(self):
        for x, y, cover in ((2, 3, True), (6, 3, True), (7, 2, True), (7, 3, False)):
            state = scene()
            legacy = prop(x=x, y=y, cover=cover)
            del legacy['protection']
            state['props'] = [legacy]
            self.assertEqual(trace(state), trace(scene()))

    def test_legacy_diagonal_adjacency_still_requires_ray_intersection(self):
        state = scene(5, 5)
        legacy = prop(x=2, y=1)
        del legacy['protection']
        state['props'] = [legacy]
        result = trace(state, dict(x=0, y=0), dict(x=3, y=2))
        self.assertEqual(result['exposed'], ['head', 'torso', 'rightArm', 'leftArm'])


class BallisticsPurity(unittest.TestCase):
    def test_scene_and_actor_inputs_remain_unchanged_and_receipts_are_detached(self):
        state = scene()
        state['props'] = [prop('near', x=6)]
        state['tiles'][3][2] = tile()
        state['tiles'][3][3] = tile()
        observer, target = dict(x=0, y=3), dict(x=8, y=3)
        saved = copy.deepcopy((state, observer, target))
        first, second = trace(state, observer, target), trace(state, observer, target)
        self.assertEqual(first, second)
        self.assertEqual(json.loads(json.dumps(first)), first)
        first['barriers'][-1]['coveredZones'].append('head')
        first['barriers'][0]['sp'] = 999
        first['cover']['coveredZones'].clear()
        self.assertEqual((state, observer, target), saved)
        self.assertEqual(second, trace(state, observer, target))
        self.assertEqual(first['barriers'][-1]['coveredZones'], ['torso', 'head'])
        self.assertEqual(first['cover']['sp'], 5)

    def test_layers_are_fresh_and_unknown_sp_failure_does_not_mutate(self):
        state = scene()
        state['props'] = [prop()]
        result = trace(state)
        saved = copy.deepcopy(result)
        layers = ballistics.protection_layers(result, 'torso')
        layers[0]['sp'] = 999
        self.assertEqual(result, saved)
        state['tiles'][3][5] = dict(type='wall')
        result = trace(state)
        saved = copy.deepcopy(result)
        with self.assertRaises(ValueError):
            ballistics.protection_layers(result, 'torso')
        self.assertEqual(result, saved)


class ConfiguredPropVision(unittest.TestCase):
    def setUp(self):
        battle_vision._visible_cells.cache_clear()

    def test_valid_helper_opacity_matches_vision_independent_of_sp_zones_or_legacy_flag(self):
        for flipped, opaque, sp, zones, cover in itertools.product(
                (False, True), (False, True), (0, 20), ([], ['head']), (False, True)):
            state = scene()
            item = prop(type='table', w=2, h=1, facing=90, flipped=flipped, cover=cover,
                        protection=profile(movable=True, sp=sp, coveredZones=zones,
                                           flippedCoveredZones=zones, blocksVision=opaque,
                                           flippedBlocksVision=not opaque))
            state['props'] = [item]
            selected = battle_cover_scene.active_prop_protection(item)['blocksVision']
            cells = battle_vision.visible_cells(state, dict(x=0, y=3))
            self.assertEqual((8, 3) in cells, not selected)
            self.assertEqual(trace(state)['blocked'], selected)
            self.assertIn((3, 3), cells)  # First opaque face remains visible.

    def test_flip_and_edit_update_visibility_cache_without_mutating_state(self):
        state = scene()
        item = prop(type='table', w=2, h=1, facing=90,
                    protection=profile(movable=True))
        state['props'] = [item]
        observer = dict(x=0, y=3)
        self.assertIn((8, 3), battle_vision.visible_cells(state, observer))
        item['flipped'] = True
        saved = copy.deepcopy(state)
        self.assertNotIn((8, 3), battle_vision.visible_cells(state, observer))
        self.assertEqual(state, saved)
        item['protection']['flippedBlocksVision'] = False
        self.assertIn((8, 3), battle_vision.visible_cells(state, observer))
        item['protection']['flippedBlocksVision'] = True
        self.assertNotIn((8, 3), battle_vision.visible_cells(state, observer))

    def test_observer_inside_configured_opaque_prop_fails_closed(self):
        state = scene()
        state['props'] = [prop(protection=profile(blocksVision=True))]
        self.assertEqual(battle_vision.visible_cells(state, dict(x=3, y=3)), frozenset())

    def test_malformed_prop_collections_fail_closed(self):
        for bad in (None, {}, 'props', True, 1, [None], [True], ['prop']):
            state = scene()
            state['props'] = bad
            with self.subTest(bad=bad):
                self.assertEqual(battle_vision.visible_cells(state, dict(x=0, y=3)), frozenset())

    def test_malformed_configured_profiles_fail_closed_like_frozen_helper(self):
        bad_props = []
        for key in profile():
            item = prop()
            del item['protection'][key]
            bad_props.append(item)
        for changes in (dict(sp=True), dict(sp=-1), dict(sp=1001), dict(material=' '),
                        dict(coveredZones=['unknown']), dict(coveredZones=['torso', 'torso']),
                        dict(blocksVision=0), dict(flippedBlocksVision=0), dict(movable=True),
                        dict(extra='unexpected')):
            bad_props.append(prop(protection=profile(**changes)))
        for malformed in (None, True, [], 'wood'):
            bad_props.append(prop(protection=malformed))
        bad_props.extend((prop(flipped='false'), prop(flipped=True),
                          prop(type='table', flipped=True, w=2, h=2, facing=90,
                               protection=profile(movable=True))))
        for item in bad_props:
            state = scene()
            state['props'] = [item]
            with self.subTest(item=item):
                with self.assertRaises(ValueError):
                    battle_cover_scene.active_prop_protection(item)
                self.assertEqual(battle_vision.visible_cells(state, dict(x=0, y=3)), frozenset())

    def test_explicit_malformed_legacy_flipped_flags_fail_closed_even_when_false_like(self):
        for value in (0, None, '', [], {}, 'false', 1):
            item = prop(flipped=value)
            del item['protection']
            state = scene()
            state['props'] = [item]
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    battle_cover_scene.validate_prop_state(item)
                self.assertEqual(battle_vision.visible_cells(state, dict(x=0, y=3)), frozenset())
        item['flipped'] = False
        self.assertIn((8, 3), battle_vision.visible_cells(state, dict(x=0, y=3)))

    def test_configured_geometry_fails_closed_even_when_transparent(self):
        for opaque, key, value in itertools.product((False, True), ('x', 'y', 'w', 'h'),
                                                    (None, True, '3', 3.0, -1, 100)):
            state = scene()
            state['props'] = [prop(protection=profile(blocksVision=opaque), **{key: value})]
            with self.subTest(opaque=opaque, key=key, value=value):
                self.assertEqual(battle_vision.visible_cells(state, dict(x=0, y=3)), frozenset())
        for key in ('w', 'h'):
            state = scene()
            state['props'] = [prop(**{key: 0})]
            self.assertEqual(battle_vision.visible_cells(state, dict(x=0, y=3)), frozenset())

    def test_importing_modules_in_either_order_does_not_create_a_cycle_failure(self):
        for imports in ('import battle_cover_scene; import battle_vision; import battle_ballistics',
                        'import battle_vision; import battle_ballistics; import battle_cover_scene'):
            completed = subprocess.run([sys.executable, '-c',
                                        'import sys; sys.path.insert(0, %r); %s' % (str(PYTHON), imports)],
                                       capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == '__main__':
    unittest.main()
