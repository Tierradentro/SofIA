'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';

interface Cliente { id: string; nombre: string }
interface Comercial { id: string; nombre: string }
interface Motivo { codigo: string; concepto: 'GARANTIA' | 'GARANTIA_NO_APLICA'; descripcion: string }

interface Soporte {
  id: string;
  tipo: 'RECEPCION' | 'SOLUCION';
  observacion: string | null;
  nombreOriginal: string | null;
}

interface Caso {
  id: string;
  clienteId: string;
  clienteNombre?: string;
  cliente?: { id: string; nombre: string } | null;
  comercial?: { id: string; nombre: string } | null;
  codigo: string;
  marca: string | null;
  descripcion: string;
  cantidad: number;
  cantidadReingresada: number;
  factura: string | null;
  facturaManual: boolean;
  facturaObservacion: string | null;
  motivoCodigo: string;
  motivo?: Motivo | null;
  detalle: string | null;
  descripcionCaso: string;
  solucionCaso: string | null;
  notas: string | null;
  prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
  estado: 'ABIERTA' | 'PENDIENTE_CORRECCION' | 'CERRADA' | 'CANCELADA';
  orderId: string | null;
  dispatchId: string | null;
  boxId: string | null;
  pedido?: { numero: string; numeroFactura: string | null; estado: string } | null;
  despacho?: { numero: string; estado: string } | null;
  soportes?: Soporte[];
  createdAt: string;
  cerradaAt: string | null;
}

interface Busqueda {
  pedidos: { id: string; numero: string; numeroFactura: string | null }[];
  despachos: { id: string; numero: string; estado: string }[];
  cajas: { boxId: string; dispatchId: string; estado: string }[];
}

const ESTADOS: Record<Caso['estado'], string> = {
  ABIERTA: 'Abierta',
  PENDIENTE_CORRECCION: 'Pendiente corrección',
  CERRADA: 'Cerrada',
  CANCELADA: 'Cancelada',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * M11/EP-08: devoluciones (PQRS).
 * Operador: crea el caso, adjunta soportes, solicita corrección, registra solución y cierra.
 * Generador: corrige, cancela y reingresa mercancía al inventario.
 */
export default function DevolucionesPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [lista, setLista] = useState<Caso[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [caso, setCaso] = useState<Caso | null>(null);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [comerciales, setComerciales] = useState<Comercial[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);

  // Creación
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [clienteId, setClienteId] = useState('');
  const [comercialId, setComercialId] = useState('');
  const [codigo, setCodigo] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [motivoCodigo, setMotivoCodigo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [descripcionCaso, setDescripcionCaso] = useState('');
  const [prioridad, setPrioridad] = useState<'ALTA' | 'MEDIA' | 'BAJA'>('MEDIA');
  const [factura, setFactura] = useState('');
  const [facturaObservacion, setFacturaObservacion] = useState('');
  const [notas, setNotas] = useState('');

  // Búsqueda de asociación (HU-044)
  const [terminoBusqueda, setTerminoBusqueda] = useState('');
  const [tipoBusqueda, setTipoBusqueda] = useState<'codigo' | 'boxId' | 'factura' | 'despacho'>('codigo');
  const [busqueda, setBusqueda] = useState<Busqueda | null>(null);
  const [orderIdSel, setOrderIdSel] = useState('');
  const [dispatchIdSel, setDispatchIdSel] = useState('');
  const [boxIdSel, setBoxIdSel] = useState('');

  // Soportes
  const [archivoSoporte, setArchivoSoporte] = useState<File | null>(null);
  const [obsSoporte, setObsSoporte] = useState('');
  const [tipoSoporte, setTipoSoporte] = useState<'RECEPCION' | 'SOLUCION'>('RECEPCION');

  // Corrección / cierre / cancelación / reingreso
  const [motivoSolCorreccion, setMotivoSolCorreccion] = useState('');
  const [corrCantidad, setCorrCantidad] = useState('');
  const [corrMotivo, setCorrMotivo] = useState('');
  const [corrNota, setCorrNota] = useState('');
  const [solucion, setSolucion] = useState('');
  const [motivoCancelar, setMotivoCancelar] = useState('');
  const [cantidadReingreso, setCantidadReingreso] = useState('');
  const [notasReingreso, setNotasReingreso] = useState('');

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const rol = sesion?.usuario.rol;
  const esOperador = rol === 'OPERADOR' || rol === 'ADMINISTRADOR';
  const esGenerador = rol === 'GENERADOR' || rol === 'ADMINISTRADOR';

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    cargarLista();
    api<Cliente[]>('/clients').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setClientes(body);
        setClienteId(body[0].id);
      }
    });
    api<Comercial[]>('/comerciales').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setComerciales(body);
        setComercialId(body[0].id);
      }
    });
    api<Motivo[]>('/pqrs/motivos').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setMotivos(body);
        setMotivoCodigo(body[0].codigo);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limpiarAvisos() {
    setMensaje('');
    setError('');
  }

  async function cargarLista(estado = filtroEstado) {
    const q = estado ? `?estado=${estado}` : '';
    const { status, body } = await api<Caso[]>(`/pqrs${q}`);
    if (status === 200) setLista(body);
  }

  async function cargarDetalle(id: string) {
    const { status, body } = await api<Caso>(`/pqrs/${id}`);
    if (status === 200) setCaso(body);
  }

  async function buscar() {
    limpiarAvisos();
    setBusqueda(null);
    if (!terminoBusqueda.trim()) return;
    const { status, body } = await api<Busqueda>(
      `/pqrs/buscar?${tipoBusqueda}=${encodeURIComponent(terminoBusqueda.trim())}`,
    );
    if (status === 200) {
      setBusqueda(body);
      if (!body.pedidos.length && !body.despachos.length && !body.cajas.length) {
        setMensaje('Sin coincidencias: registre la factura manual u observación');
      }
    } else setError(mensajeError(body, 'Búsqueda fallida'));
  }

  async function crear() {
    limpiarAvisos();
    const { status, body } = await api<any>('/pqrs', {
      method: 'POST',
      body: JSON.stringify({
        clienteId,
        comercialId: comercialId || undefined,
        codigo: codigo.trim(),
        cantidad: parseInt(cantidad, 10) || 1,
        motivoCodigo,
        detalle: detalle || undefined,
        descripcionCaso,
        prioridad,
        factura: factura || undefined,
        facturaObservacion: facturaObservacion || undefined,
        notas: notas || undefined,
        orderId: orderIdSel || undefined,
        dispatchId: dispatchIdSel || undefined,
        boxId: boxIdSel || undefined,
      }),
    });
    if (status === 201) {
      setMensaje('Caso creado: ABIERTO');
      setMostrarCrear(false);
      setCodigo('');
      setDescripcionCaso('');
      setFactura('');
      setFacturaObservacion('');
      setBusqueda(null);
      setOrderIdSel('');
      setDispatchIdSel('');
      setBoxIdSel('');
      cargarLista();
      cargarDetalle(body.id);
    } else setError(mensajeError(body, 'No se pudo crear el caso'));
  }

  async function adjuntarSoporte() {
    limpiarAvisos();
    if (!caso || !archivoSoporte) return setError('Seleccione la imagen del soporte');
    const ses = obtenerSesion();
    const form = new FormData();
    form.append('tipo', tipoSoporte);
    if (obsSoporte) form.append('observacion', obsSoporte);
    form.append('file', archivoSoporte);
    const res = await fetch(`${API_BASE}/pqrs/${caso.id}/soportes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ses?.token}` },
      body: form,
    });
    if (res.status === 201) {
      setMensaje('Soporte adjuntado');
      setArchivoSoporte(null);
      setObsSoporte('');
      cargarDetalle(caso.id);
    } else {
      const body = await res.json();
      setError(mensajeError(body, 'No se pudo adjuntar'));
    }
  }

  async function accion(path: string, textoOk: string, body: any = {}) {
    limpiarAvisos();
    if (!caso) return;
    const { status, body: resp } = await api<any>(`/pqrs/${caso.id}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (status === 201) {
      setMensaje(textoOk);
      cargarDetalle(caso.id);
      cargarLista();
    } else setError(mensajeError(resp, 'Operación rechazada'));
  }

  if (!sesion) return null;

  // ---------------------------------------------------------------
  // Detalle del caso
  // ---------------------------------------------------------------
  if (caso) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Caso {caso.codigo} × {caso.cantidad}</h1>
            <p className="text-sm text-slate-600">
              {caso.cliente?.nombre} · <span className="font-medium">{ESTADOS[caso.estado]}</span>
              {' '}· {caso.motivoCodigo} ({caso.motivo?.concepto === 'GARANTIA' ? 'Garantía' : 'Garantía no aplica'}: {caso.motivo?.descripcion})
              {' '}· Prioridad {caso.prioridad}
            </p>
          </div>
          <button onClick={() => { setCaso(null); cargarLista(); }} className="rounded bg-slate-200 px-3 py-1 text-sm">← Volver</button>
        </div>

        {mensaje && <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-800">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

        <section className="mb-4 rounded-lg bg-white p-4 shadow text-sm">
          <h2 className="mb-2 font-semibold">Información del caso</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <p><b>Producto:</b> {caso.codigo} — {caso.descripcion}{caso.marca ? ` (${caso.marca})` : ''}</p>
            <p><b>Cantidad:</b> {caso.cantidad} · <b>Reingresada:</b> {caso.cantidadReingresada}</p>
            <p><b>Factura:</b> {caso.factura ? `${caso.factura}${caso.facturaManual ? ' (manual)' : ''}` : '—'}</p>
            <p><b>Comercial:</b> {caso.comercial?.nombre ?? '—'}</p>
            {caso.facturaObservacion && <p className="sm:col-span-2"><b>Observación factura:</b> {caso.facturaObservacion}</p>}
            <p className="sm:col-span-2"><b>Descripción:</b> {caso.descripcionCaso}</p>
            {caso.detalle && <p className="sm:col-span-2"><b>Detalle:</b> {caso.detalle}</p>}
            {caso.notas && <p className="sm:col-span-2"><b>Notas:</b> {caso.notas}</p>}
            {caso.pedido && <p><b>Pedido:</b> {caso.pedido.numero}</p>}
            {caso.despacho && <p><b>Despacho:</b> {caso.despacho.numero}{caso.boxId ? ` · caja ${caso.boxId}` : ''}</p>}
            {caso.solucionCaso && <p className="sm:col-span-2"><b>Solución:</b> {caso.solucionCaso}</p>}
          </div>
        </section>

        {/* Soportes (HU-046) */}
        <section className="mb-4 rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold">Soportes ({caso.soportes?.length ?? 0})</h2>
          <ul className="mb-3 space-y-1 text-sm">
            {caso.soportes?.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded border p-2">
                <span>
                  <span className="font-medium">{s.nombreOriginal}</span>
                  <span className="text-slate-500"> · {s.tipo === 'RECEPCION' ? 'Recepción' : 'Solución'}</span>
                  {s.observacion && <span className="text-slate-500"> · {s.observacion}</span>}
                </span>
                <a
                  href={`${API_BASE}/pqrs/soportes/${s.id}/archivo`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sofia-700 hover:underline"
                  onClick={async (e) => {
                    e.preventDefault();
                    const ses = obtenerSesion();
                    const res = await fetch(`${API_BASE}/pqrs/soportes/${s.id}/archivo`, {
                      headers: { Authorization: `Bearer ${ses?.token}` },
                    });
                    const blob = await res.blob();
                    window.open(URL.createObjectURL(blob), '_blank');
                  }}
                >
                  Ver
                </a>
              </li>
            ))}
          </ul>
          {esOperador && caso.estado !== 'CANCELADA' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={tipoSoporte} onChange={(e) => setTipoSoporte(e.target.value as any)} className="rounded border px-2 py-1">
                <option value="RECEPCION">Recepción</option>
                <option value="SOLUCION">Solución (proveedor)</option>
              </select>
              <input value={obsSoporte} onChange={(e) => setObsSoporte(e.target.value)} placeholder="Observación…" className="flex-1 rounded border px-2 py-1" />
              <input type="file" accept="image/*" onChange={(e) => setArchivoSoporte(e.target.files?.[0] ?? null)} className="text-xs" />
              <button onClick={adjuntarSoporte} className="rounded bg-sofia-600 px-3 py-1 text-white">Adjuntar</button>
            </div>
          )}
        </section>

        {/* Acciones del Operador */}
        {esOperador && caso.estado === 'ABIERTA' && (
          <section className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-4 shadow text-sm">
              <h2 className="mb-2 font-semibold">Solicitar corrección</h2>
              <input value={motivoSolCorreccion} onChange={(e) => setMotivoSolCorreccion(e.target.value)} placeholder="Qué está incorrecto…" className="mb-2 w-full rounded border px-2 py-1" />
              <button onClick={() => accion('/solicitar-correccion', 'Corrección solicitada al Generador', { motivo: motivoSolCorreccion })} className="rounded bg-amber-600 px-3 py-1 text-white">
                Solicitar corrección
              </button>
            </div>
            <div className="rounded-lg bg-white p-4 shadow text-sm">
              <h2 className="mb-2 font-semibold">Solución y cierre</h2>
              <textarea value={solucion} onChange={(e) => setSolucion(e.target.value)} placeholder="Resultado de la validación…" className="mb-2 w-full rounded border px-2 py-1" rows={2} />
              <button onClick={() => accion('/cerrar', 'Caso cerrado', { solucionCaso: solucion })} className="rounded bg-green-600 px-3 py-1 text-white">
                Registrar solución y cerrar
              </button>
            </div>
          </section>
        )}

        {/* Acciones del Generador */}
        {esGenerador && caso.estado === 'PENDIENTE_CORRECCION' && (
          <section className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-sm">
            <h2 className="mb-2 font-semibold">Corregir caso (Generador)</h2>
            <div className="flex flex-wrap gap-2">
              <input value={corrCantidad} onChange={(e) => setCorrCantidad(e.target.value)} placeholder="Cantidad" type="number" min={1} className="w-24 rounded border px-2 py-1" />
              <select value={corrMotivo} onChange={(e) => setCorrMotivo(e.target.value)} className="rounded border px-2 py-1">
                <option value="">Motivo (sin cambio)</option>
                {motivos.map((m) => <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.descripcion}</option>)}
              </select>
              <input value={corrNota} onChange={(e) => setCorrNota(e.target.value)} placeholder="Motivo de la corrección (obligatorio)…" className="flex-1 rounded border px-2 py-1" />
              <button
                onClick={() =>
                  accion('/corregir', 'Caso corregido: vuelve a Abierta', {
                    motivoCorreccion: corrNota,
                    cantidad: corrCantidad ? parseInt(corrCantidad, 10) : undefined,
                    motivoCodigo: corrMotivo || undefined,
                  })
                }
                className="rounded bg-amber-600 px-3 py-1 text-white"
              >
                Corregir y devolver
              </button>
            </div>
          </section>
        )}

        {esGenerador && caso.estado !== 'CANCELADA' && caso.estado !== 'CERRADA' && (
          <section className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-4 shadow text-sm">
              <h2 className="mb-2 font-semibold">Reingreso al inventario</h2>
              <p className="mb-2 text-slate-500">Pendiente por reingresar: {caso.cantidad - caso.cantidadReingresada}</p>
              <div className="flex gap-2">
                <input value={cantidadReingreso} onChange={(e) => setCantidadReingreso(e.target.value)} placeholder="Cantidad" type="number" min={1} className="w-24 rounded border px-2 py-1" />
                <input value={notasReingreso} onChange={(e) => setNotasReingreso(e.target.value)} placeholder="Notas…" className="flex-1 rounded border px-2 py-1" />
                <button
                  onClick={() =>
                    accion('/reingresar', 'Mercancía reingresada al inventario', {
                      cantidad: cantidadReingreso ? parseInt(cantidadReingreso, 10) : undefined,
                      notas: notasReingreso || undefined,
                    })
                  }
                  className="rounded bg-sofia-600 px-3 py-1 text-white"
                >
                  Reingresar
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow text-sm">
              <h2 className="mb-2 font-semibold">Cancelar caso</h2>
              <div className="flex gap-2">
                <input value={motivoCancelar} onChange={(e) => setMotivoCancelar(e.target.value)} placeholder="Motivo…" className="flex-1 rounded border px-2 py-1" />
                <button onClick={() => accion('/cancelar', 'Caso cancelado', { motivo: motivoCancelar || undefined })} className="rounded bg-red-600 px-3 py-1 text-white">
                  Cancelar
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Lista de casos + creación
  // ---------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Devoluciones (PQRS)</h1>
        <div className="flex gap-2">
          <button onClick={() => router.push('/dashboard')} className="rounded bg-slate-200 px-3 py-1 text-sm">← Panel</button>
          {esOperador && (
            <button onClick={() => setMostrarCrear(!mostrarCrear)} className="rounded bg-sofia-600 px-3 py-1 text-sm text-white">
              Nuevo caso
            </button>
          )}
        </div>
      </div>

      {mensaje && <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-800">{mensaje}</p>}
      {error && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

      {mostrarCrear && (
        <section className="mb-4 rounded-lg bg-white p-4 shadow text-sm">
          <h2 className="mb-3 font-semibold">Crear caso de devolución</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="rounded border px-2 py-1">
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select value={comercialId} onChange={(e) => setComercialId(e.target.value)} className="rounded border px-2 py-1">
              <option value="">Comercial…</option>
              {comerciales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escanear/seleccionar producto (código)…" className="rounded border px-2 py-1" />
            <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} type="number" min={1} placeholder="Cantidad" className="rounded border px-2 py-1" />
            <select value={motivoCodigo} onChange={(e) => setMotivoCodigo(e.target.value)} className="rounded border px-2 py-1">
              <optgroup label="Garantía">
                {motivos.filter((m) => m.concepto === 'GARANTIA').map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.descripcion}</option>
                ))}
              </optgroup>
              <optgroup label="Garantía no aplica">
                {motivos.filter((m) => m.concepto === 'GARANTIA_NO_APLICA').map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.descripcion}</option>
                ))}
              </optgroup>
            </select>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as any)} className="rounded border px-2 py-1">
              <option value="ALTA">Prioridad alta</option>
              <option value="MEDIA">Prioridad media</option>
              <option value="BAJA">Prioridad baja</option>
            </select>
          </div>
          <textarea value={descripcionCaso} onChange={(e) => setDescripcionCaso(e.target.value)} placeholder="Descripción del caso (obligatoria)…" className="mt-2 w-full rounded border px-2 py-1" rows={2} />
          <input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Detalle del motivo…" className="mt-2 w-full rounded border px-2 py-1" />

          {/* HU-044: búsqueda de pedido/despacho/caja/factura */}
          <div className="mt-3 rounded border p-2">
            <p className="mb-1 font-medium">Buscar asociación</p>
            <div className="flex gap-2">
              <select value={tipoBusqueda} onChange={(e) => setTipoBusqueda(e.target.value as any)} className="rounded border px-2 py-1">
                <option value="codigo">Por producto</option>
                <option value="boxId">Por caja</option>
                <option value="factura">Por factura</option>
                <option value="despacho">Por despacho</option>
              </select>
              <input value={terminoBusqueda} onChange={(e) => setTerminoBusqueda(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && buscar()} placeholder="Término…" className="flex-1 rounded border px-2 py-1" />
              <button onClick={buscar} className="rounded bg-sofia-600 px-3 py-1 text-white">Buscar</button>
            </div>
            {busqueda && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select value={orderIdSel} onChange={(e) => setOrderIdSel(e.target.value)} className="rounded border px-2 py-1">
                  <option value="">Pedido…</option>
                  {busqueda.pedidos.map((p) => <option key={p.id} value={p.id}>{p.numero}{p.numeroFactura ? ` · ${p.numeroFactura}` : ''}</option>)}
                </select>
                <select value={dispatchIdSel} onChange={(e) => setDispatchIdSel(e.target.value)} className="rounded border px-2 py-1">
                  <option value="">Despacho…</option>
                  {busqueda.despachos.map((d) => <option key={d.id} value={d.id}>{d.numero}</option>)}
                </select>
                <select value={boxIdSel} onChange={(e) => setBoxIdSel(e.target.value)} className="rounded border px-2 py-1">
                  <option value="">Caja…</option>
                  {busqueda.cajas.map((c) => <option key={c.boxId} value={c.boxId}>{c.boxId}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* HU-045 / CU-007: factura manual u observación */}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="Factura (manual si no hay coincidencia)…" className="rounded border px-2 py-1" />
            <input value={facturaObservacion} onChange={(e) => setFacturaObservacion(e.target.value)} placeholder="Observación de factura (obligatoria sin factura)…" className="rounded border px-2 py-1" />
          </div>
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas…" className="mt-2 w-full rounded border px-2 py-1" />
          <button onClick={crear} className="mt-3 rounded bg-sofia-600 px-4 py-2 font-medium text-white">Crear caso</button>
        </section>
      )}

      <div className="mb-3 flex gap-2 text-sm">
        <select value={filtroEstado} onChange={(e) => { setFiltroEstado(e.target.value); cargarLista(e.target.value); }} className="rounded border px-2 py-1">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <section className="rounded-lg bg-white p-4 shadow">
        {lista.length === 0 ? (
          <p className="text-sm text-slate-500">No hay casos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Producto</th>
                <th>Cliente</th>
                <th>Motivo</th>
                <th>Cant.</th>
                <th>Factura</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{c.codigo}</td>
                  <td>{c.clienteNombre}</td>
                  <td>{c.motivoCodigo}</td>
                  <td>{c.cantidad}</td>
                  <td className="text-slate-500">{c.factura ?? '—'}</td>
                  <td>{ESTADOS[c.estado]}</td>
                  <td><button onClick={() => cargarDetalle(c.id)} className="text-sofia-700 hover:underline">Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
