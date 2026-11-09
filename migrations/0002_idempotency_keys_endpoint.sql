ALTER TABLE "idempotency_keys" DROP CONSTRAINT "uq_idempotency_keys_user_id_key";--> statement-breakpoint
-- Existing keys get an empty endpoint, so they stop replaying and expire within 24 hours.
ALTER TABLE "idempotency_keys" ADD COLUMN "endpoint" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "endpoint" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "uq_idempotency_keys_user_id_endpoint_key" UNIQUE("user_id","endpoint","key");
