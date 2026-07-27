/**
 * Tipos de importación desde la maestra contable (M18, HU-010).
 * PRODUCTOS y CANTIDADES son por empresa (existencias nunca se mezclan);
 * CLIENTES y COMERCIALES son catálogos globales (D-03).
 */
export enum ImportType {
  PRODUCTOS = 'PRODUCTOS',
  CANTIDADES = 'CANTIDADES',
  CLIENTES = 'CLIENTES',
  COMERCIALES = 'COMERCIALES',
}

/** Campos destino por tipo de importación (M05 / M04 / M06). */
export const IMPORT_FIELDS: Record<
  ImportType,
  { requeridos: string[]; opcionales: string[] }
> = {
  [ImportType.PRODUCTOS]: {
    requeridos: ['codigo', 'descripcion'],
    opcionales: [
      'proveedor', 'marca', 'vehiculo', 'categoria', 'subcategoria',
      'observaciones', 'aplicacion', 'codigo_oe', 'ref_cruzada_1',
      'ref_cruzada_2', 'unidad_medida', 'precio', 'link_imagen',
      'ubicacion', 'grupo_siete', 'grupo_ocho',
    ],
  },
  [ImportType.CANTIDADES]: {
    requeridos: ['codigo', 'cantidad'],
    opcionales: [],
  },
  [ImportType.CLIENTES]: {
    requeridos: ['nombre'],
    opcionales: ['identificacion', 'direccion', 'telefonos', 'ciudad'],
  },
  [ImportType.COMERCIALES]: {
    requeridos: ['nombre'],
    opcionales: ['identificacion', 'direccion', 'telefonos', 'ciudad'],
  },
};
