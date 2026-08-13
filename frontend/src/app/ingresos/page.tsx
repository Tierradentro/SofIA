'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
}

interface InboundItem {
  id: string;
  referencia: string;
  descripcion: string | null;
  unidad: string;
  cantidadFacturada: number;
  cantidadRecibida: number;
  productId: string | null;
  esNuevo: boolean;
  diferencia: number;
  estado: 'COINCIDE' | 'FALTANTE' | 'SOBRANTE' | 'NUEVO';
}

interface Ingreso {
  id: string;
  empresaId: string;
  numeroFactura: string | null;
  fechaFactura: string | null;
  proveedor: string | null;
  estado: 'CREADO' | 'EN_INGRESO' | 'PENDIENTE_CORRECCION' | 'APROBADO' | 'CANCELADO';
  cajaPrincipal: string | null;
  conteoCerrado: boolean;
  observacionDiferencias: string | null;
  createdAt: string;
  items: InboundItem[];
  resumen: {
    total: number;
    coincidencias: number;
    faltantes: number;
    sobrantes: number;
    nuevos: number;
    conDiferencias: number;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const ESTADOS: Record<Ingreso['estado'], string> = {
  CREADO: 'Creado',
  EN_INGRESO: 'En ingreso',
  PENDIENTE_CORRECCION: 'Pendiente corrección',
  APROBADO: 'Aprobado',
  CANCELADO: 'Cancelado',
};

/**
 * M07/EP-06: ingreso de mercancía.
 * Generador: crea la actividad (factura OCR o manual), corrige, aprueba
 * (observación obligatoria con diferencias o productos nuevos), cancela.
 * Operador: inicia la tarea, registra caja principal y cantidades, cierra conteo.
 */
export default function IngresosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [lista, setLista] = useState<Ingreso[]>([]);
  const [ingreso, setIngreso] = useState<Ingreso | null>(null);

  // Creación
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [facturaArchivo, setFacturaArchivo] = useState<File | null>(null);
  const [numeroFactura, setNumeroFactura] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [itemsNuevos, setItemsNuevos] = useState<
    { referencia: string; descripcion: string; cantidadFacturada: string }[]
  >([{ referencia: '', descripcion: '', cantidadFacturada: '1' }]);

  // Recepción
  const [caja, setCaja] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [observacion, setObservacion] = useState('');

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const rol = sesion?.usuario.rol;
  const esGenerador = rol === 'GENERADOR' || rol === 'ADMINISTRADOR';
  const esOperador = rol === 'OPERADOR' || rol === 'ADMINISTRADOR';

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (!['GENERADOR', 'OPERADOR', 'ADMINISTRADOR'].includes(s.usuario.rol)) {
      return router.replace('/dashboard');
    }
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) {
        setEmpresas(body);
        if (body.length > 0) setEmpresaId(body[0].id);
      }
    });
  }, [router]);

  useEffect(() => {
    if (empresaId) cargarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  async function cargarLista() {
    const { status, body } = await api<Ingreso[]>(`/inbound?empresaId=${empresaId}`);
    if (status === 200) setLista(body);
  }

  async function abrir(id: string) {
    const { status, body } = await api<Ingreso>(`/inbound/${id}`);
    if (status === 200) {
      setIngreso(body);
      setCaja(body.cajaPrincipal ?? '');
      setObservacion(body.observacionDiferencias ?? '');
      const c: Record<string, string> = {};
      for (const it of body.items) c[it.id] = String(it.cantidadRecibida);
      setCantidades(c);
      setMensaje('');
      setError('');
    }
  }

  /** HU-022: crea la actividad; si hay factura, la procesa por OCR primero. */
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError('');
    try {
      let payload: Record<string, unknown>;
      if (facturaArchivo) {
        // Paso 1-2: procesar factura con el motor OCR activo
        const fd = new FormData();
        fd.append('tipoDocumento', 'FACTURA_IMPORTACION');
        fd.append('empresaId', empresaId);
        fd.append('file', facturaArchivo);
        const s = obtenerSesion();
        const resOcr = await fetch(`${API_BASE}/ocr/documents`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${s?.token}` },
          body: fd,
        });
        const ocr = await resOcr.json();
        if (resOcr.status !== 201) throw new Error(ocr.message ?? 'Falló el OCR de la factura');
        payload = { empresaId, ocrDocumentId: ocr.id };
      } else {
        const items = itemsNuevos
          .filter((i) => i.referencia.trim())
          .map((i) => ({
            referencia: i.referencia.trim(),
            descripcion: i.descripcion.trim() || undefined,
            cantidadFacturada: Number(i.cantidadFacturada) || 0,
          }));
        if (!items.length) throw new Error('Agregue al menos un producto');
        payload = {
          empresaId,
          numeroFactura: numeroFactura || undefined,
          proveedor: proveedor || undefined,
          items,
        };
      }
      const { status, body } = await api<Ingreso>('/inbound', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (status !== 201) throw new Error((body as { message?: string }).message ?? 'Error al crear');
      setMensaje(
        facturaArchivo
          ? 'Factura procesada por OCR. Revise la actividad, corrija si es necesario y déjela lista para el Operador.'
          : 'Actividad de ingreso creada en estado Creado.',
      );
      setMostrarCrear(false);
      setFacturaArchivo(null);
      setNumeroFactura('');
      setProveedor('');
      setItemsNuevos([{ referencia: '', descripcion: '', cantidadFacturada: '1' }]);
      cargarLista();
      abrir((body as Ingreso).id);
    } catch (err: any) {
      setError(err.message);
    }
    setCargando(false);
  }

  async function accion(
    fn: () => Promise<{ status: number; body: any }>,
    ok: string,
  ) {
    setCargando(true);
    setError('');
    const { status, body } = await fn();
    setCargando(false);
    if (status === 200 || status === 201) {
      setMensaje(ok);
      if (ingreso) abrir(ingreso.id);
      cargarLista();
    } else {
      setError(mensajeError(body, 'La acción falló'));
    }
  }

  async function guardarCantidades() {
    if (!ingreso) return;
    setCargando(true);
    setError('');
    for (const it of ingreso.items) {
      const { status, body } = await api(
        `/inbound/${ingreso.id}/items/${it.id}/cantidad`,
        { method: 'PUT', body: JSON.stringify({ cantidadRecibida: Number(cantidades[it.id]) || 0 }) },
      );
      if (status !== 200) {
        setError(mensajeError(body, 'Error al registrar cantidad'));
        setCargando(false);
        return;
      }
    }
    setCargando(false);
    setMensaje('Cantidades registradas.');
    abrir(ingreso.id);
  }

  if (!sesion) return null;

  const enRecepcion =
    ingreso && ['EN_INGRESO', 'PENDIENTE_CORRECCION'].includes(ingreso.estado);
  const conNovedad =
    ingreso && (ingreso.resumen.conDiferencias > 0 || ingreso.resumen.nuevos > 0);

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Ingreso de mercancía" />
      <div className="mx-auto max-w-5xl">

        {mensaje && (
          <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{mensaje}</p>
        )}
        {error && (
          <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>
        )}

        {/* Lista de actividades */}
        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Actividades de ingreso</h2>
              <select
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                className="rounded border px-2 py-1 text-sm"
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.siglas} — {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            {esGenerador && (
              <button
                onClick={() => setMostrarCrear(!mostrarCrear)}
                className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700"
              >
                {mostrarCrear ? 'Cancelar' : '+ Nueva actividad'}
              </button>
            )}
          </div>

          {mostrarCrear && (
            <form onSubmit={crear} className="mb-4 rounded bg-slate-50 p-4">
              <p className="mb-2 text-sm font-medium">Cargar factura de importación</p>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  Factura (PDF o imagen, se procesa por OCR)
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp"
                    onChange={(e) => {
                      setFacturaArchivo(e.target.files?.[0] ?? null);
                    }}
                    className="mt-1 block text-sm"
                  />
                </label>
              </div>
              {!facturaArchivo && (
                <>
                  <p className="mb-2 text-sm font-medium">…o registrar manualmente</p>
                  <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="N° factura / invoice"
                      value={numeroFactura}
                      onChange={(e) => setNumeroFactura(e.target.value)}
                      className="rounded border px-2 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Proveedor"
                      value={proveedor}
                      onChange={(e) => setProveedor(e.target.value)}
                      className="rounded border px-2 py-1.5 text-sm"
                    />
                  </div>
                  {itemsNuevos.map((it, idx) => (
                    <div key={idx} className="mb-1 flex gap-2">
                      <input
                        type="text"
                        placeholder="Referencia"
                        value={it.referencia}
                        onChange={(e) =>
                          setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, referencia: e.target.value } : x)))
                        }
                        className="w-40 rounded border px-2 py-1 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Descripción"
                        value={it.descripcion}
                        onChange={(e) =>
                          setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, descripcion: e.target.value } : x)))
                        }
                        className="flex-1 rounded border px-2 py-1 text-sm"
                      />
                      <input
                        type="number"
                        min={0}
                        value={it.cantidadFacturada}
                        onChange={(e) =>
                          setItemsNuevos(itemsNuevos.map((x, i) => (i === idx ? { ...x, cantidadFacturada: e.target.value } : x)))
                        }
                        className="w-24 rounded border px-2 py-1 text-sm"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setItemsNuevos([...itemsNuevos, { referencia: '', descripcion: '', cantidadFacturada: '1' }])
                    }
                    className="mb-2 text-sm text-sofia-700 hover:underline"
                  >
                    + Agregar producto
                  </button>
                </>
              )}
              <div>
                <button
                  type="submit"
                  disabled={cargando}
                  className="rounded bg-sofia-600 px-4 py-2 text-sm text-white hover:bg-sofia-700 disabled:opacity-50"
                >
                  {cargando ? 'Procesando…' : facturaArchivo ? 'Procesar factura y crear' : 'Crear actividad'}
                </button>
              </div>
            </form>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Fecha</th>
                <th>Factura</th>
                <th>Proveedor</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-1">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td>{r.numeroFactura ?? '—'}</td>
                  <td>{r.proveedor ?? '—'}</td>
                  <td>
                    <span
                      className={
                        r.estado === 'APROBADO'
                          ? 'text-green-700'
                          : r.estado === 'CANCELADO'
                            ? 'text-slate-500'
                            : r.estado === 'PENDIENTE_CORRECCION'
                              ? 'font-semibold text-red-700'
                              : 'text-amber-700'
                      }
                    >
                      {ESTADOS[r.estado]}
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => abrir(r.id)} className="text-sofia-700 hover:underline">
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-slate-500">
                    Sin actividades de ingreso.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Detalle */}
        {ingreso && (
          <section className="rounded-lg bg-white p-5 shadow">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                Actividad {ingreso.numeroFactura ?? ingreso.id.slice(0, 8)} ·{' '}
                <span className={ingreso.estado === 'PENDIENTE_CORRECCION' ? 'text-red-700' : ''}>
                  {ESTADOS[ingreso.estado]}
                </span>
              </h2>
              <p className="text-sm text-slate-600">
                Coinciden: {ingreso.resumen.coincidencias} · Faltantes: {ingreso.resumen.faltantes} ·
                Sobrantes: {ingreso.resumen.sobrantes} · Nuevos: {ingreso.resumen.nuevos}
              </p>
            </div>

            {ingreso.estado === 'PENDIENTE_CORRECCION' && (
              <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                Hay diferencias o productos nuevos: el cierre definitivo está bloqueado y requiere
                aprobación del Generador con observación.
              </p>
            )}

            {/* Paso 3: Operador */}
            {esOperador && ingreso.estado === 'CREADO' && (
              <button
                onClick={() => accion(() => api(`/inbound/${ingreso.id}/iniciar`, { method: 'POST' }), 'Tarea iniciada (En ingreso).')}
                disabled={cargando}
                className="mb-3 rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
              >
                Iniciar tarea de ingreso
              </button>
            )}

            {esOperador && enRecepcion && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded bg-slate-50 p-3">
                <label className="text-sm font-medium">
                  Caja principal / contenedor
                  <input
                    type="text"
                    value={caja}
                    onChange={(e) => setCaja(e.target.value)}
                    placeholder="Escanee o digite el código"
                    className="ml-2 rounded border px-2 py-1"
                  />
                </label>
                <button
                  onClick={() => accion(() => api(`/inbound/${ingreso.id}/caja`, { method: 'POST', body: JSON.stringify({ codigoCaja: caja }) }), 'Caja principal asociada.')}
                  disabled={cargando || !caja.trim()}
                  className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700 disabled:opacity-50"
                >
                  Asociar caja
                </button>
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">Referencia</th>
                  <th>Descripción</th>
                  <th className="w-20">Facturada</th>
                  <th className="w-28">Recibida</th>
                  <th className="w-28">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ingreso.items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-1">
                      {it.referencia}
                      {it.esNuevo && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">nuevo</span>
                      )}
                    </td>
                    <td>{it.descripcion ?? '—'}</td>
                    <td>{it.cantidadFacturada}</td>
                    <td>
                      {esOperador && enRecepcion ? (
                        <input
                          type="number"
                          min={0}
                          value={cantidades[it.id] ?? '0'}
                          onChange={(e) => setCantidades({ ...cantidades, [it.id]: e.target.value })}
                          className="w-20 rounded border px-2 py-1"
                        />
                      ) : (
                        it.cantidadRecibida
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          it.estado === 'COINCIDE'
                            ? 'text-green-700'
                            : it.estado === 'NUEVO'
                              ? 'text-amber-700'
                              : 'font-semibold text-red-700'
                        }
                      >
                        {it.estado}
                        {it.estado !== 'COINCIDE' && it.estado !== 'NUEVO' &&
                          ` (${it.diferencia > 0 ? '+' : ''}${it.diferencia})`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {esOperador && enRecepcion && (
              <div className="mt-3 flex gap-3">
                <button
                  onClick={guardarCantidades}
                  disabled={cargando}
                  className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
                >
                  Guardar cantidades
                </button>
                <button
                  onClick={() => accion(() => api(`/inbound/${ingreso.id}/cerrar-conteo`, { method: 'POST' }), 'Conteo cerrado: comparación generada.')}
                  disabled={cargando}
                  className="rounded bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Cerrar conteo y comparar
                </button>
              </div>
            )}

            {/* Paso 5: Generador */}
            {esGenerador && enRecepcion && (
              <div className="mt-4 rounded bg-slate-50 p-3">
                <label className="block text-sm font-medium">
                  Observación {conNovedad && <span className="text-red-700">(obligatoria: hay diferencias o productos nuevos)</span>}
                  <textarea
                    value={observacion}
                    onChange={(e) => setObservacion(e.target.value)}
                    rows={2}
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => accion(() => api(`/inbound/${ingreso.id}/approve`, { method: 'POST', body: JSON.stringify({ observacion: observacion || undefined }) }), 'Ingreso aprobado: existencias actualizadas.')}
                    disabled={cargando || !ingreso.conteoCerrado}
                    className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Aprobar ingreso
                  </button>
                  {!ingreso.conteoCerrado && (
                    <p className="self-center text-sm text-amber-700">
                      El Operador debe cerrar el conteo antes de aprobar.
                    </p>
                  )}
                </div>
              </div>
            )}

            {esGenerador && !['APROBADO', 'CANCELADO'].includes(ingreso.estado) && (
              <button
                onClick={() => {
                  const motivo = window.prompt('Motivo de la cancelación (opcional):') ?? undefined;
                  accion(() => api(`/inbound/${ingreso.id}/cancel`, { method: 'POST', body: JSON.stringify({ motivo }) }), 'Actividad cancelada.');
                }}
                disabled={cargando}
                className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Cancelar actividad
              </button>
            )}
          </section>
        )}
      </div>
        </AppShell>
  );
}
