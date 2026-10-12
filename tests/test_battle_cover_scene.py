"""Explicit cover profiles and conservative, pure table-flip grid geometry.

Core pp. 101–103 define material SP/proportional protection, not universal
table HP, wear, coverage or a grid flip simulation. The source-verified kernel
owns that SP arithmetic; this scene layer never adds a second implementation.
"""

import ast
import copy
import itertools
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / 'android/app/src/main/python'
sys.path.insert(0, str(PYTHON))
import battle_cover_scene as cover_scene


def profile(**changes):
    result = dict(material='GM-selected wood', sp=5,
                  coveredZones=['rightLeg', 'leftLeg'], blocksVision=False,
                  movable=True, flippedCoveredZones=['torso', 'rightArm', 'leftArm',
                                                     'rightLeg', 'leftLeg'],
                  flippedBlocksVision=True)
    result.update(changes)
    return result


def table(**changes):
    result = dict(id='table', type='table', x=3, y=3, w=3, h=2,
                  cover=True, label='Стол', protection=profile())
    result.update(changes)
    return result


def scene(prop=None, width=10, height=10):
    return dict(width=width, height=height,
                tiles=[[dict(type='floor') for _ in range(width)] for _ in range(height)],
                props=[table() if prop is None else prop], actors=[], devices=[])


def actor(x=4, y=2, **changes):
    result = dict(id='actor', x=x, y=y, status='active')
    result.update(changes)
    return result


def footprint(prop):
    return {(x, y) for y in range(prop['y'], prop['y'] + prop['h'])
            for x in range(prop['x'], prop['x'] + prop['w'])}


def flip(state=None, observer=None, prop_id='table', facing=90):
    return cover_scene.preview_flip(scene() if state is None else state,
                                    actor() if observer is None else observer,
                                    prop_id, facing)


class StrictCoverProfiles(unittest.TestCase):
    def test_existing_source_body_zones_match_without_importing_server_state(self):
        source = ast.parse((PYTHON / 'shared_battle.py').read_text(encoding='utf-8'))
        zones = next(ast.literal_eval(node.value) for node in source.body
                     if isinstance(node, ast.Assign) and
                     any(isinstance(target, ast.Name) and target.id == 'ZONES'
                         for target in node.targets))
        self.assertEqual(list(cover_scene.ZONES), zones)

    def test_all_profile_fields_are_explicit_and_exact(self):
        expected = profile()
        self.assertEqual(cover_scene.validate_prop_protection(expected), expected)
        for name in expected:
            broken = dict(expected)
            del broken[name]
            with self.subTest(missing=name), self.assertRaises(ValueError):
                cover_scene.validate_prop_protection(broken)
        for name in ('hp', 'sdp', 'wear', 'armorDamage', 'ammo', 'extra'):
            with self.subTest(extra=name), self.assertRaises(ValueError):
                cover_scene.validate_prop_protection(dict(expected, **{name: 1}))
        for bad in (None, [], (), 'wood', 5, True):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_prop_protection(bad)

    def test_material_is_an_explicit_nonblank_bounded_label(self):
        for bad in ('', ' ', '\n\t', 'x' * 101, 1, True, None, [], {}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_prop_protection(profile(material=bad))
            with self.subTest(tile_bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_tile_protection(dict(material=bad, sp=5))
        for material in (' стеклопластик ', 'x' * 100):
            self.assertEqual(cover_scene.validate_prop_protection(
                profile(material=material))['material'], material)

    def test_sp_is_strict_bounded_integer_not_a_material_lookup(self):
        for bad in (-1, 1001, True, False, 5.0, 5.5, '5', None,
                    float('nan'), float('inf'), [], {}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_prop_protection(profile(sp=bad))
            with self.subTest(tile_bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_tile_protection(dict(material='wood', sp=bad))
        for sp in (0, 1, 5, 20, 1000):
            self.assertEqual(cover_scene.validate_prop_protection(profile(sp=sp))['sp'], sp)
            self.assertEqual(cover_scene.validate_tile_protection(
                dict(material='GM choice', sp=sp))['sp'], sp)

    def test_boolean_flags_never_coerce_values(self):
        for name in ('blocksVision', 'movable', 'flippedBlocksVision'):
            for bad in (0, 1, 'true', 'false', None, [], {}):
                with self.subTest(name=name, bad=bad), self.assertRaises(ValueError):
                    cover_scene.validate_prop_protection(profile(**{name: bad}))

    def test_zone_lists_allow_empty_but_reject_unknown_duplicate_and_coerced_values(self):
        for name in ('coveredZones', 'flippedCoveredZones'):
            for zones in ([], ['head'], list(cover_scene.ZONES), list(reversed(cover_scene.ZONES))):
                self.assertEqual(cover_scene.validate_prop_protection(
                    profile(**{name: zones}))[name], zones)
            for bad in (None, (), {}, 'torso', [True], ['Torso'], ['leg'],
                        ['torso', 'torso'], [None], [[]], [{}], list(cover_scene.ZONES) * 2):
                with self.subTest(name=name, bad=bad), self.assertRaises(ValueError):
                    cover_scene.validate_prop_protection(profile(**{name: bad}))

    def test_tile_profile_has_exactly_material_and_sp(self):
        expected = dict(material='GM-selected wall', sp=20)
        self.assertEqual(cover_scene.validate_tile_protection(expected), expected)
        for bad in ({}, {'material': 'wood'}, {'sp': 5}, profile(),
                    dict(expected, hp=10), dict(expected, blocksVision=True),
                    None, [], 'wood', True):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_tile_protection(bad)

    def test_profile_validation_is_detached_and_failure_is_pure(self):
        source = profile()
        saved = copy.deepcopy(source)
        result = cover_scene.validate_prop_protection(source)
        self.assertEqual(source, saved)
        result['coveredZones'].append('head')
        result['flippedCoveredZones'].clear()
        result['sp'] = 900
        self.assertEqual(source, saved)
        invalid = profile(flippedBlocksVision='yes')
        saved = copy.deepcopy(invalid)
        with self.assertRaises(ValueError):
            cover_scene.validate_prop_protection(invalid)
        self.assertEqual(invalid, saved)
        tile = dict(material='wood', sp=5)
        result = cover_scene.validate_tile_protection(tile)
        result['sp'] = 0
        self.assertEqual(tile['sp'], 5)


class ActiveProtection(unittest.TestCase):
    def test_old_props_remain_unconfigured_without_implicit_table_sp(self):
        for flipped in (None, False):
            prop = table()
            del prop['protection']
            if flipped is not None:
                prop['flipped'] = flipped
            self.assertIsNone(cover_scene.active_prop_protection(prop))
            self.assertEqual(cover_scene.validate_prop_state(prop), prop)

    def test_flat_and_flipped_profiles_select_only_explicit_coverage_and_opacity(self):
        prop = table()
        self.assertEqual(cover_scene.active_prop_protection(prop),
                         dict(material='GM-selected wood', sp=5,
                              coveredZones=['rightLeg', 'leftLeg'], blocksVision=False))
        prop.update(flipped=True, facing=90, h=1)
        self.assertEqual(cover_scene.active_prop_protection(prop),
                         dict(material='GM-selected wood', sp=5,
                              coveredZones=profile()['flippedCoveredZones'], blocksVision=True))

    def test_opacity_coverage_zero_sp_and_legacy_cover_flag_are_independent(self):
        for opaque, cover, sp, zones in itertools.product((False, True), (False, True),
                                                          (0, 5), ([], ['head'])):
            prop = table(cover=cover, protection=profile(
                blocksVision=opaque, sp=sp, coveredZones=zones))
            active = cover_scene.active_prop_protection(prop)
            self.assertEqual(active['coveredZones'], zones)
            self.assertEqual(active['sp'], sp)
            self.assertIs(active['blocksVision'], opaque)
            self.assertIn('protection', prop)

    def test_non_tables_can_have_protection_but_cannot_claim_mobility_or_flip(self):
        for kind in ('counter', 'barrel', 'crate', 'car', 'van'):
            prop = table(type=kind, protection=profile(movable=False))
            self.assertEqual(cover_scene.active_prop_protection(prop)['sp'], 5)
            with self.assertRaises(ValueError):
                cover_scene.validate_prop_state(table(type=kind))
            prop.update(flipped=True, facing=90, h=1)
            with self.assertRaises(ValueError):
                cover_scene.validate_prop_state(prop)

    def test_flipped_state_is_strict_and_requires_configured_movable_table(self):
        for bad in (0, 1, 'true', None, [], {}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_prop_state(table(flipped=bad))
        unconfigured = table(flipped=True, facing=90, h=1)
        del unconfigured['protection']
        for prop in (unconfigured, table(flipped=True, facing=90, h=1,
                                        protection=profile(movable=False))):
            with self.assertRaises(ValueError):
                cover_scene.validate_prop_state(prop)

    def test_persisted_flipped_geometry_requires_matching_cardinal_edge(self):
        for facing in cover_scene.FACINGS:
            prop = table(flipped=True, facing=facing)
            prop['w' if facing in (0, 180) else 'h'] = 1
            self.assertEqual(cover_scene.validate_prop_state(prop), prop)
            prop['w' if facing in (0, 180) else 'h'] = 2
            with self.assertRaises(ValueError):
                cover_scene.validate_prop_state(prop)
        for bad in (None, 1, True, 0.0, '90', 45, 360, -90):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cover_scene.validate_prop_state(table(flipped=True, facing=bad, w=1, h=1))

    def test_full_copy_preserves_metadata_and_active_output_has_no_aliases(self):
        prop = table(metadata={'kept': ['original']})
        saved = copy.deepcopy(prop)
        result = cover_scene.validate_prop_state(prop)
        result['metadata']['kept'].append('changed')
        result['protection']['coveredZones'].clear()
        active = cover_scene.active_prop_protection(prop)
        active['coveredZones'].clear()
        self.assertEqual(prop, saved)


class TableFlipGeometry(unittest.TestCase):
    def test_horizontal_table_flips_to_north_or_south_far_edge(self):
        cases = [(90, actor(4, 2), dict(x=3, y=4, w=3, h=1)),
                 (270, actor(4, 5), dict(x=3, y=3, w=3, h=1))]
        for facing, observer, expected in cases:
            with self.subTest(facing=facing):
                result = flip(observer=observer, facing=facing)
                self.assertEqual(result['footprint'], expected)
                self.assertEqual({k: result['after'][k] for k in expected}, expected)
                self.assertTrue(result['after']['flipped'])
                self.assertEqual(result['after']['facing'], facing)
                self.assertEqual(result['actionCost'], 1)
                self.assertEqual(result['propId'], 'table')

    def test_vertical_table_flips_to_east_or_west_far_edge(self):
        state = scene(table(w=2, h=3))
        for facing, observer, expected in (
                (0, actor(2, 4), dict(x=4, y=3, w=1, h=3)),
                (180, actor(5, 4), dict(x=3, y=3, w=1, h=3))):
            with self.subTest(facing=facing):
                self.assertEqual(flip(state, observer, facing=facing)['footprint'], expected)

    def test_square_table_permits_all_cardinal_edges(self):
        state = scene(table(w=2, h=2))
        for facing, observer, expected in (
                (0, actor(2, 3), dict(x=4, y=3, w=1, h=2)),
                (90, actor(3, 2), dict(x=3, y=4, w=2, h=1)),
                (180, actor(5, 4), dict(x=3, y=3, w=1, h=2)),
                (270, actor(4, 5), dict(x=3, y=3, w=2, h=1))):
            with self.subTest(facing=facing):
                self.assertEqual(flip(state, observer, facing=facing)['footprint'], expected)

    def test_one_cell_thickness_needs_no_fictional_translation(self):
        for prop, observer, facing in ((table(w=2, h=1), actor(3, 2), 90),
                                       (table(w=1, h=2), actor(2, 3), 0),
                                       (table(w=1, h=1), actor(3, 4), 270)):
            state = scene(prop)
            result = flip(state, observer, facing=facing)
            self.assertEqual(footprint(result['before']), footprint(result['after']))
            self.assertNotEqual(cover_scene.active_prop_protection(result['before']),
                                cover_scene.active_prop_protection(result['after']))

    def test_all_sizes_and_directions_remain_in_original_footprint_and_map(self):
        for w, h in itertools.product(range(1, 8), repeat=2):
            prop = table(x=1, y=1, w=w, h=h)
            observers = {0: actor(0, 1), 90: actor(1, 0),
                         180: actor(1 + w, 1), 270: actor(1, 1 + h)}
            for facing in cover_scene.FACINGS:
                with self.subTest(w=w, h=h, facing=facing):
                    if w > h and facing in (0, 180) or h > w and facing in (90, 270):
                        with self.assertRaises(ValueError):
                            flip(scene(prop), observers[facing], facing=facing)
                        continue
                    result = flip(scene(prop), observers[facing], facing=facing)
                    self.assertLessEqual(footprint(result['after']), footprint(prop))
                    self.assertEqual(cover_scene.validate_prop_state(result['after']), result['after'])
                    self.assertEqual(len(footprint(result['after'])), w if facing in (90, 270) else h)

    def test_any_direct_contact_cell_is_allowed_but_no_diagonal_or_wrong_side(self):
        for x in range(3, 6):
            self.assertEqual(flip(observer=actor(x, 2))['actionCost'], 1)
        for point in ((2, 2), (6, 2), (4, 1), (4, 5), (2, 3), (6, 3), (4, 3)):
            with self.subTest(point=point), self.assertRaises(ValueError):
                flip(observer=actor(*point))

    def test_no_reach_from_wall_or_any_door_even_when_open(self):
        for tile in (dict(type='wall'), dict(type='door', open=False),
                     dict(type='door', open=True)):
            state = scene()
            state['tiles'][2][4] = tile
            with self.subTest(tile=tile), self.assertRaises(ValueError):
                flip(state)

    def test_contact_wall_is_not_reachable_just_because_first_opaque_cell_is_visible(self):
        state = scene()
        state['tiles'][3][4] = dict(type='wall')
        self.assertIn((4, 3), cover_scene.battle_vision.visible_cells(state, actor()))
        with self.assertRaises(ValueError):
            flip(state)

    def test_existing_visibility_geometry_is_checked_without_facing_restriction(self):
        state = scene()
        with patch.object(cover_scene.battle_vision, 'visible_cells', return_value=frozenset()) as check:
            with self.assertRaises(ValueError):
                flip(state)
            check.assert_called_once_with(state, actor())
        self.assertEqual(flip(observer=actor(4, 2, heading=270))['actionCost'], 1)

    def test_nonfloor_collision_in_final_and_released_swept_cells_rejects(self):
        for point, tile in itertools.product(((3, 3), (3, 4)),
                                             (dict(type='wall'), dict(type='door', open=False),
                                              dict(type='door', open=True))):
            state = scene()
            state['tiles'][point[1]][point[0]] = tile
            with self.subTest(point=point, tile=tile), self.assertRaises(ValueError):
                flip(state)

    def test_other_props_in_final_or_released_swept_cells_reject_but_edges_touch(self):
        for x, y in ((3, 3), (3, 4)):
            state = scene()
            state['props'].append(table(id='crate', type='crate', x=x, y=y,
                                        w=1, h=1, protection=profile(movable=False)))
            with self.subTest(x=x, y=y), self.assertRaises(ValueError):
                flip(state)
        state = scene()
        state['props'].append(table(id='other', x=6, y=3, w=1, h=1))
        self.assertEqual(flip(state)['actionCost'], 1)

    def test_live_actors_in_swept_area_block_corpses_remain_untouched(self):
        for x, y, status in itertools.product((3, 5), (3, 4), ('active', 'stunned', 'dead')):
            state = scene()
            state['actors'] = [actor(), actor(x, y, id='other', status=status)]
            saved = copy.deepcopy(state)
            if status == 'dead':
                self.assertEqual(flip(state)['actionCost'], 1)
            else:
                with self.assertRaises(ValueError):
                    flip(state)
            self.assertEqual(state, saved)

    def test_all_devices_block_swept_area_without_inventing_active_exceptions(self):
        for x, y, kind, active in itertools.product((3, 5), (3, 4),
                                                    ('port', 'door', 'camera', 'speaker'),
                                                    (False, True)):
            state = scene()
            state['devices'] = [dict(id='device', x=x, y=y, type=kind, active=active)]
            with self.subTest(x=x, y=y, kind=kind, active=active), self.assertRaises(ValueError):
                flip(state)

    def test_non_table_unconfigured_immovable_and_already_flipped_reject(self):
        unconfigured = table()
        del unconfigured['protection']
        for prop in (unconfigured, table(protection=profile(movable=False)),
                     table(type='car', protection=profile(movable=False)),
                     table(flipped=True, facing=90, h=1)):
            with self.subTest(prop=prop), self.assertRaises(ValueError):
                flip(scene(prop))

    def test_zero_sp_table_can_flip_without_restoring_sp_or_inventing_destruction(self):
        state = scene(table(protection=profile(sp=0)))
        result = flip(state)
        self.assertEqual(result['after']['protection']['sp'], 0)
        self.assertTrue(cover_scene.active_prop_protection(result['after'])['blocksVision'])
        self.assertEqual(set(result['after']) - set(result['before']), {'flipped', 'facing'})

    def test_actor_turn_status_and_authorization_belong_to_caller(self):
        for status in ('active', 'stunned', 'dead'):
            self.assertEqual(flip(observer=actor(status=status))['actionCost'], 1)

    def test_success_failure_repeated_previews_and_results_are_detached(self):
        state = scene(table(metadata={'notes': ['keep']}))
        observer = actor()
        saved_scene, saved_actor = copy.deepcopy(state), copy.deepcopy(observer)
        first, second = flip(state, observer), flip(state, observer)
        self.assertEqual(first, second)
        self.assertEqual(json.loads(json.dumps(first)), first)
        self.assertEqual(set(first), {'propId', 'before', 'after', 'footprint', 'actionCost'})
        first['after']['metadata']['notes'].append('changed')
        first['after']['protection']['coveredZones'].clear()
        first['before']['protection']['sp'] = 900
        first['footprint']['x'] = 99
        self.assertEqual(state, saved_scene)
        self.assertEqual(observer, saved_actor)
        self.assertEqual(second, flip(state, observer))
        self.assertEqual(first['after']['x'], 3)
        self.assertEqual(first['after']['protection']['sp'], 5)
        with self.assertRaises(ValueError):
            flip(state, actor(0, 0))
        self.assertEqual(state, saved_scene)


class MalformedFlipInputs(unittest.TestCase):
    def test_facing_and_prop_id_are_strict(self):
        for bad in (True, False, 90.0, '90', -90, 45, 360, None, [], {}):
            with self.subTest(facing=bad), self.assertRaises(ValueError):
                flip(facing=bad)
        for bad in (None, True, 1, [], {}, '', ' ', 'x' * 101, 'missing'):
            with self.subTest(prop_id=bad), self.assertRaises(ValueError):
                flip(prop_id=bad)

    def test_bounded_map_shape_tiles_and_door_boolean_fail_closed(self):
        variants = [None, [], True]
        for key in ('width', 'height'):
            for bad in (None, True, 10.0, '10', 0, -1, 61):
                state = scene()
                state[key] = bad
                variants.append(state)
        for bad in (None, [], {}, [[]], [None] * 10, scene()['tiles'][:-1]):
            state = scene()
            state['tiles'] = bad
            variants.append(state)
        for bad in (None, [], {'type': 'water'}, {'type': 'door'},
                    {'type': 'door', 'open': 1}):
            state = scene()
            state['tiles'][0][0] = bad
            variants.append(state)
        for state in variants:
            with self.subTest(state=state), self.assertRaises(ValueError):
                cover_scene.preview_flip(state, actor(), 'table', 90)

    def test_bad_actor_and_prop_geometry_fail_closed(self):
        for bad in (None, [], True, {}, {'x': True, 'y': 2},
                    {'x': 4, 'y': 2.0}, {'x': -1, 'y': 2}, {'x': 4, 'y': 10}):
            with self.subTest(actor=bad), self.assertRaises(ValueError):
                cover_scene.preview_flip(scene(), bad, 'table', 90)
        for key in ('x', 'y', 'w', 'h'):
            for bad in (None, True, '3', 3.0, -1, 11):
                with self.subTest(key=key, value=bad), self.assertRaises(ValueError):
                    flip(scene(table(**{key: bad})))
        for prop in (table(w=0), table(h=0), table(w=8), table(h=8)):
            with self.assertRaises(ValueError):
                flip(scene(prop))

    def test_malformed_collections_and_ambiguous_ids_fail_closed(self):
        for name in ('props', 'actors', 'devices'):
            for bad in (None, {}, (), True, [None]):
                state = scene()
                state[name] = bad
                with self.subTest(name=name, bad=bad), self.assertRaises(ValueError):
                    flip(state)
        state = scene()
        state['props'].append(table(x=7, y=7, w=1, h=1))
        with self.assertRaises(ValueError):
            flip(state)
        for name, maximum in (('props', 200), ('actors', 20), ('devices', 40)):
            state = scene()
            state[name] = [actor()] * (maximum + 1)
            with self.subTest(name=name), self.assertRaises(ValueError):
                flip(state)


if __name__ == '__main__':
    unittest.main()
