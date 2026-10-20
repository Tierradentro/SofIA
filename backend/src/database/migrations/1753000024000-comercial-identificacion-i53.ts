import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I53: la identificación de los comerciales se conserva solo con dígitos.
 * World Office exige números limpios en el Tercero Interno y los registros
 * con prefijo (CC, puntos, guiones) causaban rechazos en la importación.
 */
export class ComercialIdentificacionDigitosI531753000024000 implements MigrationInterface {
  name = 'ComercialIdentificacionDigitosI531753000024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE comerciales
       SET identificacion = regexp_replace(identificacion, '\\D', '', 'g')
       WHERE identificacion IS NOT NULL
         AND identificacion ~ '\\D'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los caracteres originales no se pueden reconstruir; la limpieza es
    // intencional e irreversible (los dígitos son la forma canónica).
  }
}
