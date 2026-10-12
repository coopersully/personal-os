ALTER TABLE domain_profile_approvals ADD COLUMN approval_source text NOT NULL DEFAULT 'user_instruction';
--> statement-breakpoint
ALTER TABLE domain_profile_approvals ADD COLUMN approved_by_agent_id text;
--> statement-breakpoint
ALTER TABLE domain_profile_approvals ALTER COLUMN approved_by_user_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE domain_profile_approvals ADD CONSTRAINT domain_profile_approvals_provenance_check CHECK (((approval_source = 'user_instruction' AND approved_by_user_id = user_id AND approved_by_agent_id IS NULL) OR (approval_source = 'agent_self_approval' AND approved_by_user_id IS NULL AND length(approved_by_agent_id) > 0)) IS TRUE);
