-- CreateEnum
CREATE TYPE "GiftCardDenominationType" AS ENUM ('FIXED', 'RANGE');

-- CreateEnum
CREATE TYPE "GiftCardPricingScope" AS ENUM ('GLOBAL', 'COUNTRY', 'CATEGORY', 'BRAND', 'PRODUCT');

-- CreateEnum
CREATE TYPE "GiftCardIssuanceStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "GiftCardSyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "giftCardDenominationId" UUID;

-- CreateTable
CREATE TABLE "gift_card_countries" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "continent" TEXT,
    "currencyCode" TEXT,
    "currencyName" TEXT,
    "currencySymbol" TEXT,
    "flagUrl" TEXT,
    "callingCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_categories" (
    "id" UUID NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "iconUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_brands" (
    "id" UUID NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_products" (
    "id" UUID NOT NULL,
    "externalProductId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandId" UUID,
    "categoryId" UUID,
    "countryCode" TEXT,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "providerStatus" TEXT,
    "denominationType" "GiftCardDenominationType" NOT NULL DEFAULT 'FIXED',
    "recipientCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "senderCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "senderFeePercentage" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "senderFeeFixed" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountPercentage" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "supportsPreOrder" BOOLEAN NOT NULL DEFAULT false,
    "userIdRequired" BOOLEAN NOT NULL DEFAULT false,
    "logoUrls" JSONB,
    "redeemInstructionConcise" TEXT,
    "redeemInstructionVerbose" TEXT,
    "minRecipientDenomination" DECIMAL(18,4),
    "maxRecipientDenomination" DECIMAL(18,4),
    "minSenderDenomination" DECIMAL(18,4),
    "maxSenderDenomination" DECIMAL(18,4),
    "pricingRuleId" UUID,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_denominations" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "faceValue" DECIMAL(18,4) NOT NULL,
    "senderCost" DECIMAL(18,4) NOT NULL,
    "feeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netCost" DECIMAL(18,4) NOT NULL,
    "retailPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "viable" BOOLEAN NOT NULL DEFAULT true,
    "viabilityNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_denominations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_pricing_rules" (
    "id" UUID NOT NULL,
    "scope" "GiftCardPricingScope" NOT NULL,
    "scopeRef" TEXT NOT NULL DEFAULT '*',
    "name" TEXT NOT NULL,
    "minMarginPercent" DECIMAL(9,4) NOT NULL DEFAULT 5,
    "customerDiscountPercent" DECIMAL(9,4) NOT NULL DEFAULT 1,
    "maxOverFacePercent" DECIMAL(9,4) NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_issuances" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "ProviderName" NOT NULL DEFAULT 'RELOADLY',
    "reloadlyTransactionId" BIGINT,
    "customIdentifier" TEXT NOT NULL,
    "providerStatus" "GiftCardIssuanceStatus" NOT NULL DEFAULT 'PENDING',
    "productExternalId" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "amountCharged" DECIMAL(18,4),
    "discountReceived" DECIMAL(18,4),
    "feePaid" DECIMAL(18,4),
    "realizedMargin" DECIMAL(18,4),
    "senderCurrency" TEXT,
    "cardsEncrypted" TEXT,
    "cardCount" INTEGER NOT NULL DEFAULT 0,
    "codesFetchedAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "revealCount" INTEGER NOT NULL DEFAULT 0,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_sync_runs" (
    "id" UUID NOT NULL,
    "status" "GiftCardSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "countriesSynced" INTEGER NOT NULL DEFAULT 0,
    "categoriesSynced" INTEGER NOT NULL DEFAULT 0,
    "brandsSynced" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "productsSynced" INTEGER NOT NULL DEFAULT 0,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "productsArchived" INTEGER NOT NULL DEFAULT 0,
    "denominationsSynced" INTEGER NOT NULL DEFAULT 0,
    "denominationsHidden" INTEGER NOT NULL DEFAULT 0,
    "sweepSkippedReason" TEXT,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_card_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_countries_code_key" ON "gift_card_countries"("code");

-- CreateIndex
CREATE INDEX "gift_card_countries_name_idx" ON "gift_card_countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_categories_externalId_key" ON "gift_card_categories"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_categories_slug_key" ON "gift_card_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_brands_externalId_key" ON "gift_card_brands"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_brands_slug_key" ON "gift_card_brands"("slug");

-- CreateIndex
CREATE INDEX "gift_card_brands_name_idx" ON "gift_card_brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_products_externalProductId_key" ON "gift_card_products"("externalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_products_slug_key" ON "gift_card_products"("slug");

-- CreateIndex
CREATE INDEX "gift_card_products_status_countryCode_idx" ON "gift_card_products"("status", "countryCode");

-- CreateIndex
CREATE INDEX "gift_card_products_status_categoryId_idx" ON "gift_card_products"("status", "categoryId");

-- CreateIndex
CREATE INDEX "gift_card_products_status_brandId_idx" ON "gift_card_products"("status", "brandId");

-- CreateIndex
CREATE INDEX "gift_card_products_lastSeenAt_idx" ON "gift_card_products"("lastSeenAt");

-- CreateIndex
CREATE INDEX "gift_card_products_name_idx" ON "gift_card_products"("name");

-- CreateIndex
CREATE INDEX "gift_card_denominations_productId_status_idx" ON "gift_card_denominations"("productId", "status");

-- CreateIndex
CREATE INDEX "gift_card_denominations_status_viable_idx" ON "gift_card_denominations"("status", "viable");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_denominations_productId_faceValue_key" ON "gift_card_denominations"("productId", "faceValue");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_pricing_rules_scope_scopeRef_key" ON "gift_card_pricing_rules"("scope", "scopeRef");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_issuances_orderId_key" ON "gift_card_issuances"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "gift_card_issuances_customIdentifier_key" ON "gift_card_issuances"("customIdentifier");

-- CreateIndex
CREATE INDEX "gift_card_issuances_reloadlyTransactionId_idx" ON "gift_card_issuances"("reloadlyTransactionId");

-- CreateIndex
CREATE INDEX "gift_card_issuances_providerStatus_idx" ON "gift_card_issuances"("providerStatus");

-- CreateIndex
CREATE INDEX "gift_card_sync_runs_startedAt_idx" ON "gift_card_sync_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_giftCardDenominationId_fkey" FOREIGN KEY ("giftCardDenominationId") REFERENCES "gift_card_denominations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_products" ADD CONSTRAINT "gift_card_products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "gift_card_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_products" ADD CONSTRAINT "gift_card_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "gift_card_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_products" ADD CONSTRAINT "gift_card_products_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "gift_card_pricing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_denominations" ADD CONSTRAINT "gift_card_denominations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gift_card_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_issuances" ADD CONSTRAINT "gift_card_issuances_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
