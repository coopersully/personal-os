CREATE INDEX "oauth_states_expiry_idx" ON "oauth_states" USING btree ("expires_at");
