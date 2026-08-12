'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';

interface Cliente {
  id: string;
  nombre: string;
  identificacion?: string;
  direccion?: string;
  telefonos?: string;
  ciudad?: string;
}

const VACIO = { nombre: '', identificacion: '', direccion: '', telefonos: '', ciudad: '' };

/** QA Func. 4.1: dirección de despacho del cliente (máx. 10, una principal). */
interface Direccion {
  id: string;
  direccion: string;
  ciudad: string | null;
  esPrincipal: boolean;
}

/** M04: clientes (catálogo global). Crear/editar: Generador y Administrador. */
export default function ClientesPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  // QA Func. 4.1: panel de direcciones del cliente seleccionado
  const [clienteDirecciones, setClienteDirecciones] = useState<Cliente | null>(null);
  const [direcciones, setDirecciones] = useState<Direccion[]>([]);
  const [nuevaDireccion, setNuevaDireccion] = useState({ direccion: '', ciudad: '' });
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const puedeEditar = ['GENERADOR', 'ADMINISTRADOR'].includes(sesion?.usuario.rol || '');

  async function cargar(busqueda = q) {
    const { status, body } = await api<Cliente[]>(`/clients${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`);
    if (status === 200) setClientes(body);
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    cargar('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = editando
      ? await api(`/clients/${editando}`, { method: 'PATCH', body: JSON.stringify(form) })
      : await api('/clients', { method: 'POST', body: JSON.stringify(form) });
    if (status === 200 || status === 201) {
      setMensaje(editando ? 'Cliente actualizado' : 'Cliente creado');
      setForm(VACIO);
      setEditando(null);
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo guardar'));
    }
  }

  async function abrirDirecciones(c: Cliente) {
    setClienteDirecciones(c);
    setError('');
    setMensaje('');
    const { status, body } = await api<Direccion[]>(`/clients/${c.id}/direcciones`);
    if (status === 200) setDirecciones(body);
  }

  async function agregarDireccion(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteDirecciones) return;
    setError('');
    const { status, body } = await api(`/clients/${clienteDirecciones.id}/direcciones`, {
      method: 'POST',
      body: JSON.stringify({
        direccion: nuevaDireccion.direccion,
        ciudad: nuevaDireccion.ciudad || undefined,
      }),
    });
    if (status === 201) {
      setNuevaDireccion({ direccion: '', ciudad: '' });
      abrirDirecciones(clienteDirecciones);
      setMensaje('Dirección agregada');
    } else {
      setError(mensajeError(body, 'No se pudo agregar la dirección'));
    }
  }

  async function marcarPrincipal(d: Direccion) {
    if (!clienteDirecciones) return;
    const { status, body } = await api(
      `/clients/${clienteDirecciones.id}/direcciones/${d.id}`,
      { method: 'PATCH', body: JSON.stringify({ esPrincipal: true }) },
    );
    if (status === 200) abrirDirecciones(clienteDirecciones);
    else setError(mensajeError(body, 'No se pudo marcar como principal'));
  }

  async function eliminarDireccion(d: Direccion) {
    if (!clienteDirecciones) return;
    const { status, body } = await api(
      `/clients/${clienteDirecciones.id}/direcciones/${d.id}/eliminar`,
      { method: 'POST' },
    );
    if (status === 200 || status === 201) abrirDirecciones(clienteDirecciones);
    else setError(mensajeError(body, 'No se pudo eliminar'));
  }

  if (!sesion) return null;

  return (
    <main className="min-h-screen p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-sofia-600">
        ← Volver al dashboard
      </button>
      <h1 className="mb-4 text-xl font-semibold">Clientes</h1>

      <form onSubmit={(e) => { e.preventDefault(); cargar(); }} className="mb-4 flex max-w-xl gap-2">
        <input
          placeholder="Buscar por nombre o identificación"
          className="flex-1 rounded border px-3 py-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="rounded bg-sofia-600 px-4 py-2 text-white">Buscar</button>
      </form>

      {mensaje && <p className="mb-3 max-w-3xl rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      {error && <p className="mb-3 max-w-3xl rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {puedeEditar && (
        <form onSubmit={guardar} className="mb-6 grid max-w-3xl grid-cols-2 gap-3 rounded-lg bg-white p-5 shadow">
          <input placeholder="Nombre *" className="rounded border px-3 py-2" value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
          <input placeholder="Identificación (NIT)" className="rounded border px-3 py-2" value={form.identificacion}
            onChange={(e) => setForm({ ...form, identificacion: e.target.value })} />
          <input placeholder="Dirección" className="rounded border px-3 py-2" value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          <input placeholder="Teléfonos" className="rounded border px-3 py-2" value={form.telefonos}
            onChange={(e) => setForm({ ...form, telefonos: e.target.value })} />
          <input placeholder="Ciudad" className="rounded border px-3 py-2" value={form.ciudad}
            onChange={(e) => setForm({ ...form, ciudad: e.target.value })} />
          <div className="flex gap-2">
            <button className="flex-1 rounded bg-sofia-600 py-2 text-white">
              {editando ? 'Guardar cambios' : 'Crear cliente'}
            </button>
            {editando && (
              <button type="button" onClick={() => { setEditando(null); setForm(VACIO); }}
                className="rounded bg-slate-100 px-4">
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* QA Func. 4.1: direcciones de despacho del cliente (máx. 10) */}
      {clienteDirecciones && puedeEditar && (
        <section className="mb-6 max-w-3xl rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              Direcciones de {clienteDirecciones.nombre} ({direcciones.length}/10)
            </h2>
            <button onClick={() => setClienteDirecciones(null)} className="text-sm text-slate-500">
              Cerrar
            </button>
          </div>
          <ul className="mb-4 space-y-2 text-sm">
            {direcciones.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded border px-3 py-2">
                <span>
                  {d.direccion}
                  {d.ciudad ? ` — ${d.ciudad}` : ''}
                  {d.esPrincipal && (
                    <span className="ml-2 rounded bg-sofia-100 px-1.5 py-0.5 text-xs font-medium text-sofia-800">
                      Principal
                    </span>
                  )}
                </span>
                <span className="flex gap-2">
                  {!d.esPrincipal && (
                    <>
                      <button onClick={() => marcarPrincipal(d)} className="text-sofia-700 hover:underline">
                        Marcar principal
                      </button>
                      <button onClick={() => eliminarDireccion(d)} className="text-red-700 hover:underline">
                        Eliminar
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
            {!direcciones.length && (
              <li className="text-slate-500">Este cliente aún no tiene direcciones registradas.</li>
            )}
          </ul>
          {direcciones.length < 10 && (
            <form onSubmit={agregarDireccion} className="flex gap-2">
              <input
                placeholder="Nueva dirección *"
                className="flex-1 rounded border px-3 py-2"
                value={nuevaDireccion.direccion}
                onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, direccion: e.target.value })}
                maxLength={250}
                required
              />
              <input
                placeholder="Ciudad"
                className="w-40 rounded border px-3 py-2"
                value={nuevaDireccion.ciudad}
                onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, ciudad: e.target.value })}
                maxLength={120}
              />
              <button className="rounded bg-sofia-600 px-4 py-2 text-white">Agregar</button>
            </form>
          )}
        </section>
      )}

      <table className="w-full max-w-4xl rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Nombre</th>
            <th className="p-3">Identificación</th>
            <th className="p-3">Ciudad</th>
            <th className="p-3">Teléfonos</th>
            {puedeEditar && <th className="p-3">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="p-3">{c.nombre}</td>
              <td className="p-3">{c.identificacion}</td>
              <td className="p-3">{c.ciudad}</td>
              <td className="p-3">{c.telefonos}</td>
              {puedeEditar && (
                <td className="p-3">
                  <button
                    onClick={() => {
                      setEditando(c.id);
                      setForm({
                        nombre: c.nombre,
                        identificacion: c.identificacion || '',
                        direccion: c.direccion || '',
                        telefonos: c.telefonos || '',
                        ciudad: c.ciudad || '',
                      });
                    }}
                    className="rounded bg-sofia-100 px-2 py-1 text-sofia-700"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => abrirDirecciones(c)}
                    className="ml-2 rounded bg-slate-100 px-2 py-1 text-slate-700"
                  >
                    Direcciones
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
