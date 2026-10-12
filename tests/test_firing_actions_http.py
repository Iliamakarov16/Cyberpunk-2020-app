"""Authenticated canonical fire action/multiple bullets and transaction boundaries."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_loadout_action_http as loadouts
import shared_battle as battle

class FiringHTTP(unittest.TestCase):
    setUp=loadouts.LoadoutHTTP.setUp;start=loadouts.LoadoutHTTP.start;gm=loadouts.LoadoutHTTP.gm;player=loadouts.LoadoutHTTP.player
    campaign=loadouts.LoadoutHTTP.campaign;sheet=loadouts.LoadoutHTTP.sheet;party=loadouts.LoadoutHTTP.party
    command=loadouts.LoadoutHTTP.command;begin=loadouts.LoadoutHTTP.begin;database=loadouts.LoadoutHTTP.database
    snapshot=loadouts.LoadoutHTTP.snapshot;preview=loadouts.LoadoutHTTP.preview;prepare_two=loadouts.LoadoutHTTP.prepare_two
    def ready(self,automatic=False):
        client,user,cid=self.prepare_two();body=copy.deepcopy(self.two_body);body.update(id='modes',expectedVersion=2)
        profile=body['actors'][0]['loadout']['weapons'][0]
        profile.update(rof=6,singleActionCap=3,fireModes=['single','burst','auto'] if automatic else ['single'],fumbleClass='automatic' if automatic else 'nonautomatic')
        body['settings']=dict(stagedPenetration=True,cp2020Rulings=dict(jamAmmo='consume-declared',nonautomaticFumbleAmmo='consume-attempted',burstHitRounding='ceil',autoTenRoundGroups='floor',autoReducedRounds='allow-declared'))
        prepared=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(prepared[0],200,prepared)
        self.begin();return client,user,cid,dict(type='fire',actorId='character-'+str(cid),mode='single',rounds=2,targetIds=['character-'+str(self.guard)])

    def test_grouped_single_is_one_action_multi_hit_cas_retry_undo(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid,action=self.ready();before=self.snapshot(training=True)
            preview=self.preview(action,client,user);self.assertEqual(preview[0],200,preview);self.assertTrue(preview[1]['preview']['readyToRoll'])
            forged=self.preview(dict(action,gmFire=dict(turnToTarget=False)),client,user);self.assertEqual(forged[0],403)
            declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
            confirmed,confirmation=self.command('confirm',declarationId=request['id'],gmFire=dict(turnToTarget=False));self.assertEqual(confirmed[0],200,confirmed)
            event=confirmed[1]['receipt']['event'];self.assertEqual((event['rounds'],event['hits']),(2,2));self.assertEqual(event['rangedReceipt']['actionCost'],1)
            actor=next(a for a in confirmed[1]['battle']['scene']['actors'] if a['characterId']==cid);self.assertEqual(actor['actions'],1);self.assertEqual(actor['shotsByWeapon']['gun'],2);self.assertEqual(actor['loadout']['ammoPools']['ammo'],8)
            after=self.snapshot(training=True)
            duplicate=self.gm_client.request(self.path+'/commands','POST',confirmation,csrf=self.gm_identity['csrf']);self.assertTrue(duplicate[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
            for old,new in zip(before['characters'],after['characters']):self.assertEqual(new[3],old[3]+1) # version column
            undo,_=self.command('undo');self.assertEqual(undo[0],200,undo)
            self.assertEqual(client.request(f'/api/characters/{cid}')[1]['data']['wounds'],0)
            self.assertEqual(next(i for i in client.request(f'/api/characters/{cid}')[1]['data']['items'] if i['id']=='ammo')['quantity'],10)

    def test_burst_three_rounds_one_roll_no_extra_action_penalties(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid,action=self.ready(True);action.update(mode='burst',rounds=3)
            result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire=dict(turnToTarget=False));self.assertEqual(result[0],200,result)
            receipt=result[1]['receipt']['event']['rangedReceipt'];self.assertEqual(receipt['bulletsSpent'],3);self.assertEqual(receipt['actionCost'],1);self.assertEqual(len(receipt['targets'][0]['attacks']),1)
            self.assertEqual(receipt['targets'][0]['modeModifier'],3)
            actor=next(a for a in result[1]['battle']['scene']['actors'] if a['characterId']==cid);self.assertEqual(actor['weapon']['ammo'],1)

    def test_ordinary_fumble_interrupts_and_blocks_until_explicit_gm_resolution(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid,action=self.ready();action['rounds']=3
        dice=iter([0,.5])
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(dice))):
            result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire=dict(turnToTarget=False))
        self.assertEqual(result[0],200,result);event=result[1]['receipt']['event'];self.assertEqual(event['rounds'],1)
        actor=next(a for a in result[1]['battle']['scene']['actors'] if a['characterId']==cid);self.assertEqual(actor['weapon']['ammo'],3)
        denied,_=self.command('end',actorId=actor['id']);self.assertEqual(denied[0],409,denied)
        entry=result[1]['battle']['scene']['unresolvedFumbles'][0]
        forged,_=self.command('resolve-fumble',client,user,sourceCommandId=entry['commandId'],note='forged',effects=[]);self.assertEqual(forged[0],403)
        resolved,_=self.command('resolve-fumble',sourceCommandId=entry['commandId'],note='GM confirms dropped weapon and no extra injury.',effects=[dict(actorId=actor['id'],finalDamage=0,dropWeapon=True,additionalActions=0)])
        self.assertEqual(resolved[0],200,resolved);self.assertEqual(resolved[1]['battle']['scene']['unresolvedFumbles'],[])
        denied,_=self.command('switch',actorId=actor['id'],weaponId='gun');self.assertEqual(denied[0],400,denied)
        ended,_=self.command('end',actorId=actor['id']);self.assertEqual(ended[0],200,ended)

    def test_jam_stops_fire_and_clearing_consumes_own_turn_without_reloading(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid,action=self.ready(True);action.update(mode='burst',rounds=3)
        dice=iter([0,.1,.1]) # natural1, ST jam2, clear1 turn
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(dice))):
            result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire=dict(turnToTarget=False))
        self.assertEqual(result[0],200,result);actor=next(a for a in result[1]['battle']['scene']['actors'] if a['characterId']==cid)
        self.assertEqual(actor['weaponJams']['gun'],1);self.assertEqual(actor['weapon']['ammo'],1);self.assertFalse(result[1]['battle']['scene'].get('unresolvedFumbles'))
        cleared,_=self.command('unjam',actorId=actor['id']);self.assertEqual(cleared[0],200,cleared)
        actor=next(a for a in cleared[1]['battle']['scene']['actors'] if a['characterId']==cid);self.assertEqual(actor['weaponJams']['gun'],0);self.assertEqual(actor['weapon']['ammo'],1)
        denied,_=self.command('reload',actorId=actor['id']);self.assertEqual(denied[0],409,denied)
