"""0.17.4 stationary, grid-aligned scenery. Original frozen engine stays intact."""
import copy
import json
import subprocess
import unittest
from pathlib import Path

import test_shared_battle_parity as reference
import test_mobile_host as host
import test_tactical_battle_http as tactical
import shared_battle as battle

ROOT = Path(__file__).resolve().parents[1]


def prop(kind='car', x=3, y=2, vertical=False):
    w, h = battle.prop_footprint(kind, 'vertical' if vertical else 'horizontal')
    return dict(id=f'{kind}-{x}-{y}', type=kind, x=x, y=y, w=w, h=h, cover=True, label=kind)


def prepare(props, tiles=None):
    payload = dict(id='geometry', type='prepare', expectedVersion=0, name='Grid props', width=20, height=12,
                   tileMeters=1, actors=[], props=copy.deepcopy(props))
    if tiles is not None:
        payload['tiles'] = tiles
    return battle.prepare(None, dict(gm_id=1), payload, 0)


class GridVehicleProps(unittest.TestCase):
    def test_catalog_javascript_python_parity(self):
        script = "import {PROP_CATALOG,propFootprint} from './web-source/lib/firefight/props.mjs';console.log(JSON.stringify({catalog:PROP_CATALOG,vertical:Object.fromEntries(Object.keys(PROP_CATALOG).map(k=>[k,propFootprint(k,'vertical')]))}));"
        output = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True, capture_output=True, check=True).stdout)
        self.assertEqual(output['catalog'], battle.PROP_CATALOG)
        for kind, shape in output['vertical'].items():
            self.assertEqual((shape['w'], shape['h']), battle.prop_footprint(kind, 'vertical'))

    def test_vehicle_schema_and_blueprint_roundtrip_in_both_orientations(self):
        props = [prop('car', 2, 2), prop('car', 8, 2, True), prop('van', 12, 2, True)]
        scene = prepare(props)
        document, _ = battle.export_blueprint(None, scene)
        imported, _, _ = battle.import_blueprint(None, dict(gm_id=1), scene, document)
        self.assertEqual(imported['props'], props)
        self.assertEqual(imported['tiles'], scene['tiles'])
        self.assertEqual(imported['tileMeters'], 1)
        self.assertNotIn('orientation', imported['props'][1])
        # Original scene schema import remains supported, including old furniture.
        original = reference.scene(); original.update(phase='preparation',actors=[],props=[prop('van',3,2)])
        imported, _, _ = battle.import_blueprint(None, dict(gm_id=1), scene, original)
        self.assertEqual(imported['props'], original['props'])

    def test_four_facings_roundtrip_and_strict_validation(self):
        for kind in battle.PROP_CATALOG:
            for facing in (0,90,180,270):
                scene=prepare([])
                cmd=dict(type='paint',paint=kind,x=3,y=2,facing=facing)
                battle.validate_action(cmd)
                preview=battle.preview_action(scene,cmd)
                self.assertEqual((preview['footprint']['w'],preview['footprint']['h']),battle.prop_footprint(kind,facing))
                battle.apply_action(scene,cmd,lambda:.5)
                self.assertEqual(scene['props'][0]['facing'],facing)
                document,_=battle.export_blueprint(None,scene)
                imported,_,_=battle.import_blueprint(None,dict(gm_id=1),scene,document)
                self.assertEqual(imported['props'],scene['props'])
        for facing in (True,False,'90',45,360,-90,90.5,None,{},[]):
            with self.subTest(facing=facing),self.assertRaises(battle.BattleError):
                battle.validate_action(dict(type='paint',paint='car',x=3,y=2,facing=facing))
            with self.subTest(imported=facing),self.assertRaises(battle.BattleError):
                prepare([dict(prop(),facing=facing)])
        for update in [dict(paint='floor'),dict(paint='wall'),dict(paint=[]),dict(paint={}),dict(orientation='vertical')]:
            with self.assertRaises(battle.BattleError):battle.validate_action(dict(type='paint',paint='car',x=3,y=2,facing=90,**{k:v for k,v in update.items() if k!='paint'}) if 'paint' not in update else dict(type='paint',paint=update['paint'],x=3,y=2,facing=90))
        with self.assertRaises(battle.BattleError):prepare([dict(prop(),facing=90)])

    def test_invalid_vehicle_geometry_rejected_before_import(self):
        cases = [dict(w=3),dict(h=3),dict(x=17),dict(x=-1),dict(x=2.5),dict(w=True),dict(type='motorbike'),dict(rotation=90)]
        for update in cases:
            with self.subTest(update=update), self.assertRaises(battle.BattleError):
                prepare([dict(prop(), **update)])
        for tile in [dict(type='wall'),dict(type='door',open=False),dict(type='door',open=True)]:
            tiles = [[dict(type='floor') for _ in range(20)] for _ in range(12)]
            tiles[2][4] = tile
            with self.assertRaises(battle.BattleError): prepare([prop()], tiles)
        with self.assertRaises(battle.BattleError): prepare([prop(), prop('crate',4,3)])
        with self.assertRaises(battle.BattleError): prepare([prop(), prop('van',5,2)])

    def test_original_js_movement_line_of_fire_and_cover_parity(self):
        cases = []
        for kind in ['car','van']:
            for vertical in [False,True]:
                scene = prepare([prop(kind,3,2,vertical)])
                p = scene['props'][0]
                for covered in [True,False]:
                    p['cover'] = covered
                    for distant in [False,True]:
                        target = dict(x=p['x']+p['w']+(2 if distant else 0),y=2)
                        actor = dict(x=1,y=2)
                        cases.append(dict(scene=copy.deepcopy(scene),actor=actor,target=target))
        script = "import fs from 'node:fs';import {walkable,lineOfFire,findPath} from './tests/fixtures/shared_battle_reference/engine.mjs';const cases=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(cases.map(({scene,actor,target})=>({walk:scene.tiles.map((r,y)=>r.map((_,x)=>walkable(scene,x,y))),line:lineOfFire(scene,actor,target)}))));"
        expected = json.loads(subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,input=json.dumps(cases),text=True,capture_output=True,check=True).stdout)
        for case, want in zip(cases, expected):
            scene = case['scene']; line = battle.line_of_fire(scene,case['actor'],case['target'])
            self.assertEqual([[battle.walkable(scene,x,y) for x in range(scene['width'])] for y in range(scene['height'])],want['walk'])
            self.assertEqual(line,{k:want['line'][k] for k in ('blocked','cover','exposed')})
            self.assertFalse(line['blocked'], 'Props must not invent wall-style LOS blocking')
            p = scene['props'][0]
            for y in range(p['y'],p['y']+p['h']):
                for x in range(p['x'],p['x']+p['w']): self.assertFalse(battle.walkable(scene,x,y))
            self.assertTrue(battle.walkable(scene,p['x']+p['w'],p['y']))
        # The route goes around every occupied cell, not through a transparent roof.
        scene=prepare([prop()]); a=reference.actor('a',1,2); scene['actors']=[a]
        path=battle.find_path(scene,a,8,2)
        self.assertIsNotNone(path)
        for step in path['path']: self.assertIsNone(battle.prop_at(scene,step['x'],step['y']))

    def test_new_paint_validates_full_footprint_and_preserves_original_erase(self):
        for kind in ['table','counter','barrel','car','van']:
            for orientation in ['horizontal','vertical']:
                scene=prepare([])
                cmd=dict(type='paint',paint=kind,x=3,y=2,orientation=orientation)
                battle.validate_action(cmd)
                preview=battle.preview_action(scene,cmd)
                self.assertEqual((preview['footprint']['w'],preview['footprint']['h']),battle.prop_footprint(kind,orientation))
                battle.apply_action(scene,cmd,lambda:.5)
                p=scene['props'][0]; self.assertEqual(p['type'],kind)
                self.assertEqual((p['w'],p['h']),battle.prop_footprint(kind,orientation))
                with self.assertRaises(battle.BattleError): battle.preview_action(scene,cmd)
                battle.apply_action(scene,dict(type='paint',paint='floor',x=p['x']+p['w']-1,y=p['y']+p['h']-1),lambda:.5)
                self.assertEqual(scene['props'],[])
        for update in [dict(x=18),dict(y=11),dict(x=-1),dict(orientation='diagonal')]:
            cmd = dict(type='paint',paint='car',x=3,y=2)
            cmd.update(update)
            with self.assertRaises(battle.BattleError): battle.preview_action(prepare([]),cmd)
        scene=prepare([]); scene['actors']=[reference.actor('a',6,3)]
        with self.assertRaises(battle.BattleError): battle.preview_action(scene,dict(type='paint',paint='car',x=3,y=2))
        scene=prepare([]); scene['devices']=[dict(id='port',type='port',x=6,y=3)]
        with self.assertRaises(battle.BattleError): battle.preview_action(scene,dict(type='paint',paint='car',x=3,y=2))
        with self.assertRaises(battle.BattleError): battle.validate_action(dict(type='paint',paint='floor',x=3,y=2,orientation='vertical'))


class GridVehicleHTTP(unittest.TestCase):
    setUp=host.MobileHostIntegration.setUp
    start=host.MobileHostIntegration.start
    gm=host.MobileHostIntegration.gm
    player=host.MobileHostIntegration.player
    campaign=host.MobileHostIntegration.campaign
    sheet=tactical.TacticalHTTP.sheet
    party=tactical.TacticalHTTP.party
    command=tactical.TacticalHTTP.command
    snapshot=tactical.TacticalHTTP.snapshot
    database=tactical.TacticalHTTP.database
    preview=tactical.TacticalHTTP.preview

    def test_authoritative_rotated_vehicle_create_export_import_undo_and_player_denial(self):
        self.party(count=1,hidden=False)
        client,user,_=self.players[0]
        action=dict(type='paint',paint='van',x=10,y=2,facing=270)
        before=self.snapshot(training=True)
        self.assertEqual(self.preview(action,client,user)[0],403)
        preview=self.preview(action);self.assertEqual(preview[0],200,preview)
        self.assertEqual(preview[1]['preview']['footprint'],dict(x=10,y=2,w=2,h=5))
        self.assertEqual(before,self.snapshot(training=True))
        result,request=self.command('paint',paint='van',x=10,y=2,facing=270)
        self.assertEqual(result[0],200,result)
        vehicle=result[1]['battle']['scene']['props'][0]
        self.assertEqual(vehicle['facing'],270)
        self.assertEqual((vehicle['type'],vehicle['w'],vehicle['h']),('van',2,5))
        duplicate=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf'])
        self.assertEqual(duplicate[0],200);self.assertTrue(duplicate[1]['duplicate'])
        export=self.preview(dict(type='export-scene'));self.assertEqual(export[0],200,export)
        document=export[1]['preview']['document'];self.assertEqual(document['props'],[vehicle])
        imported,_=self.command('import-scene',document=document)
        self.assertEqual(imported[0],200,imported);self.assertEqual(imported[1]['battle']['scene']['props'],[vehicle])
        erased,_=self.command('paint',paint='floor',x=11,y=6)
        self.assertEqual(erased[0],200,erased);self.assertEqual(erased[1]['battle']['scene']['props'],[])
        restored,_=self.command('undo')
        self.assertEqual(restored[0],200,restored);self.assertEqual(restored[1]['battle']['scene']['props'],[vehicle])
        for table in ['characters','revisions']:
            self.assertEqual(before[table],self.snapshot(training=True)[table])


if __name__ == '__main__': unittest.main()
