CREATE TABLE automation_host_prompt_issues (
 user_id uuid NOT NULL,
 schedule_id uuid NOT NULL,
 template_version integer NOT NULL CONSTRAINT automation_host_prompt_issues_template_version_check CHECK (template_version > 0),
 schedule_version_at_issue integer NOT NULL CONSTRAINT automation_host_prompt_issues_schedule_version_check CHECK (schedule_version_at_issue > 0),
 text text NOT NULL CONSTRAINT automation_host_prompt_issues_text_check CHECK (length(text) > 0),
 issued_at timestamptz NOT NULL,
 PRIMARY KEY(user_id, schedule_id, template_version),
 CONSTRAINT automation_host_prompt_issues_owner_fk FOREIGN KEY(user_id,schedule_id)
 REFERENCES automation_host_schedules(user_id,id) ON DELETE CASCADE
);
