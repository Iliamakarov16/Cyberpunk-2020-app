CREATE TABLE `character_sharing` (
	`character_id` integer NOT NULL,
	`campaign_id` integer NOT NULL,
	`mode` text DEFAULT 'private' NOT NULL,
	`recipients` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated` integer NOT NULL,
	PRIMARY KEY(`character_id`, `campaign_id`),
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`character_id`) REFERENCES `campaign_characters`(`campaign_id`,`character_id`) ON UPDATE no action ON DELETE cascade
);
