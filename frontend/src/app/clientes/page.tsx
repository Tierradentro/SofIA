'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Search } from 'lucide-react';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_INPUT,
  CLASES_TABLA,
  EncabezadoPagina,
  Insignia,
  Tarjeta,
} from '@/components/ui';

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

  const panelAbierto = Boolean(clienteDirecciones && puedeEditar);

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Clientes" />

      <Tarjeta className="mb-4 max-w-3xl p-4">
        <form onSubmit={(e) => { e.preventDefault(); cargar(); }} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Buscar por nombre o identificación"
              className={`${CLASE_INPUT} pl-9`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className={CLASE_BOTON_PRIMARIO}>Buscar</button>
        </form>
      </Tarjeta>

      {mensaje && <p className="mb-3 max-w-3xl rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      {error && <p className="mb-3 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className={`mb-6 grid grid-cols-1 gap-6 ${panelAbierto ? 'xl:grid-cols-2' : ''}`}>
        {puedeEditar && (
          <Tarjeta className={`p-5 ${panelAbierto ? '' : 'max-w-3xl'}`}>
            <form onSubmit={guardar} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input placeholder="Nombre *" className={CLASE_INPUT} value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
              <input placeholder="Identificación (NIT)" className={CLASE_INPUT} value={form.identificacion}
                onChange={(e) => setForm({ ...form, identificacion: e.target.value })} />
              <input placeholder="Dirección" className={CLASE_INPUT} value={form.direccion}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
              <input placeholder="Teléfonos" className={CLASE_INPUT} value={form.telefonos}
                onChange={(e) => setForm({ ...form, telefonos: e.target.value })} />
              <input placeholder="Ciudad" className={CLASE_INPUT} value={form.ciudad}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })} />
              <div className="flex gap-2">
                <button className={`${CLASE_BOTON_PRIMARIO} flex-1`}>
                  {editando ? 'Guardar cambios' : 'Crear cliente'}
                </button>
                {editando && (
                  <button type="button" onClick={() => { setEditando(null); setForm(VACIO); }}
                    className="rounded-lg bg-slate-100 px-4 text-sm text-slate-600 hover:bg-slate-200">
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </Tarjeta>
        )}

        {/* QA Func. 4.1: direcciones de despacho del cliente (máx. 10) */}
        {panelAbierto && clienteDirecciones && (
          <Tarjeta className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <h2 className="font-semibold text-slate-900">
                Direcciones de {clienteDirecciones.nombre}{' '}
                <span className="text-sm font-normal text-slate-500">({direcciones.length}/10)</span>
              </h2>
              <button
                onClick={() => setClienteDirecciones(null)}
                className={`${CLASE_BOTON_SECUNDARIO} px-3 py-1 text-xs`}
              >
                Cerrar
              </button>
            </div>
            <ul className="mb-4 space-y-2 text-sm">
              {direcciones.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin size={14} className="shrink-0 text-slate-400" />
                    <span className="truncate">
                      {d.direccion}
                      {d.ciudad ? ` — ${d.ciudad}` : ''}
                    </span>
                    {d.esPrincipal && <Insignia tono="azul">Principal</Insignia>}
                  </span>
                  {!d.esPrincipal && (
                    <span className="flex gap-3 text-xs font-medium">
                      <button onClick={() => marcarPrincipal(d)} className="text-sofia-700 hover:underline">
                        Marcar principal
                      </button>
                      <button onClick={() => eliminarDireccion(d)} className="text-red-600 hover:underline">
                        Eliminar
                      </button>
                    </span>
                  )}
                </li>
              ))}
              {!direcciones.length && (
                <li className="text-slate-500">Este cliente aún no tiene direcciones registradas.</li>
              )}
            </ul>
            {direcciones.length < 10 && (
              <form onSubmit={agregarDireccion} className="flex flex-col gap-2 sm:flex-row">
                <input
                  placeholder="Nueva dirección *"
                  className={`${CLASE_INPUT} flex-1`}
                  value={nuevaDireccion.direccion}
                  onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, direccion: e.target.value })}
                  maxLength={250}
                  required
                />
                <input
                  placeholder="Ciudad"
                  className={`${CLASE_INPUT} sm:w-40`}
                  value={nuevaDireccion.ciudad}
                  onChange={(e) => setNuevaDireccion({ ...nuevaDireccion, ciudad: e.target.value })}
                  maxLength={120}
                />
                <button className={CLASE_BOTON_PRIMARIO}>Agregar</button>
              </form>
            )}
          </Tarjeta>
        )}
      </div>

      <Tarjeta className="max-w-5xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className={CLASES_TABLA.tabla}>
          <thead>
            <tr className={CLASES_TABLA.cabecera}>
              <th className={CLASES_TABLA.celdaCabecera}>Nombre</th>
              <th className={CLASES_TABLA.celdaCabecera}>Identificación</th>
              <th className={CLASES_TABLA.celdaCabecera}>Ciudad</th>
              <th className={CLASES_TABLA.celdaCabecera}>Teléfonos</th>
              {puedeEditar && <th className={CLASES_TABLA.celdaCabecera}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className={CLASES_TABLA.fila}>
                <td className={`${CLASES_TABLA.celda} font-medium`}>{c.nombre}</td>
                <td className={CLASES_TABLA.celda}>{c.identificacion}</td>
                <td className={CLASES_TABLA.celda}>{c.ciudad}</td>
                <td className={CLASES_TABLA.celda}>{c.telefonos}</td>
                {puedeEditar && (
                  <td className={CLASES_TABLA.celda}>
                    <div className="flex gap-2">
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
                        className="rounded-md bg-sofia-100 px-3 py-1 text-xs font-medium text-sofia-700 hover:bg-sofia-200"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => abrirDirecciones(c)}
                        className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                      >
                        Direcciones
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!clientes.length && (
              <tr>
                <td colSpan={puedeEditar ? 5 : 4} className="px-4 py-8 text-center text-sm text-slate-500">
                  No se encontraron clientes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Mostrando {clientes.length} resultado{clientes.length === 1 ? '' : 's'}
        </p>
      </Tarjeta>
    </AppShell>
  );
}
