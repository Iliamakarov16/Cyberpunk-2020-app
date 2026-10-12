"""Independent privacy/resource checks retained for synthetic equipment and trajectories."""
import sys,copy,json,unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[1])
sys.path.insert(0,ROOT+'/android/app/src/main/python');sys.path.insert(0,ROOT+'/tests')
import shared_battle as b
import test_scene_loadout_http as scene_tests
import test_firing_actions_http as fire_tests
class SceneReview(scene_tests.SceneLoadoutHTTP):
 def scene_ready(self):
  view=self.scene();config=self.config(view);result,_=self.command('configure-loadout',actorId='ray',config=config);self.assertEqual(result[0],200,result)
  rules,_=self.command('rules',rulings={'nonautomaticFumbleAmmo':'consume-attempted'});self.assertEqual(rules[0],200,rules)
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   result,_=self.command('start');self.assertEqual(result[0],200,result);self.assertEqual(result[1]['battle']['scene']['currentActorId'],'ray')
  return config
 def test_review_synthetic_fire_remove_readd_cannot_restore_spent_ammo(self):
  config=self.scene_ready();real_before=self.snapshot()
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   result,_=self.command('fire',actorId='ray',mode='single',rounds=1,targetIds=['guard-1'],gmFire={'turnToTarget':False});self.assertEqual(result[0],200,result)
  actor=next(a for a in result[1]['battle']['scene']['actors'] if a['id']=='ray');self.assertEqual((actor['weapon']['ammo'],actor['weapon']['reserve']),(7,32))
  finished,_=self.command('finish');self.assertEqual(finished[0],200,finished)
  before=self.snapshot(training=True);failed,_=self.command('configure-loadout',actorId='ray',config=config);self.assertEqual(failed[0],409,failed);self.assertEqual(before,self.snapshot(training=True))
  removed,_=self.command('configure-loadout',actorId='ray',config={'weapons':[],'activeWeaponId':None});self.assertEqual(removed[0],200,removed)
  inventory=next(x['data'] for x in removed[1]['options']['sceneLoadouts'] if x['actorId']=='ray');self.assertEqual(next(i['quantity'] for i in inventory['items'] if i['category']=='ammo'),39)
  config['weapons'][0]['loaded']=7
  added,request=self.command('configure-loadout',actorId='ray',config=config);self.assertEqual(added[0],200,added);actor=next(a for a in added[1]['battle']['scene']['actors'] if a['id']=='ray');self.assertEqual((actor['weapon']['ammo'],actor['weapon']['reserve']),(7,32))
  after=self.snapshot(training=True);again=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertTrue(again[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
  undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);inventory=next(x['data'] for x in undone[1]['options']['sceneLoadouts'] if x['actorId']=='ray');self.assertEqual(next(i['quantity'] for i in inventory['items'] if i['category']=='ammo'),39)
  self.assertEqual(real_before,self.snapshot())
 def test_review_dropped_weapon_cannot_be_reactivated_without_readiness_reset(self):
  config=self.scene_ready();draws=iter([0,.4])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):
   result,_=self.command('fire',actorId='ray',mode='single',rounds=1,targetIds=['guard-1'],gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result);pending=result[1]['battle']['scene']['unresolvedFumbles'][0]
  result,_=self.command('resolve-fumble',sourceCommandId=pending['commandId'],note='Weapon dropped; not picked up.',effects=[{'actorId':'ray','finalDamage':0,'dropWeapon':True,'additionalActions':0}]);self.assertEqual(result[0],200,result)
  result,_=self.command('finish');self.assertEqual(result[0],200,result);config['weapons'][0]['loaded']=7
  configured,_=self.command('configure-loadout',actorId='ray',config=config)
  self.assertNotEqual(configured[0],200,'Configuration silently reactivated a dropped weapon without readiness reset')
  before=self.snapshot(training=True);bad=copy.deepcopy(config);bad['resetReadiness']=1
  rejected,_=self.command('configure-loadout',actorId='ray',config=bad);self.assertEqual(rejected[0],400,rejected);self.assertEqual(before,self.snapshot(training=True))
  config['resetReadiness']=True;restored,_=self.command('configure-loadout',actorId='ray',config=config);self.assertEqual(restored[0],200,restored)
  ray=next(a for a in restored[1]['battle']['scene']['actors'] if a['id']=='ray');self.assertFalse(ray.get('unavailableWeapons'));self.assertEqual(ray['weapon']['ammo'],7)
  undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);ray=next(a for a in undone[1]['battle']['scene']['actors'] if a['id']=='ray');self.assertTrue(ray['weapon']['unarmed']);self.assertIn('colt-amt2000',ray['unavailableWeapons'])

class EventReview(fire_tests.FiringHTTP):
 def test_review_scene_config_cannot_touch_real_character_or_be_player_controlled(self):
  self.party(count=1,hidden=False);client,user,cid=self.players[0];before=self.snapshot(training=True)
  for who,ident in [(self.gm_client,self.gm_identity),(client,user)]:
   result,_=self.command('configure-loadout',who,ident,actorId='character-'+str(cid),config={'weapons':[],'activeWeaponId':None});self.assertEqual(result[0],403,result)
  self.assertEqual(before,self.snapshot(training=True))
 def test_review_live_npc_configuration_is_gm_scene_owned_and_undoable(self):
  self.party(count=1,hidden=False);client,user,cid=self.players[0]
  result,_=self.command('add',templateId='guard-rifle',name='Review synthetic guard',x=6,y=4,hidden=False);self.assertEqual(result[0],200,result)
  npc=next(a for a in result[1]['battle']['scene']['actors'] if a.get('origin',{}).get('kind')=='npc');w=npc['weapon'];aid=npc['id'];data=next(x['data'] for x in result[1]['options']['sceneLoadouts'] if x['actorId']==aid)
  config={'weapons':[dict(weaponId=w['id'],kind='ranged',profileId='Review explicit NPC profile',weaponType='rifle',skillName='Rifle',skillRank=npc['stats']['rifle'],damageDice=w['damageDice'],damageBonus=w['damageBonus'],accuracy=w['accuracy'],ammoItemId=next(i['id'] for i in data['items'] if i['category']=='ammo'),range=w['range'],rof=w['rof'],magazine=w['magazine'],loaded=w['ammo'],fireModes=['single'],singleActionCap=1,reliability='ST',fumbleClass='automatic')],'activeWeaponId':w['id']}
  before=self.snapshot(training=True);denied,_=self.command('configure-loadout',client,user,actorId=aid,config=config);self.assertEqual(denied[0],403,denied);self.assertEqual(before,self.snapshot(training=True))
  bad=copy.deepcopy(config);bad['weapons'][0]['ammoItemId']='foreign-ammo';failed,_=self.command('configure-loadout',actorId=aid,config=bad);self.assertNotEqual(failed[0],200,failed);self.assertEqual(before,self.snapshot(training=True))
  saved,request=self.command('configure-loadout',actorId=aid,config=config);self.assertEqual(saved[0],200,saved);after=self.snapshot(training=True)
  for table in ['characters','revisions','users']:self.assertEqual(before[table],after[table],table)
  current=next(a for a in saved[1]['battle']['scene']['actors'] if a['id']==aid);self.assertEqual((current['weapon']['ammo'],current['weapon']['reserve']),(w['ammo'],w['reserve']))
  player=client.request(self.path)[1];self.assertNotIn('sceneLoadouts',player['options']);self.assertNotIn('sceneInventory',json.dumps(player));self.assertNotIn('Review explicit NPC profile',json.dumps(player))
  replay=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertTrue(replay[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
  undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);current=next(a for a in undone[1]['battle']['scene']['actors'] if a['id']==aid);self.assertNotIn('loadout',current);self.assertEqual(current['weapon'],w)
 def test_review_child_events_filter_hidden_target_and_keep_resources_single(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready(True)
   with self.database() as db:
    row=db.execute('SELECT campaign_id,data FROM shared_battles').fetchone();scene=json.loads(row[1]);guard=next(a for a in scene['actors'] if a['id']==action['targetIds'][0]);extra=copy.deepcopy(guard);extra.update(id='review-hidden-target',name='SECRET CHILD TARGET',characterId=None,ownerId=None,origin={'kind':'npc'},x=0,y=1,hidden=True);scene['actors'].append(extra);scene['settings']['cp2020Rulings']['autoModifierBasis']='allocated';scene['settings']['cp2020Rulings']['autoPointBlankModifier']=0;db.execute('UPDATE shared_battles SET data=? WHERE campaign_id=?',(json.dumps(scene),row[0]))
   action.update(mode='auto',rounds=4,targetIds=[guard['id'],extra['id']]);result,request=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False});self.assertEqual(result[0],200,result)
  event=result[1]['receipt']['event'];self.assertTrue(event['effectSuppressed']);self.assertNotIn('_visualEvents',event)
  visuals=[e for e in result[1]['battle']['log'] if e.get('visualOnly')];self.assertEqual(len(visuals),2);self.assertEqual([e['actorIds'][1] for e in visuals],[guard['id'],extra['id']])
  player=client.request(self.path)[1];public_visuals=[e for e in player['battle']['log'] if e.get('visualOnly')];self.assertEqual([e['actorIds'][1] for e in public_visuals],[guard['id']]);encoded=json.dumps(player)
  for private in ['review-hidden-target','SECRET CHILD TARGET','rangedReceipt','_visualEvents','_seenBy']:self.assertNotIn(private,encoded)
  self.assertEqual(next(i['quantity'] for i in client.request('/api/characters/'+str(cid))[1]['data']['items'] if i['id']=='ammo'),6)
  after=self.snapshot(training=True);again=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertTrue(again[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True));self.assertEqual(len([e for e in again[1]['battle']['log'] if e.get('visualOnly')]),2)
 def test_review_jam_emits_no_visual_for_skipped_target(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready(True)
  with self.database() as db:
   row=db.execute('SELECT campaign_id,data FROM shared_battles').fetchone();scene=json.loads(row[1]);extra=copy.deepcopy(scene['actors'][1]);extra.update(id='review-skipped',characterId=None,ownerId=None,origin={'kind':'npc'},x=1,y=4);scene['actors'].append(extra);scene['settings']['cp2020Rulings']['autoModifierBasis']='allocated';scene['settings']['cp2020Rulings']['autoPointBlankModifier']=0;db.execute('UPDATE shared_battles SET data=? WHERE campaign_id=?',(json.dumps(scene),row[0]))
  action.update(mode='auto',rounds=4,targetIds=action['targetIds']+[extra['id']]);draws=iter([0,.1,.1])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result);visuals=[e for e in result[1]['battle']['log'] if e.get('visualOnly')];self.assertEqual(len(visuals),1);self.assertNotIn('review-skipped',json.dumps(visuals));self.assertTrue(result[1]['receipt']['event']['effectSuppressed'])
if __name__=='__main__':
 suite=unittest.TestSuite(cls(name) for cls in [SceneReview,EventReview] for name in dir(cls) if name.startswith('test_review_'));unittest.TextTestRunner(verbosity=2).run(suite)
