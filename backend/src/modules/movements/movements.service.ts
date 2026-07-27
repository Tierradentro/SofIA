import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { Product } from '../products/entities/product.entity';
import { MovementType } from '../../common/enums/movement-type.enum';

export interface MovementInput {
  productId: string;
  tipo: MovementType;
  /** Variación sobre cantidad (signo incluido). 0 si no aplica. */
  cantidadDelta?: number;
  /** Variación sobre cantidad_bloqueada (signo incluido). 0 si no aplica. */
  cantidadBloqueadaDelta?: number;
  docTipo?: string;
  docId?: string;
  usuarioId?: string;
}

/**
 * Libro mayor de existencias (D-01). Regla transversal: los ajustes de
 * existencia se registran como movimientos, NUNCA como sobrescritura del
 * campo cantidad. Este servicio es la ÚNICA vía de mutación de
 * products.cantidad / products.cantidad_bloqueada:
 *  - Actualiza el saldo con UPDATE condicional atómico (concurrencia segura).
 *  - Inserta el movimiento con los saldos resultantes.
 *  - Todo dentro de la transacción del llamador (o una propia).
 */
@Injectable()
export class MovementsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Aplica un movimiento y actualiza el saldo del producto atómicamente.
   * Si el llamador pasa un EntityManager, participa en su transacción
   * (ej.: cierre de caja — todos los productos en una única transacción).
   */
  async apply(input: MovementInput, manager?: EntityManager): Promise<InventoryMovement> {
    const run = async (em: EntityManager) => {
      const cantidadDelta = input.cantidadDelta ?? 0;
      const bloqueadaDelta = input.cantidadBloqueadaDelta ?? 0;

      // UPDATE condicional atómico: garantiza invariantes bajo concurrencia
      // (cantidad >= 0, bloqueada >= 0, bloqueada <= cantidad tras el cambio).
      const result: [Product[], number] = await em.query(
        `UPDATE products
         SET cantidad = cantidad + $2,
             cantidad_bloqueada = cantidad_bloqueada + $3,
             updated_at = now()
         WHERE id = $1
           AND cantidad + $2 >= 0
           AND cantidad_bloqueada + $3 >= 0
           AND cantidad_bloqueada + $3 <= cantidad + $2
         RETURNING *`,
        [input.productId, cantidadDelta, bloqueadaDelta],
      );
      const rows = Array.isArray(result?.[0]) ? result[0] : [];
      if (rows.length === 0) {
        const existe = await em.findOne(Product, { where: { id: input.productId } });
        if (!existe) throw new NotFoundException('Producto no encontrado');
        throw new BadRequestException(
          `Movimiento inválido para el producto ${existe.codigo}: las existencias quedarían negativas o la cantidad bloqueada superaría la existencia`,
        );
      }
      const producto = rows[0] as any;

      const movimiento = em.create(InventoryMovement, {
        empresaId: producto.empresa_id,
        productId: input.productId,
        tipo: input.tipo,
        cantidadDelta,
        cantidadBloqueadaDelta: bloqueadaDelta,
        cantidadResultante: producto.cantidad,
        bloqueadaResultante: producto.cantidad_bloqueada,
        docTipo: input.docTipo ?? null,
        docId: input.docId ?? null,
        usuarioId: input.usuarioId ?? null,
      });
      return em.save(movimiento);
    };

    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  /** Consulta de movimientos por producto (trazabilidad, M18). */
  async byProduct(productId: string, limit = 100) {
    return this.dataSource.getRepository(InventoryMovement).find({
      where: { productId },
      order: { fecha: 'DESC' },
      take: Math.min(500, limit),
    });
  }

  /** Consulta por empresa (auditoría operativa y dashboard). */
  async byEmpresa(empresaId: string, limit = 200) {
    return this.dataSource.getRepository(InventoryMovement).find({
      where: { empresaId },
      order: { fecha: 'DESC' },
      take: Math.min(1000, limit),
    });
  }

  /**
   * Invariante de reconciliación (usado en pruebas y monitoreo):
   * la suma de movimientos de un producto debe igualar su saldo actual.
   */
  async reconcile(productId: string): Promise<{
    cantidadSaldo: number;
    bloqueadaSaldo: number;
    cantidadMovimientos: number;
    bloqueadaMovimientos: number;
    consistente: boolean;
  }> {
    const producto = await this.dataSource
      .getRepository(Product)
      .findOne({ where: { id: productId } });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    const [sumas] = await this.dataSource.query(
      `SELECT COALESCE(SUM(cantidad_delta),0)::int AS c, COALESCE(SUM(cantidad_bloqueada_delta),0)::int AS b
       FROM inventory_movements WHERE product_id = $1`,
      [productId],
    );
    // Nota: el saldo inicial del producto se crea en 0; cualquier carga
    // inicial (importación) se hace vía movimientos (I4).
    return {
      cantidadSaldo: producto.cantidad,
      bloqueadaSaldo: producto.cantidadBloqueada,
      cantidadMovimientos: sumas.c,
      bloqueadaMovimientos: sumas.b,
      consistente: producto.cantidad === sumas.c && producto.cantidadBloqueada === sumas.b,
    };
  }
}
