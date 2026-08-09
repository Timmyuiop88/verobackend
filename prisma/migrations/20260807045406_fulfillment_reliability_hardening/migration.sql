-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "failureReason" TEXT;

-- CreateIndex
CREATE INDEX "orders_status_updatedAt_idx" ON "orders"("status", "updatedAt");
