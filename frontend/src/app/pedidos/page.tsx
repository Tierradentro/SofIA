'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';

interface Empresa { id: string; nombre: string; siglas: string }
interface Cliente { id: string; nombre: string; identificacion: string | null; ciudad: string | null }
interface Comercial { id: string; nombre: string }
interface Producto { id: string; codigo: string; descripcion: string; precio: string; cantidad: number; cantidadBloqueada: number }

interface OrderItem {
  id: string;
  productId: string;
  codigo: string;
  marca: string | null;
  descripcion: string;
  cantidad: number;
  cantidadAlistada: number;
  pendiente: number;
  valorUnidad: string;
  valorTotal: string;
}

interface Pedido {
  id: string;
  numero: string;
  ordenPedido: string | null;
  ciudad: string | null;
  clienteId: string;
  comercialId: string | null;
  notas: string | null;
  numeroFactura: string | null;
  estado: 'ABIERTO' | 'ALISTADO' | 'APROBADO' | 'PENDIENTE_CORRECCION' | 'CANCELADO';
  createdAt: string;
  createdBy: string;
  items: OrderItem[];
  valorTotal: number;
  cliente: { id: string; nombre: string; identificacion: string; ciudad: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const ESTADOS: Record<Pedido['estado'], string> = {
  ABIERTO: 'Abierto',
  ALISTADO: 'Alistado',
  APROBADO: 'Aprobado',
  PENDIENTE_CORRECCION: 'Pendiente corrección',
  CANCELADO: 'Cancelado',
};

/**
 * M08/EP-07: pedidos y alistamiento.
 * Creación (Generador/Operador/Comercial): manual, OCR o Excel.
 * Alistamiento (Operador): escaneo modo INICIAL/COMPLETO (HU-030/031).
 * Corrección: creador en Pendiente_Corrección. Factura y cancelación: Generador.
 */
export default function PedidosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [comerciales, setComerciales] = useState<Comercial[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lista, setLista] = useState<Pedido[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [pedido, setPedido] = useState<Pedido | null>(null);

  // Creación
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [clienteId, setClienteId] = useState('');
  const [comercialId, setComercialId] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [notas, setNotas] = useState('');
  const [itemsNuevos, setItemsNuevos] = useState<{ referencia: string; cantidad: string; valorUnidad: string }[]>([
    { referencia: '', cantidad: '1', valorUnidad: '' },
  ]);
  const [archivoOrden, setArchivoOrden] = useState<File | null>(null);
  const [archivoExcel, setArchivoExcel] = useState<File | null>(null);

  // Alistamiento
  const [modo, setModo] = useState<'COMPLETO' | 'INICIAL'>('COMPLETO');
  const [productoSel, setProductoSel] = useState('');
  const [codigoScan, setCodigoScan] = useState('');

  // Factura / corrección
  const [archivoFactura, setArchivoFactura] = useState<File | null>(null);
  const [editando, setEditando] = useState(false);

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const rol = sesion?.usuario.rol;
  const esGenerador = rol === 'GENERADOR' || rol === 'ADMINISTRADOR';
  const esOperador = rol === 'OPERADOR' || rol === 'ADMINISTRADOR';
  const puedeCrear = esGenerador || esOperador || rol === 'COMERCIAL';

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setEmpresas(body);
        setEmpresaId(body[0].id);
      }
    });
    api<Cliente[]>('/clients').then(({ status, body }) => {
      if (status === 200) {
        setClientes(body);
        if (body.length) setClienteId(body[0].id);
      }
    });
    api<Comercial[]>('/comerciales').then(({ status, body }) => {
      if (status === 200) {
        setComerciales(body);
        if (body.length) setComercialId(body[0].id);
      }
    });
  }, [router]);

  useEffect(() => {
    if (empresaId) {
      cargarLista();
      api<Producto[]>(`/products?empresaId=${empresaId}`).then(({ status, body }) => {
        if (status === 200) setProductos(body);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, filtroEstado]);

  async function cargarLista() {
    const q = filtroEstado ? `&estado=${filtroEstado}` : '';
    const { status, body } = await api<Pedido[]>(`/orders?empresaId=${empresaId}${q}`);
    if (status === 200) setLista(body);
  }

  async function abrir(id: string) {
    const { status, body } = await api<Pedido>(`/orders/${id}`);
    if (status === 200) {
      setPedido(body);
      setEditando(false);
      setMensaje('');
      setError('');
      if (body.estado === 'PENDIENTE_CORRECCION') prepararEdicion(body);
    }
  }

  function prepararEdicion(p: Pedido) {
    setItemsNuevos(
      p.items.map((i) => ({
        referencia: i.codigo,
        cantidad: String(i.cantidad),
        valorUnidad: String(Number(i.valorUnidad)),
      })),
    );
    setEditando(true);
  }

  async function uploadOcr(tipo: string, file: File): Promise<string> {
    const fd = new FormData();
    fd.append('tipoDocumento', tipo);
    fd.append('empresaId', empresaId);
    fd.append('file', file);
    const s = obtenerSesion();
    const res = await fetch(`${API_BASE}/ocr/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s?.token}` },
      body: fd,
    });
    const body = await res.json();
    if (res.status !== 201) throw new Error(body.message ?? 'Falló el OCR');
    return body.id;
  }

  /** HU-028: crear pedido (manual con ítems, orden OCR o Excel). */
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError('');
    try {
      if (archivoExcel) {
        const fd = new FormData();
        fd.append('empresaId', empresaId);
        fd.append('clienteId', clienteId);
        if (rol !== 'COMERCIAL') fd.append('comercialId', comercialId);
        fd.append('file', archivoExcel);
        const s = obtenerSesion();
        const res = await fetch(`${API_BASE}/orders/excel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s?.token}` },
          body: fd,
        });
        const body = await res.json();
        if (res.status !== 201) throw new Error(body.message ?? 'Error al crear desde Excel');
        setMensaje(`Pedido ${body.numero} creado desde Excel.`);
        setMostrarCrear(false);
        cargarLista();
        abrir(body.id);
        return;
      }
      const payload: Record<string, unknown> = {
        empresaId,
        clienteId,
        ciudad: ciudad || undefined,
        notas: notas || undefined,
      };
      if (rol !== 'COMERCIAL') payload.comercialId = comercialId;
      if (archivoOrden) {
        payload.ocrDocumentId = await uploadOcr('ORDEN_PEDIDO', archivoOrden);
      } else {
        const items = itemsNuevos
          .filter((i) => i.referencia.trim())
          .map((i) => ({
            referencia: i.referencia.trim(),
            cantidad: Number(i.cantidad) || 0,
            valorUnidad: i.valorUnidad ? Number(i.valorUnidad) : undefined,
          }));
        if (!items.length) throw new Error('Agregue al menos un producto');
        payload.items = items;
      }
      const { status, body } = await api<Pedido>('/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (status !== 201) throw new Error((body as { message?: string }).message ?? 'Error al crear');
      setMensaje(`Pedido ${(body as Pedido).numero} creado en estado Abierto.`);
      setMostrarCrear(false);
      setArchivoOrden(null);
      setArchivoExcel(null);
      setItemsNuevos([{ referencia: '', cantidad: '1', valorUnidad: '' }]);
      cargarLista();
      abrir((body as Pedido).id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function accion(fn: () => Promise<{ status: number; body: any }>, ok: string) {
    setCargando(true);
    setError('');
    const { status, body } = await fn();
    setCargando(false);
    if (status === 200 || status === 201) {
      setMensaje(ok);
      if (pedido) abrir(pedido.id);
      cargarLista();
      return true;
    }
    setError(mensajeError(body, 'La acción falló'));
    return false;
  }

  /** HU-030/031: escaneo de alistamiento. */
  async function escanear() {
    if (!pedido || !codigoScan.trim()) return;
    const payload: Record<string, unknown> = { modo, codigo: codigoScan.trim() };
    if (modo === 'INICIAL') payload.productId = productoSel;
    const exito = await accion(
      () => api(`/orders/${pedido.id}/scan`, { method: 'POST', body: JSON.stringify(payload) }),
      'Lectura registrada.',
    );
    if (exito) setCodigoScan('');
  }

  /** HU-032: cargar factura de venta por OCR y aprobar. */
  async function cargarFactura() {
    if (!pedido || !archivoFactura) return;
    setCargando(true);
    setError('');
    try {
      const ocrId = await uploadOcr('FACTURA_VENTA', archivoFactura);
      const { status, body } = await api(`/orders/${pedido.id}/invoice`, {
        method: 'POST',
        body: JSON.stringify({ ocrDocumentId: ocrId }),
      });
      if (status === 201) {
        setMensaje('Factura validada: pedido Aprobado, listo para despacho.');
        setArchivoFactura(null);
        abrir(pedido.id);
        cargarLista();
      } else if (body.code === 'FACTURA_CON_DIFERENCIAS') {
        const detalle = body.diferencias
          .map((d: any) => `${d.codigo}: pedida ${d.cantidadPedida}, facturada ${d.cantidadFacturada} (${d.tipo})`)
          .join(' · ');
        setError(`La factura tiene diferencias y no se puede aprobar: ${detalle}`);
      } else {
        setError(mensajeError(body, 'Error al cargar la factura'));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function guardarCorreccion() {
    if (!pedido) return;
    const items = itemsNuevos
      .filter((i) => i.referencia.trim())
      .map((i) => ({
        referencia: i.referencia.trim(),
        cantidad: Number(i.cantidad) || 0,
        valorUnidad: i.valorUnidad ? Number(i.valorUnidad) : undefined,
      }));
    if (!items.length) {
      setError('El pedido debe tener al menos un producto');
      return;
    }
    const exito = await accion(
      () => api(`/orders/${pedido.id}`, { method: 'PATCH', body: JSON.stringify({ items }) }),
      'Pedido corregido: vuelve a estado Abierto.',
    );
    if (exito) setEditando(false);
  }

  const productosConPendiente = useMemo(
    () => pedido?.items.filter((i) => i.pendiente > 0) ?? [],
    [pedido],
  );

  if (!sesion) return null;

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-sofia-900">Pedidos y alistamiento</h1>
          <button onClick={() => router.push('/dashboard')} className="rounded bg-white px-3 py-1 text-sm shadow hover:bg-slate-50">
            ← Volver
          </button>
        </div>

        {mensaje && <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>}

        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">Pedidos</h2>
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border px-2 py-1 text-sm">
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.siglas} — {e.nombre}</option>
                ))}
              </select>
              <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded border px-2 py-1 text-sm">
                <option value="">Todos los estados</option>
                {Object.entries(ESTADOS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {puedeCrear && (
              <button onClick={() => setMostrarCrear(!mostrarCrear)} className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700">
                {mostrarCrear ? 'Cancelar' : '+ Nuevo pedido'}
              </button>
            )}
          </div>

          {mostrarCrear && (
            <form onSubmit={crear} className="mb-4 rounded bg-slate-50 p-4">
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                <label className="text-sm">
                  Cliente
                  <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1.5">
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </label>
                {rol !== 'COMERCIAL' && (
                  <label className="text-sm">
                    Comercial
                    <select value={comercialId} onChange={(e) => setComercialId(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1.5">
                      {comerciales.map((c) => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="text-sm">
                  Ciudad
                  <input type="text" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1.5" />
                </label>
                <label className="text-sm">
                  Notas (descuentos)
                  <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1.5" />
                </label>
              </div>

              <div className="mb-3 flex flex-wrap items-end gap-4 rounded border border-dashed p-3">
                <label className="text-sm">
                  Orden de pedido (PDF/imagen → OCR)
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff" onChange={(e) => { setArchivoOrden(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setArchivoExcel(null); }} className="mt-1 block text-sm" />
                </label>
                <label className="text-sm">
                  …o archivo Excel (Referencia/Cantidad)
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setArchivoExcel(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setArchivoOrden(null); }} className="mt-1 block text-sm" />
                </label>
              </div>

              {!archivoOrden && !archivoExcel && (
                <>
                  {itemsNuevos.map((it, idx) => (
                    <div key={idx} className="mb-1 flex gap-2">
                      <input
                        type="text"
                        placeholder="Código / OE / ref. cruzada"
                        value={it.referencia}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItemsNuevos(itemsNuevos.map((x, i) => {
                            if (i !== idx) return x;
                            const prod = productos.find((p) => p.codigo.toUpperCase() === v.trim().toUpperCase());
                            return { ...x, referencia: v, valorUnidad: x.valorUnidad || (prod ? String(Number(prod.precio)) : '') };
                          }));
                        }}
                        className="w-48 rounded border px-2 py-1 text-sm"
                      />
                      <input type="number" min={1} value={it.cantidad} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, cantidad: e.target.value } : x)))} className="w-24 rounded border px-2 py-1 text-sm" />
                      <input type="number" min={0} step="0.01" placeholder="Valor unidad" value={it.valorUnidad} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, valorUnidad: e.target.value } : x)))} className="w-32 rounded border px-2 py-1 text-sm" />
                      <button type="button" onClick={() => setItemsNuevos(itemsNuevos.filter((_, i) => i !== idx))} className="text-red-700 hover:underline">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setItemsNuevos([...itemsNuevos, { referencia: '', cantidad: '1', valorUnidad: '' }])} className="mb-2 text-sm text-sofia-700 hover:underline">
                    + Agregar producto
                  </button>
                </>
              )}
              <div>
                <button type="submit" disabled={cargando} className="rounded bg-sofia-600 px-4 py-2 text-sm text-white hover:bg-sofia-700 disabled:opacity-50">
                  {cargando ? 'Procesando…' : 'Crear pedido'}
                </button>
              </div>
            </form>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Número</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Factura</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-1 font-medium">{p.numero}</td>
                  <td>{p.cliente?.nombre ?? '—'}</td>
                  <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td>{p.numeroFactura ?? '—'}</td>
                  <td>
                    <span className={
                      p.estado === 'APROBADO' ? 'text-green-700'
                      : p.estado === 'CANCELADO' ? 'text-slate-500'
                      : p.estado === 'PENDIENTE_CORRECCION' ? 'font-semibold text-red-700'
                      : 'text-amber-700'
                    }>
                      {ESTADOS[p.estado]}
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => abrir(p.id)} className="text-sofia-700 hover:underline">Abrir</button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={6} className="py-2 text-slate-500">Sin pedidos.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {pedido && (
          <section className="rounded-lg bg-white p-5 shadow">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                Pedido {pedido.numero} ·{' '}
                <span className={pedido.estado === 'PENDIENTE_CORRECCION' ? 'text-red-700' : ''}>
                  {ESTADOS[pedido.estado]}
                </span>
              </h2>
              <p className="text-sm text-slate-600">
                {pedido.cliente?.nombre} · Total ${pedido.valorTotal.toLocaleString()}
                {pedido.numeroFactura && ` · Factura ${pedido.numeroFactura}`}
              </p>
            </div>

            {pedido.estado === 'PENDIENTE_CORRECCION' && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                El Operador reportó productos no encontrados o cantidades inferiores. El creador
                del pedido debe corregirlo (agregar/eliminar productos); volverá a estado Abierto.
              </p>
            )}

            {/* HU-029/030: panel del Operador */}
            {esOperador && pedido.estado === 'ABIERTO' && !editando && (
              <div className="mb-4 rounded bg-slate-50 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">Alistamiento (escaneo):</span>
                  <label className="text-sm">
                    <input type="radio" checked={modo === 'COMPLETO'} onChange={() => setModo('COMPLETO')} className="mr-1" />
                    Modo Completo (escanear directo)
                  </label>
                  <label className="text-sm">
                    <input type="radio" checked={modo === 'INICIAL'} onChange={() => setModo('INICIAL')} className="mr-1" />
                    Modo Inicial (seleccionar producto)
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {modo === 'INICIAL' && (
                    <select value={productoSel} onChange={(e) => setProductoSel(e.target.value)} className="rounded border px-2 py-1.5 text-sm">
                      <option value="">— Seleccione producto —</option>
                      {productosConPendiente.map((i) => (
                        <option key={i.productId} value={i.productId}>
                          {i.codigo} · {i.descripcion} (pendiente {i.pendiente})
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="text"
                    value={codigoScan}
                    onChange={(e) => setCodigoScan(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && escanear()}
                    placeholder="Escanee o digite el código"
                    autoFocus
                    className="w-64 rounded border px-2 py-1.5 text-sm"
                  />
                  <button onClick={escanear} disabled={cargando || !codigoScan.trim() || (modo === 'INICIAL' && !productoSel)} className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700 disabled:opacity-50">
                    Registrar lectura
                  </button>
                  <button onClick={() => accion(() => api(`/orders/${pedido.id}/finalizar-picking`, { method: 'POST' }), 'Pedido alistado.')} disabled={cargando} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                    Finalizar alistamiento
                  </button>
                  <button onClick={() => accion(() => api(`/orders/${pedido.id}/reportar`, { method: 'POST' }), 'Pedido reportado: Pendiente de corrección.')} disabled={cargando} className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50">
                    Reportar novedad
                  </button>
                </div>
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">Código</th>
                  <th>Descripción</th>
                  <th>Marca</th>
                  <th className="w-20">Pedida</th>
                  <th className="w-20">Alistada</th>
                  <th className="w-20">Pendiente</th>
                  <th className="w-24">V. Unidad</th>
                  <th className="w-24">V. Total</th>
                </tr>
              </thead>
              <tbody>
                {pedido.items.map((i) => (
                  <tr key={i.id} className="border-b">
                    <td className="py-1 font-medium">{i.codigo}</td>
                    <td>{i.descripcion}</td>
                    <td>{i.marca ?? '—'}</td>
                    <td>{i.cantidad}</td>
                    <td className={i.cantidadAlistada === i.cantidad ? 'text-green-700' : ''}>{i.cantidadAlistada}</td>
                    <td className={i.pendiente > 0 ? 'font-semibold text-amber-700' : ''}>{i.pendiente}</td>
                    <td>${Number(i.valorUnidad).toLocaleString()}</td>
                    <td>${Number(i.valorTotal).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Corrección del creador */}
            {pedido.estado === 'PENDIENTE_CORRECCION' && (pedido.createdBy === sesion.usuario.id || esGenerador) && (
              <div className="mt-4 rounded bg-slate-50 p-3">
                {!editando ? (
                  <button onClick={() => prepararEdicion(pedido)} className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700">
                    Corregir pedido
                  </button>
                ) : (
                  <>
                    <p className="mb-2 text-sm font-medium">Edite las líneas (agregue o elimine productos):</p>
                    {itemsNuevos.map((it, idx) => (
                      <div key={idx} className="mb-1 flex gap-2">
                        <input type="text" value={it.referencia} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, referencia: e.target.value } : x)))} className="w-48 rounded border px-2 py-1 text-sm" />
                        <input type="number" min={1} value={it.cantidad} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, cantidad: e.target.value } : x)))} className="w-24 rounded border px-2 py-1 text-sm" />
                        <input type="number" min={0} step="0.01" value={it.valorUnidad} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, valorUnidad: e.target.value } : x)))} className="w-32 rounded border px-2 py-1 text-sm" />
                        <button onClick={() => setItemsNuevos(itemsNuevos.filter((_, i) => i !== idx))} className="text-red-700 hover:underline">✕</button>
                      </div>
                    ))}
                    <button onClick={() => setItemsNuevos([...itemsNuevos, { referencia: '', cantidad: '1', valorUnidad: '' }])} className="mb-2 text-sm text-sofia-700 hover:underline">
                      + Agregar producto
                    </button>
                    <div className="flex gap-3">
                      <button onClick={guardarCorreccion} disabled={cargando} className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50">
                        Guardar corrección
                      </button>
                      <button onClick={() => setEditando(false)} className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50">
                        Cancelar
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* HU-032: factura de venta (Generador) */}
            {esGenerador && pedido.estado === 'ALISTADO' && (
              <div className="mt-4 rounded bg-slate-50 p-3">
                <p className="mb-2 text-sm font-medium">Cargar factura de venta para aprobar</p>
                <div className="flex flex-wrap items-center gap-3">
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff" onChange={(e) => setArchivoFactura(e.target.files?.[0] ?? null)} className="text-sm" />
                  <button onClick={cargarFactura} disabled={cargando || !archivoFactura} className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50">
                    Validar factura y aprobar
                  </button>
                </div>
              </div>
            )}

            {esGenerador && !['CANCELADO', 'APROBADO'].includes(pedido.estado) && (
              <button
                onClick={() => {
                  const motivo = window.prompt('Motivo de la cancelación (opcional):') ?? undefined;
                  accion(() => api(`/orders/${pedido.id}/cancel`, { method: 'POST', body: JSON.stringify({ motivo }) }), 'Pedido cancelado: bloqueos liberados.');
                }}
                disabled={cargando}
                className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Cancelar pedido
              </button>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
