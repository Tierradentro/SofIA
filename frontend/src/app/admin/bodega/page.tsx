'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, mensajeError, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { CajonBodega, MapaBodega } from '@/components/mapa-bodega';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_INPUT,
  EncabezadoPagina,
  Insignia,
  Tarjeta,
} from '@/components/ui';

/**
 * I32 (Fase 2 - Mapa 2D, HU-014): asistente de configuración de la bodega
 * (solo Administrador). Dos pestañas:
 *  - "Estructura": forma, dimensiones, pisos → pasillos → zonas → estantes.
 *  - "Organizar cajones": mover/redimensionar pasillos y áreas dentro del
 *    perímetro con arrastre, y renombrarlos.
 */

// ---------- Tipos del mapa (respuesta del backend) ----------

interface MapaRack {
  id: string;
  numero: number;
  alias: string;
  niveles: number;
  cantidad: number;
  nivelesOcupados: number;
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
  color?: string | null;
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
}
interface MapaPiso {
  id: string;
  numero: number;
  alias: string;
  tieneAreasFijas: boolean;
  pasillos: MapaPasillo[];
  areas: MapaArea[];
}
interface MapaRespuesta {
  bodega: { id: string; nombre: string; forma: 'RECTANGULO' | 'CUADRADO'; anchoM: number; altoM: number };
  pisos: MapaPiso[];
}

// ---------- Modelo del asistente ----------

interface PasilloForm {
  estIzq: number;
  nivIzq: number;
  estDer: number;
  nivDer: number;
  conFondo: boolean;
}
interface PisoForm {
  pasillos: PasilloForm[];
}
interface EstructuraForm {
  nombre: string;
  forma: 'RECTANGULO' | 'CUADRADO';
  anchoM: number;
  altoM: number;
  pisos: PisoForm[];
}

const PASILLO_BASE: PasilloForm = { estIzq: 5, nivIzq: 3, estDer: 5, nivDer: 3, conFondo: true };

const FORM_INICIAL: EstructuraForm = {
  nombre: 'Bodega Principal',
  forma: 'RECTANGULO',
  anchoM: 40,
  altoM: 30,
  pisos: [
    { pasillos: [{ ...PASILLO_BASE }, { ...PASILLO_BASE }, { ...PASILLO_BASE }] },
    { pasillos: [{ ...PASILLO_BASE }, { ...PASILLO_BASE }, { ...PASILLO_BASE }] },
  ],
};

const MAX_PISOS = 5;
const MAX_PASILLOS = 20;
const MAX_ESTANTES = 10;
const MAX_NIVELES = 12;

// ---------- Colores del lienzo (paleta sofia/menta) ----------

const COLORES = {
  pasillo: { relleno: '#d9eaff', borde: '#1e6fd9', texto: '#0d3058' },
  patio: { relleno: '#f1f5f9', borde: '#94a3b8', texto: '#475569' },
  empaque: { relleno: '#a5f3da', borde: '#17b795', texto: '#0a2547' },
  temporal: { relleno: '#d0faec', borde: '#17b795', texto: '#0a2547' },
  entrada: { relleno: '#3fd9b8', borde: '#0d9379', texto: '#0b7561' },
};

function coloresArea(tipo: MapaArea['tipo']) {
  switch (tipo) {
    case 'ENTRADA':
      return COLORES.entrada;
    case 'PATIO_MANIOBRAS':
      return COLORES.patio;
    case 'BAHIA_EMPAQUE':
      return COLORES.empaque;
    case 'BAHIA_TEMPORAL':
      return COLORES.temporal;
  }
}

// ---------- Geometría por defecto (idéntica a la que crea el backend) ----------

function areasFijasPiso1(anchoM: number): Array<Omit<MapaArea, 'id'>> {
  return [
    { tipo: 'ENTRADA', alias: 'Entrada', posX: anchoM / 2 - 3, posY: 0, anchoM: 6, altoM: 0 },
    { tipo: 'PATIO_MANIOBRAS', alias: 'Patio de Maniobras', posX: 2, posY: 1, anchoM: anchoM - 4, altoM: 4 },
    { tipo: 'BAHIA_EMPAQUE', alias: 'Bahía de Empaque', posX: 2, posY: 6, anchoM: 8, altoM: 4 },
    { tipo: 'BAHIA_TEMPORAL', alias: 'Bahía Temporal', posX: anchoM - 10, posY: 6, anchoM: 8, altoM: 4 },
  ];
}

/** Posición por defecto de los pasillos de un piso (rejilla horizontal). */
function posicionPasillo(form: EstructuraForm, pisoIndice: number, pasilloIndice: number, total: number) {
  const base = pisoIndice === 0 ? 12 : 2; // el piso 1 deja el borde inferior a las áreas fijas
  const altoP = Math.max(4, Math.min(16, form.altoM - base - 2));
  const anchoP = Math.max(3, Math.min(12, (form.anchoM - 4 - (total - 1) * 2) / total));
  return { posX: 2 + pasilloIndice * (anchoP + 2), posY: base, anchoM: Math.round(anchoP * 10) / 10, altoM: altoP };
}

function detallePasillo(p: PasilloForm): string {
  const lados = [];
  if (p.estIzq > 0) lados.push(`${p.estIzq}×${p.nivIzq} izq`);
  if (p.estDer > 0) lados.push(`${p.estDer}×${p.nivDer} der`);
  if (p.conFondo) lados.push('fondo');
  return lados.join(' · ');
}

/** Cajones de vista previa del asistente para un piso. */
function previsualizarPiso(form: EstructuraForm, pisoIndice: number): CajonBodega[] {
  const piso = form.pisos[pisoIndice];
  const cajones: CajonBodega[] = [];
  if (pisoIndice === 0) {
    for (const a of areasFijasPiso1(form.anchoM)) {
      const colores = coloresArea(a.tipo);
      cajones.push({
        clave: `area:${a.tipo}`,
        tipo: 'area',
        alias: a.alias,
        posX: a.posX,
        posY: a.posY,
        anchoM: a.anchoM,
        altoM: a.altoM,
        ...colores,
      });
    }
  }
  piso.pasillos.forEach((p, i) => {
    const geo = posicionPasillo(form, pisoIndice, i, piso.pasillos.length);
    cajones.push({
      clave: `pasillo:${i + 1}`,
      tipo: 'pasillo',
      alias: `Pasillo ${i + 1}`,
      ...geo,
      ...COLORES.pasillo,
      detalle: detallePasillo(p),
    });
  });
  return cajones;
}

/** Payload POST /warehouses/configurar a partir del asistente. */
function construirPayload(form: EstructuraForm) {
  return {
    nombre: form.nombre,
    forma: form.forma,
    anchoM: form.anchoM,
    altoM: form.altoM,
    pisos: form.pisos.map((piso, i) => ({
      numero: i + 1,
      tieneAreasFijas: i === 0,
      pasillos: piso.pasillos.map((p, j) => {
        const geo = posicionPasillo(form, i, j, piso.pasillos.length);
        const zonas: Array<Record<string, unknown>> = [];
        if (p.estIzq > 0) {
          zonas.push({
            lado: 'IZQUIERDA',
            estantes: Array.from({ length: p.estIzq }, (_, k) => ({ numero: k + 1, niveles: p.nivIzq })),
          });
        }
        if (p.estDer > 0) {
          zonas.push({
            lado: 'DERECHA',
            estantes: Array.from({ length: p.estDer }, (_, k) => ({ numero: k + 1, niveles: p.nivDer })),
          });
        }
        if (p.conFondo) zonas.push({ lado: 'FONDO', estantes: [] });
        return { numero: j + 1, ...geo, zonas };
      }),
    })),
  };
}

/** Prefill del asistente desde la bodega ya configurada. */
function formDesdeMapa(mapa: MapaRespuesta): EstructuraForm {
  return {
    nombre: mapa.bodega.nombre,
    forma: mapa.bodega.forma,
    anchoM: mapa.bodega.anchoM,
    altoM: mapa.bodega.altoM,
    pisos: mapa.pisos.map((piso) => ({
      pasillos: piso.pasillos.map((pas) => {
        const izq = pas.zonas.find((z) => z.lado === 'IZQUIERDA');
        const der = pas.zonas.find((z) => z.lado === 'DERECHA');
        return {
          estIzq: izq?.estantes.length ?? 0,
          nivIzq: izq?.estantes[0]?.niveles ?? 3,
          estDer: der?.estantes.length ?? 0,
          nivDer: der?.estantes[0]?.niveles ?? 3,
          conFondo: pas.zonas.some((z) => z.lado === 'FONDO'),
        };
      }),
    })),
  };
}

function validarForm(form: EstructuraForm): string | null {
  if (!form.nombre.trim()) return 'El nombre de la bodega es requerido.';
  if (form.anchoM < 20 || form.altoM < 18) {
    return 'Las dimensiones mínimas para el diseño son 20 m de ancho × 18 m de alto (caben las áreas fijas y los pasillos).';
  }
  for (const [i, piso] of Array.from(form.pisos.entries())) {
    if (piso.pasillos.length === 0) return `El piso ${i + 1} no tiene pasillos.`;
    for (const [j, p] of Array.from(piso.pasillos.entries())) {
      if (p.estIzq === 0 && p.estDer === 0 && !p.conFondo) {
        return `El pasillo ${j + 1} del piso ${i + 1} no tiene zonas (active estantes a un lado o el fondo).`;
      }
    }
  }
  return null;
}

// ---------- Página ----------

export default function BodegaPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [pestana, setPestana] = useState<'estructura' | 'cajones'>('estructura');
  const [mapa, setMapa] = useState<MapaRespuesta | null>(null);
  const [errorCarga, setErrorCarga] = useState('');

  // Asistente
  const [form, setForm] = useState<EstructuraForm>(FORM_INICIAL);
  const [pisoPreview, setPisoPreview] = useState(0);
  const [personalizar, setPersonalizar] = useState<Record<number, boolean>>({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  // Editor de cajones
  const [pisoSel, setPisoSel] = useState(0);
  const [seleccion, setSeleccion] = useState<CajonBodega | null>(null);
  const [aliasEd, setAliasEd] = useState('');
  const [colorEd, setColorEd] = useState('');
  const [anchoEd, setAnchoEd] = useState(0);
  const [altoEd, setAltoEd] = useState(0);
  const [errorEd, setErrorEd] = useState('');
  const [mensajeEd, setMensajeEd] = useState('');

  async function cargarMapa(): Promise<MapaRespuesta | null> {
    setErrorCarga('');
    try {
      const { status, body } = await api<MapaRespuesta>('/warehouses/map');
      if (status === 200) {
        setMapa(body);
        return body;
      }
      if (status === 404) {
        setMapa(null);
        return null;
      }
      if (status === 403) {
        router.replace('/dashboard');
        return null;
      }
      setErrorCarga('No se pudo cargar la bodega. Intente de nuevo.');
      return null;
    } catch {
      setErrorCarga('No hay comunicación con el servidor. Verifique la conexión e intente de nuevo.');
      return null;
    }
  }

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol !== 'ADMINISTRADOR') return router.replace('/dashboard');
    setSesion(s);
    cargarMapa().then((m) => {
      if (m) setForm(formDesdeMapa(m));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ---------- Asistente: estructura ----------

  function actualizarPiso(indice: number, cambios: (piso: PisoForm) => PisoForm) {
    setForm((f) => ({
      ...f,
      pisos: f.pisos.map((p, i) => (i === indice ? cambios(p) : p)),
    }));
  }

  function fijarNumPasillos(indice: number, n: number) {
    const cantidad = Math.max(1, Math.min(MAX_PASILLOS, Math.round(n) || 1));
    actualizarPiso(indice, (piso) => {
      const pasillos = [...piso.pasillos];
      while (pasillos.length < cantidad) pasillos.push({ ...PASILLO_BASE });
      return { pasillos: pasillos.slice(0, cantidad) };
    });
  }

  function aplicarATodos(indice: number, campo: keyof PasilloForm, valor: number | boolean) {
    actualizarPiso(indice, (piso) => ({
      pasillos: piso.pasillos.map((p) => ({ ...p, [campo]: valor })),
    }));
  }

  function actualizarPasillo(pisoIndice: number, pasilloIndice: number, campo: keyof PasilloForm, valor: number | boolean) {
    actualizarPiso(pisoIndice, (piso) => ({
      pasillos: piso.pasillos.map((p, i) => (i === pasilloIndice ? { ...p, [campo]: valor } : p)),
    }));
  }

  async function guardarEstructura() {
    setError('');
    setMensaje('');
    const problema = validarForm(form);
    if (problema) {
      setError(problema);
      return;
    }
    if (
      mapa &&
      !window.confirm(
        'Reconfigurar la bodega reemplaza la estructura actual (pisos, pasillos, zonas y estantes) y se pierden las ubicaciones asignadas a productos. ¿Continuar?',
      )
    ) {
      return;
    }
    setGuardando(true);
    const { status, body } = await api('/warehouses/configure', {
      method: 'POST',
      body: JSON.stringify(construirPayload(form)),
    });
    setGuardando(false);
    if (status === 200 || status === 201) {
      setMensaje('Bodega configurada. Ahora puede organizar los cajones en el plano.');
      const m = await cargarMapa();
      if (m) setForm(formDesdeMapa(m));
      setPestana('cajones');
    } else {
      setError(mensajeError(body, 'No se pudo guardar la configuración'));
    }
  }

  // ---------- Editor de cajones ----------

  const cajonesPiso = useMemo<CajonBodega[]>(() => {
    if (!mapa) return [];
    const piso = mapa.pisos[pisoSel];
    if (!piso) return [];
    const cajones: CajonBodega[] = piso.areas.map((a) => ({
      clave: `area:${a.id}`,
      tipo: 'area' as const,
      alias: a.alias,
      posX: a.posX,
      posY: a.posY,
      anchoM: a.anchoM,
      altoM: a.altoM,
      ...coloresArea(a.tipo),
    }));
    for (const pas of piso.pasillos) {
      const estantes = pas.zonas.reduce((acc, z) => acc + z.estantes.length, 0);
      const conFondo = pas.zonas.some((z) => z.lado === 'FONDO');
      cajones.push({
        clave: `pasillo:${pas.id}`,
        tipo: 'pasillo',
        alias: pas.alias,
        posX: pas.posX,
        posY: pas.posY,
        anchoM: pas.anchoM,
        altoM: pas.altoM,
        relleno: pas.color ?? COLORES.pasillo.relleno,
        borde: COLORES.pasillo.borde,
        texto: COLORES.pasillo.texto,
        detalle: `${estantes} estantes${conFondo ? ' · fondo' : ''}`,
      });
    }
    return cajones;
  }, [mapa, pisoSel]);

  function cajonPorClave(clave: string): { tipo: 'pasillo' | 'area'; id: string } | null {
    const [tipo, id] = clave.split(':');
    if ((tipo === 'pasillo' || tipo === 'area') && id) return { tipo, id };
    return null;
  }

  async function moverCajon(cajon: CajonBodega, posX: number, posY: number): Promise<boolean> {
    const ref = cajonPorClave(cajon.clave);
    if (!ref) return false;
    setErrorEd('');
    const { status, body } = await api(`/warehouses/${ref.tipo}/${ref.id}/posicion`, {
      method: 'PATCH',
      body: JSON.stringify({ posX, posY }),
    });
    if (status === 200) {
      await cargarMapa();
      return true;
    }
    setErrorEd(mensajeError(body, 'No se pudo mover el cajón'));
    return false;
  }

  function seleccionar(cajon: CajonBodega) {
    setSeleccion(cajon);
    setAliasEd(cajon.alias);
    setColorEd(cajon.tipo === 'pasillo' ? cajon.relleno : '');
    setAnchoEd(cajon.anchoM);
    setAltoEd(cajon.altoM);
    setErrorEd('');
    setMensajeEd('');
  }

  async function guardarCajon() {
    if (!seleccion) return;
    const ref = cajonPorClave(seleccion.clave);
    if (!ref) return;
    setErrorEd('');
    setMensajeEd('');
    const payload: Record<string, unknown> = {
      posX: seleccion.posX,
      posY: seleccion.posY,
      alias: aliasEd,
      anchoM: anchoEd,
      altoM: seleccion.tipo === 'area' && seleccion.altoM === 0 ? 0 : altoEd,
    };
    if (seleccion.tipo === 'pasillo' && colorEd) payload.color = colorEd;
    const { status, body } = await api(`/warehouses/${ref.tipo}/${ref.id}/posicion`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (status === 200) {
      setMensajeEd(`"${aliasEd}" actualizado.`);
      setSeleccion(null);
      await cargarMapa();
    } else {
      setErrorEd(mensajeError(body, 'No se pudo guardar el cajón'));
    }
  }

  if (!sesion) return null;

  const pisoPreviewSeguro = Math.min(pisoPreview, form.pisos.length - 1);

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Configuración de la bodega"
        descripcion="Defina la forma y la estructura (pisos, pasillos, zonas y estantes) y luego organice los cajones dentro del perímetro."
      />

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setPestana('estructura')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            pestana === 'estructura' ? 'bg-sofia-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
          }`}
        >
          1. Estructura
        </button>
        <button
          onClick={() => setPestana('cajones')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            pestana === 'cajones' ? 'bg-sofia-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
          }`}
        >
          2. Organizar cajones
        </button>
        {mapa && (
          <span className="ml-auto self-center">
            <Insignia tono="menta">{mapa.bodega.nombre} configurada</Insignia>
          </span>
        )}
      </div>

      {errorCarga && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorCarga}{' '}
          <button onClick={() => cargarMapa()} className="font-medium text-sofia-700 underline">
            Reintentar
          </button>
        </p>
      )}

      {pestana === 'estructura' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <Tarjeta className="p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Forma de la bodega</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-sm text-slate-600">
                  Nombre
                  <input
                    className={`mt-1 ${CLASE_INPUT}`}
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Forma
                  <select
                    className={`mt-1 ${CLASE_INPUT}`}
                    value={form.forma}
                    onChange={(e) => {
                      const forma = e.target.value as 'RECTANGULO' | 'CUADRADO';
                      setForm((f) => ({
                        ...f,
                        forma,
                        altoM: forma === 'CUADRADO' ? f.anchoM : f.altoM,
                      }));
                    }}
                  >
                    <option value="RECTANGULO">Rectángulo</option>
                    <option value="CUADRADO">Cuadrado</option>
                  </select>
                </label>
                <label className="text-sm text-slate-600">
                  Ancho (m)
                  <input
                    type="number"
                    min={20}
                    max={500}
                    className={`mt-1 ${CLASE_INPUT}`}
                    value={form.anchoM}
                    onChange={(e) => {
                      const anchoM = Number(e.target.value) || 0;
                      setForm((f) => ({ ...f, anchoM, altoM: f.forma === 'CUADRADO' ? anchoM : f.altoM }));
                    }}
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Alto (m)
                  <input
                    type="number"
                    min={18}
                    max={500}
                    className={`mt-1 ${CLASE_INPUT}`}
                    value={form.altoM}
                    disabled={form.forma === 'CUADRADO'}
                    onChange={(e) => setForm({ ...form, altoM: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
            </Tarjeta>

            {form.pisos.map((piso, i) => (
              <Tarjeta key={i} className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Piso {i + 1}
                    {i === 0 && (
                      <span className="ml-2 text-xs font-normal normal-case text-slate-400">
                        (incluye entrada, patio de maniobras, bahía de empaque y bahía temporal)
                      </span>
                    )}
                  </h2>
                  {form.pisos.length > 1 && i === form.pisos.length - 1 && (
                    <button
                      onClick={() => setForm((f) => ({ ...f, pisos: f.pisos.slice(0, -1) }))}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Quitar piso
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="text-sm text-slate-600">
                    Pasillos
                    <input
                      type="number"
                      min={1}
                      max={MAX_PASILLOS}
                      className={`mt-1 ${CLASE_INPUT}`}
                      value={piso.pasillos.length}
                      onChange={(e) => fijarNumPasillos(i, Number(e.target.value))}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Estantes por lado
                    <input
                      type="number"
                      min={0}
                      max={MAX_ESTANTES}
                      className={`mt-1 ${CLASE_INPUT}`}
                      value={piso.pasillos[0]?.estIzq ?? 0}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(MAX_ESTANTES, Number(e.target.value) || 0));
                        aplicarATodos(i, 'estIzq', v);
                        aplicarATodos(i, 'estDer', v);
                      }}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Niveles por estante
                    <input
                      type="number"
                      min={1}
                      max={MAX_NIVELES}
                      className={`mt-1 ${CLASE_INPUT}`}
                      value={piso.pasillos[0]?.nivIzq ?? 3}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(MAX_NIVELES, Number(e.target.value) || 1));
                        aplicarATodos(i, 'nivIzq', v);
                        aplicarATodos(i, 'nivDer', v);
                      }}
                    />
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={piso.pasillos.every((p) => p.conFondo)}
                      onChange={(e) => aplicarATodos(i, 'conFondo', e.target.checked)}
                    />
                    Espacio al fondo
                  </label>
                </div>

                <button
                  onClick={() => setPersonalizar((prev) => ({ ...prev, [i]: !prev[i] }))}
                  className="mt-3 text-xs font-medium text-sofia-700 underline hover:text-sofia-800"
                >
                  {personalizar[i] ? 'Ocultar personalización por pasillo' : 'Personalizar por pasillo'}
                </button>

                {personalizar[i] && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className="px-2 py-2">Pasillo</th>
                          <th className="px-2 py-2">Estantes izq.</th>
                          <th className="px-2 py-2">Niveles izq.</th>
                          <th className="px-2 py-2">Estantes der.</th>
                          <th className="px-2 py-2">Niveles der.</th>
                          <th className="px-2 py-2">Fondo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {piso.pasillos.map((p, j) => (
                          <tr key={j} className="border-b border-slate-100 last:border-0">
                            <td className="px-2 py-2 font-medium text-slate-700">#{j + 1}</td>
                            {(
                              [
                                ['estIzq', MAX_ESTANTES],
                                ['nivIzq', MAX_NIVELES],
                                ['estDer', MAX_ESTANTES],
                                ['nivDer', MAX_NIVELES],
                              ] as Array<[keyof PasilloForm, number]>
                            ).map(([campo, max]) => (
                              <td key={campo} className="px-2 py-2">
                                <input
                                  type="number"
                                  min={campo.startsWith('niv') ? 1 : 0}
                                  max={max}
                                  className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                                  value={p[campo] as number}
                                  onChange={(e) =>
                                    actualizarPasillo(i, j, campo, Math.max(0, Math.min(max, Number(e.target.value) || 0)))
                                  }
                                />
                              </td>
                            ))}
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300"
                                checked={p.conFondo}
                                onChange={(e) => actualizarPasillo(i, j, 'conFondo', e.target.checked)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Tarjeta>
            ))}

            <div>
              {form.pisos.length < MAX_PISOS && (
                <button
                  onClick={() =>
                    setForm((f) => ({ ...f, pisos: [...f.pisos, { pasillos: [{ ...PASILLO_BASE }] }] }))
                  }
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  + Añadir piso
                </button>
              )}
            </div>

            <div>
              <button onClick={guardarEstructura} disabled={guardando} className={CLASE_BOTON_PRIMARIO}>
                {guardando ? 'Guardando…' : mapa ? 'Reconfigurar bodega' : 'Crear bodega'}
              </button>
              {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {mensaje && <p className="mt-3 rounded-lg bg-menta-50 px-3 py-2 text-sm text-menta-700">{mensaje}</p>}
            </div>
          </div>

          <Tarjeta className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Vista previa</h2>
              <div className="flex gap-1">
                {form.pisos.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPisoPreview(i)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium ${
                      pisoPreviewSeguro === i ? 'bg-sofia-700 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    Piso {i + 1}
                  </button>
                ))}
              </div>
            </div>
            <MapaBodega
              anchoM={form.anchoM}
              altoM={form.altoM}
              cajones={previsualizarPiso(form, pisoPreviewSeguro)}
            />
            <p className="mt-3 text-xs text-slate-400">
              Las posiciones son una propuesta inicial; en la pestaña «Organizar cajones» puede arrastrarlas dentro del
              perímetro.
            </p>
          </Tarjeta>
        </div>
      )}

      {pestana === 'cajones' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Tarjeta className="p-5 xl:col-span-2">
            {!mapa && !errorCarga && (
              <p className="text-sm text-slate-500">
                Aún no hay bodega configurada. Defina la estructura en la pestaña anterior.
              </p>
            )}
            {mapa && (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    {mapa.bodega.nombre} · {mapa.bodega.anchoM}×{mapa.bodega.altoM} m
                  </h2>
                  <div className="flex gap-1">
                    {mapa.pisos.map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPisoSel(i);
                          setSeleccion(null);
                        }}
                        className={`rounded-lg px-3 py-1 text-xs font-medium ${
                          pisoSel === i ? 'bg-sofia-700 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.alias ?? `Piso ${p.numero}`}
                      </button>
                    ))}
                  </div>
                </div>
                <MapaBodega
                  anchoM={mapa.bodega.anchoM}
                  altoM={mapa.bodega.altoM}
                  cajones={cajonesPiso}
                  seleccionada={seleccion?.clave ?? null}
                  onSeleccionar={seleccionar}
                  onArrastrar={moverCajon}
                />
                <p className="mt-3 text-xs text-slate-400">
                  Arrastre los cajones para ubicarlos dentro del perímetro. Toque un cajón para renombrarlo, cambiar su
                  color o ajustar su tamaño.
                </p>
              </>
            )}
          </Tarjeta>

          <Tarjeta className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Cajón seleccionado</h2>
            {!seleccion && <p className="text-sm text-slate-500">Seleccione un pasillo o área en el plano.</p>}
            {seleccion && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  <Insignia tono={seleccion.tipo === 'pasillo' ? 'azul' : 'menta'}>
                    {seleccion.tipo === 'pasillo' ? 'Pasillo' : 'Área'}
                  </Insignia>
                </p>
                <label className="block text-sm text-slate-600">
                  Alias
                  <input className={`mt-1 ${CLASE_INPUT}`} value={aliasEd} onChange={(e) => setAliasEd(e.target.value)} />
                </label>
                {seleccion.tipo === 'pasillo' && (
                  <label className="block text-sm text-slate-600">
                    Color
                    <input
                      type="color"
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300"
                      value={colorEd || COLORES.pasillo.relleno}
                      onChange={(e) => setColorEd(e.target.value)}
                    />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-600">
                    Ancho (m)
                    <input
                      type="number"
                      min={1}
                      className={`mt-1 ${CLASE_INPUT}`}
                      value={anchoEd}
                      onChange={(e) => setAnchoEd(Number(e.target.value) || 1)}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Alto (m)
                    <input
                      type="number"
                      min={seleccion.tipo === 'area' && seleccion.altoM === 0 ? 0 : 1}
                      disabled={seleccion.tipo === 'area' && seleccion.altoM === 0}
                      className={`mt-1 ${CLASE_INPUT}`}
                      value={altoEd}
                      onChange={(e) => setAltoEd(Number(e.target.value) || 0)}
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={guardarCajon} className={CLASE_BOTON_PRIMARIO}>
                    Guardar cajón
                  </button>
                  <button onClick={() => setSeleccion(null)} className={CLASE_BOTON_SECUNDARIO}>
                    Cerrar
                  </button>
                </div>
                {errorEd && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorEd}</p>}
                {mensajeEd && <p className="rounded-lg bg-menta-50 px-3 py-2 text-sm text-menta-700">{mensajeEd}</p>}
              </div>
            )}
          </Tarjeta>
        </div>
      )}
    </AppShell>
  );
}
