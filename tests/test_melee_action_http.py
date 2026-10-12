"""Real authenticated declaration/GM opposed melee, private rulings and atomic sheets."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_tactical_battle_http as tactical
import shared_battle as battle

class MeleeHTTP(unittest.TestCase):
    setUp=tactical.TacticalHTTP.setUp
    start=tactical.TacticalHTTP.start
    gm=tactical.TacticalHTTP.gm
    player=tactical.TacticalHTTP.player
    campaign=tactical.TacticalHTTP.campaign
    sheet=tactical.TacticalHTTP.sheet
    party=tactical.TacticalHTTP.party
    command=tactical.TacticalHTTP.command
    begin=tactical.TacticalHTTP.begin
    database=tactical.TacticalHTTP.database
    snapshot=tactical.TacticalHTTP.snapshot
    preview=tactical.TacticalHTTP.preview

    def setup_melee(self):
        self.party(count=1,hidden=False)
        body=copy.deepcopy(self.prepare_body);body.update(id='adjacent',expectedVersion=1)
        body['actors'][1]['x']=2
        prepared=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(prepared[0],200,prepared)
        client,user,cid=self.begin()
        action=dict(type='melee',actorId='character-'+str(cid),targetId='character-'+str(self.guard),technique='kick',skillName='')
        ruling=dict(defenseSkillName='',defenseSkillKind='dodge',defenderAware=True,attackModifier=0,defenseModifier=0)
        return client,user,cid,action,ruling

    def test_player_intent_gm_choice_damage_exactly_once_and_undo(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid,action,ruling=self.setup_melee()
            before=self.snapshot(training=True)
            preview=self.preview(action,client,user);self.assertEqual(preview[0],200,preview)
            self.assertTrue(preview[1]['preview']['requiresGmMeleeDecision'])
            self.assertNotIn('defenseOptions',preview[1]['preview'])
            denied=self.preview(dict(action,gmMelee=ruling),client,user);self.assertEqual(denied[0],403,denied)
            declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
            missing,_=self.command('confirm',declarationId=request['id']);self.assertEqual(missing[0],400,missing)
            gm_preview=self.preview(dict(action,gmMelee=ruling));self.assertEqual(gm_preview[0],200,gm_preview)
            self.assertTrue(gm_preview[1]['preview']['ok']);self.assertFalse({'_attack','_defense'} & set(gm_preview[1]['preview']))
            confirmed,receipt=self.command('confirm',declarationId=request['id'],gmMelee=ruling)
            self.assertEqual(confirmed[0],200,confirmed);event=confirmed[1]['receipt']['event'];self.assertTrue(event['hit']);self.assertEqual(event['kind'],'melee')
            after=self.snapshot(training=True)
            self.assertNotEqual(before['characters'],after['characters'])
            original_ammo=10
            for actor_cid,c in [(cid,client),(self.guard,self.gm_client)]:
                data=c.request(f'/api/characters/{actor_cid}')[1]['data']
                self.assertEqual(next(i for i in data['items'] if i['id']=='ammo')['quantity'],original_ammo)
            duplicate=self.gm_client.request(self.path+'/commands','POST',receipt,csrf=self.gm_identity['csrf'])
            self.assertEqual(duplicate[0],200,duplicate);self.assertTrue(duplicate[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
            player=client.request(self.path)[1];self.assertNotIn('meleeReceipt',json.dumps(player));self.assertNotIn('PRIVATE',json.dumps(player))
            undone,_=self.command('undo');self.assertEqual(undone[0],200,undone)
            self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}')[1]['data']['wounds'],0)

    def test_reject_foreign_skill_unaware_forged_target_and_stale_sheet(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid,action,ruling=self.setup_melee()
            for bad in (dict(action,skillName='Handgun'),dict(action,gmMelee=dict(ruling,defenderAware=False)),dict(action,gmMelee=dict(ruling,defenseSkillName='Handgun'))):
                response=self.preview(bad);self.assertTrue(response[0]!=200 or not response[1]['preview']['ok'],response)
            far=copy.deepcopy(action);far['targetId']='missing';self.assertEqual(self.preview(far,client,user)[0],400)
            current=self.gm_client.request(f'/api/characters/{self.guard}')[1]
            data=copy.deepcopy(current['data']);data['notes']='An external edit'
            changed=self.gm_client.request(f'/api/characters/{self.guard}','PUT',dict(data=data,version=current['version'],reason='external'),csrf=self.gm_identity['csrf']);self.assertEqual(changed[0],200,changed)
            before=self.snapshot(training=True)
            failed,_=self.command('melee',**{k:v for k,v in action.items() if k!='type'},gmMelee=ruling)
            self.assertEqual(failed[0],409,failed);self.assertEqual(before,self.snapshot(training=True))

    def test_fumble_receipt_persists_private_pending_consequence_no_fake_damage(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            _,_,_,action,ruling=self.setup_melee()
        dice=iter([0,.8,.4])
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(dice))):
            result,_=self.command('melee',**{k:v for k,v in action.items() if k!='type'},gmMelee=ruling)
        self.assertEqual(result[0],200,result);event=result[1]['receipt']['event']
        self.assertFalse(event['hit']);self.assertTrue(event['requiresGmResolution'])
        self.assertEqual(len(result[1]['battle']['scene']['unresolvedFumbles']),1)
        for client,_,_ in self.players:self.assertNotIn('unresolvedFumbles',json.dumps(client.request(self.path)[1]))
