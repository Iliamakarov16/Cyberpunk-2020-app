"""Personal vision geometry; independent of authorization and shot mechanics."""

from concurrent.futures import ThreadPoolExecutor
import copy
from fractions import Fraction
import itertools
import json
from pathlib import Path
import random
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'android/app/src/main/python'))
import battle_vision as vision


def scene(width=9, height=9, walls=()):
    result = dict(width=width, height=height,
                  tiles=[[dict(type='floor') for _ in range(width)] for _ in range(height)],
                  props=[], actors=[])
    for x, y in walls:
        result['tiles'][y][x] = dict(type='wall')
    return result


def view(state, x, y):
    return vision.visible_cells(state, dict(x=x, y=y))


def oracle_intersects(origin, target, cell):
    """Independent exact rational segment/closed-square intersection oracle."""
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


def oracle_visible(state, origin):
    cells = [(x, y) for y in range(state['height']) for x in range(state['width'])]
    opaque = [p for p in cells if state['tiles'][p[1]][p[0]]['type'] == 'wall' or
              (state['tiles'][p[1]][p[0]]['type'] == 'door' and not state['tiles'][p[1]][p[0]]['open'])]
    if origin in opaque:
        return frozenset()
    return frozenset(target for target in cells if not any(
        cell != target and oracle_intersects(origin, target, cell) for cell in opaque))


class BattleVisionGeometry(unittest.TestCase):
    def setUp(self):
        vision._visible_cells.cache_clear()

    def test_empty_map_all_directions_edges_and_no_invented_range(self):
        state = scene(60, 60)
        expected = frozenset(itertools.product(range(60), repeat=2))
        for origin in [(0, 0), (59, 59), (0, 59), (59, 0), (29, 30)]:
            self.assertEqual(view(state, *origin), expected)
        # Scale and arbitrary perception/range/facing metadata cannot introduce
        # a canonical vision distance or combine this with weapon range.
        state.update(tileMeters=10, lighting='dark', visionRange=1)
        observer = dict(x=0, y=0, facing=0, stats=dict(perception=0), weapon=dict(range=1))
        self.assertEqual(vision.visible_cells(state, observer), expected)
        self.assertEqual(view(scene(1, 1), 0, 0), frozenset({(0, 0)}))

    def test_first_wall_visible_everything_straight_behind_hidden(self):
        for axis in ('horizontal', 'vertical'):
            state = scene(walls=[(4, 4)])
            origin = (1, 4) if axis == 'horizontal' else (4, 1)
            visible = view(state, *origin)
            self.assertIn((4, 4), visible)
            for offset in range(5, 9):
                self.assertNotIn((offset, 4) if axis == 'horizontal' else (4, offset), visible)
            self.assertIn(origin, visible)

    def test_opaque_row_and_column_do_not_reveal_far_side(self):
        state = scene(walls=[(4, y) for y in range(9)])
        left, right = view(state, 1, 4), view(state, 7, 4)
        self.assertTrue(all(x <= 4 for x, _ in left))
        self.assertTrue(all(x >= 4 for x, _ in right))
        self.assertIn((4, 4), left & right)
        transposed = scene(walls=[(x, 4) for x in range(9)])
        self.assertEqual({(y, x) for x, y in left}, view(transposed, 4, 1))

    def test_closed_door_visible_open_door_passes_and_reclose_updates(self):
        state = scene(walls=[(4, y) for y in range(9)])
        state['tiles'][4][4] = dict(type='door', open=False)
        closed = view(state, 1, 4)
        self.assertIn((4, 4), closed)
        self.assertNotIn((7, 4), closed)
        state['tiles'][4][4]['open'] = True
        opened = view(state, 1, 4)
        self.assertIn((7, 4), opened)
        self.assertLess(closed, opened)
        state['tiles'][4][4]['open'] = False
        self.assertEqual(view(state, 1, 4), closed)

    def test_all_diagonal_corner_orientations_are_closed(self):
        for sx, sy in itertools.product((-1, 1), repeat=2):
            for blockers in [[(4 + sx, 4), (4, 4 + sy)], [(4 + sx, 4)], [(4, 4 + sy)]]:
                with self.subTest(sx=sx, sy=sy, blockers=blockers):
                    state = scene(walls=blockers)
                    visible = view(state, 4, 4)
                    self.assertNotIn((4 + sx, 4 + sy), visible)
                    self.assertNotIn((4 + 3 * sx, 4 + 3 * sy), visible)
                    for blocker in blockers:
                        self.assertIn(blocker, visible)
                    # Mutual visibility is symmetric for non-opaque endpoints.
                    self.assertNotIn((4, 4), view(state, 4 + 3 * sx, 4 + 3 * sy))

    def test_non_45_degree_corner_ties_and_narrow_slopes_are_exact(self):
        # (0.5,0.5) -> (3.5,1.5) touches the corner between (1,1) and (2,0).
        for blocker in [(1, 1), (2, 0)]:
            state = scene(7, 5, [blocker])
            self.assertNotIn((3, 1), view(state, 0, 0))
        for target in [(59, 1), (59, 58), (1, 59), (58, 59)]:
            state = scene(60, 60, [(30, 1), (1, 30), (30, 29), (29, 30)])
            self.assertEqual(target in view(state, 0, 0), target in oracle_visible(state, (0, 0)))

    def test_closed_door_corner_blocks_and_open_door_corner_does_not(self):
        state = scene(4, 4)
        state['tiles'][0][1] = dict(type='door', open=False)
        self.assertNotIn((2, 2), view(state, 0, 0))
        state['tiles'][0][1]['open'] = True
        self.assertIn((2, 2), view(state, 0, 0))

    def test_sealed_room_only_interior_and_visible_boundary(self):
        walls = {(x, y) for x in range(1, 8) for y in range(1, 8)
                 if x in (1, 7) or y in (1, 7)}
        visible = view(scene(walls=walls), 4, 4)
        self.assertTrue(all(1 <= x <= 7 and 1 <= y <= 7 for x, y in visible))
        self.assertTrue({(x, y) for x in range(2, 7) for y in range(2, 7)} <= visible)
        self.assertTrue({(1, 4), (4, 1), (7, 4), (4, 7)} <= visible)

    def test_every_3_by_3_wall_topology_against_independent_exact_oracle(self):
        cells = list(itertools.product(range(3), repeat=2))
        for mask in range(1 << len(cells)):
            walls = [cell for index, cell in enumerate(cells) if mask & (1 << index)]
            state = scene(3, 3, walls)
            for origin in cells:
                self.assertEqual(view(state, *origin), oracle_visible(state, origin), (mask, origin))

    def test_rotation_reflection_and_floor_endpoint_reciprocity(self):
        rng = random.Random(314159)
        for _ in range(8):
            walls = {(x, y) for x in range(7) for y in range(7) if rng.random() < .23}
            state = scene(7, 7, walls)
            cells = set(itertools.product(range(7), repeat=2)) - walls
            views = {cell: view(state, *cell) for cell in cells}
            for a, b in itertools.product(cells, repeat=2):
                self.assertEqual(b in views[a], a in views[b], (a, b, walls))
            for transform in [lambda x, y: (6 - y, x), lambda x, y: (6 - x, y), lambda x, y: (y, x)]:
                transformed = scene(7, 7, [transform(*cell) for cell in walls])
                origin = min(cells)
                self.assertEqual({transform(*cell) for cell in views[origin]}, view(transformed, *transform(*origin)))

    def test_adding_opaque_cells_cannot_reveal_more_cells(self):
        rng = random.Random(271828)
        state = scene(12, 8)
        visible = view(state, 1, 1)
        cells = [(x, y) for y in range(8) for x in range(12) if (x, y) != (1, 1)]
        rng.shuffle(cells)
        for x, y in cells:
            state['tiles'][y][x] = dict(type='wall')
            updated = view(state, 1, 1)
            self.assertLessEqual(updated, visible)
            visible = updated

    def test_two_doors_in_series_require_both_to_be_open(self):
        state = scene(9, 3)
        for y in range(3):
            for x in (3, 5):
                state['tiles'][y][x] = dict(type='wall')
        for first, second in itertools.product((False, True), repeat=2):
            state['tiles'][1][3] = dict(type='door', open=first)
            state['tiles'][1][5] = dict(type='door', open=second)
            visible = view(state, 1, 1)
            self.assertIn((3, 1), visible)
            self.assertEqual((5, 1) in visible, first)
            self.assertEqual((7, 1) in visible, first and second)

    def test_low_cover_props_actors_and_cameras_never_block_or_share_sight(self):
        state = scene(walls=[(4, y) for y in range(9)])
        before = view(state, 1, 4)
        state['props'] = [dict(type=kind, x=2, y=4, w=2, h=2, cover=True)
                          for kind in ('table', 'counter', 'barrel', 'crate', 'car', 'van')]
        state['actors'] = [dict(id='other', x=7, y=4, team='crew', ownerId=1)]
        state['devices'] = [dict(type='camera', x=7, y=4, active=True, range=60)]
        self.assertEqual(view(state, 1, 4), before)
        self.assertNotIn((7, 4), before)
        self.assertIn((7, 4), view(state, 7, 4))

    def test_missing_invalid_and_opaque_observer_fail_closed(self):
        state = scene(walls=[(4, 4)])
        observers = [None, [], 'actor-id', (1, 1), {}, {'x': 1}, {'y': 1}, dict(x=4, y=4)]
        for value in [True, False, 1.0, '1', None, [], {}, -1, 9, 10**100]:
            observers.extend([dict(x=value, y=1), dict(x=1, y=value)])
        for observer in observers:
            with self.subTest(observer=observer):
                self.assertEqual(vision.visible_cells(state, observer), frozenset())
        state['tiles'][4][4] = dict(type='door', open=False)
        self.assertEqual(view(state, 4, 4), frozenset())
        state['tiles'][4][4]['open'] = True
        self.assertIn((4, 4), view(state, 4, 4))
        self.assertEqual(vision._visible_cells.cache_info().misses, 1)

    def test_malformed_or_oversize_map_fails_closed_before_raycast(self):
        malformed = [None, [], {}, dict(width=1, height=1), dict(width=61, height=1, tiles=None),
                     dict(width=1, height=10**100, tiles=None)]
        for key in ('width', 'height'):
            for value in (True, False, 0, -1, 61, '9', 9.0, None):
                invalid = scene(); invalid[key] = value; malformed.append(invalid)
        for tiles in (None, {}, [], [[dict(type='floor')]], [None] * 9,
                      [[dict(type='floor')] * 8] * 9):
            invalid = scene(); invalid['tiles'] = tiles; malformed.append(invalid)
        for tile in (None, 'floor', {}, {'type': []}, {'type': 'fog'}, {'type': 'door'},
                     {'type': 'door', 'open': 1}, {'type': 'door', 'open': 'false'}):
            invalid = scene(); invalid['tiles'][8][8] = tile; malformed.append(invalid)
        with patch.object(vision, '_visible_cells', side_effect=AssertionError('Must validate first')):
            for state in malformed:
                with self.subTest(state=state):
                    self.assertEqual(vision.visible_cells(state, dict(x=0, y=0)), frozenset())

    def test_pure_immutable_cache_and_topology_invalidation_without_versions(self):
        state = scene(); observer = dict(x=1, y=4, id='private', ownerId=123)
        before = copy.deepcopy(state), copy.deepcopy(observer)
        first = vision.visible_cells(state, observer)
        self.assertIsInstance(first, frozenset)
        with self.assertRaises(AttributeError):
            first.add((1, 1))
        self.assertEqual((state, observer), before)
        equivalent = copy.deepcopy(state)
        equivalent.update(id='other-session', version=100, props=[dict(type='car')])
        equivalent['tiles'][0][0]['zone'] = 'new label'
        self.assertIs(vision.visible_cells(equivalent, dict(x=1, y=4, ownerId=999)), first)
        state['tiles'][4][4] = dict(type='wall')
        second = vision.visible_cells(state, observer)
        self.assertNotIn((7, 4), second)
        self.assertIn((7, 4), first)
        # Topology-equivalent wall/closed-door changes reuse only geometry.
        state['tiles'][4][4] = dict(type='door', open=False)
        self.assertIs(vision.visible_cells(state, observer), second)
        state['tiles'][4][4]['open'] = True
        self.assertIs(vision.visible_cells(state, observer), first)
        moved = vision.visible_cells(state, dict(x=2, y=4))
        self.assertEqual(moved, first)
        self.assertEqual(vision._visible_cells.cache_info().misses, 3)

    def test_cache_is_bounded_and_isolated_by_dimensions_topology_and_position(self):
        state = scene(9, 9)
        for x, y in itertools.product(range(9), repeat=2):
            view(state, x, y)
        info = vision._visible_cells.cache_info()
        self.assertEqual(info.maxsize, vision.VISIBILITY_CACHE_SIZE)
        self.assertEqual(info.currsize, vision.VISIBILITY_CACHE_SIZE)
        self.assertEqual(info.misses, 81)
        self.assertEqual(view(scene(3, 6), 0, 0), frozenset(itertools.product(range(3), range(6))))
        self.assertEqual(view(scene(6, 3), 0, 0), frozenset(itertools.product(range(6), range(3))))
        split = scene(walls=[(4, y) for y in range(9)])
        self.assertNotEqual(view(split, 1, 4), view(split, 7, 4))

    def test_concurrent_observers_and_maps_do_not_mix_results(self):
        states = [scene(), scene(walls=[(4, y) for y in range(9)])]
        requests = [(states[i % 2], 1 if i % 3 else 7, 4) for i in range(120)]
        expected = [view(*request) for request in requests]
        vision._visible_cells.cache_clear()
        with ThreadPoolExecutor(max_workers=8) as executor:
            actual = list(executor.map(lambda args: view(*args), requests))
        self.assertEqual(actual, expected)
        self.assertLessEqual(vision._visible_cells.cache_info().currsize, vision.VISIBILITY_CACHE_SIZE)

    def test_maximum_map_bounded_rays_and_cached_polling_performance(self):
        state = scene(60, 60)
        original = vision._clear_line
        started = time.monotonic()
        with patch.object(vision, '_clear_line', wraps=original) as ray:
            first = view(state, 0, 0)
            self.assertEqual(ray.call_count, 3600)
            for _ in range(100):
                self.assertIs(view(state, 0, 0), first)
            self.assertEqual(ray.call_count, 3600, 'Unchanged polling must never repeat the raycasts')
        # Intentionally generous for shared CI/mobile hosts; the strict bounds
        # above and the 60-cell dimension cap are the non-timing regression.
        self.assertLess(time.monotonic() - started, 5.0)
        self.assertEqual(len(first), 3600)


class BattleVisionLegacyFixtures(unittest.TestCase):
    def test_frozen_original_bar_doors_low_cover_and_unknown_office(self):
        output = subprocess.run(
            ['node', str(ROOT / 'tests/fixtures/shared_battle_reference/runner.mjs')],
            input=json.dumps([dict(operation='demo')]), text=True, capture_output=True, check=True)
        state = json.loads(output.stdout)[0]
        before = copy.deepcopy(state)
        ray = next(actor for actor in state['actors'] if actor['id'] == 'ray')
        visible = vision.visible_cells(state, ray)
        self.assertIn((16, 8), visible)  # Guard in the open bar.
        self.assertNotIn((19, 5), visible)  # Office guard behind its boundary.
        self.assertIn((8, 14), visible)  # Through the existing open entrance.
        self.assertEqual(state, before)
        no_props = dict(state, props=[])
        self.assertEqual(vision.visible_cells(no_props, ray), visible)
        # An observer outside the office sees its closed door but not through it.
        self.assertIn((18, 6), view(state, 18, 8))
        self.assertNotIn((18, 4), view(state, 18, 8))
        state['tiles'][6][18]['open'] = True
        self.assertIn((18, 4), view(state, 18, 8))

    def test_old_garage_scene_works_without_visibility_schema_or_migration(self):
        state = json.loads((ROOT / 'tests/fixtures/garage_vehicles_0174.scene.json').read_text())
        before = copy.deepcopy(state)
        visible = view(state, 0, 0)
        self.assertGreater(len(visible), 1)
        self.assertLess(len(visible), state['width'] * state['height'])
        self.assertEqual(visible, oracle_visible(state, (0, 0)))
        self.assertEqual(view(dict(state, props=[]), 0, 0), visible)
        self.assertEqual(state, before)


if __name__ == '__main__':
    unittest.main()
