'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';

interface Comercial {
  id: string;
  nombre: string;
  identificacion?: string;
  direccion?: string;
  telefonos?: string;
  ciudad?: string;
}

const VACIO = { nombre: '', identificacion: '', direccion: '', telefonos: '', ciudad: '' };

/** M04: comerciales (catálogo global). Crear/editar: Generador y Administrador. */
export default function ComercialesPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [comerciales, setComerciales] = useState<Comercial[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const puedeEditar = ['GENERADOR', 'ADMINISTRADOR'].includes(sesion?.usuario.rol || '');

  async function cargar(busqueda = q) {
    const { status, body } = await api<Comercial[]>(`/comerciales${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`);
    if (status === 200) setComerciales(body);
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
      ? await api(`/comerciales/${editando}`, { method: 'PATCH', body: JSON.stringify(form) })
      : await api('/comerciales', { method: 'POST', body: JSON.stringify(form) });
    if (status === 200 || status === 201) {
      setMensaje(editando ? 'Comercial actualizado' : 'Comercial creado');
      setForm(VACIO);
      setEditando(null);
      cargar();
    } else {
      setError(body.message || 'No se pudo guardar');
    }
  }

  if (!sesion) return null;

  return (
    <main className="min-h-screen p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-sofia-600">
        ← Volver al dashboard
      </button>
      <h1 className="mb-4 text-xl font-semibold">Comerciales</h1>

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
              {editando ? 'Guardar cambios' : 'Crear comercial'}
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
          {comerciales.map((c) => (
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
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
