'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MonitorSmartphone, ShieldX, XCircle } from 'lucide-react';
import { api, mensajeError, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina, Insignia } from '@/components/ui';

interface Dispositivo {
  id: string;
  deviceId: string;
  nombre: string;
  userAgent: string;
  idioma: string | null;
  plataforma: string | null;
  resolucion: string | null;
  ip: string | null;
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REVOCADO';
  registradoPorNombre: string | null;
  aprobadoAt: string | null;
  aprobadoPorNombre: string | null;
  rechazadoAt: string | null;
  rechazadoPorNombre: string | null;
  revocadoAt: string | null;
  revocadoPorNombre: string | null;
  ultimoUsoAt: string | null;
  createdAt: string;
}

const ESTILO_ESTADO: Record<string, 'verde' | 'ambar' | 'rojo' | 'gris'> = {
  APROBADO: 'verde',
  PENDIENTE: 'ambar',
  RECHAZADO: 'rojo',
  REVOCADO: 'gris',
};

function fecha(valor: string | null): string {
  if (!valor) return '—';
  return new Date(valor).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

/** I57: control de dispositivos — solo Administrador (el backend enforcea). */
export default function DispositivosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const { status, body } = await api<Dispositivo[]>('/devices');
    if (status === 200) setDispositivos(body);
    else if (status === 403) router.replace('/dashboard');
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol !== 'ADMINISTRADOR') return router.replace('/dashboard');
    setSesion(s);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function accion(d: Dispositivo, tipo: 'aprobar' | 'rechazar' | 'revocar') {
    setError('');
    setMensaje('');
    const verbos = { aprobar: 'aprobar', rechazar: 'rechazar', revocar: 'revocar' };
    if (tipo === 'revocar' && !window.confirm(`¿Revocar el acceso de «${d.nombre}»? Sus sesiones activas se cerrarán de inmediato.`)) return;
    if (tipo === 'rechazar' && !window.confirm(`¿Rechazar «${d.nombre}»?`)) return;
    const { status, body } = await api(`/devices/${d.id}/${tipo}`, { method: 'POST' });
    if (status === 200) {
      setMensaje(`Dispositivo «${d.nombre}» ${verbos[tipo] === 'aprobar' ? 'aprobado' : verbos[tipo] === 'rechazar' ? 'rechazado' : 'revocado'}.`);
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo completar la acción'));
    }
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Dispositivos"
        descripcion="Navegadores autorizados para ingresar a la aplicación. La autorización es por dispositivo: una vez aprobado, cualquier usuario puede ingresar desde él."
      />

      {mensaje && <p className="mb-3 rounded-lg bg-menta-100 px-3 py-2 text-sm text-menta-700">{mensaje}</p>}
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full rounded-lg bg-white text-sm shadow">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Navegador</th>
              <th className="p-2">Características</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Registrado por</th>
              <th className="p-2">Aprobado</th>
              <th className="p-2">Rechazado</th>
              <th className="p-2">Revocado</th>
              <th className="p-2">Último uso</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {dispositivos.map((d) => (
              <tr key={d.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <MonitorSmartphone size={16} className="shrink-0 text-slate-400" />
                    <div>
                      <p className="font-medium text-slate-800">{d.nombre}</p>
                      <p className="max-w-52 truncate text-xs text-slate-400" title={d.userAgent}>
                        {d.ip ? `IP ${d.ip}` : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="p-2 text-xs text-slate-500">
                  {[d.plataforma, d.idioma, d.resolucion].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="p-2">
                  <Insignia tono={ESTILO_ESTADO[d.estado]}>{d.estado}</Insignia>
                </td>
                <td className="p-2 text-xs text-slate-600">
                  {d.registradoPorNombre ?? '—'}
                  <br />
                  <span className="text-slate-400">{fecha(d.createdAt)}</span>
                </td>
                <td className="p-2 text-xs text-slate-600">
                  {d.aprobadoPorNombre ?? '—'}
                  {d.aprobadoAt && (
                    <>
                      <br />
                      <span className="text-slate-400">{fecha(d.aprobadoAt)}</span>
                    </>
                  )}
                </td>
                <td className="p-2 text-xs text-slate-600">
                  {d.rechazadoPorNombre ?? '—'}
                  {d.rechazadoAt && (
                    <>
                      <br />
                      <span className="text-slate-400">{fecha(d.rechazadoAt)}</span>
                    </>
                  )}
                </td>
                <td className="p-2 text-xs text-slate-600">
                  {d.revocadoPorNombre ?? '—'}
                  {d.revocadoAt && (
                    <>
                      <br />
                      <span className="text-slate-400">{fecha(d.revocadoAt)}</span>
                    </>
                  )}
                </td>
                <td className="p-2 text-xs text-slate-500">{fecha(d.ultimoUsoAt)}</td>
                <td className="p-2">
                  <div className="flex gap-1">
                    {d.estado !== 'APROBADO' && (
                      <button
                        type="button"
                        title="Aprobar"
                        onClick={() => accion(d, 'aprobar')}
                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                      >
                        <CheckCircle2 size={18} />
                      </button>
                    )}
                    {d.estado === 'PENDIENTE' && (
                      <button
                        type="button"
                        title="Rechazar"
                        onClick={() => accion(d, 'rechazar')}
                        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                      >
                        <XCircle size={18} />
                      </button>
                    )}
                    {d.estado === 'APROBADO' && (
                      <button
                        type="button"
                        title="Revocar"
                        onClick={() => accion(d, 'revocar')}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                      >
                        <ShieldX size={18} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {dispositivos.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-slate-400">
                  No hay dispositivos registrados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
