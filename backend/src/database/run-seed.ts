import { AppDataSource } from './data-source';
import { runInitialSeed } from './seeds/initial.seed';

/**
 * Ejecuta migraciones + semillas desde línea de comandos: `npm run seed`.
 */
async function main() {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await runInitialSeed(AppDataSource);
  console.log('Migraciones y semillas iniciales aplicadas.');
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
