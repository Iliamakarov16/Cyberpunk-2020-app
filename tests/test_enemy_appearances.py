"""Real HTTP checks for cosmetic appearance IDs without additional NPC rules."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_battle_scene_templates as scene_tests
import test_mobile_host as fixtures
import shared_battle as battle


class EnemyAppearancesHTTP(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    sheet = scene_tests.SceneTemplatesHTTP.sheet
    party = scene_tests.SceneTemplatesHTTP.party
    command = scene_tests.SceneTemplatesHTTP.command
    begin = scene_tests.SceneTemplatesHTTP.begin
    database = scene_tests.SceneTemplatesHTTP.database
    snapshot = scene_tests.SceneTemplatesHTTP.snapshot
    preview = scene_tests.SceneTemplatesHTTP.preview
    reprepare = scene_tests.SceneTemplatesHTTP.reprepare
    scene_configs = scene_tests.SceneTemplatesHTTP.scene_configs

    def npc(self, result, name=None):
        return next(a for a in result['battle']['scene']['actors']
                    if a.get('origin', {}).get('kind') == 'npc' and (name is None or a['name'] == name))

    def assert_template(self, actor, template):
        """Freeze the original three rules templates independently of sprite."""
        stats = {
            'guard-rifle': (5, 4, 7, 0, 4, 3, 0),
            'solo-pistol': (7, 5, 8, 2, 4, 4, 0),
            'netrunner': (6, 6, 6, 0, 4, 2, 4),
        }
        expected_stats = dict(zip(('ref', 'ma', 'body', 'combatSense', 'handgun', 'rifle', 'interface'), stats[template]))
        self.assertEqual(actor['stats'], expected_stats)
        guard = template == 'guard-rifle'
        self.assertEqual(actor['armor'], dict(zip(battle.ZONES, (10, 14, 14, 14, 12, 12) if guard else (0, 18, 16, 16, 14, 14))))
        weapon = (dict(id='militech-ronin', name='Militech Ronin', category='Винтовка', skill='rifle',
                       accuracy=1, damageDice=5, damageBonus=0, magazine=35, rof=30, range=400, ammo=35, reserve=70)
                  if guard else dict(id='colt-amt2000', name='Colt AMT 2000', category='Пистолет', skill='handgun',
                                     accuracy=0, damageDice=4, damageBonus=1, magazine=8, rof=1, range=50, ammo=8, reserve=32))
        self.assertEqual(actor['weapon'], weapon)
        self.assertEqual(actor['origin'], dict(kind='npc', templateId=template))
        self.assertIsNone(actor['characterId'])
        self.assertIsNone(actor['sheetVersion'])
        self.assertEqual(actor['wounds'], 0)
        self.assertEqual(actor['destroyed'], [])
        if template == 'netrunner':
            self.assertEqual(actor['net'], dict(deck=True, programIds=['genie', 'crystalBall', 'soundmachine'],
                                               linkedPortId=None, knownDeviceIds=[], controlUsed=False))
        else:
            self.assertNotIn('net', actor)

    def test_all_twelve_appearances_keep_exactly_three_unchanged_templates(self):
        self.party(count=1, hidden=False)
        templates = self.gm_client.request(self.path)[1]['options']['npcTemplates']
        defaults = {'guard-rifle': 2, 'solo-pistol': 0, 'netrunner': 1}
        self.assertEqual([t['id'] for t in templates], list(defaults))
        self.assertEqual(len(templates), 3)
        original = self.snapshot(training=True)
        for template, default in defaults.items():
            # Omission retains old defaults; an explicit zero must not be treated
            # as omission, and all eight new cosmetics work with every template.
            for sprite in [None] + list(range(12)):
                with self.subTest(template=template, sprite=sprite):
                    fields = dict(templateId=template, name='Appearance test', x=6, y=4, hidden=False)
                    if sprite is not None:
                        fields['sprite'] = sprite
                    wanted = default if sprite is None else sprite
                    before = self.snapshot(training=True)
                    preview = self.preview(dict(type='add', **fields))
                    self.assertEqual(preview[0], 200, preview)
                    self.assertEqual(preview[1]['preview']['summary'],
                                     dict(name='Appearance test', templateId=template, sprite=wanted))
                    self.assertEqual(before, self.snapshot(training=True))
                    added, _ = self.command('add', **fields)
                    self.assertEqual(added[0], 200, added)
                    actor = self.npc(added[1])
                    self.assertEqual(actor['sprite'], wanted)
                    self.assert_template(actor, template)
                    undone, _ = self.command('undo')
                    self.assertEqual(undone[0], 200, undone)
                    self.assertEqual(len(undone[1]['battle']['scene']['actors']), 2)
        after = self.snapshot(training=True)
        for table in ('users', 'characters', 'revisions'):
            self.assertEqual(original[table], after[table], table)

    def test_high_appearance_add_export_import_restart_version_and_dedup(self):
        self.party(count=1, hidden=False)
        initial = self.gm_client.request(self.path)[1]['battle']
        before = self.snapshot(training=True)
        added, request = self.command('add', templateId='guard-rifle', name='Heavy-looking guard',
                                      sprite=11, x=6, y=4, hidden=False)
        self.assertEqual(added[0], 200, added)
        actor = self.npc(added[1])
        self.assertEqual(actor['sprite'], 11)
        self.assert_template(actor, 'guard-rifle')
        self.assertEqual(added[1]['battle']['version'], initial['version'] + 1)
        self.assertEqual(added[1]['battle']['id'], initial['id'])
        saved = self.snapshot(training=True)
        duplicate = self.gm_client.request(self.path + '/commands', 'POST', request, csrf=self.gm_identity['csrf'])
        self.assertEqual(duplicate[0], 200, duplicate)
        self.assertTrue(duplicate[1]['duplicate'])
        self.assertEqual(duplicate[1]['receipt'], added[1]['receipt'])
        self.assertEqual(saved, self.snapshot(training=True))
        changed = dict(request, sprite=10)
        self.assertEqual(self.gm_client.request(self.path + '/commands', 'POST', changed,
                                               csrf=self.gm_identity['csrf'])[0], 409)
        stale, _ = self.command('add', expected=initial['version'], templateId='guard-rifle', sprite=11)
        self.assertEqual(stale[0], 409, stale)
        stale_preview = self.gm_client.request(self.path + '/preview', 'POST',
            dict(battleId=initial['id'], expectedVersion=initial['version'],
                 command=dict(type='add', templateId='guard-rifle', sprite=11)), csrf=self.gm_identity['csrf'])
        self.assertEqual(stale_preview[0], 409, stale_preview)
        self.assertEqual(saved, self.snapshot(training=True))

        exported = self.preview(dict(type='export-scene'))
        self.assertEqual(exported[0], 200, exported)
        document = exported[1]['preview']['document']
        self.assertEqual(document['npcs'], [dict(templateId='guard-rifle', name=actor['name'], x=6, y=4,
                                                team='hostile', hidden=False, sprite=11, heading=0)])
        for private in ('stats', 'weapon', 'armor', 'ownerId', 'wounds', 'sheetVersion', 'appliedCommandIds', '_undo'):
            self.assertNotIn('"' + private + '"', json.dumps(document))
        preview = self.preview(dict(type='import-scene', document=document))
        self.assertEqual(preview[0], 200, preview)
        self.assertEqual(preview[1]['preview']['summary']['npcCount'], 1)
        self.assertEqual(saved, self.snapshot(training=True))
        imported, import_request = self.command('import-scene', document=document)
        self.assertEqual(imported[0], 200, imported)
        restored = self.npc(imported[1])
        self.assertEqual(restored['sprite'], 11)
        self.assertNotEqual(restored['id'], actor['id'])
        self.assert_template(restored, 'guard-rifle')
        self.assertEqual(imported[1]['battle']['version'], added[1]['battle']['version'] + 1)
        self.assertEqual(imported[1]['battle']['id'], initial['id'])
        self.assertEqual(self.preview(dict(type='export-scene'))[1]['preview']['document'], document)
        saved = self.snapshot(training=True)
        duplicate = self.gm_client.request(self.path + '/commands', 'POST', import_request, csrf=self.gm_identity['csrf'])
        self.assertEqual(duplicate[0], 200, duplicate)
        self.assertTrue(duplicate[1]['duplicate'])
        self.assertEqual(saved, self.snapshot(training=True))
        fixtures.mobile_host.stop()
        self.start(username='', password='')
        self.assertEqual(self.gm_client.request(self.path)[1]['battle'], imported[1]['battle'])
        self.assertEqual(saved, self.snapshot(training=True))
        for table in ('users', 'characters', 'revisions'):
            self.assertEqual(before[table], saved[table], table)

    def test_prepare_all_appearances_and_blueprint_roundtrip_preserve_live_stats(self):
        self.party(count=1, hidden=False)
        added, _ = self.command('add', templateId='netrunner', sprite=10, x=6, y=4, hidden=False)
        self.assertEqual(added[0], 200, added)
        npc = self.npc(added[1])
        original = added[1]['battle']['scene']['actors']
        untouched = self.snapshot(training=True)
        for sprite in range(12):
            with self.subTest(sprite=sprite):
                config = copy.deepcopy(self.prepare_body)
                for entry in config['actors']:
                    entry['sprite'] = sprite
                prepared, _ = self.reprepare(config)
                for actor in prepared['battle']['scene']['actors']:
                    if battle.sheet_actor(actor):
                        old = next(a for a in original if a['id'] == actor['id'])
                        self.assertEqual(actor, dict(old, sprite=sprite))
                    else:
                        self.assertEqual(actor, npc)
        document = self.preview(dict(type='export-scene'))[1]['preview']['document']
        self.assertEqual({a['sprite'] for a in document['characters']}, {11})
        self.assertEqual(document['npcs'][0]['sprite'], 10)
        for entry in document['characters']:
            entry['sprite'] = 9
        imported, _ = self.command('import-scene', document=document)
        self.assertEqual(imported[0], 200, imported)
        for actor in imported[1]['battle']['scene']['actors']:
            if battle.sheet_actor(actor):
                old = next(a for a in original if a['id'] == actor['id'])
                self.assertEqual(actor, dict(old, sprite=9))
            else:
                self.assertEqual(actor['sprite'], 10)
                self.assert_template(actor, 'netrunner')
        self.assertEqual(self.preview(dict(type='export-scene'))[1]['preview']['document'], document)
        prepared, _ = self.reprepare(actors=self.scene_configs(imported[1]['battle']['scene']))
        self.assertEqual(prepared['battle']['scene']['actors'], imported[1]['battle']['scene']['actors'])
        for table in ('users', 'characters', 'revisions'):
            self.assertEqual(untouched[table], self.snapshot(training=True)[table], table)

    def test_all_twelve_appearances_survive_scene_import_and_export(self):
        self.party(count=1, hidden=False)
        document = self.preview(dict(type='export-scene'))[1]['preview']['document']
        templates = ('netrunner', 'guard-rifle', 'solo-pistol')
        document['npcs'] = [dict(templateId=templates[sprite % 3], name='Appearance ' + str(sprite),
                                 sprite=sprite, x=sprite + 1, y=4, team='hostile', hidden=False, heading=(sprite % 8) * 45)
                            for sprite in range(12)]
        before = self.snapshot(training=True)
        preview = self.preview(dict(type='import-scene', document=document))
        self.assertEqual(preview[0], 200, preview)
        self.assertEqual(preview[1]['preview']['summary']['npcCount'], 12)
        self.assertEqual(before, self.snapshot(training=True))
        imported, _ = self.command('import-scene', document=document)
        self.assertEqual(imported[0], 200, imported)
        for sprite in range(12):
            actor = self.npc(imported[1], 'Appearance ' + str(sprite))
            self.assertEqual(actor['sprite'], sprite)
            self.assertEqual(actor['heading'], (sprite % 8) * 45)
            self.assert_template(actor, templates[sprite % 3])
        self.assertEqual(self.preview(dict(type='export-scene'))[1]['preview']['document'], document)
        for table in ('users', 'characters', 'revisions'):
            self.assertEqual(before[table], self.snapshot(training=True)[table], table)

    def test_bad_appearance_ids_rejected_atomically_on_every_input(self):
        self.party(count=1, hidden=False)
        added, _ = self.command('add', templateId='guard-rifle', sprite=11, x=6, y=4)
        self.assertEqual(added[0], 200, added)
        document = self.preview(dict(type='export-scene'))[1]['preview']['document']
        before = self.snapshot(training=True)
        current = self.gm_client.request(self.path)[1]['battle']
        invalid = [-1, 12, 999, True, False, 4.0, 11.0, '4', '11', None, [], {}]
        for sprite in invalid:
            with self.subTest(sprite=sprite):
                action = dict(type='add', templateId='guard-rifle', sprite=sprite)
                self.assertEqual(self.preview(action)[0], 400)
                self.assertEqual(self.command('add', templateId='guard-rifle', sprite=sprite)[0][0], 400)
                config = copy.deepcopy(self.prepare_body)
                config.update(id='invalid-appearance', expectedVersion=current['version'])
                config['actors'][0]['sprite'] = sprite
                result = self.gm_client.request(self.path, 'POST', config, csrf=self.gm_identity['csrf'])
                self.assertEqual(result[0], 400, result)
                for category in ('characters', 'npcs'):
                    malformed = copy.deepcopy(document)
                    malformed[category][0]['sprite'] = sprite
                    self.assertEqual(self.preview(dict(type='import-scene', document=malformed))[0], 400)
                    result, _ = self.command('import-scene', document=malformed)
                    self.assertEqual(result[0], 400, result)
                self.assertEqual(before, self.snapshot(training=True))
        for fields in (dict(sprite=11), dict(config=self.prepare_body['actors'][0], sprite=11),
                       dict(templateId='unknown-template', sprite=11)):
            self.assertEqual(self.preview(dict(type='add', **fields))[0], 400)
            self.assertEqual(self.command('add', **fields)[0][0], 400)
        self.assertEqual(before, self.snapshot(training=True))

    def test_cosmetics_do_not_grant_players_npc_authority_or_private_data(self):
        self.party(count=1, hidden=False)
        client, user, cid = self.players[0]
        visible, _ = self.command('add', templateId='solo-pistol', name='Visible cosmetic', sprite=11,
                                  x=6, y=4, hidden=False)
        self.assertEqual(visible[0], 200, visible)
        npc = self.npc(visible[1])
        hidden, _ = self.command('add', templateId='netrunner', name='PRIVATE HIDDEN APPEARANCE',
                                 sprite=10, x=8, y=4, hidden=True)
        self.assertEqual(hidden[0], 200, hidden)
        view = client.request(self.path)[1]
        self.assertEqual(view['controlledActorIds'], ['character-' + str(cid)])
        self.assertNotIn('npcTemplates', view['options'])
        self.assertNotIn('PRIVATE HIDDEN APPEARANCE', json.dumps(view))
        public = next(a for a in view['battle']['scene']['actors'] if a['id'] == npc['id'])
        self.assertEqual(public['sprite'], 11)
        self.assertFalse({'stats', 'weapon', 'armor', 'wounds', 'sheetVersion', 'ownerId', 'origin', 'net'} & set(public))
        document = self.preview(dict(type='export-scene'))[1]['preview']['document']
        before = self.snapshot(training=True)
        for action in (dict(type='add', templateId='netrunner', sprite=11),
                       dict(type='import-scene', document=document), dict(type='export-scene')):
            self.assertEqual(self.preview(action, client, user)[0], 403)
            if action['type'] != 'export-scene':
                result, _ = self.command(action['type'], client, user, **{k: v for k, v in action.items() if k != 'type'})
                self.assertEqual(result[0], 403, result)
        prepare = copy.deepcopy(self.prepare_body)
        prepare.update(id='player-cosmetic-prepare', expectedVersion=view['battle']['version'])
        prepare['actors'][0]['sprite'] = 11
        self.assertEqual(client.request(self.path, 'POST', prepare, csrf=user['csrf'])[0], 403)
        self.assertEqual(before, self.snapshot(training=True))
        with patch.object(battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            started, _ = self.command('start')
            self.assertEqual(started[0], 200, started)
        before = self.snapshot(training=True)
        action = dict(type='move', actorId=npc['id'], x=7, y=4)
        self.assertEqual(self.preview(action, client, user)[0], 403)
        result, _ = self.command('declare', client, user, action=action)
        self.assertEqual(result[0], 403, result)
        self.assertEqual(before, self.snapshot(training=True))

    def test_cosmetic_payloads_cannot_forge_stats_or_template_authority(self):
        self.party(count=1, hidden=False)
        added, _ = self.command('add', templateId='guard-rifle', sprite=11, x=6, y=4)
        self.assertEqual(added[0], 200, added)
        document = self.preview(dict(type='export-scene'))[1]['preview']['document']
        before = self.snapshot(training=True)
        for field, value in (('stats', dict(ref=99)), ('weapon', dict(damageDice=99)),
                             ('armor', dict(torso=99)), ('wounds', 0), ('ownerId', self.players[0][1]['id']),
                             ('origin', dict(kind='npc', templateId='netrunner')), ('sheetVersion', 1)):
            with self.subTest(field=field):
                forged = dict(templateId='guard-rifle', sprite=11, **{field: value})
                self.assertEqual(self.preview(dict(type='add', **forged))[0], 400)
                self.assertEqual(self.command('add', **forged)[0][0], 400)
                malformed = copy.deepcopy(document)
                malformed['npcs'][0][field] = value
                self.assertEqual(self.preview(dict(type='import-scene', document=malformed))[0], 400)
                self.assertEqual(self.command('import-scene', document=malformed)[0][0], 400)
        self.assertEqual(before, self.snapshot(training=True))

        # Legacy scene resources are discarded, while a supported appearance
        # survives. Even forged combat data is replaced by the fixed template.
        legacy, _ = battle.training_scene(dict(gm_id=self.gm_identity['id']), 0, lambda: .5)
        for actor in legacy['actors']:
            actor.update(sprite=11, stats=dict(ref=99), weapon=dict(damageDice=99),
                         armor=dict(torso=99), ownerId=self.players[0][1]['id'], wounds=999)
        preview = self.preview(dict(type='import-scene', document=legacy))
        self.assertEqual(preview[0], 200, preview)
        self.assertEqual(before, self.snapshot(training=True))
        imported, _ = self.command('import-scene', document=legacy)
        self.assertEqual(imported[0], 200, imported)
        npcs = [a for a in imported[1]['battle']['scene']['actors'] if a.get('origin', {}).get('kind') == 'npc']
        self.assertEqual(len(npcs), 4)
        for actor in npcs:
            self.assertEqual(actor['sprite'], 11)
            self.assert_template(actor, actor['origin']['templateId'])
        for table in ('users', 'characters', 'revisions'):
            self.assertEqual(before[table], self.snapshot(training=True)[table], table)


if __name__ == '__main__':
    unittest.main()
