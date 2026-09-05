import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * I23: el chequeo de salud ahora incluye la conexión a la base de datos.
   * Tras un redeploy, un `curl /api/v1/health` permite distinguir de inmediato
   * "backend sin BD" (baseDatos: 'error') de un problema de otro tipo,
   * sin exponer datos sensibles.
   * I36: además verifica que el esquema esté al día (showMigrations): durante
   * la ventana en que las migraciones de un deploy aún corren, el health
   * reporta migraciones='pendientes' y estado 'degradado' en vez de mentir
   * con un "ok". La señal queda disponible para bloquear tráfico real hasta
   * que migraciones === 'al_dia'.
   */
  @Public()
  @Get('health')
  async health() {
    let baseDatos: 'ok' | 'error' = 'ok';
    let migraciones: 'al_dia' | 'pendientes' | 'desconocido' = 'desconocido';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      baseDatos = 'error';
    }
    if (baseDatos === 'ok') {
      try {
        migraciones = (await this.dataSource.showMigrations()) ? 'pendientes' : 'al_dia';
      } catch {
        migraciones = 'desconocido';
      }
    }
    const alDia = baseDatos === 'ok' && migraciones === 'al_dia';
    return {
      status: alDia ? 'ok' : 'degradado',
      servicio: 'sofia-backend',
      version: '0.1.0',
      baseDatos,
      migraciones,
    };
  }
}
