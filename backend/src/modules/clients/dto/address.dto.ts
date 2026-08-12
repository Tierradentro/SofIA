import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

/** QA Func. 4.1: dirección de despacho del cliente (máximo 10 por cliente). */
export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  direccion: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ciudad?: string;

  /** Si es true, desmarca la principal actual. La primera siempre queda principal. */
  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
