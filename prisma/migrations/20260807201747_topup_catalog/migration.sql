-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "topUpProductId" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "topUpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "topup_products" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "packageCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataVolumeBytes" BIGINT,
    "durationDays" INTEGER,
    "costPrice" DECIMAL(18,4) NOT NULL,
    "retailPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "pricingProfileId" UUID,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topup_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "topup_products_productId_status_idx" ON "topup_products"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "topup_products_productId_packageCode_key" ON "topup_products"("productId", "packageCode");

-- AddForeignKey
ALTER TABLE "topup_products" ADD CONSTRAINT "topup_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topup_products" ADD CONSTRAINT "topup_products_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "pricing_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_topUpProductId_fkey" FOREIGN KEY ("topUpProductId") REFERENCES "topup_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
