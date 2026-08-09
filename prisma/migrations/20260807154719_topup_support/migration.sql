-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('PURCHASE', 'TOPUP');

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_productId_fkey";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "orderType" "OrderType" NOT NULL DEFAULT 'PURCHASE',
ADD COLUMN     "targetProviderOrderId" UUID,
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "provider_orders" ADD COLUMN     "supportTopUpType" INTEGER;

-- CreateIndex
CREATE INDEX "orders_targetProviderOrderId_status_idx" ON "orders"("targetProviderOrderId", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_targetProviderOrderId_fkey" FOREIGN KEY ("targetProviderOrderId") REFERENCES "provider_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
