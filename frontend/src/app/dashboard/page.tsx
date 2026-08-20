'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  Download,
  MapPin,
  Package,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { useAvisoEstadosPedidos } from '@/lib/sonido';
import { AppShell } from '@/components/app-shell';
import {
  CLASES_TABLA,
  COLORES_PESTANA,
  EncabezadoPagina,
  Insignia,
  Tarjeta,
  TarjetaStat,
  TonoInsignia,
} from '@/components/ui';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
  ciudad?: string;
}

interface PedidoCola {
  id: string;
  numero: string;
  estado: 'ABIERTO' | 'ALISTADO' | 'APROBADO' | 'PENDIENTE_CORRECCION' | 'CANCELADO' | 'DESPACHADO';
  createdAt: string;
  clienteId: string;
}

interface DespachoTraza {
  id: string;
  numero: string;
  estado: string;
  clienteId: string;
  createdAt: string;
  fechaSalida: string | null;
  tipoTransporte: string | null;
  empresas?: string[];
}

interface InboundPendiente {
  id: string;
  estado: string;
}

interface ProductoStock {
  cantidad: number;
  estado: string;
}

const PESTANAS: { valor: PedidoCola['estado']; etiqueta: string }[] = [
  { valor: 'ABIERTO', etiqueta: 'Abierto' },
  { valor: 'ALISTADO', etiqueta: 'Alistado' },
  { valor: 'APROBADO', etiqueta: 'Aprobado' },
  { valor: 'DESPACHADO', etiqueta: 'Despachado' },
  { valor: 'PENDIENTE_CORRECCION', etiqueta: 'Pendiente corrección' },
];

/**
 * I21: color por estado en las pestañas de la cola — el mismo código de
 * color se reutiliza en Pedidos y alistamiento (definido en ui.tsx).
 */

const TONOS_DESPACHO: Record<string, TonoInsignia> = {
  CREADO: 'gris',
  ABIERTO: 'menta',
  PARCIAL: 'ambar',
  DESPACHADO: 'verde',
  PENDIENTE_CORRECCION: 'rojo',
  CANCELADO: 'gris',
};

const ETIQUETA_DESPACHO: Record<string, string> = {
  CREADO: 'Creado',
  ABIERTO: 'Abierto',
  PARCIAL: 'Parcial',
  DESPACHADO: 'Despachado',
  PENDIENTE_CORRECCION: 'Pendiente corrección',
  CANCELADO: 'Cancelado',
};

/** Minutos transcurridos en lenguaje natural ("hace 15 min", "hace 2 h"). */
function haceMinutos(fechaIso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(fechaIso).getTime()) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  return `hace ${horas} h`;
}

function formatearFecha(fechaIso: string | null): string {
  if (!fechaIso) return '—';
  const d = new Date(fechaIso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** I17: mapa estático ilustrativo del almacén (sin datos operativos en el modelo). */
function MapaAlmacen() {
  return (
    <Tarjeta className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Mapa del Almacén</h2>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-menta-400" /> Operativo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sofia-700" /> Crítico
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> Libre
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex h-36 flex-col items-center justify-center rounded-lg bg-slate-100">
            <p className="text-lg font-bold tracking-wide text-slate-700">ZONA A</p>
            <p className="text-xs text-slate-500">Racks Pesados</p>
          </div>
          <div className="flex h-36 flex-col items-center justify-center rounded-lg bg-slate-100">
            <p className="text-lg font-bold tracking-wide text-slate-700">ZONA B</p>
            <p className="text-xs text-slate-500">Pick-Pack</p>
          </div>
          <div className="relative flex h-36 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white">
            <span className="absolute right-3 top-3 h-3 w-3 rounded-full bg-menta-400" />
            <p className="text-lg font-bold tracking-wide text-slate-700">ZONA C</p>
            <p className="text-xs text-slate-500">Devoluciones</p>
          </div>
        </div>

        <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          Corredor principal de montacargas
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex h-24 flex-col items-center justify-center rounded-lg bg-menta-200 text-sofia-900">
            <MapPin size={18} />
            <p className="mt-1 text-sm font-medium">Bahía 01</p>
          </div>
          <div className="flex h-24 flex-col items-center justify-center rounded-lg bg-menta-200 text-sofia-900">
            <MapPin size={18} />
            <p className="mt-1 text-sm font-medium">Bahía 02</p>
          </div>
          <div className="flex h-24 flex-col items-center justify-center rounded-lg bg-slate-100 text-slate-400">
            <MapPin size={18} />
            <p className="mt-1 text-sm font-medium">Bahía 03</p>
          </div>
          <div className="flex h-24 flex-col items-center justify-center rounded-lg bg-slate-100 text-sofia-700">
            <Truck size={18} />
            <p className="mt-1 text-sm font-medium">Patio de Maniobras</p>
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}

/** Dashboard: monitor de flujo logístico (I17). El backend filtra por rol. */
export default function DashboardPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [pedidos, setPedidos] = useState<PedidoCola[]>([]);
  const [despachos, setDespachos] = useState<DespachoTraza[]>([]);
  const [stockTotal, setStockTotal] = useState<number | null>(null);
  // I25: además de las unidades, cuántos productos tienen existencias (> 0)
  const [productosConStock, setProductosConStock] = useState<number | null>(null);
  const [recibosPendientes, setRecibosPendientes] = useState<number | null>(null);
  const [nombreClientes, setNombreClientes] = useState<Record<string, string>>({});
  const [pestana, setPestana] = useState<PedidoCola['estado']>('ABIERTO');

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.debeCambiarClave) return router.replace('/cambiar-clave');
    setSesion(s);

    api<Empresa[]>('/companies').then(async ({ status, body }) => {
      if (status !== 200) return;
      setEmpresas(body);
      // KPI Stock total: suma de existencias activas de todas las empresas
      const listas = await Promise.all(
        body.map((e) => api<ProductoStock[]>(`/products?empresaId=${e.id}`)),
      );
      let total = 0;
      let conExistencias = 0;
      for (const { status: st, body: prods } of listas) {
        if (st !== 200) continue;
        for (const p of prods) {
          if (p.estado === 'ACTIVO') {
            const und = Number(p.cantidad) || 0;
            total += und;
            if (und > 0) conExistencias += 1;
          }
        }
      }
      setStockTotal(total);
      setProductosConStock(conExistencias);
    });

    // I21: sondeo cada 20 s para detectar cambios de estado y avisar en sonido
    const cargarPedidos = () =>
      api<PedidoCola[]>('/orders').then(({ status, body }) => {
        if (status === 200) setPedidos(body);
      });
    cargarPedidos();
    const sondeo = setInterval(cargarPedidos, 20000);
    api<DespachoTraza[]>('/dispatches').then(({ status, body }) => {
      if (status === 200) setDespachos(body);
    });
    // KPI Recibos pendientes: recibos de ingreso aún no aprobados
    api<InboundPendiente[]>('/inbound').then(({ status, body }) => {
      if (status === 200) {
        setRecibosPendientes(body.filter((r) => r.estado !== 'APROBADO' && r.estado !== 'CANCELADO').length);
      }
    });
    api<{ id: string; nombre: string }[]>('/clients').then(({ status, body }) => {
      if (status === 200) {
        const mapa: Record<string, string> = {};
        for (const c of body) mapa[c.id] = c.nombre;
        setNombreClientes(mapa);
      }
    });
    return () => clearInterval(sondeo);
  }, [router]);

  // I21: aviso sonoro al cambiar el estado de un pedido (excepto CANCELADO)
  useAvisoEstadosPedidos(pedidos);

  if (!sesion) return null;
  const hoy = new Date().toDateString();
  // I25: indicador Pedidos hoy (creados en la fecha actual)
  const pedidosHoy = pedidos.filter(
    (p) => p.createdAt && new Date(p.createdAt).toDateString() === hoy,
  ).length;
  const despachosHoy = despachos.filter(
    (d) => d.fechaSalida && new Date(d.fechaSalida).toDateString() === hoy,
  ).length;
  const enPestana = pedidos
    .filter((p) => p.estado === pestana)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const trazabilidad = [...despachos]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="SofIA Logística Inteligente"
        descripcion="Monitor de flujo logístico y eficiencia de almacén."
      />

      {/* Empresas registradas */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Empresas registradas
      </h2>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {empresas.map((e) => (
          <Tarjeta key={e.id} className="flex items-center gap-4 p-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sofia-900 text-sm font-bold text-white">
              {e.siglas}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{e.siglas}</p>
              <p className="truncate text-sm text-slate-500">{e.nombre}</p>
            </div>
          </Tarjeta>
        ))}
      </div>

      {/* KPIs operativos (I25): Stock total muestra arriba la cantidad de
          productos con existencias y debajo las unidades; Recibos pendientes
          va de último en la fila */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaStat
          icono={Package}
          etiqueta="Stock total"
          valor={productosConStock === null ? '…' : productosConStock.toLocaleString('es-CO')}
          unidad="productos"
          detalle={
            stockTotal === null
              ? undefined
              : `${stockTotal.toLocaleString('es-CO')} unidades`
          }
          tono="azul"
        />
        <TarjetaStat
          icono={ShoppingCart}
          etiqueta="Pedidos hoy"
          valor={String(pedidosHoy)}
          unidad="Pedidos"
          tono="rosa"
        />
        <TarjetaStat
          icono={Truck}
          etiqueta="Despachos hoy"
          valor={String(despachosHoy)}
          unidad="Órdenes"
          tono="marino"
        />
        <TarjetaStat
          icono={Download}
          etiqueta="Recibos pendientes"
          valor={recibosPendientes === null ? '…' : String(recibosPendientes)}
          unidad="Lotes"
          tono="menta"
        />
      </div>

      {/* Cola de pedidos (picking y packing) */}
      <Tarjeta className="mb-8 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Cola de Pedidos (Picking y Packing)</h2>
          <p className="text-sm text-slate-500">Pedidos listos para alistamiento y empaque.</p>
        </div>
        <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
          {PESTANAS.map((t) => {
            const n = pedidos.filter((p) => p.estado === t.valor).length;
            const activa = pestana === t.valor;
            const color = COLORES_PESTANA[t.valor];
            return (
              <button
                key={t.valor}
                onClick={() => setPestana(t.valor)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors ${
                  activa
                    ? `${color.activa} font-semibold`
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${color.punto}`} />
                {t.etiqueta} <span className="text-xs text-slate-400">({n})</span>
              </button>
            );
          })}
        </div>
        {enPestana.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {enPestana.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/pedidos?abrir=${p.id}`)}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-left transition-shadow hover:shadow-md"
              >
                <div className="mb-6 flex items-start justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sofia-700">
                    <Package size={18} />
                  </span>
                  {p.estado === 'PENDIENTE_CORRECCION' && <Insignia tono="rojo">Corrección</Insignia>}
                  {p.estado === 'APROBADO' && <Insignia tono="menta">Prioridad</Insignia>}
                </div>
                <p className="font-semibold text-slate-800">{p.numero}</p>
                <p className="truncate text-sm font-medium text-sofia-700">
                  {nombreClientes[p.clienteId] ?? 'Sin cliente'}
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                  <Clock size={13} /> {haceMinutos(p.createdAt)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">
            No hay pedidos en estado «{PESTANAS.find((t) => t.valor === pestana)?.etiqueta}».
          </p>
        )}
      </Tarjeta>

      {/* Mapa del almacén (ilustrativo) */}
      <div className="mb-8">
        <MapaAlmacen />
      </div>

      {/* Trazabilidad reciente de despachos */}
      <Tarjeta className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Trazabilidad Reciente de Despachos</h2>
          <button
            onClick={() => router.push('/despachos')}
            className="text-sm font-medium text-sofia-700 hover:text-sofia-600"
          >
            Ver todos →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className={CLASES_TABLA.tabla}>
            <thead>
              <tr className={CLASES_TABLA.cabecera}>
                <th className={CLASES_TABLA.celdaCabecera}>Fecha</th>
                <th className={CLASES_TABLA.celdaCabecera}>Despacho</th>
                <th className={CLASES_TABLA.celdaCabecera}>Cliente</th>
                <th className={CLASES_TABLA.celdaCabecera}>Estado</th>
                <th className={CLASES_TABLA.celdaCabecera}>Transporte</th>
              </tr>
            </thead>
            <tbody>
              {trazabilidad.map((d) => (
                <tr
                  key={d.id}
                  className={`${CLASES_TABLA.fila} cursor-pointer`}
                  onClick={() => router.push('/despachos')}
                >
                  <td className={CLASES_TABLA.celda}>{formatearFecha(d.fechaSalida ?? d.createdAt)}</td>
                  <td className={`${CLASES_TABLA.celda} font-medium text-sofia-700`}>{d.numero}</td>
                  <td className={CLASES_TABLA.celda}>{nombreClientes[d.clienteId] ?? '—'}</td>
                  <td className={CLASES_TABLA.celda}>
                    <Insignia tono={TONOS_DESPACHO[d.estado] ?? 'gris'}>
                      {ETIQUETA_DESPACHO[d.estado] ?? d.estado}
                    </Insignia>
                  </td>
                  <td className={CLASES_TABLA.celda}>{d.tipoTransporte ?? '—'}</td>
                </tr>
              ))}
              {!trazabilidad.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                    Aún no hay despachos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {/* Acceso rápido para el rol comercial */}
      {sesion.usuario.rol === 'COMERCIAL' && (
        <div className="mt-6">
          <button
            onClick={() => router.push('/tablero')}
            className="flex items-center gap-2 rounded-lg bg-sofia-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sofia-600"
          >
            <CheckCircle2 size={16} /> Ir a mi tablero
          </button>
        </div>
      )}
    </AppShell>
  );
}
