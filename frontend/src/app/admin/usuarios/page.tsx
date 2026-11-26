'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina, LimiteLista, PaginadorLista, SelectorLimiteLista, usePaginacionLista } from '@/components/ui';

interface Usuario {
  id: string;
  nombre: string;
  username: string;
  email: string;
  rol: string;
  estado: string;
  comercialId: string | null;
}

interface Comercial {
  id: string;
  nombre: string;
  activo: boolean;
}

/** I75/I77: resultado de la asociación usuario→comercial que devuelve el backend. */
interface AsociacionComercial {
  estado: 'MANUAL' | 'SIN_ASOCIAR';
  comercialId: string | null;
  comercialNombre: string | null;
  mensaje: string;
}

const ROLES = ['OPERADOR', 'GENERADOR', 'ADMINISTRADOR', 'COMERCIAL', 'API'];

/** HU-004/005: gestión de usuarios (solo Administrador; el backend enforcea). */
export default function UsuariosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [comerciales, setComerciales] = useState<Comercial[]>([]);
  // I43: cuántos registros muestra la lista (100, 500 o todos)
  const [limite, setLimite] = useState<LimiteLista>(100);
  // I56: paginación en cliente sobre la lista completa
  const { items: usuariosPagina, pagina, totalPaginas, irA } = usePaginacionLista(usuarios, limite);
  const [form, setForm] = useState({
    nombre: '',
    username: '',
    email: '',
    rol: 'OPERADOR',
    comercialId: '', // '' = sin asociar (solo aplica al rol COMERCIAL)
    claveInicial: '',
  });
  const [mensaje, setMensaje] = useState('');
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const nombreComercial = (id: string | null) =>
    id ? (comerciales.find((c) => c.id === id)?.nombre ?? '—') : null;

  async function cargar() {
    const { status, body } = await api<Usuario[]>('/users');
    if (status === 200) setUsuarios(body);
    else if (status === 403) return router.replace('/dashboard');
    const com = await api<Comercial[]>('/comerciales');
    if (com.status === 200) setComerciales(com.body);
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /** I75/I77: muestra el resultado de la asociación comercial (éxito o aviso). */
  function reportarAsociacion(asociacion?: AsociacionComercial) {
    if (!asociacion) return;
    if (asociacion.estado === 'MANUAL') {
      setMensaje((m) => `${m} ${asociacion.mensaje}.`);
    } else {
      setAviso(asociacion.mensaje);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    setAviso('');
    const payload: Record<string, unknown> = { ...form };
    // El comercialId solo aplica al rol COMERCIAL; '' = sin asociar
    if (form.rol !== 'COMERCIAL' || !form.comercialId) delete payload.comercialId;
    const { status, body } = await api('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (status === 201) {
      setMensaje(`Usuario ${body.username} creado. Debe cambiar la clave en su primer login.`);
      reportarAsociacion(body.asociacionComercial);
      setForm({ nombre: '', username: '', email: '', rol: 'OPERADOR', comercialId: '', claveInicial: '' });
      cargar();
    } else {
      const detalle = Array.isArray(body.detalles) ? `: ${body.detalles.join(', ')}` : '';
      setError(mensajeError(body, 'No se pudo crear el usuario') + detalle);
    }
  }

  /** I75: asociación manual posterior (corrige sin-coincidencia o ambigüedad). */
  async function asignarComercial(u: Usuario, comercialId: string) {
    setError('');
    setAviso('');
    const { status, body } = await api(`/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ comercialId: comercialId || null }),
    });
    if (status === 200) {
      reportarAsociacion(body.asociacionComercial);
      if (!body.asociacionComercial) setAviso('');
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo asociar el comercial'));
      cargar();
    }
  }

  async function cambiarEstado(u: Usuario, estado: string) {
    const motivo = window.prompt(`Motivo para cambiar estado de ${u.username} a ${estado}:`);
    if (motivo === null) return;
    const { status, body } = await api(`/users/${u.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, motivo }),
    });
    if (status !== 200) setError(mensajeError(body, 'No se pudo cambiar el estado'));
    cargar();
  }

  async function resetClave(u: Usuario) {
    const { status, body } = await api(`/users/${u.id}/reset-password`, { method: 'POST' });
    if (status === 200) {
      window.alert(
        `Clave temporal para ${body.username}: ${body.claveTemporal}\n` +
          'El usuario deberá cambiarla en su próximo inicio de sesión.',
      );
    } else {
      setError(mensajeError(body, 'No se pudo resetear la clave'));
    }
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Gestión de usuarios" />

      <form onSubmit={crear} className="mb-6 grid max-w-3xl grid-cols-2 gap-3 rounded-lg bg-white p-5 shadow">
        <input
          placeholder="Nombre"
          className="rounded border px-3 py-2"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          required
        />
        <input
          placeholder="Usuario"
          className="rounded border px-3 py-2"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
        />
        <input
          placeholder="Correo"
          type="email"
          className="rounded border px-3 py-2"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <select
          className="rounded border px-3 py-2"
          value={form.rol}
          onChange={(e) => setForm({ ...form, rol: e.target.value, comercialId: '' })}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {form.rol === 'COMERCIAL' && (
          <div className="col-span-2">
            <select
              className="w-full rounded border px-3 py-2"
              value={form.comercialId}
              onChange={(e) => setForm({ ...form, comercialId: e.target.value })}
            >
              <option value="">Sin asociar</option>
              {comerciales
                .filter((c) => c.activo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              La asociación es manual: elija el comercial del usuario. Cada comercial admite un
              solo usuario activo; si el que busca no aparece disponible, primero desasocie al
              usuario anterior en la tabla. También puede dejarlo sin asociar y asignarlo después.
            </p>
          </div>
        )}
        <input
          placeholder="Clave inicial (May/Min/Núm, min 6)"
          className="rounded border px-3 py-2"
          value={form.claveInicial}
          onChange={(e) => setForm({ ...form, claveInicial: e.target.value })}
          required
        />
        <button className="rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
          Crear usuario
        </button>
        {error && <p className="col-span-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {mensaje && <p className="col-span-2 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
        {aviso && <p className="col-span-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}
      </form>

      <div className="overflow-x-auto">
      <table className="w-full max-w-5xl rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Nombre</th>
            <th className="p-3">Usuario</th>
            <th className="p-3">Rol</th>
            <th className="p-3">Comercial</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuariosPagina.map((u) => (
            <tr key={u.id} className="border-b last:border-0">
              <td className="p-3">{u.nombre}</td>
              <td className="p-3">{u.username}</td>
              <td className="p-3">{u.rol}</td>
              <td className="p-3">
                {u.rol === 'COMERCIAL' ? (
                  <select
                    className={`rounded border px-2 py-1 ${u.comercialId ? '' : 'border-amber-400 bg-amber-50 text-amber-800'}`}
                    value={u.comercialId ?? ''}
                    onChange={(e) => asignarComercial(u, e.target.value)}
                  >
                    <option value="">Sin asociar</option>
                    {comerciales.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  (nombreComercial(u.comercialId) ?? '—')
                )}
              </td>
              <td className="p-3">{u.estado}</td>
              <td className="flex gap-2 p-3">
                {u.estado === 'ACTIVO' ? (
                  <button
                    onClick={() => cambiarEstado(u, 'CANCELADO')}
                    className="rounded bg-red-100 px-2 py-1 text-red-700"
                  >
                    Inactivar
                  </button>
                ) : (
                  <button
                    onClick={() => cambiarEstado(u, 'ACTIVO')}
                    className="rounded bg-green-100 px-2 py-1 text-green-700"
                  >
                    Activar
                  </button>
                )}
                <button
                  onClick={() => resetClave(u)}
                  className="rounded bg-slate-100 px-2 py-1"
                >
                  Resetear clave
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* I43: cuántos usuarios muestra la lista */}
      <div className="mt-2 flex justify-end">
        <SelectorLimiteLista limite={limite} onChange={setLimite} total={usuarios.length} />
          <PaginadorLista pagina={pagina} totalPaginas={totalPaginas} onChange={irA} />
      </div>
      </div>
        </AppShell>
  );
}
