"""Authoritative restored combat transport, privacy, persistence and undo tests."""
import copy
import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_mobile_host as fixtures
import test_shared_battle as existing
import test_training_battle as training_tests
import shared_battle as battle


class TacticalHTTP(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    sheet = existing.SharedBattleHTTP.sheet
    party = existing.SharedBattleHTTP.party
    command = existing.SharedBattleHTTP.command
    begin = existing.SharedBattleHTTP.begin
    database = existing.SharedBattleHTTP.database
    snapshot = training_tests.TrainingBattleHTTP.snapshot
    training_setup = training_tests.TrainingBattleHTTP.training_setup
    enter_training = training_tests.TrainingBattleHTTP.enter_training

    def preview(self, action, client=None, user=None, **overrides):
        client, user = client or self.gm_client, user or self.gm_identity
        state = client.request(self.path)[1]['battle']
        body = dict(battleId=state['id'], expectedVersion=state['version'], command=existing.canonical_action(action), **overrides)
        return client.request(self.path + '/preview', 'POST', body, csrf=user['csrf'])

    def intent(self, action, client, user):
        declared, body = self.command('declare', client, user, action=action)
        self.assertEqual(declared[0], 200, declared)
        confirmed, _ = self.command('confirm', declarationId=body['id'])
        self.assertEqual(confirmed[0], 200, confirmed)
        return confirmed[1]

    def test_player_move_preview_intent_gm_approval_privacy_and_retry(self):
        with patch.object(battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda:.5)):
            self.party()
            client, user, cid = self.begin(); aid='character-'+str(cid)
            before=self.snapshot(training=True)
            action=dict(type='move',actorId=aid,x=1,y=4)
            result=self.preview(action,client,user)
            self.assertEqual(result[0],200,result)
            p=result[1]['preview']; self.assertTrue(p['ok']); self.assertTrue(p['path'])
            self.assertFalse({'actor','target','stats','weapon','armor'} & set(p))
            self.assertNotIn('HIDDEN GUARD SECRET',json.dumps(result))
            self.assertEqual(self.snapshot(training=True),before)
            forged=self.preview(dict(action,actorId='character-'+str(self.guard)),client,user)
            self.assertEqual(forged[0],403,forged)
            direct,_=self.command('move',client,user,actorId=aid,x=1,y=4)
            self.assertEqual(direct[0],403,direct)
            declared,body=self.command('declare',client,user,action=action)
            self.assertEqual(declared[0],200,declared)
            self.assertEqual(next(a for a in declared[1]['battle']['scene']['actors'] if a['id']==aid)['y'],1)
            other=next(p for p in self.players if p[2]!=cid)[0]
            self.assertEqual(other.request(self.path)[1]['battle']['pending'],[])
            self.assertFalse(declared[1]['battle']['canUndo'])
            confirmed,confirm=self.command('confirm',declarationId=body['id'])
            self.assertEqual(confirmed[0],200,confirmed)
            self.assertEqual(next(a for a in confirmed[1]['battle']['scene']['actors'] if a['id']==aid)['y'],4)
            self.assertTrue(confirmed[1]['battle']['canUndo'])
            saved=self.snapshot(training=True)
            duplicate=self.gm_client.request(self.path+'/commands','POST',confirm,csrf=self.gm_identity['csrf'])
            self.assertTrue(duplicate[1]['duplicate']); self.assertEqual(saved,self.snapshot(training=True))
            denied=self.preview(dict(type='shoot',actorId=aid,targetId='character-'+str(self.secret),location='torso'),client,user)
            self.assertEqual(denied[0],400,denied)
            projected=json.dumps(client.request(self.path)[1])
            for secret in ('_undo','beforeData','afterVersion','HIDDEN GUARD SECRET','PRIVATE'):
                self.assertNotIn(secret,projected)
            self.assertEqual(before['characters'],saved['characters'])
            self.assertEqual(before['revisions'],saved['revisions'])

    def test_shoot_preview_cover_highlight_is_public_geometry_only(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=False)
            setup=copy.deepcopy(self.prepare_body); setup.update(id='public-cover',expectedVersion=1,
                props=[dict(id='public-crate',type='crate',x=2,y=1,w=1,h=1,cover=True,label='Crate')])
            result=self.gm_client.request(self.path,'POST',setup,csrf=self.gm_identity['csrf']); self.assertEqual(result[0],200,result)
            client,user,cid=self.begin(); aid='character-'+str(cid)
            before=self.snapshot(training=True)
            result=self.preview(dict(type='shoot',actorId=aid,targetId='character-'+str(self.guard),location='random'),client,user)
            self.assertEqual(result[0],200,result); preview=result[1]['preview']
            # Canonical per-target lines expose only public geometry; covered
            # limbs remain unavailable and no private actor data may appear.
            self.assertEqual(preview['line'],dict(blocked=False,cover=dict(x=2,y=1)))
            self.assertEqual(preview['lines'],[dict(targetId='character-'+str(self.guard),blocked=False,cover=dict(x=2,y=1))])
            self.assertEqual([t['id'] for t in preview['targets']],['character-'+str(self.guard)])
            for zone in ('rightLeg','leftLeg'):
                covered=self.preview(dict(type='shoot',actorId=aid,targetId='character-'+str(self.guard),location=zone),client,user)
                self.assertEqual(covered[0],200,covered);self.assertFalse(covered[1]['preview']['ok'])
            self.assertFalse({'actor','target','weapon','stats','armor'} & set(preview))
            self.assertEqual(before,self.snapshot(training=True))

    def test_explicit_magazine_loaded_reserve_and_reload_conserve_sheet_total(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=False); client,user,cid=self.begin(); aid='character-'+str(cid)
            original=client.request(f'/api/characters/{cid}')[1]
            shoot,_=self.command('shoot',actorId=aid,targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(shoot[0],200,shoot)
            a=next(a for a in shoot[1]['battle']['scene']['actors'] if a['id']==aid)
            self.assertEqual((a['weapon']['ammo'],a['weapon']['reserve'],a['weapon']['magazine']),(7,2,8))
            saved=client.request(f'/api/characters/{cid}')[1]
            self.assertEqual(next(i['quantity'] for i in saved['data']['items'] if i['id']=='ammo'),9)
            self.assertEqual(saved['version'],original['version']+1)
            reload,cmd=self.command('reload',actorId=aid)
            self.assertEqual(reload[0],200,reload)
            a=next(a for a in reload[1]['battle']['scene']['actors'] if a['id']==aid)
            self.assertEqual((a['weapon']['ammo'],a['weapon']['reserve']),(8,1))
            self.assertEqual(client.request(f'/api/characters/{cid}')[1],saved)
            undone,_=self.command('undo'); self.assertEqual(undone[0],200,undone)
            self.assertFalse(undone[1]['battle']['canUndo'])
            a=next(a for a in undone[1]['battle']['scene']['actors'] if a['id']==aid)
            self.assertEqual((a['weapon']['ammo'],a['weapon']['reserve']),(7,2))
            self.assertEqual(client.request(f'/api/characters/{cid}')[1],saved)
            self.assertEqual(self.command('undo')[0][0],409)

    def test_shot_undo_is_atomic_new_revision_not_snapshot_and_deduplicated(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=False); client,user,cid=self.begin(); aid='character-'+str(cid)
            original=client.request(f'/api/characters/{cid}')[1]
            original_target=self.gm_client.request(f'/api/characters/{self.guard}')[1]
            result,shot=self.command('shoot',actorId=aid,targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(result[0],200,result)
            version=result[1]['battle']['version']; before=self.snapshot(training=True)
            real_restore=battle.restore_undo
            def broken(*args):
                real_restore(*args)
                raise sqlite3.OperationalError('Undo transaction failure after compensating writes')
            with patch.object(battle,'restore_undo',side_effect=broken):
                result,_=self.command('undo',command_id='failed-undo')
                self.assertEqual(result[0],503,result)
            self.assertEqual(self.snapshot(training=True),before)
            result,undo=self.command('undo',command_id='undo-once')
            self.assertEqual(result[0],200,result)
            self.assertEqual(result[1]['battle']['version'],version+1)
            self.assertEqual(result[1]['battle']['pending'],[])
            restored=client.request(f'/api/characters/{cid}')[1]
            restored_target=self.gm_client.request(f'/api/characters/{self.guard}')[1]
            self.assertEqual(restored['data'],original['data'])
            self.assertEqual(restored_target['data'],original_target['data'])
            self.assertEqual(restored['version'],original['version']+2)
            self.assertEqual(restored_target['version'],original_target['version']+2)
            saved=self.snapshot(training=True)
            for cmd in (undo,shot):
                duplicate=self.gm_client.request(self.path+'/commands','POST',cmd,csrf=self.gm_identity['csrf'])
                self.assertEqual(duplicate[0],200,duplicate); self.assertTrue(duplicate[1]['duplicate'])
            self.assertEqual(self.snapshot(training=True),saved)
            forged,_=self.command('undo',state={},scene={})
            self.assertEqual(forged[0],400,forged)
            # A fresh shot is legal after the authoritative compensating state.
            repeat,_=self.command('shoot',actorId=aid,targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(repeat[0],200,repeat)

    def test_undo_rejects_stale_sheet_without_clobbering_edit(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=False); client,user,cid=self.begin(); aid='character-'+str(cid)
            result,_=self.command('shoot',actorId=aid,targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(result[0],200,result)
            sheet=client.request(f'/api/characters/{cid}')[1]; data=copy.deepcopy(sheet['data']); data['notes']='NEW PRIVATE EDIT'
            edited=client.request(f'/api/characters/{cid}','PUT',dict(version=sheet['version'],data=data,reason='Concurrent sheet editing'),csrf=user['csrf'])
            self.assertEqual(edited[0],200,edited)
            before=self.snapshot(training=True)
            undone,_=self.command('undo'); self.assertEqual(undone[0],409,undone)
            self.assertEqual(self.snapshot(training=True),before)
            self.assertEqual(client.request(f'/api/characters/{cid}')[1]['data']['notes'],'NEW PRIVATE EDIT')

    def test_real_net_intents_devices_owner_privacy_and_private_camera_snapshot(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.3)):
            self.party(count=2,hidden=True)
            client,user,cid=self.players[0]; aid='character-'+str(cid)
            sheet=client.request(f'/api/characters/{cid}')[1]; data=copy.deepcopy(sheet['data']); data.update(special='Interface',specialRank=4)
            edit=client.request(f'/api/characters/{cid}','PUT',dict(version=sheet['version'],data=data,reason='Confirm netrunner'),csrf=user['csrf'])
            self.assertEqual(edit[0],200,edit)
            setup=copy.deepcopy(self.prepare_body); setup.update(id='net-preparation',expectedVersion=1)
            setup['actors'][0].update(version=edit[1]['version'],net=dict(deckItemId='private',interfaceRank=4,programIds=['genie','crystalBall','soundmachine']))
            setup['devices']=[dict(id='port',name='Порт',type='port',networkId='bar',x=1,y=2),
                              dict(id='secret-camera',name='SECRET CAMERA',type='camera',networkId='bar',x=6,y=1,range=6,active=True),
                              dict(id='speaker',name='SECRET SPEAKER',type='speaker',networkId='bar',x=10,y=2,active=False)]
            result=self.gm_client.request(self.path,'POST',setup,csrf=self.gm_identity['csrf']); self.assertEqual(result[0],200,result)
            self.begin(); other=self.players[1][0]
            self.assertEqual([d['id'] for d in client.request(self.path)[1]['battle']['scene']['devices']],['port'])
            self.intent(dict(type='connect',actorId=aid,deviceId='port'),client,user)
            self.intent(dict(type='scan',actorId=aid),client,user)
            self.assertEqual(len(client.request(self.path)[1]['battle']['scene']['devices']),3)
            alien=other.request(self.path)[1]
            self.assertNotIn('SECRET CAMERA',json.dumps(alien)); self.assertNotIn('SECRET SPEAKER',json.dumps(alien))
            self.assertNotIn('HIDDEN GUARD SECRET',json.dumps(alien))
            action=dict(type='control',actorId=aid,deviceId='secret-camera',operation='observe')
            preview=self.preview(action,client,user); self.assertEqual(preview[0],200,preview)
            self.assertEqual(preview[1]['preview']['program']['strength'],4)
            confirmed=self.intent(action,client,user)
            self.assertTrue(confirmed['receipt']['event']['success'])
            own=client.request(self.path)[1]; alien=other.request(self.path)[1]
            self.assertNotIn('HIDDEN GUARD SECRET',json.dumps(alien))
            intel=next(a for a in own['battle']['scene']['actors'] if a['id']==aid)['net']['cameraIntel']
            self.assertIn('HIDDEN GUARD SECRET',json.dumps(intel))
            self.assertTrue(next(a for a in self.gm_client.request(self.path)[1]['battle']['scene']['actors'] if a['name']=='HIDDEN GUARD SECRET')['hidden'])
            event=next(e for e in alien['battle']['log'] if e['kind']=='control')
            self.assertFalse({'roll','strength','program','at'} & set(event))
            self.assertNotIn('Crystal Ball',event['text'])
            own_event=next(e for e in own['battle']['log'] if e['kind']=='control')
            self.assertEqual(own_event['strength'],4)
            self.intent(dict(type='disconnect',actorId=aid),client,user)
            self.intent(dict(type='connect',actorId=aid,deviceId='port'),client,user)
            self.intent(dict(type='scan',actorId=aid),client,user)
            denied=self.preview(action,client,user)
            self.assertEqual(denied[0],200,denied); self.assertFalse(denied[1]['preview']['ok'])
            self.assertEqual([d['id'] for d in other.request(self.path)[1]['battle']['scene']['devices']],['port'])

    def test_real_net_and_original_bar_devices_survive_preparation_roundtrip(self):
        self.party(count=1,hidden=False)
        client,user,cid=self.players[0]
        sheet=client.request(f'/api/characters/{cid}')[1]; data=copy.deepcopy(sheet['data']); data.update(special='Интерфейс',specialRank=4)
        edit=client.request(f'/api/characters/{cid}','PUT',dict(version=sheet['version'],data=data,reason='Confirm Interface'),csrf=user['csrf'])
        self.assertEqual(edit[0],200,edit)
        original,_=battle.training_scene(dict(gm_id=self.gm_identity['id']),0,lambda:.5)
        setup=copy.deepcopy(self.prepare_body)
        setup.update(id='explicit-bar-net',expectedVersion=1,width=original['width'],height=original['height'],
                     tiles=original['tiles'],props=original['props'],devices=original['devices'])
        setup['actors'][0].update(version=edit[1]['version'],x=8,y=10,
                                 net=dict(deckItemId='private',interfaceRank=4,programIds=['genie','crystalBall']))
        setup['actors'][1].update(x=16,y=8)
        result=self.gm_client.request(self.path,'POST',setup,csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0],200,result)
        saved=self.gm_client.request(self.path)[1]['battle']['scene']
        restored=copy.deepcopy(setup); restored.update(id='resave-net-preparation',expectedVersion=saved['version'])
        restored['devices']=saved['devices']; restored['tiles']=saved['tiles']; restored['props']=saved['props']
        for config,actor in zip(restored['actors'],saved['actors']):
            config['version']=actor['sheetVersion']; config['armor']=actor['armor']
            config['weapon']['loaded']=actor['weapon']['ammo']; config['weapon']['magazine']=actor['weapon']['magazine']
            if actor.get('net'):
                config['net']=dict(deckItemId=actor['net']['deckItemId'],interfaceRank=actor['stats']['interface'],programIds=actor['net']['programIds'])
        result=self.gm_client.request(self.path,'POST',restored,csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0],200,result)
        latest=result[1]['battle']['scene']
        for key in ('actors','tiles','props','devices','settings'):
            self.assertEqual(latest[key],saved[key],key)
        before=self.snapshot(training=True)
        for bad in (dict(deckItemId='missing',interfaceRank=4,programIds=[]),
                    dict(deckItemId='private',interfaceRank=7,programIds=[]),
                    dict(deckItemId='private',interfaceRank=4,programIds=['unknown']),
                    dict(deckItemId='private',interfaceRank=4,programIds=['genie','genie'])):
            invalid=copy.deepcopy(restored); invalid.update(id='invalid-net-'+str(bad),expectedVersion=latest['version'])
            invalid['actors'][0]['net']=bad
            result=self.gm_client.request(self.path,'POST',invalid,csrf=self.gm_identity['csrf'])
            self.assertEqual(result[0],400,result)
        self.assertEqual(before,self.snapshot(training=True))
        non_interface=copy.deepcopy(data); non_interface.update(special='Combat Sense',specialRank=4)
        with self.assertRaises(battle.BattleError):
            battle.net_from_sheet(non_interface,dict(deckItemId='private',interfaceRank=4,programIds=['genie']))

    def test_active_invitations_only_owned_accepted_actors_active_phase_and_no_hidden_data(self):
        self.party(count=2,hidden=True)
        client,user,cid=self.players[0]
        outsider,_=self.player('invitation-outsider')
        for viewer in (client,outsider):
            self.assertEqual(viewer.request('/api/battles/active')[1],dict(battles=[]))
        self.begin(); before=self.snapshot(training=True)
        view=client.request('/api/battles/active')
        self.assertEqual(view[0],200,view); self.assertEqual(len(view[1]['battles']),1)
        summary=view[1]['battles'][0]
        self.assertEqual(set(summary),{'campaignId','campaignName','battleId','battleName','version','phase','actorIds'})
        self.assertEqual(summary['actorIds'],['character-'+str(cid)])
        self.assertNotIn('HIDDEN',json.dumps(view)); self.assertEqual(self.snapshot(training=True),before)
        self.assertEqual(outsider.request('/api/battles/active')[1],dict(battles=[]))
        self.assertEqual(fixtures.HTTPClient(self.port).request('/api/battles/active')[0],401)
        paused,_=self.command('pause'); self.assertEqual(paused[0],200,paused)
        self.assertEqual(client.request('/api/battles/active')[1]['battles'][0]['phase'],'paused')
        self.assertEqual(self.command('resume')[0][0],200)
        base=self.path.rsplit('/battle',1)[0]; campaign=self.gm_client.request(base)[1]
        withdrawn=self.gm_client.request(base+'/roster','POST',dict(version=campaign['version'],character_id=cid,status='remove'),csrf=self.gm_identity['csrf'])
        self.assertEqual(withdrawn[0],200,withdrawn)
        self.assertEqual(client.request('/api/battles/active')[1],dict(battles=[]))
        self.assertEqual(self.command('finish')[0][0],200)
        self.assertEqual(self.players[1][0].request('/api/battles/active')[1],dict(battles=[]))

    def test_legacy_training_reopen_never_resets_refills_or_replaces_without_reset(self):
        self.party(count=1,hidden=False); real=self.snapshot(); state=self.enter_training()
        self.assertFalse(next(a for a in state['battle']['scene']['actors'] if a['id']=='guard-2')['hidden'])
        with self.database() as db:
            row=db.execute('SELECT campaign_id,data FROM training_battles').fetchone(); saved=json.loads(row[1])
            saved.pop('demoRevision'); next(a for a in saved['actors'] if a['id']=='guard-2')['hidden']=True; saved['name']='Legacy in-progress demo'; saved['actors'][0].pop('loadout',None); saved['actors'][0]['weapon'].update(ammo=1,reserve=0)
            saved.pop('_undo',None)
            db.execute('UPDATE training_battles SET data=? WHERE campaign_id=?',(json.dumps(saved),row[0]))
        old=self.gm_client.request(self.path)[1]; self.assertFalse(old['demoCompatible'])
        reopened,_=self.training_setup(command_id='legacy-reopen')
        self.assertEqual(reopened[0],200,reopened); self.assertEqual(reopened[1]['battle'],old['battle'])
        self.assertEqual(reopened[1]['battle']['scene']['actors'][0]['weapon']['ammo'],1)
        reset,_=self.training_setup('training-reset','explicit-original-reset')
        self.assertEqual(reset[0],200,reset); self.assertTrue(reset[1]['demoCompatible'])
        self.assertEqual(reset[1]['battle']['phase'],'preparation')
        self.assertEqual(reset[1]['battle']['scene']['actors'][0]['weapon']['ammo'],8)
        self.assertFalse(next(a for a in reset[1]['battle']['scene']['actors'] if a['id']=='guard-2')['hidden'])
        self.assertEqual(self.snapshot(),real)

    def test_gm_prep_tools_real_add_pause_resume_and_hidden_turn_projection(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=True)
            client,user,cid=self.players[0]
            added_cid=self.sheet(self.gm_client,self.gm_identity,'Explicit added NPC',ref=1)
            original_sheets=self.snapshot()['characters']
            config=copy.deepcopy(self.prepare_body['actors'][-1]); config.update(characterId=added_cid,version=1,x=10,y=4)
            empty,_=self.command('add'); self.assertEqual(empty[0],400,empty)
            result,_=self.command('add',config=config); self.assertEqual(result[0],200,result)
            self.assertEqual(len(result[1]['battle']['scene']['actors']),4)
            undone,_=self.command('undo'); self.assertEqual(undone[0],200,undone)
            self.assertEqual(len(undone[1]['battle']['scene']['actors']),3)
            moved,_=self.command('place',actorId='character-'+str(cid),x=2,y=3)
            self.assertEqual(moved[0],200,moved)
            for paint in ('wall','floor','crate','door'):
                result,_=self.command('paint',x=2,y=2,paint=paint); self.assertEqual(result[0],200,result)
            opened,_=self.command('door',x=2,y=2); self.assertEqual(opened[0],200,opened)
            self.assertTrue(opened[1]['battle']['scene']['tiles'][2][2]['open'])
            hide,_=self.command('hide',actorId='character-'+str(self.guard)); self.assertEqual(hide[0],200,hide)
            self.assertNotIn('Guard',json.dumps(client.request(self.path)[1]))
            started,_=self.command('start'); self.assertEqual(started[0],200,started)
            current=started[1]['battle']['scene']['currentActorId']
            paused,_=self.command('pause'); self.assertEqual(paused[0],200,paused)
            self.assertEqual(self.command('move',actorId=current,x=3,y=3)[0][0],409)
            self.assertEqual(self.command('resume')[0][0],200)
            ended,_=self.command('end',actorId=current); self.assertEqual(ended[0],200,ended)
            player_view=client.request(self.path)[1]['battle']['scene']
            self.assertIsNone(player_view['currentActorId']); self.assertEqual(player_view['index'],-1)
            self.assertTrue(player_view['gmTurn']); self.assertEqual(player_view['order'],['character-'+str(cid)])
            self.assertEqual(original_sheets,self.snapshot()['characters'])

    def test_preview_schema_csrf_and_forged_result_fail_without_writes(self):
        self.party(count=1,hidden=False); client,user,cid=self.begin(); aid='character-'+str(cid)
        before=self.snapshot(training=True); state=client.request(self.path)[1]['battle']
        for action in (dict(type=[]),dict(type='move',actorId=aid,x=True,y=2),
                       dict(type='move',actorId=aid,x=-1,y=2),dict(type='reload',actorId=aid,damage=999),
                       dict(type='control',actorId=aid,deviceId='none',operation='on',roll=1)):
            result=self.preview(action,client,user); self.assertEqual(result[0],400,result)
        valid=dict(type='move',actorId=aid,x=1,y=2)
        body=dict(battleId=state['id'],expectedVersion=state['version'],command=valid)
        self.assertEqual(client.request(self.path+'/preview','POST',body)[0],403)
        self.assertEqual(client.request(self.path+'/preview','POST',dict(body,expectedVersion=0),csrf=user['csrf'])[0],409)
        self.assertEqual(client.request(self.path+'/preview')[0],405)
        self.assertEqual(client.request('/api/battles/active','POST',{},csrf=user['csrf'])[0],405)
        self.assertEqual(self.snapshot(training=True),before)

    def test_training_add_paint_undo_and_network_round_limit_survive_restart(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.3)):
            self.party(count=1,hidden=False); real=self.snapshot(); self.path+='/training'
            state,_=self.training_setup(); self.assertEqual(state[0],200,state)
            added,_=self.command('add'); self.assertEqual(added[0],200,added)
            self.assertEqual(len(added[1]['battle']['scene']['actors']),5)
            self.assertEqual(self.command('undo')[0][0],200)
            self.assertEqual(self.command('start')[0][0],200)
            for _ in range(8):
                state=self.gm_client.request(self.path)[1]['battle']; current=state['scene']['currentActorId']
                if current=='mira': break
                self.assertEqual(self.command('end',actorId=current)[0][0],200)
            self.assertEqual(current,'mira')
            for kind,fields in [('connect',dict(deviceId='bar-port')),('scan',{}),('control',dict(deviceId='office-door',operation='open'))]:
                result,_=self.command(kind,actorId='mira',**fields); self.assertEqual(result[0],200,result)
            self.assertTrue(result[1]['battle']['scene']['tiles'][6][18]['open'])
            saved=self.gm_client.request(self.path)[1]
            fixtures.mobile_host.stop(); self.start(username='',password='')
            self.assertEqual(self.gm_client.request(self.path)[1],saved)
            second,_=self.command('control',actorId='mira',deviceId='bar-speaker',operation='on')
            self.assertEqual(second[0],409,second)
            for _ in range(10):
                state=self.gm_client.request(self.path)[1]['battle']; current=state['scene']['currentActorId']
                self.assertEqual(self.command('end',actorId=current)[0][0],200)
                next_state=self.gm_client.request(self.path)[1]['battle']
                if next_state['scene']['currentActorId']=='mira': break
            again,_=self.command('control',actorId='mira',deviceId='bar-speaker',operation='on')
            self.assertEqual(again[0],200,again)
            self.assertTrue(next(d for d in again[1]['battle']['scene']['devices'] if d['id']=='bar-speaker')['active'])
            self.assertEqual(self.snapshot(),real)

    def test_magazine_invalid_missing_and_inventory_overdraw_rejected(self):
        self.party(count=1,hidden=False)
        before=self.snapshot(training=True)
        for changes in (dict(magazine=0),dict(loaded=9),dict(magazine=1001),dict(loaded=-1),dict(loaded=True)):
            body=copy.deepcopy(self.prepare_body); body.update(id='bad-'+str(changes),expectedVersion=1)
            body['actors'][0]['weapon'].update(changes)
            result=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf'])
            self.assertEqual(result[0],400,result)
        body=copy.deepcopy(self.prepare_body); body.update(id='old-missing-magazine',expectedVersion=1)
        del body['actors'][0]['weapon']['magazine']
        self.assertEqual(self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf'])[0],400)
        self.assertEqual(before,self.snapshot(training=True))


if __name__ == '__main__':
    unittest.main()
