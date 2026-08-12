'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
}

interface OcrItem {
  referencia: string;
  descripcion: string | null;
  cantidad: number;
  unidad: string;
  valorUnitario?: number | null;
  valorTotal?: number | null;
}

interface DatosExtraidos {
  numeroFactura: string | null;
  fecha: string | null;
  proveedor: string | null;
  cliente: string | null;
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
  numeroGuia: string | null;
  transportadora: string | null;
  total?: number | null;
  observaciones?: string | null;
  items: OcrItem[];
}

interface OcrDoc {
  id: string;
  tipoDocumento: string;
  motor: string;
  estado: 'CREADO' | 'CONFIRMADO';
  confianza: number | null;
  datosExtraidos: DatosExtraidos;
  createdAt: string;
  document?: { nombreOriginal: string };
}

const TIPOS = [
  'FACTURA_IMPORTACION',
  'ORDEN_PEDIDO',
  'COTIZACION',
  'FACTURA_VENTA',
  'GUIA_TRANSPORTE',
] as const;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/** QA Func. 2.5: esquema de campos variable por tipo de documento. */
const ETIQUETAS: Record<string, string> = {
  numeroFactura: 'N° Factura / Documento',
  fecha: 'Fecha',
  proveedor: 'Proveedor',
  cliente: 'Cliente',
  nit: 'NIT / Identificación',
  telefono: 'Teléfono',
  direccion: 'Dirección',
  numeroGuia: 'N° Guía',
  transportadora: 'Transportadora',
  total: 'Total',
  observaciones: 'Observaciones',
};

const CAMPOS_POR_TIPO: Record<string, string[]> = {
  FACTURA_IMPORTACION: ['numeroFactura', 'fecha', 'proveedor', 'numeroGuia', 'transportadora', 'direccion'],
  ORDEN_PEDIDO: ['numeroFactura', 'fecha', 'cliente', 'nit', 'direccion', 'telefono'],
  COTIZACION: ['numeroFactura', 'fecha', 'cliente', 'nit', 'direccion', 'telefono'],
  FACTURA_VENTA: ['numeroFactura', 'fecha', 'cliente', 'nit', 'direccion', 'telefono', 'total', 'observaciones'],
  GUIA_TRANSPORTE: ['numeroGuia', 'fecha', 'transportadora', 'cliente', 'direccion'],
};

/** Tipos cuyos ítems llevan valor unitario/total. */
const TIPOS_CON_VALOR = ['ORDEN_PEDIDO', 'COTIZACION', 'FACTURA_VENTA'];

const CAMPOS_CABECERA: { clave: keyof Omit<DatosExtraidos, 'items'>; etiqueta: string }[] = [
  { clave: 'numeroFactura', etiqueta: 'N° Factura / Documento' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'nit', etiqueta: 'NIT / Identificación' },
  { clave: 'telefono', etiqueta: 'Teléfono' },
  { clave: 'direccion', etiqueta: 'Dirección' },
  { clave: 'numeroGuia', etiqueta: 'N° Guía' },
  { clave: 'transportadora', etiqueta: 'Transportadora' },
];

/**
 * HU-021 / CU-009: procesamiento OCR de documentos.
 * Flujo: cargar documento → datos extraídos en vista editable → corregir
 * manualmente si aplica → confirmar. Temporales eliminables tras confirmar.
 */
export default function OcrPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>('FACTURA_IMPORTACION');
  const [empresaId, setEmpresaId] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [doc, setDoc] = useState<OcrDoc | null>(null);
  const [datos, setDatos] = useState<DatosExtraidos | null>(null);
  const [historial, setHistorial] = useState<OcrDoc[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (!['GENERADOR', 'ADMINISTRADOR'].includes(s.usuario.rol)) {
      return router.replace('/dashboard');
    }
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) {
        setEmpresas(body);
        if (body.length > 0) setEmpresaId(body[0].id);
      }
    });
    cargarHistorial();
  }, [router]);

  async function cargarHistorial() {
    const { status, body } = await api<OcrDoc[]>('/ocr/documents');
    if (status === 200) setHistorial(body);
  }

  async function procesar() {
    if (!archivo) return;
    setCargando(true);
    setError('');
    setMensaje('');
    const fd = new FormData();
    fd.append('tipoDocumento', tipo);
    if (empresaId) fd.append('empresaId', empresaId);
    fd.append('file', archivo);
    const s = obtenerSesion();
    const res = await fetch(`${API_BASE}/ocr/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s?.token}` },
      body: fd,
    });
    const body = await res.json();
    setCargando(false);
    if (res.status === 201) {
      setDoc(body);
      setDatos(body.datosExtraidos);
      setMensaje(
        `Procesado con ${body.motor}. Revise y corrija los datos antes de confirmar.`,
      );
      cargarHistorial();
    } else {
      setError(mensajeError(body, 'No se pudo procesar el documento'));
      setDoc(null);
      setDatos(null);
    }
  }

  async function abrir(id: string) {
    const { status, body } = await api<OcrDoc>(`/ocr/documents/${id}`);
    if (status === 200) {
      setDoc(body);
      setDatos(body.datosExtraidos);
      setMensaje('');
      setError('');
    }
  }

  async function guardarCorreccion() {
    if (!doc || !datos) return;
    setCargando(true);
    setError('');
    const { status, body } = await api<OcrDoc>(`/ocr/documents/${doc.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ datosExtraidos: datos }),
    });
    setCargando(false);
    if (status === 200) {
      setDoc(body);
      setMensaje('Correcciones guardadas.');
    } else {
      setError(mensajeError(body, 'No se pudo guardar'));
    }
  }

  async function confirmar() {
    if (!doc) return;
    setCargando(true);
    setError('');
    const { status, body } = await api<OcrDoc>(`/ocr/documents/${doc.id}/confirm`, {
      method: 'POST',
    });
    setCargando(false);
    if (status === 200 || status === 201) {
      setDoc(body);
      setMensaje('Documento confirmado.');
      cargarHistorial();
    } else {
      setError(mensajeError(body, 'No se pudo confirmar'));
    }
  }

  async function eliminar(id: string) {
    setError('');
    const { status, body } = await api(`/ocr/documents/${id}`, { method: 'DELETE' });
    if (status === 200) {
      setMensaje('Documento temporal eliminado.');
      if (doc?.id === id) {
        setDoc(null);
        setDatos(null);
      }
      cargarHistorial();
    } else {
      setError(mensajeError(body, 'No se pudo eliminar'));
    }
  }

  function setCampo(clave: keyof Omit<DatosExtraidos, 'items'>, valor: string) {
    if (datos) setDatos({ ...datos, [clave]: valor || null });
  }

  function setItem(idx: number, campo: keyof OcrItem, valor: string) {
    if (!datos) return;
    const items = [...datos.items];
    const numericos: (keyof OcrItem)[] = ['cantidad', 'valorUnitario', 'valorTotal'];
    items[idx] = {
      ...items[idx],
      [campo]: numericos.includes(campo)
        ? valor === ''
          ? null
          : Number(valor) || 0
        : valor,
    };
    setDatos({ ...datos, items });
  }

  if (!sesion) return null;
  const editable = doc?.estado === 'CREADO';
  // Campos visibles según el tipo del documento abierto (o el seleccionado)
  const tipoActivo = doc?.tipoDocumento ?? tipo;
  const camposVisibles = (CAMPOS_POR_TIPO[tipoActivo] ?? CAMPOS_CABECERA.map((c) => c.clave)) as string[];
  const conValor = TIPOS_CON_VALOR.includes(tipoActivo);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-sofia-900">Procesamiento OCR de documentos</h1>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded bg-white px-3 py-1 text-sm shadow hover:bg-slate-50"
          >
            ← Volver
          </button>
        </div>

        {mensaje && (
          <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{mensaje}</p>
        )}
        {error && (
          <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>
        )}

        {/* Carga */}
        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold">1. Cargar documento</h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              Tipo de documento
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as (typeof TIPOS)[number])}
                className="mt-1 block rounded border px-2 py-1.5"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Empresa
              <select
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                className="mt-1 block rounded border px-2 py-1.5"
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.siglas} — {e.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Archivo (PDF o imagen)
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp"
                onChange={(e) => e.target.files?.[0] && setArchivo(e.target.files[0])}
                className="mt-1 block text-sm"
              />
            </label>
            <button
              onClick={procesar}
              disabled={!archivo || cargando}
              className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
            >
              {cargando ? 'Procesando…' : 'Procesar con OCR'}
            </button>
          </div>
        </section>

        {/* Vista editable */}
        {doc && datos && (
          <section className="mb-4 rounded-lg bg-white p-5 shadow">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">
                2. Datos extraídos {editable ? '(editable)' : '(confirmados)'}
              </h2>
              <div className="text-sm text-slate-500">
                Motor: <strong>{doc.motor}</strong>
                {doc.confianza !== null && (
                  <>
                    {' '}· Confianza:{' '}
                    <strong className={doc.confianza < 0.6 ? 'text-amber-700' : ''}>
                      {(doc.confianza * 100).toFixed(0)}%
                    </strong>
                    {doc.confianza < 0.6 && ' (baja: revise con cuidado)'}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {CAMPOS_CABECERA.filter((c) => camposVisibles.includes(c.clave)).map(({ clave, etiqueta }) => (
                <label key={clave} className="text-sm">
                  {etiqueta}
                  <input
                    type="text"
                    value={(datos[clave] as string | number | null) ?? ''}
                    onChange={(e) => setCampo(clave, e.target.value)}
                    disabled={!editable}
                    className="mt-1 block w-full rounded border px-2 py-1.5 disabled:bg-slate-50"
                  />
                </label>
              ))}
            </div>

            <h3 className="mb-2 mt-4 text-sm font-semibold">Items</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">Referencia</th>
                  <th>Descripción</th>
                  <th className="w-24">Cantidad</th>
                  <th className="w-24">Unidad</th>
                  {conValor && <th className="w-28">Valor unitario</th>}
                  {conValor && <th className="w-28">Valor total</th>}
                  {editable && <th className="w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {datos.items.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-1">
                      <input
                        type="text"
                        value={item.referencia}
                        onChange={(e) => setItem(idx, 'referencia', e.target.value)}
                        disabled={!editable}
                        className="w-full rounded border px-2 py-1 disabled:bg-slate-50"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={item.descripcion ?? ''}
                        onChange={(e) => setItem(idx, 'descripcion', e.target.value)}
                        disabled={!editable}
                        className="w-full rounded border px-2 py-1 disabled:bg-slate-50"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={item.cantidad}
                        onChange={(e) => setItem(idx, 'cantidad', e.target.value)}
                        disabled={!editable}
                        className="w-full rounded border px-2 py-1 disabled:bg-slate-50"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={item.unidad}
                        onChange={(e) => setItem(idx, 'unidad', e.target.value)}
                        disabled={!editable}
                        className="w-full rounded border px-2 py-1 disabled:bg-slate-50"
                      />
                    </td>
                    {conValor && (
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={item.valorUnitario ?? ''}
                          onChange={(e) => setItem(idx, 'valorUnitario', e.target.value)}
                          disabled={!editable}
                          className="w-full rounded border px-2 py-1 disabled:bg-slate-50"
                        />
                      </td>
                    )}
                    {conValor && (
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={item.valorTotal ?? ''}
                          onChange={(e) => setItem(idx, 'valorTotal', e.target.value)}
                          disabled={!editable}
                          className="w-full rounded border px-2 py-1 disabled:bg-slate-50"
                        />
                      </td>
                    )}
                    {editable && (
                      <td>
                        <button
                          onClick={() =>
                            setDatos({ ...datos, items: datos.items.filter((_, i) => i !== idx) })
                          }
                          className="text-red-700 hover:underline"
                        >
                          Quitar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {editable && (
              <button
                onClick={() =>
                  setDatos({
                    ...datos,
                    items: [...datos.items, { referencia: '', descripcion: '', cantidad: 1, unidad: 'UND' }],
                  })
                }
                className="mt-2 text-sm text-sofia-700 hover:underline"
              >
                + Agregar item
              </button>
            )}

            {editable && (
              <div className="mt-4 flex gap-3">
                <button
                  onClick={guardarCorreccion}
                  disabled={cargando}
                  className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
                >
                  Guardar correcciones
                </button>
                <button
                  onClick={confirmar}
                  disabled={cargando}
                  className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Confirmar datos
                </button>
              </div>
            )}
          </section>
        )}

        {/* Historial */}
        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold">Documentos procesados</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Fecha</th>
                <th>Tipo</th>
                <th>Archivo</th>
                <th>Motor</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="py-1">{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{h.tipoDocumento.replace(/_/g, ' ')}</td>
                  <td>{h.document?.nombreOriginal}</td>
                  <td>{h.motor}</td>
                  <td>
                    <span className={h.estado === 'CONFIRMADO' ? 'text-green-700' : 'text-amber-700'}>
                      {h.estado}
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => abrir(h.id)} className="mr-2 text-sofia-700 hover:underline">
                      Abrir
                    </button>
                    {h.estado === 'CONFIRMADO' &&
                      !['FACTURA_IMPORTACION', 'FACTURA_VENTA'].includes(h.tipoDocumento) && (
                        <button onClick={() => eliminar(h.id)} className="text-red-700 hover:underline">
                          Eliminar
                        </button>
                      )}
                  </td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-2 text-slate-500">
                    Sin documentos procesados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
