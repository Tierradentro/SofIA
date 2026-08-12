import { BadRequestException, ValidationError } from '@nestjs/common';

/**
 * QA Func. 1.3: traduce los mensajes por defecto de class-validator (inglés)
 * a español de forma GENÉRICA, interpretando el nombre del validador
 * (error.constraints) y el campo (error.property). Cubre todos los DTOs sin
 * tocar cada decorador.
 *
 * Los mensajes personalizados que ya existen en algunos DTOs (escritos en
 * español) se respetan: solo se traducen los que siguen las plantillas por
 * defecto de class-validator.
 */

/** Detecta las plantillas por defecto de class-validator (inglés). */
function esMensajePorDefecto(mensaje: string): boolean {
  return (
    /^property .+ should not exist$/.test(mensaje) ||
    /^each value in /.test(mensaje) ||
    /^\S+ (must|should) /.test(mensaje)
  );
}

function numeroEn(mensaje: string): string | null {
  const m = mensaje.match(/\d+/);
  return m ? m[0] : null;
}

function traducirConstraint(
  tipo: string,
  campo: string,
  original: string,
): string {
  switch (tipo) {
    case 'isNotEmpty':
      return `El campo '${campo}' es obligatorio`;
    case 'isString':
      return `El campo '${campo}' debe ser texto`;
    case 'isInt':
      return `El campo '${campo}' debe ser un número entero`;
    case 'isNumber':
      return `El campo '${campo}' debe ser numérico`;
    case 'isBoolean':
      return `El campo '${campo}' debe ser verdadero o falso`;
    case 'isUUID':
      return `El campo '${campo}' debe ser un identificador válido`;
    case 'isEmail':
      return `El campo '${campo}' debe ser un correo electrónico válido`;
    case 'isEnum':
      return `El campo '${campo}' tiene un valor no permitido`;
    case 'isDateString':
    case 'isDate':
      return `El campo '${campo}' debe ser una fecha válida`;
    case 'isArray':
      return `El campo '${campo}' debe ser una lista`;
    case 'maxLength': {
      const max = numeroEn(original);
      return max
        ? `El campo '${campo}' no puede superar ${max} caracteres`
        : `El campo '${campo}' es demasiado largo`;
    }
    case 'minLength': {
      const min = numeroEn(original);
      return min
        ? `El campo '${campo}' debe tener al menos ${min} caracteres`
        : `El campo '${campo}' es demasiado corto`;
    }
    case 'min': {
      const min = numeroEn(original);
      return min
        ? `El campo '${campo}' debe ser mayor o igual a ${min}`
        : `El campo '${campo}' está por debajo del mínimo permitido`;
    }
    case 'max': {
      const max = numeroEn(original);
      return max
        ? `El campo '${campo}' debe ser menor o igual a ${max}`
        : `El campo '${campo}' supera el máximo permitido`;
    }
    case 'arrayMinSize':
      return `El campo '${campo}' debe contener al menos un elemento`;
    case 'arrayMaxSize': {
      const max = numeroEn(original);
      return max
        ? `El campo '${campo}' no puede contener más de ${max} elementos`
        : `El campo '${campo}' contiene demasiados elementos`;
    }
    case 'whitelistValidation':
      return `El campo '${campo}' no está permitido`;
    default:
      return `El campo '${campo}' no es válido`;
  }
}

function formatear(error: ValidationError, prefijo = ''): string[] {
  const campo = prefijo ? `${prefijo}.${error.property}` : error.property;
  if (error.constraints && Object.keys(error.constraints).length > 0) {
    return Object.entries(error.constraints).map(([tipo, original]) =>
      esMensajePorDefecto(original)
        ? traducirConstraint(tipo, campo, original)
        : original, // mensaje personalizado (español): se respeta
    );
  }
  // Validación anidada (@ValidateNested): recorrer hijos con la ruta
  return (error.children ?? []).flatMap((hijo) => formatear(hijo, campo));
}

/** exceptionFactory del ValidationPipe global (main.ts). */
export function traducirErroresValidacion(
  errors: ValidationError[],
): BadRequestException {
  const mensajes = errors.flatMap((e) => formatear(e));
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDACION',
    message: mensajes.length > 0 ? mensajes : ['La solicitud no es válida'],
    error: 'Solicitud inválida',
  });
}
