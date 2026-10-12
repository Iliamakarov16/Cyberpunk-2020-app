"""Original tactical actions: Python authority versus frozen accepted JS engine."""
import copy
import unittest

import test_shared_battle_parity as reference
scene, actor = reference.scene, reference.actor
import shared_battle as battle


class TacticalParity(unittest.TestCase):
    reference = reference.RulesParity.reference

    def test_original_bar_stats_devices_map_with_explicit_new_visibility_default(self):
        expected = self.reference([dict(operation='demo')])[0]
        actual, _ = battle.training_scene(dict(gm_id=71), 0, lambda: .5)
        # Requirement-driven demo change: LOS handles room secrecy. Manual GM
        # hiding remains available but is no longer pre-set on this guard.
        expected['demoRevision']=3
        next(a for a in expected['actors'] if a['id']=='guard-2')['hidden']=False
        for key in ('schemaVersion', 'demoRevision', 'name', 'phase', 'round', 'index', 'order', 'tileMeters', 'width', 'height', 'tiles', 'props', 'devices', 'settings'):
            self.assertEqual(actual[key], expected[key], key)
        for got, want in zip(actual['actors'], expected['actors']):
            want['heading'] = 0  # New default direction; original combat statistics stay unchanged.
            self.assertEqual({k: v for k, v in got.items() if k not in ('characterId', 'ownerId', 'sheetVersion')},
                             {k: v for k, v in want.items() if k != 'characterId'})
            self.assertLess(got['characterId'], 0)

    def test_actions_and_rejections_match_original_engine(self):
        fixtures = []
        def add(name, kind, fields=None, modify=lambda s: None, random=None):
            state = scene(); modify(state)
            command = dict(id=name, expectedVersion=0, type=kind, **(fields or {}))
            fixtures.append(dict(name=name, operation='command', scene=state, command=command, random=random or [.5] * 40))
        add('move-diagonal', 'move', dict(actorId='a', x=4, y=4))
        add('move-scale', 'move', dict(actorId='a', x=5, y=3), lambda s:s.update(tileMeters=2))
        add('move-too-far', 'move', dict(actorId='a', x=40, y=2))
        add('move-same-cell', 'move', dict(actorId='a', x=1, y=1))
        add('move-twice', 'move', dict(actorId='a', x=2, y=2), lambda s:s['actors'][0].update(moved=True))
        add('move-occupied', 'move', dict(actorId='a', x=6, y=1))
        def sealed(s):
            for x,y in [(0,1),(2,1),(1,0),(1,2)]:
                s['tiles'][y][x] = dict(type='wall')
        add('move-corner-cut-forbidden', 'move', dict(actorId='a',x=2,y=2), sealed)
        add('reload-partial', 'reload', dict(actorId='a'), lambda s:s['actors'][0]['weapon'].update(ammo=2,reserve=3))
        add('reload-fill', 'reload', dict(actorId='a'), lambda s:s['actors'][0]['weapon'].update(ammo=0,reserve=20))
        add('reload-full', 'reload', dict(actorId='a'))
        add('reload-no-reserve', 'reload', dict(actorId='a'), lambda s:s['actors'][0]['weapon'].update(ammo=0,reserve=0))
        add('reload-stunned', 'reload', dict(actorId='a'), lambda s:s['actors'][0].update(status='stunned'))
        def door(s):
            s['tiles'][2][2] = dict(type='door',open=False)
        add('interact-door', 'interact', dict(actorId='a',x=2,y=2), door)
        add('interact-too-far', 'interact', dict(actorId='a',x=2,y=2), lambda s:(door(s),s['actors'][0].update(x=5)))
        add('gm-door', 'door', dict(x=2,y=2), door)
        add('gm-door-occupied', 'door', dict(x=2,y=2), lambda s:(door(s),s['tiles'][2][2].update(open=True),s['actors'][0].update(x=2,y=2)))
        add('pause', 'pause')
        add('resume', 'resume', modify=lambda s:s.update(phase='paused'))
        add('resume-invalid', 'resume')
        add('finish', 'finish')
        add('hidden-npc', 'hide', dict(actorId='b'), lambda s:s['actors'][1].update(team='hostile'))
        add('cannot-hide-crew', 'hide', dict(actorId='a'))
        add('place-ended', 'place', dict(actorId='a',x=3,y=4), lambda s:s.update(phase='ended'))
        add('place-in-combat', 'place', dict(actorId='a',x=3,y=4))
        for paint in ('floor','wall','crate','door'):
            add('paint-' + paint, 'paint', dict(x=3,y=3,paint=paint), lambda s:s.update(phase='preparation'))
        add('paint-in-combat', 'paint', dict(x=3,y=3,paint='wall'))
        def net(s):
            a=s['actors'][0]; a['stats']['interface']=4
            a['net']=dict(deck=True,programIds=['genie','crystalBall','soundmachine'],linkedPortId='port',knownDeviceIds=['door','camera','speaker'],controlUsed=False)
            s['devices']=[dict(id='port',name='Port',type='port',networkId='bar',x=1,y=2),
                          dict(id='door',name='Door',type='door',networkId='bar',x=2,y=2),
                          dict(id='camera',name='Camera',type='camera',networkId='bar',x=5,y=1,range=6,active=True),
                          dict(id='speaker',name='Speaker',type='speaker',networkId='bar',x=10,y=2,active=False)]
            door(s)
        add('net-connect','connect',dict(actorId='a',deviceId='port'),lambda s:(net(s),s['actors'][0]['net'].update(linkedPortId=None,knownDeviceIds=[])))
        add('net-connect-same','connect',dict(actorId='a',deviceId='port'),net)
        add('net-disconnect','disconnect',dict(actorId='a'),net)
        add('net-locate','scan',dict(actorId='a'),net)
        add('net-locate-no-deck','scan',dict(actorId='a'))
        add('net-control-door-success','control',dict(actorId='a',deviceId='door',operation='open'),net,[.4])
        add('net-control-door-failure','control',dict(actorId='a',deviceId='door',operation='open'),net,[.5])
        add('net-control-wrong-operation','control',dict(actorId='a',deviceId='door',operation='close'),net)
        add('net-control-one-attempt','control',dict(actorId='a',deviceId='door',operation='open'),lambda s:(net(s),s['actors'][0]['net'].update(controlUsed=True)))
        add('net-control-no-program','control',dict(actorId='a',deviceId='door',operation='open'),lambda s:(net(s),s['actors'][0]['net'].update(programIds=[])))
        add('net-control-unknown','control',dict(actorId='a',deviceId='door',operation='open'),lambda s:(net(s),s['actors'][0]['net'].update(knownDeviceIds=[])))
        add('net-control-speaker','control',dict(actorId='a',deviceId='speaker',operation='on'),net,[.2])
        add('net-control-camera-reveal','control',dict(actorId='a',deviceId='camera',operation='observe'),lambda s:(net(s),s['actors'][1].update(hidden=True)),[.3])
        add('net-control-camera-wall','control',dict(actorId='a',deviceId='camera',operation='observe'),lambda s:(net(s),s['actors'][1].update(hidden=True,x=8),s['tiles'][1].__setitem__(7,dict(type='wall'))),[.3])
        add('net-cable-break-on-move','move',dict(actorId='a',x=4,y=4),net)
        add('net-control-reset-new-round','end',dict(actorId='b'),lambda s:(net(s),s.update(index=1),s['actors'][0]['net'].update(controlUsed=True)))
        for fixture, expected in zip(fixtures,self.reference(fixtures)):
            with self.subTest(case=fixture['name']):
                state=copy.deepcopy(fixture['scene']); calls=[]
                def rng():
                    value=fixture['random'][len(calls)]; calls.append(value); return value
                try:
                    preview=battle.preview_action(state,fixture['command'])
                except battle.BattleError:
                    self.assertFalse(expected['ok']); continue
                self.assertTrue(expected['ok'])
                public=expected['preview']
                if 'device' in public:
                    public['device']=battle.safe_device(public['device'])
                # Floating point diagonal accumulation can differ by one ULP.
                if 'distance' in public:
                    self.assertAlmostEqual(preview.pop('distance'),public.pop('distance'),places=12)
                self.assertEqual(preview,public)
                event=battle.apply_action(state,fixture['command'],rng,training=True)
                if fixture['command']['type'] == 'move':
                    route = expected['preview']['path']
                    origin = next(a for a in fixture['scene']['actors'] if a['id'] == fixture['command']['actorId'])
                    previous = route[-2] if len(route) > 1 else origin
                    next(a for a in expected['state']['actors'] if a['id'] == origin['id'])['heading'] = battle.heading_towards(previous, route[-1])
                for key in ('actors','tiles','props','devices','phase','round','order','index'):
                    self.assertEqual(state[key],expected['state'][key],key)
                got={k:v for k,v in event.items() if k not in ('id','text','round')}
                want={k:v for k,v in expected['event'].items() if k not in ('id','text','round')}
                self.assertEqual(got,want)
                self.assertEqual(len(calls),expected['calls'])


if __name__ == '__main__':
    unittest.main()
