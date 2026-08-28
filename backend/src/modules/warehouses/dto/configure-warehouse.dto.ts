import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BodegaForma } from '../entities/warehouse.entity';
import { ZonaLado } from '../entities/warehouse-zone.entity';

class EstanteCfgDto {
  @IsInt()
  @Min(1)
  @Max(20)
  numero: number;

  /** Niveles del estante (2 a 4 en esta bodega; el tope es genérico). */
  @IsInt()
  @Min(1)
  @Max(12)
  niveles: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;
}

class ZonaCfgDto {
  @IsEnum(ZonaLado)
  lado: ZonaLado;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  /** Estantes de la zona (vacío en el fondo: es un solo espacio). */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EstanteCfgDto)
  estantes: EstanteCfgDto[];
}

class PasilloCfgDto {
  @IsInt()
  @Min(1)
  numero: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  posX?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  posY?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  anchoM?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  altoM?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ZonaCfgDto)
  zonas: ZonaCfgDto[];
}

class PisoCfgDto {
  @IsInt()
  @Min(1)
  numero: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  /** Solo el piso 1 tiene entrada/patio/bahías. */
  @IsBoolean()
  tieneAreasFijas: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PasilloCfgDto)
  pasillos: PasilloCfgDto[];
}

/**
 * Asistente de configuración de la bodega (HU-014). El Administrador define
 * la forma y la estructura completa (pisos → pasillos → zonas → estantes →
 * niveles); las áreas fijas del piso 1 se crean automáticamente (entrada,
 * patio de maniobras, bahía de empaque, bahía temporal).
 */
export class ConfigureWarehouseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @IsEnum(BodegaForma)
  forma: BodegaForma;

  @IsInt()
  @Min(4)
  @Max(500)
  anchoM: number;

  @IsInt()
  @Min(4)
  @Max(500)
  altoM: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PisoCfgDto)
  pisos: PisoCfgDto[];
}
