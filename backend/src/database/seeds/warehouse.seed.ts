import { DataSource } from 'typeorm';
import { Warehouse, BodegaForma } from '../../modules/warehouses/entities/warehouse.entity';
import { WarehouseFloor } from '../../modules/warehouses/entities/warehouse-floor.entity';
import { WarehouseAisle } from '../../modules/warehouses/entities/warehouse-aisle.entity';
import { WarehouseZone, ZonaLado } from '../../modules/warehouses/entities/warehouse-zone.entity';
import { WarehouseRack } from '../../modules/warehouses/entities/warehouse-rack.entity';
import { WarehouseArea, AreaTipo } from '../../modules/warehouses/entities/warehouse-area.entity';

/**
 * I32: bodega de ejemplo preconfigurada (idempotente) para probar el mapa 2D.
 * Refleja la bodega real: piso 1 con entrada, patio de maniobras, bahía de
 * empaque, bahía temporal y 3 pasillos; piso 2 con 3 pasillos (sin áreas
 * fijas). Cada pasillo tiene zonas izquierda/derecha (5 estantes de 3
 * niveles) y fondo (un solo espacio).
 */
export async function runWarehouseSeed(dataSource: DataSource): Promise<void> {
  const wRepo = dataSource.getRepository(Warehouse);
  const existe = await wRepo.findOne({ where: { nombre: 'Bodega Principal' } });
  if (existe) return;

  const bodega = await wRepo.save(
    wRepo.create({
      nombre: 'Bodega Principal',
      forma: BodegaForma.RECTANGULO,
      anchoM: 40,
      altoM: 30,
      activo: true,
    }),
  );

  const areaRepo = dataSource.getRepository(WarehouseArea);
  const pasilloRepo = dataSource.getRepository(WarehouseAisle);
  const zonaRepo = dataSource.getRepository(WarehouseZone);
  const rackRepo = dataSource.getRepository(WarehouseRack);
  const pisoRepo = dataSource.getRepository(WarehouseFloor);

  for (const numPiso of [1, 2]) {
    const piso = await pisoRepo.save(
      pisoRepo.create({
        warehouseId: bodega.id,
        numero: numPiso,
        alias: `Piso ${numPiso}`,
        tieneAreasFijas: numPiso === 1,
        activo: true,
      }),
    );

    if (numPiso === 1) {
      const areas: Array<Partial<WarehouseArea>> = [
        { tipo: AreaTipo.ENTRADA, alias: 'Entrada', posX: 17, posY: 0, anchoM: 6, altoM: 0, permiteProductos: false },
        { tipo: AreaTipo.PATIO_MANIOBRAS, alias: 'Patio de Maniobras', posX: 2, posY: 1, anchoM: 36, altoM: 4, permiteProductos: false },
        { tipo: AreaTipo.BAHIA_EMPAQUE, alias: 'Bahía de Empaque', posX: 2, posY: 6, anchoM: 8, altoM: 4, permiteProductos: true },
        { tipo: AreaTipo.BAHIA_TEMPORAL, alias: 'Bahía Temporal', posX: 30, posY: 6, anchoM: 8, altoM: 4, permiteProductos: true },
      ];
      for (const a of areas) {
        await areaRepo.save(areaRepo.create({ ...a, floorId: piso.id, activo: true } as WarehouseArea));
      }
    }

    for (let numPasillo = 1; numPasillo <= 3; numPasillo++) {
      const pasillo = await pasilloRepo.save(
        pasilloRepo.create({
          floorId: piso.id,
          numero: numPasillo,
          alias: `Pasillo ${numPasillo}`,
          posX: 2 + (numPasillo - 1) * 12,
          posY: 12,
          anchoM: 11,
          altoM: 16,
          activo: true,
        }),
      );
      for (const lado of [ZonaLado.IZQUIERDA, ZonaLado.DERECHA]) {
        const zona = await zonaRepo.save(
          zonaRepo.create({
            aisleId: pasillo.id,
            lado,
            alias: lado === ZonaLado.IZQUIERDA ? 'Izquierda' : 'Derecha',
            activo: true,
          }),
        );
        for (let numEstante = 1; numEstante <= 5; numEstante++) {
          await rackRepo.save(
            rackRepo.create({
              zoneId: zona.id,
              numero: numEstante,
              alias: `E${numEstante}`,
              niveles: 3,
              activo: true,
            }),
          );
        }
      }
      await zonaRepo.save(
        zonaRepo.create({
          aisleId: pasillo.id,
          lado: ZonaLado.FONDO,
          alias: 'Fondo (temporal)',
          activo: true,
        }),
      );
    }
  }
}
