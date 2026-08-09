import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTopUpDto {
  @ApiProperty({
    description:
      'packageCode from GET /esims/:id/topup-packages. The server re-fetches live pricing for this code — the client never sends a price/amount.',
  })
  @IsString()
  @IsNotEmpty()
  packageCode!: string;
}
