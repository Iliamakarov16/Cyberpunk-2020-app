CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`invite_hash` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `campaigns_owner_idx` ON `campaigns` (`owner`);--> statement-breakpoint
CREATE TABLE `markers` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'location' NOT NULL,
	`color` text DEFAULT '#f0cd66' NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`map` text DEFAULT 'synthesis' NOT NULL,
	`place_id` text,
	`revealed` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`campaign`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `markers_campaign_idx` ON `markers` (`campaign`);