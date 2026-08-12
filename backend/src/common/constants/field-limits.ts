import { ImportType } from '../enums/import-type.enum';

/**
 * Límites de longitud de campos de texto, espejo de las columnas de la BD.
 * Fuente única compartida por los DTOs (class-validator) y por el validador
 * de importaciones, para que nunca se desincronicen (QA Func. 1.1).
 *
 * Las llaves usan los nombres destino de importación (snake_case), que para
 * clientes/comerciales coinciden con las propiedades de la entidad.
 */

/** Producto: columnas varchar de `products` (observaciones es text: sin límite). */
export const PRODUCT_FIELD_LIMITS: Record<string, number> = {
  codigo: 60,
  descripcion: 250,
  proveedor: 150,
  marca: 120,
  vehiculo: 120,
  categoria: 120,
  subcategoria: 120,
  aplicacion: 250,
  codigo_oe: 60,
  ref_cruzada_1: 60,
  ref_cruzada_2: 60,
  unidad_medida: 30,
  link_imagen: 500,
  ubicacion: 120,
  grupo_siete: 60,
  grupo_ocho: 60,
};

/** Cliente: columnas varchar de `clients`. */
export const CLIENT_FIELD_LIMITS: Record<string, number> = {
  nombre: 200,
  identificacion: 60,
  direccion: 250,
  telefonos: 120,
  ciudad: 120,
};

/** Comercial: columnas varchar de `comerciales` (misma estructura que Cliente). */
export const COMERCIAL_FIELD_LIMITS: Record<string, number> = {
  ...CLIENT_FIELD_LIMITS,
};

/** Límite por campo destino según el tipo de importación. */
export const IMPORT_FIELD_LIMITS: Record<ImportType, Record<string, number>> = {
  [ImportType.PRODUCTOS]: PRODUCT_FIELD_LIMITS,
  [ImportType.CANTIDADES]: { codigo: PRODUCT_FIELD_LIMITS.codigo },
  [ImportType.CLIENTES]: CLIENT_FIELD_LIMITS,
  [ImportType.COMERCIALES]: COMERCIAL_FIELD_LIMITS,
};
