'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';

interface Empresa { id: string; nombre: string; siglas: string }
interface Producto { id: string; codigo: string; descripcion: string; cantidad: number }

interface ItemJornada {
  id: string;
  productId: string;
  codigo: string;
  descripcion: string;
  existenciaSnapshot: number;
  precioSnapshot: string | number;
  conteo: number | null;
  ubicacion: string | null;
  notaDiferencia: string | null;
  diferencia: number | null;
  valorEstimado: number | null;
}

interface Jornada {
  id: string;
  numero: string;
  empresaId: string;
  instruccion: string;
  estado: 'EN_CONTEO' | 'PENDIENTE_APROBACION' | 'APROBADO' | 'CANCELADO';
  motivoCancelacion: string | null;
  createdAt: string;
  empresa?: Empresa | null;
  items?: ItemJornada[];
  totalItems?: number;
  contados?: number;
  conDiferencia?: number;
}

const ESTADOS: Record<Jornada['estado'], string> = {
  EN_CONTEO: 'En conteo',
  PENDIENTE_APROBACION: 'Pendiente aprobación',
  APROBADO: 'Aprobado',
  CANCELADO: 'Cancelado',
};

/**
 * M12/EP-09: inventarios por empresa.
 * Generador: crea la jornada (snapshot), documenta diferencias, aprueba, cancela.
 * Operador: conteo físico con escaneo/manual y ubicación.
 */
export default function InventariosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [lista, setLista] = useState<Jornada[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [jornada, setJornada] = useState<Jornada | null>(null);

  // Creación
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [empresaSel, setEmpresaSel] = useState('');
  const [productosEmpresa, setProductosEmpresa] = useState<Producto[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [instruccion, setInstruccion] = useState('');

  // Conteo
  const [codigoScan, setCodigoScan] = useState('');
  const [conteoVal, setConteoVal] = useState('');
  const [ubicacionVal, setUbicacionVal] = useState('');

  // Aprobación / cancelación
  const [notasDif, setNotasDif] = useState<Record<string, string>>({});
  const [motivoCancelar, setMotivoCancelar] = useState('');

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const rol = sesion?.usuario.rol;
  const esGenerador = rol === 'GENERADOR' || rol === 'ADMINISTRADOR';
  const esOperador = rol === 'OPERADOR' || rol === 'ADMINISTRADOR';

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API' || s.usuario.rol === 'COMERCIAL') return router.replace('/dashboard');
    setSesion(s);
    cargarLista();
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) {
        setEmpresas(body);
        if (body.length) setEmpresaSel(body[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!empresaSel) return;
    api<Producto[]>(`/products?empresaId=${empresaSel}`).then(({ status, body }) => {
      if (status === 200) setProductosEmpresa(body);
    });
    setSeleccionados(new Set());
  }, [empresaSel]);

  function limpiarAvisos() {
    setMensaje('');
    setError('');
  }

  async function cargarLista(estado = filtroEstado) {
    const q = estado ? `?estado=${estado}` : '';
    const { status, body } = await api<Jornada[]>(`/inventories${q}`);
    if (status === 200) setLista(body);
  }

  async function cargarDetalle(id: string) {
    const { status, body } = await api<Jornada>(`/inventories/${id}`);
    if (status === 200) {
      setJornada(body);
      const notas: Record<string, string> = {};
      body.items?.forEach((i) => {
        if (i.notaDiferencia) notas[i.id] = i.notaDiferencia;
      });
      setNotasDif(notas);
    }
  }

  async function crear() {
    limpiarAvisos();
    if (!instruccion.trim()) return setError('Escriba la instrucción de los productos a inventariar');
    if (seleccionados.size === 0) return setError('Seleccione al menos un producto');
    const { status, body } = await api<any>('/inventories', {
      method: 'POST',
      body: JSON.stringify({
        empresaId: empresaSel,
        instruccion: instruccion.trim(),
        productIds: Array.from(seleccionados),
      }),
    });
    if (status === 201) {
      setMensaje(`Jornada ${body.numero} creada con snapshot de ${body.items.length} productos`);
      setMostrarCrear(false);
      setInstruccion('');
      cargarLista();
      cargarDetalle(body.id);
    } else setError(mensajeError(body, 'No se pudo crear la jornada'));
  }

  async function registrarConteo() {
    limpiarAvisos();
    if (!jornada || !codigoScan.trim() || conteoVal === '') return;
    const { status, body } = await api<any>(`/inventories/${jornada.id}/conteo`, {
      method: 'POST',
      body: JSON.stringify({
        codigo: codigoScan.trim(),
        conteo: parseInt(conteoVal, 10),
        ubicacion: ubicacionVal || undefined,
      }),
    });
    if (status === 201) {
      setMensaje('Conteo registrado');
      setCodigoScan('');
      setConteoVal('');
      setUbicacionVal('');
      cargarDetalle(jornada.id);
    } else setError(mensajeError(body, 'Conteo rechazado'));
  }

  async function accion(path: string, textoOk: string, body: any = {}) {
    limpiarAvisos();
    if (!jornada) return;
    const { status, body: resp } = await api<any>(`/inventories/${jornada.id}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (status === 201) {
      setMensaje(textoOk);
      cargarDetalle(jornada.id);
      cargarLista();
    } else setError(mensajeError(resp, 'Operación rechazada'));
  }

  async function documentarYAprobar() {
    limpiarAvisos();
    if (!jornada?.items) return;
    const conDif = jornada.items.filter((i) => i.diferencia !== null && i.diferencia !== 0);
    const faltantes = conDif.filter((i) => !notasDif[i.id]?.trim() && !i.notaDiferencia);
    if (faltantes.length > 0) {
      return setError(`Documente la diferencia de: ${faltantes.map((i) => i.codigo).join(', ')}`);
    }
    const nuevas = conDif
      .filter((i) => notasDif[i.id]?.trim() && notasDif[i.id] !== i.notaDiferencia)
      .map((i) => ({ itemId: i.id, nota: notasDif[i.id].trim() }));
    if (nuevas.length > 0) {
      const { status, body } = await api<any>(`/inventories/${jornada.id}/diferencias`, {
        method: 'POST',
        body: JSON.stringify({ notas: nuevas }),
      });
      if (status !== 201) return setError(mensajeError(body, 'No se pudieron documentar las diferencias'));
    }
    await accion('/aprobar', 'Inventario aprobado: existencias actualizadas');
  }

  if (!sesion) return null;

  // ---------------------------------------------------------------
  // Detalle de la jornada
  // ---------------------------------------------------------------
  if (jornada?.items) {
    const items = jornada.items;
    const conDif = items.filter((i) => i.diferencia !== null && i.diferencia !== 0);
    const sinContar = items.filter((i) => i.conteo === null).length;
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{jornada.numero} — {jornada.empresa?.nombre}</h1>
            <p className="text-sm text-slate-600">
              <span className="font-medium">{ESTADOS[jornada.estado]}</span> · {jornada.instruccion}
            </p>
          </div>
          <button onClick={() => { setJornada(null); cargarLista(); }} className="rounded bg-slate-200 px-3 py-1 text-sm">← Volver</button>
        </div>

        {mensaje && <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-800">{mensaje}</p>}
        {error && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

        {/* Conteo (Operador, EN_CONTEO) */}
        {jornada.estado === 'EN_CONTEO' && esOperador && (
          <section className="mb-4 rounded-lg bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Conteo físico</h2>
            <p className="mb-2 text-sm text-slate-500">
              El alistamiento, despacho e ingreso de estos productos están bloqueados mientras la jornada esté en conteo.
              Pendientes por contar: {sinContar}.
            </p>
            <div className="flex flex-wrap gap-2 text-sm">
              <input
                value={codigoScan}
                onChange={(e) => setCodigoScan(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && registrarConteo()}
                placeholder="Escanear código o barcode…"
                className="flex-1 rounded border px-2 py-1"
              />
              <input value={conteoVal} onChange={(e) => setConteoVal(e.target.value)} type="number" min={0} placeholder="Cantidad" className="w-24 rounded border px-2 py-1" />
              <input value={ubicacionVal} onChange={(e) => setUbicacionVal(e.target.value)} placeholder="Ubicación (ej. A-01-03)" className="w-40 rounded border px-2 py-1" />
              <button onClick={registrarConteo} className="rounded bg-sofia-600 px-3 py-1 text-white">Registrar</button>
            </div>
            <button
              onClick={() => accion('/finalizar-conteo', 'Conteo finalizado: pendiente de aprobación')}
              className="mt-3 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white"
            >
              Finalizar conteo → Pendiente aprobación
            </button>
          </section>
        )}

        {/* Comparación (HU-050) */}
        <section className="mb-4 rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold">Comparación conteo vs existencia</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Código</th>
                <th>Descripción</th>
                <th>Snapshot</th>
                <th>Conteo</th>
                <th>Ubicación</th>
                <th>Diferencia</th>
                <th>Valor est.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="py-1 font-medium">{i.codigo}</td>
                  <td className="text-slate-600">{i.descripcion}</td>
                  <td>{i.existenciaSnapshot}</td>
                  <td>{i.conteo ?? '—'}</td>
                  <td className="text-slate-500">{i.ubicacion ?? '—'}</td>
                  <td className={i.diferencia === 0 ? 'text-green-700' : i.diferencia === null ? 'text-slate-400' : 'font-semibold text-red-700'}>
                    {i.diferencia === null ? '—' : i.diferencia > 0 ? `+${i.diferencia}` : i.diferencia}
                  </td>
                  <td className="text-slate-500">{i.valorEstimado === null ? '—' : `$${Number(i.valorEstimado).toLocaleString('es-CO')}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Aprobación (Generador, PENDIENTE_APROBACION): documentar diferencias */}
        {jornada.estado === 'PENDIENTE_APROBACION' && esGenerador && (
          <section className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
            <h2 className="mb-2 font-semibold">Aprobación: documente cada diferencia</h2>
            {conDif.length === 0 ? (
              <p className="text-sm text-slate-600">Sin diferencias: puede aprobar directamente.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {conDif.map((i) => (
                  <div key={i.id} className="flex items-center gap-2">
                    <span className="w-44 font-medium">{i.codigo} ({i.diferencia! > 0 ? '+' : ''}{i.diferencia})</span>
                    <input
                      value={notasDif[i.id] ?? ''}
                      onChange={(e) => setNotasDif({ ...notasDif, [i.id]: e.target.value })}
                      placeholder="Causa de la diferencia…"
                      className="flex-1 rounded border px-2 py-1"
                    />
                  </div>
                ))}
              </div>
            )}
            <button onClick={documentarYAprobar} className="mt-3 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white">
              Aprobar: actualizar existencias
            </button>
          </section>
        )}

        {/* Cancelación (Generador) */}
        {(jornada.estado === 'EN_CONTEO' || jornada.estado === 'PENDIENTE_APROBACION') && esGenerador && (
          <section className="mb-4 flex gap-2">
            <input value={motivoCancelar} onChange={(e) => setMotivoCancelar(e.target.value)} placeholder="Motivo de cancelación (obligatorio)…" className="flex-1 rounded border px-2 py-1 text-sm" />
            <button onClick={() => accion('/cancelar', 'Jornada cancelada: existencias sin cambio', { motivo: motivoCancelar })} className="rounded bg-red-600 px-3 py-1 text-sm text-white">
              Cancelar jornada
            </button>
          </section>
        )}
        {jornada.estado === 'CANCELADO' && (
          <p className="rounded bg-red-100 p-2 text-sm text-red-800">Cancelada: {jornada.motivoCancelacion}</p>
        )}
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Lista de jornadas + creación
  // ---------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Inventarios</h1>
        <div className="flex gap-2">
          <button onClick={() => router.push('/dashboard')} className="rounded bg-slate-200 px-3 py-1 text-sm">← Panel</button>
          {esGenerador && (
            <button onClick={() => setMostrarCrear(!mostrarCrear)} className="rounded bg-sofia-600 px-3 py-1 text-sm text-white">
              Nueva jornada
            </button>
          )}
        </div>
      </div>

      {mensaje && <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-800">{mensaje}</p>}
      {error && <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}

      {mostrarCrear && (
        <section className="mb-4 rounded-lg bg-white p-4 shadow text-sm">
          <h2 className="mb-2 font-semibold">Crear jornada de inventario</h2>
          <p className="mb-2 text-slate-500">Al crearla se toma el snapshot de existencias; la comparación del conteo se hace contra ese snapshot.</p>
          <div className="mb-2 flex gap-2">
            <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)} className="rounded border px-2 py-1">
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <input value={instruccion} onChange={(e) => setInstruccion(e.target.value)} placeholder="Instrucción de los productos a inventariar…" className="flex-1 rounded border px-2 py-1" />
          </div>
          <div className="mb-2 max-h-48 overflow-y-auto rounded border p-2">
            {productosEmpresa.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={seleccionados.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(seleccionados);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setSeleccionados(next);
                  }}
                />
                <span>{p.codigo} — {p.descripcion} <span className="text-slate-400">(existencia {p.cantidad})</span></span>
              </label>
            ))}
          </div>
          <button onClick={crear} className="rounded bg-sofia-600 px-4 py-2 font-medium text-white">
            Crear con snapshot ({seleccionados.size} productos)
          </button>
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
          <p className="text-sm text-slate-500">No hay jornadas de inventario.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-1">Número</th>
                <th>Estado</th>
                <th>Productos</th>
                <th>Contados</th>
                <th>Con diferencia</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((j) => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{j.numero}</td>
                  <td>{ESTADOS[j.estado]}</td>
                  <td>{j.totalItems}</td>
                  <td>{j.contados}</td>
                  <td className={j.conDiferencia ? 'font-semibold text-red-700' : ''}>{j.conDiferencia}</td>
                  <td><button onClick={() => cargarDetalle(j.id)} className="text-sofia-700 hover:underline">Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
