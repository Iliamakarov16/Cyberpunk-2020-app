"""Optional training namespace remains safe across full-host backup restore."""
import sqlite3
import unittest

import test_mobile_host as fixtures
import test_session_readiness_restore as readiness
import test_training_battle as training


class TrainingRestore(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    sheet = training.TrainingBattleHTTP.sheet
    party = training.TrainingBattleHTTP.party
    command = training.TrainingBattleHTTP.command
    database = training.TrainingBattleHTTP.database
    training_setup = training.TrainingBattleHTTP.training_setup
    enter_training = training.TrainingBattleHTTP.enter_training
    snapshot = readiness.RestoreReadiness.snapshot
    stopped_original = readiness.RestoreReadiness.stopped_original
    host_files = readiness.RestoreReadiness.host_files
    reject_unchanged = readiness.RestoreReadiness.reject_unchanged

    def test_malformed_training_columns_and_keys_reject_before_host_replacement(self):
        before = self.stopped_original()
        for table in ('training_battles', 'training_battle_commands'):
            for defect in ('columns', 'key'):
                with self.subTest(table=table, defect=defect):
                    candidate = self.snapshot(table + '-' + defect + '.sqlite3')
                    with sqlite3.connect(candidate) as db:
                        if defect == 'key':
                            db.execute('CREATE TABLE replacement AS SELECT * FROM ' + table)
                        db.execute('DROP TABLE ' + table)
                        if defect == 'key':
                            db.execute('ALTER TABLE replacement RENAME TO ' + table)
                        else:
                            db.execute('CREATE TABLE ' + table + ' (id INTEGER PRIMARY KEY)')
                    self.reject_unchanged(candidate, before)

    def test_older_backup_without_training_tables_restores_real_data_and_adds_empty_training(self):
        self.party(count=1, hidden=False)
        real = self.gm_client.request(self.path)[1]
        candidate = self.snapshot('pre-training.sqlite3')
        with sqlite3.connect(candidate) as db:
            db.execute('DROP TABLE training_battle_commands')
            db.execute('DROP TABLE training_battles')
        self.stopped_original()
        fixtures.mobile_host.restore(self.data, candidate)
        self.start(username='', password='')
        self.assertEqual(self.gm_client.request(self.path)[1], real)
        view = self.gm_client.request(self.path + '/training')
        self.assertEqual(view[0], 200, view)
        self.assertIsNone(view[1]['battle'])
        with self.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM training_battles').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM training_battle_commands').fetchone()[0], 0)

    def test_current_backup_preserves_training_scene_and_dedup_receipts_separately(self):
        self.party(count=1, hidden=False)
        real_path = self.path
        real = self.gm_client.request(real_path)[1]
        self.enter_training()
        state = self.gm_client.request(self.path)[1]['battle']
        actor = state['scene']['currentActorId']
        target = next(a['id'] for a in state['scene']['actors'] if a['id'] != actor)
        declared, declaration = self.command('declare-shot', actorId=actor, targetId=target, location='torso')
        self.assertEqual(declared[0], 200, declared)
        confirmed, confirmation = self.command('confirm', declarationId=declaration['id'])
        self.assertEqual(confirmed[0], 200, confirmed)
        saved = self.gm_client.request(self.path)[1]
        candidate = self.snapshot('training-progress.sqlite3')
        self.training_setup('training-reset', 'reset-after-backup')
        self.stopped_original()
        fixtures.mobile_host.restore(self.data, candidate)
        self.start(username='', password='')
        self.assertEqual(self.gm_client.request(self.path)[1], saved)
        duplicate = self.gm_client.request(self.path + '/commands', 'POST', confirmation, csrf=self.gm_identity['csrf'])
        self.assertEqual(duplicate[0], 200, duplicate)
        self.assertTrue(duplicate[1]['duplicate'])
        self.assertEqual(duplicate[1]['receipt'], confirmed[1]['receipt'])
        self.assertEqual(self.gm_client.request(real_path)[1], real)


if __name__ == '__main__':
    unittest.main()
