import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { CatalogService } from './catalog.service';
import { toProductResponse } from './catalog.mapper';
import { ListPublishedProductsQueryDto } from './dto/list-products-query.dto';
import {
  PaginatedProductsResponseDto,
  ProductResponseDto,
} from './dto/product-response.dto';
import {
  ListRegionsQueryDto,
  RegionResponseDto,
} from './dto/region-response.dto';
import { RegionsService } from './regions.service';

@ApiTags('products')
@Controller()
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly regionsService: RegionsService,
  ) {}

  @Get('regions')
  @ApiOperation({
    summary: 'List supported countries/regions',
    description: [
      'Synced from eSIM Access `POST /location/list`.',
      'Use for country autocomplete. Then filter products with `GET /products?country=Japan` (or `locationCode=JP`).',
      'type 1 = country, type 2 = multi-country region (includes `subLocations`).',
    ].join('\n'),
  })
  @ApiOkResponse({ type: [RegionResponseDto] })
  listRegions(
    @Query() query: ListRegionsQueryDto,
  ): Promise<RegionResponseDto[]> {
    return this.regionsService.list({
      q: query.q,
      type: query.type,
    });
  }

  @Get('products')
  @ApiOperation({
    summary: 'List published products (paginated)',
    description: [
      'Public catalog of PUBLISHED products only.',
      'Prices are in USD (`retailPrice` + `retailPriceUsd`).',
      'Filter by exact code: `locationCode=US`.',
      'Or search by country name: `country=Japan` / `country=United States` (resolves via regions table).',
    ].join('\n'),
  })
  @ApiOkResponse({ type: PaginatedProductsResponseDto })
  async list(
    @Query() query: ListPublishedProductsQueryDto,
  ): Promise<PaginatedProductsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.catalogService.listPublished({
      locationCode: query.locationCode,
      country: query.country,
      page,
      limit,
    });

    return {
      data: result.data.map(toProductResponse),
      meta: buildPaginationMeta(result.page, result.limit, result.total),
    };
  }

  @Get('products/:id')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: 'Get a published product by id',
    description:
      'Prices are USD: `retailPrice` (e.g. `1.80`) and `retailPriceUsd` (e.g. `$1.80`). Only returns products with status PUBLISHED — DRAFT/ARCHIVED ids 404 here even if they exist.',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found or not published' })
  async get(@Param('id') id: string): Promise<ProductResponseDto> {
    const product = await this.catalogService.getPublishedById(id);
    return toProductResponse(product);
  }
}
