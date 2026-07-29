UPDATE "mail_rules"
SET "confidence_threshold_basis_points" = NULL
WHERE "confidence_threshold_basis_points" IS NOT NULL;
--> statement-breakpoint
UPDATE "mail_rules"
SET
	"policy" = CASE WHEN "enabled" THEN 'approved_rule' ELSE 'preview' END,
	"updated_at" = now(),
	"version" = "version" + 1
WHERE
	("enabled" = false AND "policy" <> 'preview')
	OR ("enabled" = true AND "policy" <> 'approved_rule');
--> statement-breakpoint
ALTER TABLE "mail_rules"
	ADD CONSTRAINT "mail_rules_activation_state_check"
	CHECK (
		("enabled" = false AND "policy" = 'preview')
		OR ("enabled" = true AND "policy" = 'approved_rule')
		OR (
			"enabled" = true
			AND "policy" = 'preview'
			AND "condition" IS NULL
			AND "actions" IS NULL
		)
	),
	ADD CONSTRAINT "mail_rules_exact_match_confidence_check"
	CHECK ("confidence_threshold_basis_points" IS NULL);
