"""Independent review regressions retained in source; includes firing fixture coverage."""
import sys,copy,json,unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[1])
sys.path.insert(0,ROOT+'/android/app/src/main/python');sys.path.insert(0,ROOT+'/tests')
import shared_battle as b
import test_firing_actions_http as firing
class Review(firing.FiringHTTP):
 def test_review_legacy_shoot_rejects_jammed_canonical_weapon(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready(True)
  draws=iter([0,.1,.1])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):
   result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result)
  before=self.snapshot(training=True)
  result,_=self.command('shoot',actorId=action['actorId'],targetId=action['targetIds'][0],turnToTarget=False)
  self.assertNotEqual(result[0],200,'Legacy shoot bypassed canonical jam state')
  self.assertEqual(before,self.snapshot(training=True))
 def test_review_jam_does_not_face_unattempted_target(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready(True)
  with self.database() as db:
   row=db.execute('SELECT campaign_id,data FROM shared_battles').fetchone();scene=json.loads(row[1]);shooter=next(a for a in scene['actors'] if a['id']==action['actorId']);guard=next(a for a in scene['actors'] if a['id']==action['targetIds'][0])
   extra=copy.deepcopy(guard);extra.update(id='review-unused',characterId=None,ownerId=None,name='Review unused target',origin={'kind':'npc'},x=1,y=4)
   scene['actors'].append(extra);scene['settings']['cp2020Rulings']['autoModifierBasis']='allocated';db.execute('UPDATE shared_battles SET data=? WHERE campaign_id=?',(json.dumps(scene),row[0]))
  first_heading=b.heading_towards(shooter,guard)
  action.update(mode='auto',rounds=4,targetIds=[guard['id'],extra['id']]);draws=iter([0,.1,.1])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):
   result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result)
  actor=next(a for a in result[1]['battle']['scene']['actors'] if a['id']==action['actorId']);event=result[1]['receipt']['event']
  self.assertEqual(event['rangedReceipt']['targets'][1]['attacks'],[])
  self.assertEqual(actor['heading'],first_heading,'Heading changed toward target never attempted after jam')
  self.assertEqual(event['to'],{'x':guard['x'],'y':guard['y']})
 def test_review_malformed_target_ids_are_clean_errors(self):
  for bad in [[{}],[[]],[True],[1],[None]]:
   with self.subTest(bad=bad):
    with self.assertRaises(b.BattleError):b.validate_action(dict(type='fire',actorId='a',mode='single',rounds=1,targetIds=bad))
 def geometry_reprepare(self):
  body=copy.deepcopy(self.two_body);state=self.gm_client.request(self.path)[1]['battle'];body.update(id='review-geometry-'+str(state['version']),expectedVersion=state['version'])
  for c in body['actors']:
   c['version']=self.gm_client.request('/api/characters/'+str(c['characterId']))[1]['version']
   if 'loadout' in c:c.pop('loadout');c['weapon']=None
  return self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf'])
 def test_review_geometry_reprepare_preserves_jam_or_blocks(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready(True)
  draws=iter([0,.1,.5])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):
   result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result);aid=action['actorId'];old=next(a for a in result[1]['battle']['scene']['actors'] if a['id']==aid);self.assertEqual(old['weaponJams']['gun'],4)
  finished,_=self.command('finish');self.assertEqual(finished[0],200,finished);prepared=self.geometry_reprepare()
  if prepared[0]!=200:return
  new=next(a for a in prepared[1]['battle']['scene']['actors'] if a['id']==aid)
  self.assertEqual(new.get('weaponJams'),old['weaponJams'],'Geometry-only reprepare silently repaired jammed gun')
  self.assertEqual(new['loadout']['weapons'],old['loadout']['weapons'])
 def test_review_geometry_reprepare_preserves_pending_fumble_or_blocks(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready()
  draws=iter([0,.4])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):
   result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result);pending=result[1]['battle']['scene']['unresolvedFumbles'];self.assertTrue(pending)
  finished,_=self.command('finish');self.assertEqual(finished[0],200,finished);prepared=self.geometry_reprepare()
  if prepared[0]!=200:return
  self.assertEqual(prepared[1]['battle']['scene'].get('unresolvedFumbles'),pending,'Geometry-only reprepare silently discarded pending consequences')
 def test_review_adjudication_note_is_private_to_gm(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready()
  draws=iter([0,.4])
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:next(draws))):
   result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False})
  self.assertEqual(result[0],200,result);entry=result[1]['battle']['scene']['unresolvedFumbles'][0]
  note='REVIEW-GM-PRIVATE-MECHANICS'
  resolved,_=self.command('resolve-fumble',sourceCommandId=entry['commandId'],note=note,effects=[dict(actorId=action['actorId'],finalDamage=0,dropWeapon=True,additionalActions=0)])
  self.assertEqual(resolved[0],200,resolved);self.assertIn(note,json.dumps(resolved[1]));self.assertNotIn(note,json.dumps(client.request(self.path)[1]))
  self.assertNotIn('rangedReceipt',json.dumps(client.request(self.path)[1]))
 def test_review_rules_change_pending_confirmation_and_undo(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready(True);action.update(mode='burst',rounds=3)
   declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
   rules={'jamAmmo':'consume-declared','burstHitRounding':'floor'}
   forged,_=self.command('rules',client,user,rulings=rules);self.assertEqual(forged[0],403,forged)
   changed,_=self.command('rules',rulings=rules);self.assertEqual(changed[0],200,changed);self.assertEqual(len(changed[1]['battle']['pending']),1)
   result,_=self.command('confirm',declarationId=request['id'],gmFire={'turnToTarget':False});self.assertEqual(result[0],200,result)
   self.assertEqual(result[1]['receipt']['event']['rangedReceipt']['rulingsUsed']['burstHitRounding'],'floor')
   undone,_=self.command('undo');self.assertEqual(undone[0],200,undone);self.assertEqual(undone[1]['battle']['scene']['settings']['cp2020Rulings'],rules);self.assertEqual(undone[1]['battle']['pending'],[])
 def test_review_stale_target_does_not_roll_or_consume(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready()
  declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
  old=self.gm_client.request('/api/characters/'+str(self.guard))[1];data=copy.deepcopy(old['data']);data['notes']='Changed outside battle'
  change=self.gm_client.request('/api/characters/'+str(self.guard),'PUT',{'data':data,'version':old['version'],'reason':'Review conflict'},csrf=self.gm_identity['csrf']);self.assertEqual(change[0],200,change)
  before=self.snapshot(training=True)
  def no_rng():raise AssertionError('Stale target consumed RNG')
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=no_rng)):
   result,_=self.command('confirm',declarationId=request['id'],gmFire={'turnToTarget':False})
  self.assertEqual(result[0],409,result);self.assertEqual(before,self.snapshot(training=True))
 def test_review_undo_rejects_external_sheet_edit_atomically(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   client,user,cid,action=self.ready();result,_=self.command('fire',**{k:v for k,v in action.items() if k!='type'},gmFire={'turnToTarget':False});self.assertEqual(result[0],200,result)
  old=client.request('/api/characters/'+str(cid))[1];data=copy.deepcopy(old['data']);data['notes']='Keep this edit'
  change=client.request('/api/characters/'+str(cid),'PUT',{'data':data,'version':old['version'],'reason':'Review undo conflict'},csrf=user['csrf']);self.assertEqual(change[0],200,change)
  before=self.snapshot(training=True);result,_=self.command('undo');self.assertEqual(result[0],409,result);self.assertEqual(before,self.snapshot(training=True))
 def test_review_three_sheets_auto_atomic_replay_undo(self):
  with patch.object(b.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
   self.party(count=2,hidden=False);client,user,cid=self.players[0];body=copy.deepcopy(self.prepare_body);body.update(id='review-multi',expectedVersion=1)
   c=body['actors'][0];p=dict(c['weapon'],kind='ranged',profileId='review verified',weaponType='handgun',fireModes=['single','auto'],singleActionCap=1,reliability='ST',fumbleClass='automatic');p.update(rof=20,damageDice=1,damageBonus=0)
   c.update(weapon=None,loadout={'weapons':[p],'activeWeaponId':'gun','resetLoaded':True})
   body['settings']={'stagedPenetration':True,'cp2020Rulings':{'jamAmmo':'consume-declared','autoReducedRounds':'allow-declared','autoTenRoundGroups':'floor','autoModifierBasis':'allocated'}}
   response=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf']);self.assertEqual(response[0],200,response);self.begin()
   before=self.snapshot(training=True);before_sheets={i:self.gm_client.request('/api/characters/'+str(i))[1] for i in [cid,self.players[1][2],self.guard]}
   action=dict(type='fire',actorId='character-'+str(cid),mode='auto',rounds=6,targetIds=['character-'+str(self.players[1][2]),'character-'+str(self.guard)])
   declared,request=self.command('declare',client,user,action=action);self.assertEqual(declared[0],200,declared)
   result,confirmation=self.command('confirm',declarationId=request['id'],gmFire={'turnToTarget':False});self.assertEqual(result[0],200,result)
   event=result[1]['receipt']['event'];self.assertEqual((event['rounds'],event['hits']),(6,6));self.assertEqual([x['hitCount'] for x in event['rangedReceipt']['targets']],[3,3])
   for i,old in before_sheets.items():
    new=self.gm_client.request('/api/characters/'+str(i))[1];self.assertEqual(new['version'],old['version']+1)
    if i!=cid:self.assertEqual(new['data']['wounds'],3)
   self.assertEqual(next(i for i in client.request('/api/characters/'+str(cid))[1]['data']['items'] if i['id']=='ammo')['quantity'],4)
   after=self.snapshot(training=True);duplicate=self.gm_client.request(self.path+'/commands','POST',confirmation,csrf=self.gm_identity['csrf']);self.assertTrue(duplicate[1]['duplicate']);self.assertEqual(after,self.snapshot(training=True))
   for viewer,_,_ in self.players:
    view=json.dumps(viewer.request(self.path)[1]);self.assertNotIn('rangedReceipt',view);self.assertNotIn('PRIVATE',view);self.assertNotIn('itemBindings',json.dumps([a for a in viewer.request(self.path)[1]['battle']['scene']['actors'] if a['id']!=viewer.request(self.path)[1]['viewerActorId']]))
   undone,_=self.command('undo');self.assertEqual(undone[0],200,undone)
   for i,old in before_sheets.items():self.assertEqual(self.gm_client.request('/api/characters/'+str(i))[1]['data'],old['data'])
if __name__=='__main__':
 suite=unittest.TestSuite(Review(name) for name in sorted(x for x in dir(Review) if x.startswith('test_review_')))
 unittest.TextTestRunner(verbosity=2).run(suite)
