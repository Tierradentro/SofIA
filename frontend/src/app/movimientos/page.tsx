'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';

interface Empresa { id: string; nombre: string; siglas: string }
interface Producto { id: string; codigo: string; descripcion: string }
interface Movimiento {
  id: string;
  tipo: string;
  cantidadDelta: number | null;
  cantidadBloqueadaDelta: number | null;
  docTipo: string | null;
  docId: string | null;
  usuarioUsername: string | null;
  motivo: string | null;
  createdAt: string;
}

const TIPO_LABEL: Record<string, string> = {
  INGRESO_MERCANCIA: 'Ingreso',
  BLOQUEO_ALISTAMIENTO: 'Bloqueo alistamiento',
  LIBERACION_BLOQUEO: 'Liberación bloqueo',
  DESPACHO_CIERRE_CAJA: 'Despacho (cierre caja)',
  CANCELACION_DESPACHO: 'Cancelación despacho',
  AJUSTE_IMPORTACION: 'Ajuste importación',
  REINGRESO_DEVOLUCION: 'Reingreso devolución',
  AJUSTE_INVENTARIO: 'Ajuste inventario',
};

/**
 * Kardex (M18, B-10): movimientos de inventario por empresa y producto.
 * Todos los ajustes de existencia son movimientos — nunca edición directa.
 */
export default function MovimientosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productId, setProductId] = useState('');
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(false);
  const [reconciliacion, setReconciliacion] = useState<any>(null);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setEmpresas(body);
        setEmpresaId(body[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    setProductId('');
    setReconciliacion(null);
    api<Producto[]>(`/products?empresaId=${empresaId}`).then(({ status, body }) => {
      if (status === 200) setProductos(body);
    });
    setCargando(true);
    api<Movimiento[]>(`/movements?empresaId=${empresaId}`).then(({ status, body }) => {
      if (status === 200) setMovimientos(body);
      setCargando(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  useEffect(() => {
    if (!productId) {
      setReconciliacion(null);
      return;
    }
    setCargando(true);
    api<Movimiento[]>(`/movements/producto/${productId}`).then(({ status, body }) => {
      if (status === 200) setMovimientos(body);
      setCargando(false);
    });
    api(`/movements/producto/${productId}/reconcile`).then(({ status, body }) => {
      if (status === 200) setReconciliacion(body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (!sesion) return null;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Movimientos de inventario (kardex)</h1>
        <button onClick={() => router.push('/dashboard')} className="rounded bg-slate-200 px-3 py-1 text-sm">← Panel</button>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 rounded-lg bg-white p-4 shadow">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Empresa</label>
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border px-2 py-1 text-sm">
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Producto (opcional — filtra el kardex)</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="rounded border px-2 py-1 text-sm">
            <option value="">Todos los de la empresa</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.codigo} — {p.descripcion}</option>
            ))}
          </select>
        </div>
      </div>

      {reconciliacion && (
        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-white p-3 shadow">
            <p className="text-lg font-bold text-sofia-700">{reconciliacion.sumaMovimientos ?? reconciliacion.cantidadMovimientos}</p>
            <p className="text-xs text-slate-500">Según movimientos</p>
          </div>
          <div className="rounded-lg bg-white p-3 shadow">
            <p className="text-lg font-bold text-sofia-700">{reconciliacion.cantidadActual}</p>
            <p className="text-xs text-slate-500">Cantidad actual</p>
          </div>
          <div className="rounded-lg bg-white p-3 shadow">
            <p className={`text-lg font-bold ${reconciliacion.cuadra ? 'text-green-700' : 'text-red-700'}`}>
              {reconciliacion.cuadra ? '✓ Cuadra' : '✗ No cuadra'}
            </p>
            <p className="text-xs text-slate-500">Reconciliación</p>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                <th className="p-2">Fecha</th>
                <th className="p-2">Tipo</th>
                <th className="p-2 text-right">Δ Cantidad</th>
                <th className="p-2 text-right">Δ Bloqueada</th>
                <th className="p-2">Documento</th>
                <th className="p-2">Usuario</th>
                <th className="p-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{new Date(m.createdAt).toLocaleString('es-CO')}</td>
                  <td className="p-2">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                  <td className={`p-2 text-right font-mono ${Number(m.cantidadDelta) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {m.cantidadDelta === null ? '—' : Number(m.cantidadDelta) > 0 ? `+${m.cantidadDelta}` : m.cantidadDelta}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {m.cantidadBloqueadaDelta === null ? '—' : Number(m.cantidadBloqueadaDelta) > 0 ? `+${m.cantidadBloqueadaDelta}` : m.cantidadBloqueadaDelta}
                  </td>
                  <td className="p-2 text-xs">{m.docTipo ?? '—'}</td>
                  <td className="p-2 text-xs">{m.usuarioUsername ?? '—'}</td>
                  <td className="p-2 text-xs">{m.motivo ?? ''}</td>
                </tr>
              ))}
              {movimientos.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-slate-400">Sin movimientos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
