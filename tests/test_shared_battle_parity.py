"""Execute identical fixtures in Python authority and unmodified accepted JS engine."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'android/app/src/main/python'))
import shared_battle as battle
REFERENCE = ROOT / 'tests/fixtures/shared_battle_reference'


def actor(aid, x, y):
    return dict(id=aid, characterId=aid, name=aid, team='crew', sprite=0, x=x, y=y, hidden=False,
                status='active', wounds=0, destroyed=[], facing=1, stats=dict(ref=7, ma=5, body=8, combatSense=2, handgun=4, rifle=0),
                armor={z: 0 for z in battle.ZONES}, weapon=dict(id='gun', name='Pistol', skill='handgun', accuracy=0,
                damageDice=4, damageBonus=1, magazine=8, rof=2, range=50, ammo=8, reserve=32),
                actions=0, shots=0, moved=False, initiative=0, stabilized=False)


def scene():
    return dict(schemaVersion=1, id='parity', name='Parity', subtitle='CP2020', version=0, phase='combat', round=1, index=0,
                order=['a', 'b'], tileMeters=1, width=60, height=8, tiles=[[{'type': 'floor'} for x in range(60)] for y in range(8)],
                props=[], actors=[actor('a', 1, 1), actor('b', 6, 1)], settings={'stagedPenetration': False},
                devices=[], log=[], appliedCommandIds=[])


class RulesParity(unittest.TestCase):
    def reference(self, fixtures):
        return json.loads(subprocess.run(['node', str(REFERENCE / 'runner.mjs')], input=json.dumps(fixtures), text=True, capture_output=True, check=True).stdout)

    def test_reference_is_unmodified(self):
        hashes = {'engine.mjs': '968cc1bb9c64bef87eb3fd5937447545d06b29d13ee885a5a507499f6da436f7',
                  'scene.mjs': '203f7d9753951fbb9f1557178d33418ac4dfba5a722e66a5201cb45ab98361c8',
                  'net.mjs': 'a4e2af8a20cc313be2d861eb9b4583d4d5f187fdb6e1a95aa10c4343baa0742d'}
        for name, digest in hashes.items():
            self.assertEqual(hashlib.sha256((REFERENCE / name).read_bytes()).hexdigest(), digest)

    def test_damage_armor_body_stun_mortal_head_and_limb_parity(self):
        fixtures = []
        for index, (damage, sp, body, wounds, location, values, staged) in enumerate([
            (10, 12, 8, 0, 'torso', [.5], False), (12, 12, 8, 0, 'torso', [.5], True),
            (13, 12, 8, 0, 'torso', [.1], False), (13, 12, 8, 0, 'torso', [.1], True),
            (15, 0, 8, 0, 'torso', [.9], False), (15, 0, 8, 0, 'torso', [.1], False),
            (12, 0, 8, 0, 'head', [.1], False), (7, 0, 8, 0, 'head', [.8], False),
            (20, 0, 8, 0, 'leftArm', [.9], False), (20, 0, 8, 0, 'rightLeg', [.1, .9], False),
            (8, 2, 2, 8, 'torso', [.9], False), (8, 2, 4, 12, 'torso', [.1], False),
            (8, 2, 7, 16, 'torso', [.8], False), (8, 2, 9, 20, 'torso', [.2], False),
            (8, 2, 10, 36, 'torso', [.8], False), (8, 2, 12, 39, 'torso', [.2], False),
        ]):
            target = actor('b', 2, 2); target['stats']['body'] = body; target['wounds'] = wounds; target['armor'][location] = sp
            fixtures.append(dict(operation='hit', target=target, rawDamage=damage, location=location, random=values,
                                 settings={'stagedPenetration': staged}, name='hit-' + str(index)))
        for fixture, expected in zip(fixtures, self.reference(fixtures)):
            with self.subTest(fixture=fixture['name']):
                calls = []
                def rng():
                    value = fixture['random'][len(calls)]; calls.append(value); return value
                target = copy.deepcopy(fixture['target'])
                event = battle.resolve_hit(target, fixture['rawDamage'], fixture['location'], fixture['settings'], rng)
                self.assertEqual(dict(target=target, event=event, calls=len(calls)), expected)

    def test_shoot_preview_resolution_and_invalid_actions_parity(self):
        fixtures = []
        def add(name, random, modify=lambda s,c: None, gm=True):
            state = scene(); cmd = dict(id=name, expectedVersion=0, type='shoot', actorId='a', targetId='b', location='torso')
            modify(state, cmd)
            fixtures.append(dict(name=name, operation='command', scene=state, command=cmd, random=random + [.5] * 24, gm=gm))
        add('rifle-skill', [.8], lambda s,c:(s['actors'][0]['weapon'].update(skill='rifle'),s['actors'][0]['stats'].update(rifle=3,handgun=10)))
        add('critical-miss', [0])
        add('ordinary-miss', [.1])
        add('ordinary-hit', [.8, .2, .4, .6, .8, .3])
        add('exploding-ten', [.99, .8, .2, .4, .6, .8, .7])
        add('random-head', [.8, 0, .9, .9, .9, .9], lambda s,c:c.update(location='random'))
        add('head-called', [.9, .9, .9, .9, .9, .9], lambda s,c:c.update(location='head'))
        add('limb', [.9, .9, .9, .9, .9, .9, .9], lambda s,c:c.update(location='rightArm'))
        add('point-blank', [.8, .5], lambda s,c:s['actors'][1].update(x=2))
        add('armor-stops', [.9, .9, .2, .4, .6, .8], lambda s,c:s['actors'][1]['armor'].update(torso=100))
        add('wound-penalty', [.9, .2], lambda s,c:s['actors'][0].update(wounds=10))
        add('actions-penalty', [.5], lambda s,c:s['actors'][0].update(actions=2))
        add('empty-ammo', [.5], lambda s,c:s['actors'][0]['weapon'].update(ammo=0))
        add('rof', [.5], lambda s,c:s['actors'][0].update(shots=2))
        add('stunned', [.5], lambda s,c:s['actors'][0].update(status='stunned'))
        add('dead-target', [.5], lambda s,c:s['actors'][1].update(status='dead'))
        add('wrong-turn', [.5], lambda s,c:s.update(index=1))
        add('hidden-player-target', [.5], lambda s,c:s['actors'][1].update(hidden=True), False)
        add('wall', [.5], lambda s,c:s['tiles'][1].__setitem__(3, {'type':'wall'}))
        add('closed-door', [.5], lambda s,c:s['tiles'][1].__setitem__(3, {'type':'door','open':False}))
        add('open-door', [.1], lambda s,c:s['tiles'][1].__setitem__(3, {'type':'door','open':True}))
        def cover(s,c):
            s['props'].append(dict(id='cover',type='crate',x=5,y=1,w=1,h=1,cover=True))
        add('cover-random', [.9, .9, .99, .2, .3, .4, .5, .4], lambda s,c:(cover(s,c),c.update(location='random')))
        add('cover-hidden-leg', [.5], lambda s,c:(cover(s,c),c.update(location='rightLeg')))
        for distance in [1, 12, 13, 25, 26, 50, 51]:
            add('range-' + str(distance), [.1], lambda s,c,d=distance:s['actors'][1].update(x=1+d))
        add('out-of-range', [.5], lambda s,c:(s['actors'][0]['weapon'].update(range=2),s['actors'][1].update(x=6)))
        for fixture, expected in zip(fixtures, self.reference(fixtures)):
            with self.subTest(fixture=fixture['name']):
                state = copy.deepcopy(fixture['scene']); calls = []
                def rng():
                    value = fixture['random'][len(calls)]; calls.append(value); return value
                try:
                    preview = battle.preview_shot(state, fixture['command'], fixture['gm'])
                except battle.BattleError:
                    self.assertFalse(expected['ok'])
                    continue
                self.assertTrue(expected['ok'])
                self.assertEqual(preview, expected['preview'])
                event = battle.resolve_shot(state, fixture['command'], rng)
                engine_event = {k:v for k,v in expected['event'].items() if k not in ['id','round','text']}
                self.assertEqual({k:v for k,v in event.items() if k != 'text'}, engine_event)
                # Heading is a new orientation field, not a dice/damage change.
                expected['state']['actors'][0]['heading'] = battle.heading_towards(fixture['scene']['actors'][0], fixture['scene']['actors'][1])
                self.assertEqual(state['actors'], expected['state']['actors'])
                self.assertEqual(len(calls), expected['calls'])

    def test_turn_initiative_recovery_and_death_parity(self):
        fixtures=[]
        for name, modify, kind in [
            ('start', lambda s: s.update(phase='preparation', order=[],round=0), 'start'),
            ('end', lambda s:None, 'end'),
            ('mortal-death', lambda s:(s['actors'][0].update(wounds=30),s['actors'][0]['stats'].update(body=3)), 'end'),
            ('recovery', lambda s:s['actors'][1].update(status='stunned', wounds=10), 'end'),
            ('new-round', lambda s:s.update(index=1), 'end'),
        ]:
            state=scene(); modify(state)
            fixtures.append(dict(name=name, operation='command', scene=state, command=dict(id=name,expectedVersion=0,type=kind,actorId=state['order'][state['index']] if state['order'] else None),random=[.5]*20))
        for fixture, expected in zip(fixtures,self.reference(fixtures)):
            with self.subTest(fixture=fixture['name']):
                state=copy.deepcopy(fixture['scene']); calls=[]
                def rng():
                    value=fixture['random'][len(calls)]; calls.append(value); return value
                if fixture['command']['type']=='start':
                    state['phase']='combat'; state['round']+=1; battle.initiative(state,rng)
                else:
                    battle.next_turn(state,rng)
                for key in ['actors','phase','order','index','round']:
                    self.assertEqual(state[key],expected['state'][key])
                self.assertEqual(len(calls), expected['calls'])


if __name__ == '__main__':
    unittest.main()
