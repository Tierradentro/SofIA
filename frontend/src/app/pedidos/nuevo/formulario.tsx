'use client';

import { useEffect, useState } from 'react';
import { api, obtenerSesion, mensajeError } from '@/lib/api';

/**
 * QA Func. 3.2 + 3.3: creación de pedido en formato "Orden de Pedido" papel.
 * Tres bloques: Encabezado (cliente autocompleta NIT/Dirección/Teléfono),
 * Tabla de ítems (Referencia, Marca, Descripción, Cantidad, Valor Unitario,
 * Valor Total) y Pie (Total automático + Observaciones).
 * Vías de captura unificadas: manual, OCR (con revisión previa a crear) y
 * Excel. La vía OCR prellena este mismo panel con la extracción editable y
 * solo crea el pedido cuando el humano confirma.
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

interface ProductoLite {
  id: string;
  codigo: string;
  descripcion: string;
  marca?: string | null;
  precio: string | number;
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
  onCambiarEmpresa,
  onCreado,
  onCancelar,
}: {
  empresaId: string;
  empresas: { id: string; nombre: string }[];
  clientes: Cliente[];
  comerciales: Comercial[];
  productos: ProductoLite[];
  rol: string;
  onCambiarEmpresa: (id: string) => void;
  onCreado: (id: string, numero: string, origen: string) => void;
  onCancelar: () => void;
}) {
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? '');
  // QA Func. 4.1: dirección a la que va el despacho (se escoge en el Pedido)
  const [direcciones, setDirecciones] = useState<DireccionCliente[]>([]);
  const [direccionId, setDireccionId] = useState('');
  const [comercialId, setComercialId] = useState(comerciales[0]?.id ?? '');
  const [ciudad, setCiudad] = useState('');
  // I18: búsqueda del cliente por nombre o identificación (lista completa)
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [notas, setNotas] = useState('');
  const [items, setItems] = useState<ItemForm[]>([{ ...ITEM_VACIO }]);
  const [via, setVia] = useState<'MANUAL' | 'OCR' | 'EXCEL'>('MANUAL');
  const [archivoOcr, setArchivoOcr] = useState<File | null>(null);
  const [archivoExcel, setArchivoExcel] = useState<File | null>(null);
  // QA Func. 3.3: documento OCR pendiente de revisión (aún no se crea pedido)
  const [ocrDocId, setOcrDocId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cliente = clientes.find((c) => c.id === clienteId) ?? null;

  // QA Func. 4.1: cargar las direcciones del cliente y preseleccionar la principal
  useEffect(() => {
    setDireccionId('');
    setDirecciones([]);
    if (!clienteId) return;
    // I18: la ciudad arranca con la que trae el cliente
    setCiudad(clientes.find((c) => c.id === clienteId)?.ciudad ?? '');
    api<DireccionCliente[]>(`/clients/${clienteId}/direcciones`).then(({ status, body }) => {
      if (status === 200) {
        setDirecciones(body);
        const principal = body.find((d) => d.esPrincipal) ?? body[0];
        if (principal) setDireccionId(principal.id);
      }
    });
  }, [clienteId]);

  // I18: al elegir otra dirección (cliente con varias), su ciudad prevalece
  useEffect(() => {
    const d = direcciones.find((x) => x.id === direccionId);
    if (d?.ciudad) setCiudad(d.ciudad);
  }, [direccionId, direcciones]);

  // I18: filtro del selector por nombre o identificación
  const termino = busquedaCliente.trim().toLowerCase();
  const clientesFiltrados = termino
    ? clientes.filter(
        (c) =>
          c.nombre.toLowerCase().includes(termino) ||
          (c.identificacion ?? '').toLowerCase().includes(termino),
      )
    : clientes;

  function totalPie(): number {
    return items.reduce((acc, i) => {
      const cant = Number(i.cantidad) || 0;
      const valor = Number(i.valorUnidad) || 0;
      return acc + cant * valor;
    }, 0);
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

  async function crear(e: React.FormEvent) {
    e.preventDefault();
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
    <form onSubmit={crear} className="mb-6 max-w-5xl rounded-lg bg-white shadow">
      <div className="flex items-center justify-between border-b bg-sofia-900 px-5 py-3 text-white">
        <h2 className="font-semibold">Orden de pedido</h2>
        <div className="flex gap-2 text-sm">
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
          <button type="button" onClick={onCancelar} className="rounded bg-sofia-700 px-3 py-1 hover:bg-sofia-600">
            Cerrar
          </button>
        </div>
      </div>

      <div className="p-5">
        {mensaje && <p className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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

        {/* Encabezado */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            Empresa *
            <select value={empresaId} onChange={(e) => onCambiarEmpresa(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1.5" required>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Fecha
            <input value={new Date().toLocaleDateString('es-CO')} disabled
              className="mt-1 block w-full rounded border bg-slate-50 px-2 py-1.5" />
          </label>
          <label className="text-sm">
            Ciudad
            <input value={ciudad} onChange={(e) => setCiudad(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1.5" />
          </label>
          <div className="text-sm sm:col-span-2">
            Cliente *
            <input
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              placeholder="Buscar por nombre o identificación"
              className="mt-1 block w-full rounded border px-2 py-1 text-[13px]"
            />
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1.5" required>
              {clientesFiltrados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}{c.identificacion ? ` — ${c.identificacion}` : ''}
                </option>
              ))}
            </select>
            {termino && (
              <p className="mt-0.5 text-xs text-slate-500">
                {clientesFiltrados.length} resultado(s)
              </p>
            )}
          </div>
          <label className="text-sm">
            NIT
            <input value={cliente?.identificacion ?? ''} disabled
              className="mt-1 block w-full rounded border bg-slate-50 px-2 py-1.5" />
          </label>
          <label className="text-sm sm:col-span-2">
            Dirección de despacho
            {direcciones.length > 1 ? (
              <select value={direccionId} onChange={(e) => setDireccionId(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1.5">
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
                className="mt-1 block w-full rounded border bg-slate-50 px-2 py-1.5" />
            )}
          </label>
          <label className="text-sm">
            Teléfono
            <input value={cliente?.telefonos ?? ''} disabled
              className="mt-1 block w-full rounded border bg-slate-50 px-2 py-1.5" />
          </label>
          <label className="text-sm">
            Vendedor / Comercial
            {rol === 'COMERCIAL' ? (
              <input value="Automático (su usuario)" disabled
                className="mt-1 block w-full rounded border bg-slate-50 px-2 py-1.5" />
            ) : (
              <select value={comercialId} onChange={(e) => setComercialId(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1.5">
                {comerciales.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            )}
          </label>
        </div>

        {/* Tabla de ítems */}
        {via !== 'EXCEL' && (
          <>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-400">
                  <th className="py-1">Referencia</th>
                  <th>Marca</th>
                  <th>Descripción</th>
                  <th className="w-20">Cantidad</th>
                  <th className="w-28">Valor unitario</th>
                  <th className="w-28 text-right">Valor total</th>
                  <th className="w-14"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-1 pr-2">
                      <input value={item.referencia} onChange={(e) => setItem(idx, 'referencia', e.target.value)}
                        list="productos-ref" className="w-full rounded border px-2 py-1" placeholder="Código / OE / ref." />
                    </td>
                    <td className="pr-2">
                      <input value={item.marca} onChange={(e) => setItem(idx, 'marca', e.target.value)}
                        className="w-full rounded border px-2 py-1" />
                    </td>
                    <td className="pr-2">
                      <input value={item.descripcion} onChange={(e) => setItem(idx, 'descripcion', e.target.value)}
                        className="w-full rounded border px-2 py-1" />
                    </td>
                    <td>
                      <input type="number" min={1} value={item.cantidad} onChange={(e) => setItem(idx, 'cantidad', e.target.value)}
                        className="w-full rounded border px-2 py-1" />
                    </td>
                    <td>
                      <input type="number" min={0} step="0.01" value={item.valorUnidad} onChange={(e) => setItem(idx, 'valorUnidad', e.target.value)}
                        className="w-full rounded border px-2 py-1" />
                    </td>
                    <td className="text-right font-medium">
                      {((Number(item.cantidad) || 0) * (Number(item.valorUnidad) || 0)).toLocaleString('es-CO')}
                    </td>
                    <td>
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          className="text-red-700 hover:underline">
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="productos-ref">
              {productos.map((p) => (
                <option key={p.id} value={p.codigo}>{p.descripcion}</option>
              ))}
            </datalist>
            <button type="button" onClick={() => setItems([...items, { ...ITEM_VACIO }])}
              className="mt-2 text-sm text-sofia-700 hover:underline">
              + Agregar producto
            </button>
          </>
        )}

        {/* Pie */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t pt-4">
          <label className="min-w-72 flex-1 text-sm">
            Observaciones / Notas
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
              className="mt-1 block w-full rounded border px-2 py-1.5" />
          </label>
          <div className="text-right">
            <p className="text-xs uppercase text-slate-400">Total</p>
            <p className="text-2xl font-bold text-sofia-900">
              $ {totalPie().toLocaleString('es-CO')}
            </p>
          </div>
        </div>

        <button
          disabled={cargando}
          className="mt-4 w-full rounded bg-sofia-600 py-2.5 font-medium text-white hover:bg-sofia-700 disabled:opacity-50"
        >
          {cargando ? 'Creando…' : via === 'OCR' ? 'Confirmar y crear pedido' : 'Crear pedido'}
        </button>
      </div>
    </form>
  );
}
