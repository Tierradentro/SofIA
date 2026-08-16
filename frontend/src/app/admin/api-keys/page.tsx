'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import {
  CLASE_BOTON_PRIMARIO,
  CLASES_TABLA,
  EncabezadoPagina,
  Insignia,
  Tarjeta,
} from '@/components/ui';

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
  const [errorCarga, setErrorCarga] = useState('');
  const [form, setForm] = useState({ userId: '', nombre: '' });
  const [claveNueva, setClaveNueva] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    setErrorCarga('');
    try {
      const { status, body } = await api<ApiKeyItem[]>('/api-keys');
      if (status === 200) setKeys(body);
      else if (status === 403) return router.replace('/dashboard');
      // I23: un fallo de carga no debe disfrazarse de lista vacía
      else setErrorCarga('No se pudieron cargar las API keys. Intente de nuevo.');

      const users = await api<UsuarioApi[]>('/users');
      if (users.status === 200) {
        setUsuariosApi(users.body.filter((u) => u.rol === 'API'));
      }
    } catch {
      setErrorCarga('No hay comunicación con el servidor. Verifique la conexión e intente de nuevo.');
    }
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
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
      <EncabezadoPagina
        titulo="API Keys"
        descripcion="Claves de integración para los usuarios con rol API."
      />

      {usuariosApi.length === 0 && (
        <p className="mb-4 max-w-2xl rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No hay usuarios con rol API. Cree primero un usuario con rol API en la
          sección Usuarios para poder asociarle claves.
        </p>
      )}

      <Tarjeta className="mb-6 max-w-2xl p-5">
        <form onSubmit={crear} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
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
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
          />
          <button className={`sm:col-span-2 ${CLASE_BOTON_PRIMARIO}`}>
            Crear API key
          </button>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
          {claveNueva && (
            <div className="rounded-lg bg-menta-50 px-3 py-3 text-sm text-menta-700 sm:col-span-2">
              <p className="mb-1 font-semibold">Guarde esta clave: se muestra una sola vez</p>
              <code className="block break-all rounded-lg bg-white px-2 py-1 font-mono text-xs">{claveNueva}</code>
            </div>
          )}
        </form>
      </Tarjeta>

      <Tarjeta className="max-w-4xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className={CLASES_TABLA.tabla}>
            <thead>
              <tr className={CLASES_TABLA.cabecera}>
                <th className={CLASES_TABLA.celdaCabecera}>Nombre</th>
                <th className={CLASES_TABLA.celdaCabecera}>Clave</th>
                <th className={CLASES_TABLA.celdaCabecera}>Estado</th>
                <th className={CLASES_TABLA.celdaCabecera}>Último uso</th>
                <th className={CLASES_TABLA.celdaCabecera}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={CLASES_TABLA.fila}>
                  <td className={`${CLASES_TABLA.celda} font-medium text-slate-800`}>{k.nombre}</td>
                  <td className={`${CLASES_TABLA.celda} font-mono text-xs text-slate-500`}>{k.key}</td>
                  <td className={CLASES_TABLA.celda}>
                    <Insignia tono={k.activo ? 'menta' : 'gris'}>
                      {k.activo ? 'Activa' : 'Inactiva'}
                    </Insignia>
                  </td>
                  <td className={`${CLASES_TABLA.celda} text-slate-500`}>
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('es-CO') : '—'}
                  </td>
                  <td className={`${CLASES_TABLA.celda} flex gap-2`}>
                    <button
                      onClick={() => toggleActivo(k)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium ${
                        k.activo
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-menta-50 text-menta-700 hover:bg-menta-100'
                      }`}
                    >
                      {k.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => eliminar(k)}
                      className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && !errorCarga && (
                <tr>
                  <td className={`${CLASES_TABLA.celda} text-slate-400`} colSpan={5}>
                    Sin API keys creadas.
                  </td>
                </tr>
              )}
              {errorCarga && (
                <tr>
                  <td className={`${CLASES_TABLA.celda} text-red-700`} colSpan={5}>
                    {errorCarga}{' '}
                    <button onClick={cargar} className="ml-2 font-medium text-sofia-700 underline hover:text-sofia-800">
                      Reintentar
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Tarjeta>
        </AppShell>
  );
}
