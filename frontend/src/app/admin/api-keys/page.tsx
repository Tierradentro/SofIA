'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

interface ApiKeyItem {
  id: string;
  userId: string;
  nombre: string;
  key: string;
  activo: boolean;
  lastUsedAt?: string;
  createdAt: string;
}

interface UsuarioApi {
  id: string;
  nombre: string;
  username: string;
  rol: string;
}

/** M17: gestión de API keys (solo Administrador). Consulta enmascarada. */
export default function ApiKeysPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [usuariosApi, setUsuariosApi] = useState<UsuarioApi[]>([]);
  const [form, setForm] = useState({ userId: '', nombre: '' });
  const [claveNueva, setClaveNueva] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const { status, body } = await api<ApiKeyItem[]>('/api-keys');
    if (status === 200) setKeys(body);
    else if (status === 403) return router.replace('/dashboard');

    const users = await api<UsuarioApi[]>('/users');
    if (users.status === 200) {
      setUsuariosApi(users.body.filter((u) => u.rol === 'API'));
    }
  }

  useEffect(() => {
    if (!obtenerSesion()) return router.replace('/login');
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setClaveNueva('');
    const { status, body } = await api('/api-keys', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (status === 201) {
      setClaveNueva(body.clave);
      setForm({ userId: '', nombre: '' });
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo crear la API key'));
    }
  }

  async function toggleActivo(k: ApiKeyItem) {
    await api(`/api-keys/${k.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !k.activo }),
    });
    cargar();
  }

  async function eliminar(k: ApiKeyItem) {
    if (!window.confirm(`¿Eliminar la API key "${k.nombre}"? Esta acción no se puede deshacer.`)) return;
    await api(`/api-keys/${k.id}`, { method: 'DELETE' });
    cargar();
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="API Keys" />

      {usuariosApi.length === 0 && (
        <p className="mb-4 max-w-2xl rounded bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No hay usuarios con rol API. Cree primero un usuario con rol API en la
          sección Usuarios para poder asociarle claves.
        </p>
      )}

      <form onSubmit={crear} className="mb-6 grid max-w-2xl grid-cols-2 gap-3 rounded-lg bg-white p-5 shadow">
        <select
          className="rounded border px-3 py-2"
          value={form.userId}
          onChange={(e) => setForm({ ...form, userId: e.target.value })}
          required
        >
          <option value="">— Usuario rol API —</option>
          {usuariosApi.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre} ({u.username})
            </option>
          ))}
        </select>
        <input
          placeholder="Nombre de la key (ej. Integración OpenClaw)"
          className="rounded border px-3 py-2"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          required
        />
        <button className="col-span-2 rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
          Crear API key
        </button>
        {error && <p className="col-span-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {claveNueva && (
          <div className="col-span-2 rounded bg-green-50 px-3 py-3 text-sm text-green-800">
            <p className="mb-1 font-semibold">Guarde esta clave: se muestra una sola vez</p>
            <code className="block break-all rounded bg-white px-2 py-1 font-mono">{claveNueva}</code>
          </div>
        )}
      </form>

      <table className="w-full max-w-4xl rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Nombre</th>
            <th className="p-3">Clave</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Último uso</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-b last:border-0">
              <td className="p-3">{k.nombre}</td>
              <td className="p-3 font-mono text-xs">{k.key}</td>
              <td className="p-3">{k.activo ? 'Activa' : 'Inactiva'}</td>
              <td className="p-3">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('es-CO') : '—'}</td>
              <td className="flex gap-2 p-3">
                <button
                  onClick={() => toggleActivo(k)}
                  className={`rounded px-2 py-1 ${k.activo ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
                >
                  {k.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => eliminar(k)} className="rounded bg-slate-100 px-2 py-1">
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
        </AppShell>
  );
}
