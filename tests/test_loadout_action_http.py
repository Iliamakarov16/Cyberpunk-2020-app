"""Real sessions: explicit loadouts, shared pool, switch/reload, retries and undo."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_tactical_battle_http as tactical
import shared_battle as battle

class LoadoutHTTP(unittest.TestCase):
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
    def prepare_two(self):
        self.party(count=1,hidden=False);client,user,cid=self.players[0]
        current=client.request(f'/api/characters/{cid}')[1];data=copy.deepcopy(current['data'])
        gun=copy.deepcopy(next(i for i in data['items'] if i['id']=='gun'));gun.update(id='second-gun',name='Second profile');data['items'].append(gun)
        changed=client.request(f'/api/characters/{cid}','PUT',dict(data=data,version=current['version'],reason='Two actual weapons'),csrf=user['csrf']);self.assertEqual(changed[0],200,changed)
        body=copy.deepcopy(self.prepare_body);body.update(id='two-weapons',expectedVersion=1);config=body['actors'][0];config['version']=changed[1]['version']
        profile=dict(config['weapon'],kind='ranged',profileId='GM verified test profile',weaponType='handgun',fireModes=['single'],singleActionCap=1,reliability='ST',fumbleClass='nonautomatic',loaded=4)
        second=dict(profile,weaponId='second-gun',loaded=3)
        body['settings']=dict(stagedPenetration=True,cp2020Rulings=dict(nonautomaticFumbleAmmo='consume-attempted'))
        config.update(weapon=None,loadout=dict(weapons=[profile,second],activeWeaponId='gun',resetLoaded=True))
        response=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(response[0],200,response)
        self.two_body=body
        return client,user,cid

    def test_switch_reload_shared_ammo_shot_retry_undo_restart(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.prepare_two();aid='character-'+str(cid);self.begin()
            before=client.request(f'/api/characters/{cid}')[1]
            state=client.request(self.path)[1]['battle']['scene'];actor=next(a for a in state['actors'] if a['id']==aid)
            self.assertEqual(actor['weapon']['reserve'],3);self.assertEqual(actor['loadout']['ammoPools'],{'ammo':10})
            action=dict(type='switch',actorId=aid,weaponId='second-gun')
            direct,_=self.command('switch',client,user,actorId=aid,weaponId='second-gun');self.assertEqual(direct[0],403)
            declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
            switched,confirmation=self.command('confirm',declarationId=request['id']);self.assertEqual(switched[0],200,switched)
            repeat=self.gm_client.request(self.path+'/commands','POST',confirmation,csrf=self.gm_identity['csrf']);self.assertTrue(repeat[1]['duplicate'])
            actor=next(a for a in repeat[1]['battle']['scene']['actors'] if a['id']==aid);self.assertEqual(actor['actions'],1);self.assertEqual(actor['weapon']['ammo'],3)
            reload,_=self.command('reload',actorId=aid);self.assertEqual(reload[0],200,reload)
            actor=next(a for a in reload[1]['battle']['scene']['actors'] if a['id']==aid);self.assertEqual((actor['weapon']['ammo'],actor['weapon']['reserve']),(6,0))
            self.assertEqual(client.request(f'/api/characters/{cid}')[1],before)
            shot,_=self.command('fire',actorId=aid,targetIds=['character-'+str(self.guard)],mode='single',rounds=1,location='torso',gmFire=dict(turnToTarget=False));self.assertEqual(shot[0],200,shot)
            actor=next(a for a in shot[1]['battle']['scene']['actors'] if a['id']==aid);self.assertEqual(actor['loadout']['ammoPools']['ammo'],9);self.assertEqual(actor['weapon']['ammo'],5)
            after=client.request(f'/api/characters/{cid}')[1];self.assertEqual(next(i for i in after['data']['items'] if i['id']=='ammo')['quantity'],9)
            undo,_=self.command('undo');self.assertEqual(undo[0],200,undo)
            actor=next(a for a in undo[1]['battle']['scene']['actors'] if a['id']==aid);self.assertEqual(actor['weapon']['ammo'],6);self.assertEqual(actor['loadout']['sheetVersion'],before['version']+2)
            self.assertEqual(client.request(f'/api/characters/{cid}')[1]['data'],before['data'])
            fetched=client.request(self.path)[1];self.assertEqual(next(a for a in fetched['battle']['scene']['actors'] if a['id']==aid)['loadout'],actor['loadout'])

    def test_no_foreign_weapon_no_implicit_refill_reprepare_and_stale_inventory(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            client,user,cid=self.prepare_two();aid='character-'+str(cid)
            body=copy.deepcopy(self.two_body);body.update(id='refill',expectedVersion=2);body['actors'][0]['loadout']['resetLoaded']=False;body['actors'][0]['loadout']['weapons'][0]['loaded']=5
            failed=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(failed[0],409,failed)
            self.begin()
            response=self.preview(dict(type='switch',actorId=aid,weaponId='foreign'),client,user);self.assertFalse(response[1]['preview']['ok'])
            sheet=client.request(f'/api/characters/{cid}')[1];data=copy.deepcopy(sheet['data']);next(i for i in data['items'] if i['id']=='second-gun')['quantity']=0
            changed=client.request(f'/api/characters/{cid}','PUT',dict(data=data,version=sheet['version'],reason='External edit'),csrf=user['csrf']);self.assertEqual(changed[0],200)
            before=self.snapshot(training=True)
            failed,_=self.command('switch',actorId=aid,weaponId='second-gun');self.assertEqual(failed[0],409,failed);self.assertEqual(before,self.snapshot(training=True))
