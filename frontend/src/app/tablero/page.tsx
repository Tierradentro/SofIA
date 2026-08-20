'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

interface Pedido { id: string; numero: string; estado: string; numeroFactura: string | null; createdAt: string }
interface Despacho { id: string; numero: string; estado: string; nombreTransporte: string | null; guia: string | null }
interface Caso { id: string; codigo: string; estado: string; motivoCodigo: string; cantidad: number; clienteNombre: string }

const ESTADO_PEDIDO: Record<string, string> = {
  ABIERTO: 'Abierto', ALISTADO: 'Alistado', APROBADO: 'Aprobado', DESPACHADO: 'Despachado',
  FACTURA_CON_DIFERENCIAS: 'Factura con diferencias', CANCELADO: 'Cancelado',
};
const ESTADO_DESPACHO: Record<string, string> = {
  CREADO: 'Creado', ABIERTO: 'Abierto', PENDIENTE_CORRECCION: 'Pendiente corrección',
  PARCIAL: 'Parcial', DESPACHADO: 'Despachado', CANCELADO: 'Cancelado',
};
const ESTADO_PQRS: Record<string, string> = {
  ABIERTA: 'Abierta', PENDIENTE_CORRECCION: 'Pendiente corrección', CERRADA: 'Cerrada', CANCELADA: 'Cancelada',
};

/**
 * Tablero del Comercial (M02): solo ve los pedidos, despachos y casos PQRS
 * asociados a su comercial (el backend aplica el filtro automáticamente).
 */
export default function TableroPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [despachos, setDespachos] = useState<Despacho[]>([]);
  const [casos, setCasos] = useState<Caso[]>([]);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    api<Pedido[]>('/orders').then(({ status, body }) => {
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


  const activos = pedidos.filter((p) => p.estado !== 'CANCELADO');
  const enTransito = despachos.filter((d) => !['DESPACHADO', 'CANCELADO'].includes(d.estado));
  const casosAbiertos = casos.filter((c) => c.estado === 'ABIERTA' || c.estado === 'PENDIENTE_CORRECCION');

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Mi tablero"
      descripcion="Pedidos, despachos y devoluciones asociados a su comercial." />

      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-2xl font-bold text-sofia-700">{activos.length}</p>
          <p className="text-sm text-slate-500">Pedidos activos</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-2xl font-bold text-sofia-700">{enTransito.length}</p>
          <p className="text-sm text-slate-500">Despachos en curso</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-2xl font-bold text-sofia-700">{casosAbiertos.length}</p>
          <p className="text-sm text-slate-500">PQRS abiertas</p>
        </div>
      </div>

      <section className="mb-4 rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Pedidos recientes</h2>
        {pedidos.length === 0 ? (
          <p className="text-sm text-slate-500">Sin pedidos asociados.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Número</th><th>Estado</th><th>Factura</th><th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.slice(0, 10).map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-1 font-medium">{p.numero}</td>
                  <td>{ESTADO_PEDIDO[p.estado] ?? p.estado}</td>
                  <td className="text-slate-500">{p.numeroFactura ?? '—'}</td>
                  <td className="text-slate-500">{new Date(p.createdAt).toLocaleDateString('es-CO')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Despachos</h2>
        {despachos.length === 0 ? (
          <p className="text-sm text-slate-500">Sin despachos asociados.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Número</th><th>Estado</th><th>Transporte</th><th>Guía</th>
              </tr>
            </thead>
            <tbody>
              {despachos.slice(0, 10).map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-1 font-medium">{d.numero}</td>
                  <td>{ESTADO_DESPACHO[d.estado] ?? d.estado}</td>
                  <td className="text-slate-500">{d.nombreTransporte ?? '—'}</td>
                  <td className="text-slate-500">{d.guia ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Devoluciones (PQRS)</h2>
        {casos.length === 0 ? (
          <p className="text-sm text-slate-500">Sin casos asociados.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Producto</th><th>Cliente</th><th>Motivo</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {casos.slice(0, 10).map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-1 font-medium">{c.codigo} × {c.cantidad}</td>
                  <td>{c.clienteNombre}</td>
                  <td>{c.motivoCodigo}</td>
                  <td>{ESTADO_PQRS[c.estado] ?? c.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
        </AppShell>
  );
}
