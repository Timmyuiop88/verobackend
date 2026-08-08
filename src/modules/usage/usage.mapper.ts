import type { EsimUsage } from '@prisma/client';
import type { OrderUsageResponseDto } from '../orders/dto/order-response.dto';

export function toUsageResponse(
  orderId: string,
  usage: EsimUsage,
): OrderUsageResponseDto {
  const dataTotalBytes = usage.dataTotalBytes;
  const dataRemainingBytes =
    dataTotalBytes !== null
      ? dataTotalBytes - usage.dataUsedBytes < 0n
        ? 0n
        : dataTotalBytes - usage.dataUsedBytes
      : null;

  // Byte counts here are well within Number's safe integer range (exabyte
  // scale before precision loss) — plain division is fine and much simpler
  // than BigInt-safe percentage math.
  const dataUsedPercent =
    dataTotalBytes !== null && dataTotalBytes > 0n
      ? Math.min(
          100,
          Math.round(
            (Number(usage.dataUsedBytes) / Number(dataTotalBytes)) * 100,
          ),
        )
      : null;

  return {
    orderId,
    dataUsedBytes: usage.dataUsedBytes.toString(),
    dataTotalBytes: dataTotalBytes?.toString() ?? null,
    dataRemainingBytes:
      dataRemainingBytes !== null ? dataRemainingBytes.toString() : null,
    dataUsedPercent,
    expiresAt: usage.expiresAt,
    lastSyncedAt: usage.lastSyncedAt,
    isProviderDataRealtime: false,
  };
}
