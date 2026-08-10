-- Enum additions live in their own migration on purpose.
-- Prisma runs each migration file inside a transaction, and PostgreSQL refuses
-- to use a value added by ALTER TYPE ... ADD VALUE in the same transaction that
-- added it ("unsafe use of new value of enum type"). The next migration relies
-- on 'RELOADLY' as a column default, so these have to commit first.

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'GIFT_CARD';

-- AlterEnum
ALTER TYPE "ProviderName" ADD VALUE 'RELOADLY';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_CARD_READY';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_CARD_FAILED';
