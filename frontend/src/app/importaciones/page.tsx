'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
}

type TipoImportacion = 'PRODUCTOS' | 'CANTIDADES' | 'CLIENTES' | 'COMERCIALES';

type CamposCatalogo = Record<
  TipoImportacion,
  { requeridos: string[]; opcionales: string[] }
>;

interface ImportJob {
  id: string;
  tipo: TipoImportacion;
  nombreArchivo: string;
  estado: 'PENDIENTE_APROBACION' | 'APLICADO' | 'RECHAZADO';
  createdAt: string;
  resumen?: {
    totalFilas: number;
    validas: number;
    invalidas: { fila: number; errores: string[] }[];
    duplicados: string[];
    nuevos?: number;
    actualizados?: number;
    direccionesAAgregar?: number;
    descartados?: number;
    conDiferencia?: number;
    productosNoExistentes?: string[];
    diferencias?: { codigo: string; actual: number; nueva: number; diferencia: number }[];
    aplicado?: Record<string, number>;
  };
}

const TIPOS: { valor: TipoImportacion; etiqueta: string; porEmpresa: boolean }[] = [
  { valor: 'PRODUCTOS', etiqueta: 'Productos (maestra)', porEmpresa: true },
  { valor: 'CANTIDADES', etiqueta: 'Cantidades (existencias)', porEmpresa: true },
  { valor: 'CLIENTES', etiqueta: 'Clientes', porEmpresa: false },
  { valor: 'COMERCIALES', etiqueta: 'Comerciales', porEmpresa: false },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/** Coincidencia aproximada columna Excel ↔ campo destino para pre-mapeo. */
function adivinarDestino(columna: string, destinos: string[]): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const col = norm(columna);
  const exacto = destinos.find((d) => norm(d) === col);
  if (exacto) return exacto;
  const parcial = destinos.find(
    (d) => col.includes(norm(d)) || norm(d).includes(col),
  );
  return parcial ?? '';
}

/**
 * HU-010/016/017 y M18: importación desde la maestra contable.
 * Flujo: archivo → mapeo declarativo → validación con resumen → aprobar/rechazar.
 * Carga: Generador/Administrador. Aprobación de CANTIDADES: solo Administrador.
 */
export default function ImportacionesPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [campos, setCampos] = useState<CamposCatalogo | null>(null);

  const [tipo, setTipo] = useState<TipoImportacion>('PRODUCTOS');
  const [empresaId, setEmpresaId] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [columnas, setColumnas] = useState<string[]>([]);
  const [columnasSinEncabezado, setColumnasSinEncabezado] = useState(0);
  const [mapeo, setMapeo] = useState<Record<string, string>>({});

  const [job, setJob] = useState<ImportJob | null>(null);
  const [historial, setHistorial] = useState<ImportJob[]>([]);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const configTipo = TIPOS.find((t) => t.valor === tipo)!;
  const destinos = useMemo(
    () => (campos ? [...campos[tipo].requeridos, ...campos[tipo].opcionales] : []),
    [campos, tipo],
  );
  const esAdmin = sesion?.usuario.rol === 'ADMINISTRADOR';
  const puedeAprobar =
    job?.estado === 'PENDIENTE_APROBACION' &&
    (job.tipo !== 'CANTIDADES' || esAdmin);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    // QA Func. 3.4: solo Administrador (menú y URL directa)
    if (s.usuario.rol !== 'ADMINISTRADOR') {
      return router.replace('/dashboard');
    }
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) {
        setEmpresas(body);
        if (body.length > 0) setEmpresaId(body[0].id);
      }
    });
    api<CamposCatalogo>('/imports/fields').then(({ status, body }) => {
      if (status === 200) setCampos(body);
    });
    cargarHistorial();
  }, [router]);

  async function cargarHistorial() {
    const { status, body } = await api<ImportJob[]>('/imports');
    if (status === 200) setHistorial(body);
  }

  async function leerArchivo(file: File) {
    setArchivo(file);
    setJob(null);
    setError('');
    setMensaje('');
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      // Encabezados literales de la fila 1 (no inferidos de la primera fila
      // de datos): una celda vacía en los datos ya no oculta su columna.
      // Misma regla del parser del backend: duplicados se sufijan " (n)".
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
        header: 1,
        defval: '',
      });
      const encabezados = ((matriz[0] as unknown[]) ?? []).map((c) =>
        String(c).trim(),
      );
      const vistos = new Map<string, number>();
      const cols: string[] = [];
      let sinEncabezado = 0;
      for (const nombre of encabezados) {
        if (nombre === '') {
          sinEncabezado++;
          continue;
        }
        const n = (vistos.get(nombre) ?? 0) + 1;
        vistos.set(nombre, n);
        cols.push(n > 1 ? `${nombre} (${n})` : nombre);
      }
      setColumnas(cols);
      setColumnasSinEncabezado(sinEncabezado);
      // Pre-mapeo por nombre; el usuario lo ajusta (mapeo declarativo, M18)
      const inicial: Record<string, string> = {};
      for (const c of cols) inicial[c] = adivinarDestino(c, destinos);
      setMapeo(inicial);
    } catch {
      setError('No se pudo leer el archivo. Use .xlsx, .xls o .csv');
      setColumnas([]);
      setColumnasSinEncabezado(0);
    }
  }

  async function cargar() {
    if (!archivo) return;
    setCargando(true);
    setError('');
    setMensaje('');
    const mapeoLimpio = Object.fromEntries(
      Object.entries(mapeo).filter(([, destino]) => destino !== ''),
    );
    const fd = new FormData();
    fd.append('tipo', tipo);
    if (configTipo.porEmpresa) fd.append('empresaId', empresaId);
    fd.append('mapeo', JSON.stringify(mapeoLimpio));
    fd.append('file', archivo);

    const s = obtenerSesion();
    const res = await fetch(`${API_BASE}/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s?.token}` },
      body: fd,
    });
    const body = await res.json();
    setCargando(false);
    if (res.status === 201) {
      setJob(body);
      setMensaje('Archivo validado. Revise el resumen y apruebe o rechace.');
      cargarHistorial();
    } else if (body.code === 'COLUMNAS_FALTANTES') {
      setError(
        `Columnas requeridas sin mapear: ${body.columnasFaltantes.join(', ')}. ` +
          `Disponibles en el archivo: ${body.columnasDisponibles.join(', ')}`,
      );
    } else {
      setError(mensajeError(body, 'Error al cargar el archivo'));
    }
  }

  async function aprobar() {
    if (!job) return;
    setCargando(true);
    setError('');
    const { status, body } = await api<ImportJob>(`/imports/${job.id}/approve`, {
      method: 'POST',
    });
    setCargando(false);
    if (status === 200 || status === 201) {
      setJob(body);
      setMensaje('Importación aplicada correctamente.');
      cargarHistorial();
    } else {
      setError(mensajeError(body, 'No se pudo aprobar'));
    }
  }

  async function rechazar() {
    if (!job) return;
    setCargando(true);
    setError('');
    const { status, body } = await api<ImportJob>(`/imports/${job.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ motivo: motivoRechazo || undefined }),
    });
    setCargando(false);
    if (status === 200 || status === 201) {
      setJob(body);
      setMensaje('Importación rechazada.');
      cargarHistorial();
    } else {
      setError(mensajeError(body, 'No se pudo rechazar'));
    }
  }

  /** HU-017: exportación CSV con autenticación (descarga como blob). */
  async function exportarCsv() {
    setError('');
    const s = obtenerSesion();
    const res = await fetch(
      `${API_BASE}/exports/products.csv?empresaId=${empresaId}`,
      { headers: { Authorization: `Bearer ${s?.token}` } },
    );
    if (res.status !== 200) {
      setError('No se pudo exportar el CSV');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `productos_${empresas.find((e) => e.id === empresaId)?.siglas ?? 'empresa'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMensaje('CSV exportado (UTF-8, trazabilidad por empresa).');
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Importación contable (Excel/CSV)" />
      <div className="mx-auto max-w-4xl">

        {mensaje && (
          <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">
            {mensaje}
          </p>
        )}
        {error && (
          <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {/* Paso 1: tipo, empresa y archivo */}
        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold">1. Tipo y archivo</h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              Tipo
              <select
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value as TipoImportacion);
                  setArchivo(null);
                  setColumnas([]);
                  setJob(null);
                }}
                className="mt-1 block rounded border px-2 py-1"
              >
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            {configTipo.porEmpresa && (
              <label className="text-sm">
                Empresa
                <select
                  value={empresaId}
                  onChange={(e) => setEmpresaId(e.target.value)}
                  className="mt-1 block rounded border px-2 py-1"
                >
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.siglas} — {e.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm">
              Archivo (.xlsx, .xls, .csv)
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && leerArchivo(e.target.files[0])}
                className="mt-1 block text-sm"
              />
            </label>
            {tipo === 'PRODUCTOS' && (
              <button
                onClick={exportarCsv}
                className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700"
              >
                Exportar CSV actual
              </button>
            )}
          </div>
          {tipo === 'CANTIDADES' && (
            <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Las cantidades se ajustan por <strong>movimientos de inventario</strong>{' '}
              (nunca por sobrescritura) y la aprobación la realiza únicamente el
              Administrador.
            </p>
          )}
        </section>

        {/* Paso 2: mapeo declarativo */}
        {columnas.length > 0 && !job && (
          <section className="mb-4 rounded-lg bg-white p-5 shadow">
            <h2 className="mb-3 font-semibold">2. Mapeo de columnas</h2>
            <p className="mb-3 text-sm text-slate-600">
              Asigne cada columna del archivo a un campo destino. Requeridos:{' '}
              <strong>{campos?.[tipo].requeridos.join(', ')}</strong>
            </p>
            {columnasSinEncabezado > 0 && (
              <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {columnasSinEncabezado} columna(s) del archivo no tienen
                encabezado y no se ofrecen para mapeo. Revise el archivo si
                esperaba usarlas.
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {columnas.map((col) => (
                <label key={col} className="flex items-center gap-2 text-sm">
                  <span className="w-40 truncate font-medium" title={col}>
                    {col}
                  </span>
                  <select
                    value={mapeo[col] ?? ''}
                    onChange={(e) => setMapeo({ ...mapeo, [col]: e.target.value })}
                    className="flex-1 rounded border px-2 py-1"
                  >
                    <option value="">— Ignorar —</option>
                    {destinos.map((d) => (
                      <option key={d} value={d}>
                        {d}
                        {campos?.[tipo].requeridos.includes(d) ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              onClick={cargar}
              disabled={cargando}
              className="mt-4 rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
            >
              {cargando ? 'Validando…' : 'Validar archivo'}
            </button>
          </section>
        )}

        {/* Paso 3: resumen de validación (HU-016) */}
        {job && (
          <section className="mb-4 rounded-lg bg-white p-5 shadow">
            <h2 className="mb-3 font-semibold">3. Resumen de validación</h2>
            <p className="text-sm">
              Archivo: <strong>{job.nombreArchivo}</strong> · Estado:{' '}
              <strong>{job.estado}</strong>
            </p>
            <ul className="mt-2 list-inside list-disc text-sm">
              <li>Filas totales: {job.resumen?.totalFilas}</li>
              <li className="text-green-700">Válidas: {job.resumen?.validas}</li>
              <li className={job.resumen?.invalidas.length ? 'text-red-700' : ''}>
                Inválidas: {job.resumen?.invalidas.length}
              </li>
              {job.tipo === 'PRODUCTOS' && (
                <>
                  <li>Nuevos: {job.resumen?.nuevos}</li>
                  <li>Actualizados: {job.resumen?.actualizados}</li>
                </>
              )}
              {job.tipo === 'CANTIDADES' && (
                <>
                  <li>Con diferencia: {job.resumen?.conDiferencia}</li>
                  <li>
                    Productos no existentes (se omiten):{' '}
                    {job.resumen?.productosNoExistentes?.join(', ') || 'ninguno'}
                  </li>
                </>
              )}
              {job.tipo === 'CLIENTES' && (
                <>
                  <li>Clientes nuevos: {job.resumen?.nuevos}</li>
                  <li>Direcciones a agregar: {job.resumen?.direccionesAAgregar}</li>
                  <li className="text-amber-700">
                    Descartados (cliente y dirección ya existen): {job.resumen?.descartados}
                  </li>
                </>
              )}
              {job.tipo === 'COMERCIALES' && (
                <li>Registros a crear: {job.resumen?.nuevos}</li>
              )}
              {job.resumen?.duplicados && job.resumen.duplicados.length > 0 && (
                <li className="text-amber-700">
                  Duplicados en el archivo: {job.resumen.duplicados.join(', ')}
                </li>
              )}
            </ul>

            {job.resumen?.diferencias && job.resumen.diferencias.length > 0 && (
              <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1">Código</th>
                    <th>Actual</th>
                    <th>Nueva</th>
                    <th>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {job.resumen.diferencias.map((d) => (
                    <tr key={d.codigo} className="border-b">
                      <td className="py-1">{d.codigo}</td>
                      <td>{d.actual}</td>
                      <td>{d.nueva}</td>
                      <td
                        className={
                          d.diferencia >= 0 ? 'text-green-700' : 'text-red-700'
                        }
                      >
                        {d.diferencia > 0 ? `+${d.diferencia}` : d.diferencia}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}

            {job.resumen?.invalidas && job.resumen.invalidas.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-red-700">
                  Ver filas inválidas ({job.resumen.invalidas.length})
                </summary>
                <ul className="mt-1 max-h-40 overflow-auto rounded bg-red-50 p-2">
                  {job.resumen.invalidas.map((f) => (
                    <li key={f.fila}>
                      Fila {f.fila}: {f.errores.join('; ')}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {job.resumen?.aplicado && (
              <p className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
                Aplicado: {JSON.stringify(job.resumen.aplicado)}
              </p>
            )}

            {job.estado === 'PENDIENTE_APROBACION' && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {puedeAprobar ? (
                  <button
                    onClick={aprobar}
                    disabled={cargando}
                    className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Aprobar y aplicar
                  </button>
                ) : (
                  <p className="text-sm text-amber-700">
                    La aprobación de cantidades la realiza el Administrador.
                  </p>
                )}
                <input
                  type="text"
                  placeholder="Motivo de rechazo (opcional)"
                  value={motivoRechazo}
                  onChange={(e) => setMotivoRechazo(e.target.value)}
                  className="rounded border px-2 py-1.5 text-sm"
                />
                <button
                  onClick={rechazar}
                  disabled={cargando}
                  className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            )}
          </section>
        )}

        {/* Historial */}
        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold">Importaciones recientes</h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Fecha</th>
                <th>Tipo</th>
                <th>Archivo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="py-1">{new Date(h.createdAt).toLocaleString()}</td>
                  <td>{h.tipo}</td>
                  <td>{h.nombreArchivo}</td>
                  <td>
                    <span
                      className={
                        h.estado === 'APLICADO'
                          ? 'text-green-700'
                          : h.estado === 'RECHAZADO'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }
                    >
                      {h.estado}
                    </span>
                  </td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-slate-500">
                    Sin importaciones registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>
      </div>
        </AppShell>
  );
}
