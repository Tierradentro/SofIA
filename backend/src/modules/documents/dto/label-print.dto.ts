import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * I27: impresión de la etiqueta de caja por POST. El código de barras viaja
 * como data URL en el cuerpo (no en el query string): la variante GET se
 * conserva por compatibilidad, pero un barras grande podía superar los
 * límites de URL de los proxies.
 */
export class LabelPrintDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  boxCode: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^data:image\//, { message: 'El código de barras debe ser un data URL de imagen' })
  @MaxLength(64_000)
  barcode: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  despacho?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  empresas?: string;
}
