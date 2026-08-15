'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  EncabezadoPagina,
  Tarjeta,
} from '@/components/ui';

interface Param {
  clave: string;
  valor: Record<string, any>;
  descripcion?: string;
}

const PARAMS_EDITABLES: Record<string, { campos: { key: string; label: string; tipo: 'number' | 'select'; opciones?: string[] }[] }> = {
  'security.password_policy': {
    campos: [
      { key: 'min_length', label: 'Longitud mínima', tipo: 'number' },
      { key: 'expiration_days', label: 'Expiración (días)', tipo: 'number' },
      { key: 'max_failed_attempts', label: 'Intentos fallidos máximos', tipo: 'number' },
    ],
  },
  'api.rate_limit_per_minute': {
    campos: [{ key: 'requests_per_minute', label: 'Peticiones por minuto', tipo: 'number' }],
  },
  'ocr.active_engine': {
    campos: [{ key: 'engine', label: 'Motor OCR activo', tipo: 'select', opciones: ['OCR_LOCAL', 'OCR_LLM'] }],
  },
};

/** M14: edición de parámetros del sistema con motivo obligatorio. */
export default function ParametrosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [params, setParams] = useState<Param[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [motivo, setMotivo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const { status, body } = await api<Param[]>('/admin/params');
    if (status === 200) setParams(body);
    else if (status === 403) router.replace('/dashboard');
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function iniciarEdicion(p: Param) {
    setEditando(p.clave);
    setForm({ ...p.valor });
    setMotivo('');
    setError('');
    setMensaje('');
  }

  async function guardar(clave: string) {
    setError('');
    setMensaje('');
    const { status, body } = await api(`/admin/params/${encodeURIComponent(clave)}`, {
      method: 'PUT',
      body: JSON.stringify({ valor: form, motivo }),
    });
    if (status === 200) {
      setMensaje(`Parámetro ${clave} actualizado`);
      setEditando(null);
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo actualizar'));
    }
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Parámetros del sistema"
        descripcion="Configuración operativa y de seguridad; cada cambio exige motivo y queda auditado."
      />

      {mensaje && <p className="mb-4 max-w-2xl rounded-lg bg-menta-50 px-3 py-2 text-sm text-menta-700">{mensaje}</p>}
      {error && <p className="mb-4 max-w-2xl rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="max-w-3xl space-y-4">
        {params.map((p) => {
          const config = PARAMS_EDITABLES[p.clave];
          const enEdicion = editando === p.clave;
          return (
            <Tarjeta key={p.clave} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm font-semibold text-slate-800">{p.clave}</p>
                  {p.descripcion && <p className="mt-0.5 text-xs text-slate-500">{p.descripcion}</p>}
                </div>
                {config && !enEdicion && (
                  <button
                    onClick={() => iniciarEdicion(p)}
                    className="rounded-lg bg-sofia-50 px-3 py-1.5 text-sm font-medium text-sofia-700 hover:bg-sofia-100"
                  >
                    Editar
                  </button>
                )}
              </div>

              {!enEdicion && (
                <pre className="mt-3 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  {JSON.stringify(p.valor, null, 2)}
                </pre>
              )}

              {enEdicion && (
                <div className="mt-4 space-y-3 text-sm">
                  {config.campos.map((c) => (
                    <label key={c.key} className="flex flex-wrap items-center gap-3">
                      <span className="w-48 text-slate-600">{c.label}</span>
                      {c.tipo === 'number' ? (
                        <input
                          type="number"
                          className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
                          value={form[c.key] ?? ''}
                          onChange={(e) => setForm({ ...form, [c.key]: Number(e.target.value) })}
                        />
                      ) : (
                        <select
                          className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
                          value={form[c.key] ?? ''}
                          onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
                        >
                          {c.opciones?.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                  ))}
                  <label className="flex flex-wrap items-center gap-3">
                    <span className="w-48 text-slate-600">Motivo (obligatorio)</span>
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => guardar(p.clave)} className={CLASE_BOTON_PRIMARIO}>
                      Guardar
                    </button>
                    <button onClick={() => setEditando(null)} className={CLASE_BOTON_SECUNDARIO}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </Tarjeta>
          );
        })}
      </div>
        </AppShell>
  );
}
