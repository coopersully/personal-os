-- Task organization and Finance published parallel migrations with the same
-- Drizzle timestamps at 0055 and again at 0059. Re-run the unchanged, idempotent
-- Task transition after the canonical Finance chain so either application order
-- converges without rewriting the published migrations.
DO $reconcile$
DECLARE
	task_rows bigint;
	reminders_bytes bigint;
BEGIN
	IF to_regclass('public.task_lists') IS NOT NULL THEN
		RETURN;
	END IF;

	LOCK TABLE "reminders" IN SHARE ROW EXCLUSIVE MODE;
	SELECT count(*), pg_total_relation_size('reminders')
	INTO task_rows, reminders_bytes
	FROM reminders
	WHERE kind = 'task';
	IF task_rows > 50000 OR reminders_bytes > 104857600 THEN
		RAISE EXCEPTION
			'Task organization migration stopped: % Task rows or % reminder bytes exceed limits (50000 rows, 104857600 bytes)',
			task_rows,
			reminders_bytes;
	END IF;

	CREATE TABLE "task_lists" (
		"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
		"user_id" uuid NOT NULL,
		"kind" text DEFAULT 'standard' NOT NULL,
		"name" text NOT NULL,
		"normalized_name" text NOT NULL,
		"description" text,
		"color" text,
		"availability" text DEFAULT 'active' NOT NULL,
		"revision" integer DEFAULT 1 NOT NULL,
		"create_idempotency_key" uuid,
		"create_idempotency_fingerprint" text,
		"archived_at" timestamptz,
		"deleted_at" timestamptz,
		"created_at" timestamptz DEFAULT now() NOT NULL,
		"updated_at" timestamptz DEFAULT now() NOT NULL,
		CONSTRAINT "task_lists_kind_check" CHECK ("kind" IN ('inbox', 'standard')),
		CONSTRAINT "task_lists_availability_check" CHECK (
			("availability" = 'active' AND "archived_at" IS NULL)
			OR ("availability" = 'archived' AND "archived_at" IS NOT NULL)
		),
		CONSTRAINT "task_lists_revision_check" CHECK ("revision" > 0),
		CONSTRAINT "task_lists_create_idempotency_check" CHECK (
			("create_idempotency_key" IS NULL AND "create_idempotency_fingerprint" IS NULL)
			OR ("create_idempotency_key" IS NOT NULL AND "create_idempotency_fingerprint" IS NOT NULL
				AND "create_idempotency_fingerprint" ~ '^[0-9a-f]{64}$')
		)
	);

	CREATE TABLE "task_projects" (
		"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
		"user_id" uuid NOT NULL,
		"list_id" uuid NOT NULL,
		"name" text NOT NULL,
		"normalized_name" text NOT NULL,
		"notes" text,
		"why" text,
		"target_date" date,
		"lifecycle" text DEFAULT 'open' NOT NULL,
		"availability" text DEFAULT 'active' NOT NULL,
		"revision" integer DEFAULT 1 NOT NULL,
		"create_idempotency_key" uuid,
		"create_idempotency_fingerprint" text,
		"completed_at" timestamptz,
		"cancelled_at" timestamptz,
		"archived_at" timestamptz,
		"deleted_at" timestamptz,
		"created_at" timestamptz DEFAULT now() NOT NULL,
		"updated_at" timestamptz DEFAULT now() NOT NULL,
		CONSTRAINT "task_projects_lifecycle_check" CHECK ("lifecycle" IN ('open', 'completed', 'cancelled')),
		CONSTRAINT "task_projects_availability_check" CHECK (
			("availability" = 'active' AND "archived_at" IS NULL)
			OR ("availability" = 'archived' AND "archived_at" IS NOT NULL)
		),
		CONSTRAINT "task_projects_lifecycle_timestamps_check" CHECK (
			("lifecycle" = 'open' AND "completed_at" IS NULL AND "cancelled_at" IS NULL)
			OR ("lifecycle" = 'completed' AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL)
			OR ("lifecycle" = 'cancelled' AND "completed_at" IS NULL AND "cancelled_at" IS NOT NULL)
		),
		CONSTRAINT "task_projects_revision_check" CHECK ("revision" > 0),
		CONSTRAINT "task_projects_create_idempotency_check" CHECK (
			("create_idempotency_key" IS NULL AND "create_idempotency_fingerprint" IS NULL)
			OR ("create_idempotency_key" IS NOT NULL AND "create_idempotency_fingerprint" IS NOT NULL
				AND "create_idempotency_fingerprint" ~ '^[0-9a-f]{64}$')
		)
	);

	ALTER TABLE "reminders"
		ADD COLUMN "task_list_id" uuid,
		ADD COLUMN "task_project_id" uuid,
		ADD COLUMN "task_why" text,
		ADD COLUMN "task_lifecycle" text,
		ADD COLUMN "task_revision" integer,
		ADD COLUMN "task_cancelled_at" timestamptz,
		ADD COLUMN "task_create_idempotency_key" uuid,
		ADD COLUMN "task_create_idempotency_fingerprint" text;
	ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

	CREATE UNIQUE INDEX "task_lists_inbox_per_user_idx" ON "task_lists" ("user_id") WHERE "kind" = 'inbox';
	CREATE UNIQUE INDEX "task_lists_active_name_idx" ON "task_lists" ("user_id", "normalized_name") WHERE "deleted_at" IS NULL;
	CREATE UNIQUE INDEX "task_lists_ownership_idx" ON "task_lists" ("id", "user_id");
	CREATE UNIQUE INDEX "task_lists_create_idempotency_idx" ON "task_lists" ("user_id", "create_idempotency_key") WHERE "create_idempotency_key" IS NOT NULL;
	CREATE INDEX "task_lists_user_availability_idx" ON "task_lists" ("user_id", "availability");
	CREATE UNIQUE INDEX "task_projects_active_name_idx" ON "task_projects" ("user_id", "list_id", "normalized_name") WHERE "deleted_at" IS NULL;
	CREATE UNIQUE INDEX "task_projects_location_idx" ON "task_projects" ("id", "user_id", "list_id");
	CREATE UNIQUE INDEX "task_projects_create_idempotency_idx" ON "task_projects" ("user_id", "create_idempotency_key") WHERE "create_idempotency_key" IS NOT NULL;
	CREATE INDEX "task_projects_list_availability_idx" ON "task_projects" ("user_id", "list_id", "availability");
	ALTER TABLE "task_projects" ADD CONSTRAINT "task_projects_list_ownership_fk"
		FOREIGN KEY ("list_id", "user_id") REFERENCES "public"."task_lists"("id", "user_id") ON DELETE no action ON UPDATE no action;

	EXECUTE $sql$
		CREATE FUNCTION "create_task_inbox_for_user"() RETURNS trigger AS $function$
		BEGIN
			INSERT INTO "task_lists" ("user_id", "kind", "name", "normalized_name")
			VALUES (NEW."id", 'inbox', 'Inbox', 'inbox');
			RETURN NEW;
		END
		$function$ LANGUAGE plpgsql
	$sql$;
	CREATE TRIGGER "users_create_task_inbox" AFTER INSERT ON "users"
		FOR EACH ROW EXECUTE FUNCTION "create_task_inbox_for_user"();
	INSERT INTO "task_lists" ("user_id", "kind", "name", "normalized_name")
	SELECT "id", 'inbox', 'Inbox', 'inbox' FROM "users";
	UPDATE "reminders" AS "reminder"
	SET
		"task_list_id" = "inbox"."id",
		"task_lifecycle" = CASE "reminder"."status" WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'open' END,
		"completed_at" = CASE WHEN "reminder"."status" = 'completed' THEN COALESCE("reminder"."completed_at", "reminder"."updated_at") ELSE NULL END,
		"task_revision" = 1,
		"task_cancelled_at" = CASE WHEN "reminder"."status" = 'cancelled' THEN "reminder"."updated_at" ELSE NULL END
	FROM "task_lists" AS "inbox"
	WHERE "reminder"."kind" = 'task' AND "inbox"."user_id" = "reminder"."user_id" AND "inbox"."kind" = 'inbox';

	ALTER TABLE "reminders"
		ADD CONSTRAINT "reminders_kind_check" CHECK ("kind" IN ('reminder', 'task')),
		ADD CONSTRAINT "reminders_priority_check" CHECK ("priority" IN ('low', 'medium', 'high')),
		ADD CONSTRAINT "reminders_legacy_status_check" CHECK ("status" IN ('inbox', 'next', 'scheduled', 'completed', 'cancelled')),
		ADD CONSTRAINT "reminders_task_revision_check" CHECK ("task_revision" IS NULL OR "task_revision" > 0),
		ADD CONSTRAINT "reminders_task_create_idempotency_check" CHECK (
			("task_create_idempotency_key" IS NULL AND "task_create_idempotency_fingerprint" IS NULL)
			OR ("task_create_idempotency_key" IS NOT NULL AND "task_create_idempotency_fingerprint" IS NOT NULL
				AND "task_create_idempotency_fingerprint" ~ '^[0-9a-f]{64}$')
		),
		ADD CONSTRAINT "reminders_task_fields_check" CHECK (
			("kind" = 'task' AND "task_list_id" IS NOT NULL AND "task_lifecycle" IN ('open', 'completed', 'cancelled')
				AND "task_revision" IS NOT NULL AND (
					("task_lifecycle" = 'open' AND "completed_at" IS NULL AND "task_cancelled_at" IS NULL)
					OR ("task_lifecycle" = 'completed' AND "completed_at" IS NOT NULL AND "task_cancelled_at" IS NULL)
					OR ("task_lifecycle" = 'cancelled' AND "completed_at" IS NULL AND "task_cancelled_at" IS NOT NULL)
				))
			OR ("kind" = 'reminder' AND "task_list_id" IS NULL AND "task_project_id" IS NULL
				AND "task_why" IS NULL AND "task_lifecycle" IS NULL AND "task_revision" IS NULL
				AND "task_cancelled_at" IS NULL AND "task_create_idempotency_key" IS NULL
				AND "task_create_idempotency_fingerprint" IS NULL)
		);
	ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_list_ownership_fk"
		FOREIGN KEY ("task_list_id", "user_id") REFERENCES "public"."task_lists"("id", "user_id") ON DELETE no action ON UPDATE no action;
	ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_project_location_fk"
		FOREIGN KEY ("task_project_id", "user_id", "task_list_id") REFERENCES "public"."task_projects"("id", "user_id", "list_id") ON DELETE no action ON UPDATE no action;
	CREATE INDEX "reminders_task_list_idx" ON "reminders" ("user_id", "task_list_id", "task_lifecycle") WHERE "kind" = 'task';
	CREATE INDEX "reminders_task_project_idx" ON "reminders" ("user_id", "task_project_id", "task_lifecycle") WHERE "kind" = 'task';
	CREATE UNIQUE INDEX "reminders_task_create_idempotency_idx" ON "reminders" ("user_id", "task_create_idempotency_key") WHERE "task_create_idempotency_key" IS NOT NULL;

	EXECUTE $sql$
		CREATE FUNCTION "guard_system_task_inbox"() RETURNS trigger AS $function$
		BEGIN
			IF OLD."kind" = 'inbox' THEN
				IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD."user_id") THEN
					RETURN OLD;
				END IF;
				RAISE EXCEPTION 'The system Inbox is immutable.';
			END IF;
			IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
			RETURN NEW;
		END
		$function$ LANGUAGE plpgsql
	$sql$;
	CREATE TRIGGER "task_lists_guard_system_inbox" BEFORE UPDATE OR DELETE ON "task_lists"
		FOR EACH ROW EXECUTE FUNCTION "guard_system_task_inbox"();

	IF EXISTS (
		SELECT 1 FROM "reminders" WHERE
			("kind" = 'task' AND ("task_list_id" IS NULL OR "task_lifecycle" IS NULL OR "task_revision" IS NULL))
			OR ("kind" = 'reminder' AND ("task_list_id" IS NOT NULL OR "task_project_id" IS NOT NULL
				OR "task_why" IS NOT NULL OR "task_lifecycle" IS NOT NULL OR "task_revision" IS NOT NULL
				OR "task_cancelled_at" IS NOT NULL OR "task_create_idempotency_key" IS NOT NULL
				OR "task_create_idempotency_fingerprint" IS NOT NULL))
	) THEN
		RAISE EXCEPTION 'Task organization migration validation failed for mixed reminder rows.';
	END IF;
	IF EXISTS (
		SELECT "users"."id" FROM "users"
		LEFT JOIN "task_lists" ON "task_lists"."user_id" = "users"."id" AND "task_lists"."kind" = 'inbox'
		GROUP BY "users"."id" HAVING count("task_lists"."id") <> 1
	) THEN
		RAISE EXCEPTION 'Task organization migration validation failed for system Inboxes.';
	END IF;
END
$reconcile$;
