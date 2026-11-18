CREATE TABLE native_push_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installation_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 encrypted_token jsonb NOT NULL, token_fingerprint text NOT NULL UNIQUE,
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 finance_enabled boolean NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 audience uuid NOT NULL DEFAULT gen_random_uuid(), enrolled_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_push_devices_owner_idx ON native_push_devices(user_id);
CREATE TABLE native_push_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_id uuid NOT NULL, source_type text NOT NULL DEFAULT 'conversation_message', kind text NOT NULL CHECK(kind IN ('reply','attention','activity')),
 source_revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX native_push_events_source_idx ON native_push_events(user_id,source_type,source_id,kind,source_revision);
CREATE TABLE native_push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES native_push_events(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES native_push_devices(id) ON DELETE CASCADE,
 audience uuid NOT NULL, device_revision integer NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','submitting','accepted','uncertain','failed','suppressed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, outcome_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX native_push_deliveries_event_device_idx ON native_push_deliveries(event_id,device_id);
CREATE INDEX native_push_deliveries_due_idx ON native_push_deliveries(state,next_attempt_at);
