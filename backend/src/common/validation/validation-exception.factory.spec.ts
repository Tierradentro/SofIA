import { BadRequestException, ValidationError } from '@nestjs/common';
import { traducirErroresValidacion } from './validation-exception.factory';

/** Construye un ValidationError como los que produce class-validator. */
function error(
  property: string,
  constraints: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError {
  return { property, constraints, children } as ValidationError;
}

describe('traducirErroresValidacion (QA Func. 1.3)', () => {
  const ejecutar = (errors: ValidationError[]) => {
    const ex = traducirErroresValidacion(errors);
    expect(ex).toBeInstanceOf(BadRequestException);
    return ex.getResponse() as { statusCode: number; message: string[] };
  };

  it('traduce los validadores comunes a español', () => {
    const body = ejecutar([
      error('codigo', { isNotEmpty: 'codigo should not be empty' }),
      error('descripcion', {
        maxLength:
          'descripcion must be shorter than or equal to 250 characters',
      }),
      error('cantidad', { isInt: 'cantidad must be an integer number' }),
      error('precio', { min: 'precio must not be less than 0' }),
      error('email', { isEmail: 'email must be an email' }),
      error('empresaId', { isUUID: 'empresaId must be a UUID' }),
      error('estado', { isEnum: 'estado must be a valid enum value' }),
    ]);
    expect(body.statusCode).toBe(400);
    expect(body.message).toEqual([
      "El campo 'codigo' es obligatorio",
      "El campo 'descripcion' no puede superar 250 caracteres",
      "El campo 'cantidad' debe ser un número entero",
      "El campo 'precio' debe ser mayor o igual a 0",
      "El campo 'email' debe ser un correo electrónico válido",
      "El campo 'empresaId' debe ser un identificador válido",
      "El campo 'estado' tiene un valor no permitido",
    ]);
  });

  it('traduce campos no permitidos (whitelist) y min/max de longitud', () => {
    const body = ejecutar([
      error('campoExtra', {
        whitelistValidation: 'property campoExtra should not exist',
      }),
      error('telefonos', {
        minLength: 'telefonos must be longer than or equal to 7 characters',
      }),
    ]);
    expect(body.message).toContain("El campo 'campoExtra' no está permitido");
    expect(body.message).toContain(
      "El campo 'telefonos' debe tener al menos 7 caracteres",
    );
  });

  it('respeta mensajes personalizados en español (no los sobrescribe)', () => {
    const personalizado = 'La clave debe tener al menos 8 caracteres';
    const body = ejecutar([
      error('claveNueva', { minLength: personalizado }),
    ]);
    expect(body.message).toEqual([personalizado]);
  });

  it('recorre validación anidada con la ruta del campo', () => {
    const hijo = error('cantidad', {
      isInt: 'cantidad must be an integer number',
    });
    const body = ejecutar([error('items', {}, [hijo])]);
    expect(body.message).toEqual([
      "El campo 'items.cantidad' debe ser un número entero",
    ]);
  });

  it('constraint desconocido → mensaje genérico en español', () => {
    const body = ejecutar([
      error('campo', { isCustomValidator: 'campo must satisfy custom rule' }),
    ]);
    expect(body.message).toEqual(["El campo 'campo' no es válido"]);
  });
});
