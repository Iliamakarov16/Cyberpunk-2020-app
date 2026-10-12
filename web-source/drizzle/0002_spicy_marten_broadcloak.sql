CREATE TABLE `campaign_characters` (
	`campaign_id` integer NOT NULL,
	`character_id` integer NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `character_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_characters_character` ON `campaign_characters` (`character_id`);--> statement-breakpoint
CREATE TABLE `campaign_members` (
	`campaign_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `user_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_members_user` ON `campaign_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gm_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`invite_code` text NOT NULL,
	`gm_notes` text DEFAULT '' NOT NULL,
	`ledger` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated` integer NOT NULL,
	`transfer_to` integer,
	FOREIGN KEY (`gm_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_invite_code_unique` ON `campaigns` (`invite_code`);--> statement-breakpoint
CREATE INDEX `idx_campaigns_gm` ON `campaigns` (`gm_id`);--> statement-breakpoint
CREATE TABLE `user_modes` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
