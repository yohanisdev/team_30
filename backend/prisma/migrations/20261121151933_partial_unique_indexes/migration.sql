-- Uniqueness rules Prisma cannot express. Name search indexes already live in the init migration.

-- At most one Chapa attempt can be in flight for an order. Failed and expired rows stay.
CREATE UNIQUE INDEX "payments_one_open_chapa_idx"
  ON "payments" ("order_id")
  WHERE "method" = 'CHAPA' AND "status" IN ('PENDING', 'PROCESSING');

-- A customer has at most one default delivery address.
CREATE UNIQUE INDEX "customer_addresses_one_default_idx"
  ON "customer_addresses" ("user_id")
  WHERE "is_default";
