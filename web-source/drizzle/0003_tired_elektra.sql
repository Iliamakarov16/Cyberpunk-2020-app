CREATE TABLE `campaign_portability` (
	`campaign_id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`gm_key` text NOT NULL,
	`ancestors` text DEFAULT '[]' NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_portability_uuid_unique` ON `campaign_portability` (`uuid`);--> statement-breakpoint
CREATE TABLE `campaign_portable_owners` (
	`campaign_id` integer NOT NULL,
	`owner_key` text NOT NULL,
	`label` text NOT NULL,
	`user_id` integer,
	`claim_hash` text,
	PRIMARY KEY(`campaign_id`, `owner_key`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `campaign_transfer_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` integer NOT NULL,
	`created` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_backups_campaign` ON `campaign_transfer_backups` (`campaign_id`,`created`);--> statement-breakpoint
CREATE TABLE `campaign_transfer_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`passed` integer NOT NULL,
	CONSTRAINT "campaign_transfer_guard_passed" CHECK("campaign_transfer_guards"."passed"=1)
);
--> statement-breakpoint
CREATE TABLE `campaign_transfer_previews` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`campaign_uuid` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`target_id` integer,
	`destination_fingerprint` text,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `campaign_workspaces` (
	`campaign_id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated` integer NOT NULL,
	`recent_requests` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `character_portability` (
	`character_id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`owner_key` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_portability_uuid_unique` ON `character_portability` (`uuid`);--> statement-breakpoint
CREATE TABLE `imported_revision_labels` (
	`revision_id` integer PRIMARY KEY NOT NULL,
	`actor_key` text NOT NULL,
	`actor_label` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_portability` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_portability_uuid_unique` ON `user_portability` (`uuid`);