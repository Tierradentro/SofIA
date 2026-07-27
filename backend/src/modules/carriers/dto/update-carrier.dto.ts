import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCarrierDto } from './create-carrier.dto';

export class UpdateCarrierDto extends PartialType(CreateCarrierDto) {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
