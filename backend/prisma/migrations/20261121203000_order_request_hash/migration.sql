-- Distinguishes an idempotent checkout replay from the same key used with a different body.
ALTER TABLE "orders" ADD COLUMN "client_request_hash" VARCHAR(64);
