import { Injectable } from '@nestjs/common';
import { Prisma, type Region } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';

export type RegionResponse = {
  id: string;
  code: string;
  name: string;
  type: number;
  typeLabel: 'COUNTRY' | 'REGION';
  subLocations: Array<{ code: string; name: string }>;
};

@Injectable()
export class RegionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
  ) {}

  async syncFromProvider(): Promise<{
    synced: number;
    created: number;
    updated: number;
  }> {
    const locations = await this.esimAccess.listLocations();
    let created = 0;
    let updated = 0;

    for (const loc of locations) {
      const subLocations = (loc.subLocationList ?? []).map((s) => ({
        code: s.code,
        name: s.name,
      }));

      const existing = await this.prisma.region.findUnique({
        where: { code: loc.code },
      });

      if (!existing) {
        await this.prisma.region.create({
          data: {
            code: loc.code,
            name: loc.name,
            type: loc.type,
            subLocations,
          },
        });
        created += 1;
      } else {
        await this.prisma.region.update({
          where: { code: loc.code },
          data: {
            name: loc.name,
            type: loc.type,
            subLocations,
          },
        });
        updated += 1;
      }
    }

    return { synced: locations.length, created, updated };
  }

  async list(params?: {
    q?: string;
    type?: number;
  }): Promise<RegionResponse[]> {
    const q = params?.q?.trim();
    const where: Prisma.RegionWhereInput = {
      ...(params?.type !== undefined ? { type: params.type } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const regions = await this.prisma.region.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      take: 200,
    });

    return regions.map((r) => this.toResponse(r));
  }

  /**
   * Resolve a country/region search string into product locationCode values.
   * - Exact/partial match on region code or name
   * - Also includes multi-country region codes that contain the country
   */
  async resolveLocationCodes(countryOrCode: string): Promise<string[]> {
    const q = countryOrCode.trim();
    if (!q) {
      return [];
    }

    const regions = await this.prisma.region.findMany({
      where: {
        OR: [
          { code: { equals: q, mode: 'insensitive' } },
          { name: { equals: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      },
    });

    const codes = new Set<string>();

    for (const region of regions) {
      codes.add(region.code);

      const subs = this.parseSubLocations(region.subLocations);
      for (const sub of subs) {
        if (
          sub.code.toLowerCase() === q.toLowerCase() ||
          sub.name.toLowerCase().includes(q.toLowerCase())
        ) {
          codes.add(region.code);
          codes.add(sub.code);
        }
      }
    }

    // If user searched a country name that only appears inside regional subLocations
    if (codes.size === 0) {
      const allRegional = await this.prisma.region.findMany({
        where: { type: 2 },
      });
      for (const region of allRegional) {
        const subs = this.parseSubLocations(region.subLocations);
        for (const sub of subs) {
          if (
            sub.code.toLowerCase() === q.toLowerCase() ||
            sub.name.toLowerCase().includes(q.toLowerCase())
          ) {
            codes.add(region.code);
            codes.add(sub.code);
          }
        }
      }
    }

    // Also try direct uppercase ISO code even if region table not synced yet
    if (codes.size === 0 && /^[A-Za-z]{2}$/.test(q)) {
      codes.add(q.toUpperCase());
    }

    return [...codes];
  }

  private parseSubLocations(
    value: Prisma.JsonValue | null,
  ): Array<{ code: string; name: string }> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => {
        if (
          item &&
          typeof item === 'object' &&
          'code' in item &&
          'name' in item
        ) {
          const obj = item as { code: unknown; name: unknown };
          if (typeof obj.code === 'string' && typeof obj.name === 'string') {
            return { code: obj.code, name: obj.name };
          }
        }
        return null;
      })
      .filter((x): x is { code: string; name: string } => x !== null);
  }

  private toResponse(region: Region): RegionResponse {
    return {
      id: region.id,
      code: region.code,
      name: region.name,
      type: region.type,
      typeLabel: region.type === 2 ? 'REGION' : 'COUNTRY',
      subLocations: this.parseSubLocations(region.subLocations),
    };
  }
}
