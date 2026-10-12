"""Synthetic equipment stays scene-owned and requires explicit GM configuration."""
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_training_battle as training
import shared_battle as b

class SceneLoadoutHTTP(unittest.TestCase):
    setUp=training.TrainingBattleHTTP.setUp
    start=training.TrainingBattleHTTP.start
    gm=training.TrainingBattleHTTP.gm
    player=training.TrainingBattleHTTP.player
    campaign=training.TrainingBattleHTTP.campaign
    command=training.TrainingBattleHTTP.command
    database=training.TrainingBattleHTTP.database
    snapshot=training.TrainingBattleHTTP.snapshot
    training_setup=training.TrainingBattleHTTP.training_setup
    def scene(self):
        self.gm_client,self.gm_identity=self.gm()
        self.campaign_id=self.campaign(self.gm_client,self.gm_identity)['id']
        self.path=f'/api/campaigns/{self.campaign_id}/battle/training'
        result,_=self.training_setup();self.assertEqual(result[0],200,result)
        return result[1]
    def config(self,view):
        row=next(r for r in view['options']['sceneLoadouts'] if r['actorId']=='ray')
        w=next(a for a in view['battle']['scene']['actors'] if a['id']=='ray')['weapon']
        return dict(weapons=[dict(weaponId=w['id'],kind='ranged',profileId='GM explicitly approves demo class',weaponType='handgun',skillName='Handgun',skillRank=4,damageDice=4,damageBonus=1,accuracy=0,ammoItemId='ammo-'+w['id'],range=50,rof=1,magazine=8,loaded=8,fireModes=['single'],singleActionCap=1,reliability='VR',fumbleClass='nonautomatic')],activeWeaponId=w['id'])
    def test_synthetic_profile_conservation_repeat_remove_and_undo(self):
        view=self.scene();before=self.snapshot();config=self.config(view)
        hints=view['options']['sceneLoadouts'][0]['data']['profileSuggestions']['colt-amt2000']
        self.assertEqual(hints['reliability'],'VR');self.assertNotIn('fireModes',hints);self.assertNotIn('fumbleClass',hints)
        saved,request=self.command('configure-loadout',actorId='ray',config=config);self.assertEqual(saved[0],200,saved)
        actor=next(a for a in saved[1]['battle']['scene']['actors'] if a['id']=='ray')
        self.assertEqual(actor['weapon']['skillRank'],4);self.assertEqual(actor['weapon']['ammo'],8);self.assertEqual(actor['weapon']['reserve'],32)
        retry=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertTrue(retry[1]['duplicate'])
        emptied,_=self.command('configure-loadout',actorId='ray',config=dict(weapons=[],activeWeaponId=None));self.assertEqual(emptied[0],200,emptied)
        inventory=next(r for r in emptied[1]['options']['sceneLoadouts'] if r['actorId']=='ray')['data']
        self.assertEqual(next(i for i in inventory['items'] if i['category']=='ammo')['quantity'],40)
        self.assertTrue(any(i['category']=='weapon' for i in inventory['items']))
        restored,_=self.command('undo');self.assertEqual(restored[0],200,restored)
        self.assertEqual(next(a for a in restored[1]['battle']['scene']['actors'] if a['id']=='ray')['weapon']['ammo'],8)
        self.assertEqual(before,self.snapshot(),'No real sheet or campaign data written by training')
    def test_profile_is_preparation_only_and_invalid_values_do_not_mutate(self):
        view=self.scene();config=self.config(view);bad=copy.deepcopy(config);bad['weapons'][0]['fumbleClass']='guessed';before=self.snapshot(training=True)
        failed,_=self.command('configure-loadout',actorId='ray',config=bad);self.assertEqual(failed[0],400,failed);self.assertEqual(before,self.snapshot(training=True))
        with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            started,_=self.command('start');self.assertEqual(started[0],200,started)
        failed,_=self.command('configure-loadout',actorId='ray',config=config);self.assertEqual(failed[0],409,failed)
