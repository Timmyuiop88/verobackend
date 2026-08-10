-- CreateEnum
CREATE TYPE "SmsPricingScope" AS ENUM ('GLOBAL', 'COUNTRY', 'SERVICE', 'RENTAL_SKU');

-- CreateEnum
CREATE TYPE "SmsVerificationStatus" AS ENUM ('PENDING', 'AWAITING_SMS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "NumberRentalStatus" AS ENUM ('PENDING', 'PENDING_ACTIVATION', 'ACTIVE', 'EXPIRED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsSyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "smsOneTimeOfferId" UUID,
ADD COLUMN "numberRentalPlanId" UUID,
ADD COLUMN "targetNumberRentalId" UUID;

-- CreateTable
CREATE TABLE "sms_countries" (
    "id" UUID NOT NULL,
    "externalId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_services" (
    "id" UUID NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_pricing_rules" (
    "id" UUID NOT NULL,
    "scope" "SmsPricingScope" NOT NULL,
    "scopeRef" TEXT NOT NULL DEFAULT '*',
    "name" TEXT NOT NULL,
    "markupPercent" DECIMAL(9,4) NOT NULL DEFAULT 20,
    "floorAmount" DECIMAL(18,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_one_time_offers" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "pool" INTEGER NOT NULL DEFAULT 0,
    "providerCost" DECIMAL(18,4) NOT NULL,
    "retailPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "successRate" DECIMAL(9,4),
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "pricingRuleId" UUID,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_one_time_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_rental_skus" (
    "id" UUID NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tag" TEXT,
    "region" TEXT,
    "countryId" UUID,
    "countryCode" TEXT,
    "pool" INTEGER,
    "extendable" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "pricingRuleId" UUID,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_rental_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_rental_plans" (
    "id" UUID NOT NULL,
    "rentalSkuId" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "providerCost" DECIMAL(18,4) NOT NULL,
    "retailPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stockCount" INTEGER,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_rental_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_verifications" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "provider" "ProviderName" NOT NULL DEFAULT 'SMSPOOL',
    "providerOrderId" TEXT,
    "phoneNumber" TEXT,
    "countryCode" TEXT,
    "smsCode" TEXT,
    "fullSms" TEXT,
    "status" "SmsVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerCost" DECIMAL(18,4),
    "expiresAt" TIMESTAMP(3),
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_rentals" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "provider" "ProviderName" NOT NULL DEFAULT 'SMSPOOL',
    "rentalCode" TEXT,
    "phoneNumber" TEXT,
    "days" INTEGER NOT NULL,
    "serviceExternalId" INTEGER,
    "serviceName" TEXT,
    "status" "NumberRentalStatus" NOT NULL DEFAULT 'PENDING',
    "autoExtend" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "providerCost" DECIMAL(18,4),
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_rental_messages" (
    "id" UUID NOT NULL,
    "numberRentalId" UUID NOT NULL,
    "providerMessageId" TEXT,
    "sender" TEXT,
    "fullSms" TEXT NOT NULL,
    "smsCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_rental_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_sync_runs" (
    "id" UUID NOT NULL,
    "status" "SmsSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "countriesSynced" INTEGER NOT NULL DEFAULT 0,
    "servicesSynced" INTEGER NOT NULL DEFAULT 0,
    "offersSynced" INTEGER NOT NULL DEFAULT 0,
    "offersCreated" INTEGER NOT NULL DEFAULT 0,
    "offersUpdated" INTEGER NOT NULL DEFAULT 0,
    "offersArchived" INTEGER NOT NULL DEFAULT 0,
    "rentalSkusSynced" INTEGER NOT NULL DEFAULT 0,
    "rentalPlansSynced" INTEGER NOT NULL DEFAULT 0,
    "rentalPlansArchived" INTEGER NOT NULL DEFAULT 0,
    "sweepSkippedReason" TEXT,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_countries_externalId_key" ON "sms_countries"("externalId");
CREATE UNIQUE INDEX "sms_countries_code_key" ON "sms_countries"("code");
CREATE INDEX "sms_countries_name_idx" ON "sms_countries"("name");

CREATE UNIQUE INDEX "sms_services_externalId_key" ON "sms_services"("externalId");
CREATE UNIQUE INDEX "sms_services_slug_key" ON "sms_services"("slug");
CREATE INDEX "sms_services_name_idx" ON "sms_services"("name");

CREATE UNIQUE INDEX "sms_pricing_rules_scope_scopeRef_key" ON "sms_pricing_rules"("scope", "scopeRef");

CREATE UNIQUE INDEX "sms_one_time_offers_serviceId_countryId_pool_key" ON "sms_one_time_offers"("serviceId", "countryId", "pool");
CREATE INDEX "sms_one_time_offers_status_countryId_idx" ON "sms_one_time_offers"("status", "countryId");
CREATE INDEX "sms_one_time_offers_status_serviceId_idx" ON "sms_one_time_offers"("status", "serviceId");
CREATE INDEX "sms_one_time_offers_lastSeenAt_idx" ON "sms_one_time_offers"("lastSeenAt");

CREATE UNIQUE INDEX "sms_rental_skus_externalId_key" ON "sms_rental_skus"("externalId");
CREATE UNIQUE INDEX "sms_rental_skus_slug_key" ON "sms_rental_skus"("slug");
CREATE INDEX "sms_rental_skus_status_countryCode_idx" ON "sms_rental_skus"("status", "countryCode");
CREATE INDEX "sms_rental_skus_lastSeenAt_idx" ON "sms_rental_skus"("lastSeenAt");

CREATE UNIQUE INDEX "sms_rental_plans_rentalSkuId_days_key" ON "sms_rental_plans"("rentalSkuId", "days");
CREATE INDEX "sms_rental_plans_status_rentalSkuId_idx" ON "sms_rental_plans"("status", "rentalSkuId");

CREATE UNIQUE INDEX "sms_verifications_orderId_key" ON "sms_verifications"("orderId");
CREATE UNIQUE INDEX "sms_verifications_providerOrderId_key" ON "sms_verifications"("providerOrderId");
CREATE INDEX "sms_verifications_status_expiresAt_idx" ON "sms_verifications"("status", "expiresAt");
CREATE INDEX "sms_verifications_providerOrderId_idx" ON "sms_verifications"("providerOrderId");

CREATE UNIQUE INDEX "number_rentals_orderId_key" ON "number_rentals"("orderId");
CREATE UNIQUE INDEX "number_rentals_rentalCode_key" ON "number_rentals"("rentalCode");
CREATE INDEX "number_rentals_status_expiresAt_idx" ON "number_rentals"("status", "expiresAt");
CREATE INDEX "number_rentals_rentalCode_idx" ON "number_rentals"("rentalCode");

CREATE UNIQUE INDEX "number_rental_messages_numberRentalId_providerMessageId_key" ON "number_rental_messages"("numberRentalId", "providerMessageId");
CREATE INDEX "number_rental_messages_numberRentalId_receivedAt_idx" ON "number_rental_messages"("numberRentalId", "receivedAt");

CREATE INDEX "sms_sync_runs_startedAt_idx" ON "sms_sync_runs"("startedAt");

CREATE INDEX "orders_targetNumberRentalId_status_idx" ON "orders"("targetNumberRentalId", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_smsOneTimeOfferId_fkey" FOREIGN KEY ("smsOneTimeOfferId") REFERENCES "sms_one_time_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_numberRentalPlanId_fkey" FOREIGN KEY ("numberRentalPlanId") REFERENCES "sms_rental_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_targetNumberRentalId_fkey" FOREIGN KEY ("targetNumberRentalId") REFERENCES "number_rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sms_one_time_offers" ADD CONSTRAINT "sms_one_time_offers_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "sms_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sms_one_time_offers" ADD CONSTRAINT "sms_one_time_offers_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "sms_countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sms_one_time_offers" ADD CONSTRAINT "sms_one_time_offers_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "sms_pricing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sms_rental_skus" ADD CONSTRAINT "sms_rental_skus_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "sms_countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sms_rental_skus" ADD CONSTRAINT "sms_rental_skus_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "sms_pricing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sms_rental_plans" ADD CONSTRAINT "sms_rental_plans_rentalSkuId_fkey" FOREIGN KEY ("rentalSkuId") REFERENCES "sms_rental_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sms_verifications" ADD CONSTRAINT "sms_verifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sms_verifications" ADD CONSTRAINT "sms_verifications_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "sms_one_time_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "number_rentals" ADD CONSTRAINT "number_rentals_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "number_rentals" ADD CONSTRAINT "number_rentals_planId_fkey" FOREIGN KEY ("planId") REFERENCES "sms_rental_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "number_rental_messages" ADD CONSTRAINT "number_rental_messages_numberRentalId_fkey" FOREIGN KEY ("numberRentalId") REFERENCES "number_rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
