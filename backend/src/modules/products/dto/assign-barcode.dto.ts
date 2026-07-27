import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BarcodeOrigin } from '../../../common/enums/barcode-origin.enum';

/**
 * HU-011 (escaneado) / HU-012 (manual). El origen queda registrado.
 */
export class AssignBarcodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  barcode: string;

  @IsEnum(BarcodeOrigin)
  origen: BarcodeOrigin;
}
