'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError } from '@/lib/api';

interface Transportadora {
  id: string;
  nombre: string;
  tipo: 'EXTERNA' | 'INTERNA';
  identificacion?: string;
  telefonos?: string;
  activo: boolean;
}

/** HU-008: gestión de transportadoras (solo Administrador). */
export default function TransportadorasPage() {
  const router = useRouter();
  const [items, setItems] = useState<Transportadora[]>([]);
  const [form, setForm] = useState({ nombre: '', tipo: 'EXTERNA', identificacion: '', telefonos: '' });
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const { status, body } = await api<Transportadora[]>('/carriers');
    if (status === 200) setItems(body);
    else if (status === 403) router.replace('/dashboard');
  }

  useEffect(() => {
    if (!obtenerSesion()) return router.replace('/login');
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = await api('/carriers', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (status === 201) {
      setMensaje(`Transportadora "${body.nombre}" creada (${body.tipo})`);
      setForm({ nombre: '', tipo: 'EXTERNA', identificacion: '', telefonos: '' });
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo crear'));
    }
  }

  async function toggleActivo(t: Transportadora) {
    const { status } = await api(`/carriers/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !t.activo }),
    });
    if (status !== 200) setError('No se pudo cambiar el estado');
    cargar();
  }

  return (
    <main className="min-h-screen p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-sofia-600">
        ← Volver al dashboard
      </button>
      <h1 className="mb-4 text-xl font-semibold">Transportadoras</h1>

      <form onSubmit={crear} className="mb-6 grid max-w-3xl grid-cols-2 gap-3 rounded-lg bg-white p-5 shadow">
        <input
          placeholder="Nombre"
          className="rounded border px-3 py-2"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          required
        />
        <select
          className="rounded border px-3 py-2"
          value={form.tipo}
          onChange={(e) => setForm({ ...form, tipo: e.target.value })}
        >
          <option value="EXTERNA">Externa (con guía)</option>
          <option value="INTERNA">Interna (sin guía externa)</option>
        </select>
        <input
          placeholder="Identificación (NIT)"
          className="rounded border px-3 py-2"
          value={form.identificacion}
          onChange={(e) => setForm({ ...form, identificacion: e.target.value })}
        />
        <input
          placeholder="Teléfonos"
          className="rounded border px-3 py-2"
          value={form.telefonos}
          onChange={(e) => setForm({ ...form, telefonos: e.target.value })}
        />
        <button className="col-span-2 rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
          Crear transportadora
        </button>
        {error && <p className="col-span-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {mensaje && <p className="col-span-2 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      </form>

      <table className="w-full max-w-3xl rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Nombre</th>
            <th className="p-3">Tipo</th>
            <th className="p-3">Identificación</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-b last:border-0">
              <td className="p-3">{t.nombre}</td>
              <td className="p-3">{t.tipo}</td>
              <td className="p-3">{t.identificacion}</td>
              <td className="p-3">{t.activo ? 'Activa' : 'Inactiva'}</td>
              <td className="p-3">
                <button
                  onClick={() => toggleActivo(t)}
                  className={`rounded px-2 py-1 ${t.activo ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
                >
                  {t.activo ? 'Desactivar' : 'Activar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
