CREATE TABLE ritual_definitions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('morning','night')), data jsonb NOT NULL, UNIQUE(user_id,kind), UNIQUE(user_id,id));
--> statement-breakpoint
CREATE TABLE ritual_definition_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, ritual_id uuid NOT NULL, revision integer NOT NULL CHECK (revision>0), data jsonb NOT NULL, UNIQUE(ritual_id,revision), FOREIGN KEY(user_id,ritual_id) REFERENCES ritual_definitions(user_id,id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE ritual_occurrences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, ritual_id uuid NOT NULL, local_date text NOT NULL, due_at timestamptz NOT NULL, data jsonb NOT NULL, UNIQUE(user_id,ritual_id,local_date), UNIQUE(user_id,id), FOREIGN KEY(user_id,ritual_id) REFERENCES ritual_definitions(user_id,id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE ritual_responses (id uuid PRIMARY KEY, user_id uuid NOT NULL, occurrence_id uuid NOT NULL, request_id uuid NOT NULL, data jsonb NOT NULL, UNIQUE(user_id,request_id), FOREIGN KEY(user_id,occurrence_id) REFERENCES ritual_occurrences(user_id,id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE ritual_actions (id uuid PRIMARY KEY, user_id uuid NOT NULL, occurrence_id uuid NOT NULL, request_id uuid NOT NULL, kind text NOT NULL, data jsonb NOT NULL, UNIQUE(user_id,request_id,kind), FOREIGN KEY(user_id,occurrence_id) REFERENCES ritual_occurrences(user_id,id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE TABLE ritual_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id uuid NOT NULL, ritual_id uuid NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, UNIQUE(user_id,request_id), FOREIGN KEY(user_id,ritual_id) REFERENCES ritual_definitions(user_id,id) ON DELETE CASCADE);
