'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
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

/** I40: misma regla del Dashboard — tope de tarjetas por columna. */
const MAX_TARJETAS = 16;

interface ColumnaKanban {
  id: string;
  titulo: string;
  estados: string[];
  acento: string;
  fondoColumna: string;
  punto: string;
  chip: string;
  mensajeVacio: string;
  /** I80: la columna solo aparece cuando tiene registros en el período. */
  ocultarSiVacia?: boolean;
}

/** Construye la definición visual de una columna kanban. */
function kanban(
  id: string,
  titulo: string,
  estados: string[],
  acento: string,
  fondoColumna: string,
  punto: string,
  chip: string,
  mensajeVacio: string,
  ocultarSiVacia = false,
): ColumnaKanban {
  return { id, titulo, estados, acento, fondoColumna, punto, chip, mensajeVacio, ocultarSiVacia };
}

/** I76: columnas del canvas de pedidos — el viaje del pedido. */
const COLUMNAS: ColumnaKanban[] = [
  kanban('abiertos', 'Abiertos', ['ABIERTO', 'PENDIENTE_CORRECCION'],
    'border-t-amber-400', 'bg-amber-50/60', 'bg-amber-400', 'bg-amber-100 text-amber-700',
    'Sin pedidos en esta etapa'),
  kanban('alistamiento', 'En alistamiento', ['ALISTADO'],
    'border-t-sky-400', 'bg-sky-50/60', 'bg-sky-500', 'bg-sky-100 text-sky-700',
    'Sin pedidos en esta etapa'),
  kanban('despacho', 'En despacho', ['APROBADO', 'DESPACHADO'],
    'border-t-menta-400', 'bg-menta-50/60', 'bg-menta-400', 'bg-menta-100 text-menta-700',
    'Sin pedidos en esta etapa'),
];

/** I79: columnas kanban de Despachos (mismos estados de la Cola del Dashboard, sin «Creado»).
 *  I80: sin relleno de color (solo bordes y acentos); Parcial y Pendiente
 *  corrección solo aparecen cuando tienen registros. */
const COLUMNAS_DESPACHO: ColumnaKanban[] = [
  kanban('d-abierto', 'Abierto', ['ABIERTO'],
    'border-t-amber-400', 'bg-white', 'bg-amber-400', 'bg-amber-100 text-amber-700',
    'Sin despachos abiertos'),
  kanban('d-parcial', 'Parcial', ['PARCIAL'],
    'border-t-orange-400', 'bg-white', 'bg-orange-500', 'bg-orange-100 text-orange-700',
    'Sin despachos parciales', true),
  kanban('d-despachado', 'Despachado', ['DESPACHADO'],
    'border-t-emerald-400', 'bg-white', 'bg-emerald-500', 'bg-emerald-100 text-emerald-700',
    'Sin despachos despachados'),
  kanban('d-correccion', 'Pendiente corrección', ['PENDIENTE_CORRECCION'],
    'border-t-red-400', 'bg-white', 'bg-red-500', 'bg-red-100 text-red-700',
    'Sin despachos por corregir', true),
];

/** I79: columnas kanban de PQRS.
 *  I80: sin relleno de color; Pendiente corrección solo si hay registros. */
const COLUMNAS_PQRS: ColumnaKanban[] = [
  kanban('q-abierta', 'Abierta', ['ABIERTA'],
    'border-t-amber-400', 'bg-white', 'bg-amber-400', 'bg-amber-100 text-amber-700',
    'Sin casos abiertos'),
  kanban('q-correccion', 'Pendiente corrección', ['PENDIENTE_CORRECCION'],
    'border-t-red-400', 'bg-white', 'bg-red-500', 'bg-red-100 text-red-700',
    'Sin casos por corregir', true),
  kanban('q-cerrada', 'Cerrada', ['CERRADA'],
    'border-t-emerald-400', 'bg-white', 'bg-emerald-500', 'bg-emerald-100 text-emerald-700',
    'Sin casos cerrados'),
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
 * I79: sección kanban reutilizable — la misma forma para Pedidos,
 * Despachos y PQRS: título, columnas por estado con color propio y
 * tarjetas con tope por columna + enlace «Más…» a la vista completa.
 */
function SeccionKanban<T extends { id: string; estado: string }>({
  titulo,
  descripcion,
  columnas,
  items,
  renderTarjeta,
  enlaceMas,
  alVerMas,
  columnasCss,
  columnasCssPorCantidad,
}: {
  titulo: string;
  descripcion: string;
  columnas: ColumnaKanban[];
  items: T[];
  renderTarjeta: (item: T) => React.ReactNode;
  enlaceMas: string;
  alVerMas: () => void;
  /** Clases de rejilla; si no se indica se calcula por nº de columnas visibles. */
  columnasCss?: string;
  /** I80: rejillas según la cantidad de columnas visibles (2, 3 o 4). */
  columnasCssPorCantidad?: [string, string, string];
}) {
  // I80: las columnas con `ocultarSiVacia` solo se muestran con registros
  const visibles = columnas.filter(
    (col) => !col.ocultarSiVacia || items.some((i) => col.estados.includes(i.estado)),
  );
  const rejilla =
    columnasCss ??
    (columnasCssPorCantidad?.[visibles.length - 2] || 'lg:grid-cols-3');
  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-sofia-900">{titulo}</h2>
        <p className="text-sm text-slate-500">{descripcion}</p>
      </div>
      <div className={`grid gap-4 ${rejilla}`}>
        {visibles.map((col) => {
          const enColumna = items.filter((i) => col.estados.includes(i.estado));
          const tarjetas = enColumna.slice(0, MAX_TARJETAS);
          return (
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
                  {enColumna.length}
                </span>
              </header>
              <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
                {tarjetas.map(renderTarjeta)}
                {!enColumna.length && (
                  <p className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400">
                    {col.mensajeVacio}
                  </p>
                )}
              </div>
              {/* I40/I79: tope por columna con enlace a la vista completa */}
              {enColumna.length > MAX_TARJETAS && (
                <div className="mt-2 border-t border-slate-200/70 pt-2 text-center">
                  <button
                    type="button"
                    onClick={alVerMas}
                    className="text-xs font-medium text-sofia-700 hover:text-sofia-600"
                  >
                    Más ({enColumna.length - MAX_TARJETAS} en «{enlaceMas}») →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * I76/I78/I79 — «Mi tablero» (portada del Comercial): tres secciones
 * kanban — «Pedidos» (viaje del pedido), «Despachos» (estado de salida)
 * y «PQRS» (seguimiento del caso) — solo con los registros de su
 * comercial; el backend aplica el filtro. Las píldoras Hoy / Semana /
 * Todos filtran las tres secciones por fecha de creación.
 */
export default function TableroPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [casos, setCasos] = useState<Caso[]>([]);
  // I77: «Hoy» es el período por defecto
  const [periodo, setPeriodo] = useState<Periodo>('HOY');

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

      {/* I79: las tres secciones comparten el mismo formato kanban */}
      <SeccionKanban
        titulo="Pedidos"
        descripcion="Tus pedidos según su etapa del flujo."
        columnas={COLUMNAS}
        items={pedidosFiltrados}
        enlaceMas="Pedidos"
        alVerMas={() => router.push('/pedidos')}
        renderTarjeta={(p) => (
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
        )}
      />

      <SeccionKanban
        titulo="Despachos"
        descripcion="Tus despachos según su estado de salida."
        columnas={COLUMNAS_DESPACHO}
        items={despachosFiltrados}
        enlaceMas="Despachos"
        alVerMas={() => router.push('/despachos')}
        columnasCssPorCantidad={['sm:grid-cols-2', 'sm:grid-cols-2 xl:grid-cols-3', 'sm:grid-cols-2 xl:grid-cols-4']}
        renderTarjeta={(d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => router.push(`/despachos?abrir=${d.id}`)}
            className="block w-full rounded-xl bg-white p-3.5 text-left shadow-sm ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-sofia-300"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-sofia-900">{d.numero}</p>
              <span className="text-xs text-slate-400">{fechaCorta(d.createdAt)}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {d.clienteNombre ?? 'Sin cliente'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {d.estado === 'PENDIENTE_CORRECCION' && (
                <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                  <AlertTriangle size={11} /> Corrección
                </span>
              )}
              {d.estado === 'DESPACHADO' && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  Salió
                </span>
              )}
              {d.estado === 'PARCIAL' && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                  Parcial
                </span>
              )}
              {d.facturas && d.facturas.length > 0 && (
                <span className="rounded-full bg-menta-100 px-2 py-0.5 text-[11px] font-semibold text-menta-700">
                  Fact. {d.facturas.join(', ')}
                </span>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Truck size={12} className="shrink-0" />
              <span className="truncate">
                {d.nombreTransporte || (d.tipoTransporte ? `Transporte ${d.tipoTransporte}` : 'Sin transporte')}
                {d.guia ? ` · Guía ${d.guia}` : ''}
              </span>
            </p>
          </button>
        )}
      />

      <SeccionKanban
        titulo="PQRS"
        descripcion="Devoluciones y reclamos de tus clientes."
        columnas={COLUMNAS_PQRS}
        items={casosFiltrados}
        enlaceMas="Devoluciones"
        alVerMas={() => router.push('/devoluciones')}
        columnasCssPorCantidad={['sm:grid-cols-2', 'lg:grid-cols-3', 'sm:grid-cols-2 xl:grid-cols-4']}
        renderTarjeta={(c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => router.push('/devoluciones')}
            className="block w-full rounded-xl bg-white p-3.5 text-left shadow-sm ring-1 ring-slate-200/80 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-sofia-300"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-sofia-900">{c.codigo}</p>
              <span className="text-xs text-slate-400">{fechaCorta(c.createdAt)}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {c.clienteNombre ?? 'Sin cliente'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.estado === 'PENDIENTE_CORRECCION' && (
                <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                  <AlertTriangle size={11} /> Corrección
                </span>
              )}
              {c.estado === 'CERRADA' && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  Cerrada
                </span>
              )}
              {c.empresaNombre && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  {c.empresaNombre}
                </span>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <RotateCcw size={12} className="shrink-0" />
              <span className="truncate">
                {c.motivoCodigo} · {c.cantidad} und
              </span>
            </p>
          </button>
        )}
      />
    </AppShell>
  );
}
