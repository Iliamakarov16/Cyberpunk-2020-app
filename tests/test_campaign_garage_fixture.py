"""Actual user-approved garage geometry against temporary authenticated HTTP sessions."""
import json
import unittest
from pathlib import Path
import test_grid_vehicle_props as vehicles

class CampaignGarageFixture(unittest.TestCase):
    setUp=vehicles.GridVehicleHTTP.setUp
    start=vehicles.GridVehicleHTTP.start
    gm=vehicles.GridVehicleHTTP.gm
    player=vehicles.GridVehicleHTTP.player
    campaign=vehicles.GridVehicleHTTP.campaign
    sheet=vehicles.GridVehicleHTTP.sheet
    party=vehicles.GridVehicleHTTP.party
    command=vehicles.GridVehicleHTTP.command
    snapshot=vehicles.GridVehicleHTTP.snapshot
    database=vehicles.GridVehicleHTTP.database
    preview=vehicles.GridVehicleHTTP.preview

    def test_actual_garage_preview_import_export_preserves_sheets(self):
        self.party(count=1,hidden=False)
        document=json.loads((Path(__file__).parent/'fixtures/garage_vehicles_0174.scene.json').read_text())
        self.assertEqual(document['npcs'],[])
        self.assertEqual(document['characters'],[])
        before=self.snapshot(training=True)
        client,user,_=self.players[0]
        self.assertEqual(self.preview(dict(type='import-scene',document=document),client,user)[0],403)
        checked=self.preview(dict(type='import-scene',document=document))
        self.assertEqual(checked[0],200,checked)
        self.assertEqual(before,self.snapshot(training=True))
        imported,request=self.command('import-scene',document=document)
        self.assertEqual(imported[0],200,imported)
        scene=imported[1]['battle']['scene']
        self.assertEqual(scene['props'],document['props'])
        self.assertEqual(scene['tiles'],document['tiles'])
        self.assertEqual(scene['devices'],document['devices'])
        self.assertEqual(sorted(p['type'] for p in scene['props'] if p['type'] in ('car','van')),['car','car','van'])
        self.assertEqual(sum(p['w']*p['h'] for p in scene['props'] if p['type'] in ('car','van')),26)
        duplicate=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf'])
        self.assertEqual(duplicate[0],200,duplicate);self.assertTrue(duplicate[1]['duplicate'])
        exported=self.preview(dict(type='export-scene'))
        self.assertEqual(exported[0],200,exported)
        for field in ('tiles','props','devices','settings','width','height','tileMeters'):
            self.assertEqual(exported[1]['preview']['document'][field],document[field])
        for table in ('characters','revisions'):
            self.assertEqual(before[table],self.snapshot(training=True)[table])

if __name__=='__main__': unittest.main()
