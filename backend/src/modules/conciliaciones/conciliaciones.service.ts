import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { Product } from '../products/entities/product.entity';
import { ImportParserService } from '../imports/import-parser.service';
import { AuditService } from '../audit/audit.service';
import { UploadedFilePayload } from '../documents/documents.service';

type Usuario = { id: string; username: string; rol?: string };
import {
  CAMPOS_CONCILIACION,
  CampoComparable,
  conciliar,
  ResultadoConciliacion,
} from './conciliacion-logic';

const COMPARABLES = new Set<string>(CAMPOS_CONCILIACION.comparables);

/**
 * I65h — Conciliaciones WO vs. SofIA (solo Administrador).
 * Carga el archivo de productos exportado de World Office y lo cruza con la
 * base de datos de la empresa seleccionada: existencias, precios y cualquier
 * otro campo mapeado. El reporte se muestra en pantalla y se exporta a CSV.
 */
@Injectable()
export class ConciliacionesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly parser: ImportParserService,
    private readonly audit: AuditService,
  ) {}

  /** Paso 1: columnas del archivo, para que la UI arme el mapeo. */
  columnas(file: UploadedFilePayload) {
    if (!file) throw new BadRequestException('Debe adjuntar el archivo de World Office');
    const parsed = this.parser.parse(file.buffer, file.originalname);
    return { columnas: parsed.columnas, filas: parsed.filas.length };
  }

  /** Paso 2: ejecuta la conciliación con el mapeo confirmado. */
  async conciliar(
    empresaId: string,
    mapeoJson: string,
    file: UploadedFilePayload,
    user: Usuario,
  ): Promise<ResultadoConciliacion & { empresa: { id: string; nombre: string; siglas: string } }> {
    if (!file) throw new BadRequestException('Debe adjuntar el archivo de World Office');
    const empresa = await this.dataSource.getRepository(Company).findOne({
      where: { id: empresaId },
    });
    if (!empresa) throw new BadRequestException('Empresa no encontrada');

    let mapeo: Record<string, string>;
    try {
      mapeo = JSON.parse(mapeoJson ?? '{}');
    } catch {
      throw new BadRequestException('El mapeo de columnas no es un JSON válido');
    }
    const destinos = Object.values(mapeo);
    if (!destinos.includes('codigo')) {
      throw new BadRequestException("El mapeo debe incluir la columna del campo 'codigo'");
    }
    const camposMapeados = destinos.filter((d) =>
      COMPARABLES.has(d),
    ) as CampoComparable[];
    if (camposMapeados.length === 0) {
      throw new BadRequestException(
        'Mapee al menos un campo a comparar (existencia, precio u otro)',
      );
    }
    for (const d of destinos) {
      if (d !== 'codigo' && !COMPARABLES.has(d) && d !== 'ignorar') {
        throw new BadRequestException(`Campo destino '${d}' no comparable`);
      }
    }

    const parsed = this.parser.parse(file.buffer, file.originalname);
    const filasWo = parsed.filas.map((fila) => {
      const datos: Record<string, string> = {};
      for (const [columna, destino] of Object.entries(mapeo)) {
        if (destino === 'ignorar') continue;
        datos[destino] = (fila[columna] ?? '').trim();
      }
      return datos;
    });

    const productos = await this.dataSource.getRepository(Product).find({
      where: { empresaId },
    });

    const resultado = conciliar(
      filasWo,
      productos.map((p) => ({
        codigo: p.codigo,
        descripcion: p.descripcion,
        marca: p.marca,
        unidadMedida: p.unidadMedida,
        codigoOE: p.codigoOE,
        cantidad: p.cantidad,
        precio: p.precio,
      })),
      camposMapeados,
    );

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'CONCILIACION_EJECUTADA',
      tabla: 'Productos',
      registroId: empresaId,
      valorNuevo: {
        empresa: empresa.nombre,
        archivo: file.originalname,
        totalArchivo: resultado.totalArchivo,
        coinciden: resultado.coinciden,
        conDiferencias: resultado.conDiferencias,
        noEncontrados: resultado.noEncontrados,
        faltantesEnWo: resultado.faltantesEnWo,
      },
    });

    return { ...resultado, empresa: { id: empresa.id, nombre: empresa.nombre, siglas: empresa.siglas } };
  }
}
