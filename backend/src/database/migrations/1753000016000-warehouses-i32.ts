import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I32 (HU-014, EP-11 / M16): mapa 2D de bodega.
 * Tablas: warehouses (forma), warehouse_floors, warehouse_aisles (cajones
 * móviles), warehouse_zones (lado del pasillo), warehouse_racks (estantes),
 * warehouse_areas (entrada/patio/bahías) y warehouse_product_locations
 * (asociación producto↔ubicación, con tránsito y multi-ubicación).
 */
export class WarehousesI321753000016000 implements MigrationInterface {
  name = 'WarehousesI321753000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE warehouse_forma_enum AS ENUM ('RECTANGULO','CUADRADO')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre varchar(150) NOT NULL UNIQUE,
        forma warehouse_forma_enum NOT NULL DEFAULT 'RECTANGULO',
        ancho_m int NOT NULL DEFAULT 40,
        alto_m int NOT NULL DEFAULT 30,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouse_floors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        numero int NOT NULL,
        alias varchar(120),
        tiene_areas_fijas boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (warehouse_id, numero)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS warehouse_floors_warehouse_idx ON warehouse_floors (warehouse_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouse_aisles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        floor_id uuid NOT NULL REFERENCES warehouse_floors(id) ON DELETE CASCADE,
        numero int NOT NULL,
        alias varchar(120),
        color varchar(30),
        pos_x double precision NOT NULL DEFAULT 0,
        pos_y double precision NOT NULL DEFAULT 0,
        ancho_m double precision NOT NULL DEFAULT 10,
        alto_m double precision NOT NULL DEFAULT 4,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (floor_id, numero)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS warehouse_aisles_floor_idx ON warehouse_aisles (floor_id)`,
    );

    await queryRunner.query(`
      CREATE TYPE warehouse_zone_lado_enum AS ENUM ('IZQUIERDA','DERECHA','FONDO')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouse_zones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        aisle_id uuid NOT NULL REFERENCES warehouse_aisles(id) ON DELETE CASCADE,
        lado warehouse_zone_lado_enum NOT NULL,
        alias varchar(120),
        color varchar(30),
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (aisle_id, lado)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS warehouse_zones_aisle_idx ON warehouse_zones (aisle_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouse_racks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        zone_id uuid NOT NULL REFERENCES warehouse_zones(id) ON DELETE CASCADE,
        numero int NOT NULL,
        alias varchar(120),
        niveles int NOT NULL DEFAULT 3,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (zone_id, numero)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS warehouse_racks_zone_idx ON warehouse_racks (zone_id)`,
    );

    await queryRunner.query(`
      CREATE TYPE warehouse_area_tipo_enum AS ENUM ('ENTRADA','PATIO_MANIOBRAS','BAHIA_EMPAQUE','BAHIA_TEMPORAL')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouse_areas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        floor_id uuid NOT NULL REFERENCES warehouse_floors(id) ON DELETE CASCADE,
        tipo warehouse_area_tipo_enum NOT NULL,
        alias varchar(120),
        pos_x double precision NOT NULL DEFAULT 0,
        pos_y double precision NOT NULL DEFAULT 0,
        ancho_m double precision NOT NULL DEFAULT 8,
        alto_m double precision NOT NULL DEFAULT 4,
        permite_productos boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (floor_id, tipo)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS warehouse_areas_floor_idx ON warehouse_areas (floor_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS warehouse_product_locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        rack_id uuid REFERENCES warehouse_racks(id) ON DELETE CASCADE,
        nivel int,
        area_id uuid REFERENCES warehouse_areas(id) ON DELETE CASCADE,
        transito boolean NOT NULL DEFAULT false,
        cantidad int NOT NULL DEFAULT 0,
        es_oficial boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (product_id, rack_id, nivel)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS wpl_product_idx ON warehouse_product_locations (product_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS wpl_rack_idx ON warehouse_product_locations (rack_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS warehouse_product_locations`);
    await queryRunner.query(`DROP TABLE IF EXISTS warehouse_areas`);
    await queryRunner.query(`DROP TYPE IF EXISTS warehouse_area_tipo_enum`);
    await queryRunner.query(`DROP TABLE IF EXISTS warehouse_racks`);
    await queryRunner.query(`DROP TABLE IF EXISTS warehouse_zones`);
    await queryRunner.query(`DROP TYPE IF EXISTS warehouse_zone_lado_enum`);
    await queryRunner.query(`DROP TABLE IF EXISTS warehouse_aisles`);
    await queryRunner.query(`DROP TABLE IF EXISTS warehouse_floors`);
    await queryRunner.query(`DROP TABLE IF EXISTS warehouses`);
    await queryRunner.query(`DROP TYPE IF EXISTS warehouse_forma_enum`);
  }
}
