import type { LucideIcon } from 'lucide-react';

/** I17: primitivas visuales compartidas (sistema de diseño de las plantillas). */

export function Tarjeta({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`rounded-xl bg-white shadow-sm ${className}`}>{children}</div>;
}

const TONOS_STAT = {
  marino: 'bg-sofia-900 text-menta-300',
  menta: 'bg-menta-400 text-sofia-900',
  azul: 'bg-sofia-100 text-sofia-700',
  rosa: 'bg-rose-100 text-rose-600',
} as const;

/** Tarjeta KPI del dashboard (icono + etiqueta + valor + unidad/detalle). */
export function TarjetaStat({
  icono: Icono,
  etiqueta,
  valor,
  unidad,
  detalle,
  tono = 'azul',
}: {
  icono: LucideIcon;
  etiqueta: string;
  valor: string;
  unidad?: string;
  detalle?: string;
  tono?: keyof typeof TONOS_STAT;
}) {
  return (
    <Tarjeta className="flex items-center gap-4 p-5">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TONOS_STAT[tono]}`}>
        <Icono size={22} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</p>
        <p className="text-2xl font-bold text-slate-900">
          {valor}
          {unidad && <span className="ml-1 text-sm font-medium text-slate-500">{unidad}</span>}
        </p>
        {detalle && <p className="text-xs text-slate-400">{detalle}</p>}
      </div>
    </Tarjeta>
  );
}

const TONOS_INSIGNIA = {
  menta: 'bg-menta-100 text-menta-700',
  azul: 'bg-sofia-100 text-sofia-700',
  ambar: 'bg-amber-100 text-amber-700',
  rojo: 'bg-red-100 text-red-700',
  verde: 'bg-green-100 text-green-700',
  gris: 'bg-slate-100 text-slate-600',
} as const;

/**
 * I21: color por estado de pedido en pestañas (cola del dashboard y vista
 * de Pedidos y alistamiento). `activa` = borde + texto + fondo suave;
 * `punto` = indicador circular.
 */
export const COLORES_PESTANA: Record<string, { activa: string; punto: string }> = {
  ABIERTO: {
    activa: 'border-amber-500 text-amber-700 bg-amber-50',
    punto: 'bg-amber-500',
  },
  ALISTADO: {
    activa: 'border-sky-500 text-sky-700 bg-sky-50',
    punto: 'bg-sky-500',
  },
  APROBADO: {
    activa: 'border-menta-600 text-menta-700 bg-menta-50',
    punto: 'bg-menta-500',
  },
  PENDIENTE_CORRECCION: {
    activa: 'border-red-500 text-red-700 bg-red-50',
    punto: 'bg-red-500',
  },
  CANCELADO: {
    activa: 'border-slate-400 text-slate-600 bg-slate-100',
    punto: 'bg-slate-400',
  },
  DESPACHADO: {
    activa: 'border-emerald-600 text-emerald-700 bg-emerald-50',
    punto: 'bg-emerald-500',
  },
  OTROS: {
    activa: 'border-sofia-700 text-sofia-700 bg-sofia-50',
    punto: 'bg-sofia-700',
  },
};

export type TonoInsignia = keyof typeof TONOS_INSIGNIA;

/** Píldora de estado (PRINCIPAL, ABIERTO, Incompleto, etc.). */
export function Insignia({
  tono = 'gris',
  children,
}: {
  tono?: TonoInsignia;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONOS_INSIGNIA[tono]}`}>
      {children}
    </span>
  );
}

/** Encabezado de página: título grande + descripción opcional + acciones a la derecha. */
export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-slate-500">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </div>
  );
}

/** Clases de tabla del sistema (encabezados en mayúsculas, filas con hover). */
export const CLASES_TABLA = {
  tabla: 'w-full text-sm',
  cabecera: 'border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
  celdaCabecera: 'px-4 py-3',
  fila: 'border-b border-slate-100 last:border-0 hover:bg-slate-50',
  celda: 'px-4 py-3',
} as const;

/** Botón primario marino (acciones principales de formularios). */
export const CLASE_BOTON_PRIMARIO =
  'rounded-lg bg-sofia-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sofia-600 disabled:opacity-50';

/** Botón secundario (filtros, cancelar). */
export const CLASE_BOTON_SECUNDARIO =
  'rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50';

/** Campo de texto estándar. */
export const CLASE_INPUT =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500';
