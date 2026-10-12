"""Multi-effect action persistence: one narrow CAS per sheet, no partial commits."""
import copy
import json
import sqlite3
import unittest
import test_tactical_battle_http as tactical
import shared_battle as battle

class ActionResources(unittest.TestCase):
    setUp=tactical.TacticalHTTP.setUp
    start=tactical.TacticalHTTP.start
    gm=tactical.TacticalHTTP.gm
    player=tactical.TacticalHTTP.player
    campaign=tactical.TacticalHTTP.campaign
    sheet=tactical.TacticalHTTP.sheet
    party=tactical.TacticalHTTP.party
    database=tactical.TacticalHTTP.database

    def transaction(self):
        db=self.database();db.row_factory=sqlite3.Row;db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT * FROM shared_battles').fetchone()
        scene=json.loads(row['data']);campaign=db.execute('SELECT * FROM campaigns WHERE id=?',(row['campaign_id'],)).fetchone()
        return db,campaign,scene

    def test_many_bullets_and_hits_one_revision_narrow_fields_and_undo_snapshot(self):
        self.party(count=1,hidden=False)
        db,campaign,scene=self.transaction()
        try:
            shooter,target=scene['actors'];before=[dict(r) for r in db.execute('SELECT * FROM characters ORDER BY id')]
            # Use the actual equipped vest mapping, sequential hits wear8->7->6.
            target['armor']['torso']=8;target['armorPersistence']=battle.armor_mapping(json.loads(before[1]['data']),target['armor'])
            target['armor']['torso']=6;target['wounds']=5
            hits=[dict(location='torso',sp=8,penetration=4,damage=2),dict(location='torso',sp=7,penetration=5,damage=3)]
            saved=battle.capture_action_sheets(db,campaign,scene,[shooter['id'],target['id'],target['id']]);self.assertEqual(len(saved),2)
            shooter['loadout'],_=battle.battle_loadout.consume(shooter['loadout'],shooter['weapon']['id'],3);battle.sync_weapon(shooter)
            changed=battle.persist_combat_effects(db,campaign,scene,'multi-once',1,42,
                ammo_changes=[(shooter['id'],'ammo',-2),(shooter['id'],'ammo',-1)],impacts=[(target['id'],h) for h in hits])
            self.assertEqual(set(changed),{shooter['id'],target['id']})
            after=[dict(r) for r in db.execute('SELECT * FROM characters ORDER BY id')]
            for i,(a,b) in enumerate(zip(after,before)):
                self.assertEqual(a['version'],b['version']+1)
                expected=json.loads(b['data'])
                if i==0:next(x for x in expected['items'] if x['id']=='ammo')['quantity']-=3
                else:
                    expected['wounds']=5;next(x for x in expected['items'] if x['id']=='vest')['armor']['coverage']['torso']=6
                self.assertEqual(json.loads(a['data']),expected)
            self.assertEqual([(h['armorWear']['before'],h['armorWear']['after']) for h in hits],[(8,7),(7,6)])
            self.assertEqual(db.execute("SELECT count(*) FROM revisions WHERE reason LIKE '%multi-once%'").fetchone()[0],2)
        finally:db.rollback();db.close()

    def test_stale_target_and_bad_second_pool_leave_all_database_rows_unchanged(self):
        self.party(count=1,hidden=False)
        for stale in (True,False):
            db,campaign,scene=self.transaction()
            try:
                shooter,target=scene['actors'];before=[tuple(r) for r in db.execute('SELECT * FROM characters ORDER BY id')]
                if stale:target['sheetVersion']-=1
                with self.assertRaises(battle.BattleError):
                    battle.persist_combat_effects(db,campaign,scene,'bad',1,42,
                        ammo_changes=[(shooter['id'],'ammo',-2)]+([] if stale else [(shooter['id'],'missing',-1)]),
                        impacts=[(target['id'],dict(damage=3))])
                self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM characters ORDER BY id')],before)
            finally:db.rollback();db.close()

    def test_action_transaction_rollback_after_successful_resource_writes(self):
        self.party(count=1,hidden=False)
        with self.database() as check:before=check.execute('SELECT * FROM characters ORDER BY id').fetchall()
        db,campaign,scene=self.transaction();shooter,target=scene['actors']
        shooter['loadout'],_=battle.battle_loadout.consume(shooter['loadout'],shooter['weapon']['id'],3);battle.sync_weapon(shooter)
        battle.persist_combat_effects(db,campaign,scene,'rollback',1,42,
            ammo_changes=[(shooter['id'],'ammo',-3)],impacts=[(target['id'],dict(damage=9))])
        db.rollback();db.close()
        with self.database() as check:self.assertEqual(check.execute('SELECT * FROM characters ORDER BY id').fetchall(),before)
