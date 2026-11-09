-- Serves ON DELETE CASCADE from users, which finds a user's sessions by user_id.
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");