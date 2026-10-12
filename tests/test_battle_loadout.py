"""Pure inventory-bound loadout, conservation, stale bindings and migration tests."""
import copy
import json
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'android/app/src/main/python'))
import battle_loadout as loadout


def sheet():
    return dict(items=[
        dict(id='gun-a', name='Custom A', category='weapon', quantity=1, equipped=False, icon='gear'),
        dict(id='gun-b', name='Custom B', category='weapon', quantity=3, equipped=False, icon='knife'),
        dict(id='blade', name='Custom C', category='weapon', quantity=1),
        dict(id='ammo-a', name='Rounds', category='ammo', quantity=24),
        dict(id='ammo-b', name='Other rounds', category='ammo', quantity=11),
        dict(id='other', name='Unrelated thing', category='gear', quantity=1)],
        skills=[dict(name='Handgun', stat='REF', rank=6), dict(name='Rifle', stat='REF', rank=3),
                dict(name='Melee', stat='REF', rank=4), dict(name='Fencing', stat='REF', rank=2),
                dict(name='Dance', stat='REF', rank=10)])


def profile(weapon_id='gun-a', **changes):
    value = dict(weaponId=weapon_id, kind='ranged', profileId='gm-book-entry', weaponType='handgun',
                 ammoItemId='ammo-a', skillName='Handgun', skillRank=6, damageDice=3,
                 damageBonus=1, accuracy=0, range=50, rof=2, magazine=8, loaded=6,
                 fireModes=['single'], singleActionCap=2, reliability='ST', fumbleClass='nonautomatic')
    value.update(changes)
    return value


def melee_profile(**changes):
    value = dict(weaponId='blade', kind='melee', profileId='gm-standard-melee', weaponType='standard',
                 skillKind='melee', skillName='Melee', skillRank=4, damageDice=2, damageBonus=1, accuracy=0)
    value.update(changes)
    return value


def state(data=None):
    return loadout.validate_loadout(data or sheet(), [profile(), profile('gun-b', loaded=5)],
                                    'gun-a', sheet_version=7)


def item(data, item_id):
    return next(row for row in data['items'] if row['id'] == item_id)


def weapon(value, weapon_id):
    return next(row for row in value['weapons'] if row['id'] == weapon_id)


class LoadoutAssertions(unittest.TestCase):
    def reject(self, operation, status=None):
        with self.assertRaises(loadout.LoadoutError) as result:
            operation()
        if status is not None:
            self.assertEqual(result.exception.status, status)
        self.assertTrue(result.exception.message)


class LoadoutTest(LoadoutAssertions):
    def test_empty_is_unarmed_and_no_implicit_selection(self):
        value = loadout.validate_loadout(sheet(), [], None)
        self.assertTrue(loadout.current_weapon(value)['unarmed'])
        self.assertEqual(value['ammoPools'], {})
        value = loadout.validate_loadout(sheet(), [profile()], None)
        self.assertTrue(loadout.current_weapon(value)['unarmed'])
        self.assertEqual(weapon(value, 'gun-a')['ammo'], 6)
        self.reject(lambda: loadout.validate_loadout(sheet(), [], 'gun-a'), 409)

    def test_actual_rows_explicit_profiles_and_no_name_icon_equipped_inference(self):
        data = sheet()
        data['items'][0].update(name='A rifle icon does not define rules', icon='rifle', quantity=9)
        before = copy.deepcopy(data)
        value = state(data)
        self.assertEqual(data, before)
        self.assertEqual(len(value['weapons']), 2)
        self.assertEqual(weapon(value, 'gun-a')['weaponType'], 'handgun')
        self.assertEqual(weapon(value, 'gun-a')['name'], data['items'][0]['name'])
        self.assertEqual(loadout.current_weapon(value)['skill'], 'selectedWeapon')
        self.assertEqual(loadout.current_weapon(value)['skillRank'], 6)

    def test_one_shared_reserve_different_magazines_and_detached_view(self):
        value = state()
        self.assertEqual(value['ammoPools'], {'ammo-a': 24})
        self.assertEqual(loadout.reserve_for(value, 'ammo-a'), 13)
        self.assertTrue(all('reserve' not in row for row in value['weapons']))
        view = loadout.current_weapon(value)
        view.update(ammo=999, reserve=999)
        view['fireModes'].append('auto')
        self.assertEqual(loadout.current_weapon(value)['ammo'], 6)
        switched = loadout.activate(value, 'gun-b')
        self.assertEqual(loadout.current_weapon(switched)['ammo'], 5)
        self.assertEqual(loadout.current_weapon(switched)['reserve'], 13)
        self.assertEqual(value['activeWeaponId'], 'gun-a')
        self.assertEqual(value['weapons'], switched['weapons'])
        self.assertEqual(value['ammoPools'], switched['ammoPools'])

    def test_consume_changes_loaded_and_total_but_not_reserve(self):
        value = state()
        before = copy.deepcopy(value)
        after, delta = loadout.consume(value, 'gun-a', 3)
        self.assertEqual(value, before)
        self.assertEqual(delta, {'ammoItemId': 'ammo-a', 'delta': -3})
        self.assertEqual(after['ammoPools']['ammo-a'], 21)
        self.assertEqual(weapon(after, 'gun-a')['ammo'], 3)
        self.assertEqual(weapon(after, 'gun-b')['ammo'], 5)
        self.assertEqual(loadout.reserve_for(after, 'ammo-a'), 13)
        self.assertEqual(loadout.validate_state(after), after)

    def test_reload_uses_shared_reserve_and_no_inventory_delta(self):
        value = state()
        after = loadout.reload(value, 'gun-a', 1)
        self.assertEqual(after['ammoPools'], value['ammoPools'])
        self.assertEqual(weapon(after, 'gun-a')['ammo'], 7)
        self.assertEqual(loadout.reserve_for(after, 'ammo-a'), 12)
        after = loadout.reload(loadout.activate(after, 'gun-b'), 'gun-b')
        self.assertEqual(weapon(after, 'gun-b')['ammo'], 8)
        self.assertEqual(loadout.reserve_for(after, 'ammo-a'), 9)
        self.assertEqual(weapon(value, 'gun-a')['ammo'], 6)

    def test_reload_cannot_borrow_loaded_rounds_from_another_weapon(self):
        data = sheet()
        item(data, 'ammo-a')['quantity'] = 11
        value = state(data)
        self.assertEqual(loadout.reserve_for(value, 'ammo-a'), 0)
        self.reject(lambda: loadout.reload(value, 'gun-a'), 409)
        self.reject(lambda: loadout.reload(loadout.activate(value, 'gun-b'), 'gun-b'), 409)

    def test_separate_pools_stay_separate(self):
        value = loadout.validate_loadout(sheet(), [profile(), profile('gun-b', ammoItemId='ammo-b', loaded=4)], 'gun-a')
        after, _ = loadout.consume(value, 'gun-a', 2)
        self.assertEqual(after['ammoPools'], {'ammo-a': 22, 'ammo-b': 11})
        after = loadout.reload(loadout.activate(after, 'gun-b'), 'gun-b')
        self.assertEqual(loadout.reserve_for(after, 'ammo-b'), 3)
        self.assertEqual(loadout.reserve_for(after, 'ammo-a'), 18)

    def test_zero_ammo_total_allowed_only_empty_magazines(self):
        data = sheet()
        item(data, 'ammo-a')['quantity'] = 0
        value = loadout.validate_loadout(data, [profile(loaded=0)], 'gun-a')
        self.assertEqual(loadout.current_weapon(value)['reserve'], 0)
        self.reject(lambda: loadout.consume(value, 'gun-a', 1), 409)
        self.reject(lambda: loadout.reload(value, 'gun-a'), 409)
        self.reject(lambda: loadout.validate_loadout(data, [profile(loaded=1)], 'gun-a'))

    def test_duplicate_weapon_ids_and_total_loaded_overcommit_rejected(self):
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(), profile()], 'gun-a'))
        data = sheet()
        item(data, 'ammo-a')['quantity'] = 10
        self.reject(lambda: state(data))
        data = sheet()
        data['items'].append(copy.deepcopy(data['items'][0]))
        self.reject(lambda: state(data))

    def test_foreign_missing_category_zero_quantity_ids(self):
        for change in ({'weaponId': 'foreign'}, {'ammoItemId': 'foreign'},
                       {'weaponId': 'other'}, {'ammoItemId': 'gun-b'},
                       {'weaponId': ' gun-a'}, {'ammoItemId': 'ammo-a '}):
            with self.subTest(change=change):
                self.reject(lambda: loadout.validate_loadout(sheet(), [profile(**change)], None))
        data = sheet()
        item(data, 'gun-a')['quantity'] = 0
        self.reject(lambda: state(data), 409)

    def test_actual_matching_combat_skill_or_explicit_untrained(self):
        for changes in ({'skillName': 'Rifle', 'skillRank': 3}, {'skillName': 'Dance', 'skillRank': 10},
                        {'skillName': 'Handgun', 'skillRank': 5}, {'skillName': '', 'skillRank': 1},
                        {'skillName': 'Missing', 'skillRank': 1}):
            with self.subTest(changes=changes):
                self.reject(lambda: loadout.validate_loadout(sheet(), [profile(**changes)], 'gun-a'))
        value = loadout.validate_loadout(sheet(), [profile(skillName='', skillRank=0)], 'gun-a')
        self.assertEqual(loadout.current_weapon(value)['skillRank'], 0)
        for stat in ('INT', None, 'ref'):
            data = sheet()
            data['skills'][0]['stat'] = stat
            self.reject(lambda: state(data), 409)
        data = sheet()
        data['skills'].append(copy.deepcopy(data['skills'][0]))
        self.reject(lambda: state(data), 409)

    def test_known_translated_skill_and_shotgun_use_rifle_family(self):
        data = sheet()
        data['skills'][1]['name'] = 'Винтовки и ружья'
        value = loadout.validate_loadout(data, [profile(weaponType='shotgun', skillName='Винтовки и ружья', skillRank=3)], 'gun-a')
        self.assertEqual(weapon(value, 'gun-a')['skillName'], 'Винтовки и ружья')

    def test_numeric_boundaries_reject_bool_float_string_negative_nan(self):
        for key in ('skillRank', 'damageDice', 'damageBonus', 'accuracy', 'range', 'rof', 'magazine', 'loaded', 'singleActionCap'):
            for bad in (True, False, 1.0, '1', None, [], {}, float('nan')):
                with self.subTest(key=key, bad=bad):
                    self.reject(lambda: loadout.validate_loadout(sheet(), [profile(**{key: bad})], 'gun-a'))
        for key, bad in (('skillRank', -1), ('damageDice', 0), ('damageDice', 21), ('damageBonus', -101),
                         ('accuracy', 11), ('range', 0), ('rof', 101), ('magazine', 0), ('loaded', -1),
                         ('loaded', 9), ('singleActionCap', 3)):
            self.reject(lambda: loadout.validate_loadout(sheet(), [profile(**{key: bad})], 'gun-a'))
        for bad in (True, False, -1, 1.1, '24', None, 100001):
            data = sheet()
            item(data, 'ammo-a')['quantity'] = bad
            self.reject(lambda: state(data))

    def test_exact_profile_and_explicit_modes_no_rof_inference(self):
        for missing in profile():
            value = profile()
            del value[missing]
            self.reject(lambda: loadout.validate_loadout(sheet(), [value], None))
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(unknown=True)], None))
        for bad in ([], ['single', 'single'], ['automatic'], ['single', {}], 'single', None, [True]):
            self.reject(lambda: loadout.validate_loadout(sheet(), [profile(fireModes=bad)], None))
        value = loadout.validate_loadout(sheet(), [profile(rof=30, singleActionCap=1, fireModes=['single', 'burst', 'auto'], fumbleClass='automatic')], 'gun-a')
        self.assertEqual(weapon(value, 'gun-a')['singleActionCap'], 1)
        self.assertEqual(weapon(value, 'gun-a')['rof'], 30)
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(fireModes=['burst'])], None))
        value = loadout.validate_loadout(sheet(), [profile(rof=30, fireModes=['auto'], singleActionCap=0, fumbleClass='automatic')], 'gun-a')
        self.assertEqual(weapon(value, 'gun-a')['fireModes'], ['auto'])
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(fireModes=['auto'], singleActionCap=1)], None))

    def test_reliability_and_fumble_class_are_explicit_not_inferred_from_rof(self):
        for reliability in ('VR', 'ST', 'UR'):
            value = loadout.validate_loadout(sheet(), [profile(reliability=reliability)], 'gun-a')
            self.assertEqual(weapon(value, 'gun-a')['reliability'], reliability)
        for key in ('reliability', 'fumbleClass'):
            for bad in (None, '', True, [], {}, 'unknown'):
                self.reject(lambda: loadout.validate_loadout(sheet(), [profile(**{key: bad})], 'gun-a'))
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(rof=30, fireModes=['auto'], singleActionCap=0)], 'gun-a'))
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(fireModes=['single', 'suppress'])], 'gun-a'))
        value = loadout.validate_loadout(sheet(), [profile(rof=30, fireModes=['suppress'], singleActionCap=0, fumbleClass='automatic')], 'gun-a')
        self.assertEqual(weapon(value, 'gun-a')['fireModes'], ['suppress'])
        value = loadout.validate_loadout(sheet(), [profile(rof=30, fumbleClass='automatic', singleActionCap=1)], 'gun-a')
        self.assertEqual(weapon(value, 'gun-a')['fireModes'], ['single'])
        self.assertEqual(weapon(value, 'gun-a')['fumbleClass'], 'automatic')

    def test_stale_inactive_foreign_actions_fail_without_mutation(self):
        value = state()
        before = copy.deepcopy(value)
        for weapon_id in ('foreign', 'gun-b', '', True, [], None):
            self.reject(lambda: loadout.consume(value, weapon_id, 1))
            self.reject(lambda: loadout.reload(value, weapon_id))
        for bad in (True, False, 0, -1, 7, 1.0, None, '1'):
            self.reject(lambda: loadout.consume(value, 'gun-a', bad))
        for bad in (True, False, 0, -1, 3, 1.0, '1'):
            self.reject(lambda: loadout.reload(value, 'gun-a', bad))
        self.reject(lambda: loadout.activate(value, 'foreign'), 409)
        self.assertEqual(value, before)
        switched = loadout.activate(value, 'gun-b')
        self.reject(lambda: loadout.consume(switched, 'gun-a', 1), 409)

    def test_binding_requires_version_exact_items_actual_skill_and_pool_total(self):
        value = state()
        self.assertTrue(loadout.validate_binding(value, sheet(), 7))
        for version in (6, 8, None, True, 7.0):
            self.reject(lambda: loadout.validate_binding(value, sheet(), version))
        for row_id, key, replacement in [('gun-a', 'quantity', 0), ('gun-a', 'name', 'Renamed'),
                                        ('gun-a', 'icon', 'pistol'), ('ammo-a', 'name', 'Wrong caliber'),
                                        ('ammo-a', 'quantity', 25), ('ammo-a', 'quantity', 23)]:
            data = sheet()
            item(data, row_id)[key] = replacement
            self.reject(lambda: loadout.validate_binding(value, data, 7), 409)
        data = sheet()
        data['items'] = [i for i in data['items'] if i['id'] != 'gun-b']
        self.reject(lambda: loadout.validate_binding(value, data, 7), 409)
        data = sheet()
        data['skills'][0]['rank'] = 5
        self.reject(lambda: loadout.validate_binding(value, data, 7), 409)

    def test_rebind_after_atomic_consume_accepts_only_exact_quantity_delta(self):
        initial = state()
        after, delta = loadout.consume(initial, 'gun-a', 2)
        data = sheet()
        self.reject(lambda: loadout.rebind(after, data, 8), 409)
        item(data, delta['ammoItemId'])['quantity'] += delta['delta']
        rebound = loadout.rebind(after, data, 8)
        self.assertEqual(rebound['sheetVersion'], 8)
        self.assertEqual(after['sheetVersion'], 7)
        self.assertTrue(loadout.validate_binding(rebound, data, 8))
        self.assertEqual(rebound['itemBindings'], initial['itemBindings'])
        item(data, 'gun-b')['name'] = 'Reused ID'
        self.reject(lambda: loadout.rebind(rebound, data, 9), 409)

    def test_unrelated_inventory_edit_still_requires_revision_refresh(self):
        initial = state()
        data = sheet()
        item(data, 'other')['quantity'] = 3
        self.reject(lambda: loadout.validate_binding(initial, data, 8), 409)
        # Adapter may refresh after its own successful CAS, never on external drift.
        updated = loadout.rebind(initial, data, 8)
        self.assertTrue(loadout.validate_binding(updated, data, 8))

    def test_rebind_cannot_erase_or_reverse_revision(self):
        value = state()
        for bad in (None, True, False, 7.0, '8', -1, 6):
            self.reject(lambda: loadout.rebind(value, sheet(), bad))
        self.assertEqual(loadout.rebind(value, sheet(), 7), value)

    def test_preparation_preserves_magazines_and_requires_explicit_reset(self):
        initial = state()
        same = loadout.validate_loadout(sheet(), [profile(), profile('gun-b', loaded=5)], 'gun-b', initial, sheet_version=7)
        self.assertEqual(same['weapons'], initial['weapons'])
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(loaded=8)], 'gun-a', initial), 409)
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(ammoItemId='ammo-b')], 'gun-a', initial), 409)
        reset = loadout.validate_loadout(sheet(), [profile(loaded=8)], 'gun-a', initial, reset_loaded=True)
        self.assertEqual(weapon(reset, 'gun-a')['ammo'], 8)
        self.assertEqual(reset['ammoPools']['ammo-a'], 24)
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile()], 'gun-a', initial, reset_loaded=1))
        data = sheet()
        item(data, 'ammo-a')['quantity'] = 5
        self.reject(lambda: loadout.validate_loadout(data, [profile(loaded=8)], 'gun-a', initial, reset_loaded=True))

    def test_removal_releases_loaded_to_same_pool_does_not_duplicate_and_undo_snapshot(self):
        initial = state()
        snapshot = loadout.serialize(initial)
        removed = loadout.remove_weapon(initial, 'gun-a')
        self.assertIsNone(removed['activeWeaponId'])
        self.assertEqual(removed['ammoPools'], initial['ammoPools'])
        self.assertEqual(loadout.reserve_for(removed, 'ammo-a'), 19)
        self.assertEqual(loadout.deserialize(snapshot), initial)
        self.reject(lambda: loadout.remove_weapon(removed, 'gun-a'), 409)
        removed = loadout.remove_weapon(removed, 'gun-b')
        self.assertEqual(loadout.reserve_for(removed, 'ammo-a'), 24)
        self.assertEqual(removed['itemBindings'].keys(), {'ammo-a'})
        self.assertTrue(loadout.validate_binding(removed, sheet(), 7))

    def test_standard_melee_fencing_only_and_no_ammo_pool(self):
        value = loadout.validate_loadout(sheet(), [melee_profile()], 'blade')
        self.assertEqual(value['ammoPools'], {})
        self.assertEqual(loadout.current_weapon(value)['skillKind'], 'melee')
        self.assertNotIn('reserve', loadout.current_weapon(value))
        self.reject(lambda: loadout.reload(value, 'blade'))
        self.reject(lambda: loadout.consume(value, 'blade', 1))
        value = loadout.validate_loadout(sheet(), [melee_profile(skillKind='fencing', skillName='Fencing', skillRank=2)], 'blade')
        self.assertEqual(loadout.current_weapon(value)['skillKind'], 'fencing')
        for changes in ({'weaponType': 'mono'}, {'weaponType': 'cyberbeast'}, {'skillKind': 'martialArts'},
                        {'skillKind': 'fencing'}, {'ammoItemId': 'ammo-a'}, {'damageDice': 0}):
            self.reject(lambda: loadout.validate_loadout(sheet(), [melee_profile(**changes)], 'blade'))

    def test_serialization_roundtrip_is_strict_and_detached(self):
        value = state()
        encoded = loadout.serialize(value)
        self.assertEqual(loadout.deserialize(encoded), value)
        self.assertEqual(encoded, loadout.serialize(loadout.deserialize(encoded)))
        restored = loadout.deserialize(encoded)
        restored['weapons'][0]['ammo'] = 0
        self.assertEqual(value['weapons'][0]['ammo'], 6)
        for raw in ('{}', '[]', 'null', '', '{"schemaVersion":1,"schemaVersion":1}',
                    encoded.replace('"schemaVersion":1', '"schemaVersion":true'),
                    encoded.replace('"ammo":6', '"ammo":NaN'), ' ' * 256001, None,
                    '[' * 1500 + ']' * 1500):
            self.reject(lambda: loadout.deserialize(raw))

    def test_state_rejects_tampered_reserve_binding_and_selection(self):
        initial = state()
        mutations = [lambda v: v.update(activeWeaponId='foreign'),
                     lambda v: v.update(schemaVersion=True),
                     lambda v: v.update(legacy=1),
                     lambda v: v['weapons'][0].update(reserve=999),
                     lambda v: v['weapons'][0].update(ammo=True),
                     lambda v: v['weapons'][0].update(ammo=9),
                     lambda v: v['weapons'][0].update(skill='handgun'),
                     lambda v: v['ammoPools'].update({'ammo-a': 10}),
                     lambda v: v['ammoPools'].update({'ammo-a': False}),
                     lambda v: v['itemBindings'].pop('gun-a'),
                     lambda v: v['itemBindings'].update({'gun-a': 'not-a-hash'}),
                     lambda v: v.update(unknown=True)]
        for mutate in mutations:
            value = copy.deepcopy(initial)
            mutate(value)
            self.reject(lambda: loadout.validate_state(value))

    def test_size_bounds(self):
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile()] * 41, None))
        self.reject(lambda: loadout.validate_loadout(sheet(), [profile(profileId='x' * 101)], None))
        self.reject(lambda: loadout.validate_loadout(sheet(), [], None, sheet_version=True))
        self.reject(lambda: loadout.validate_loadout(sheet(), [], None, sheet_version=-1))
        for bad in ('\ud800', 'line\nbreak', '   '):
            self.reject(lambda: loadout.validate_loadout(sheet(), [profile(profileId=bad)], None))

    def test_malformed_json_types_fail_as_loadout_errors_not_uncaught_exceptions(self):
        malformed = [None, True, False, -1, 1.5, '', 'foreign', [], {}, [[]], {'x': 1}]
        for raw in malformed:
            if not isinstance(raw, dict):
                self.reject(lambda: loadout.validate_loadout(raw, [], None))
            self.reject(lambda: loadout.validate_loadout(sheet(), [raw], None))
            self.reject(lambda: loadout.validate_state(raw))
        original = state()
        for key in original:
            for bad in malformed:
                value = copy.deepcopy(original)
                value[key] = bad
                try:
                    checked = loadout.validate_state(value)
                except loadout.LoadoutError:
                    continue
                # Legitimate null/empty values may be legal for some fields.
                self.assertEqual(loadout.deserialize(loadout.serialize(checked)), checked)
        for key in profile():
            for bad in malformed:
                value = profile(**{key: bad})
                try:
                    checked = loadout.validate_loadout(sheet(), [value], None)
                except loadout.LoadoutError:
                    continue
                self.assertEqual(loadout.validate_state(checked), checked)


class LegacyAndSequences(LoadoutAssertions):
    def legacy(self):
        return dict(id='gun-a', weaponId='gun-a', name='Custom A', skill='handgun', skillName='Handgun',
                    skillRank=6, damageDice=3, damageBonus=1, accuracy=0, range=50, rof=30,
                    magazine=8, ammo=6, reserve=18, ammoItemId='ammo-a')

    def test_legacy_migration_never_refills_or_infers_modes_from_rof(self):
        original = self.legacy()
        before = copy.deepcopy(original)
        value = loadout.migrate_weapon(original, 7, data=sheet())
        self.assertEqual(original, before)
        view = loadout.current_weapon(value)
        self.assertEqual((view['ammo'], view['reserve'], view['rof']), (6, 18, 30))
        self.assertEqual(view['fireModes'], ['single'])
        self.assertEqual(view['singleActionCap'], 1)
        self.assertTrue(view['legacy'])
        self.assertIsNone(view['reliability'])
        self.assertIsNone(view['fumbleClass'])
        self.assertTrue(loadout.validate_binding(value, sheet(), 7))
        self.assertEqual(loadout.deserialize(loadout.serialize(value)), value)
        with_modes = copy.deepcopy(value)
        with_modes['weapons'][0]['fireModes'].append('auto')
        self.reject(lambda: loadout.validate_state(with_modes))

    def test_legacy_unbound_or_stale_counts_cannot_be_used_as_live_inventory(self):
        value = loadout.migrate_weapon(self.legacy(), 7)
        self.reject(lambda: loadout.validate_binding(value, sheet(), 7), 409)
        old = self.legacy()
        old['reserve'] = 17
        self.reject(lambda: loadout.migrate_weapon(old, 7, data=sheet()), 409)
        npc = self.legacy()
        npc.pop('ammoItemId')
        npc.pop('weaponId')
        value = loadout.migrate_weapon(npc)
        self.assertTrue(loadout.current_weapon(value)['ammoItemId'].startswith('legacy-ammo-'))
        self.assertEqual(loadout.current_weapon(value)['reserve'], 18)
        self.reject(lambda: loadout.validate_binding(value, sheet()), 409)

    def test_legacy_unarmed_zero_and_bad_counts(self):
        for raw in (None, {'unarmed': True}):
            value = loadout.migrate_weapon(raw)
            self.assertTrue(loadout.current_weapon(value)['unarmed'])
            self.assertEqual(value['weapons'], [])
        for key in ('ammo', 'reserve', 'magazine', 'rof', 'skillRank'):
            for bad in (True, -1, '1', 1.1, None):
                value = self.legacy()
                value[key] = bad
                self.reject(lambda: loadout.migrate_weapon(value))
        for bad in (True, False, 0, ''):
            value = self.legacy()
            value['weaponId'] = bad
            self.reject(lambda: loadout.migrate_weapon(value))
        for field in ('ammo', 'reserve'):
            for bad in (True, -1, 1, '0'):
                self.reject(lambda: loadout.migrate_weapon({'unarmed': True, field: bad}))

    def test_deterministic_long_mixed_sequences_conserve_all_rounds(self):
        # Independent accounting across switches, reloads, shots, removals and
        # snapshot restore catches reserve duplication that happy paths miss.
        rng = random.Random(2020)
        for trial in range(24):
            current = state()
            fired = 0
            snapshots = []
            for step in range(200):
                options = current['weapons']
                action = rng.choice(('activate', 'consume', 'reload', 'snapshot', 'restore', 'remove'))
                if action == 'snapshot':
                    snapshots.append((loadout.serialize(current), fired))
                elif action == 'restore' and snapshots:
                    raw, fired = snapshots.pop()
                    current = loadout.deserialize(raw)
                elif action == 'remove' and options and rng.random() < .08:
                    current = loadout.remove_weapon(current, rng.choice(options)['id'])
                elif action == 'activate' and options:
                    current = loadout.activate(current, rng.choice(options)['id'])
                elif current['activeWeaponId'] is not None:
                    selected = loadout.current_weapon(current)
                    if action == 'consume' and selected['ammo']:
                        count = rng.randint(1, selected['ammo'])
                        current, delta = loadout.consume(current, selected['id'], count)
                        self.assertEqual(delta['delta'], -count)
                        fired += count
                    elif action == 'reload' and selected['reserve'] and selected['ammo'] < selected['magazine']:
                        current = loadout.reload(current, selected['id'])
                self.assertEqual(current['ammoPools']['ammo-a'] + fired, 24, (trial, step))
                loaded = sum(w['ammo'] for w in current['weapons'])
                reserve = loadout.reserve_for(current, 'ammo-a')
                self.assertGreaterEqual(reserve, 0)
                self.assertEqual(loaded + reserve + fired, 24, (trial, step))
                self.assertEqual(loadout.validate_state(current), current)


if __name__ == '__main__':
    unittest.main()
