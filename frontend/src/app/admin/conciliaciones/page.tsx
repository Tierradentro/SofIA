'use client';

/**
 * I65h — Conciliaciones: cruza el archivo de productos exportado de World
 * Office con la base de datos SofIA de una empresa (existencias, precios y
 * cualquier otro campo mapeado). El reporte se muestra en pantalla y se
 * exporta a CSV. Sección Administración, solo perfil Administrador.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiUpload, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina, Tarjeta, Insignia } from '@/components/ui';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
}

interface Diferencia {
  campo: string;
  valorWo: string;
  valorSofia: string;
}

interface FilaConciliacion {
  codigo: string;
  estado: 'COINCIDE' | 'DIFERENCIA' | 'NO_ENCONTRADO_EN_SOFIA' | 'FALTANTE_EN_WO';
  diferencias: Diferencia[];
}

interface Resultado {
  empresa: { id: string; nombre: string; siglas?: string };
  totalArchivo: number;
  coinciden: number;
  conDiferencias: number;
  noEncontrados: number;
  faltantesEnWo: number;
  filas: FilaConciliacion[];
}

const CAMPOS: { valor: string; etiqueta: string }[] = [
  { valor: 'codigo', etiqueta: 'Código (llave) *' },
  { valor: 'existencia', etiqueta: 'Existencia' },
  { valor: 'precio', etiqueta: 'Precio' },
  { valor: 'descripcion', etiqueta: 'Descripción' },
  { valor: 'marca', etiqueta: 'Marca' },
  { valor: 'unidad_medida', etiqueta: 'Unidad de medida' },
  { valor: 'codigo_oe', etiqueta: 'Código OE' },
];

const ESTADO_ETIQUETA: Record<FilaConciliacion['estado'], string> = {
  COINCIDE: 'Coincide',
  DIFERENCIA: 'Diferencia',
  NO_ENCONTRADO_EN_SOFIA: 'No existe en SofIA',
  FALTANTE_EN_WO: 'No está en el archivo WO',
};

function csvEscape(v: string): string {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function ConciliacionesPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [columnas, setColumnas] = useState<string[]>([]);
  const [mapeo, setMapeo] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol !== 'ADMINISTRADOR') return router.replace('/dashboard');
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) {
        setEmpresas(body);
        if (body.length > 0) setEmpresaId((prev) => prev || body[0].id);
      }
    });
  }, [router]);

  /** Paso 1: leer las columnas del archivo para armar el mapeo. */
  async function leerColumnas(f: File) {
    setCargando(true);
    setError('');
    setResultado(null);
    const fd = new FormData();
    fd.append('file', f);
    const { status, body } = await apiUpload<{ columnas: string[]; filas: number }>(
      '/conciliaciones/columnas',
      fd,
    );
    setCargando(false);
    if (status === 201 || status === 200) {
      setColumnas(body.columnas);
      // Auto-mapeo por nombre parecido (el usuario lo ajusta)
      const auto: Record<string, string> = {};
      for (const col of body.columnas) {
        const norm = col
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        const candidato = CAMPOS.find(
          (c) =>
            norm === c.valor ||
            norm.includes(c.valor) ||
            (c.valor === 'codigo' && ['referencia', 'ref', 'codigo', 'cod', 'item'].includes(norm)) ||
            (c.valor === 'existencia' && ['existencia', 'existencias', 'cantidad', 'saldo', 'stock'].includes(norm)) ||
            (c.valor === 'precio' && ['precio', 'precio_venta', 'valor', 'vlr_unitario', 'valor_unitario'].includes(norm)) ||
            (c.valor === 'descripcion' && ['descripcion', 'nombre', 'detalle'].includes(norm)),
        );
        if (candidato && !Object.values(auto).includes(candidato.valor)) {
          auto[col] = candidato.valor;
        }
      }
      setMapeo(auto);
    } else {
      setError(mensajeError(body, 'No se pudo leer el archivo'));
      setColumnas([]);
    }
  }

  /** Paso 2: ejecutar la conciliación. */
  async function conciliar() {
    if (!archivo || !empresaId) return;
    const mapeoLimpio = Object.fromEntries(
      Object.entries(mapeo).filter(([, v]) => v),
    );
    setCargando(true);
    setError('');
    setMensaje('');
    const fd = new FormData();
    fd.append('empresaId', empresaId);
    fd.append('mapeo', JSON.stringify(mapeoLimpio));
    fd.append('file', archivo);
    const { status, body } = await apiUpload<Resultado>('/conciliaciones', fd);
    setCargando(false);
    if (status === 200 || status === 201) {
      setResultado(body);
      setMensaje('Conciliación lista. Revise el reporte en pantalla o expórtelo a CSV.');
    } else {
      setError(mensajeError(body, 'No se pudo conciliar el archivo'));
    }
  }

  /** Exporta el reporte a CSV (punto y coma, compatible con Excel es-CO). */
  function exportarCsv() {
    if (!resultado) return;
    const lineas = [
      ['Código', 'Estado', 'Campo', 'Valor World Office', 'Valor SofIA'].join(';'),
      ...resultado.filas.flatMap((f) =>
        f.diferencias.length > 0
          ? f.diferencias.map((d) =>
              [f.codigo, ESTADO_ETIQUETA[f.estado], d.campo, d.valorWo, d.valorSofia]
                .map(csvEscape)
                .join(';'),
            )
          : [[f.codigo, ESTADO_ETIQUETA[f.estado], '', '', ''].map(csvEscape).join(';')],
      ),
    ];
    const blob = new Blob(['﻿' + lineas.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conciliacion-${resultado.empresa.siglas ?? resultado.empresa.nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!sesion) return null;

  const mapeoListo =
    Object.values(mapeo).includes('codigo') &&
    Object.values(mapeo).some((v) => v && v !== 'codigo');

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Conciliaciones" />
      <div className="mx-auto max-w-5xl">
        {mensaje && <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>}

        <Tarjeta className="mb-4 p-5">
          <h2 className="mb-3 font-semibold">1. Archivo de World Office y empresa</h2>
          <p className="mb-3 text-sm text-slate-600">
            Cargue el archivo de productos exportado de World Office (Excel o CSV) y
            seleccione la empresa contra la que se concilian existencias y precios.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Empresa
              <select
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                className="mt-1 block rounded border px-2 py-1.5"
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Archivo WO (.xlsx, .xls, .csv)
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setArchivo(f);
                  setColumnas([]);
                  setResultado(null);
                  if (f) leerColumnas(f);
                }}
                className="mt-1 block text-sm"
              />
            </label>
          </div>
        </Tarjeta>

        {columnas.length > 0 && (
          <Tarjeta className="mb-4 p-5">
            <h2 className="mb-3 font-semibold">2. Mapeo de columnas</h2>
            <p className="mb-3 text-sm text-slate-600">
              Asigne cada columna del archivo a un campo. El código es obligatorio; los
              demás campos que asocie también se comparan y se reportan sus diferencias.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {columnas.map((col) => (
                <label key={col} className="flex items-center gap-2 text-sm">
                  <span className="w-40 truncate font-medium" title={col}>{col}</span>
                  <select
                    value={mapeo[col] ?? ''}
                    onChange={(e) => setMapeo({ ...mapeo, [col]: e.target.value })}
                    className="flex-1 rounded border px-2 py-1"
                  >
                    <option value="">— Ignorar —</option>
                    {CAMPOS.map((c) => (
                      <option key={c.valor} value={c.valor}>{c.etiqueta}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              onClick={conciliar}
              disabled={cargando || !mapeoListo || !empresaId}
              className="mt-4 rounded bg-sofia-700 px-4 py-2 text-sm font-medium text-white hover:bg-sofia-800 disabled:opacity-50"
            >
              {cargando ? 'Conciliando…' : 'Conciliar'}
            </button>
            {!mapeoListo && (
              <span className="ml-3 text-xs text-amber-700">
                Mapee el código y al menos un campo a comparar.
              </span>
            )}
          </Tarjeta>
        )}

        {resultado && (
          <Tarjeta className="mb-4 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                3. Reporte — {resultado.empresa.nombre}
              </h2>
              <button
                onClick={exportarCsv}
                className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
              >
                Exportar a CSV
              </button>
            </div>
            <div className="mb-4 flex flex-wrap gap-2 text-sm">
              <Insignia tono="azul">{resultado.totalArchivo} en archivo</Insignia>
              <Insignia tono="verde">{resultado.coinciden} coinciden</Insignia>
              <Insignia tono="ambar">{resultado.conDiferencias} con diferencias</Insignia>
              <Insignia tono="rojo">{resultado.noEncontrados} no existen en SofIA</Insignia>
              <Insignia tono="gris">{resultado.faltantesEnWo} no están en WO</Insignia>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="py-1 pr-3">Código</th>
                    <th className="pr-3">Estado</th>
                    <th className="pr-3">Campo</th>
                    <th className="pr-3">World Office</th>
                    <th>SofIA</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.filas
                    .filter((f) => f.estado !== 'COINCIDE')
                    .flatMap((f) =>
                      f.diferencias.length > 0
                        ? f.diferencias.map((d, i) => (
                            <tr key={`${f.codigo}-${i}`} className="border-b">
                              <td className="py-1 pr-3 font-medium">{f.codigo}</td>
                              <td className={`pr-3 ${f.estado === 'DIFERENCIA' ? 'text-amber-700' : 'text-red-700'}`}>
                                {ESTADO_ETIQUETA[f.estado]}
                              </td>
                              <td className="pr-3">{d.campo}</td>
                              <td className="pr-3">{d.valorWo || '—'}</td>
                              <td>{d.valorSofia || '—'}</td>
                            </tr>
                          ))
                        : [
                            <tr key={f.codigo} className="border-b">
                              <td className="py-1 pr-3 font-medium">{f.codigo}</td>
                              <td className="text-red-700" colSpan={4}>
                                {ESTADO_ETIQUETA[f.estado]}
                              </td>
                            </tr>,
                          ],
                    )}
                  {resultado.filas.every((f) => f.estado === 'COINCIDE') && (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-green-700">
                        Todo coincide: no hay diferencias entre el archivo y SofIA.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        )}
      </div>
    </AppShell>
  );
}
