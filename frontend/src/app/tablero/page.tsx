'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ClipboardList,
  PackageSearch,
  RotateCcw,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';

interface Pedido {
  id: string;
  numero: string;
  estado: string;
  numeroFactura: string | null;
  ciudad: string | null;
  createdAt: string;
  cliente: { id: string; nombre: string } | null;
}
interface Caso {
  id: string;
  codigo: string;
  estado: string;
  motivoCodigo: string;
  cantidad: number;
  clienteNombre: string;
  createdAt: string;
}

type Periodo = 'HOY' | 'SEMANA' | 'TODOS';

const PERIODOS: { id: Periodo; etiqueta: string }[] = [
  { id: 'HOY', etiqueta: 'Hoy' },
  { id: 'SEMANA', etiqueta: 'Semana' },
  { id: 'TODOS', etiqueta: 'Todos' },
];

/** I76: agrupaciones del canvas comercial — el viaje del pedido. */
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

/**
 * I76 — «Mi tablero» (portada del Comercial): canvas kanban del viaje del
 * pedido (Abiertos → En alistamiento → En despacho) solo con los registros
 * de su comercial; el backend aplica el filtro automáticamente. El período
 * (hoy / semana / todos) recorta KPIs, columnas y PQRS por fecha de creación.
 */
export default function TableroPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [casos, setCasos] = useState<Caso[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>('SEMANA');

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    // limite=0: el tablero necesita el universo completo para «Todos»
    api<Pedido[]>('/orders?limite=0').then(({ status, body }) => {
      if (status === 200) setPedidos(body);
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
  const casosFiltrados = useMemo(
    () => (desde ? casos.filter((c) => new Date(c.createdAt) >= desde) : casos),
    [casos, periodo],
  );

  const porColumna = COLUMNAS.map((col) => ({
    ...col,
    pedidos: pedidosFiltrados.filter((p) => col.estados.includes(p.estado)),
  }));
  const activos = pedidosFiltrados.filter((p) => !['CANCELADO', 'DESPACHADO'].includes(p.estado));
  const casosAbiertos = casosFiltrados.filter(
    (c) => c.estado === 'ABIERTA' || c.estado === 'PENDIENTE_CORRECCION',
  );

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
          etiqueta="En despacho"
          valor={porColumna[2].pedidos.length}
          detalle="Aprobados o ya despachados"
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

      {/* Canvas kanban del viaje del pedido */}
      <div className="grid gap-4 lg:grid-cols-3">
        {porColumna.map((col) => (
          <section
            key={col.id}
            className={`flex max-h-[70vh] flex-col rounded-2xl border-t-4 ${col.acento} ${col.fondoColumna} p-3 shadow-sm ring-1 ring-slate-200/70`}
          >
            <header className="mb-3 flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sofia-900">
                <span className={`h-2.5 w-2.5 rounded-full ${col.punto}`} />
                {col.titulo}
              </h2>
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
          </section>
        ))}
      </div>

      {/* PQRS abiertas del período */}
      {casosAbiertos.length > 0 && (
        <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sofia-900">
            <ClipboardList size={16} className="text-rose-500" />
            Devoluciones abiertas
          </h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {casosAbiertos.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-rose-50/60 p-3 ring-1 ring-rose-100"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sofia-900">{c.codigo}</p>
                  <span className="text-xs text-slate-400">{fechaCorta(c.createdAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-600">{c.clienteNombre}</p>
                <p className="mt-1 text-xs text-rose-600">
                  {c.motivoCodigo} · {c.cantidad} und · {c.estado === 'ABIERTA' ? 'Abierta' : 'Pendiente corrección'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
