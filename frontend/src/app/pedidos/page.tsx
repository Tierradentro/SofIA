'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { useAvisoEstadosPedidos } from '@/lib/sonido';
import { AppShell } from '@/components/app-shell';
import { SelectorEmpresa } from '@/components/selector-empresa';
import { COLORES_PESTANA, EncabezadoPagina } from '@/components/ui';


interface Empresa { id: string; nombre: string; siglas: string }

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

/** I19: usuario que ejecutó cada hito (nombre visible, no UUID). */
interface UsuarioTraz {
  id: string;
  nombre: string;
  username: string;
}

interface Pedido {
  id: string;
  empresaId?: string;
  numero: string;
  ordenPedido: string | null;
  ciudad: string | null;
  clienteId: string;
  comercialId: string | null;
  notas: string | null;
  numeroFactura: string | null;
  estado: 'ABIERTO' | 'ALISTADO' | 'APROBADO' | 'PENDIENTE_CORRECCION' | 'CANCELADO' | 'DESPACHADO';
  createdAt: string;
  createdBy: string;
  items: OrderItem[];
  valorTotal: number;
  cliente: { id: string; nombre: string; identificacion: string; ciudad: string } | null;
  alistadoAt?: string | null;
  aprobadoAt?: string | null;
  trazabilidad?: {
    creadoPor: UsuarioTraz | null;
    alistadoPor: UsuarioTraz | null;
    aprobadoPor: UsuarioTraz | null;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const ESTADOS: Record<Pedido['estado'], string> = {
  ABIERTO: 'Abierto',
  ALISTADO: 'Alistado',
  APROBADO: 'Aprobado',
  PENDIENTE_CORRECCION: 'Pendiente corrección',
  CANCELADO: 'Cancelado',
  DESPACHADO: 'Despachado',
};

/**
 * M08/EP-07: pedidos y alistamiento.
 * Creación (Generador/Operador/Comercial): manual, OCR o Excel.
 * Alistamiento (Operador): escaneo modo INICIAL/COMPLETO (HU-030/031).
 * Corrección: creador en Pendiente_Corrección. Factura y cancelación: Generador.
 */
function PedidosContenido() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [lista, setLista] = useState<Pedido[]>([]);
  // QA Func. 3.1: pestañas principales (ciclo activo) + "Otros estados" secundario
  const [pestana, setPestana] = useState<'ABIERTO' | 'ALISTADO' | 'APROBADO' | 'DESPACHADO' | 'OTROS'>('ABIERTO');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  // I21/I22: sondeo de TODOS los estados de la empresa — alimenta el aviso
  // sonoro y los contadores de cada pestaña
  const [avisoPedidos, setAvisoPedidos] = useState<{ id: string; estado: string }[]>([]);

  const [itemsNuevos, setItemsNuevos] = useState<{ referencia: string; cantidad: string; valorUnidad: string }[]>([
    { referencia: '', cantidad: '1', valorUnidad: '' },
  ]);
  // I26: la corrección escoge productos de la lista de códigos (con existencias)
  const [productosEdit, setProductosEdit] = useState<
    { id: string; codigo: string; descripcion: string; marca: string | null; precio: string | number; cantidad: number }[]
  >([]);

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

  const searchParams = useSearchParams();

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    const abrirId = searchParams.get('abrir');
    if (abrirId) abrir(abrirId);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setEmpresas(body);
        setEmpresaId(body[0].id);
      }
    });
  }, [router]);

  useEffect(() => {
    if (empresaId) {
      cargarLista();
      const sondear = () =>
        api<{ id: string; estado: string }[]>(`/orders?empresaId=${empresaId}`).then(
          ({ status, body }) => {
            if (status === 200) setAvisoPedidos(body);
          },
        );
      sondear();
      const sondeo = setInterval(sondear, 20000);
      return () => clearInterval(sondeo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, pestana, filtroEstado]);

  // I21: aviso sonoro al cambiar el estado de un pedido (excepto CANCELADO)
  useAvisoEstadosPedidos(avisoPedidos);

  async function cargarLista() {
    let estado = '';
    if (pestana !== 'OTROS') estado = pestana;
    else if (filtroEstado) estado = filtroEstado;
    const q = estado ? `&estado=${estado}` : '';
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
    // I26: lista de códigos con existencias para escoger (como al crear).
    // Se usa la empresa del propio pedido: al abrir por ?abrir= el estado
    // empresaId del selector aún puede estar vacío.
    const emp = p.empresaId ?? empresaId;
    if (emp) {
      api<any[]>(`/products?empresaId=${emp}&conStock=true`).then(({ status, body }) => {
        if (status === 200) setProductosEdit(body);
      });
    }
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
    if (res.status !== 201) throw new Error(mensajeError(body, 'Falló el OCR'));
    return body.id;
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
    // I26: las referencias se escogen de la lista de códigos con existencias
    // (se toleran los códigos que ya tenía el pedido aunque hoy no tengan stock)
    const codigosOriginales = new Set(pedido.items.map((i) => i.codigo.toUpperCase()));
    const codigosValidos = new Set(productosEdit.map((p) => p.codigo.toUpperCase()));
    const invalida = items.find(
      (i) =>
        !codigosValidos.has(i.referencia.toUpperCase()) &&
        !codigosOriginales.has(i.referencia.toUpperCase()),
    );
    if (invalida) {
      setError(
        `La referencia ${invalida.referencia} no está en la lista de productos con existencias; escógala de la lista`,
      );
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
  // I26: total de unidades pendientes, visible en grande durante el alistamiento
  const totalPendientes = useMemo(
    () => pedido?.items.reduce((acc, i) => acc + i.pendiente, 0) ?? 0,
    [pedido],
  );

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Pedidos y alistamiento" />
      <div className="mx-auto max-w-6xl">

        {mensaje && <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>}

        {/* I21: empresa como tarjetas-botón (mismo patrón de Productos) */}
        <SelectorEmpresa empresas={empresas} empresaId={empresaId} onCambiar={setEmpresaId} />

        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">Pedidos</h2>
              {/* QA Func. 3.1: secciones por estado (ciclo activo) + "Otros".
                  I21/I22: color y contador por estado, como la cola del dashboard */}
              <div className="flex flex-wrap rounded border text-sm">
                {(['ABIERTO', 'ALISTADO', 'APROBADO', 'DESPACHADO'] as const).map((v) => {
                  const activa = pestana === v;
                  const color = COLORES_PESTANA[v];
                  const n = avisoPedidos.filter((p) => p.estado === v).length;
                  return (
                    <button
                      key={v}
                      onClick={() => setPestana(v)}
                      className={`flex items-center gap-1.5 border-l-2 px-3 py-1 ${
                        activa ? `${color.activa} font-semibold` : 'border-transparent bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${color.punto}`} />
                      {ESTADOS[v]}s <span className="text-xs text-slate-400">({n})</span>
                    </button>
                  );
                })}
                {(() => {
                  const color = COLORES_PESTANA[filtroEstado || 'PENDIENTE_CORRECCION'] ?? COLORES_PESTANA.OTROS;
                  const activa = pestana === 'OTROS';
                  const nOtros = avisoPedidos.filter((p) =>
                    ['PENDIENTE_CORRECCION', 'CANCELADO'].includes(p.estado),
                  ).length;
                  return (
                    <button
                      onClick={() => {
                        setPestana('OTROS');
                        // Al entrar a "Otros" siempre hay un estado concreto
                        // preseleccionado: nunca muestra todos los pedidos
                        if (!filtroEstado) setFiltroEstado('PENDIENTE_CORRECCION');
                      }}
                      className={`flex items-center gap-1.5 border-l-2 px-3 py-1 ${
                        activa ? `${color.activa} font-semibold` : 'border-transparent bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${(activa ? color : COLORES_PESTANA.OTROS).punto}`} />
                      Otros estados <span className="text-xs text-slate-400">({nOtros})</span>
                    </button>
                  );
                })()}
              </div>
              {pestana === 'OTROS' && (
                <select value={filtroEstado || 'PENDIENTE_CORRECCION'} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded border px-2 py-1 text-sm">
                  <option value="PENDIENTE_CORRECCION">Pendiente corrección</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              )}
            </div>
            {puedeCrear && (
              <button onClick={() => router.push('/pedidos/nuevo')} className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700">
                + Nuevo pedido
              </button>
            )}
          </div>


          <div className="overflow-x-auto">
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
          </div>
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
              {/* I19: quién realizó cada actividad hasta la aprobación */}
              {pedido.trazabilidad && (
                <p className="mt-1 text-xs text-slate-500">
                  {pedido.trazabilidad.creadoPor &&
                    `Creado por ${pedido.trazabilidad.creadoPor.nombre} (${pedido.trazabilidad.creadoPor.username}) · ${new Date(pedido.createdAt).toLocaleString('es-CO')}`}
                  {pedido.trazabilidad.alistadoPor &&
                    ` · Alistado por ${pedido.trazabilidad.alistadoPor.nombre} (${pedido.trazabilidad.alistadoPor.username})${pedido.alistadoAt ? ` · ${new Date(pedido.alistadoAt).toLocaleString('es-CO')}` : ''}`}
                  {pedido.trazabilidad.aprobadoPor &&
                    ` · Aprobado por ${pedido.trazabilidad.aprobadoPor.nombre} (${pedido.trazabilidad.aprobadoPor.username})${pedido.aprobadoAt ? ` · ${new Date(pedido.aprobadoAt).toLocaleString('es-CO')}` : ''}`}
                </p>
              )}
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
                {/* I26: pendientes en tamaño grande para lectura rápida en piso */}
                <div className="mb-3 flex items-center gap-4 rounded-lg border-2 border-sofia-200 bg-white px-5 py-3">
                  <span className="text-5xl font-extrabold leading-none text-sofia-900">
                    {totalPendientes}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-sofia-800">
                      unidades pendientes de alistamiento
                    </p>
                    <p className="text-xs text-slate-500">
                      {productosConPendiente.length} referencia(s) por completar
                    </p>
                  </div>
                </div>
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

            <div className="overflow-x-auto">
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
                    <td className={i.pendiente > 0 ? 'text-lg font-bold text-amber-700' : ''}>{i.pendiente}</td>
                    <td>${Number(i.valorUnidad).toLocaleString()}</td>
                    <td>${Number(i.valorTotal).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Corrección del creador */}
            {pedido.estado === 'PENDIENTE_CORRECCION' && (pedido.createdBy === sesion.usuario.id || esGenerador) && (
              <div className="mt-4 rounded bg-slate-50 p-3">
                {!editando ? (
                  <button onClick={() => prepararEdicion(pedido)} className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700">
                    Corregir pedido
                  </button>
                ) : (
                  <>
                    <p className="mb-2 text-sm font-medium">
                      Edite las líneas: escoja el producto de la lista de códigos (solo con existencias), ajuste cantidades o elimine:
                    </p>
                    {itemsNuevos.map((it, idx) => {
                      const encontrado = productosEdit.find(
                        (p) => p.codigo.toLowerCase() === it.referencia.trim().toLowerCase(),
                      );
                      return (
                        <div key={idx} className="mb-1 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={it.referencia}
                            list="productos-ref-edit"
                            placeholder="Código / ref."
                            onChange={(e) => {
                              const valor = e.target.value;
                              setItemsNuevos(itemsNuevos.map((x, i) => {
                                if (i !== idx) return x;
                                const prod = productosEdit.find(
                                  (p) => p.codigo.toLowerCase() === valor.trim().toLowerCase(),
                                );
                                return {
                                  ...x,
                                  referencia: valor,
                                  valorUnidad: prod && !x.valorUnidad ? String(Number(prod.precio) || '') : x.valorUnidad,
                                };
                              }));
                            }}
                            className="w-48 rounded border px-2 py-1 text-sm"
                          />
                          {encontrado && (
                            <span className="max-w-64 truncate text-xs text-slate-500" title={encontrado.descripcion}>
                              {encontrado.descripcion} · disp. {encontrado.cantidad}
                            </span>
                          )}
                          <input type="number" min={1} value={it.cantidad} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, cantidad: e.target.value } : x)))} className="w-24 rounded border px-2 py-1 text-sm" title="Cantidad" />
                          <input type="number" min={0} step="0.01" value={it.valorUnidad} onChange={(e) => setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, valorUnidad: e.target.value } : x)))} className="w-32 rounded border px-2 py-1 text-sm" title="Valor unitario" />
                          <button onClick={() => setItemsNuevos(itemsNuevos.filter((_, i) => i !== idx))} className="text-red-700 hover:underline">✕</button>
                        </div>
                      );
                    })}
                    {/* I26: misma lista de códigos de la creación, solo con existencias */}
                    <datalist id="productos-ref-edit">
                      {productosEdit.map((p) => (
                        <option key={p.id} value={p.codigo}>
                          {p.descripcion} — disp. {p.cantidad}
                        </option>
                      ))}
                    </datalist>
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
        </AppShell>
  );
}

/**
 * Next.js 14: useSearchParams() exige un boundary de Suspense para el
 * prerendering estático; sin él `next build` falla.
 */
export default function PedidosPage() {
  return (
    <Suspense>
      <PedidosContenido />
    </Suspense>
  );
}
