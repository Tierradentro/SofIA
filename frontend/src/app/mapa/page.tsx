'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { CajonBodega, MapaBodega } from '@/components/mapa-bodega';
import { CLASE_INPUT, EncabezadoPagina, Insignia, Tarjeta } from '@/components/ui';

/**
 * I33 (Fase 2 - Mapa 2D, HU-056/057/059): mapa operativo de la bodega para
 * Operador/Generador/Administrador. Plano por piso con ocupación visual,
 * filtro por empresa (resalta dónde están sus productos), drill-down
 * pasillo → zonas → estantes → niveles → productos, y búsqueda por
 * referencia que resalta estante y nivel (ruta básica).
 */

interface MapaRack {
  id: string;
  numero: number;
  alias: string;
  niveles: number;
  cantidad: number;
  nivelesOcupados: number;
  ocupacion: number;
  empresas: Array<{ empresaId: string; cantidad: number }>;
}
interface MapaZona {
  id: string;
  lado: 'IZQUIERDA' | 'DERECHA' | 'FONDO';
  alias?: string;
  estantes: MapaRack[];
}
interface MapaPasillo {
  id: string;
  numero: number;
  alias: string;
  posX: number;
  posY: number;
  anchoM: number;
  altoM: number;
  zonas: MapaZona[];
}
interface MapaArea {
  id: string;
  tipo: 'ENTRADA' | 'PATIO_MANIOBRAS' | 'BAHIA_EMPAQUE' | 'BAHIA_TEMPORAL';
  alias: string;
  posX: number;
  posY: number;
  anchoM: number;
  altoM: number;
  cantidad: number;
  empresas: Array<{ empresaId: string; cantidad: number }>;
}
interface MapaPiso {
  id: string;
  numero: number;
  alias: string;
  pasillos: MapaPasillo[];
  areas: MapaArea[];
}
interface MapaRespuesta {
  bodega: { id: string; nombre: string; forma: string; anchoM: number; altoM: number };
  enTransito: number;
  pisos: MapaPiso[];
}
interface Empresa {
  id: string;
  nombre: string;
}
interface UbicacionProducto {
  ubicacionId: string;
  productoId: string;
  codigo: string;
  descripcion: string;
  empresa?: string;
  cantidad: number;
  esOficial: boolean;
}
interface RackDetalle {
  rack: { id: string; numero: number; alias: string; niveles: number };
  niveles: Array<{ nivel: number; productos: UbicacionProducto[] }>;
}
interface UbicacionLocalizada {
  id: string;
  nivel?: number;
  cantidad: number;
  esOficial: boolean;
  transito: boolean;
  rack?: { id: string; numero: number; alias: string; zone?: { lado: string; aisle?: { id: string; numero: number; floor?: { numero: number } } } };
  area?: { id: string; tipo: string; alias: string };
}

const ETIQUETA_LADO: Record<string, string> = { IZQUIERDA: 'Zona izquierda', DERECHA: 'Zona derecha', FONDO: 'Fondo del pasillo' };
const ETIQUETA_AREA: Record<string, string> = {
  ENTRADA: 'Entrada',
  PATIO_MANIOBRAS: 'Patio de maniobras',
  BAHIA_EMPAQUE: 'Bahía de empaque',
  BAHIA_TEMPORAL: 'Bahía temporal',
};

/** Escala de ocupación → color del cajón (paleta menta/sofia/slate). */
function colorOcupacion(ocupacion: number): { relleno: string; borde: string; texto: string } {
  if (ocupacion <= 0) return { relleno: '#f1f5f9', borde: '#94a3b8', texto: '#475569' };
  if (ocupacion < 0.34) return { relleno: '#d0faec', borde: '#17b795', texto: '#0b7561' };
  if (ocupacion < 0.67) return { relleno: '#6ee7c8', borde: '#0d9379', texto: '#0a2547' };
  return { relleno: '#17b795', borde: '#0b7561', texto: '#ffffff' };
}

function ocupacionPasillo(pasillo: MapaPasillo): number {
  let niveles = 0;
  let ocupados = 0;
  for (const z of pasillo.zonas) {
    for (const e of z.estantes) {
      niveles += e.niveles;
      ocupados += e.nivelesOcupados;
    }
  }
  return niveles > 0 ? ocupados / niveles : 0;
}

function MapaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [mapa, setMapa] = useState<MapaRespuesta | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [errorCarga, setErrorCarga] = useState('');

  const [pisoSel, setPisoSel] = useState(0);
  const [seleccion, setSeleccion] = useState<CajonBodega | null>(null);
  const [empresaFiltro, setEmpresaFiltro] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultadoBusqueda, setResultadoBusqueda] = useState<{
    producto: { codigo: string; descripcion: string };
    ubicaciones: UbicacionLocalizada[];
  } | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState('');
  const [detalleRack, setDetalleRack] = useState<RackDetalle | null>(null);
  const [productosArea, setProductosArea] = useState<UbicacionProducto[] | null>(null);
  const [rackSelId, setRackSelId] = useState<string | null>(null);
  const [nivelSel, setNivelSel] = useState<number | null>(null);

  async function cargarMapa() {
    setErrorCarga('');
    try {
      const { status, body } = await api<MapaRespuesta>('/warehouses/map');
      if (status === 200) {
        setMapa(body);
      } else if (status === 404) {
        setErrorCarga('La bodega aún no está configurada. Un administrador puede definirla en Administración → Bodega.');
      } else if (status === 403) {
        router.replace('/dashboard');
      } else {
        setErrorCarga('No se pudo cargar el mapa. Intente de nuevo.');
      }
    } catch {
      setErrorCarga('No hay comunicación con el servidor. Verifique la conexión e intente de nuevo.');
    }
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    cargarMapa();
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200 && Array.isArray(body)) setEmpresas(body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Búsqueda inicial desde ?q= (enlace «ver en mapa» del detalle de producto).
  useEffect(() => {
    const q = searchParams.get('q');
    if (q && mapa) {
      setBusqueda(q);
      buscar(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa]);

  const piso = mapa?.pisos[pisoSel];

  // I36: cantidad de unidades de una empresa en un cajón (0 si no hay filtro o no tiene).
  const cantidadDeEmpresa = (empresas: Array<{ empresaId: string; cantidad: number }>) =>
    empresaFiltro ? (empresas.find((e) => e.empresaId === empresaFiltro)?.cantidad ?? 0) : null;

  // I36: total de unidades de la empresa seleccionada en TODA la bodega.
  const totalEmpresa = useMemo(() => {
    if (!empresaFiltro || !mapa) return 0;
    let total = 0;
    for (const p of mapa.pisos) {
      for (const a of p.areas) total += a.empresas.find((e) => e.empresaId === empresaFiltro)?.cantidad ?? 0;
      for (const pas of p.pasillos) {
        for (const z of pas.zonas) {
          for (const e of z.estantes) total += e.empresas.find((em) => em.empresaId === empresaFiltro)?.cantidad ?? 0;
        }
      }
    }
    return total;
  }, [empresaFiltro, mapa]);

  const cajonesPiso = useMemo<CajonBodega[]>(() => {
    if (!piso) return [];
    // I36: con empresa seleccionada, las cantidades y los colores del plano
    // reflejan solo los productos de esa empresa (antes solo se resaltaba la
    // zona y los porcentajes quedaban iguales).
    const cajones: CajonBodega[] = piso.areas.map((a) => {
      const emp = cantidadDeEmpresa(a.empresas);
      const cantidad = emp ?? a.cantidad;
      const colores = empresaFiltro
        ? colorOcupacion(a.cantidad > 0 ? cantidad / a.cantidad : 0)
        : colorOcupacion(a.cantidad > 0 ? 1 : 0);
      return {
        clave: `area:${a.id}`,
        tipo: 'area' as const,
        alias: a.alias || ETIQUETA_AREA[a.tipo],
        posX: a.posX,
        posY: a.posY,
        anchoM: a.anchoM,
        altoM: a.altoM,
        ...colores,
        detalle: cantidad > 0 ? `${cantidad} und` : empresaFiltro ? '0 und' : undefined,
        ref: a,
        categoria: 'area',
      } as CajonBodega & { ref: MapaArea; categoria: string };
    });
    for (const pas of piso.pasillos) {
      const estantes = pas.zonas.reduce((acc, z) => acc + z.estantes.length, 0);
      let ocup = ocupacionPasillo(pas);
      let detalle = `${estantes} estantes · ${Math.round(ocup * 100)}%`;
      if (empresaFiltro) {
        const total = pas.zonas.reduce((acc, z) => acc + z.estantes.reduce((s, e) => s + e.cantidad, 0), 0);
        const empCant = pas.zonas.reduce(
          (acc, z) => acc + z.estantes.reduce((s, e) => s + (e.empresas.find((em) => em.empresaId === empresaFiltro)?.cantidad ?? 0), 0),
          0,
        );
        ocup = total > 0 ? empCant / total : 0;
        detalle = `${empCant} und de la empresa · ${Math.round(ocup * 100)}% del contenido`;
      }
      const colores = colorOcupacion(ocup);
      cajones.push({
        clave: `pasillo:${pas.id}`,
        tipo: 'pasillo',
        alias: pas.alias,
        posX: pas.posX,
        posY: pas.posY,
        anchoM: pas.anchoM,
        altoM: pas.altoM,
        ...colores,
        detalle,
        ref: pas,
        categoria: 'pasillo',
      } as CajonBodega & { ref: MapaPasillo; categoria: string });
    }
    return cajones;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piso, empresaFiltro]);

  // Resaltado por empresa o por búsqueda.
  const resaltadas = useMemo<string[]>(() => {
    if (resultadoBusqueda) {
      return resultadoBusqueda.ubicaciones
        .map((u) => (u.rack?.zone?.aisle ? `pasillo:${u.rack.zone.aisle.id}` : u.area ? `area:${u.area.id}` : null))
        .filter((c): c is string => Boolean(c));
    }
    if (empresaFiltro && piso) {
      const claves: string[] = [];
      for (const pas of piso.pasillos) {
        if (pas.zonas.some((z) => z.estantes.some((e) => e.empresas.some((em) => em.empresaId === empresaFiltro)))) {
          claves.push(`pasillo:${pas.id}`);
        }
      }
      for (const a of piso.areas) {
        if (a.empresas.some((em) => em.empresaId === empresaFiltro)) claves.push(`area:${a.id}`);
      }
      return claves;
    }
    return [];
  }, [resultadoBusqueda, empresaFiltro, piso]);

  async function buscar(texto?: string) {
    const q = (texto ?? busqueda).trim();
    if (!q) return;
    setErrorBusqueda('');
    setResultadoBusqueda(null);
    setEmpresaFiltro('');
    const { status, body } = await api(`/warehouses/locate?q=${encodeURIComponent(q)}`);
    if (status === 200) {
      const ubicaciones = (body.ubicaciones ?? []) as UbicacionLocalizada[];
      setResultadoBusqueda({ producto: body.product, ubicaciones });
      const primeraConRack = ubicaciones.find((u) => u.rack?.zone?.aisle?.floor || u.area);
      if (primeraConRack && mapa) {
        const numeroPiso =
          primeraConRack.rack?.zone?.aisle?.floor?.numero ??
          mapa.pisos.find((p) => p.areas.some((a) => a.id === primeraConRack.area?.id))?.numero;
        const idx = mapa.pisos.findIndex((p) => p.numero === numeroPiso);
        if (idx >= 0) setPisoSel(idx);
        const pasillo = primeraConRack.rack?.zone?.aisle;
        if (pasillo) seleccionarCajonPorClave(`pasillo:${pasillo.id}`);
        else if (primeraConRack.area) seleccionarCajonPorClave(`area:${primeraConRack.area.id}`);
        if (primeraConRack.rack) {
          setRackSelId(primeraConRack.rack.id);
          setNivelSel(primeraConRack.nivel ?? null);
          cargarDetalleRack(primeraConRack.rack.id);
        }
      }
    } else {
      setErrorBusqueda(mensajeError(body, 'Producto no encontrado'));
    }
  }

  async function cargarDetalleRack(rackId: string) {
    const { status, body } = await api<RackDetalle>(`/warehouses/racks/${rackId}`);
    if (status === 200) setDetalleRack(body);
  }

  async function seleccionarCajonPorClave(clave: string) {
    const cajon = cajonesPiso.find((c) => c.clave === clave);
    if (cajon) seleccionarCajon(cajon);
  }

  async function seleccionarCajon(cajon: CajonBodega) {
    setSeleccion(cajon);
    setDetalleRack(null);
    setProductosArea(null);
    setRackSelId(null);
    setNivelSel(null);
    if (cajon.tipo === 'area') {
      const ref = cajonPorClave(cajon.clave);
      if (ref) {
        const { status, body } = await api<{ productos: UbicacionProducto[] }>(`/warehouses/areas/${ref.id}`);
        if (status === 200) setProductosArea(body.productos);
      }
    }
  }

  function cajonPorClave(clave: string): { tipo: string; id: string } | null {
    const [tipo, id] = clave.split(':');
    if ((tipo === 'pasillo' || tipo === 'area') && id) return { tipo, id };
    return null;
  }

  if (!sesion) return null;

  const pasilloSel = seleccion?.tipo === 'pasillo' ? (seleccion as CajonBodega & { ref?: MapaPasillo }).ref : null;
  const areaSel = seleccion?.tipo === 'area' ? (seleccion as CajonBodega & { ref?: MapaArea }).ref : null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo={mapa ? `Mapa del almacén · ${mapa.bodega.nombre}` : 'Mapa del almacén'}
        descripcion={
          mapa
            ? `${mapa.bodega.anchoM}×${mapa.bodega.altoM} m · ${mapa.pisos.length} piso(s)` +
              (mapa.enTransito > 0 ? ` · ${mapa.enTransito} und en tránsito` : '')
            : undefined
        }
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sofia-500 focus:outline-none"
              value={empresaFiltro}
              onChange={(e) => {
                setEmpresaFiltro(e.target.value);
                setResultadoBusqueda(null);
              }}
            >
              <option value="">Todas las empresas</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                buscar();
              }}
              className="flex gap-2"
            >
              <input
                className={`${CLASE_INPUT} w-64`}
                placeholder="Código, referencia o código de barras…"
                title="Busque por código, código OE, referencia cruzada o código de barras"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <button type="submit" className="rounded-lg bg-sofia-700 px-4 py-2 text-sm font-medium text-white hover:bg-sofia-600">
                Localizar
              </button>
            </form>
          </div>
        }
      />

      {errorCarga && (
        <Tarjeta className="p-5">
          <p className="text-sm text-slate-600">{errorCarga}</p>
          {errorCarga.includes('No se pudo') && (
            <button onClick={cargarMapa} className="mt-2 text-sm font-medium text-sofia-700 underline">
              Reintentar
            </button>
          )}
        </Tarjeta>
      )}

      {mapa && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Tarjeta className="p-5 xl:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                {mapa.pisos.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPisoSel(i);
                      setSeleccion(null);
                      setDetalleRack(null);
                      setProductosArea(null);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      pisoSel === i ? 'bg-sofia-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {p.alias ?? `Piso ${p.numero}`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> Libre
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-menta-300" /> Parcial
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-menta-500" /> Alta
                </span>
                {(resaltadas.length > 0 || empresaFiltro) && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border-2 border-amber-500 bg-white" /> Resultado
                  </span>
                )}
                {empresaFiltro && (
                  <span className="flex items-center gap-1.5 font-medium text-sofia-700">
                    {totalEmpresa} und de la empresa en la bodega
                  </span>
                )}
              </div>
            </div>
            {piso && (
              <MapaBodega
                anchoM={mapa.bodega.anchoM}
                altoM={mapa.bodega.altoM}
                cajones={cajonesPiso}
                seleccionada={seleccion?.clave ?? null}
                resaltadas={resaltadas}
                onSeleccionar={seleccionarCajon}
              />
            )}
          </Tarjeta>

          <div className="space-y-4">
            {resultadoBusqueda && (
              <Tarjeta className="border-2 border-amber-400 p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{resultadoBusqueda.producto.codigo}</p>
                    <p className="text-xs text-slate-500">{resultadoBusqueda.producto.descripcion}</p>
                  </div>
                  <button
                    onClick={() => {
                      setResultadoBusqueda(null);
                      setBusqueda('');
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Cerrar
                  </button>
                </div>
                {resultadoBusqueda.ubicaciones.length === 0 && (
                  <p className="text-sm text-slate-500">El producto no tiene ubicación asignada en la bodega.</p>
                )}
                <ul className="space-y-1.5">
                  {resultadoBusqueda.ubicaciones.map((u) => (
                    <li key={u.id} className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
                      <span className="text-slate-700">
                        {u.transito && 'En tránsito'}
                        {u.rack?.zone?.aisle &&
                          `Piso ${u.rack.zone.aisle.floor?.numero} · Pasillo ${u.rack.zone.aisle.numero} · ${ETIQUETA_LADO[u.rack.zone.lado] ?? u.rack.zone.lado} · ${u.rack.alias}` +
                            (u.nivel ? ` · Nivel ${u.nivel}` : '')}
                        {!u.transito && u.area && `${ETIQUETA_AREA[u.area.tipo] ?? u.area.alias}`}
                      </span>
                      <span className="ml-2 flex items-center gap-1">
                        <Insignia tono="azul">{u.cantidad} und</Insignia>
                        {u.esOficial && <Insignia tono="menta">Oficial</Insignia>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}
            {errorBusqueda && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorBusqueda}</p>}

            <Tarjeta className="p-5">
              {!seleccion && !resultadoBusqueda && (
                <p className="text-sm text-slate-500">
                  Toque un pasillo o un área del plano para ver sus zonas, estantes y productos.
                </p>
              )}

              {pasilloSel && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{seleccion?.alias}</h2>
                  <div className="space-y-3">
                    {pasilloSel.zonas.map((zona) => (
                      <div key={zona.id}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {zona.alias || ETIQUETA_LADO[zona.lado]}
                        </p>
                        {zona.estantes.length === 0 && (
                          <p className="text-sm text-slate-400">Espacio libre (sin estantes).</p>
                        )}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {zona.estantes.map((est) => {
                            // I36: con filtro por empresa, el detalle del estante muestra sus unidades.
                            const empCant = empresaFiltro
                              ? (est.empresas.find((em) => em.empresaId === empresaFiltro)?.cantidad ?? 0)
                              : null;
                            const cantidadMostrada = empCant ?? est.cantidad;
                            const anchoBarra = empresaFiltro
                              ? (est.cantidad > 0 ? (empCant! / est.cantidad) * 100 : 0)
                              : est.ocupacion * 100;
                            return (
                            <button
                              key={est.id}
                              onClick={() => {
                                setRackSelId(est.id);
                                setNivelSel(null);
                                cargarDetalleRack(est.id);
                              }}
                              className={`rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                                rackSelId === est.id
                                  ? 'border-sofia-600 bg-sofia-50'
                                  : 'border-slate-200 bg-white hover:bg-slate-50'
                              }`}
                            >
                              <p className="font-semibold text-slate-800">{est.alias}</p>
                              <p className="text-slate-500">
                                {est.nivelesOcupados}/{est.niveles} niveles · {cantidadMostrada} und
                                {empresaFiltro ? ' (empresa)' : ''}
                              </p>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                                <div
                                  className="h-1.5 rounded-full bg-menta-500"
                                  style={{ width: `${Math.round(anchoBarra)}%` }}
                                />
                              </div>
                            </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {areaSel && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    {areaSel.alias || ETIQUETA_AREA[areaSel.tipo]}
                  </h2>
                  {productosArea === null && <p className="text-sm text-slate-400">Cargando…</p>}
                  {productosArea !== null && productosArea.length === 0 && (
                    <p className="text-sm text-slate-500">Sin productos en esta área.</p>
                  )}
                  {productosArea && productosArea.length > 0 && (
                    <ul className="space-y-1.5">
                      {productosArea.map((p) => (
                        <li key={p.ubicacionId} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="text-slate-700">
                            <span className="font-medium">{p.codigo}</span> · {p.descripcion}
                            {p.empresa && <span className="ml-1 text-xs text-slate-400">({p.empresa})</span>}
                          </span>
                          <Insignia tono="azul">{p.cantidad} und</Insignia>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Tarjeta>

            {detalleRack && rackSelId && (
              <Tarjeta className="p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {detalleRack.rack.alias} · niveles
                </h2>
                <div className="mb-3 flex flex-wrap gap-2">
                  {detalleRack.niveles.map((n) => (
                    <button
                      key={n.nivel}
                      onClick={() => setNivelSel(n.nivel)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                        nivelSel === n.nivel
                          ? 'bg-sofia-700 text-white'
                          : n.productos.length > 0
                            ? 'bg-menta-100 text-menta-700 hover:bg-menta-200'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      N{n.nivel}
                      {n.productos.length > 0 && ` (${n.productos.reduce((a, p) => a + p.cantidad, 0)})`}
                    </button>
                  ))}
                </div>
                {nivelSel !== null && (
                  <ul className="space-y-1.5">
                    {detalleRack.niveles
                      .find((n) => n.nivel === nivelSel)
                      ?.productos.map((p) => (
                        <li key={p.ubicacionId} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="text-slate-700">
                            <span className="font-medium">{p.codigo}</span> · {p.descripcion}
                            {p.empresa && <span className="ml-1 text-xs text-slate-400">({p.empresa})</span>}
                          </span>
                          <span className="ml-2 flex items-center gap-1">
                            <Insignia tono="azul">{p.cantidad} und</Insignia>
                            {p.esOficial && <Insignia tono="menta">Oficial</Insignia>}
                          </span>
                        </li>
                      ))}
                    {detalleRack.niveles.find((n) => n.nivel === nivelSel)?.productos.length === 0 && (
                      <p className="text-sm text-slate-400">Nivel vacío.</p>
                    )}
                  </ul>
                )}
                {nivelSel === null && <p className="text-sm text-slate-400">Seleccione un nivel para ver sus productos.</p>}

                {/* I35: el mapa es solo de visualización; la asignación se hace desde la ficha del producto */}
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                  Para asignar o modificar ubicaciones use la ficha del producto en la vista de Productos.
                </p>
              </Tarjeta>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function MapaPageWrapper() {
  return (
    <Suspense>
      <MapaPage />
    </Suspense>
  );
}
