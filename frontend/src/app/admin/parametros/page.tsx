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
  // I36: el horario de logística tiene editor dedicado (días + franja horaria).
  'logistica.horario_acceso': { campos: [] },
};

/** I36: clave del parámetro de horario de logística (control de acceso). */
const CLAVE_HORARIO = 'logistica.horario_acceso';
const DIAS_SEMANA = [
  { valor: 1, etiqueta: 'Lun' },
  { valor: 2, etiqueta: 'Mar' },
  { valor: 3, etiqueta: 'Mié' },
  { valor: 4, etiqueta: 'Jue' },
  { valor: 5, etiqueta: 'Vie' },
  { valor: 6, etiqueta: 'Sáb' },
  { valor: 0, etiqueta: 'Dom' },
];

/** M14: edición de parámetros del sistema con motivo obligatorio. */
export default function ParametrosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [params, setParams] = useState<Param[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [motivo, setMotivo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    setCargando(true);
    setErrorCarga('');
    try {
      const { status, body } = await api<Param[]>('/admin/params');
      if (status === 200) setParams(body);
      else if (status === 403) return router.replace('/dashboard');
      // I23: cualquier otro estado (500, 502, etc.) debe ser visible,
      // no un área en blanco sin pistas
      else setErrorCarga('No se pudieron cargar los parámetros. Intente de nuevo.');
    } catch {
      // Falla de red o API no disponible (p. ej. backend sin conexión a la BD)
      setErrorCarga('No hay comunicación con el servidor. Verifique la conexión e intente de nuevo.');
    } finally {
      setCargando(false);
    }
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
        {cargando && (
          <Tarjeta className="p-5">
            <p className="text-sm text-slate-500">Cargando parámetros…</p>
          </Tarjeta>
        )}

        {!cargando && errorCarga && (
          <Tarjeta className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-red-700">{errorCarga}</p>
              <button onClick={cargar} className={CLASE_BOTON_SECUNDARIO}>
                Reintentar
              </button>
            </div>
          </Tarjeta>
        )}

        {!cargando && !errorCarga && params.length === 0 && (
          <Tarjeta className="p-5">
            <p className="text-sm text-slate-500">No hay parámetros configurados.</p>
          </Tarjeta>
        )}

        {!cargando && !errorCarga && params.map((p) => {
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

              {enEdicion && p.clave === CLAVE_HORARIO && (
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-xs text-slate-500">
                    Control de acceso: fuera de estos días y horarios solo el Administrador puede usar la aplicación.
                  </p>
                  <label className="flex items-center gap-2 text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={Boolean(form.activo)}
                      onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                    />
                    Activar restricción de horario
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-48 text-slate-600">Días permitidos</span>
                    {DIAS_SEMANA.map((d) => {
                      const seleccionados: number[] = Array.isArray(form.dias) ? form.dias : [];
                      const activo = seleccionados.includes(d.valor);
                      return (
                        <button
                          key={d.valor}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              dias: activo
                                ? seleccionados.filter((x) => x !== d.valor)
                                : [...seleccionados, d.valor],
                            })
                          }
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                            activo ? 'bg-sofia-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {d.etiqueta}
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex flex-wrap items-center gap-3">
                    <span className="w-48 text-slate-600">Hora de inicio</span>
                    <input
                      type="time"
                      className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
                      value={form.horaInicio ?? '06:00'}
                      onChange={(e) => setForm({ ...form, horaInicio: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-wrap items-center gap-3">
                    <span className="w-48 text-slate-600">Hora de cierre</span>
                    <input
                      type="time"
                      className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
                      value={form.horaFin ?? '18:00'}
                      onChange={(e) => setForm({ ...form, horaFin: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-wrap items-center gap-3">
                    <span className="w-48 text-slate-600">Motivo (obligatorio)</span>
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() =>
                        guardar(p.clave)
                      }
                      className={CLASE_BOTON_PRIMARIO}
                    >
                      Guardar
                    </button>
                    <button onClick={() => setEditando(null)} className={CLASE_BOTON_SECUNDARIO}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {enEdicion && p.clave !== CLAVE_HORARIO && (
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
