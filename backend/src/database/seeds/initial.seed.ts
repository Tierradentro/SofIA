import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../../modules/users/entities/user.entity';
import { Company } from '../../modules/companies/entities/company.entity';
import {
  SystemParam,
  PARAM_KEYS,
} from '../../modules/params/entities/system-param.entity';
import { PqrsReason } from '../../modules/pqrs/entities/pqrs-reason.entity';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { PqrsConcept } from '../../common/enums/pqrs-concept.enum';
import { runWarehouseSeed } from './warehouse.seed';

/**
 * Semillas I0 (idempotentes):
 * - Empresas IRE e ICV (con siglas para el consecutivo de pedido, P-09).
 * - Usuario Admin / Admin (rol Administrador, cambio de clave obligatorio, M14).
 * - Parámetros del sistema (política de claves M02, rate limit API §7, motor OCR M13).
 * - Catálogo de motivos PQRS G01–G40 / N01–N18 (Spec §6).
 */
export async function runInitialSeed(dataSource: DataSource): Promise<void> {
  const companyRepo = dataSource.getRepository(Company);
  const userRepo = dataSource.getRepository(User);
  const paramRepo = dataSource.getRepository(SystemParam);
  const reasonRepo = dataSource.getRepository(PqrsReason);

  // ---- Empresas ----
  for (const c of [
    { nombre: 'IRE', siglas: 'IRE', descripcion: 'Empresa IRE' },
    { nombre: 'ICV', siglas: 'ICV', descripcion: 'Empresa ICV' },
  ]) {
    // `siglas` es la clave de negocio inmutable (P-09); `nombre` es editable
    // desde la UI de Empresas. Si se busca solo por nombre, renombrar IRE/ICV
    // hace que un reinicio reintente el INSERT y choque con UQ_companies_siglas
    // (crash-loop del backend). Se verifica por cualquiera de los dos campos.
    const exists = await companyRepo.findOne({
      where: [{ nombre: c.nombre }, { siglas: c.siglas }],
    });
    if (!exists) await companyRepo.save(companyRepo.create(c));
  }

  // ---- Usuario Admin (M02/M14) ----
  const admin = await userRepo.findOne({ where: { username: 'Admin' } });
  if (!admin) {
    await userRepo.save(
      userRepo.create({
        nombre: 'Administrador del sistema',
        descripcion: 'Usuario inicial',
        username: 'Admin',
        email: 'admin@sofia.local',
        passwordHash: await bcrypt.hash('Admin', 10),
        rol: Role.ADMINISTRADOR,
        estado: UserStatus.ACTIVO,
        debeCambiarClave: true,
      }),
    );
  }

  // ---- Parámetros ----
  const params: Array<{ clave: string; valor: any; descripcion: string }> = [
    {
      clave: PARAM_KEYS.PASSWORD_POLICY,
      valor: {
        min_length: 6,
        require_uppercase: true,
        require_lowercase: true,
        require_number: true,
        expiration_days: 60,
        max_failed_attempts: 5,
      },
      descripcion: 'Política de contraseñas',
    },
    {
      clave: PARAM_KEYS.API_RATE_LIMIT,
      valor: { requests_per_minute: 20 },
      descripcion: 'Límite de peticiones de la API externa',
    },
    {
      clave: PARAM_KEYS.OCR_ACTIVE_ENGINE,
      valor: { engine: 'OCR_LOCAL' },
      descripcion: 'Motor OCR activo',
    },
  ];
  for (const p of params) {
    const exists = await paramRepo.findOne({ where: { clave: p.clave } });
    if (!exists) await paramRepo.save(paramRepo.create(p));
  }

  // ---- Motivos PQRS (Spec §6) ----
  const garantia: Array<[string, string]> = [
    ['G01', 'Defecto de fabricación'],
    ['G02', 'Fuga de aceite'],
    ['G03', 'Fuga de refrigerante'],
    ['G04', 'Fuga de combustible'],
    ['G05', 'Fuga de líquido hidráulico'],
    ['G06', 'Pérdida de presión'],
    ['G07', 'No genera presión'],
    ['G08', 'No funciona'],
    ['G09', 'No enciende'],
    ['G10', 'No da marcha'],
    ['G11', 'No carga'],
    ['G12', 'No genera energía'],
    ['G13', 'No da chispa'],
    ['G14', 'No succiona combustible'],
    ['G15', 'No lubrica'],
    ['G16', 'No sella'],
    ['G17', 'Termostato no abre'],
    ['G18', 'Termostato no cierra'],
    ['G19', 'Ruido anormal'],
    ['G20', 'Golpeteo interno'],
    ['G21', 'Vibración excesiva'],
    ['G22', 'Se queda pegado'],
    ['G23', 'Se frena o bloquea'],
    ['G24', 'Sobrecalentamiento'],
    ['G25', 'Rotura o fractura'],
    ['G26', 'Fisura'],
    ['G27', 'Desprendimiento de componentes'],
    ['G28', 'Desgaste prematuro'],
    ['G29', 'Rodamiento defectuoso'],
    ['G30', 'Deformación del componente'],
    ['G31', 'Falta de tensión'],
    ['G32', 'Descompresión o pérdida de vacío'],
    ['G33', 'Cristalización del material'],
    ['G34', 'Medida fuera de especificación'],
    ['G35', 'Defecto de ensamble'],
    ['G36', 'Empaque o sello defectuoso'],
    ['G37', 'Conector o terminal defectuoso'],
    ['G38', 'Falla eléctrica'],
    ['G39', 'Indicador del tablero no se apaga'],
    ['G40', 'Otro defecto de garantía'],
  ];
  const noAplica: Array<[string, string]> = [
    ['N01', 'Error en el pedido del cliente'],
    ['N02', 'Error del comercial'],
    ['N03', 'Error de despacho'],
    ['N04', 'Referencia incorrecta'],
    ['N05', 'Vehículo incompatible'],
    ['N06', 'Modelo incorrecto'],
    ['N07', 'Lado incorrecto de la pieza'],
    ['N08', 'Medida incorrecta solicitada'],
    ['N09', 'Marca diferente solicitada'],
    ['N10', 'Producto solicitado por error'],
    ['N11', 'Cambio por decisión del cliente'],
    ['N12', 'Producto incompleto'],
    ['N13', 'Mayor valor facturado'],
    ['N14', 'Error de facturación'],
    ['N15', 'Accesorios faltantes'],
    ['N16', 'No corresponde al combustible (Gasolina/Diésel)'],
    ['N17', 'No corresponde a la aplicación'],
    ['N18', 'Otro motivo comercial'],
  ];
  for (const [codigo, descripcion] of garantia) {
    const exists = await reasonRepo.findOne({ where: { codigo } });
    if (!exists)
      await reasonRepo.save(
        reasonRepo.create({ codigo, concepto: PqrsConcept.GARANTIA, descripcion }),
      );
  }
  for (const [codigo, descripcion] of noAplica) {
    const exists = await reasonRepo.findOne({ where: { codigo } });
    if (!exists)
      await reasonRepo.save(
        reasonRepo.create({ codigo, concepto: PqrsConcept.GARANTIA_NO_APLICA, descripcion }),
      );
  }

  // ---- I32: bodega de ejemplo para el mapa 2D ----
  await runWarehouseSeed(dataSource);
}
