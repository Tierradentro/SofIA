'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

interface Respaldo { archivo: string; bytes: number; creado: string }

interface Log {
  id: string;
  usuarioUsername: string;
  fechaHora: string;
  accion: string;
  tabla: string;
  registroId: string;
  motivo?: string;
}

/** HU-065 + A-03: consulta de auditoría con filtros y purga controlada. */
export default function AuditoriaPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [filtros, setFiltros] = useState({ tabla: '', accion: '', fechaDesde: '', fechaHasta: '' });
  const [motivoPurga, setMotivoPurga] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [respaldos, setRespaldos] = useState<Respaldo[]>([]);

  async function cargarRespaldos() {
    const { status, body } = await api<Respaldo[]>('/audit/purge');
    if (status === 200) setRespaldos(body);
  }

  // I14 (decisión #4): baja la copia CSV de salvaguarda generada por la purga
  function descargar(archivo: string) {
    const sesion = obtenerSesion();
    fetch(`${API_URL}/audit/purge/${archivo}`, {
      headers: { Authorization: `Bearer ${sesion?.token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('No se pudo descargar');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = archivo;
        a.click();
        window.URL.revokeObjectURL(url);
      })
      .catch(() => setError('No se pudo descargar el respaldo'));
  }

  async function cargar() {
    const params = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => v && params.set(k, v));
    const { status, body } = await api<{ data: Log[]; total: number }>(`/audit?${params}`);
    if (status === 200) {
      setLogs(body.data);
      setTotal(body.total);
    } else if (status === 403) {
      router.replace('/dashboard');
    }
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    cargar();
    cargarRespaldos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function purgar() {
    setError('');
    setMensaje('');
    if (!filtros.fechaDesde || !filtros.fechaHasta || !motivoPurga) {
      setError('Para purgar indique rango de fechas y motivo');
      return;
    }
    if (
      !window.confirm(
        'La purga exportará los logs a CSV y luego los eliminará de forma permanente. ¿Continuar?',
      )
    )
      return;
    const { status, body } = await api('/audit/purge', {
      method: 'POST',
      body: JSON.stringify({
        fechaDesde: filtros.fechaDesde,
        fechaHasta: filtros.fechaHasta,
        motivo: motivoPurga,
      }),
    });
    if (status === 201) {
      setMensaje(
        `Purga completada: ${body.registrosPurgados} registros exportados a ${body.exportado}`,
      );
      setMotivoPurga('');
      cargar();
      cargarRespaldos();
    } else {
      setError(mensajeError(body, 'No se pudo purgar'));
    }
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Auditoría" />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 text-sm shadow">
        <label>
          Tabla
          <input
            className="ml-2 rounded border px-2 py-1"
            value={filtros.tabla}
            onChange={(e) => setFiltros({ ...filtros, tabla: e.target.value })}
            placeholder="users, companies…"
          />
        </label>
        <label>
          Acción
          <input
            className="ml-2 rounded border px-2 py-1"
            value={filtros.accion}
            onChange={(e) => setFiltros({ ...filtros, accion: e.target.value })}
            placeholder="CREAR, LOGIN…"
          />
        </label>
        <label>
          Desde
          <input
            type="date"
            className="ml-2 rounded border px-2 py-1"
            value={filtros.fechaDesde}
            onChange={(e) => setFiltros({ ...filtros, fechaDesde: e.target.value })}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            className="ml-2 rounded border px-2 py-1"
            value={filtros.fechaHasta}
            onChange={(e) => setFiltros({ ...filtros, fechaHasta: e.target.value })}
          />
        </label>
        <button onClick={cargar} className="rounded bg-sofia-600 px-4 py-1.5 text-white">
          Filtrar
        </button>
      </div>

      <p className="mb-2 text-sm text-slate-600">{total} registros</p>
      <table className="w-full rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Fecha</th>
            <th className="p-2">Usuario</th>
            <th className="p-2">Acción</th>
            <th className="p-2">Tabla</th>
            <th className="p-2">Registro</th>
            <th className="p-2">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="p-2">{new Date(l.fechaHora).toLocaleString('es-CO')}</td>
              <td className="p-2">{l.usuarioUsername}</td>
              <td className="p-2">{l.accion}</td>
              <td className="p-2">{l.tabla}</td>
              <td className="max-w-[180px] truncate p-2">{l.registroId}</td>
              <td className="max-w-[200px] truncate p-2">{l.motivo}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 max-w-2xl rounded-lg border border-red-200 bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold text-red-700">Purga de logs (exporta CSV antes de borrar)</h2>
        <p className="mb-3 text-sm text-slate-600">
          Usa el rango de fechas de los filtros. La acción queda auto-auditada.
        </p>
        <div className="flex gap-3">
          <input
            placeholder="Motivo de la purga"
            className="flex-1 rounded border px-3 py-2 text-sm"
            value={motivoPurga}
            onChange={(e) => setMotivoPurga(e.target.value)}
          />
          <button onClick={purgar} className="rounded bg-red-600 px-4 py-2 text-sm text-white">
            Exportar y purgar
          </button>

          {respaldos.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h3 className="mb-2 text-sm font-semibold">Respaldos de purga (copia de salvaguarda)</h3>
              <ul className="space-y-1">
                {respaldos.map((r) => (
                  <li key={r.archivo} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{r.archivo}</span>
                    <span className="text-slate-500">
                      {(r.bytes / 1024).toFixed(1)} KB · {new Date(r.creado).toLocaleString('es-CO')}
                    </span>
                    <button
                      onClick={() => descargar(r.archivo)}
                      className="rounded bg-sofia-100 px-2 py-1 text-sofia-700 hover:bg-sofia-200"
                    >
                      Descargar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {mensaje && <p className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      </div>
        </AppShell>
  );
}
