-- Hand-edited from `prisma migrate diff` so that existing orders and slips keep their data.

-- Renaming in place keeps existing rows valid: PENDING slips were never checked
-- (so they need review) and APPROVED ones count as verified.
ALTER TYPE "PaymentSlipStatus" RENAME VALUE 'PENDING' TO 'NEEDS_REVIEW';
ALTER TYPE "PaymentSlipStatus" RENAME VALUE 'APPROVED' TO 'VERIFIED';
ALTER TABLE "payment_slips" ALTER COLUMN "status" SET DEFAULT 'NEEDS_REVIEW';

-- Existing orders get a random token here; the application generates them for new orders.
ALTER TABLE "orders" ADD COLUMN "accessToken" TEXT;
UPDATE "orders" SET "accessToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
ALTER TABLE "orders" ALTER COLUMN "accessToken" SET NOT NULL;

-- AlterTable
ALTER TABLE "payment_slips" RENAME COLUMN "transferAt" TO "slipDate";
ALTER TABLE "payment_slips" RENAME COLUMN "rejectReason" TO "reason";
ALTER TABLE "payment_slips" ADD COLUMN "amountSatang" INTEGER;
UPDATE "payment_slips" SET "amountSatang" = ROUND("amount" * 100)::INTEGER;
ALTER TABLE "payment_slips" DROP COLUMN "amount",
ALTER COLUMN "amountSatang" SET NOT NULL,
ADD COLUMN     "rawResponse" JSONB,
ADD COLUMN     "transRef" TEXT,
ALTER COLUMN "storageKey" DROP NOT NULL,
ALTER COLUMN "originalName" DROP NOT NULL,
ALTER COLUMN "mimeType" DROP NOT NULL,
ALTER COLUMN "sizeBytes" DROP NOT NULL;

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slip_attempts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "resultCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slip_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "slip_attempts_orderId_createdAt_idx" ON "slip_attempts"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "slip_attempts_createdAt_idx" ON "slip_attempts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_accessToken_key" ON "orders"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "payment_slips_transRef_key" ON "payment_slips"("transRef");

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_attempts" ADD CONSTRAINT "slip_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
