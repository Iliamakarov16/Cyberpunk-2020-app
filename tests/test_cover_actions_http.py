"""Real sessions for cover, table flip, private views, resources and undo."""
import copy,json,unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_tactical_battle_http as base
import shared_battle as battle

def profile(**changes):
    value=dict(material='Explicit GM wood',sp=5,coveredZones=['rightLeg','leftLeg'],blocksVision=False,movable=True,flippedCoveredZones=['torso','rightArm','leftArm','rightLeg','leftLeg'],flippedBlocksVision=True)
    value.update(changes);return value

class CoverHTTP(unittest.TestCase):
    setUp=base.TacticalHTTP.setUp;start=base.TacticalHTTP.start;gm=base.TacticalHTTP.gm;player=base.TacticalHTTP.player
    campaign=base.TacticalHTTP.campaign;sheet=base.TacticalHTTP.sheet;party=base.TacticalHTTP.party
    command=base.TacticalHTTP.command;begin=base.TacticalHTTP.begin;database=base.TacticalHTTP.database
    snapshot=base.TacticalHTTP.snapshot;preview=base.TacticalHTTP.preview
    def setup_cover(self,opaque=False):
        self.party(count=1,hidden=False)
        body=copy.deepcopy(self.prepare_body);body.update(id='cover-layout',expectedVersion=1)
        body['actors'][0].update(x=1,y=2,heading=0)
        body['actors'][1].update(x=5,y=2,heading=180);body['actors'][1]['armor']['torso']=8
        body['props']=[dict(id='table',type='table',x=2,y=2,w=2,h=2,cover=True,label='Table',protection=profile(blocksVision=opaque))]
        body['settings']=dict(stagedPenetration=True,cp2020Rulings=dict(nonautomaticFumbleAmmo='consume-attempted',coverArmorWear='none'))
        result=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(result[0],200,result)
        self.cover_body=body;client,user,cid=self.begin();self.aid='character-'+str(cid);self.target='character-'+str(self.guard)
        return client,user,cid
    def fire(self,**changes):
        command=dict(type='fire',actorId=self.aid,targetIds=[self.target],mode='single',rounds=1,location='torso',coverMode='through');command.update(changes);return command
    def execute(self,action):return self.command(action['type'],**{k:v for k,v in action.items() if k!='type'})
    def test_flip_request_confirmation_private_vision_retry_undo(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.setup_cover();before=self.snapshot(training=True)
            original=client.request(self.path)[1]['battle']['scene'];self.assertIn(self.target,[a['id'] for a in original['actors']]);self.assertNotIn('sp',original['props'][0]['protection'])
            action=dict(type='flip',actorId=self.aid,propId='table',facing=0)
            preview=self.preview(action,client,user);self.assertEqual(preview[0],200,preview);self.assertTrue(preview[1]['preview']['ok']);self.assertEqual(before,self.snapshot(training=True))
            direct,_=self.command('flip',client,user,**{k:v for k,v in action.items() if k!='type'});self.assertEqual(direct[0],403)
            declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
            done,confirmation=self.command('confirm',declarationId=request['id']);self.assertEqual(done[0],200,done)
            prop=done[1]['battle']['scene']['props'][0];self.assertEqual((prop['x'],prop['w'],prop['h']),(3,1,2));self.assertTrue(prop['flipped'])
            actor=next(a for a in done[1]['battle']['scene']['actors'] if a['id']==self.aid);self.assertEqual(actor['actions'],1)
            player=client.request(self.path)[1];self.assertNotIn(self.target,[a['id'] for a in player['battle']['scene']['actors']]);self.assertNotIn('Explicit GM wood',json.dumps(player))
            after=self.snapshot(training=True);self.assertEqual(before['characters'],after['characters'])
            repeated=self.gm_client.request(self.path+'/commands','POST',confirmation,csrf=self.gm_identity['csrf']);self.assertTrue(repeated[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
            denied=self.preview(action,client,user);self.assertFalse(denied[1]['preview']['ok'])
            undo,_=self.command('undo');self.assertEqual(undo[0],200,undo);restored=client.request(self.path)[1]['battle']['scene'];self.assertIn(self.target,[a['id'] for a in restored['actors']]);self.assertEqual(restored['props'][0]['w'],2)
    def test_material_private_gm_only_fresh_version(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.setup_cover();before=self.snapshot(training=True)
            bad,_=self.command('configure-cover',client,user,target=dict(propId='table'),profile=profile(sp=99));self.assertEqual(bad[0],403);self.assertEqual(before,self.snapshot(training=True))
            good,body=self.command('configure-cover',target=dict(propId='table'),profile=profile(sp=9));self.assertEqual(good[0],200,good)
            stale=dict(body,id='stale-material',profile=profile(sp=50));rejected=self.gm_client.request(self.path+'/commands','POST',stale,csrf=self.gm_identity['csrf']);self.assertEqual(rejected[0],409)
            projected=json.dumps(client.request(self.path)[1]);self.assertNotIn('Explicit GM wood',projected);self.assertNotIn('"sp": 9',projected)
            undo,_=self.command('undo');self.assertEqual(undo[0],200);self.assertEqual(undo[1]['battle']['scene']['props'][0]['protection']['sp'],5)
    def test_exposure_through_proportional_damage_private_preview(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.setup_cover()
            configured,_=self.command('configure-cover',target=dict(propId='table'),profile=profile(coveredZones=['torso','rightLeg','leftLeg']));self.assertEqual(configured[0],200)
            exposed=self.preview(self.fire(coverMode='exposed'),client,user);self.assertFalse(exposed[1]['preview']['ok'])
            preview=self.preview(self.fire(),client,user);self.assertTrue(preview[1]['preview']['ok']);self.assertFalse(preview[1]['preview']['readyToRoll']);self.assertNotIn('protectionReview',preview[1]['preview'])
            before=self.snapshot(training=True);blocked,_=self.execute(self.fire(gmFire=dict(turnToTarget=False,throughModifier=0)));self.assertEqual(blocked[0],400);self.assertEqual(before,self.snapshot(training=True))
            action=self.fire(gmFire=dict(turnToTarget=False,throughModifier=0,throughTargetKnown=True))
            preview=self.preview(action);self.assertEqual(preview[1]['preview']['protectionReview'][0]['zones'][0]['effectiveSP'],13)
            done,body=self.execute(action);self.assertEqual(done[0],200,done)
            impact=done[1]['receipt']['event']['impacts'][0];self.assertEqual((impact['coverProtection']['effectiveSP'],impact['rawDamage'],impact['penetration'],impact['damage']),(13,17,4,1))
            target=next(a for a in done[1]['battle']['scene']['actors'] if a['id']==self.target);self.assertEqual(target['armor']['torso'],8)
            wearer=self.gm_client.request(f'/api/characters/{self.guard}')[1];self.assertEqual(wearer['data']['wounds'],1);self.assertEqual(next(i for i in wearer['data']['items'] if i['id']=='vest')['armor']['coverage']['torso'],8)
            after=self.snapshot(training=True);self.assertTrue(self.gm_client.request(self.path+'/commands','POST',body,csrf=self.gm_identity['csrf'])[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
            self.assertNotIn('coverProtection',json.dumps(client.request(self.path)[1]));undo,_=self.command('undo');self.assertEqual(undo[0],200);self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}')[1]['data']['wounds'],0)
    def test_opaque_barrier_player_target_denied_gm_through_no_destruction(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.setup_cover(True);forged=self.preview(self.fire(),client,user);self.assertEqual(forged[0],400)
            done,_=self.execute(self.fire(gmFire=dict(turnToTarget=False,throughModifier=0,throughTargetKnown=True)));self.assertEqual(done[0],200,done)
            self.assertTrue(done[1]['battle']['scene']['props'][0]['protection']['blocksVision']);self.assertEqual(done[1]['battle']['scene']['props'][0]['protection']['sp'],5)
            private=json.dumps(client.request(self.path)[1]);self.assertNotIn(self.target,private);self.assertNotIn('coverProtection',private)
    def test_optional_armor_rule_explicit_and_undo(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.setup_cover();denied,_=self.command('armor-rule',client,user,enabled=False);self.assertEqual(denied[0],403)
            invalid,_=self.command('armor-rule',enabled=0);self.assertEqual(invalid[0],400)
            result,_=self.command('armor-rule',enabled=False);self.assertEqual(result[0],200);self.assertFalse(result[1]['battle']['scene']['settings']['stagedPenetration'])
            undo,_=self.command('undo');self.assertEqual(undo[0],200);self.assertTrue(undo[1]['battle']['scene']['settings']['stagedPenetration'])

    def test_blueprint_preserves_profiles_posture_and_optional_rule(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.setup_cover();result,_=self.command('flip',actorId=self.aid,propId='table',facing=0);self.assertEqual(result[0],200,result)
            self.assertEqual(self.command('finish')[0][0],200)
            exported=self.preview(dict(type='export-scene'));self.assertEqual(exported[0],200,exported)
            document=exported[1]['preview']['document'];self.assertTrue(document['props'][0]['flipped']);self.assertEqual(document['props'][0]['protection']['sp'],5)
            result,_=self.command('import-scene',document=document);self.assertEqual(result[0],200,result)
            self.assertEqual(result[1]['battle']['scene']['props'],document['props'])
            self.assertEqual(result[1]['battle']['scene']['settings']['cp2020Rulings']['coverArmorWear'],'none')
