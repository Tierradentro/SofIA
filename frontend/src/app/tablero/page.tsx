'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Clock,
  PackageSearch,
  RotateCcw,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { COLORES_PESTANA, Insignia, Tarjeta } from '@/components/ui';
import { tiempoRelativo } from '@/lib/tiempo';

interface Pedido {
  id: string;
  numero: string;
  estado: string;
  numeroFactura: string | null;
  ciudad: string | null;
  createdAt: string;
  cliente: { id: string; nombre: string } | null;
}
interface Despacho {
  id: string;
  numero: string;
  estado: string;
  clienteId: string;
  clienteNombre: string | null;
  tipoTransporte: string | null;
  nombreTransporte: string | null;
  guia: string | null;
  empresas?: string[];
  facturas?: string[];
  createdAt: string;
}
interface Caso {
  id: string;
  codigo: string;
  estado: string;
  motivoCodigo: string;
  cantidad: number;
  clienteNombre: string;
  empresaNombre: string | null;
  createdAt: string;
}

type Periodo = 'HOY' | 'SEMANA' | 'TODOS';

const PERIODOS: { id: Periodo; etiqueta: string }[] = [
  { id: 'HOY', etiqueta: 'Hoy' },
  { id: 'SEMANA', etiqueta: 'Semana' },
  { id: 'TODOS', etiqueta: 'Todos' },
];

/** I40: misma regla del Dashboard — tope de tarjetas por pestaña. */
const MAX_TARJETAS = 16;

/** I76: agrupaciones del canvas de pedidos — el viaje del pedido. */
const COLUMNAS: {
  id: string;
  titulo: string;
  estados: string[];
  acento: string;
  fondoColumna: string;
  punto: string;
  chip: string;
}[] = [
  {
    id: 'abiertos',
    titulo: 'Abiertos',
    estados: ['ABIERTO', 'PENDIENTE_CORRECCION'],
    acento: 'border-t-amber-400',
    fondoColumna: 'bg-amber-50/60',
    punto: 'bg-amber-400',
    chip: 'bg-amber-100 text-amber-700',
  },
  {
    id: 'alistamiento',
    titulo: 'En alistamiento',
    estados: ['ALISTADO'],
    acento: 'border-t-sofia-500',
    fondoColumna: 'bg-sofia-50/70',
    punto: 'bg-sofia-500',
    chip: 'bg-sofia-100 text-sofia-700',
  },
  {
    id: 'despacho',
    titulo: 'En despacho',
    estados: ['APROBADO', 'DESPACHADO'],
    acento: 'border-t-menta-400',
    fondoColumna: 'bg-menta-50/60',
    punto: 'bg-menta-400',
    chip: 'bg-menta-100 text-menta-700',
  },
];

/** I40: mismas pestañas de la Cola de Despachos del Dashboard (sin «Creado»). */
const PESTANAS_DESPACHO: { valor: string; etiqueta: string }[] = [
  { valor: 'ABIERTO', etiqueta: 'Abierto' },
  { valor: 'PARCIAL', etiqueta: 'Parcial' },
  { valor: 'DESPACHADO', etiqueta: 'Despachado' },
  { valor: 'PENDIENTE_CORRECCION', etiqueta: 'Pendiente corrección' },
];

/** Pestañas de PQRS (mismos colores compartidos por estado). */
const PESTANAS_PQRS: { valor: string; etiqueta: string }[] = [
  { valor: 'ABIERTA', etiqueta: 'Abierta' },
  { valor: 'PENDIENTE_CORRECCION', etiqueta: 'Pendiente corrección' },
  { valor: 'CERRADA', etiqueta: 'Cerrada' },
];

/** I40: mismos colores de pestaña del Dashboard para los estados PQRS. */
const COLORES_PQRS: Record<string, { activa: string; punto: string }> = {
  ABIERTA: COLORES_PESTANA.ABIERTO,
  PENDIENTE_CORRECCION: COLORES_PESTANA.PENDIENTE_CORRECCION,
  CERRADA: COLORES_PESTANA.DESPACHADO,
  CANCELADA: COLORES_PESTANA.CANCELADO,
};

function inicioPeriodo(periodo: Periodo): Date | null {
  if (periodo === 'TODOS') return null;
  const ahora = new Date();
  if (periodo === 'HOY') {
    ahora.setHours(0, 0, 0, 0);
    return ahora;
  }
  ahora.setDate(ahora.getDate() - 7);
  return ahora;
}

function fechaCorta(iso: string): string {
  const f = new Date(iso);
  return f.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

/** Tarjeta KPI de alto impacto: degradado marino, número protagonista. */
function Kpi({
  icono: Icono,
  etiqueta,
  valor,
  detalle,
  acento,
}: {
  icono: LucideIcon;
  etiqueta: string;
  valor: number;
  detalle: string;
  acento: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sofia-800 via-sofia-900 to-sofia-950 p-5 text-white shadow-lg shadow-sofia-900/20">
      <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl ${acento}`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-sofia-200/80">
            {etiqueta}
          </p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums leading-none">{valor}</p>
          <p className="mt-2 text-xs text-sofia-200/70">{detalle}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
          <Icono size={20} className="text-menta-300" />
        </span>
      </div>
    </div>
  );
}

/** I40: pestaña con punto de color y conteo — la misma regla del Dashboard. */
function Pestañas({
  pestanas,
  conteo,
  activa,
  alCambiar,
  colores = COLORES_PESTANA,
}: {
  pestanas: { valor: string; etiqueta: string }[];
  conteo: (valor: string) => number;
  activa: string;
  alCambiar: (valor: string) => void;
  colores?: Record<string, { activa: string; punto: string }>;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {pestanas.map((p) => {
        const n = conteo(p.valor);
        const esActiva = activa === p.valor;
        const color = colores[p.valor] ?? COLORES_PESTANA.OTROS;
        return (
          <button
            key={p.valor}
            type="button"
            onClick={() => alCambiar(p.valor)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors ${
              esActiva
                ? `${color.activa} font-semibold`
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${color.punto}`} />
            {p.etiqueta} <span className="text-xs text-slate-400">({n})</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * I76/I78 — «Mi tablero» (portada del Comercial): canvas del viaje del
 * pedido (Abiertos → En alistamiento → En despacho) más las secciones
 * «Despachos» y «PQRS» con tarjetas de detalle, siguiendo las reglas del
 * Dashboard (pestañas por estado con conteo, tope de 16 tarjetas y enlace
 * «Más…» a la vista completa). Solo registros de su comercial: el backend
 * aplica el filtro. El período (Hoy/Semana/Todos) recorta las tres secciones.
 */
export default function TableroPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [casos, setCasos] = useState<Caso[]>([]);
  // I77: «Hoy» es el período por defecto
  const [periodo, setPeriodo] = useState<Periodo>('HOY');
  // I40: pestaña activa por sección (como en el Dashboard; arranca en Abierto/a)
  const [pestanaDespacho, setPestanaDespacho] = useState<string>('ABIERTO');
  const [pestanaPqrs, setPestanaPqrs] = useState<string>('ABIERTA');

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    // limite=0: el tablero necesita el universo completo para «Todos»
    api<Pedido[]>('/orders?limite=0').then(({ status, body }) => {
      if (status === 200) setPedidos(body);
    });
    api<Despacho[]>('/dispatches').then(({ status, body }) => {
      if (status === 200) setDespachos(body);
    });
    api<Caso[]>('/pqrs').then(({ status, body }) => {
      if (status === 200) setCasos(body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const desde = inicioPeriodo(periodo);
  const pedidosFiltrados = useMemo(
    () => (desde ? pedidos.filter((p) => new Date(p.createdAt) >= desde) : pedidos),
    [pedidos, periodo],
  );
  const despachosFiltrados = useMemo(
    () => (desde ? despachos.filter((d) => new Date(d.createdAt) >= desde) : despachos),
    [despachos, periodo],
  );
  const casosFiltrados = useMemo(
    () => (desde ? casos.filter((c) => new Date(c.createdAt) >= desde) : casos),
    [casos, periodo],
  );

  const porColumna = COLUMNAS.map((col) => ({
    ...col,
    pedidos: pedidosFiltrados.filter((p) => col.estados.includes(p.estado)),
  }));
  const activos = pedidosFiltrados.filter((p) => !['CANCELADO', 'DESPACHADO'].includes(p.estado));
  const despachosEnCurso = despachosFiltrados.filter(
    (d) => !['DESPACHADO', 'CANCELADO'].includes(d.estado),
  );
  const casosAbiertos = casosFiltrados.filter(
    (c) => c.estado === 'ABIERTA' || c.estado === 'PENDIENTE_CORRECCION',
  );

  // I40: tarjetas de la pestaña activa con tope y enlace «Más…»
  const despachosPestana = despachosFiltrados.filter((d) => d.estado === pestanaDespacho);
  const tarjetasDespachos = despachosPestana.slice(0, MAX_TARJETAS);
  const casosPestana = casosFiltrados.filter((c) => c.estado === pestanaPqrs);
  const tarjetasCasos = casosPestana.slice(0, MAX_TARJETAS);

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      {/* Encabezado + selector de período */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-sofia-900">Mi tablero</h1>
          <p className="text-sm text-slate-500">
            {sesion.usuario.nombre} — el viaje de tus pedidos en un vistazo.
          </p>
        </div>
        <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodo(p.id)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                periodo === p.id
                  ? 'bg-sofia-900 text-white shadow'
                  : 'text-slate-500 hover:text-sofia-800'
              }`}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* I75/I76: sin comercial asociado el backend no devuelve registros */}
      {sesion.usuario.rol === 'COMERCIAL' && !sesion.usuario.comercialId && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Su usuario aún no está asociado a un comercial, por eso el tablero aparece vacío.
          Pídale al administrador que lo asocie desde Gestión de usuarios.
        </p>
      )}

      {/* Indicadores macro */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          icono={ShoppingCart}
          etiqueta="Pedidos activos"
          valor={activos.length}
          detalle="Abiertos, en alistamiento o en despacho"
          acento="bg-menta-400"
        />
        <Kpi
          icono={PackageSearch}
          etiqueta="En alistamiento"
          valor={porColumna[1].pedidos.length}
          detalle="El almacén los está preparando"
          acento="bg-sofia-500"
        />
        <Kpi
          icono={Truck}
          etiqueta="Despachos en curso"
          valor={despachosEnCurso.length}
          detalle="Sin contar los ya despachados"
          acento="bg-menta-500"
        />
        <Kpi
          icono={RotateCcw}
          etiqueta="PQRS abiertas"
          valor={casosAbiertos.length}
          detalle="Devoluciones por resolver"
          acento="bg-rose-400"
        />
      </div>

      {/* Sección: Pedidos — canvas kanban del viaje del pedido */}
      <section className="mb-8">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-sofia-900">Pedidos</h2>
          <p className="text-sm text-slate-500">Tus pedidos según su etapa del flujo.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {porColumna.map((col) => (
            <div
              key={col.id}
              className={`flex max-h-[70vh] flex-col rounded-2xl border-t-4 ${col.acento} ${col.fondoColumna} p-3 shadow-sm ring-1 ring-slate-200/70`}
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sofia-900">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.punto}`} />
                  {col.titulo}
                </h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${col.chip}`}>
                  {col.pedidos.length}
                </span>
              </header>
              <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
                {col.pedidos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => router.push(`/pedidos?abrir=${p.id}`)}
                    className="block w-full rounded-xl bg-white p-3.5 text-left shadow-sm ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-sofia-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-sofia-900">{p.numero}</p>
                      <span className="text-xs text-slate-400">{fechaCorta(p.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">
                      {p.cliente?.nombre ?? '—'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {p.estado === 'PENDIENTE_CORRECCION' && (
                        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          <AlertTriangle size={11} /> Corrección
                        </span>
                      )}
                      {p.numeroFactura && (
                        <span className="rounded-full bg-menta-100 px-2 py-0.5 text-[11px] font-semibold text-menta-700">
                          Fact. {p.numeroFactura}
                        </span>
                      )}
                      {p.ciudad && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                          {p.ciudad}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {!col.pedidos.length && (
                  <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400">
                    Sin pedidos en esta etapa
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sección: Despachos — mismas reglas de la Cola de Despachos del Dashboard */}
      <Tarjeta className="mb-8 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-sofia-900">Despachos</h2>
          <p className="text-sm text-slate-500">Tus despachos según su estado de salida.</p>
        </div>
        <Pestañas
          pestanas={PESTANAS_DESPACHO}
          conteo={(v) => despachosFiltrados.filter((d) => d.estado === v).length}
          activa={pestanaDespacho}
          alCambiar={setPestanaDespacho}
        />
        {tarjetasDespachos.length ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tarjetasDespachos.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => router.push(`/despachos?abrir=${d.id}`)}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-left transition-shadow hover:shadow-md"
                >
                  <div className="mb-6 flex items-start justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sofia-700">
                      <Truck size={18} />
                    </span>
                    {d.estado === 'PENDIENTE_CORRECCION' && <Insignia tono="rojo">Corrección</Insignia>}
                    {d.estado === 'DESPACHADO' && <Insignia tono="verde">Salió</Insignia>}
                    {d.estado === 'PARCIAL' && <Insignia tono="ambar">Parcial</Insignia>}
                  </div>
                  <p className="font-semibold text-slate-800">{d.numero}</p>
                  <p className="truncate text-sm font-medium text-sofia-700">
                    {d.clienteNombre ?? 'Sin cliente'}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {d.nombreTransporte || (d.tipoTransporte ? `Transporte ${d.tipoTransporte}` : 'Sin transporte')}
                    {d.guia ? ` · Guía ${d.guia}` : ''}
                  </p>
                  {d.facturas && d.facturas.length > 0 && (
                    <p className="mt-1 truncate text-xs text-menta-700">
                      Fact. {d.facturas.join(', ')}
                    </p>
                  )}
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock size={13} /> {tiempoRelativo(d.createdAt)}
                  </p>
                </button>
              ))}
            </div>
            {despachosPestana.length > MAX_TARJETAS && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => router.push('/despachos')}
                  className="text-sm font-medium text-sofia-700 hover:text-sofia-600"
                >
                  Más ({despachosPestana.length - MAX_TARJETAS} despachos adicionales) →
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">
            No hay despachos en estado «{PESTANAS_DESPACHO.find((p) => p.valor === pestanaDespacho)?.etiqueta}».
          </p>
        )}
      </Tarjeta>

      {/* Sección: PQRS — misma forma de tarjetas por estado */}
      <Tarjeta className="mb-8 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-sofia-900">PQRS</h2>
          <p className="text-sm text-slate-500">Devoluciones y reclamos de tus clientes.</p>
        </div>
        <Pestañas
          pestanas={PESTANAS_PQRS}
          conteo={(v) => casosFiltrados.filter((c) => c.estado === v).length}
          activa={pestanaPqrs}
          alCambiar={setPestanaPqrs}
          colores={COLORES_PQRS}
        />
        {tarjetasCasos.length ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tarjetasCasos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push('/devoluciones')}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-left transition-shadow hover:shadow-md"
                >
                  <div className="mb-6 flex items-start justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-500">
                      <RotateCcw size={18} />
                    </span>
                    {c.estado === 'ABIERTA' && <Insignia tono="rojo">Abierta</Insignia>}
                    {c.estado === 'PENDIENTE_CORRECCION' && <Insignia tono="ambar">Corrección</Insignia>}
                    {c.estado === 'CERRADA' && <Insignia tono="verde">Cerrada</Insignia>}
                  </div>
                  <p className="font-semibold text-slate-800">{c.codigo}</p>
                  <p className="truncate text-sm font-medium text-sofia-700">
                    {c.clienteNombre ?? 'Sin cliente'}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {c.motivoCodigo} · {c.cantidad} und
                    {c.empresaNombre ? ` · ${c.empresaNombre}` : ''}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock size={13} /> {tiempoRelativo(c.createdAt)}
                  </p>
                </button>
              ))}
            </div>
            {casosPestana.length > MAX_TARJETAS && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => router.push('/devoluciones')}
                  className="text-sm font-medium text-sofia-700 hover:text-sofia-600"
                >
                  Más ({casosPestana.length - MAX_TARJETAS} casos adicionales) →
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">
            No hay casos en estado «{PESTANAS_PQRS.find((p) => p.valor === pestanaPqrs)?.etiqueta}».
          </p>
        )}
      </Tarjeta>
    </AppShell>
  );
}
