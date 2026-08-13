'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

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
    if (!obtenerSesion()) return router.replace('/login');
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
      <EncabezadoPagina titulo="Parámetros del sistema" />

      {mensaje && <p className="mb-4 max-w-2xl rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      {error && <p className="mb-4 max-w-2xl rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="max-w-3xl space-y-4">
        {params.map((p) => {
          const config = PARAMS_EDITABLES[p.clave];
          const enEdicion = editando === p.clave;
          return (
            <div key={p.clave} className="rounded-lg bg-white p-4 shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm font-semibold">{p.clave}</p>
                  {p.descripcion && <p className="text-xs text-slate-500">{p.descripcion}</p>}
                </div>
                {config && !enEdicion && (
                  <button
                    onClick={() => iniciarEdicion(p)}
                    className="rounded bg-sofia-100 px-3 py-1 text-sm text-sofia-700"
                  >
                    Editar
                  </button>
                )}
              </div>

              {!enEdicion && (
                <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs">
                  {JSON.stringify(p.valor, null, 2)}
                </pre>
              )}

              {enEdicion && (
                <div className="mt-3 space-y-2 text-sm">
                  {config.campos.map((c) => (
                    <label key={c.key} className="flex items-center gap-3">
                      <span className="w-48">{c.label}</span>
                      {c.tipo === 'number' ? (
                        <input
                          type="number"
                          className="rounded border px-2 py-1"
                          value={form[c.key] ?? ''}
                          onChange={(e) => setForm({ ...form, [c.key]: Number(e.target.value) })}
                        />
                      ) : (
                        <select
                          className="rounded border px-2 py-1"
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
                  <label className="flex items-center gap-3">
                    <span className="w-48">Motivo (obligatorio)</span>
                    <input
                      className="flex-1 rounded border px-2 py-1"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => guardar(p.clave)}
                      className="rounded bg-sofia-600 px-4 py-1.5 text-white"
                    >
                      Guardar
                    </button>
                    <button onClick={() => setEditando(null)} className="rounded bg-slate-100 px-4 py-1.5">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
        </AppShell>
  );
}
