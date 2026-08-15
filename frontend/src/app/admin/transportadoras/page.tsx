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
  const [sesion, setSesion] = useState<Sesion | null>(null);
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
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
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

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Transportadoras"
        descripcion="Transportadoras internas y externas disponibles para los despachos."
      />

      <Tarjeta className="mb-6 max-w-3xl p-5">
        <form onSubmit={crear} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            placeholder="Nombre"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
          />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value })}
          >
            <option value="EXTERNA">Externa (con guía)</option>
            <option value="INTERNA">Interna (sin guía externa)</option>
          </select>
          <input
            placeholder="Identificación (NIT)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
            value={form.identificacion}
            onChange={(e) => setForm({ ...form, identificacion: e.target.value })}
          />
          <input
            placeholder="Teléfonos"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
            value={form.telefonos}
            onChange={(e) => setForm({ ...form, telefonos: e.target.value })}
          />
          <button className={`sm:col-span-2 ${CLASE_BOTON_PRIMARIO}`}>
            Crear transportadora
          </button>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
          {mensaje && <p className="rounded-lg bg-menta-50 px-3 py-2 text-sm text-menta-700 sm:col-span-2">{mensaje}</p>}
        </form>
      </Tarjeta>

      <Tarjeta className="max-w-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className={CLASES_TABLA.tabla}>
            <thead>
              <tr className={CLASES_TABLA.cabecera}>
                <th className={CLASES_TABLA.celdaCabecera}>Nombre</th>
                <th className={CLASES_TABLA.celdaCabecera}>Tipo</th>
                <th className={CLASES_TABLA.celdaCabecera}>Identificación</th>
                <th className={CLASES_TABLA.celdaCabecera}>Estado</th>
                <th className={CLASES_TABLA.celdaCabecera}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className={CLASES_TABLA.fila}>
                  <td className={`${CLASES_TABLA.celda} font-medium text-slate-800`}>{t.nombre}</td>
                  <td className={CLASES_TABLA.celda}>
                    <Insignia tono={t.tipo === 'EXTERNA' ? 'azul' : 'gris'}>
                      {t.tipo === 'EXTERNA' ? 'Externa' : 'Interna'}
                    </Insignia>
                  </td>
                  <td className={`${CLASES_TABLA.celda} text-slate-500`}>{t.identificacion ?? '—'}</td>
                  <td className={CLASES_TABLA.celda}>
                    <Insignia tono={t.activo ? 'menta' : 'gris'}>
                      {t.activo ? 'Activa' : 'Inactiva'}
                    </Insignia>
                  </td>
                  <td className={CLASES_TABLA.celda}>
                    <button
                      onClick={() => toggleActivo(t)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium ${
                        t.activo
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-menta-50 text-menta-700 hover:bg-menta-100'
                      }`}
                    >
                      {t.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className={`${CLASES_TABLA.celda} text-slate-400`} colSpan={5}>
                    Sin transportadoras registradas.
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
