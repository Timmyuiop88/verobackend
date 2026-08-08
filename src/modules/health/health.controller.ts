import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'tradevero-api' },
    },
  })
  check() {
    return { status: 'ok', service: 'tradevero-api' };
  }
}
