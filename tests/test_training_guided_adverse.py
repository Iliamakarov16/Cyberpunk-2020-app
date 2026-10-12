"""Independent authenticated batch/rollback regressions retained for releases."""
import sys,copy,json,sqlite3,unittest
from unittest.mock import patch
import test_training_guided_setup as g
import shared_battle as b
class Review(g.GuidedTrainingHTTP):
 def raw_scene(self):
  with self.database() as db:return json.loads(db.execute("SELECT data FROM training_battles WHERE campaign_id=?",(self.cid,)).fetchone()[0])
 def test_independent_late_invalid_actor_blocks_batch_and_preview_is_pure(self):
  self.setup_scene(); state=self.gm_client.request(self.path)[1]['battle']; before=self.snapshot(training=True)
  req=dict(battleId=state['id'],expectedVersion=state['version'],command=dict(type='prepare-training-loadouts',choices=self.choices(),rulings={}))
  result=self.gm_client.request(self.path+'/preview','POST',req,csrf=self.gm_identity['csrf']);self.assertEqual(result[0],200,result);self.assertTrue(result[1]['preview']['ok']);self.assertEqual(before,self.snapshot(training=True))
  for field,value in [('id','unknown'),('weaponId','unknown'),('ammo',-1),('ammo',True),('reserve',-1),('reserve',1.5),('magazine',True),('rof',30.0)]:
   original=self.raw_scene();self.mutate(lambda s:s['actors'][-1]['weapon'].update({field:value}));before=self.snapshot(training=True)
   result,_=self.command();self.assertIn(result[0],(400,409),result);self.assertEqual(before,self.snapshot(training=True));self.mutate(lambda s:(s.clear(),s.update(copy.deepcopy(original))))
 def test_independent_dead_skipped_hidden_included_and_explicit_modes(self):
  self.setup_scene()
  def change(s):
   s['actors'][0]['status']='dead';s['actors'][0]['weapon']['id']='unknown';s['actors'][0]['unavailableWeapons']=['unknown']
   s['actors'][-1]['hidden']=True;s['actors'][1]['weapon'].update(ammo=0,reserve=0)
  self.mutate(change);choices=self.choices();choices[1].update(fireModes=['burst'],singleActionCap=0)
  before=self.gm_client.request(self.path)[1]['battle']['scene'];real=self.snapshot();result,_=self.command(choices=choices);self.assertEqual(result[0],200,result)
  actors=result[1]['battle']['scene']['actors'];self.assertEqual(actors[0],before['actors'][0]);self.assertTrue(actors[-1]['hidden']);self.assertFalse(actors[-1]['loadout']['legacy']);self.assertEqual(actors[-1]['weapon']['fireModes'],['burst']);self.assertEqual(actors[-1]['weapon']['singleActionCap'],0);self.assertEqual((actors[1]['weapon']['ammo'],actors[1]['weapon']['reserve']),(0,0));self.assertEqual(real,self.snapshot())
 def test_independent_legacy_wrapped_magazines_and_inventory_survive(self):
  self.setup_scene()
  def change(s):
   a=s['actors'][0];a['weapon'].update(ammo=2,reserve=3);data=b.scene_actor_inventory(a);w=copy.deepcopy(a['weapon']);w.update(weaponId=w['id'],ammoItemId='ammo-'+w['id'],skillName='Handgun',skillRank=a['stats']['handgun']);a['loadout']=b.battle_loadout.migrate_weapon(w,0,data=data);a['sceneInventory']=data;b.sync_weapon(a)
  self.mutate(change);original=self.gm_client.request(self.path)[1]['battle']['scene'];result,_=self.command();self.assertEqual(result[0],200,result);a=result[1]['battle']['scene']['actors'][0];self.assertFalse(a['loadout']['legacy']);self.assertEqual((a['weapon']['ammo'],a['weapon']['reserve']),(2,3));self.assertEqual(a['loadout']['ammoPools'],{'ammo-colt-amt2000':5})
  undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);self.assertEqual(undone[1]['battle']['scene']['actors'],original['actors'])
 def test_independent_pending_and_fumble_block_ended_allows(self):
  self.setup_scene()
  for field,value in [('pending',[{'id':'pending','actorId':'ray','action':{'type':'end','actorId':'ray'},'declaredBy':self.gm_identity['user']['id'] if 'user' in self.gm_identity else 1}]),('unresolvedFumbles',[{'commandId':'prior','actorIds':['ray']}])]:
   original=self.raw_scene();self.mutate(lambda s:s.update({field:value}));before=self.snapshot(training=True);result,_=self.command();self.assertEqual(result[0],409,result);self.assertEqual(before,self.snapshot(training=True));self.mutate(lambda s:(s.clear(),s.update(copy.deepcopy(original))))
  self.mutate(lambda s:s.update(phase='ended'));result,_=self.command();self.assertEqual(result[0],200,result);self.assertEqual(result[1]['battle']['phase'],'ended')
 def test_independent_actual_shared_endpoint_and_preview_forbidden(self):
  self.setup_scene();path=self.path.removesuffix('/training');body=dict(id='empty-real',expectedVersion=0,type='prepare',name='Real scene',width=8,height=6,tileMeters=1,actors=[])
  created=self.gm_client.request(path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(created[0],200,created);s=created[1]['battle'];before=self.snapshot(training=True);action=dict(type='prepare-training-loadouts',choices=self.choices(),rulings={})
  result=self.gm_client.request(path+'/commands','POST',dict(id='no-training-on-real',battleId=s['id'],expectedVersion=s['version'],**action),csrf=self.gm_identity['csrf']);self.assertEqual(result[0],403,result)
  result=self.gm_client.request(path+'/preview','POST',dict(battleId=s['id'],expectedVersion=s['version'],command=action),csrf=self.gm_identity['csrf']);self.assertEqual(result[0],403,result);self.assertEqual(before,self.snapshot(training=True))
 def test_independent_rollback_after_first_planned_actor_is_applied(self):
  self.setup_scene();before=self.snapshot(training=True);original=b.sync_weapon;calls=[]
  def fail(actor):
   result=original(actor)
   if actor.get('loadout') is not None:
    calls.append(actor['id']);raise sqlite3.OperationalError('independent injected first actor failure')
   return result
  with patch.object(b,'sync_weapon',side_effect=fail):result,request=self.command()
  self.assertEqual(result[0],503,result);self.assertEqual(calls,['ray']);self.assertEqual(before,self.snapshot(training=True))
  retry=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertEqual(retry[0],200,retry)
if __name__=='__main__':unittest.main()
