import { EntityManager } from 'typeorm';

/**
 * I36: bahía de empaque como ubicación operativa del alistamiento.
 *
 * Regla de negocio: cuando el Operador finaliza el alistamiento de un pedido,
 * la mercancía alistada se traslada (en ubicaciones) a la bahía de empaque;
 * al cerrar las cajas del despacho, las unidades salen del área y de la
 * bodega; si el despacho se cancela, regresan al área.
 *
 * La bahía de empaque es obligatoria: el asistente de configuración la crea
 * siempre (área fija del piso 1) y, si no existe (configuración antigua o
 * eliminada), estas funciones la recrean en el piso 1 para no bloquear el
 * flujo operativo.
 */

/** ID de la bahía de empaque activa de la bodega activa; la crea si no existe. */
export async function asegurarAreaEmpaque(em: EntityManager): Promise<string | null> {
  const rows: Array<{ id: string }> = await em.query(
    `SELECT a.id
       FROM warehouse_areas a
       JOIN warehouse_floors f ON f.id = a.floor_id
       JOIN warehouses w ON w.id = f.warehouse_id
      WHERE a.tipo = 'BAHIA_EMPAQUE' AND a.activo = true AND w.activo = true
      ORDER BY a.permite_productos DESC, f.numero ASC
      LIMIT 1`,
  );
  if (rows.length > 0) return rows[0].id;

  // No existe (nunca se creó o fue eliminada): recrearla en el piso 1.
  const piso: Array<{ id: string }> = await em.query(
    `SELECT f.id
       FROM warehouse_floors f
       JOIN warehouses w ON w.id = f.warehouse_id
      WHERE w.activo = true
      ORDER BY f.numero ASC
      LIMIT 1`,
  );
  if (piso.length === 0) return null; // sin bodega configurada: no aplica
  const creada: Array<{ id: string }> = await em.query(
    `INSERT INTO warehouse_areas (floor_id, tipo, alias, pos_x, pos_y, ancho_m, alto_m, permite_productos, activo)
     VALUES ($1, 'BAHIA_EMPAQUE', 'Bahía de Empaque', 2, 6, 8, 4, true, true)
     RETURNING id`,
    [piso[0].id],
  );
  return creada[0].id;
}

/** ID de la bahía de empaque activa, SIN crearla (para descuentos). */
async function buscarAreaEmpaque(em: EntityManager): Promise<string | null> {
  const rows: Array<{ id: string }> = await em.query(
    `SELECT a.id
       FROM warehouse_areas a
       JOIN warehouse_floors f ON f.id = a.floor_id
       JOIN warehouses w ON w.id = f.warehouse_id
      WHERE a.tipo = 'BAHIA_EMPAQUE' AND a.activo = true AND w.activo = true
      ORDER BY f.numero ASC
      LIMIT 1`,
  );
  return rows.length > 0 ? rows[0].id : null;
}

/** La ubicación oficial del producto pasa a ser la de mayor cantidad. */
async function recalcularOficial(em: EntityManager, productId: string): Promise<void> {
  await em.query(
    `UPDATE warehouse_product_locations SET es_oficial = false WHERE product_id = $1`,
    [productId],
  );
  await em.query(
    `UPDATE warehouse_product_locations SET es_oficial = true
      WHERE id = (
        SELECT id FROM warehouse_product_locations
         WHERE product_id = $1
         ORDER BY cantidad DESC, created_at ASC
         LIMIT 1
      )`,
    [productId],
  );
}

/** Suma unidades en la ubicación del área de empaque (upsert) y recalcula la oficial. */
export async function sumarEnEmpaque(
  em: EntityManager,
  productId: string,
  areaId: string,
  cantidad: number,
): Promise<void> {
  const destino: Array<{ id: string }> = await em.query(
    `SELECT id FROM warehouse_product_locations
      WHERE product_id = $1 AND area_id = $2
      LIMIT 1`,
    [productId, areaId],
  );
  if (destino.length > 0) {
    await em.query(
      `UPDATE warehouse_product_locations SET cantidad = cantidad + $2, updated_at = now() WHERE id = $1`,
      [destino[0].id, cantidad],
    );
  } else {
    await em.query(
      `INSERT INTO warehouse_product_locations (id, product_id, rack_id, nivel, area_id, transito, cantidad, es_oficial)
       VALUES (gen_random_uuid(), $1, NULL, NULL, $2, false, $3, false)`,
      [productId, areaId, cantidad],
    );
  }
  await recalcularOficial(em, productId);
}

/**
 * Traslada unidades al área de empaque: descuenta primero de las ubicaciones
 * actuales del producto (estantes, tránsito u otras áreas; las de mayor
 * cantidad primero) y luego suma en la bahía. Si el producto no tenía
 * ubicaciones registradas, igual queda ubicado en la bahía.
 */
export async function trasladarAEmpaque(
  em: EntityManager,
  productId: string,
  areaId: string,
  cantidad: number,
): Promise<void> {
  let restante = cantidad;
  const actuales: Array<{ id: string; cantidad: number }> = await em.query(
    `SELECT id, cantidad FROM warehouse_product_locations
      WHERE product_id = $1 AND (area_id IS NULL OR area_id <> $2)
      ORDER BY cantidad DESC`,
    [productId, areaId],
  );
  for (const loc of actuales) {
    if (restante <= 0) break;
    const take = Math.min(loc.cantidad, restante);
    if (take >= loc.cantidad) {
      await em.query(`DELETE FROM warehouse_product_locations WHERE id = $1`, [loc.id]);
    } else {
      await em.query(
        `UPDATE warehouse_product_locations SET cantidad = cantidad - $2, updated_at = now() WHERE id = $1`,
        [loc.id, take],
      );
    }
    restante -= take;
  }
  await sumarEnEmpaque(em, productId, areaId, cantidad);
}

/**
 * Descuenta unidades del área de empaque (salida de la bodega al cerrar las
 * cajas del despacho). Tolera configuraciones antiguas sin el área o sin
 * ubicación registrada: en ese caso no hay nada que descontar.
 */
export async function descontarDeEmpaque(
  em: EntityManager,
  productId: string,
  cantidad: number,
): Promise<void> {
  const areaId = await buscarAreaEmpaque(em);
  if (!areaId) return;
  const loc: Array<{ id: string; cantidad: number }> = await em.query(
    `SELECT id, cantidad FROM warehouse_product_locations
      WHERE product_id = $1 AND area_id = $2
      LIMIT 1`,
    [productId, areaId],
  );
  if (loc.length === 0) return;
  const restante = loc[0].cantidad - cantidad;
  if (restante <= 0) {
    await em.query(`DELETE FROM warehouse_product_locations WHERE id = $1`, [loc[0].id]);
  } else {
    await em.query(
      `UPDATE warehouse_product_locations SET cantidad = $2, updated_at = now() WHERE id = $1`,
      [loc[0].id, restante],
    );
  }
  await recalcularOficial(em, productId);
}
