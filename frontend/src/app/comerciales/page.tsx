'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_INPUT,
  CLASES_TABLA,
  EncabezadoPagina,
  Tarjeta,
} from '@/components/ui';

interface Comercial {
  id: string;
  nombre: string;
  identificacion?: string;
  direccion?: string;
  telefonos?: string;
  ciudad?: string;
}

/** I35: actividad asociada al comercial (GET /comerciales/:id/resumen). */
interface ResumenComercial {
  comercial: Comercial;
  pedidos: {
    total: number;
    recientes: Array<{ id: string; numero: string; estado: string; ciudad?: string; numeroFactura?: string; created_at: string; items: number }>;
  };
  despachos: {
    total: number;
    recientes: Array<{ id: string; estado: string; guia?: string; created_at: string }>;
  };
  devoluciones: {
    total: number;
    recientes: Array<{ id: string; codigo: string; cantidad: number; estado: string; motivoCodigo?: string; factura?: string; created_at: string }>;
  };
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
  // I35: modal de actividad del comercial
  const [resumen, setResumen] = useState<ResumenComercial | null>(null);
  const [resumenCargando, setResumenCargando] = useState(false);

  const puedeEditar = ['GENERADOR', 'ADMINISTRADOR'].includes(sesion?.usuario.rol || '');

  /** I35: pedidos, despachos y devoluciones asociados al comercial. */
  async function abrirResumen(c: Comercial) {
    setResumenCargando(true);
    setResumen(null);
    setError('');
    const { status, body } = await api<ResumenComercial>(`/comerciales/${c.id}/resumen`);
    setResumenCargando(false);
    if (status === 200) {
      setResumen(body);
    } else {
      setError(mensajeError(body, 'No se pudo cargar la actividad del comercial'));
    }
  }

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
      setError(mensajeError(body, 'No se pudo guardar'));
    }
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Comerciales" />

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

      {puedeEditar && (
        <Tarjeta className="mb-6 max-w-3xl p-5">
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
                {editando ? 'Guardar cambios' : 'Crear comercial'}
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

      <Tarjeta className="max-w-4xl overflow-hidden">
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
            {comerciales.map((c) => (
              <tr key={c.id} className={CLASES_TABLA.fila}>
                <td className={`${CLASES_TABLA.celda} font-medium`}>{c.nombre}</td>
                <td className={CLASES_TABLA.celda}>{c.identificacion}</td>
                <td className={CLASES_TABLA.celda}>{c.ciudad}</td>
                <td className={CLASES_TABLA.celda}>{c.telefonos}</td>
                {puedeEditar && (
                  <td className={CLASES_TABLA.celda}>
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
                    {/* I35: actividad del comercial */}
                    <button
                      onClick={() => abrirResumen(c)}
                      className="ml-2 rounded-md bg-menta-100 px-3 py-1 text-xs font-medium text-menta-700 hover:bg-menta-200"
                    >
                      Actividad
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!comerciales.length && (
              <tr>
                <td colSpan={puedeEditar ? 5 : 4} className="px-4 py-8 text-center text-sm text-slate-500">
                  No se encontraron comerciales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Mostrando {comerciales.length} resultado{comerciales.length === 1 ? '' : 's'}
        </p>
      </Tarjeta>

      {/* I35: modal de actividad del comercial */}
      {(resumenCargando || resumen) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <Tarjeta className="mt-10 w-full max-w-3xl p-5">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-semibold text-slate-900">
                Actividad de {resumen?.comercial.nombre ?? '…'}
              </h2>
              <button
                onClick={() => setResumen(null)}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200"
              >
                Cerrar
              </button>
            </div>
            {resumenCargando && <p className="py-6 text-center text-sm text-slate-400">Cargando actividad…</p>}
            {resumen && (
              <div className="space-y-5">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Pedidos ({resumen.pedidos.total})
                  </h3>
                  {resumen.pedidos.recientes.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin pedidos asociados.</p>
                  ) : (
                    <ul className="space-y-1">
                      {resumen.pedidos.recientes.map((p) => (
                        <li key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">{p.numero}</span>
                          <span className="text-xs text-slate-500">
                            {p.estado} · {p.items} ítem(s)
                            {p.numeroFactura ? ` · Fact. ${p.numeroFactura}` : ''}
                            {p.ciudad ? ` · ${p.ciudad}` : ''} · {new Date(p.created_at).toLocaleDateString('es-CO')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Despachos ({resumen.despachos.total})
                  </h3>
                  {resumen.despachos.recientes.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin despachos asociados.</p>
                  ) : (
                    <ul className="space-y-1">
                      {resumen.despachos.recientes.map((d) => (
                        <li key={d.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">{d.estado}</span>
                          <span className="text-xs text-slate-500">
                            {d.guia ? `Guía ${d.guia} · ` : ''}{new Date(d.created_at).toLocaleDateString('es-CO')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Devoluciones ({resumen.devoluciones.total})
                  </h3>
                  {resumen.devoluciones.recientes.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin devoluciones asociadas.</p>
                  ) : (
                    <ul className="space-y-1">
                      {resumen.devoluciones.recientes.map((r) => (
                        <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">{r.codigo} ×{r.cantidad}</span>
                          <span className="text-xs text-slate-500">
                            {r.estado}
                            {r.motivoCodigo ? ` · ${r.motivoCodigo}` : ''}
                            {r.factura ? ` · Fact. ${r.factura}` : ''} · {new Date(r.created_at).toLocaleDateString('es-CO')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </Tarjeta>
        </div>
      )}
    </AppShell>
  );
}
