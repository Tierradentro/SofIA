'use client';

import { CheckCircle2 } from 'lucide-react';

export interface EmpresaLite {
  id: string;
  nombre: string;
  siglas: string;
}

/**
 * I21: selector de empresa como tarjetas-botón (patrón de la vista de
 * Productos), reutilizado en Pedidos e Ingresos en reemplazo del <select>.
 */
export function SelectorEmpresa({
  empresas,
  empresaId,
  onCambiar,
  titulo = 'Empresa',
}: {
  empresas: EmpresaLite[];
  empresaId: string;
  onCambiar: (id: string) => void;
  titulo?: string;
}) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
      </h2>
      <div className="mb-4 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {empresas.map((e) => {
          const activa = e.id === empresaId;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onCambiar(e.id)}
              className={`flex items-center gap-4 rounded-xl border-2 p-4 text-left shadow-sm transition-colors ${
                activa
                  ? 'border-sofia-700 bg-white'
                  : 'border-transparent bg-white hover:border-sofia-200'
              }`}
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                  activa ? 'bg-sofia-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {e.siglas}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{e.siglas}</span>
                <span className="block truncate text-xs text-slate-500">{e.nombre}</span>
                <span
                  className={`flex items-center gap-1 text-xs ${
                    activa ? 'text-sofia-700' : 'text-slate-400'
                  }`}
                >
                  {activa ? (
                    <>
                      <CheckCircle2 size={13} /> Seleccionada
                    </>
                  ) : (
                    'Cambiar a esta empresa'
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
