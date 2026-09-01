'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Package, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, EncabezadoPagina, Insignia } from '@/components/ui';

interface PedidoAprobado {
  id: string;
  numero: string;
  clienteId: string;
  createdAt: string;
  cliente?: { id: string; nombre: string } | null;
}
interface Carrier { id: string; nombre: string; tipo: 'EXTERNA' | 'INTERNA' }

interface Pendiente {
  orderItemId: string;
  numeroPedido: string;
  codigo: string;
  descripcion: string;
  cantidadAlistada: number;
  cantidadDespachada: number;
  enCajasAbiertas: number;
  pendiente: number;
}

/** I19: usuario que ejecutó cada hito (nombre visible, no UUID). */
interface UsuarioTraz {
  id: string;
  nombre: string;
  username: string;
}

interface Caja {
  id: string;
  boxId: string;
  numeroEnDespacho: number;
  estado: 'ABIERTA' | 'CERRADA';
  items: { id: string; codigo: string; cantidad: number }[];
  creadoPorUsuario?: UsuarioTraz | null;
}

interface Despacho {
  id: string;
  numero: string;
  clienteId: string;
  estado: 'CREADO' | 'ABIERTO' | 'PENDIENTE_CORRECCION' | 'PARCIAL' | 'DESPACHADO' | 'CANCELADO';
  empaqueFinalizado: boolean;
  parcialMotivo: string | null;
  tipoTransporte: 'EXTERNA' | 'INTERNA' | null;
  nombreTransporte: string | null;
  guia: string | null;
  fechaSalida: string | null;
  despachoOrigenId: string | null;
  /** QA Func. 4.1: dirección de entrega (heredada del pedido, ajustable). */
  direccionDespacho?: string | null;
  /** QA Func. 4.3: empresas como etiqueta dentro del despacho (no filtro). */
  empresas?: string[];
  cliente?: { id: string; nombre: string } | null;
  pedidos: {
    id: string;
    numero: string;
    empresaPedido: string;
    /** I35: factura relacionada con el pedido. */
    numeroFactura?: string | null;
    items: { id: string; codigo: string; descripcion: string; cantidadAlistada: number; cantidadDespachada: number; pendienteDespachar: number }[];
  }[];
  cajas: Caja[];
  pendientes: Pendiente[];
  totalPedidos?: number;
  totalCajas?: number;
  /** I29: nombre del cliente en la tabla de despachos. */
  clienteNombre?: string | null;
  /** I35: facturas relacionadas con los pedidos del despacho (tabla). */
  facturas?: string[];
  despachadoAt?: string | null;
  trazabilidad?: {
    creadoPor: UsuarioTraz | null;
    aprobadoPor: UsuarioTraz | null;
    parcialAprobadoPor: UsuarioTraz | null;
    despachadoPor: UsuarioTraz | null;
  };
}

/** Minutos transcurridos en lenguaje natural (igual que en el Dashboard). */
function haceMinutos(fechaIso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(fechaIso).getTime()) / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  return `hace ${horas} h`;
}

const ESTADOS: Record<Despacho['estado'], string> = {
  CREADO: 'Creado',
  ABIERTO: 'Abierto',
  PENDIENTE_CORRECCION: 'Pendiente corrección',
  PARCIAL: 'Parcial',
  DESPACHADO: 'Despachado',
  CANCELADO: 'Cancelado',
};

/**
 * M09 + M10/EP-08: despachos y cajas.
 * Generador: crea, asocia pedidos, aprueba, aprueba parcial, transporte, cancela.
 * Operador: packing (cajas, escaneo, cierre, etiqueta QR, finalizar empaque).
 */
export default function DespachosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [lista, setLista] = useState<Despacho[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');
  // HU-054: filtros por empresa, fecha, documento, caja y guía
  // (QA Func. 4.3: label aclarado para que no se lea como atributo del despacho;
  // las empresas también se muestran como etiqueta en cada fila)
  const [filtroEmpresa, setFiltroEmpresa] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [filtroDocumento, setFiltroDocumento] = useState('');
  const [filtroBox, setFiltroBox] = useState('');
  const [filtroGuia, setFiltroGuia] = useState('');
  const [empresasFiltro, setEmpresasFiltro] = useState<{ id: string; nombre: string }[]>([]);
  const [despacho, setDespacho] = useState<Despacho | null>(null);

  // Creación / asociación
  const [pedidosAprobados, setPedidosAprobados] = useState<PedidoAprobado[]>([]);
  // I24: selección múltiple de pedidos del mismo cliente (tarjetas)
  const [pedidosSel, setPedidosSel] = useState<string[]>([]);
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [pedidoAsociar, setPedidoAsociar] = useState('');

  // Packing
  const [codigoScan, setCodigoScan] = useState('');
  const [cantidadScan, setCantidadScan] = useState('1');
  const [cajaSel, setCajaSel] = useState('');
  const [etiqueta, setEtiqueta] = useState<{
    boxId: string;
    barcodeDataUrl: string;
    despachoNumero: string;
    empresas?: string[];
  } | null>(null);

  // QA Func. 4.1: ajuste de dirección de entrega
  const [editandoDireccion, setEditandoDireccion] = useState(false);
  const [direccionEdit, setDireccionEdit] = useState('');

  // Transporte / parcial / cancelación
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [tipoTransporte, setTipoTransporte] = useState<'EXTERNA' | 'INTERNA'>('EXTERNA');
  const [carrierId, setCarrierId] = useState('');
  const [guia, setGuia] = useState('');
  const [nombreInterno, setNombreInterno] = useState('');
  const [motivoParcial, setMotivoParcial] = useState('');
  const [motivoDevolver, setMotivoDevolver] = useState('');
  const [motivoCancelar, setMotivoCancelar] = useState('');

  // M10: consulta de caja por QR
  const [boxIdConsulta, setBoxIdConsulta] = useState('');
  const [consultaCaja, setConsultaCaja] = useState<any>(null);

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const rol = sesion?.usuario.rol;
  const esGenerador = rol === 'GENERADOR' || rol === 'ADMINISTRADOR';
  const esOperador = rol === 'OPERADOR' || rol === 'ADMINISTRADOR';

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    cargarLista();
    cargarAprobados();
    api<Carrier[]>('/carriers/activas').then(({ status, body }) => {
      if (status === 200) setCarriers(body);
    });
    api<{ id: string; nombre: string }[]>('/companies').then(({ status, body }) => {
      if (status === 200) setEmpresasFiltro(body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limpiarAvisos() {
    setMensaje('');
    setError('');
  }

  async function cargarAprobados() {
    const { status, body } = await api<PedidoAprobado[]>('/orders?estado=APROBADO');
    if (status === 200) setPedidosAprobados(body);
  }

  /** I24: alterna la tarjeta; solo se pueden combinar pedidos del mismo cliente. */
  function alternarPedido(p: PedidoAprobado) {
    limpiarAvisos();
    setPedidosSel((sel) =>
      sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id],
    );
  }

  async function cargarLista() {
    const params = new URLSearchParams();
    if (filtroEstado) params.set('estado', filtroEstado);
    if (filtroEmpresa) params.set('empresaId', filtroEmpresa);
    if (filtroDesde) params.set('fechaDesde', filtroDesde);
    if (filtroHasta) params.set('fechaHasta', filtroHasta);
    if (filtroDocumento.trim()) params.set('documento', filtroDocumento.trim());
    if (filtroBox.trim()) params.set('boxId', filtroBox.trim());
    if (filtroGuia.trim()) params.set('guia', filtroGuia.trim());
    const q = params.toString() ? `?${params.toString()}` : '';
    const { status, body } = await api<Despacho[]>(`/dispatches${q}`);
    if (status === 200) setLista(body);
  }

  async function cargarDetalle(id: string) {
    const { status, body } = await api<Despacho>(`/dispatches/${id}`);
    if (status === 200) {
      setDespacho(body);
      const abierta = body.cajas.find((c) => c.estado === 'ABIERTA');
      setCajaSel(abierta?.id ?? '');
    }
  }

  async function crear() {
    limpiarAvisos();
    if (pedidosSel.length === 0) return setError('Seleccione al menos un pedido aprobado');
    const { status, body } = await api<any>('/dispatches', {
      method: 'POST',
      body: JSON.stringify({ orderIds: pedidosSel }),
    });
    if (status === 201) {
      setMensaje(
        pedidosSel.length > 1
          ? `Despacho ${body.numero} creado con ${pedidosSel.length} pedidos`
          : `Despacho ${body.numero} creado`,
      );
      setMostrarCrear(false);
      setPedidosSel([]);
      cargarLista();
      cargarAprobados();
      cargarDetalle(body.id);
    } else setError(mensajeError(body, 'No se pudo crear el despacho'));
  }

  async function asociar() {
    limpiarAvisos();
    if (!despacho || !pedidoAsociar) return;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/orders`, {
      method: 'POST',
      body: JSON.stringify({ orderIds: [pedidoAsociar] }),
    });
    if (status === 201) {
      setMensaje('Pedido asociado');
      setPedidoAsociar('');
      cargarDetalle(despacho.id);
    } else setError(mensajeError(body, 'No se pudo asociar'));
  }

  async function retirarPedido(orderId: string) {
    limpiarAvisos();
    if (!despacho) return;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/orders/${orderId}`, { method: 'DELETE' });
    if (status === 200) {
      setMensaje('Pedido retirado');
      cargarDetalle(despacho.id);
    } else setError(mensajeError(body, 'No se pudo retirar'));
  }

  async function accionSimple(path: string, textoOk: string, body: any = {}) {
    limpiarAvisos();
    if (!despacho) return;
    const { status, body: resp } = await api<any>(`/dispatches/${despacho.id}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (status === 201) {
      setMensaje(textoOk);
      cargarDetalle(despacho.id);
      cargarLista();
    } else setError(mensajeError(resp, 'Operación rechazada'));
  }

  /** QA Func. 4.1: ajustar la dirección de entrega del despacho. */
  async function guardarDireccion() {
    limpiarAvisos();
    if (!despacho || !direccionEdit.trim()) return;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/direccion`, {
      method: 'PATCH',
      body: JSON.stringify({ direccion: direccionEdit.trim() }),
    });
    if (status === 200) {
      setMensaje('Dirección de entrega actualizada');
      setEditandoDireccion(false);
      cargarDetalle(despacho.id);
    } else setError(mensajeError(body, 'No se pudo ajustar la dirección'));
  }

  async function crearCaja() {
    limpiarAvisos();
    if (!despacho) return;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/boxes`, { method: 'POST' });
    if (status === 201) {
      setMensaje(`Caja ${body.boxId} creada (Caja ${body.numeroEnDespacho})`);
      cargarDetalle(despacho.id);
      setCajaSel(body.id);
    } else setError(mensajeError(body, 'No se pudo crear la caja'));
  }

  async function escanear() {
    limpiarAvisos();
    if (!despacho || !cajaSel || !codigoScan.trim()) return;
    const cantidad = parseInt(cantidadScan, 10) || 1;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/boxes/${cajaSel}/scan`, {
      method: 'POST',
      body: JSON.stringify({ codigo: codigoScan.trim(), cantidad }),
    });
    if (status === 201) {
      setMensaje(`${body.item.codigo}: +${cantidad} en ${body.box} (pendiente por empacar: ${body.pendienteRestante})`);
      setCodigoScan('');
      setCantidadScan('1');
      cargarDetalle(despacho.id);
    } else setError(mensajeError(body, 'Código rechazado'));
  }

  async function cerrarCaja(boxPk: string) {
    limpiarAvisos();
    if (!despacho) return;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/boxes/${boxPk}/cerrar`, { method: 'POST' });
    if (status === 201) {
      setMensaje(`Caja ${body.boxId} cerrada: existencias descontadas`);
      setEtiqueta(body);
      cargarDetalle(despacho.id);
    } else setError(mensajeError(body, 'No se pudo cerrar la caja'));
  }

  async function verEtiqueta(boxPk: string) {
    limpiarAvisos();
    if (!despacho) return;
    const { status, body } = await api<any>(`/dispatches/${despacho.id}/boxes/${boxPk}/etiqueta`);
    if (status === 200) setEtiqueta(body);
    else setError(mensajeError(body, 'No se pudo generar la etiqueta'));
  }

  /** I25/I27: envía la etiqueta al diálogo de impresión (POS) en formato
   * 50×30. Se pide el HTML por fetch autenticado (POST, el barras viaja en
   * el cuerpo) y se abre como blob: window.open a la URL directa no puede
   * enviar el token y recibía 401. */
  async function imprimirEtiqueta() {
    if (!etiqueta) return;
    limpiarAvisos();
    const { status, body } = await api<string>('/documents/label', {
      method: 'POST',
      body: JSON.stringify({
        boxCode: etiqueta.boxId,
        barcode: etiqueta.barcodeDataUrl,
        despacho: etiqueta.despachoNumero,
        empresas: etiqueta.empresas?.join(' + ') ?? '',
      }),
    });
    if ((status === 200 || status === 201) && typeof body === 'string') {
      const url = URL.createObjectURL(new Blob([body], { type: 'text/html;charset=utf-8' }));
      const ventana = window.open(url, '_blank');
      if (!ventana) {
        URL.revokeObjectURL(url);
        setError('El navegador bloqueó la ventana de impresión; permite las ventanas emergentes para este sitio.');
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } else setError(mensajeError(body, 'No se pudo generar la etiqueta para impresión'));
  }

  async function consultarCaja() {
    limpiarAvisos();
    setConsultaCaja(null);
    if (!boxIdConsulta.trim()) return;
    const { status, body } = await api<any>(`/boxes/${encodeURIComponent(boxIdConsulta.trim())}`);
    if (status === 200) setConsultaCaja(body);
    else setError(mensajeError(body, 'Caja no encontrada'));
  }

  if (!sesion) return null;

  // ---------------------------------------------------------------
  // Detalle del despacho
  // ---------------------------------------------------------------
  if (despacho) {
    const enEdicion = despacho.estado === 'CREADO' || despacho.estado === 'PENDIENTE_CORRECCION';
    const cajasAbiertas = despacho.cajas.filter((c) => c.estado === 'ABIERTA');
    const externos = carriers.filter((c) => c.tipo === 'EXTERNA');
    return (
      <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo={`Despacho ${despacho.numero}`}
        acciones={
          <button
            onClick={() => { setDespacho(null); setEtiqueta(null); cargarLista(); }}
            className={CLASE_BOTON_SECUNDARIO}
          >
            ← Volver
          </button>
        }
      />
        <div className="mb-4">
          <p className="text-sm text-slate-600">
            {despacho.cliente?.nombre} · <span className="font-medium">{ESTADOS[despacho.estado]}</span>
              {despacho.despachoOrigenId && ' · Despacho adicional'}
            </p>
            {/* I19: quién realizó cada actividad del despacho */}
            {despacho.trazabilidad && (
              <p className="mt-1 text-xs text-slate-500">
                {despacho.trazabilidad.creadoPor &&
                  `Creado por ${despacho.trazabilidad.creadoPor.nombre} (${despacho.trazabilidad.creadoPor.username})`}
                {despacho.trazabilidad.aprobadoPor &&
                  ` · Aprobado por ${despacho.trazabilidad.aprobadoPor.nombre} (${despacho.trazabilidad.aprobadoPor.username})`}
                {despacho.trazabilidad.parcialAprobadoPor &&
                  ` · Parcial aprobado por ${despacho.trazabilidad.parcialAprobadoPor.nombre} (${despacho.trazabilidad.parcialAprobadoPor.username})`}
                {despacho.trazabilidad.despachadoPor &&
                  ` · Despachado por ${despacho.trazabilidad.despachadoPor.nombre} (${despacho.trazabilidad.despachadoPor.username})${despacho.despachadoAt ? ` · ${new Date(despacho.despachadoAt).toLocaleString('es-CO')}` : ''}`}
              </p>
            )}
            {/* QA Func. 4.1: dirección de entrega (se escoge en el Pedido, se ajusta aquí) */}
            {!editandoDireccion ? (
              <p className="mt-1 text-sm text-slate-500">
                Entrega: {despacho.direccionDespacho ?? 'sin dirección definida'}
                {esGenerador && ['CREADO', 'ABIERTO', 'PENDIENTE_CORRECCION', 'PARCIAL'].includes(despacho.estado) && (
                  <button
                    onClick={() => { setDireccionEdit(despacho.direccionDespacho ?? ''); setEditandoDireccion(true); }}
                    className="ml-2 text-sofia-700 hover:underline"
                  >
                    Ajustar
                  </button>
                )}
              </p>
            ) : (
              <div className="mt-1 flex gap-2 text-sm">
                <input
                  value={direccionEdit}
                  onChange={(e) => setDireccionEdit(e.target.value)}
                  maxLength={250}
                  placeholder="Dirección de entrega"
                  className="w-96 rounded border px-2 py-1"
                />
                <button onClick={guardarDireccion} className="rounded bg-sofia-600 px-3 py-1 text-white">Guardar</button>
                <button onClick={() => setEditandoDireccion(false)} className="text-slate-500">Cancelar</button>
              </div>
            )}
            {/* I35: información de la transportadora al consultar el despacho */}
            <p className="mt-1 text-sm text-slate-500">
              Transporte:{' '}
              {despacho.tipoTransporte
                ? despacho.tipoTransporte === 'EXTERNA'
                  ? `Transportadora externa — ${despacho.nombreTransporte ?? 'sin nombre'}${despacho.guia ? ` · Guía ${despacho.guia}` : ''}${despacho.fechaSalida ? ` · Salida ${new Date(despacho.fechaSalida).toLocaleString('es-CO')}` : ''}`
                  : `Transporte interno — ${despacho.nombreTransporte ?? 'sin nombre'}${despacho.fechaSalida ? ` · Salida ${new Date(despacho.fechaSalida).toLocaleString('es-CO')}` : ''}`
                : 'sin registrar'}
            </p>
        </div>

        {mensaje && <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-800">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

        {/* Pedidos asociados */}
        <section className="mb-4 rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold">Pedidos ({despacho.pedidos.length})</h2>
          {despacho.pedidos.map((p) => (
            <div key={p.id} className="mb-2 rounded border p-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">
                  {p.numero}
                  {p.numeroFactura && (
                    <span className="ml-2 font-normal text-slate-500">· Factura {p.numeroFactura}</span>
                  )}
                </span>
                {enEdicion && esGenerador && despacho.pedidos.length > 1 && (
                  <button onClick={() => retirarPedido(p.id)} className="text-red-600 hover:underline">Retirar</button>
                )}
              </div>
              <ul className="mt-1 text-slate-600">
                {p.items.map((i) => (
                  <li key={i.id}>
                    {i.codigo} — {i.descripcion}: alistado {i.cantidadAlistada}, despachado {i.cantidadDespachada}, pendiente {i.pendienteDespachar}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {enEdicion && esGenerador && (
            <div className="mt-2 flex gap-2">
              <select value={pedidoAsociar} onChange={(e) => setPedidoAsociar(e.target.value)} className="flex-1 rounded border px-2 py-1 text-sm">
                <option value="">Asociar pedido aprobado del mismo cliente…</option>
                {pedidosAprobados
                  .filter((p) => p.clienteId === despacho.clienteId && !despacho.pedidos.some((x) => x.id === p.id))
                  .map((p) => <option key={p.id} value={p.id}>{p.numero}</option>)}
              </select>
              <button onClick={asociar} className="rounded bg-sofia-600 px-3 py-1 text-sm text-white">Asociar</button>
            </div>
          )}
          {enEdicion && esGenerador && (
            <button onClick={() => accionSimple('/aprobar', 'Despacho aprobado: listo para empaque')} className="mt-3 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white">
              Aprobar despacho → Abierto
            </button>
          )}
        </section>

        {/* Packing (Operador, despacho ABIERTO) */}
        {despacho.estado === 'ABIERTO' && !despacho.empaqueFinalizado && esOperador && (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Empaque</h2>
            <button onClick={crearCaja} className="mb-3 rounded bg-sofia-600 px-3 py-1 text-sm text-white">Nueva caja</button>
            {despacho.cajas.length > 0 && (
              <div className="mb-3 flex gap-2">
                <select value={cajaSel} onChange={(e) => setCajaSel(e.target.value)} className="rounded border px-2 py-1 text-sm">
                  <option value="">Seleccione caja…</option>
                  {cajasAbiertas.map((c) => (
                    <option key={c.id} value={c.id}>Caja {c.numeroEnDespacho} ({c.boxId})</option>
                  ))}
                </select>
                <input
                  value={codigoScan}
                  onChange={(e) => setCodigoScan(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && escanear()}
                  placeholder="Escanear código…"
                  className="flex-1 rounded border px-2 py-1 text-sm"
                />
                <input value={cantidadScan} onChange={(e) => setCantidadScan(e.target.value)} className="w-16 rounded border px-2 py-1 text-sm" type="number" min={1} />
                <button onClick={escanear} className="rounded bg-sofia-600 px-3 py-1 text-sm text-white">Contar</button>
              </div>
            )}
            <ul className="space-y-1 text-sm">
              {despacho.cajas.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded border p-2">
                  <span>
                    Caja {c.numeroEnDespacho} <span className="text-slate-500">({c.boxId})</span> — {c.estado}
                    {c.creadoPorUsuario && (
                      <span className="ml-1 text-xs text-slate-400">· empacada por {c.creadoPorUsuario.nombre}</span>
                    )}
                    {c.items.length > 0 && (
                      <span className="text-slate-500"> · {c.items.map((i) => `${i.codigo}×${i.cantidad}`).join(', ')}</span>
                    )}
                  </span>
                  <span className="flex gap-2">
                    {c.estado === 'ABIERTA' ? (
                      <button onClick={() => cerrarCaja(c.id)} className="rounded bg-amber-600 px-2 py-1 text-xs text-white">Cerrar caja</button>
                    ) : (
                      <button onClick={() => verEtiqueta(c.id)} className="rounded bg-slate-600 px-2 py-1 text-xs text-white">Etiqueta</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => accionSimple('/finalizar-empaque', 'Empaque finalizado')}
              className="mt-3 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white"
            >
              Finalizar empaque
            </button>
            <div className="mt-3 flex gap-2 border-t pt-3">
              <input value={motivoDevolver} onChange={(e) => setMotivoDevolver(e.target.value)} placeholder="Motivo de devolución…" className="flex-1 rounded border px-2 py-1 text-sm" />
              <button
                onClick={() => accionSimple('/devolver', 'Despacho devuelto al Generador', { motivo: motivoDevolver })}
                className="rounded bg-red-100 px-3 py-1 text-sm text-red-700"
              >
                Devolver al Generador
              </button>
            </div>
          </section>
        )}

        {/* I19: cajas del despacho con el usuario que empacó (visible en
            cualquier estado, también cuando el packing ya no está activo) */}
        {despacho.cajas.length > 0 && !(despacho.estado === 'ABIERTO' && !despacho.empaqueFinalizado && esOperador) && (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Cajas</h2>
            <ul className="space-y-1 text-sm">
              {despacho.cajas.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded border p-2">
                  <span>
                    Caja {c.numeroEnDespacho} <span className="text-slate-500">({c.boxId})</span> — {c.estado}
                    {c.creadoPorUsuario && (
                      <span className="ml-1 text-xs text-slate-400">· empacada por {c.creadoPorUsuario.nombre}</span>
                    )}
                    {c.items.length > 0 && (
                      <span className="text-slate-500"> · {c.items.map((i) => `${i.codigo}×${i.cantidad}`).join(', ')}</span>
                    )}
                  </span>
                  {c.estado === 'CERRADA' && (
                    <button onClick={() => verEtiqueta(c.id)} className="rounded bg-slate-600 px-2 py-1 text-xs text-white">Etiqueta</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Pendientes por empacar (I29: cuadro de conteo como en alistamiento) */}
        {despacho.pendientes.length > 0 && despacho.estado !== 'DESPACHADO' && despacho.estado !== 'CANCELADO' && (() => {
          const pendientesReales = despacho.pendientes.filter((p) => p.pendiente > 0);
          const totalPendienteEmpacar = pendientesReales.reduce((acc, p) => acc + p.pendiente, 0);
          return (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Pendientes por empacar</h2>
            <div className="mb-3 flex items-center gap-4 rounded-lg border-2 border-sofia-200 bg-white px-5 py-3">
              <span className="text-5xl font-extrabold leading-none text-sofia-900">
                {totalPendienteEmpacar}
              </span>
              <div>
                <p className="text-sm font-semibold text-sofia-800">
                  unidades pendientes por empacar
                </p>
                <p className="text-xs text-slate-500">
                  {pendientesReales.length} referencia(s) por completar
                </p>
              </div>
            </div>
            <ul className="text-sm text-slate-600">
              {despacho.pendientes.map((p) => (
                <li key={p.orderItemId}>
                  {p.codigo} — {p.descripcion} ({p.numeroPedido}): alistado {p.cantidadAlistada}, despachado {p.cantidadDespachada}
                  {p.enCajasAbiertas > 0 && `, en cajas abiertas ${p.enCajasAbiertas}`},{' '}
                  <b className={p.pendiente > 0 ? 'text-amber-700' : undefined}>pendiente {p.pendiente}</b>
                </li>
              ))}
            </ul>
          </section>
          );
        })()}

        {/* Aprobación de parcial (HU-041, Generador) */}
        {despacho.estado === 'PARCIAL' && !despacho.parcialMotivo && esGenerador && (
          <section className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
            <h2 className="mb-2 font-semibold">Despacho parcial — requiere aprobación</h2>
            <div className="flex gap-2">
              <input value={motivoParcial} onChange={(e) => setMotivoParcial(e.target.value)} placeholder="Motivo del despacho parcial…" className="flex-1 rounded border px-2 py-1 text-sm" />
              <button onClick={() => accionSimple('/aprobar-parcial', 'Parcial aprobado', { motivo: motivoParcial })} className="rounded bg-amber-600 px-3 py-1 text-sm text-white">
                Aprobar parcial
              </button>
            </div>
          </section>
        )}
        {despacho.parcialMotivo && (
          <p className="mb-3 rounded bg-amber-100 p-2 text-sm text-amber-800">Parcial aprobado: {despacho.parcialMotivo}</p>
        )}

        {/* Transporte (HU-039/040; I29: también el Operador registra la salida) */}
        {despacho.empaqueFinalizado && (despacho.estado === 'ABIERTO' || despacho.estado === 'PARCIAL') && (esGenerador || esOperador) && (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Registro de salida (transporte)</h2>
            <div className="mb-2 flex gap-4 text-sm">
              <label><input type="radio" checked={tipoTransporte === 'EXTERNA'} onChange={() => setTipoTransporte('EXTERNA')} /> Transportadora externa</label>
              <label><input type="radio" checked={tipoTransporte === 'INTERNA'} onChange={() => setTipoTransporte('INTERNA')} /> Transporte interno</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {tipoTransporte === 'EXTERNA' ? (
                <>
                  <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)} className="rounded border px-2 py-1 text-sm">
                    <option value="">Transportadora…</option>
                    {externos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <input value={guia} onChange={(e) => setGuia(e.target.value)} placeholder="Número de guía" className="rounded border px-2 py-1 text-sm" />
                </>
              ) : (
                <input value={nombreInterno} onChange={(e) => setNombreInterno(e.target.value)} placeholder="Nombre del transporte interno" className="flex-1 rounded border px-2 py-1 text-sm" />
              )}
              <button
                onClick={() =>
                  accionSimple('/transporte', 'Despacho despachado', {
                    tipo: tipoTransporte,
                    carrierId: tipoTransporte === 'EXTERNA' ? carrierId || undefined : undefined,
                    guia: guia || undefined,
                    nombreTransporte: tipoTransporte === 'INTERNA' ? nombreInterno || undefined : undefined,
                  })
                }
                className="rounded bg-green-600 px-4 py-1 text-sm font-medium text-white"
              >
                Registrar salida → Despachado
              </button>
            </div>
          </section>
        )}

        {/* Completar parcial (D-06/HU-042) */}
        {despacho.estado === 'DESPACHADO' && despacho.parcialMotivo && esGenerador && (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <button onClick={() => accionSimple('/completar', 'Despacho adicional creado para completar el parcial')} className="rounded bg-sofia-600 px-4 py-2 text-sm text-white">
              Crear despacho adicional para completar
            </button>
          </section>
        )}

        {/* Cancelación */}
        {despacho.estado !== 'DESPACHADO' && despacho.estado !== 'CANCELADO' && esGenerador && (
          <section className="mb-4 flex gap-2">
            <input value={motivoCancelar} onChange={(e) => setMotivoCancelar(e.target.value)} placeholder="Motivo de cancelación…" className="flex-1 rounded border px-2 py-1 text-sm" />
            <button onClick={() => accionSimple('/cancelar', 'Despacho cancelado (movimientos revertidos)', { motivo: motivoCancelar || undefined })} className="rounded bg-red-600 px-3 py-1 text-sm text-white">
              Cancelar despacho
            </button>
          </section>
        )}

        {/* Etiqueta de caja (HU-038 / I25): código de barras CODE-128 con
            SOLO el box_id + empresa(s); lista para enviar al POS */}
        {etiqueta && (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Etiqueta de caja (50 × 30 mm)</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={imprimirEtiqueta}
                  className="flex items-center gap-1 rounded bg-sofia-600 px-3 py-1 text-sm text-white hover:bg-sofia-700"
                  title="Enviar la etiqueta al diálogo de impresión (POS)"
                >
                  <Printer size={14} /> Imprimir
                </button>
                <button onClick={() => setEtiqueta(null)} className="text-sm text-slate-500 hover:underline">Cerrar</button>
              </div>
            </div>
            <div
              className="mt-2 flex flex-col items-center justify-between rounded border-2 border-dashed p-2 text-center"
              style={{ width: '50mm', height: '30mm' }}
            >
              {etiqueta.empresas && etiqueta.empresas.length > 0 && (
                <p
                  className="w-full truncate font-bold uppercase"
                  style={{ fontSize: '8px' }}
                  title={etiqueta.empresas.join(' + ')}
                >
                  {etiqueta.empresas.join(' + ')}
                </p>
              )}
              <img
                src={etiqueta.barcodeDataUrl}
                alt={`Código de barras ${etiqueta.boxId}`}
                className="w-[40mm] object-fill"
              />
              <p className="font-bold" style={{ fontSize: '10px' }}>{etiqueta.boxId}</p>
              <p className="text-slate-500" style={{ fontSize: '8px' }}>Despacho {etiqueta.despachoNumero}</p>
            </div>
          </section>
        )}
      </AppShell>
    );
  }

  // ---------------------------------------------------------------
  // Lista de despachos + consulta de caja (M10)
  // ---------------------------------------------------------------
  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Despachos"
        acciones={
          esGenerador ? (
            <button
              onClick={() => {
                limpiarAvisos();
                setPedidosSel([]);
                setMostrarCrear(!mostrarCrear);
              }}
              className={CLASE_BOTON_PRIMARIO}
            >
              Nuevo despacho
            </button>
          ) : undefined
        }
      />

      {mensaje && <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-800">{mensaje}</p>}
      {error && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

      {mostrarCrear && (
        <section className="mb-4 rounded-lg bg-white p-4 shadow">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Crear despacho</h2>
            {pedidosSel.length > 0 && (
              <button onClick={() => setPedidosSel([])} className="text-sm text-slate-500 hover:underline">
                Limpiar selección
              </button>
            )}
          </div>
          <p className="mb-3 text-sm text-slate-500">
            Seleccione uno o varios pedidos APROBADOS del mismo cliente; el despacho los consolida.
          </p>
          {(() => {
            const clienteSel =
              pedidosSel.length > 0
                ? pedidosAprobados.find((x) => x.id === pedidosSel[0])?.clienteId ?? null
                : null;
            return pedidosAprobados.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                No hay pedidos aprobados pendientes por despachar.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pedidosAprobados.map((p) => {
                  const seleccionado = pedidosSel.includes(p.id);
                  const inhabilitado = !seleccionado && clienteSel !== null && p.clienteId !== clienteSel;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={inhabilitado}
                      onClick={() => alternarPedido(p)}
                      title={inhabilitado ? 'El despacho consolida pedidos del mismo cliente' : undefined}
                      className={`rounded-xl border p-4 text-left transition-shadow ${
                        seleccionado
                          ? 'border-sofia-600 bg-sofia-50 ring-2 ring-sofia-600'
                          : inhabilitado
                            ? 'cursor-not-allowed border-slate-200 bg-slate-50/60 opacity-40'
                            : 'border-slate-200 bg-slate-50/60 hover:shadow-md'
                      }`}
                    >
                      <div className="mb-6 flex items-start justify-between">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sofia-700">
                          <Package size={18} />
                        </span>
                        {seleccionado ? (
                          <CheckCircle2 size={20} className="text-sofia-700" />
                        ) : (
                          <Insignia tono="menta">Prioridad</Insignia>
                        )}
                      </div>
                      <p className="font-semibold text-slate-800">{p.numero}</p>
                      <p className="truncate text-sm font-medium text-sofia-700">
                        {p.cliente?.nombre ?? 'Sin cliente'}
                      </p>
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock size={13} /> {haceMinutos(p.createdAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={crear}
              disabled={pedidosSel.length === 0}
              className={`${CLASE_BOTON_PRIMARIO}${pedidosSel.length === 0 ? ' cursor-not-allowed opacity-50' : ''}`}
            >
              Crear despacho{pedidosSel.length > 1 ? ` con ${pedidosSel.length} pedidos` : ''}
            </button>
            {pedidosSel.length > 0 && (
              <span className="text-sm text-slate-500">
                {pedidosSel.length} pedido{pedidosSel.length > 1 ? 's' : ''} seleccionado{pedidosSel.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </section>
      )}

      {/* M10: consulta de caja por box_id (lo que trae el QR) */}
      <section className="mb-4 rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Consulta de caja</h2>
        <div className="flex gap-2">
          <input value={boxIdConsulta} onChange={(e) => setBoxIdConsulta(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && consultarCaja()} placeholder="CJA-000000" className="rounded border px-2 py-1 text-sm" />
          <button onClick={consultarCaja} className="rounded bg-sofia-600 px-3 py-1 text-sm text-white">Consultar</button>
        </div>
        {consultaCaja && (
          <div className="mt-2 rounded border p-2 text-sm">
            <p className="font-medium">{consultaCaja.boxId} — {consultaCaja.estado} · Despacho {consultaCaja.despacho.numero} ({ESTADOS[consultaCaja.despacho.estado as Despacho['estado']]})</p>
            <p className="text-slate-600">
              {consultaCaja.cliente?.nombre}
              {consultaCaja.empresas?.length ? ` · ${consultaCaja.empresas.join(' + ')}` : ''}
              {consultaCaja.documentos?.length ? ` · ${consultaCaja.documentos.join(', ')}` : ''}
              {consultaCaja.fecha ? ` · ${new Date(consultaCaja.fecha).toLocaleDateString('es-CO')}` : ''}
            </p>
            <ul className="mt-1 text-slate-600">
              {consultaCaja.items.map((i: any) => (
                <li key={i.id}>{i.codigo} — {i.descripcion ?? ''}: {i.cantidad} uds · pedido {i.pedido}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* HU-054: filtros de consulta */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded border px-2 py-1">
          <option value="">Estado</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="rounded border px-2 py-1" title="Empresa de los pedidos incluidos en el despacho">
          <option value="">Empresa (pedidos incluidos)</option>
          {empresasFiltro.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} className="rounded border px-2 py-1" title="Desde" />
        <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} className="rounded border px-2 py-1" title="Hasta" />
        <input value={filtroDocumento} onChange={(e) => setFiltroDocumento(e.target.value)} placeholder="Documento (factura)" className="w-36 rounded border px-2 py-1" />
        <input value={filtroBox} onChange={(e) => setFiltroBox(e.target.value)} placeholder="Caja (CJA-…)" className="w-28 rounded border px-2 py-1" />
        <input value={filtroGuia} onChange={(e) => setFiltroGuia(e.target.value)} placeholder="Guía" className="w-28 rounded border px-2 py-1" />
        <button onClick={() => cargarLista()} className="rounded bg-sofia-600 px-3 py-1 text-white">Filtrar</button>
      </div>

      <section className="rounded-lg bg-white p-4 shadow">
        {lista.length === 0 ? (
          <p className="text-sm text-slate-500">No hay despachos.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Número</th>
                <th>Cliente</th>
                <th>Empresas</th>
                <th>Estado</th>
                <th>Pedidos</th>
                <th>Cajas</th>
                <th>Factura</th>
                <th>Transporte</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{d.numero}</td>
                  <td className="text-slate-700">{d.clienteNombre ?? '—'}</td>
                  <td>
                    {d.empresas?.map((sig) => (
                      <span key={sig} className="mr-1 rounded bg-sofia-100 px-1.5 py-0.5 text-xs font-medium text-sofia-800">
                        {sig}
                      </span>
                    ))}
                  </td>
                  <td>{ESTADOS[d.estado]}</td>
                  <td>{d.totalPedidos}</td>
                  <td>{d.totalCajas}</td>
                  <td className="text-slate-500">{d.facturas?.length ? d.facturas.join(', ') : '—'}</td>
                  <td className="text-slate-500">{d.nombreTransporte ? `${d.nombreTransporte}${d.guia ? ` · ${d.guia}` : ''}` : '—'}</td>
                  <td>
                    <button onClick={() => cargarDetalle(d.id)} className="text-sofia-700 hover:underline">Abrir</button>
                  </td>
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
