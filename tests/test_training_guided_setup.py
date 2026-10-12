"""A single reviewed demo setup is atomic, isolated and never reloads gear."""
import copy
import json
import unittest
import test_training_battle as training
import shared_battle as b

class GuidedTrainingHTTP(unittest.TestCase):
    setUp=training.TrainingBattleHTTP.setUp
    start=training.TrainingBattleHTTP.start
    gm=training.TrainingBattleHTTP.gm
    player=training.TrainingBattleHTTP.player
    campaign=training.TrainingBattleHTTP.campaign
    database=training.TrainingBattleHTTP.database
    snapshot=training.TrainingBattleHTTP.snapshot
    training_setup=training.TrainingBattleHTTP.training_setup

    def setup_scene(self):
        self.gm_client,self.gm_identity=self.gm()
        self.cid=self.campaign(self.gm_client,self.gm_identity)['id']
        self.path=f'/api/campaigns/{self.cid}/battle/training'
        result,_=self.training_setup();self.assertEqual(result[0],200,result)
        return result[1]

    def choices(self):
        return [dict(weaponId='colt-amt2000',fireModes=['single'],singleActionCap=1,fumbleClass='nonautomatic'),
                dict(weaponId='militech-ronin',fireModes=['single','burst','auto'],singleActionCap=1,fumbleClass='automatic')]

    def command(self,kind='prepare-training-loadouts',**extra):
        state=self.gm_client.request(self.path)[1]['battle']
        body=dict(id=kind+'-'+str(state['version']),type=kind,battleId=state['id'],expectedVersion=state['version'],**extra)
        if kind=='prepare-training-loadouts':
            body.setdefault('choices',self.choices());body.setdefault('rulings',dict(nonautomaticFumbleAmmo='consume-attempted',jamAmmo='consume-declared'))
        return self.gm_client.request(self.path+'/commands','POST',body,csrf=self.gm_identity['csrf']),body

    def mutate(self,fn):
        with self.database() as db:
            row=db.execute('SELECT data FROM training_battles WHERE campaign_id=?',(self.cid,)).fetchone()
            scene=json.loads(row[0]);fn(scene)
            db.execute('UPDATE training_battles SET data=? WHERE campaign_id=?',(json.dumps(scene),self.cid));db.commit()

    def test_one_review_all_four_exact_resources_retry_and_undo(self):
        view=self.setup_scene();real=self.snapshot();before=view['battle']['scene'];ammo={a['id']:(a['weapon']['ammo'],a['weapon']['reserve']) for a in before['actors']}
        result,request=self.command();self.assertEqual(result[0],200,result)
        actors=result[1]['battle']['scene']['actors'];self.assertEqual(len(actors),4)
        for actor in actors:
            self.assertFalse(actor['loadout']['legacy']);self.assertEqual((actor['weapon']['ammo'],actor['weapon']['reserve']),ammo[actor['id']])
        self.assertEqual(real,self.snapshot())
        state=self.snapshot(training=True)
        replay=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertEqual(replay[0],200,replay);self.assertTrue(replay[1]['duplicate']);self.assertEqual(state,self.snapshot(training=True))
        changed=copy.deepcopy(request);changed['choices'][1]['singleActionCap']=2
        self.assertEqual(self.gm_client.request(self.path+'/commands','POST',changed,csrf=self.gm_identity['csrf'])[0],409)
        undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);self.assertTrue(all('loadout' not in a for a in undone[1]['battle']['scene']['actors']))
        done,_=self.command();self.assertEqual(done[0],200,done)
        started,_=self.command('start');self.assertEqual(started[0],200,started)
        failed,_=self.command();self.assertEqual(failed[0],409,failed)

    def test_readiness_unknown_numeric_and_schema_fail_without_any_writes(self):
        self.setup_scene()
        with self.database() as db:original=json.loads(db.execute('SELECT data FROM training_battles WHERE campaign_id=?',(self.cid,)).fetchone()[0])
        for mutate in [lambda s:s['actors'][-1]['weapon'].update(accuracy=2),lambda s:s['actors'][-1].update(unavailableWeapons=['militech-ronin']),lambda s:s['actors'][-1].update(weaponJams={'militech-ronin':2})]:
            self.mutate(mutate);before=self.snapshot(training=True)
            result,_=self.command();self.assertEqual(result[0],409,result);self.assertEqual(before,self.snapshot(training=True))
            self.mutate(lambda s:(s.clear(),s.update(copy.deepcopy(original))))
        for bad in [[{}],self.choices()+self.choices()[:1],[dict(self.choices()[0],weaponId={})],[dict(self.choices()[0],fireModes=[{}])],[dict(self.choices()[0],singleActionCap=True)]]:
            before=self.snapshot(training=True);result,_=self.command(choices=bad);self.assertIn(result[0],(400,409),result);self.assertEqual(before,self.snapshot(training=True))

    def test_partial_configuration_preserved_and_remaining_ammo_not_refilled(self):
        self.setup_scene()
        def configure(scene):
            actor=scene['actors'][0];actor['weapon']['ammo']=3;actor['weapon']['reserve']=12
            plans=b.training_loadout_plan(scene,self.choices());a,data,state=plans[0];a['loadout']=state;a['sceneInventory']=data;b.sync_weapon(a)
            scene['actors'][1]['weapon']['ammo']=2;scene['actors'][1]['weapon']['reserve']=4
            scene['actors'][-1]['hidden']=True
        self.mutate(configure);before=self.gm_client.request(self.path)[1]['battle']['scene']['actors'][0]
        result,_=self.command();self.assertEqual(result[0],200,result);actors=result[1]['battle']['scene']['actors']
        self.assertEqual(actors[0]['loadout'],before['loadout']);self.assertEqual((actors[1]['weapon']['ammo'],actors[1]['weapon']['reserve']),(2,4));self.assertTrue(actors[-1]['hidden'])
        snapshot=self.snapshot(training=True);again,_=self.command();self.assertEqual(again[0],409,again);self.assertEqual(snapshot,self.snapshot(training=True))

    def test_nontraining_and_player_gate_and_stale_version(self):
        self.setup_scene();state=self.gm_client.request(self.path)[1]['battle'];before=self.snapshot(training=True)
        body=dict(id='stale',type='prepare-training-loadouts',expectedVersion=state['version']-1,battleId=state['id'],choices=self.choices(),rulings={})
        self.assertEqual(self.gm_client.request(self.path+'/commands','POST',body,csrf=self.gm_identity['csrf'])[0],409);self.assertEqual(before,self.snapshot(training=True))
        user,identity=self.player('OtherGM');self.assertEqual(user.request(self.path+'/commands','POST',body,csrf=identity['csrf'])[0],403)
        with self.assertRaises(b.BattleError) as error:b.authorize_action(None,{}, {},True,state['scene'],dict(type='prepare-training-loadouts'),False)
        self.assertEqual(error.exception.status,403)

if __name__=='__main__':unittest.main()
