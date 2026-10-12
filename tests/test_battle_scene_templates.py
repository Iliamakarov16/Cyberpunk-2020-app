"""0.17.3: scene-owned NPCs, blueprint import/export, narrow transactional armor wear."""
import copy
import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_mobile_host as fixtures
import test_tactical_battle_http as tactical
import shared_battle as battle


class SceneTemplatesHTTP(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    sheet = tactical.TacticalHTTP.sheet
    party = tactical.TacticalHTTP.party
    command = tactical.TacticalHTTP.command
    begin = tactical.TacticalHTTP.begin
    database = tactical.TacticalHTTP.database
    snapshot = tactical.TacticalHTTP.snapshot
    preview = tactical.TacticalHTTP.preview

    def reprepare(self, config=None, **extras):
        current=self.gm_client.request(self.path)[1]['battle']
        body=copy.deepcopy(config or self.prepare_body)
        body.update(id='prepare-'+str(current['version']),expectedVersion=current['version'],**extras)
        result=self.gm_client.request(self.path,'POST',body,csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0],200,result)
        return result[1],body

    def update_sheet(self, client, user, cid, change):
        sheet=client.request(f'/api/characters/{cid}')[1]; data=copy.deepcopy(sheet['data']); change(data)
        result=client.request(f'/api/characters/{cid}','PUT',dict(version=sheet['version'],data=data,reason='Test explicit configuration'),csrf=user['csrf'])
        self.assertEqual(result[0],200,result)
        return result[1]

    def scene_configs(self, scene):
        configs=[]
        for actor in scene['actors']:
            if not battle.sheet_actor(actor): continue
            weapon=actor['weapon']
            config=dict(characterId=actor['characterId'],version=actor['sheetVersion'],x=actor['x'],y=actor['y'],team=actor['team'],hidden=actor['hidden'],sprite=actor['sprite'],
                        armor=copy.deepcopy(actor['armor']),combatSense=actor['stats']['combatSense'],weapon=None)
            if not weapon.get('unarmed'):
                config['weapon']={k:weapon[k] for k in ('weaponId','ammoItemId','skillName','skillRank','damageDice','damageBonus','accuracy','range','rof','magazine')}
                config['weapon']['loaded']=weapon['ammo']
            if actor.get('net'):
                config['net']=dict(deckItemId=actor['net']['deckItemId'],interfaceRank=actor['stats']['interface'],programIds=actor['net']['programIds'])
            configs.append(config)
        return configs

    def test_scene_owned_npc_mixed_shot_undo_and_prepare_preserves_resources(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=False); client,user,cid=self.players[0]
            before=self.snapshot(training=True)
            preview=self.preview(dict(type='add',templateId='guard-rifle',name='Scene guard',x=6,y=4,hidden=False))
            self.assertEqual(preview[0],200,preview); self.assertEqual(preview[1]['preview']['to'],dict(x=6,y=4))
            result,_=self.command('add',templateId='guard-rifle',name='Scene guard',x=6,y=4,hidden=False)
            self.assertEqual(result[0],200,result)
            npc=next(a for a in result[1]['battle']['scene']['actors'] if a.get('origin',{}).get('kind')=='npc')
            self.assertIsNone(npc['characterId']); self.assertIsNone(npc['sheetVersion'])
            after=self.snapshot(training=True)
            for table in ('users','characters','revisions'):
                self.assertEqual(before[table],after[table],table)
            denied=self.preview(dict(type='add',templateId='guard-rifle'),client,user)
            self.assertEqual(denied[0],403,denied)
            public=next(a for a in client.request(self.path)[1]['battle']['scene']['actors'] if a['id']==npc['id'])
            self.assertFalse({'stats','armor','weapon','wounds','ownerId','sheetVersion','origin'} & set(public))
            self.begin()
            shot,request=self.command('shoot',actorId='character-'+str(cid),targetId=npc['id'],location='torso')
            self.assertEqual(shot[0],200,shot)
            wounded=next(a for a in shot[1]['battle']['scene']['actors'] if a['id']==npc['id'])
            self.assertEqual((wounded['wounds'],wounded['armor']['torso']),(1,13))
            self.assertEqual(shot[1]['receipt']['event']['impacts'][0]['armorWear']['mode'],'scene')
            self.assertFalse(shot[1]['receipt']['event']['impacts'][0]['armorWear']['requiresManualUpdate'])
            self.assertEqual(self.command('finish')[0][0],200)
            ended=self.gm_client.request(self.path)[1]['battle']['scene']
            result,_=self.reprepare(actors=self.scene_configs(ended),preserveNpcIds=[npc['id']])
            preserved=next(a for a in result['battle']['scene']['actors'] if a['id']==npc['id'])
            self.assertEqual(preserved,wounded)
            self.assertEqual(len(self.snapshot()['characters']),len(before['characters']))
            self.assertEqual(self.command('start')[0][0],200)
            current=self.gm_client.request(self.path)[1]['battle']['scene']['currentActorId']
            shot,_=self.command('shoot',actorId=current,targetId=npc['id'],location='torso')
            self.assertEqual(shot[0],200,shot)
            undone,_=self.command('undo'); self.assertEqual(undone[0],200,undone)
            restored=next(a for a in undone[1]['battle']['scene']['actors'] if a['id']==npc['id'])
            self.assertEqual(restored['wounds'],wounded['wounds']); self.assertEqual(restored['armor'],wounded['armor'])

    def test_npc_shot_real_target_persists_only_target_wounds_armor_and_undo(self):
        self.party(count=1,hidden=False); client,user,cid=self.players[0]
        config=copy.deepcopy(self.prepare_body); config['actors'][0]['armor']['torso']=8
        self.reprepare(config)
        added,_=self.command('add',templateId='guard-rifle',x=6,y=4,hidden=False)
        self.assertEqual(added[0],200,added); npc=next(a for a in added[1]['battle']['scene']['actors'] if a.get('origin',{}).get('kind')=='npc')
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.begin(); self.assertEqual(self.command('end',actorId='character-'+str(cid))[0][0],200)
        self.assertEqual(self.gm_client.request(self.path)[1]['battle']['scene']['currentActorId'],npc['id'])
        original=client.request(f'/api/characters/{cid}')[1]
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.9)):
            shot,_=self.command('shoot',actorId=npc['id'],targetId='character-'+str(cid),location='torso')
        self.assertEqual(shot[0],200,shot); event=shot[1]['receipt']['event']
        self.assertTrue(event['impacts'][0]['armorWear']['persisted']); self.assertEqual(event['impacts'][0]['armorWear']['mode'],'item')
        changed=client.request(f'/api/characters/{cid}')[1]
        self.assertEqual(next(i for i in changed['data']['items'] if i['id']=='ammo')['quantity'],10)
        self.assertEqual(next(i for i in changed['data']['items'] if i['id']=='vest')['armor']['coverage']['torso'],7)
        self.assertEqual(changed['version'],original['version']+1)
        undone,_=self.command('undo'); self.assertEqual(undone[0],200,undone)
        restored=client.request(f'/api/characters/{cid}')[1]
        self.assertEqual(restored['data'],original['data']); self.assertEqual(restored['version'],original['version']+2)
        self.assertEqual(next(a for a in undone[1]['battle']['scene']['actors'] if a['id']==npc['id'])['weapon']['ammo'],35)

    def test_manual_and_single_layer_wear_exact_narrow_atomic_undo(self):
        for manual in (False,True):
            # One server fixture per subcase so command IDs do not overlap.
            if manual:
                fixtures.mobile_host.stop(); self.setUp()
            with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
                self.party(count=1,hidden=False); client,user,cid=self.players[0]
                config=copy.deepcopy(self.prepare_body)
                if manual:
                    edited=self.update_sheet(self.gm_client,self.gm_identity,self.guard,lambda d:d.update(armorMode='manual',armor={z:10 if z=='torso' else 0 for z in battle.ZONES}))
                    config['actors'][1]['version']=edited['version']
                config['actors'][1]['armor']['torso']=10 if manual else 8
                self.reprepare(config); self.begin()
                target_before=self.gm_client.request(f'/api/characters/{self.guard}')[1]
                before=self.snapshot(training=True); original=battle.persist_combat_effects
                def broken(*args, **kwargs):
                    original(*args, **kwargs); raise sqlite3.OperationalError('Injected failure after armor write')
                with patch.object(battle,'persist_combat_effects',side_effect=broken):
                    failed,_=self.command('shoot',actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso')
                    self.assertEqual(failed[0],503,failed)
                self.assertEqual(self.snapshot(training=True),before)
                result,_=self.command('shoot',actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso')
                self.assertEqual(result[0],200,result)
                target_after=self.gm_client.request(f'/api/characters/{self.guard}')[1]
                expected=copy.deepcopy(target_before['data']); expected['wounds']+=4 if manual else 6
                if manual: expected['armor']['torso']=9
                else: next(i for i in expected['items'] if i['id']=='vest')['armor']['coverage']['torso']=7
                self.assertEqual(target_after['data'],expected)
                self.assertEqual(result[1]['receipt']['event']['impacts'][0]['armorWear']['mode'],'manual' if manual else 'item')
                undone,_=self.command('undo'); self.assertEqual(undone[0],200,undone)
                self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}')[1]['data'],target_before['data'])
                self.assertEqual(self.gm_client.request(f'/api/characters/{self.guard}')[1]['version'],target_before['version']+2)

    def test_layered_wear_pending_private_persistent_and_explicit_acknowledgement(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=2,hidden=False); shooter,suser,scid=self.players[0]; target,tuser,tcid=self.players[1]
            def layer(data):
                vest=copy.deepcopy(next(i for i in data['items'] if i['id']=='vest')); vest.update(id='second-layer',name='Private armor layer')
                vest['armor']['coverage']['torso']=12; vest['armor']['order']=20; data['items'].append(vest)
            edited=self.update_sheet(target,tuser,tcid,layer)
            config=copy.deepcopy(self.prepare_body); config['actors'][1].update(version=edited['version']); config['actors'][1]['armor']['torso']=17
            config['actors'][0]['weapon']['damageDice']=5
            config['actors'][0]['loadout']['weapons'][0]['damageDice']=5
            self.reprepare(config); self.begin()
            before=target.request(f'/api/characters/{tcid}')[1]
            shot,_=self.command('shoot',actorId='character-'+str(scid),targetId='character-'+str(tcid),location='torso')
            self.assertEqual(shot[0],200,shot); event=shot[1]['receipt']['event']
            self.assertFalse(event['impacts'][0]['armorWear']['persisted']); self.assertTrue(event['impacts'][0]['armorWear']['requiresManualUpdate'])
            own=target.request(self.path)[1]; other=shooter.request(self.path)[1]
            ta=next(a for a in own['battle']['scene']['actors'] if a['characterId']==tcid)
            self.assertEqual({k:ta['wearPending']['torso'][k] for k in ('amount','sourceSP','resultSP')},dict(amount=1,sourceSP=17,resultSP=16))
            self.assertEqual(next(e['armorWear'] for e in own['battle']['log'] if e['kind']=='armor-wear'),event['impacts'][0]['armorWear'])
            self.assertFalse(any('armorWear' in e or e['kind']=='armor-wear' for e in other['battle']['log']))
            self.assertNotIn('wearPending',next(a for a in other['battle']['scene']['actors'] if a['characterId']==tcid))
            self.assertEqual(target.request(f'/api/characters/{tcid}')[1]['data']['items'],before['data']['items'])
            self.assertEqual(self.command('finish')[0][0],200)
            saved=self.gm_client.request(self.path)[1]
            fixtures.mobile_host.stop(); self.start(username='',password='')
            self.assertEqual(self.gm_client.request(self.path)[1],saved)
            exported=self.preview(dict(type='export-scene')); self.assertEqual(exported[0],200,exported)
            document=exported[1]['preview']['document']
            preview=self.preview(dict(type='import-scene',document=document)); self.assertEqual(preview[0],200,preview)
            self.assertTrue(preview[1]['preview']['requiresManualWearAcknowledgement'])
            snapshot=self.snapshot(training=True)
            blocked,_=self.command('import-scene',document=document); self.assertEqual(blocked[0],409,blocked)
            self.assertEqual(snapshot,self.snapshot(training=True))
            prepared=copy.deepcopy(self.prepare_body); scene=saved['battle']['scene']; prepared.update(id='pending-prepare',expectedVersion=scene['version'],actors=self.scene_configs(scene))
            failed=self.gm_client.request(self.path,'POST',prepared,csrf=self.gm_identity['csrf']); self.assertEqual(failed[0],409,failed)
            self.assertEqual(snapshot,self.snapshot(training=True))
            imported,_=self.command('import-scene',document=document,acknowledgeManualWear=True)
            self.assertEqual(imported[0],200,imported)
            ack=next(e for e in target.request(self.path)[1]['battle']['log'] if e['kind']=='manual-armor-ack')
            self.assertEqual(ack['armorWearPending']['torso']['amount'],1)
            foreign=next(e for e in shooter.request(self.path)[1]['battle']['log'] if e['kind']=='manual-armor-ack')
            self.assertNotIn('armorWearPending',foreign)
            self.assertEqual(snapshot['characters'],self.snapshot()['characters'])

    def test_export_import_geometry_only_live_identity_resources_and_old_authority_rejected(self):
        self.party(count=1,hidden=False); client,user,cid=self.players[0]
        added,_=self.command('add',templateId='netrunner',x=6,y=4,hidden=True)
        self.assertEqual(added[0],200,added)
        before=self.snapshot(training=True)
        exported=self.preview(dict(type='export-scene')); self.assertEqual(exported[0],200,exported)
        document=exported[1]['preview']['document']
        self.assertEqual(document['format'],'nightcity-scene'); self.assertEqual(len(document['characters']),2)
        for forbidden in ('wounds','ammo','version','sheetVersion','ownerId','stats','log','_undo','appliedCommandIds'):
            self.assertNotIn('"'+forbidden+'"',json.dumps(document))
        self.assertEqual(before,self.snapshot(training=True))
        self.assertEqual(self.preview(dict(type='export-scene'),client,user)[0],403)
        forged=copy.deepcopy(document); forged['version']=0
        self.assertEqual(self.preview(dict(type='import-scene',document=forged))[0],400)
        foreign=copy.deepcopy(document); foreign['characters'].append(dict(characterKey='unmapped-uuid',name='Unmapped reference',x=1,y=1,team='crew',hidden=False,sprite=0))
        preview=self.preview(dict(type='import-scene',document=foreign)); self.assertEqual(preview[0],200,preview)
        self.assertTrue(any('Unmapped reference' in w for w in preview[1]['preview']['warnings']))
        original_scene=self.gm_client.request(self.path)[1]['battle']['scene']
        imported,request=self.command('import-scene',document=foreign)
        self.assertEqual(imported[0],200,imported)
        current=imported[1]['battle']; self.assertEqual(current['version'],original_scene['version']+1); self.assertEqual(current['id'],original_scene['id'])
        old_pcs=[a for a in original_scene['actors'] if battle.sheet_actor(a)]; new_pcs=[a for a in current['scene']['actors'] if battle.sheet_actor(a)]
        self.assertEqual(old_pcs,new_pcs)
        self.assertEqual(before['characters'],self.snapshot()['characters']); self.assertEqual(before['revisions'],self.snapshot()['revisions'])
        saved=self.snapshot(training=True)
        duplicate=self.gm_client.request(self.path+'/commands','POST',request,csrf=self.gm_identity['csrf']); self.assertTrue(duplicate[1]['duplicate'])
        self.assertEqual(saved,self.snapshot(training=True))
        stale=dict(request,id='stale-import')
        self.assertEqual(self.gm_client.request(self.path+'/commands','POST',stale,csrf=self.gm_identity['csrf'])[0],409)
        undo,_=self.command('undo'); self.assertEqual(undo[0],200,undo)
        self.assertEqual(undo[1]['battle']['scene']['actors'],original_scene['actors'])
        # Accepted original schema1 is a blueprint, never authority from a file.
        legacy,_=battle.training_scene(dict(gm_id=self.gm_identity['id']),1,lambda:.5)
        legacy.update(version=99999,phase='combat',order=['forged'],index=0,appliedCommandIds=['fake-command'],log=[])
        legacy['actors'][0].update(wounds=999,ownerId=999,characterId=cid,sheetVersion=999)
        legacy['actors'][0]['weapon']['ammo']=999
        result=self.preview(dict(type='import-scene',document=legacy)); self.assertEqual(result[0],200,result)
        self.assertEqual(result[1]['preview']['summary']['npcCount'],4)
        committed,_=self.command('import-scene',document=legacy); self.assertEqual(committed[0],200,committed)
        npcs=[a for a in committed[1]['battle']['scene']['actors'] if not battle.sheet_actor(a)]
        self.assertEqual(len(npcs),4); self.assertTrue(all(a['characterId'] is None and a['wounds']==0 for a in npcs))
        self.assertEqual(next(a for a in npcs if a['origin']['templateId']=='solo-pistol')['weapon']['ammo'],8)
        self.assertEqual(before['characters'],self.snapshot()['characters'])
        self.assertNotEqual(committed[1]['battle']['version'],99999)

    def test_stale_armor_edit_blocks_shot_and_undo_without_field_overwrite(self):
        with patch.object(battle.secrets,'SystemRandom',return_value=SimpleNamespace(random=lambda:.5)):
            self.party(count=1,hidden=False); client,user,cid=self.players[0]
            config=copy.deepcopy(self.prepare_body); config['actors'][1]['armor']['torso']=8
            self.reprepare(config); self.begin()
            shot,_=self.command('shoot',actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso')
            self.assertEqual(shot[0],200,shot)
            self.update_sheet(self.gm_client,self.gm_identity,self.guard,
                lambda d:next(i for i in d['items'] if i['id']=='vest')['armor']['coverage'].update(torso=20))
            before=self.snapshot(training=True)
            for kind,fields in [('undo',{}),('shoot',dict(actorId='character-'+str(cid),targetId='character-'+str(self.guard),location='torso'))]:
                result,_=self.command(kind,**fields); self.assertEqual(result[0],409,result)
            self.assertEqual(before,self.snapshot(training=True))
            self.assertEqual(next(i for i in self.gm_client.request(f'/api/characters/{self.guard}')[1]['data']['items'] if i['id']=='vest')['armor']['coverage']['torso'],20)

    def test_npc_import_malformed_payloads_and_combat_replacement_rejected(self):
        self.party(count=1,hidden=False); client,user,cid=self.players[0]
        before=self.snapshot(training=True)
        for fields in [dict(templateId={'bad':1}),dict(templateId='unknown'),dict(templateId='netrunner',x=1),
                       dict(templateId='guard-rifle',hidden='yes'),dict(templateId='guard-rifle',config={}),
                       dict(templateId='guard-rifle',x=1,y=1)]:
            result=self.preview(dict(type='add',**fields)); self.assertIn(result[0],(400,409),result)
        self.assertEqual(before,self.snapshot(training=True))
        exported=self.preview(dict(type='export-scene'))[1]['preview']['document']
        invalid=copy.deepcopy(exported); invalid['tiles'][0][0]=dict(type='door')
        self.assertEqual(self.preview(dict(type='import-scene',document=invalid))[0],400)
        invalid=copy.deepcopy(exported); invalid['characters'][0]['wounds']=0
        self.assertEqual(self.preview(dict(type='import-scene',document=invalid))[0],400)
        invalid=copy.deepcopy(exported); invalid['npcs']=[dict(templateId='guard-rifle',name='Forged',x=1,y=2,team='hostile',hidden=True,sprite=2,ownerId=user['id'])]
        self.assertEqual(self.preview(dict(type='import-scene',document=invalid))[0],400)
        self.assertEqual(self.preview(dict(type='import-scene',document=exported),client,user)[0],403)
        self.assertEqual(before,self.snapshot(training=True))
        self.begin(); before=self.snapshot(training=True)
        self.assertEqual(self.preview(dict(type='import-scene',document=exported))[0],409)
        self.assertEqual(self.command('import-scene',document=exported)[0][0],409)
        self.assertEqual(before,self.snapshot(training=True))

    def test_narrow_mapping_never_guesses_layer_or_manual_override(self):
        self.party(count=1,hidden=False)
        data=self.gm_client.request(f'/api/characters/{self.guard}')[1]['data']
        armor={z:0 for z in battle.ZONES}; armor['torso']=8
        self.assertEqual(battle.armor_mapping(data,armor)['torso']['mode'],'item')
        armor['torso']=9
        self.assertEqual(battle.armor_mapping(data,armor)['torso']['mode'],'manual-review')
        data['armorMode']='manual'; data['armor']['torso']=9
        self.assertEqual(battle.armor_mapping(data,armor)['torso']['mode'],'manual')
        armor['torso']=8
        self.assertEqual(battle.armor_mapping(data,armor)['torso']['mode'],'manual-review')
        self.assertEqual(data['armorMode'],'manual')
        data['armorMode']='equipment'; item=copy.deepcopy(next(i for i in data['items'] if i['id']=='vest'))
        item['id']='layer-2'; data['items'].append(item)
        self.assertEqual(battle.armor_mapping(data,armor)['torso']['mode'],'manual-review')
        item['quantity']=0
        self.assertEqual(battle.armor_mapping(data,armor)['torso']['mode'],'item')

    def test_false_rule_survives_npc_add_import_and_omitted_prepare_setting(self):
        self.party(count=1,hidden=False)
        result,_=self.reprepare(settings=dict(stagedPenetration=False))
        self.assertFalse(result['battle']['scene']['settings']['stagedPenetration'])
        added,_=self.command('add',templateId='guard-rifle',x=6,y=4)
        self.assertEqual(added[0],200,added)
        self.assertFalse(added[1]['battle']['scene']['settings']['stagedPenetration'])
        document=self.preview(dict(type='export-scene'))[1]['preview']['document']
        self.assertFalse(document['settings']['stagedPenetration'])
        preview=self.preview(dict(type='import-scene',document=document))
        self.assertTrue(any('выключен' in w for w in preview[1]['preview']['warnings']))
        imported,_=self.command('import-scene',document=document)
        self.assertEqual(imported[0],200,imported)
        self.assertFalse(imported[1]['battle']['scene']['settings']['stagedPenetration'])
        result,_=self.reprepare(actors=self.scene_configs(imported[1]['battle']['scene']))
        self.assertFalse(result['battle']['scene']['settings']['stagedPenetration'])

    def test_prepare_preserves_pc_death_stun_destroyed_limb_and_uncapped_wounds(self):
        self.party(count=2,hidden=False)
        # Synthetic server-owned aftermath fixture, including combat wounds over
        # the personal sheet's 40-point cap. No client snapshot can set these.
        with self.database() as db:
            raw=json.loads(db.execute('SELECT data FROM shared_battles').fetchone()[0])
            raw['phase']='ended'
            raw['actors'][0].update(status='dead',destroyed=['rightArm'],stabilized=True,wounds=53,facing=-1,heading=180)
            raw['actors'][1].update(status='stunned',destroyed=['leftLeg'],stabilized=False,wounds=18)
            db.execute('UPDATE shared_battles SET data=?',(json.dumps(raw),))
        before=self.snapshot()
        result,_=self.reprepare(actors=self.scene_configs(raw),name='Only renamed')
        for old,new in zip(raw['actors'],result['battle']['scene']['actors']):
            for key in ('status','destroyed','stabilized','wounds','facing','heading'):
                self.assertEqual(new[key],old[key],key)
        self.assertEqual(before['characters'],self.snapshot()['characters'])
        # A deliberate new sheet revision refreshes wounds, never implicitly
        # revives the same actor or clears lost-limb state.
        client,user,cid=self.players[0]
        edited=self.update_sheet(client,user,cid,lambda d:d.update(wounds=6))
        configs=self.scene_configs(result['battle']['scene']); configs[0]['version']=edited['version']
        result,_=self.reprepare(actors=configs)
        actor=result['battle']['scene']['actors'][0]
        self.assertEqual((actor['wounds'],actor['status'],actor['destroyed'],actor['stabilized']),(6,'dead',['rightArm'],True))

    def test_prepare_preserves_dead_pc_and_npc_sharing_living_actor_cell(self):
        self.party(count=2,hidden=False)
        self.assertEqual(self.command('add',templateId='guard-rifle',x=6,y=4)[0][0],200)
        with self.database() as db:
            raw=json.loads(db.execute('SELECT data FROM shared_battles').fetchone()[0]); raw['phase']='ended'
            raw['actors'][0].update(status='dead',wounds=53)
            raw['actors'][1].update(x=raw['actors'][0]['x'],y=raw['actors'][0]['y'])
            npc=next(a for a in raw['actors'] if a.get('origin',{}).get('kind')=='npc')
            npc.update(status='dead',x=raw['actors'][0]['x'],y=raw['actors'][0]['y'])
            db.execute('UPDATE shared_battles SET data=?',(json.dumps(raw),))
        for configs in (self.scene_configs(raw),list(reversed(self.scene_configs(raw)))):
            result,_=self.reprepare(actors=configs)
            scene=result['battle']['scene']; dead=next(a for a in scene['actors'] if a['id']==raw['actors'][0]['id'])
            living=next(a for a in scene['actors'] if a['id']==raw['actors'][1]['id'])
            corpse=next(a for a in scene['actors'] if a['id']==npc['id'])
            self.assertEqual((dead['x'],dead['y']),(living['x'],living['y']))
            self.assertEqual((corpse['x'],corpse['y']),(living['x'],living['y']))
            self.assertEqual((dead['status'],corpse['status'],living['status']),('dead','dead','active'))


if __name__=='__main__': unittest.main()
