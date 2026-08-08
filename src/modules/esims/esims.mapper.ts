import type {
  EsimUsage,
  Order,
  ProviderOrder,
  Product,
  TopUpProduct,
} from '@prisma/client';
import {
  formatDataVolume,
  formatUsd,
  toUsdAmount,
} from '../catalog/catalog.mapper';
import type { EsimAssetResponseDto } from './dto/esim-asset-response.dto';
import type { TopUpPackageResponseDto } from './dto/topup-package-response.dto';

export type ProviderOrderWithOrder = ProviderOrder & {
  order: Order & { product: Product | null };
};

export function toEsimAssetResponse(
  providerOrder: ProviderOrderWithOrder,
  usage: EsimUsage | null,
): EsimAssetResponseDto {
  const dataTotalBytes = usage?.dataTotalBytes ?? null;
  const dataUsedBytes = usage?.dataUsedBytes ?? null;
  const dataRemainingBytes =
    dataTotalBytes !== null && dataUsedBytes !== null
      ? dataTotalBytes - dataUsedBytes < 0n
        ? 0n
        : dataTotalBytes - dataUsedBytes
      : null;
  const dataUsedPercent =
    dataTotalBytes !== null && dataUsedBytes !== null && dataTotalBytes > 0n
      ? Math.min(
          100,
          Math.round((Number(dataUsedBytes) / Number(dataTotalBytes)) * 100),
        )
      : null;

  return {
    id: providerOrder.id,
    purchaseOrderId: providerOrder.orderId,
    iccid: providerOrder.iccid,
    status: providerOrder.status,
    productName: providerOrder.order.product?.name ?? null,
    locationCode: providerOrder.order.product?.locationCode ?? null,
    canTopUp:
      Boolean(providerOrder.iccid) &&
      Boolean(providerOrder.order.product?.topUpEnabled),
    dataUsedBytes: dataUsedBytes !== null ? dataUsedBytes.toString() : null,
    dataTotalBytes: dataTotalBytes !== null ? dataTotalBytes.toString() : null,
    dataRemainingBytes:
      dataRemainingBytes !== null ? dataRemainingBytes.toString() : null,
    dataUsedPercent,
    expiresAt: usage?.expiresAt ?? null,
    activatedAt: providerOrder.activatedAt,
    createdAt: providerOrder.createdAt,
  };
}

/**
 * Customer-facing top-up tier, sourced from the admin-curated catalog
 * (TopUpProduct) rather than a live provider call — see TopUpCatalogService.
 */
export function toTopUpPackageResponse(
  topUpProduct: TopUpProduct,
): TopUpPackageResponseDto {
  return {
    packageCode: topUpProduct.packageCode,
    name: topUpProduct.name,
    dataVolumeBytes:
      topUpProduct.dataVolumeBytes !== null &&
      topUpProduct.dataVolumeBytes !== undefined
        ? topUpProduct.dataVolumeBytes.toString()
        : null,
    dataVolumeDisplay: formatDataVolume(topUpProduct.dataVolumeBytes),
    durationDays: topUpProduct.durationDays,
    retailPrice: toUsdAmount(topUpProduct.retailPrice),
    retailPriceUsd: formatUsd(topUpProduct.retailPrice),
    currency: topUpProduct.currency,
  };
}
