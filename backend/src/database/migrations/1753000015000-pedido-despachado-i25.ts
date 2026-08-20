import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I25: nuevo estado de pedido DESPACHADO.
 * El pedido sale de APROBADO cuando el despacho que lo contiene queda
 * despachado por completo (sin unidades pendientes).
 * PostgreSQL no permite retirar valores de un enum, por eso `down` es no-op.
 */
export class PedidoDespachadoI251753000015000 implements MigrationInterface {
  name = 'PedidoDespachadoI251753000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'DESPACHADO'`,
    );
  }

  public async down(): Promise<void> {
    // No-op: PostgreSQL no soporta eliminar valores de un tipo enum.
  }
}
