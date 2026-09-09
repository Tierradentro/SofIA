'use client';

import React from 'react';

/**
 * I39: visual "Orden de Pedido" (formato documento) compartido entre la
 * creación (/pedidos/nuevo) y la consulta del pedido en Pedidos/Alistamiento
 * (opción Abrir). La cabecera del documento muestra la empresa emisora, el
 * número de orden y el estado; en la consulta se adicionan la factura
 * relacionada y la trazabilidad desde la creación hasta la última novedad.
 */

export interface EstadoDoc {
  texto: string;
  punto: string;
  tinte: string;
}

export const ESTADOS_DOC: Record<string, EstadoDoc> = {
  DIGITACION: { texto: 'En digitación', punto: 'bg-green-500', tinte: 'text-green-300' },
  ABIERTO: { texto: 'Abierto', punto: 'bg-amber-400', tinte: 'text-amber-300' },
  ALISTADO: { texto: 'Alistado', punto: 'bg-blue-400', tinte: 'text-blue-300' },
  APROBADO: { texto: 'Aprobado', punto: 'bg-green-500', tinte: 'text-green-300' },
  DESPACHADO: { texto: 'Despachado', punto: 'bg-slate-400', tinte: 'text-slate-300' },
  PENDIENTE_CORRECCION: { texto: 'Pendiente corrección', punto: 'bg-red-400', tinte: 'text-red-300' },
  CANCELADO: { texto: 'Cancelado', punto: 'bg-slate-500', tinte: 'text-slate-400' },
};

/** Clases de campos del documento (misma apariencia en crear y consultar). */
export const docCampo = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
export const docInput =
  'mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm normal-case tracking-normal';
export const docInputDisabled = `${docInput} bg-slate-50 text-slate-700`;

/** Marco del documento: barra azul con título y acciones. */
export function MarcoDocumento({
  titulo,
  acciones,
  children,
}: {
  titulo: string;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 max-w-6xl overflow-hidden rounded-lg bg-white shadow">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-sofia-900 px-5 py-3 text-white">
        <h2 className="font-semibold">{titulo}</h2>
        {acciones && <div className="flex flex-wrap gap-2 text-sm">{acciones}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * Tarjeta del emisor + caja de estado del documento.
 * `empresa` recibe el selector (creación) o el texto plano (consulta).
 * `trazabilidad` solo aparece en la consulta: creación → última novedad.
 */
export function TarjetaEmisor({
  empresa,
  numero,
  estado,
  factura,
  trazabilidad,
}: {
  empresa: React.ReactNode;
  numero: string;
  estado: keyof typeof ESTADOS_DOC;
  factura?: string | null;
  trazabilidad?: React.ReactNode;
}) {
  const conf = ESTADOS_DOC[estado] ?? ESTADOS_DOC.DIGITACION;
  return (
    <div className="mb-4 rounded-lg border p-4">
      <div className="flex flex-wrap gap-4">
        <div className="min-w-72 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={docCampo}>Empresa / Razón social emisora:</p>
            <span className="text-xs text-slate-400">Facturación oficial</span>
          </div>
          <div className="mt-1">{empresa}</div>
          <p className="mt-1 text-xs text-slate-400">
            Entidad comercial autorizada para la facturación y despacho.
          </p>
        </div>
        <div className="w-full rounded-lg bg-sofia-900 px-4 py-3 text-white sm:w-72">
          <p className="flex items-center justify-between text-sm font-semibold">
            <span># ORDEN DE PEDIDO</span>
            <span className="rounded bg-white/15 px-2 py-0.5">{numero}</span>
          </p>
          <p className="mt-3 text-xs uppercase tracking-wide text-slate-300">Estado actual</p>
          <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-semibold ${conf.tinte}`}>
            <span className={`h-2 w-2 rounded-full ${conf.punto}`} />
            {conf.texto}
          </p>
          {factura !== undefined && (
            <p className="mt-2 border-t border-white/15 pt-2 text-xs text-slate-300">
              Factura relacionada:{' '}
              <span className="font-semibold text-white">{factura || 'Sin factura asociada'}</span>
            </p>
          )}
        </div>
      </div>
      {trazabilidad && <div className="mt-3 border-t pt-3">{trazabilidad}</div>}
    </div>
  );
}

/** Encabezado de la tabla de ítems del documento (barra azul). */
export function EncabezadoTablaDoc({ columnas }: { columnas: string[] }) {
  return (
    <thead>
      <tr className="bg-sofia-900 text-left text-xs uppercase tracking-wide text-white">
        {columnas.map((c, i) => (
          <th key={c || `col-${i}`} className={`px-2 py-2 ${i === 0 ? 'w-10 text-center' : ''}`}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** Pie de la tabla: conteo de productos y unidades cargados. */
export function ConteoItems({ productos, unidades }: { productos: number; unidades: number }) {
  return (
    <p className="text-xs text-slate-500">
      {productos} producto{productos === 1 ? '' : 's'} cargado{productos === 1 ? '' : 's'} ({unidades}{' '}
      unidad{unidades === 1 ? '' : 'es'})
    </p>
  );
}

/** Caja del total del documento. */
export function TotalDocumento({ valor }: { valor: number }) {
  return (
    <div className="w-full rounded-lg border-2 border-sofia-900 px-5 py-3 text-center sm:w-64">
      <p className="text-xs font-semibold uppercase tracking-wide text-sofia-900">Total $</p>
      <p className="text-3xl font-extrabold text-sofia-900">{valor.toLocaleString('es-CO')}</p>
    </div>
  );
}
