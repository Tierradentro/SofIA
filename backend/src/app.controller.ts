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
   */
  @Public()
  @Get('health')
  async health() {
    let baseDatos: 'ok' | 'error' = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      baseDatos = 'error';
    }
    return {
      status: baseDatos === 'ok' ? 'ok' : 'degradado',
      servicio: 'sofia-backend',
      version: '0.1.0',
      baseDatos,
    };
  }
}
