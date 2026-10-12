import { sqliteTable, integer, text, index, primaryKey, foreignKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const users = sqliteTable('users', {
 id: integer('id').primaryKey({autoIncrement:true}), username: text('username').notNull().unique(),
 password: text('password').notNull(), role: text('role').notNull(),
});
export const meta = sqliteTable('meta', { key: text('key').primaryKey(), value: text('value').notNull() });
export const sessions = sqliteTable('sessions', {
 token: text('token').primaryKey(), userId: integer('user_id').notNull().references(()=>users.id),
 csrf: text('csrf').notNull(), expires: integer('expires').notNull(),
});
export const characters = sqliteTable('characters', {
 id: integer('id').primaryKey({autoIncrement:true}), ownerId: integer('owner_id').notNull().references(()=>users.id),
 data: text('data').notNull(), version: integer('version').notNull().default(1), updated: integer('updated').notNull(),
},t=>[index('idx_characters_owner').on(t.ownerId)]);
export const revisions = sqliteTable('revisions', {
 id: integer('id').primaryKey({autoIncrement:true}), characterId: integer('character_id').notNull().references(()=>characters.id),
 actorId: integer('actor_id').notNull().references(()=>users.id), data: text('data').notNull(),
 version: integer('version').notNull(), reason: text('reason').notNull(), created: integer('created').notNull(),
},t=>[index('idx_revisions_character').on(t.characterId,t.id)]);
export const attempts = sqliteTable('attempts', {
 key: text('key').primaryKey(), count: integer('count').notNull(), started: integer('started').notNull(),
});
export const playerSettings = sqliteTable('player_settings', {
 userId: integer('user_id').primaryKey().references(()=>users.id,{onDelete:'cascade'}),
 data: text('data').notNull(), updated: integer('updated').notNull(),
});
export const userModes = sqliteTable('user_modes', {
 userId: integer('user_id').primaryKey().references(()=>users.id,{onDelete:'cascade'}), mode:text('mode').notNull(),
});
export const campaigns = sqliteTable('campaigns', {
 id:integer('id').primaryKey({autoIncrement:true}), gmId:integer('gm_id').notNull().references(()=>users.id),
 name:text('name').notNull(), description:text('description').notNull().default(''), inviteCode:text('invite_code').notNull().unique(),
 gmNotes:text('gm_notes').notNull().default(''), ledger:text('ledger').notNull().default(''),
 version:integer('version').notNull().default(1), updated:integer('updated').notNull(), transferTo:integer('transfer_to').references(()=>users.id),
},t=>[index('idx_campaigns_gm').on(t.gmId)]);
export const campaignMembers = sqliteTable('campaign_members', {
 campaignId:integer('campaign_id').notNull().references(()=>campaigns.id,{onDelete:'cascade'}),
 userId:integer('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
},t=>[primaryKey({columns:[t.campaignId,t.userId]}),index('idx_campaign_members_user').on(t.userId)]);
export const campaignCharacters = sqliteTable('campaign_characters', {
 campaignId:integer('campaign_id').notNull().references(()=>campaigns.id,{onDelete:'cascade'}),
 characterId:integer('character_id').notNull().references(()=>characters.id,{onDelete:'cascade'}), status:text('status').notNull(), created:integer('created').notNull(),
},t=>[primaryKey({columns:[t.campaignId,t.characterId]}),index('idx_campaign_characters_character').on(t.characterId)]);
export const campaignWorkspaces=sqliteTable('campaign_workspaces',{
 campaignId:integer('campaign_id').primaryKey().references(()=>campaigns.id,{onDelete:'cascade'}),data:text('data').notNull(),
 version:integer('version').notNull().default(1),updated:integer('updated').notNull(),recentRequests:text('recent_requests').notNull().default('[]'),
});
export const campaignPortability=sqliteTable('campaign_portability',{
 campaignId:integer('campaign_id').primaryKey().references(()=>campaigns.id,{onDelete:'cascade'}),uuid:text('uuid').notNull().unique(),gmKey:text('gm_key').notNull(),ancestors:text('ancestors').notNull().default('[]'),updated:integer('updated').notNull(),
});
export const characterPortability=sqliteTable('character_portability',{
 characterId:integer('character_id').primaryKey().references(()=>characters.id,{onDelete:'cascade'}),uuid:text('uuid').notNull().unique(),ownerKey:text('owner_key').notNull(),
});
export const userPortability=sqliteTable('user_portability',{
 userId:integer('user_id').primaryKey().references(()=>users.id,{onDelete:'cascade'}),uuid:text('uuid').notNull().unique(),
});
export const campaignPortableOwners=sqliteTable('campaign_portable_owners',{
 campaignId:integer('campaign_id').notNull().references(()=>campaigns.id,{onDelete:'cascade'}),ownerKey:text('owner_key').notNull(),label:text('label').notNull(),userId:integer('user_id').references(()=>users.id,{onDelete:'set null'}),claimHash:text('claim_hash'),member:integer('member').notNull().default(0),
},t=>[primaryKey({columns:[t.campaignId,t.ownerKey]})]);
export const campaignTransferPreviews=sqliteTable('campaign_transfer_previews',{
 tokenHash:text('token_hash').primaryKey(),userId:integer('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),campaignUuid:text('campaign_uuid').notNull(),sourceFingerprint:text('source_fingerprint').notNull(),targetId:integer('target_id').references(()=>campaigns.id,{onDelete:'cascade'}),destinationFingerprint:text('destination_fingerprint'),expires:integer('expires').notNull(),
});
export const campaignTransferBackups=sqliteTable('campaign_transfer_backups',{
 id:text('id').primaryKey(),campaignId:integer('campaign_id').notNull().references(()=>campaigns.id,{onDelete:'cascade'}),created:integer('created').notNull(),data:text('data').notNull(),
},t=>[index('idx_transfer_backups_campaign').on(t.campaignId,t.created)]);
export const campaignTransferGuards=sqliteTable('campaign_transfer_guards',{
 id:text('id').primaryKey(),passed:integer('passed').notNull(),
},t=>[check('campaign_transfer_guard_passed',sql`${t.passed}=1`)]);
export const importedRevisionLabels=sqliteTable('imported_revision_labels',{
 revisionId:integer('revision_id').primaryKey().references(()=>revisions.id,{onDelete:'cascade'}),actorKey:text('actor_key').notNull(),actorLabel:text('actor_label').notNull(),
});

export const characterSharing=sqliteTable('character_sharing',{
 characterId:integer('character_id').notNull().references(()=>characters.id,{onDelete:'cascade'}),
 campaignId:integer('campaign_id').notNull().references(()=>campaigns.id,{onDelete:'cascade'}),
 mode:text('mode').notNull().default('private'),recipients:text('recipients').notNull().default('[]'),
 version:integer('version').notNull().default(1),updated:integer('updated').notNull(),
},t=>[primaryKey({columns:[t.characterId,t.campaignId]}),foreignKey({columns:[t.campaignId,t.characterId],foreignColumns:[campaignCharacters.campaignId,campaignCharacters.characterId]}).onDelete('cascade')]);
