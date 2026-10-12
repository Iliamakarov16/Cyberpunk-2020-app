"""Real HTTP/SQLite shared battle authorization, atomicity and reconnect tests."""
from concurrent.futures import ThreadPoolExecutor
import copy
import http.client
import json
import sqlite3
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_mobile_host as fixtures
import shared_battle


# Explicit test-fixture choices, not production compatibility or rule inference.
TEST_FIRING_RULINGS = dict(nonautomaticFumbleAmmo='consume-attempted', jamAmmo='consume-declared')


def canonical_action(action):
    action = copy.deepcopy(action)
    if action.get('type') == 'shoot':
        action.update(type='fire', mode='single', rounds=1, targetIds=[action.pop('targetId')])
        if 'turnToTarget' in action:
            action['gmFire'] = dict(turnToTarget=action.pop('turnToTarget'), rulings=copy.deepcopy(TEST_FIRING_RULINGS))
    return action


def canonical_profile(weapon):
    return dict(weapon, kind='ranged', profileId='Explicit synthetic HTTP fixture pistol',
                weaponType='handgun', fireModes=['single'], singleActionCap=1,
                reliability='VR', fumbleClass='nonautomatic')


def configure_synthetic_profiles(test, state):
    # These two known fixture weapons have explicit test capabilities. No names,
    # ROF or server production heuristics determine a mode/class here.
    sources = {'colt-amt2000': ('handgun', 'Handgun', 'VR', 'nonautomatic'),
               'militech-ronin': ('rifle', 'Rifle', 'VR', 'automatic')}
    for actor in state['battle']['scene']['actors']:
        if actor['status'] == 'dead' or actor['weapon'].get('unarmed') or actor.get('loadout') is not None:
            continue
        if actor['characterId'] is not None and actor['characterId'] >= 0:
            continue  # A real fixture must explicitly provide its own loadout.
        weapon = actor['weapon']; family, skill, reliability, fumble = sources[weapon['id']]
        profile = dict(weaponId=weapon.get('weaponId') or weapon['id'], kind='ranged',
                       profileId='Explicit historical HTTP fixture profile', weaponType=family,
                       skillName=skill, skillRank=actor['stats'][family],
                       ammoItemId=weapon.get('ammoItemId') or 'ammo-' + weapon['id'],
                       loaded=weapon['ammo'], fireModes=['single'], singleActionCap=1,
                       reliability=reliability, fumbleClass=fumble)
        profile.update({key: weapon[key] for key in ('damageDice', 'damageBonus', 'accuracy', 'range', 'rof', 'magazine')})
        result, _ = SharedBattleHTTP.command(test, 'configure-loadout', actorId=actor['id'],
                    config=dict(weapons=[profile], activeWeaponId=profile['weaponId']))
        test.assertEqual(result[0], 200, result)
    return test.gm_client.request(test.path)[1]


class SharedBattleHTTP(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign

    def sheet(self, client, identity, name, ref=9, body=8, wounds=0):
        data = dict(name=name, role='Solo', wounds=wounds, notes='PRIVATE NOTES ' + name,
                    stats=dict(REF=ref, BODY=body, MA=5), skills=[dict(name='Handgun', stat='REF', rank=8)],
                    armorMode='equipment', items=[
                        dict(id='gun', name='Pistol', category='weapon', quantity=1, equipped=True),
                        dict(id='ammo', name='Ammo', category='ammo', quantity=10),
                        dict(id='private', name='PRIVATE INVENTORY ' + name, category='gear', quantity=1),
                        dict(id='vest', name='Vest', category='armor', quantity=1, equipped=True,
                             armor=dict(type='soft', coverage=dict(torso=8), ev=0, order=10))])
        result = client.request('/api/characters', 'POST', {'data': data}, csrf=identity['csrf'])
        self.assertEqual(result[0], 201, result)
        return result[1]['id']

    def party(self, count=2, hidden=True):
        gm, identity = self.gm()
        campaign = self.campaign(gm, identity)
        base = f"/api/campaigns/{campaign['id']}"
        players = []
        for i in range(count):
            client, user = self.player(f'battle-player-{i}')
            cid = self.sheet(client, user, f'Player {i}')
            self.assertEqual(client.request('/api/campaigns/join', 'POST', dict(code=campaign['invite_code'], character_id=cid), csrf=user['csrf'])[0], 201)
            version = gm.request(base)[1]['version']
            self.assertEqual(gm.request(base + '/roster', 'POST', dict(version=version, character_id=cid, status='active'), csrf=identity['csrf'])[0], 200)
            players.append((client, user, cid))
        guard = self.sheet(gm, identity, 'Guard', ref=0)
        secret = self.sheet(gm, identity, 'HIDDEN GUARD SECRET', ref=0) if hidden else None
        self.gm_client, self.gm_identity, self.players, self.path = gm, identity, players, base + '/battle'
        self.guard, self.secret = guard, secret
        options = gm.request(self.path)[1]['options']['characters']
        ids = [p[2] for p in players] + [guard] + ([secret] if secret else [])
        actors = []
        for i, cid in enumerate(ids):
            option = next(o for o in options if o['id'] == cid)
            actors.append(dict(characterId=cid, version=option['version'], x=1 + i * 2, y=1, heading=90,
                team='crew' if i < count else 'hostile', hidden=cid == secret, sprite=0 if i < count else 2,
                weapon=dict(weaponId='gun', ammoItemId='ammo', skillName='Handgun', skillRank=8,
                            damageDice=4, damageBonus=1, accuracy=0, range=100, rof=1, magazine=8, loaded=8),
                armor={z: 0 for z in shared_battle.ZONES}, combatSense=0))
        for actor in actors:
            actor['loadout'] = dict(weapons=[canonical_profile(actor['weapon'])], activeWeaponId=actor['weapon']['weaponId'])
        body = dict(id='prepare-once', expectedVersion=0, type='prepare', name='Shared battle', width=24, height=8, tileMeters=1, actors=actors)
        result = gm.request(self.path, 'POST', body, csrf=identity['csrf'])
        self.assertEqual(result[0], 200, result)
        self.prepare_body, self.initial = body, result[1]
        return result[1]

    def command(self, kind, client=None, identity=None, command_id=None, expected=None, **fields):
        client, identity = client or self.gm_client, identity or self.gm_identity
        state = client.request(self.path)[1]
        if kind == 'start' and (client is self.gm_client) and state['battle']['phase'] in ('preparation', 'ended'):
            state = configure_synthetic_profiles(self, state)
        if kind == 'shoot':
            action = canonical_action(dict(type=kind, **fields))
            kind = action.pop('type'); fields = action
            fields.setdefault('gmFire', dict(turnToTarget=False, rulings=copy.deepcopy(TEST_FIRING_RULINGS)))
        elif kind == 'declare-shot':
            kind = 'declare'
            fields = dict(action=canonical_action(dict(type='shoot', **fields)))
        elif kind == 'declare' and isinstance(fields.get('action'), dict):
            fields['action'] = canonical_action(fields['action'])
        if kind == 'confirm' and any(d['id'] == fields.get('declarationId') and
                d.get('action', {}).get('type') == 'fire' for d in state['battle']['pending']):
            if 'gmFire' not in fields:
                fields['gmFire'] = dict(turnToTarget=fields.pop('turnToTarget', False),
                                       rulings=copy.deepcopy(TEST_FIRING_RULINGS))
        body = dict(id=command_id or kind + '-' + str(state['battle']['version']), battleId=state['battle']['id'],
                    expectedVersion=state['battle']['version'] if expected is None else expected, type=kind, **fields)
        return client.request(self.path + '/commands', 'POST', body, csrf=identity['csrf']), body

    def begin(self):
        result, _ = self.command('start')
        self.assertEqual(result[0], 200, result)
        aid = result[1]['battle']['scene']['currentActorId']
        client, user, cid = next(p for p in self.players if 'character-' + str(p[2]) == aid)
        return client, user, cid

    def declare(self, **kwargs):
        client, user, cid = self.begin()
        result, body = self.command('declare-shot', client, user, actorId='character-' + str(cid), targetId='character-' + str(self.guard), location='torso', **kwargs)
        self.assertEqual(result[0], 200, result)
        return client, user, cid, body

    def database(self):
        return sqlite3.connect(self.data / 'tracker.sqlite3')

    def snapshot(self):
        with self.database() as db:
            return {table: db.execute('SELECT * FROM ' + table).fetchall() for table in ['characters', 'revisions', 'shared_battles', 'shared_battle_commands', 'campaigns']}

    def test_raw_legacy_attack_and_unconfirmed_start_are_rejected_without_writes(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party(count=1, hidden=False)
            # Deliberately simulate a saved pre-upgrade actor. This raw request
            # bypasses fixture preparation helpers, never production guards.
            with self.database() as db:
                row=db.execute('SELECT campaign_id,data FROM shared_battles').fetchone()
                scene=json.loads(row[1]);scene['actors'][0].pop('loadout')
                db.execute('UPDATE shared_battles SET data=? WHERE campaign_id=?',(json.dumps(scene),row[0]))
            before=self.snapshot();state=self.gm_client.request(self.path)[1]['battle']
            raw=dict(id='reject-unconfirmed-start',battleId=state['id'],expectedVersion=state['version'],type='start')
            rejected=self.gm_client.request(self.path+'/commands','POST',raw,csrf=self.gm_identity['csrf'])
            self.assertEqual(rejected[0],409,rejected);self.assertEqual(before,self.snapshot())
            setup=copy.deepcopy(self.prepare_body);setup.update(id='explicit-canonical-preparation',expectedVersion=state['version'])
            restored=self.gm_client.request(self.path,'POST',setup,csrf=self.gm_identity['csrf']);self.assertEqual(restored[0],200,restored)
            client,user,cid=self.begin();state=self.gm_client.request(self.path)[1]['battle'];before=self.snapshot()
            for kind,owner,identity in [('shoot',self.gm_client,self.gm_identity),('declare-shot',client,user)]:
                raw=dict(id='reject-legacy-'+kind,battleId=state['id'],expectedVersion=state['version'],type=kind,
                         actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso')
                if kind=='shoot':raw['turnToTarget']=False
                rejected=owner.request(self.path+'/commands','POST',raw,csrf=identity['csrf'])
                self.assertEqual(rejected[0],409,rejected);self.assertEqual(before,self.snapshot())
            canonical,_=self.command('shoot',actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(canonical[0],200,canonical)
            self.assertEqual(canonical[1]['receipt']['type'],'fire')

    def test_real_shot_atomic_exactly_once_private_views_and_restart(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party()
            client, user, cid, declaration = self.declare()
            before_actor = client.request(f'/api/characters/{cid}')[1]
            before_target = self.gm_client.request(f'/api/characters/{self.guard}')[1]
            pending = client.request(self.path)[1]['battle']['pending']
            self.assertEqual(len(pending), 1)
            self.assertNotIn('declaredBy', pending[0])
            result, confirmation = self.command('confirm', declarationId=declaration['id'])
            self.assertEqual(result[0], 200, result)
            event = result[1]['receipt']['event']
            self.assertTrue(event['hit'])
            self.assertEqual(event['damage'], 14)
            actor = client.request(f'/api/characters/{cid}')[1]
            target = self.gm_client.request(f'/api/characters/{self.guard}')[1]
            self.assertEqual(next(i for i in actor['data']['items'] if i['id'] == 'ammo')['quantity'], 9)
            self.assertEqual(target['data']['wounds'], 14)
            self.assertEqual(target['data']['items'], before_target['data']['items'])
            self.assertEqual(target['data']['condition'], before_target['data']['condition'])
            self.assertEqual(actor['version'], before_actor['version'] + 1)
            self.assertEqual(target['version'], before_target['version'] + 1)
            saved = self.snapshot()
            repeat = self.gm_client.request(self.path + '/commands', 'POST', confirmation, csrf=self.gm_identity['csrf'])
            self.assertEqual(repeat[0], 200, repeat)
            self.assertTrue(repeat[1]['duplicate'])
            self.assertEqual(repeat[1]['receipt'], result[1]['receipt'])
            self.assertEqual(saved, self.snapshot())
            second, _ = self.command('confirm', command_id='second-confirm', declarationId=declaration['id'])
            self.assertEqual(second[0], 409)
            self.assertEqual(saved, self.snapshot())
            for viewer, _, viewer_cid in self.players:
                view = viewer.request(self.path)[1]
                self.assertEqual(view['options'], {'characters': []})
                self.assertNotIn('HIDDEN GUARD SECRET', json.dumps(view))
                self.assertNotIn('PRIVATE', json.dumps(view))
                self.assertEqual(view['controlledActorIds'], ['character-' + str(viewer_cid)])
                others = [a for a in view['battle']['scene']['actors'] if a['characterId'] != viewer_cid]
                for other in others:
                    self.assertFalse(set(other) & {'stats', 'armor', 'weapon', 'wounds', 'sheetVersion', 'ownerId'})
                for log in view['battle']['log']:
                    self.assertFalse(set(log) & {'sp', 'btm', 'penetration', 'stunLimit', 'stunRoll'})
            visible = client.request(self.path)[1]
            fixtures.mobile_host.stop(); self.start(username='', password='')
            self.assertEqual(client.request(self.path)[1], visible)
            self.assertEqual(self.snapshot(), saved)
            again = self.gm_client.request(self.path + '/commands', 'POST', confirmation, csrf=self.gm_identity['csrf'])
            self.assertTrue(again[1]['duplicate'])
            self.assertEqual(self.snapshot(), saved)
            with self.database() as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_ownership_roles_forgery_hidden_targets_and_pending_privacy(self):
        self.party()
        client, user, cid = self.begin()
        other, identity, other_cid = next(p for p in self.players if p[2] != cid)
        # Choosing UI mode "gm" is not a campaign ownership grant.
        self.assertEqual(other.request('/api/mode', 'POST', {'mode': 'gm'}, csrf=identity['csrf'])[0], 200)
        stolen, _ = self.command('declare-shot', other, identity, actorId='character-' + str(cid), targetId='character-' + str(self.guard), location='torso')
        self.assertEqual(stolen[0], 403, stolen)
        forbidden, _ = self.command('finish', other, identity)
        self.assertEqual(forbidden[0], 403)
        hidden, _ = self.command('declare-shot', client, user, actorId='character-' + str(cid), targetId='character-' + str(self.secret), location='torso')
        self.assertEqual(hidden[0], 400, hidden)
        valid, declaration = self.command('declare-shot', client, user, actorId='character-' + str(cid), targetId='character-' + str(self.guard), location='torso')
        self.assertEqual(valid[0], 200, valid)
        self.assertEqual(other.request(self.path)[1]['battle']['pending'], [])
        forged = dict(declaration, id='forged-roll', expectedVersion=valid[1]['battle']['version'], roll=10, damage=999, role='gm')
        self.assertEqual(client.request(self.path + '/commands', 'POST', forged, csrf=user['csrf'])[0], 400)
        confirm, _ = self.command('confirm', client, user, declarationId=declaration['id'])
        self.assertEqual(confirm[0], 403)
        stolen_id = dict(declaration, expectedVersion=valid[1]['battle']['version'])
        self.assertEqual(other.request(self.path + '/commands', 'POST', stolen_id, csrf=identity['csrf'])[0], 409)
        duplicate = client.request(self.path + '/commands', 'POST', declaration, csrf=user['csrf'])
        self.assertTrue(duplicate[1]['duplicate'])
        outsider, _ = self.player('battle-outsider')
        self.assertEqual(outsider.request(self.path)[0], 403)
        rejected, _ = self.command('reject', declarationId=declaration['id'])
        self.assertEqual(rejected[0], 200)
        self.assertEqual(client.request(self.path)[1]['battle']['pending'], [])

    def test_prepare_validates_actual_sheet_links_stats_versions_and_payload(self):
        self.party()
        base = copy.deepcopy(self.prepare_body)
        base['expectedVersion'] = self.initial['battle']['version']
        outsider, identity = self.player('external-owner')
        external = self.sheet(outsider, identity, 'Not in this campaign')
        attacks = []
        for key, value in [('weaponId', 'private'), ('ammoItemId', 'gun'), ('skillRank', 10), ('skillName', 'Invented skill')]:
            changed = copy.deepcopy(base); changed['actors'][0]['weapon'][key] = value; changed['actors'][0]['loadout']['weapons'][0][key] = value; attacks.append(changed)
        changed = copy.deepcopy(base); changed['actors'][0]['characterId'] = external; attacks.append(changed)
        changed = copy.deepcopy(base); changed['actors'][0]['version'] += 1; attacks.append(changed)
        changed = copy.deepcopy(base); changed['actors'][0]['stats'] = {'ref': 100}; attacks.append(changed)
        changed = copy.deepcopy(base); changed['actors'][0]['combatSense'] = 10; attacks.append(changed)
        saved = self.snapshot()
        for index, changed in enumerate(attacks):
            changed['id'] = 'bad-prepare-' + str(index)
            result = self.gm_client.request(self.path, 'POST', changed, csrf=self.gm_identity['csrf'])
            self.assertIn(result[0], (400, 409), result)
            self.assertEqual(saved, self.snapshot())
        base['id'] = 'untrained-preparation'
        base['actors'][0]['weapon'].update(skillName='', skillRank=0)
        base['actors'][0]['loadout']['weapons'][0].update(skillName='',skillRank=0)
        self.assertEqual(self.gm_client.request(self.path, 'POST', base, csrf=self.gm_identity['csrf'])[0], 200)

    def test_stale_version_parallel_confirm_and_sheet_race(self):
        self.party()
        client, user, cid, declaration = self.declare()
        state = self.gm_client.request(self.path)[1]['battle']
        body = dict(id='approve-race', battleId=state['id'], expectedVersion=state['version'], type='confirm', declarationId=declaration['id'], gmFire=dict(turnToTarget=False, rulings=TEST_FIRING_RULINGS))
        sheet = client.request(f'/api/characters/{cid}')[1]
        updated = copy.deepcopy(sheet['data']); updated['notes'] = 'Concurrent private edit'
        self.assertEqual(client.request(f'/api/characters/{cid}', 'PUT', dict(version=sheet['version'], data=updated, reason='concurrent edit'), csrf=user['csrf'])[0], 200)
        saved = self.snapshot()
        conflict = self.gm_client.request(self.path + '/commands', 'POST', body, csrf=self.gm_identity['csrf'])
        self.assertEqual(conflict[0], 409, conflict)
        self.assertEqual(saved, self.snapshot())
        self.assertEqual(client.request(f'/api/characters/{cid}')[1]['data']['notes'], 'Concurrent private edit')
        self.assertEqual(self.command('reject', declarationId=declaration['id'])[0][0], 200)
        self.assertEqual(self.command('finish')[0][0], 200)
        # Explicit re-preparation with current sheets, same character IDs.
        state = self.gm_client.request(self.path)[1]
        next_prepare = copy.deepcopy(self.prepare_body)
        next_prepare.update(id='prepare-after-edit', expectedVersion=state['battle']['version'])
        for actor in next_prepare['actors']:
            actor['version'] = next(o['version'] for o in state['options']['characters'] if o['id'] == actor['characterId'])
        self.assertEqual(self.gm_client.request(self.path, 'POST', next_prepare, csrf=self.gm_identity['csrf'])[0], 200)
        _, _, _, declaration = self.declare(command_id='after-edit-shot')
        state = self.gm_client.request(self.path)[1]['battle']
        barrier = threading.Barrier(2)
        def approve(index):
            body = dict(id='parallel-' + str(index), battleId=state['id'], expectedVersion=state['version'], type='confirm', declarationId=declaration['id'], gmFire=dict(turnToTarget=False, rulings=TEST_FIRING_RULINGS))
            independent = fixtures.HTTPClient(self.port); independent.cookie = self.gm_client.cookie
            barrier.wait(5)
            return independent.request(self.path + '/commands', 'POST', body, csrf=self.gm_identity['csrf'])
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(approve, range(2)))
        self.assertEqual(sorted(r[0] for r in results), [200, 409])
        fresh = self.gm_client.request(self.path)[1]
        self.assertEqual(fresh['battle']['version'], state['version'] + 1)

    def test_lost_response_commit_restart_and_rollback(self):
        self.party()
        _, _, _, declaration = self.declare()
        state = self.gm_client.request(self.path)[1]['battle']
        body = dict(id='lost-confirm', battleId=state['id'], expectedVersion=state['version'], type='confirm', declarationId=declaration['id'], gmFire=dict(turnToTarget=False, rulings=TEST_FIRING_RULINGS))
        saved = self.snapshot()
        # Fail after shooter write, before target/audit/battle writes. SQLite must roll back all.
        original = shared_battle.persist_combat_effects
        def fail_after_effect(*args, **kwargs):
            original(*args, **kwargs)
            raise sqlite3.OperationalError('Injected transaction failure')
        with patch.object(shared_battle, 'persist_combat_effects', side_effect=fail_after_effect):
            result = self.gm_client.request(self.path + '/commands', 'POST', body, csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0], 503, result)
        self.assertEqual(saved, self.snapshot())
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        connection.request('POST', self.path + '/commands', json.dumps(body), {'Host': self.lan_host, 'Origin': 'http://' + self.lan_host,
            'Cookie': self.gm_client.cookie, 'X-CSRF-Token': self.gm_identity['csrf'], 'Content-Type': 'application/json'})
        response = connection.getresponse(); self.assertEqual(response.status, 200); response.close(); connection.close()
        committed = self.snapshot()
        fixtures.mobile_host.stop(); self.start(username='', password='')
        repeated = self.gm_client.request(self.path + '/commands', 'POST', body, csrf=self.gm_identity['csrf'])
        self.assertEqual(repeated[0], 200, repeated)
        self.assertTrue(repeated[1]['duplicate'])
        self.assertEqual(committed, self.snapshot())
        tampered = dict(body, declarationId='different')
        self.assertEqual(self.gm_client.request(self.path + '/commands', 'POST', tampered, csrf=self.gm_identity['csrf'])[0], 409)

    def test_unarmed_real_target_needs_no_invented_inventory(self):
        self.party(count=1, hidden=False)
        target = self.gm_client.request(f'/api/characters/{self.guard}')[1]
        data = copy.deepcopy(target['data']); data['items'] = []
        self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}', 'PUT', dict(version=target['version'],data=data,reason='Unarmed NPC'),csrf=self.gm_identity['csrf'])[0], 200)
        prepared = copy.deepcopy(self.prepare_body); prepared.update(id='prepare-unarmed', expectedVersion=1)
        config = next(a for a in prepared['actors'] if a['characterId'] == self.guard)
        config.update(version=target['version']+1, weapon=None, loadout=dict(weapons=[],activeWeaponId=None,resetLoaded=True))
        result = self.gm_client.request(self.path,'POST',prepared,csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0],200,result)
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            client, user, cid = self.begin()
            result, _ = self.command('end', actorId='character-' + str(cid))
            self.assertEqual(result[0],200,result)
            forbidden, _ = self.command('declare-shot', actorId='character-' + str(self.guard),targetId='character-' + str(cid),location='torso')
            self.assertEqual(forbidden[0],400,forbidden)
            self.assertEqual(self.command('end',actorId='character-'+str(self.guard))[0][0],200)
            shot, declaration = self.command('declare-shot',client,user,actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(shot[0],200,shot)
            self.assertEqual(self.command('confirm',declarationId=declaration['id'])[0][0],200)
        fresh = self.gm_client.request(f'/api/characters/{self.guard}')[1]
        self.assertEqual(fresh['data']['items'],[])
        self.assertEqual(fresh['data']['wounds'],14)

    def test_actual_concurrent_sheet_edit_cannot_clobber_ammo(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party()
            client, user, cid, declaration = self.declare()
            state = self.gm_client.request(self.path)[1]['battle']
            sheet = client.request(f'/api/characters/{cid}')[1]
            edit = copy.deepcopy(sheet['data']); edit['notes'] = 'Racing edit preserved'
            barrier = threading.Barrier(2)
            def approve():
                browser = fixtures.HTTPClient(self.port); browser.cookie = self.gm_client.cookie
                barrier.wait(5)
                return browser.request(self.path + '/commands', 'POST', dict(id='confirm-versus-edit', battleId=state['id'],
                    expectedVersion=state['version'], type='confirm', declarationId=declaration['id'], gmFire=dict(turnToTarget=False, rulings=TEST_FIRING_RULINGS)), csrf=self.gm_identity['csrf'])
            def edit_sheet():
                browser = fixtures.HTTPClient(self.port); browser.cookie = client.cookie
                barrier.wait(5)
                return browser.request(f'/api/characters/{cid}', 'PUT', dict(version=sheet['version'], data=edit, reason='race'), csrf=user['csrf'])
            with ThreadPoolExecutor(max_workers=2) as pool:
                confirmation = pool.submit(approve); editing = pool.submit(edit_sheet)
                confirmation, editing = confirmation.result(), editing.result()
            self.assertEqual(sorted([confirmation[0], editing[0]]), [200, 409])
            latest = client.request(f'/api/characters/{cid}')[1]
            target = self.gm_client.request(f'/api/characters/{self.guard}')[1]
            ammo = next(i['quantity'] for i in latest['data']['items'] if i['id'] == 'ammo')
            if confirmation[0] == 200:
                self.assertEqual(ammo, 9); self.assertEqual(target['data']['wounds'], 14)
                self.assertEqual(latest['data']['notes'], sheet['data']['notes'])
            else:
                self.assertEqual(ammo, 10); self.assertEqual(target['data']['wounds'], 0)
                self.assertEqual(latest['data']['notes'], 'Racing edit preserved')

    def test_sheet_box_cap_retains_uncapped_damage_and_status(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party()
            sheet = self.gm_client.request(f'/api/characters/{self.guard}')[1]
            data = copy.deepcopy(sheet['data']); data['wounds'] = 39
            self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}', 'PUT', dict(version=sheet['version'], data=data, reason='wounds'), csrf=self.gm_identity['csrf'])[0], 200)
            prepared = copy.deepcopy(self.prepare_body); prepared.update(id='prepare-wounded', expectedVersion=1)
            next(a for a in prepared['actors'] if a['characterId'] == self.guard)['version'] += 1
            self.assertEqual(self.gm_client.request(self.path, 'POST', prepared, csrf=self.gm_identity['csrf'])[0], 200)
            _, _, _, declaration = self.declare()
            result, _ = self.command('confirm', declarationId=declaration['id'])
            self.assertEqual(result[0], 200, result)
            target = self.gm_client.request(f'/api/characters/{self.guard}')[1]
            self.assertEqual(target['data']['wounds'], 40)
            actor = next(a for a in result[1]['battle']['scene']['actors'] if a['characterId'] == self.guard)
            self.assertEqual(actor['wounds'], 53)
            self.assertEqual(actor['status'], 'stunned')
            self.assertEqual(result[1]['receipt']['event']['damage'], 14)
            self.assertIn('40', result[1]['rulesNote'])

    def test_six_player_projections_and_revoked_roster_control(self):
        self.party(count=6)
        client, user, cid = self.begin()
        for browser, identity, owned_cid in self.players:
            result = browser.request(self.path)
            self.assertEqual(result[0], 200)
            self.assertEqual(result[1]['controlledActorIds'], ['character-' + str(owned_cid)])
            self.assertEqual(len(result[1]['battle']['scene']['actors']), 7)
            self.assertNotIn('HIDDEN GUARD SECRET', json.dumps(result[1]))
        submitted, declaration = self.command('declare-shot', client, user, actorId='character-' + str(cid), targetId='character-' + str(self.guard), location='torso')
        self.assertEqual(submitted[0], 200, submitted)
        campaign_path = self.path.removesuffix('/battle')
        version = self.gm_client.request(campaign_path)[1]['version']
        self.assertEqual(self.gm_client.request(campaign_path + '/roster', 'POST', dict(version=version, character_id=cid, status='remove'), csrf=self.gm_identity['csrf'])[0], 200)
        self.assertEqual(client.request(self.path)[0], 403)
        self.assertEqual(client.request(self.path + '/commands', 'POST', declaration, csrf=user['csrf'])[0], 403)


if __name__ == '__main__':
    unittest.main()
