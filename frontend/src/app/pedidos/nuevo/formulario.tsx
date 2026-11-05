'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, obtenerSesion, mensajeError } from '@/lib/api';
import {
  ConteoItems,
  docCampo,
  docInput,
  docInputDisabled,
  EncabezadoTablaDoc,
  MarcoDocumento,
  TarjetaEmisor,
  TotalDocumento,
} from '@/components/orden-pedido';

/**
 * QA Func. 3.2 + 3.3: creación de pedido en formato "Orden de Pedido" papel.
 * I39: visual unificado con la consulta del pedido (componentes
 * orden-pedido): empresa emisora con NIT, caja de número/estado, filas
 * Fecha/Ciudad/Vendedor y Cliente/NIT/Dirección/Teléfono, tabla con
 * encabezado azul y pie con conteo, observaciones y total.
 * I39: el pedido SOLO se crea con el botón "Crear pedido" — la tecla Enter
 * dentro del formulario nunca lo envía.
 * Vías de captura unificadas: manual, OCR (con revisión previa a crear) y
 * Excel. La vía OCR prellena este mismo panel con la extracción editable y
 * solo crea el pedido cuando el humano confirma.
 * I67: el contenido se guarda automáticamente como BORRADOR (sin número de
 * pedido) cada pocos segundos — si se cierra la aplicación o se va la luz,
 * el trabajo se recupera al volver a entrar. El consecutivo del pedido se
 * asigna únicamente al confirmar.
 */

interface Cliente {
  id: string;
  nombre: string;
  identificacion: string | null;
  direccion: string | null;
  telefonos: string | null;
  ciudad: string | null;
}

interface Comercial {
  id: string;
  nombre: string;
}

/** QA Func. 4.1: dirección de despacho del cliente. */
interface DireccionCliente {
  id: string;
  direccion: string;
  ciudad: string | null;
  esPrincipal: boolean;
}

export interface ItemForm {
  referencia: string;
  marca: string;
  descripcion: string;
  cantidad: string;
  valorUnidad: string;
}

/** I67: borrador guardado que se retoma al abrir el formulario. */
export interface BorradorPedido {
  id: string;
  empresaId: string | null;
  payload?: {
    via?: string;
    clienteId?: string;
    comercialId?: string;
    ciudad?: string;
    direccionId?: string;
    notas?: string;
    ocrDocumentId?: string | null;
    items?: Partial<ItemForm>[];
  };
}

interface ProductoLite {
  id: string;
  codigo: string;
  descripcion: string;
  marca?: string | null;
  precio: string | number;
  /** I26: existencias disponibles (la lista llega filtrada con conStock=true) */
  cantidad?: string | number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const ITEM_VACIO: ItemForm = {
  referencia: '',
  marca: '',
  descripcion: '',
  cantidad: '1',
  valorUnidad: '',
};

export function NuevoPedido({
  empresaId,
  empresas,
  clientes,
  comerciales,
  productos,
  rol,
  borrador,
  onCambiarEmpresa,
  onCreado,
  onCancelar,
}: {
  empresaId: string;
  empresas: { id: string; nombre: string; identificacion?: string | null }[];
  clientes: Cliente[];
  comerciales: Comercial[];
  productos: ProductoLite[];
  rol: string;
  /** I67: borrador a retomar (viene del aviso de recuperación). */
  borrador?: BorradorPedido | null;
  onCambiarEmpresa: (id: string) => void;
  onCreado: (id: string, numero: string, origen: string) => void;
  onCancelar: () => void;
}) {
  // I67: contenido inicial — del borrador si se está retomando uno
  const bp = borrador?.payload ?? {};
  const itemsIniciales: ItemForm[] =
    Array.isArray(bp.items) && bp.items.length
      ? bp.items.map((i) => ({
          referencia: String(i?.referencia ?? ''),
          marca: String(i?.marca ?? ''),
          descripcion: String(i?.descripcion ?? ''),
          cantidad: String(i?.cantidad ?? '1'),
          valorUnidad: i?.valorUnidad != null ? String(i.valorUnidad) : '',
        }))
      : [{ ...ITEM_VACIO }];

  const [clienteId, setClienteId] = useState(bp.clienteId ?? clientes[0]?.id ?? '');
  // QA Func. 4.1: dirección a la que va el despacho (se escoge en el Pedido)
  const [direcciones, setDirecciones] = useState<DireccionCliente[]>([]);
  const [direccionId, setDireccionId] = useState(bp.direccionId ?? '');
  const [comercialId, setComercialId] = useState(bp.comercialId ?? comerciales[0]?.id ?? '');
  // El primer comercial queda seleccionado por defecto; como la lista llega
  // de forma asíncrona, se preselecciona cuando carga si el campo está vacío
  // (sin comercial el backend rechaza el pedido: "El campo 'comercialId' no
  // es válido").
  useEffect(() => {
    if (!comercialId && comerciales.length) setComercialId(comerciales[0].id);
  }, [comerciales, comercialId]);
  const [ciudad, setCiudad] = useState(bp.ciudad ?? '');
  // I18: búsqueda del cliente por nombre o identificación (lista completa)
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [notas, setNotas] = useState(bp.notas ?? '');
  const [items, setItems] = useState<ItemForm[]>(itemsIniciales);
  const [via, setVia] = useState<'MANUAL' | 'OCR' | 'EXCEL'>(bp.via === 'OCR' ? 'OCR' : 'MANUAL');
  const [archivoOcr, setArchivoOcr] = useState<File | null>(null);
  const [archivoExcel, setArchivoExcel] = useState<File | null>(null);
  // QA Func. 3.3: documento OCR pendiente de revisión (aún no se crea pedido)
  const [ocrDocId, setOcrDocId] = useState<string | null>(bp.ocrDocumentId ?? null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  // I65d: la empresa se muestra como botón; el cambio se hace desde un
  // despliegue con botones por empresa (antes era una lista desplegable y
  // quedaba seleccionada una empresa sin que el usuario lo notara).
  const [mostrarEmpresas, setMostrarEmpresas] = useState(false);
  // I67: borrador automático — id del borrador en BD y hora del último guardado
  const [borradorId, setBorradorId] = useState<string | null>(borrador?.id ?? null);
  const [guardadoAt, setGuardadoAt] = useState<Date | null>(null);
  // I67: mientras se restaura un borrador, los efectos de cliente/dirección
  // NO deben pisar la ciudad ni la dirección que venían guardadas
  const restaurandoRef = useRef(!!borrador);
  // I68: casillas de referencia por fila — Enter en la cantidad agrega otra
  // fila y deja el foco en la casilla de referencia de la fila nueva
  const refsReferencia = useRef<(HTMLInputElement | null)[]>([]);

  const cliente = clientes.find((c) => c.id === clienteId) ?? null;
  const empresaActual = empresas.find((e) => e.id === empresaId) ?? null;

  // I65d: cambiar de empresa desde el despliegue. Si ya hay productos
  // digitados se pide confirmación (se buscaron con la empresa anterior).
  function elegirEmpresa(id: string) {
    if (id === empresaId) {
      setMostrarEmpresas(false);
      return;
    }
    const hayItems = items.some((i) => i.referencia.trim() || i.descripcion.trim());
    if (
      hayItems &&
      !window.confirm(
        'Cambiar de empresa reinicia los productos digitados (se buscaron con la empresa actual). ¿Continuar?',
      )
    ) {
      return;
    }
    if (hayItems) setItems([{ ...ITEM_VACIO }]);
    onCambiarEmpresa(id);
    setMostrarEmpresas(false);
  }

  // QA Func. 4.1: cargar las direcciones del cliente y preseleccionar la principal
  useEffect(() => {
    const restaurando = restaurandoRef.current;
    if (!restaurando) {
      setDireccionId('');
      setDirecciones([]);
      // I18: la ciudad arranca con la que trae el cliente
      setCiudad(clientes.find((c) => c.id === clienteId)?.ciudad ?? '');
    }
    if (!clienteId) {
      restaurandoRef.current = false;
      return;
    }
    api<DireccionCliente[]>(`/clients/${clienteId}/direcciones`)
      .then(({ status, body }) => {
        if (status !== 200) return;
        setDirecciones(body);
        // I67: al retomar un borrador se conserva la dirección guardada
        const guardada = restaurando && bp.direccionId
          ? body.find((d) => d.id === bp.direccionId)
          : undefined;
        const elegida = guardada ?? body.find((d) => d.esPrincipal) ?? body[0];
        if (elegida) setDireccionId(elegida.id);
      })
      .finally(() => {
        restaurandoRef.current = false;
      });
  }, [clienteId]);

  // I18: al elegir otra dirección (cliente con varias), su ciudad prevalece
  useEffect(() => {
    if (restaurandoRef.current) return; // I67: no pisar la ciudad del borrador
    const d = direcciones.find((x) => x.id === direccionId);
    if (d?.ciudad) setCiudad(d.ciudad);
  }, [direccionId, direcciones]);

  // ------------------------------------------------------------------
  // I67: guardado automático del borrador (anti desconexión / apagón)
  // ------------------------------------------------------------------
  // El estado más reciente vive en un ref para que el guardado diferido
  // siempre envíe lo último digitado (sin cierres de estado viejos).
  const estadoRef = useRef({ via, clienteId, comercialId, ciudad, direccionId, notas, ocrDocId, items, empresaId, borradorId });
  estadoRef.current = { via, clienteId, comercialId, ciudad, direccionId, notas, ocrDocId, items, empresaId, borradorId };
  // Cadena de guardados: uno a la vez, sin cruces entre el temporizador y
  // el guardado final que precede a «Crear pedido».
  const cadenaRef = useRef<Promise<void>>(Promise.resolve());
  // Al confirmar se detiene el guardado: el borrador se elimina en el
  // servidor y un guardado tardío lo recrearía como borrador huérfano.
  const confirmandoRef = useRef(false);

  /** Hay trabajo que proteger: productos digitados, notas u OCR procesado. */
  function tieneContenido(e = estadoRef.current): boolean {
    return (
      e.items.some((i) => i.referencia.trim() || i.descripcion.trim()) ||
      e.notas.trim() !== '' ||
      !!e.ocrDocId
    );
  }

  const guardarBorrador = useCallback((): Promise<void> => {
    const tarea = cadenaRef.current.then(async () => {
      const e = estadoRef.current;
      if (confirmandoRef.current || !tieneContenido(e)) return;
      const cuerpo = JSON.stringify({
        empresaId: e.empresaId,
        payload: {
          via: e.via === 'OCR' ? 'OCR' : 'MANUAL',
          clienteId: e.clienteId,
          comercialId: e.comercialId,
          ciudad: e.ciudad,
          direccionId: e.direccionId,
          notas: e.notas,
          ocrDocumentId: e.ocrDocId,
          items: e.items,
        },
      });
      if (e.borradorId) {
        const { status } = await api(`/orders/drafts/${e.borradorId}`, {
          method: 'PUT',
          body: cuerpo,
        });
        if (status === 200) {
          setGuardadoAt(new Date());
        } else if (status === 404) {
          // El borrador fue descartado en otra pestaña: se crea de nuevo
          const { status: s2, body: b2 } = await api<{ id: string }>('/orders/drafts', {
            method: 'POST',
            body: cuerpo,
          });
          if (s2 === 201 && b2?.id) {
            setBorradorId(b2.id);
            estadoRef.current = { ...estadoRef.current, borradorId: b2.id };
            setGuardadoAt(new Date());
          } else {
            setBorradorId(null);
            estadoRef.current = { ...estadoRef.current, borradorId: null };
          }
        }
      } else {
        const { status, body } = await api<{ id: string }>('/orders/drafts', {
          method: 'POST',
          body: cuerpo,
        });
        if (status === 201 && body?.id) {
          setBorradorId(body.id);
          estadoRef.current = { ...estadoRef.current, borradorId: body.id };
          setGuardadoAt(new Date());
        }
      }
    });
    cadenaRef.current = tarea.catch(() => {});
    return tarea;
  }, []);

  // Guardado diferido: 2 segundos después del último cambio
  useEffect(() => {
    if (!tieneContenido()) return;
    const t = setTimeout(() => {
      void guardarBorrador();
    }, 2000);
    return () => clearTimeout(t);
  }, [via, clienteId, comercialId, ciudad, direccionId, notas, ocrDocId, items, empresaId, guardarBorrador]);

  // Al cambiar de aplicación o cerrar la pestaña, guardar de inmediato
  useEffect(() => {
    const alOcultar = () => {
      if (document.visibilityState === 'hidden') void guardarBorrador();
    };
    document.addEventListener('visibilitychange', alOcultar);
    window.addEventListener('pagehide', alOcultar);
    return () => {
      document.removeEventListener('visibilitychange', alOcultar);
      window.removeEventListener('pagehide', alOcultar);
    };
  }, [guardarBorrador]);

  // I18: filtro del selector por nombre o identificación
  const termino = busquedaCliente.trim().toLowerCase();
  const clientesFiltrados = termino
    ? clientes.filter(
        (c) =>
          c.nombre.toLowerCase().includes(termino) ||
          (c.identificacion ?? '').toLowerCase().includes(termino),
      )
    : clientes;

  // I29: un solo resultado queda seleccionado de inmediato — antes el select
  // conservaba el cliente precargado y el usuario no podía "escoger" el
  // único que mostraba la búsqueda.
  useEffect(() => {
    if (clientesFiltrados.length === 1 && clientesFiltrados[0].id !== clienteId) {
      setClienteId(clientesFiltrados[0].id);
    }
  }, [termino, clientes.length]);

  function totalPie(): number {
    return items.reduce((acc, i) => {
      const cant = Number(i.cantidad) || 0;
      const valor = Number(i.valorUnidad) || 0;
      return acc + cant * valor;
    }, 0);
  }

  function unidadesCargadas(): number {
    return items
      .filter((i) => i.referencia.trim())
      .reduce((acc, i) => acc + (Number(i.cantidad) || 0), 0);
  }

  function setItem(idx: number, campo: keyof ItemForm, valor: string) {
    const copia = [...items];
    copia[idx] = { ...copia[idx], [campo]: valor };
    // Autocompletar marca/descripción/valor al digitar una referencia conocida
    if (campo === 'referencia') {
      const encontrado = productos.find(
        (p) => p.codigo.toLowerCase() === valor.trim().toLowerCase(),
      );
      if (encontrado) {
        copia[idx].descripcion = encontrado.descripcion;
        copia[idx].marca = encontrado.marca ?? '';
        if (!copia[idx].valorUnidad) {
          copia[idx].valorUnidad = String(Number(encontrado.precio) || '');
        }
      }
    }
    setItems(copia);
  }

  /**
   * I68: Enter en la casilla de cantidades — si es la última fila agrega una
   * fila nueva para el siguiente producto; el foco queda en la casilla de
   * referencia de esa fila (si no es la última, baja a la siguiente).
   */
  function enterEnCantidad(idx: number) {
    const destino = idx + 1;
    if (idx === items.length - 1) {
      setItems([...items, { ...ITEM_VACIO }]);
    }
    // La fila nueva aún no existe en este render: enfocar tras el repintado
    requestAnimationFrame(() => refsReferencia.current[destino]?.focus());
  }

  /** QA Func. 3.3: subir a OCR y prellenar el panel con la extracción. */
  async function procesarOcr() {
    if (!archivoOcr) return;
    setCargando(true);
    setError('');
    setMensaje('');
    try {
      const fd = new FormData();
      fd.append('tipoDocumento', 'ORDEN_PEDIDO');
      fd.append('empresaId', empresaId);
      fd.append('file', archivoOcr);
      const s = obtenerSesion();
      const res = await fetch(`${API_BASE}/ocr/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s?.token}` },
        body: fd,
      });
      const doc = await res.json();
      if (res.status !== 201) throw new Error(mensajeError(doc, 'Falló el procesamiento OCR'));
      setOcrDocId(doc.id);
      const d = doc.datosExtraidos ?? {};
      // Prellenar encabezado y tabla con lo extraído (editable)
      if (d.cliente) {
        const encontrado = clientes.find((c) =>
          c.nombre.toLowerCase().includes(String(d.cliente).toLowerCase().slice(0, 12)),
        );
        if (encontrado) setClienteId(encontrado.id);
      }
      if (Array.isArray(d.items) && d.items.length) {
        setItems(
          d.items.map((i: any) => ({
            referencia: String(i.referencia ?? ''),
            marca: '',
            descripcion: i.descripcion ?? '',
            cantidad: String(i.cantidad ?? 1),
            valorUnidad: i.valorUnitario != null ? String(i.valorUnitario) : '',
          })),
        );
      }
      setMensaje(
        'Documento procesado. Revise y corrija los datos abajo; el pedido se crea al confirmar.',
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  function cancelarOcr() {
    // Descartar la extracción: no se crea ningún pedido a medias
    setOcrDocId(null);
    setItems([{ ...ITEM_VACIO }]);
    setArchivoOcr(null);
    setMensaje('');
  }

  /** I39: solo la llamada explícita del botón crea el pedido (sin evento de formulario). */
  async function crear() {
    setCargando(true);
    setError('');
    try {
      if (via === 'EXCEL') {
        if (!archivoExcel) throw new Error('Seleccione el archivo Excel');
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
        if (res.status !== 201) throw new Error(mensajeError(body, 'Error al crear desde Excel'));
        // I67: el borrador de la sesión ya no hace falta — el pedido nació
        confirmandoRef.current = true;
        if (estadoRef.current.borradorId) {
          void api(`/orders/drafts/${estadoRef.current.borradorId}`, { method: 'DELETE' });
        }
        onCreado(body.id, body.numero, 'Excel');
        return;
      }

      if (!clienteId) throw new Error('Seleccione el cliente');
      const itemsLimpios = items
        .filter((i) => i.referencia.trim())
        .map((i) => ({
          referencia: i.referencia.trim(),
          cantidad: Number(i.cantidad) || 0,
          valorUnidad: i.valorUnidad !== '' ? Number(i.valorUnidad) : undefined,
        }));
      if (via === 'MANUAL' && !itemsLimpios.length) {
        throw new Error('Agregue al menos un producto');
      }
      if (via === 'OCR' && !ocrDocId) {
        throw new Error('Procese primero el documento con OCR');
      }

      // I67: si hay borrador (casi siempre, por el guardado automático), el
      // pedido nace de él — el servidor le asigna el consecutivo AHORA y
      // elimina el borrador. Primero se deja el borrador con lo último.
      if (estadoRef.current.borradorId) {
        confirmandoRef.current = true;
        try {
          await guardarBorrador();
          const { status, body } = await api<{ id: string; numero: string }>(
            `/orders/drafts/${estadoRef.current.borradorId}/confirmar`,
            { method: 'POST' },
          );
          if (status !== 201 && status !== 200) {
            throw new Error(mensajeError(body, 'Error al crear el pedido'));
          }
          onCreado(body.id, body.numero, via === 'OCR' ? 'OCR' : 'manual');
          return;
        } finally {
          confirmandoRef.current = false;
        }
      }

      const payload: Record<string, unknown> = {
        empresaId,
        clienteId,
        ciudad: ciudad || undefined,
        notas: notas || undefined,
      };
      if (direccionId) payload.direccionId = direccionId;
      if (rol !== 'COMERCIAL') payload.comercialId = comercialId;
      if (via === 'OCR') {
        payload.ocrDocumentId = ocrDocId;
        // Los ítems revisados por el humano tienen prioridad sobre la extracción cruda
        if (itemsLimpios.length) payload.items = itemsLimpios;
      } else {
        payload.items = itemsLimpios;
      }

      const { status, body } = await api<{ id: string; numero: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (status !== 201) throw new Error(mensajeError(body, 'Error al crear el pedido'));
      onCreado(body.id, body.numero, via === 'OCR' ? 'OCR' : 'manual');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    // I39: onSubmit solo previene el envío implícito — Enter nunca crea el
    // pedido; la creación queda exclusiva del botón "Crear pedido".
    <form onSubmit={(e) => e.preventDefault()}>
      <MarcoDocumento
        titulo="Crear Orden de Pedido"
        acciones={
          <>
            {(['MANUAL', 'OCR', 'EXCEL'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setVia(v); setError(''); }}
                className={`rounded px-3 py-1 ${via === v ? 'bg-white text-sofia-900' : 'bg-sofia-700 hover:bg-sofia-600'}`}
              >
                {v === 'MANUAL' ? 'Manual' : v === 'OCR' ? 'Cargar por OCR' : 'Cargar por Excel'}
              </button>
            ))}
            <button type="button" onClick={onCancelar} className="rounded bg-white px-3 py-1 text-sofia-900 hover:bg-slate-100">
              ✕ Cerrar
            </button>
          </>
        }
      >
        {mensaje && <p className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <TarjetaEmisor
          numero="Nueva"
          estado="DIGITACION"
          empresa={
            // I65d: botón bien visible con la empresa del pedido; al hacer
            // clic se despliega la visual de botones para cambiarla.
            <div>
              <button
                type="button"
                onClick={() => setMostrarEmpresas((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border-2 border-sofia-700 bg-sofia-50 px-4 py-2.5 text-left shadow-sm hover:bg-sofia-100"
              >
                <span>
                  <span className="block text-sm font-bold text-sofia-900">
                    {empresaActual?.nombre ?? 'Seleccione la empresa del pedido'}
                  </span>
                  {empresaActual?.identificacion && (
                    <span className="text-xs text-slate-500">NIT: {empresaActual.identificacion}</span>
                  )}
                </span>
                <span className="shrink-0 rounded bg-sofia-700 px-2.5 py-1 text-xs font-semibold text-white">
                  {mostrarEmpresas ? 'Cerrar ▲' : 'Cambiar empresa ▼'}
                </span>
              </button>
              {mostrarEmpresas && (
                <div className="mt-2 grid gap-2 rounded-lg border-2 border-sofia-200 bg-white p-3 sm:grid-cols-2">
                  {empresas.map((e) => {
                    const activa = e.id === empresaId;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => elegirEmpresa(e.id)}
                        className={`rounded-lg border-2 px-3 py-2 text-left text-sm transition-colors ${
                          activa
                            ? 'border-sofia-700 bg-sofia-700 font-semibold text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-sofia-400 hover:bg-sofia-50'
                        }`}
                      >
                        <span className="block font-semibold">{e.nombre}</span>
                        {e.identificacion && (
                          <span className={`text-xs ${activa ? 'text-sofia-100' : 'text-slate-400'}`}>
                            NIT: {e.identificacion}
                          </span>
                        )}
                        {activa && <span className="mt-0.5 block text-xs">✓ Empresa del pedido</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          }
        />

        {/* Vía OCR: subir y revisar antes de crear */}
        {via === 'OCR' && !ocrDocId && (
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded border border-dashed border-sofia-300 bg-sofia-50 p-4">
            <label className="text-sm">
              Documento (PDF o imagen de la orden)
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp"
                onChange={(e) => setArchivoOcr(e.target.files?.[0] ?? null)}
                className="mt-1 block text-sm"
              />
            </label>
            <button
              type="button"
              onClick={procesarOcr}
              disabled={!archivoOcr || cargando}
              className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
            >
              {cargando ? 'Procesando…' : 'Procesar y revisar'}
            </button>
          </div>
        )}
        {via === 'OCR' && ocrDocId && (
          <div className="mb-4 flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <span>Extracción cargada abajo. Corrija lo necesario y confirme para crear el pedido.</span>
            <button type="button" onClick={cancelarOcr} className="rounded bg-white px-3 py-1 text-slate-600 shadow-sm">
              Descartar extracción
            </button>
          </div>
        )}

        {via === 'EXCEL' && (
          <div className="mb-4 rounded border border-dashed border-sofia-300 bg-sofia-50 p-4">
            <label className="text-sm">
              Archivo Excel de la orden
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setArchivoExcel(e.target.files?.[0] ?? null)}
                className="mt-1 block text-sm"
              />
            </label>
          </div>
        )}

        {/* Encabezado del documento */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-6">
          <label className={docCampo}>
            Fecha:
            <input value={new Date().toLocaleDateString('es-CO')} disabled className={docInputDisabled} />
          </label>
          <label className={`${docCampo} sm:col-span-2`}>
            Ciudad:
            <input value={ciudad} onChange={(e) => setCiudad(e.target.value)} className={docInput} />
          </label>
          <label className={`${docCampo} sm:col-span-3`}>
            Vendedor:
            {rol === 'COMERCIAL' ? (
              <input value="Automático (su usuario)" disabled className={docInputDisabled} />
            ) : (
              <select value={comercialId} onChange={(e) => setComercialId(e.target.value)} className={docInput}>
                {comerciales.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            )}
          </label>
          <div className={`${docCampo} col-span-2 sm:col-span-4`}>
            Cliente: *
            <input
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              placeholder="Buscar por nombre o identificación"
              className={`${docInput} mt-1 text-[13px]`}
            />
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}
              className={docInput} required>
              {clientesFiltrados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}{c.identificacion ? ` — ${c.identificacion}` : ''}
                </option>
              ))}
            </select>
            {termino && (
              <p className="mt-0.5 text-xs font-normal normal-case text-slate-500">
                {clientesFiltrados.length} resultado(s)
              </p>
            )}
          </div>
          <label className={`${docCampo} sm:col-span-2`}>
            Nit:
            <input value={cliente?.identificacion ?? ''} disabled className={docInputDisabled} />
          </label>
          <label className={`${docCampo} col-span-2 sm:col-span-4`}>
            Dirección:
            {direcciones.length > 1 ? (
              <select value={direccionId} onChange={(e) => setDireccionId(e.target.value)} className={docInput}>
                {direcciones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.direccion}{d.ciudad ? ` — ${d.ciudad}` : ''}{d.esPrincipal ? ' (principal)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={direcciones[0]?.direccion ?? cliente?.direccion ?? ''}
                disabled
                className={docInputDisabled}
              />
            )}
          </label>
          <label className={`${docCampo} sm:col-span-2`}>
            Teléfono:
            <input value={cliente?.telefonos ?? ''} disabled className={docInputDisabled} />
          </label>
        </div>

        {/* Tabla de ítems */}
        {via !== 'EXCEL' && (
          <>
            <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <EncabezadoTablaDoc
                columnas={['#', 'Referencia', 'Marca', 'Descripción', 'Cant.', 'Vr. Unit', 'Vr. Total', '']}
              />
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <input value={item.referencia} onChange={(e) => setItem(idx, 'referencia', e.target.value)}
                        ref={(el) => { refsReferencia.current[idx] = el; }}
                        list="productos-ref" className="w-full rounded border px-2 py-1" placeholder="Ingresar ref..." />
                    </td>
                    <td className="px-1 py-1">
                      <input value={item.marca} onChange={(e) => setItem(idx, 'marca', e.target.value)}
                        className="w-full rounded border px-2 py-1" placeholder="Marca" />
                    </td>
                    <td className="px-1 py-1">
                      <input value={item.descripcion} onChange={(e) => setItem(idx, 'descripcion', e.target.value)}
                        className="w-full rounded border px-2 py-1" placeholder="Descripción del repuesto" />
                    </td>
                    <td className="w-20 px-1 py-1">
                      <input type="number" min={1} value={item.cantidad} onChange={(e) => setItem(idx, 'cantidad', e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enterEnCantidad(idx); } }}
                        title="Enter: agregar otra fila de producto"
                        className="w-full rounded border px-2 py-1" />
                    </td>
                    <td className="w-28 px-1 py-1">
                      <input type="number" min={0} step="0.01" value={item.valorUnidad} onChange={(e) => setItem(idx, 'valorUnidad', e.target.value)}
                        className="w-full rounded border px-2 py-1" placeholder="$ 0" />
                    </td>
                    <td className="w-28 px-2 py-1 text-right font-medium">
                      $ {((Number(item.cantidad) || 0) * (Number(item.valorUnidad) || 0)).toLocaleString('es-CO')}
                    </td>
                    <td className="w-12 px-1 py-1 text-center">
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          title="Quitar ítem"
                          className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <datalist id="productos-ref">
              {productos.map((p) => (
                <option key={p.id} value={p.codigo}>
                  {p.descripcion}{p.cantidad !== undefined ? ` — disp. ${p.cantidad}` : ''}
                </option>
              ))}
            </datalist>
            {/* I26: la lista solo trae productos con existencias */}
            {productos.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">
                No hay productos con existencias en esta empresa; registre ingresos primero.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setItems([...items, { ...ITEM_VACIO }])}
                className="text-sm font-medium text-sofia-700 hover:underline">
                + Agregar ítem a la orden
              </button>
              <ConteoItems
                productos={items.filter((i) => i.referencia.trim()).length}
                unidades={unidadesCargadas()}
              />
            </div>
          </>
        )}

        {/* Pie del documento */}
        <div className="mt-4 flex flex-wrap items-stretch justify-between gap-3">
          <label className={`${docCampo} min-w-72 flex-1`}>
            <span className="flex items-center justify-between">
              Observaciones / Notas
              <span className="text-xs font-normal normal-case text-slate-400">Instrucciones operativas</span>
            </span>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3}
              className={`${docInput} mt-1`} />
          </label>
          <TotalDocumento valor={totalPie()} />
        </div>

        {/* I39: el pedido solo se crea con este botón. I67: el borrador se
            guarda SOLO (sin número de pedido) ante cada cambio. */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-4">
          {guardadoAt && (
            <span className="text-xs text-slate-400" title="El contenido se guarda automáticamente como borrador; si se cierra la aplicación se recupera al volver a entrar">
              ✓ Borrador guardado a las{' '}
              {guardadoAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={crear}
            disabled={cargando}
            className="rounded bg-sofia-900 px-8 py-2.5 font-medium text-white hover:bg-sofia-700 disabled:opacity-50"
          >
            {cargando ? 'Creando…' : via === 'OCR' ? 'Confirmar y crear pedido' : 'Crear pedido'}
          </button>
        </div>
      </MarcoDocumento>
    </form>
  );
}
