-- AlterTable
ALTER TABLE "provider_orders" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "apn" TEXT,
ADD COLUMN     "pin" TEXT,
ADD COLUMN     "puk" TEXT,
ADD COLUMN     "shortUrl" TEXT;
