import type { Product, TopUpProduct } from '@prisma/client';
import type {
  AdminProductResponseDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import type { TopUpProductResponseDto } from './dto/topup-product-response.dto';

/** Format a USD amount as `$1.80` (always 2 decimal places). */
export function formatUsd(
  amount: { toString(): string } | string | number,
): string {
  const value = Number(amount.toString());
  if (Number.isNaN(value)) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Normalize stored decimal to a 2-place USD string for APIs. */
export function toUsdAmount(
  amount: { toString(): string } | string | number,
): string {
  const value = Number(amount.toString());
  if (Number.isNaN(value)) {
    return '0.00';
  }
  return value.toFixed(2);
}

export function formatDataVolume(
  bytes: bigint | null | undefined,
): string | null {
  if (bytes === null || bytes === undefined) {
    return null;
  }
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  const gb = n / 1024 ** 3;
  if (gb >= 1) {
    return `${Number(gb.toFixed(gb >= 10 ? 0 : 1))} GB`;
  }
  const mb = n / 1024 ** 2;
  return `${Number(mb.toFixed(mb >= 10 ? 0 : 1))} MB`;
}

export function toProductResponse(product: Product): ProductResponseDto {
  return {
    id: product.id,
    name: product.name,
    locationCode: product.locationCode,
    dataVolumeBytes:
      product.dataVolumeBytes !== null && product.dataVolumeBytes !== undefined
        ? product.dataVolumeBytes.toString()
        : null,
    dataVolumeDisplay: formatDataVolume(product.dataVolumeBytes),
    durationDays: product.durationDays,
    retailPrice: toUsdAmount(product.retailPrice),
    retailPriceUsd: formatUsd(product.retailPrice),
    currency: 'USD',
    status: product.status,
  };
}

export function toAdminProductResponse(
  product: Product,
): AdminProductResponseDto {
  return {
    ...toProductResponse(product),
    supplierSku: product.supplierSku,
    costPrice: toUsdAmount(product.costPrice),
    costPriceUsd: formatUsd(product.costPrice),
    manualOverride: product.manualOverride,
    topUpEnabled: product.topUpEnabled,
  };
}

export function toTopUpProductResponse(
  topUpProduct: TopUpProduct,
): TopUpProductResponseDto {
  return {
    id: topUpProduct.id,
    productId: topUpProduct.productId,
    packageCode: topUpProduct.packageCode,
    name: topUpProduct.name,
    dataVolumeBytes:
      topUpProduct.dataVolumeBytes !== null &&
      topUpProduct.dataVolumeBytes !== undefined
        ? topUpProduct.dataVolumeBytes.toString()
        : null,
    dataVolumeDisplay: formatDataVolume(topUpProduct.dataVolumeBytes),
    durationDays: topUpProduct.durationDays,
    costPrice: toUsdAmount(topUpProduct.costPrice),
    costPriceUsd: formatUsd(topUpProduct.costPrice),
    retailPrice: toUsdAmount(topUpProduct.retailPrice),
    retailPriceUsd: formatUsd(topUpProduct.retailPrice),
    currency: topUpProduct.currency,
    status: topUpProduct.status,
    manualOverride: topUpProduct.manualOverride,
  };
}
