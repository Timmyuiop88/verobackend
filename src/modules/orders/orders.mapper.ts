import type { ProviderOrder } from '@prisma/client';
import type { OrderWithProvider } from './orders.service';
import type { OrderResponseDto } from './dto/order-response.dto';
import type { EsimInstallDetailsResponseDto } from './dto/install-details-response.dto';

export function toOrderResponse(order: OrderWithProvider): OrderResponseDto {
  return {
    id: order.id,
    orderType: order.orderType,
    productId: order.productId,
    targetEsimId: order.targetProviderOrderId,
    amount: order.amount.toString(),
    currency: order.currency,
    status: order.status,
    failureReason: order.failureReason,
    esim: order.providerOrder
      ? {
          iccid: order.providerOrder.iccid,
          lpaCode: order.providerOrder.lpaCode,
          qrCodeUrl: order.providerOrder.qrCodeUrl,
          status: order.providerOrder.status,
        }
      : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Parses a GSMA LPA activation string ("LPA:1$smdp.address$matchingId") into
 * its SM-DP+ address and matching ID / confirmation code parts, for
 * frontends that offer a "type it in manually" fallback to scanning the QR.
 */
function parseLpaCode(lpaCode: string | null): {
  smdpAddress: string | null;
  matchingId: string | null;
} {
  if (!lpaCode) {
    return { smdpAddress: null, matchingId: null };
  }
  const parts = lpaCode.split('$');
  return { smdpAddress: parts[1] ?? null, matchingId: parts[2] ?? null };
}

export function toInstallDetailsResponse(
  orderId: string,
  providerOrder: ProviderOrder,
  expiresAt: Date | null,
): EsimInstallDetailsResponseDto {
  const { smdpAddress, matchingId } = parseLpaCode(providerOrder.lpaCode);
  const activationCode = providerOrder.lpaCode ?? '';

  return {
    orderId,
    status: providerOrder.status ?? 'UNKNOWN',
    iccid: providerOrder.iccid ?? '',
    activationCode,
    smdpAddress,
    matchingId,
    qrCodeUrl: providerOrder.qrCodeUrl ?? '',
    shortUrl: providerOrder.shortUrl,
    // iOS 17.4+ one-tap install — no camera needed. Only render this button
    // when on iOS Safari; it silently fails as a plain link elsewhere.
    iosInstallUrl: activationCode
      ? `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(activationCode)}`
      : null,
    apn: providerOrder.apn,
    pin: providerOrder.pin,
    puk: providerOrder.puk,
    activatedAt: providerOrder.activatedAt,
    expiresAt,
  };
}
