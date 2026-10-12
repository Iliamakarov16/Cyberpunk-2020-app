"""Independent adversarial cover checks retained as durable regression tests."""
import sys,copy,json,unittest,sqlite3
from types import SimpleNamespace
from unittest.mock import patch

import test_cover_actions_http as f
import shared_battle as b
class Review(f.CoverHTTP):
 def setUp(self):
  super().setUp();p=patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5));p.start();self.addCleanup(p.stop)
 def raw_scene(self):
  with self.database() as db:return json.loads(db.execute('SELECT data FROM shared_battles').fetchone()[0])
 def mutate(self,fn):
  with self.database() as db:
   s=json.loads(db.execute('SELECT data FROM shared_battles').fetchone()[0]);fn(s);db.execute('UPDATE shared_battles SET data=?',(json.dumps(s),));db.commit()
 def attack(self,wear=None,**kwargs):
  ruling=dict(turnToTarget=False,throughModifier=0,throughTargetKnown=True)
  if wear is not None:ruling['rulings']={'coverArmorWear':wear}
  return self.execute(self.fire(gmFire=ruling,**kwargs))
 def cover_torso(self,sp=5):
  result,_=self.command('configure-cover',target={'propId':'table'},profile=f.profile(sp=sp,coveredZones=['torso']));self.assertEqual(result[0],200,result)
 def test_independent_body_wear_narrow_real_persistence_and_undo(self):
  self.setup_cover();self.cover_torso();before=self.gm_client.request(f'/api/characters/{self.guard}')[1];scene=self.raw_scene();result,request=self.attack('body');self.assertEqual(result[0],200,result)
  impact=result[1]['receipt']['event']['impacts'][0];self.assertEqual((impact['coverProtection']['effectiveSP'],impact['penetration'],impact['damage']),(13,4,1));self.assertEqual((impact['armorWear']['before'],impact['armorWear']['after']),(8,7))
  after=self.gm_client.request(f'/api/characters/{self.guard}')[1];expected=copy.deepcopy(before['data']);expected['wounds']=1;next(i for i in expected['items'] if i['id']=='vest')['armor']['coverage']['torso']=7;self.assertEqual(after['data'],expected);self.assertEqual(after['version'],before['version']+1);self.assertEqual(self.raw_scene()['props'],scene['props'])
  undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}')[1]['data'],before['data'])
 def test_independent_zero_sp_no_fake_bonus_and_stopped_no_wear(self):
  self.setup_cover();self.cover_torso(40);before=self.gm_client.request(f'/api/characters/{self.guard}')[1];result,_=self.attack('body');self.assertEqual(result[0],200,result);impact=result[1]['receipt']['event']['impacts'][0];self.assertEqual((impact['coverProtection']['effectiveSP'],impact['damage'],impact['penetration']),(40,0,0));self.assertNotIn('armorWear',impact);self.assertEqual(before,self.gm_client.request(f'/api/characters/{self.guard}')[1]);self.assertEqual(self.command('undo')[0][0],200)
  self.cover_torso(0);result,_=self.attack('none');self.assertEqual(result[0],200,result);impact=result[1]['receipt']['event']['impacts'][0];self.assertEqual((impact['coverProtection']['effectiveSP'],impact['penetration'],impact['damage']),(8,9,6));self.assertFalse(impact['coverComposite']);self.assertEqual(impact['armorWear']['after'],7)
 def test_independent_optional_rule_off_does_not_wear_anything(self):
  self.setup_cover();self.cover_torso();self.assertEqual(self.command('armor-rule',enabled=False)[0][0],200);result,_=self.attack('body');self.assertEqual(result[0],200,result);impact=result[1]['receipt']['event']['impacts'][0];self.assertEqual(impact['damage'],1);self.assertNotIn('armorWear',impact);a=next(a for a in self.raw_scene()['actors'] if a['id']==self.target);self.assertEqual(a['armor']['torso'],8);self.assertEqual(self.raw_scene()['props'][0]['protection']['sp'],5)
 def test_independent_missing_wear_and_bad_commands_reject_without_rng(self):
  self.setup_cover();self.cover_torso();self.assertEqual(self.command('rules',rulings={'nonautomaticFumbleAmmo':'consume-attempted'})[0][0],200)
  bad=[('configure-cover',dict(target={'propId':'table'},profile=f.profile(sp=True))),('configure-cover',dict(target={'propId':'table'},profile=f.profile(blocksVision=0))),('configure-cover',dict(target={'propId':[]},profile=f.profile())),('configure-cover',dict(target={'x':True,'y':1},profile={'material':'wood','sp':5})),('configure-cover',dict(target={'propId':'table'},profile=f.profile(coveredZones=['torso','torso']))),('flip',dict(actorId=self.aid,propId='table',facing=True)),('flip',dict(actorId=self.aid,propId='table',facing=45))]
  before=self.snapshot(training=True)
  for kind,fields in bad:
   result,_=self.command(kind,**fields);self.assertIn(result[0],(400,409),result);self.assertEqual(before,self.snapshot(training=True))
  result,_=self.attack();self.assertEqual(result[0],400,result);self.assertEqual(before,self.snapshot(training=True))
  for modifier in [True,1.5,'0',None,31,-31]:
   result,_=self.execute(self.fire(gmFire=dict(turnToTarget=False,throughModifier=modifier,throughTargetKnown=True)));self.assertEqual(result[0],400,result);self.assertEqual(before,self.snapshot(training=True))
 def test_independent_unknown_barrier_and_tile_configuration_private_undo(self):
  client,user,cid=self.setup_cover();self.mutate(lambda s:s['tiles'][2].__setitem__(4,{'type':'wall'}));before=self.snapshot(training=True);result,_=self.attack();self.assertEqual(result[0],400,result);self.assertEqual(before,self.snapshot(training=True));result,_=self.command('configure-cover',target={'x':4,'y':2},profile={'material':'SECRET STEEL MATERIAL','sp':20});self.assertEqual(result[0],200,result)
  private=client.request(self.path)[1];self.assertNotIn('SECRET STEEL MATERIAL',json.dumps(private));self.assertNotIn(self.target,json.dumps(private));result,_=self.attack();self.assertEqual(result[0],200,result);impact=result[1]['receipt']['event']['impacts'][0];self.assertEqual(impact['coverProtection']['effectiveSP'],23);self.assertEqual(impact['damage'],0);self.assertEqual(self.raw_scene()['tiles'][2][4]['protection']['sp'],20)
 def test_independent_opaque_flip_history_does_not_reveal_hidden_later(self):
  client,user,cid=self.setup_cover(True);result,request=self.attack();self.assertEqual(result[0],200,result);shotid=result[1]['receipt']['event']['id'];self.assertNotIn(self.target,json.dumps(client.request(self.path)[1]));result,_=self.command('configure-cover',target={'propId':'table'},profile=f.profile(blocksVision=False));self.assertEqual(result[0],200,result);view=client.request(self.path)[1];self.assertIn(self.target,[a['id'] for a in view['battle']['scene']['actors']]);self.assertNotIn(shotid,[e['id'] for e in view['battle']['log']]);self.assertTrue(all(e.get('kind')!='shoot' for e in view['battle']['log']))
 def test_independent_through_transaction_failure_rolls_back_barrier_and_all_sheets(self):
  self.setup_cover();self.cover_torso();before=self.snapshot(training=True);original=b.persist_combat_effects
  def fail(*args,**kwargs):original(*args,**kwargs);raise sqlite3.OperationalError('independent cover transaction rollback')
  with patch.object(b,'persist_combat_effects',side_effect=fail):result,request=self.attack('body')
  self.assertEqual(result[0],503,result);self.assertEqual(before,self.snapshot(training=True));result=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']);self.assertEqual(result[0],200,result)
 def test_independent_two_hits_recompute_sp_and_one_sheet_revision(self):
  self.setup_cover();self.assertEqual(self.command('finish')[0][0],200)
  prepared=copy.deepcopy(self.cover_body);state=self.gm_client.request(self.path)[1]['battle'];prepared.update(id='burst-cover-profile',expectedVersion=state['version'])
  prepared['actors'][0]['weapon']['rof']=3;profile=prepared['actors'][0]['loadout']['weapons'][0];profile.update(rof=3,fireModes=['single','burst'],fumbleClass='automatic')
  prepared['props'][0]['protection']=f.profile(coveredZones=['torso']);result=self.gm_client.request(self.path,'POST',prepared,csrf=self.gm_identity['csrf']);self.assertEqual(result[0],200,result);self.begin()
  target_before=self.gm_client.request(f'/api/characters/{self.guard}')[1];shooter_id=int(self.aid.removeprefix('character-'));shooter_before=self.gm_client.request(f'/api/characters/{shooter_id}')[1]
  values=iter([.5]*10+[.2,.5,.2,.5]);ruling=dict(turnToTarget=False,throughModifier=0,throughTargetKnown=True,rulings=dict(burstHitRounding='floor',jamAmmo='consume-declared',coverArmorWear='body'))
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(values))):result,_=self.execute(self.fire(mode='burst',rounds=3,location='random',gmFire=ruling))
  self.assertEqual(result[0],200,result);event=result[1]['receipt']['event'];hits=event['impacts'];self.assertEqual([(h['location'],h['sp'],h['coverProtection']['effectiveSP'],h['penetration'],h['damage']) for h in hits],[('torso',8,13,4,1),('torso',7,12,5,2)]);self.assertEqual((event['rounds'],event['hits'],event['damage']),(3,2,3))
  target_after=self.gm_client.request(f'/api/characters/{self.guard}')[1];shooter_after=self.gm_client.request(f'/api/characters/{shooter_id}')[1];self.assertEqual(target_after['version'],target_before['version']+1);self.assertEqual(shooter_after['version'],shooter_before['version']+1);self.assertEqual(target_after['data']['wounds'],3);self.assertEqual(next(i for i in target_after['data']['items'] if i['id']=='vest')['armor']['coverage']['torso'],6);self.assertEqual(next(i for i in shooter_after['data']['items'] if i['id']=='ammo')['quantity'],7);self.assertEqual(self.raw_scene()['props'][0]['protection']['sp'],5)
  self.assertEqual(self.command('undo')[0][0],200);self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}')[1]['data'],target_before['data']);self.assertEqual(self.gm_client.request(f'/api/characters/{shooter_id}')[1]['data'],shooter_before['data'])
if __name__=='__main__':
 suite=unittest.TestSuite(Review(n) for n in dir(Review) if n.startswith('test_independent_'));result=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not result.wasSuccessful())
