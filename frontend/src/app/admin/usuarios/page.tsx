'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError } from '@/lib/api';

interface Usuario {
  id: string;
  nombre: string;
  username: string;
  email: string;
  rol: string;
  estado: string;
}

const ROLES = ['OPERADOR', 'GENERADOR', 'ADMINISTRADOR', 'COMERCIAL', 'API'];

/** HU-004/005: gestión de usuarios (solo Administrador; el backend enforcea). */
export default function UsuariosPage() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [form, setForm] = useState({
    nombre: '',
    username: '',
    email: '',
    rol: 'OPERADOR',
    claveInicial: '',
  });
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const { status, body } = await api<Usuario[]>('/users');
    if (status === 200) setUsuarios(body);
    else if (status === 403) router.replace('/dashboard');
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = await api('/users', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (status === 201) {
      setMensaje(`Usuario ${body.username} creado. Debe cambiar la clave en su primer login.`);
      setForm({ nombre: '', username: '', email: '', rol: 'OPERADOR', claveInicial: '' });
      cargar();
    } else {
      const detalle = Array.isArray(body.detalles) ? `: ${body.detalles.join(', ')}` : '';
      setError(mensajeError(body, 'No se pudo crear el usuario') + detalle);
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

  return (
    <main className="min-h-screen p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-sofia-600">
        ← Volver al dashboard
      </button>
      <h1 className="mb-4 text-xl font-semibold">Gestión de usuarios</h1>

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
          onChange={(e) => setForm({ ...form, rol: e.target.value })}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
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
      </form>

      <table className="w-full max-w-4xl rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Nombre</th>
            <th className="p-3">Usuario</th>
            <th className="p-3">Rol</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className="border-b last:border-0">
              <td className="p-3">{u.nombre}</td>
              <td className="p-3">{u.username}</td>
              <td className="p-3">{u.rol}</td>
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
    </main>
  );
}
