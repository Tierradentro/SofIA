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
 * I35:
 *  - Áreas adicionales por piso (bahía, patio, entrada) configurables.
 *  - Los pisos nuevos ubican sus pasillos de arriba hacia abajo.
 *  - «Organizar cajones» tiene botón «Guardar cambios» para persistir los
 *    movimientos; al guardar, la vista previa de «1. Estructura» refleja la
 *    distribución real guardada (posiciones, alias y colores).
 *  - Los cajones tipo área también admiten cambio de color.
 *  - Cada estante puede configurarse de forma individual (2 o más niveles).
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
  color?: string | null;
  posX: number;
  posY: number;
  anchoM: number;
  altoM: number;
  permiteProductos: boolean;
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
  /** I35: niveles de cada estante (un estante puede tener 2 o más niveles, de forma individual). */
  nivelesIzq: number[];
  nivelesDer: number[];
  conFondo: boolean;
}
/** I35: áreas adicionales configurables por piso (bahía, patio, entrada). */
interface AreaForm {
  tipo: MapaArea['tipo'];
  alias: string;
  permiteProductos: boolean;
}
interface PisoForm {
  pasillos: PasilloForm[];
  areas: AreaForm[];
}
interface EstructuraForm {
  nombre: string;
  forma: 'RECTANGULO' | 'CUADRADO';
  anchoM: number;
  altoM: number;
  pisos: PisoForm[];
}

const PASILLO_BASE: PasilloForm = { nivelesIzq: [3, 3, 3, 3, 3], nivelesDer: [3, 3, 3, 3, 3], conFondo: true };

function clonarPasillo(p: PasilloForm): PasilloForm {
  return { nivelesIzq: [...p.nivelesIzq], nivelesDer: [...p.nivelesDer], conFondo: p.conFondo };
}

const FORM_INICIAL: EstructuraForm = {
  nombre: 'Bodega Principal',
  forma: 'RECTANGULO',
  anchoM: 40,
  altoM: 30,
  pisos: [
    { pasillos: [clonarPasillo(PASILLO_BASE), clonarPasillo(PASILLO_BASE), clonarPasillo(PASILLO_BASE)], areas: [] },
    { pasillos: [clonarPasillo(PASILLO_BASE), clonarPasillo(PASILLO_BASE), clonarPasillo(PASILLO_BASE)], areas: [] },
  ],
};

const TIPOS_AREA: Array<MapaArea['tipo']> = ['ENTRADA', 'PATIO_MANIOBRAS', 'BAHIA_EMPAQUE', 'BAHIA_TEMPORAL'];

const ETIQUETA_AREA: Record<MapaArea['tipo'], string> = {
  ENTRADA: 'Entrada',
  PATIO_MANIOBRAS: 'Patio de maniobras',
  BAHIA_EMPAQUE: 'Bahía de empaque',
  BAHIA_TEMPORAL: 'Bahía temporal',
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

function areasFijasPiso1(anchoM: number): Array<Omit<MapaArea, 'id' | 'permiteProductos'>> {
  // I36: las únicas áreas fijas son entrada, patio de maniobras y bahía de
  // empaque; la bahía temporal pasa a ser un área adicional (crear/eliminar).
  return [
    { tipo: 'ENTRADA', alias: 'Entrada', posX: anchoM / 2 - 3, posY: 0, anchoM: 6, altoM: 0 },
    { tipo: 'PATIO_MANIOBRAS', alias: 'Patio de Maniobras', posX: 2, posY: 1, anchoM: anchoM - 4, altoM: 4 },
    { tipo: 'BAHIA_EMPAQUE', alias: 'Bahía de Empaque', posX: 2, posY: 6, anchoM: 8, altoM: 4 },
  ];
}

/** I36: tipos de las áreas fijas del piso 1 (no se repiten como adicionales). */
const TIPOS_AREA_FIJA: Array<MapaArea['tipo']> = ['ENTRADA', 'PATIO_MANIOBRAS', 'BAHIA_EMPAQUE'];

/**
 * Posición por defecto de los pasillos de un piso (rejilla horizontal).
 * I35: el piso 1 deja el borde inferior a las áreas fijas; los pisos nuevos se
 * ubican de arriba hacia abajo, dejando libre la franja inferior para las áreas.
 */
function posicionPasillo(form: EstructuraForm, pisoIndice: number, pasilloIndice: number, total: number) {
  const altoP = Math.max(4, Math.min(16, form.altoM - (pisoIndice === 0 ? 12 : 2) - 2));
  const posY = pisoIndice === 0 ? 12 : form.altoM - altoP - 2;
  // I36: posiciones y dimensiones enteras (la validación del API exige
  // números coherentes; con decimales el guardado fallaba y la estructura
  // quedaba sin aplicar — p. ej. los niveles por estante).
  const anchoP = Math.max(3, Math.min(12, Math.floor((form.anchoM - 4 - (total - 1) * 2) / total)));
  return { posX: 2 + pasilloIndice * (anchoP + 2), posY, anchoM: anchoP, altoM: altoP };
}

function detallePasillo(p: PasilloForm): string {
  const fmt = (arr: number[], lado: string) => {
    if (arr.length === 0) return null;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    return `${arr.length} est. ${lado} (${min === max ? `${min} niv.` : `${min}-${max} niv.`})`;
  };
  const lados = [fmt(p.nivelesIzq, 'izq.'), fmt(p.nivelesDer, 'der.')].filter(Boolean);
  if (p.conFondo) lados.push('fondo');
  return lados.join(' · ');
}

/**
 * Cajones de vista previa del asistente para un piso.
 * I35: si la bodega ya está configurada, la vista previa refleja las posiciones,
 * alias y colores reales guardados en «Organizar cajones».
 */
function previsualizarPiso(form: EstructuraForm, pisoIndice: number, mapa?: MapaRespuesta | null): CajonBodega[] {
  const piso = form.pisos[pisoIndice];
  const cajones: CajonBodega[] = [];
  const pisoMapa = mapa?.pisos[pisoIndice];
  if (pisoMapa) {
    for (const a of pisoMapa.areas) {
      const colores = coloresArea(a.tipo);
      cajones.push({
        clave: `area:${a.id}`,
        tipo: 'area',
        alias: a.alias,
        posX: a.posX,
        posY: a.posY,
        anchoM: a.anchoM,
        altoM: a.altoM,
        relleno: a.color ?? colores.relleno,
        borde: colores.borde,
        texto: colores.texto,
      });
    }
  } else {
    const fijas = pisoIndice === 0 ? areasFijasPiso1(form.anchoM) : [];
    fijas.forEach((a) => {
      cajones.push({
        clave: `area:${a.tipo}`,
        tipo: 'area',
        alias: a.alias,
        posX: a.posX,
        posY: a.posY,
        anchoM: a.anchoM,
        altoM: a.altoM,
        ...coloresArea(a.tipo),
      });
    });
    // Áreas adicionales del asistente (posición inicial: franja inferior).
    piso.areas.forEach((a, idx) => {
      cajones.push({
        clave: `area-extra:${idx}`,
        tipo: 'area',
        alias: a.alias || ETIQUETA_AREA[a.tipo],
        posX: 2 + idx * 9,
        posY: 1,
        anchoM: 8,
        altoM: a.tipo === 'ENTRADA' ? 0 : 4,
        ...coloresArea(a.tipo),
      });
    });
  }
  piso.pasillos.forEach((p, i) => {
    const pasMapa = pisoMapa?.pasillos[i];
    const geo = pasMapa
      ? { posX: pasMapa.posX, posY: pasMapa.posY, anchoM: pasMapa.anchoM, altoM: pasMapa.altoM }
      : posicionPasillo(form, pisoIndice, i, piso.pasillos.length);
    cajones.push({
      clave: `pasillo:${pasMapa?.id ?? i + 1}`,
      tipo: 'pasillo',
      alias: pasMapa?.alias ?? `Pasillo ${i + 1}`,
      ...geo,
      relleno: pasMapa?.color ?? COLORES.pasillo.relleno,
      borde: COLORES.pasillo.borde,
      texto: COLORES.pasillo.texto,
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
      areas: piso.areas.map((a) => ({
        tipo: a.tipo,
        alias: a.alias.trim() || undefined,
        permiteProductos: a.permiteProductos,
      })),
      pasillos: piso.pasillos.map((p, j) => {
        const geo = posicionPasillo(form, i, j, piso.pasillos.length);
        const zonas: Array<Record<string, unknown>> = [];
        if (p.nivelesIzq.length > 0) {
          zonas.push({
            lado: 'IZQUIERDA',
            estantes: p.nivelesIzq.map((n, k) => ({ numero: k + 1, niveles: n })),
          });
        }
        if (p.nivelesDer.length > 0) {
          zonas.push({
            lado: 'DERECHA',
            estantes: p.nivelesDer.map((n, k) => ({ numero: k + 1, niveles: n })),
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
    pisos: mapa.pisos.map((piso) => {
      // Las áreas fijas del piso 1 (entrada, patio, bahía de empaque) no se
      // repiten como adicionales: se omite la primera ocurrencia de cada tipo
      // fijo. I36: la bahía temporal ya no es fija — aparece como adicional
      // y se puede editar o eliminar.
      const omitidos = new Set<string>();
      const areas: AreaForm[] = [];
      for (const a of piso.areas) {
        if (piso.tieneAreasFijas && TIPOS_AREA_FIJA.includes(a.tipo) && !omitidos.has(a.tipo)) {
          omitidos.add(a.tipo);
          continue;
        }
        areas.push({ tipo: a.tipo, alias: a.alias ?? '', permiteProductos: a.permiteProductos });
      }
      return {
        areas,
        pasillos: piso.pasillos.map((pas) => {
          const izq = pas.zonas.find((z) => z.lado === 'IZQUIERDA');
          const der = pas.zonas.find((z) => z.lado === 'DERECHA');
          return {
            nivelesIzq: izq?.estantes.map((e) => e.niveles) ?? [],
            nivelesDer: der?.estantes.map((e) => e.niveles) ?? [],
            conFondo: pas.zonas.some((z) => z.lado === 'FONDO'),
          };
        }),
      };
    }),
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
      if (p.nivelesIzq.length === 0 && p.nivelesDer.length === 0 && !p.conFondo) {
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
  const [mapaVersion, setMapaVersion] = useState(0);
  const [errorCarga, setErrorCarga] = useState('');

  // Asistente
  const [form, setForm] = useState<EstructuraForm>(FORM_INICIAL);
  const [pisoPreview, setPisoPreview] = useState(0);
  const [personalizar, setPersonalizar] = useState<Record<number, boolean>>({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  // I37d: indica si la estructura (pisos/pasillos/estantes/niveles) tiene
  // cambios sin guardar. Los cambios de niveles NO se aplican al editarlos:
  // hay que pulsar «Guardar cambios». Este aviso lo deja claro.
  const [estructuraSucia, setEstructuraSucia] = useState(false);

  // Editor de cajones
  const [pisoSel, setPisoSel] = useState(0);
  const [seleccion, setSeleccion] = useState<CajonBodega | null>(null);
  const [aliasEd, setAliasEd] = useState('');
  const [colorEd, setColorEd] = useState('');
  const [anchoEd, setAnchoEd] = useState(0);
  const [altoEd, setAltoEd] = useState(0);
  const [errorEd, setErrorEd] = useState('');
  const [mensajeEd, setMensajeEd] = useState('');
  // I35: movimientos de arrastre pendientes hasta pulsar «Guardar cambios».
  const [pendientes, setPendientes] = useState<Record<string, { posX: number; posY: number }>>({});
  const [guardandoMovimientos, setGuardandoMovimientos] = useState(false);
  // I38: edición puntual de niveles por estante del pasillo seleccionado
  // (sin reconfigurar: las ubicaciones de los productos se conservan).
  const [nivelesEd, setNivelesEd] = useState<Record<string, number>>({});
  const [guardandoNiveles, setGuardandoNiveles] = useState(false);

  async function cargarMapa(): Promise<MapaRespuesta | null> {
    setErrorCarga('');
    try {
      const { status, body } = await api<MapaRespuesta>('/warehouses/map');
      if (status === 200) {
        setMapa(body);
        setMapaVersion((v) => v + 1);
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

  /** Marca que la estructura (incluidos los niveles por estante) tiene cambios
   * sin guardar, para mostrar el aviso y el botón «Guardar cambios». */
  function marcarEstructuraSucia() {
    setMensaje('');
    setEstructuraSucia(true);
  }

  function actualizarPiso(indice: number, cambios: (piso: PisoForm) => PisoForm) {
    marcarEstructuraSucia();
    setForm((f) => ({
      ...f,
      pisos: f.pisos.map((p, i) => (i === indice ? cambios(p) : p)),
    }));
  }

  function fijarNumPasillos(indice: number, n: number) {
    const cantidad = Math.max(1, Math.min(MAX_PASILLOS, Math.round(n) || 1));
    actualizarPiso(indice, (piso) => {
      const pasillos = [...piso.pasillos];
      while (pasillos.length < cantidad) pasillos.push(clonarPasillo(PASILLO_BASE));
      return { ...piso, pasillos: pasillos.slice(0, cantidad) };
    });
  }

  /** Ajusta un arreglo de niveles a la cantidad de estantes indicada. */
  function ajustarEstantes(arr: number[], cantidad: number): number[] {
    const copia = arr.slice(0, cantidad);
    while (copia.length < cantidad) copia.push(copia[copia.length - 1] ?? 3);
    return copia;
  }

  /** Cambia la cantidad de estantes por lado en todos los pasillos del piso. */
  function fijarEstantes(indice: number, n: number) {
    const cantidad = Math.max(0, Math.min(MAX_ESTANTES, Math.round(n) || 0));
    actualizarPiso(indice, (piso) => ({
      ...piso,
      pasillos: piso.pasillos.map((p) => ({
        ...p,
        nivelesIzq: ajustarEstantes(p.nivelesIzq, cantidad),
        nivelesDer: ajustarEstantes(p.nivelesDer, cantidad),
      })),
    }));
  }

  /** Pone el mismo número de niveles a todos los estantes del piso. */
  function fijarNiveles(indice: number, n: number) {
    const v = Math.max(1, Math.min(MAX_NIVELES, Math.round(n) || 1));
    actualizarPiso(indice, (piso) => ({
      ...piso,
      pasillos: piso.pasillos.map((p) => ({
        ...p,
        nivelesIzq: p.nivelesIzq.map(() => v),
        nivelesDer: p.nivelesDer.map(() => v),
      })),
    }));
  }

  function fijarFondo(indice: number, valor: boolean) {
    actualizarPiso(indice, (piso) => ({
      ...piso,
      pasillos: piso.pasillos.map((p) => ({ ...p, conFondo: valor })),
    }));
  }

  function actualizarPasillo(pisoIndice: number, pasilloIndice: number, cambios: (p: PasilloForm) => PasilloForm) {
    actualizarPiso(pisoIndice, (piso) => ({
      ...piso,
      pasillos: piso.pasillos.map((p, i) => (i === pasilloIndice ? cambios(p) : p)),
    }));
  }

  /** I35: niveles de un estante individual (algunos estantes tienen 2 o más niveles). */
  function fijarNivelEstante(
    pisoIndice: number,
    pasilloIndice: number,
    lado: 'nivelesIzq' | 'nivelesDer',
    estanteIndice: number,
    valor: number,
  ) {
    const v = Math.max(1, Math.min(MAX_NIVELES, Math.round(valor) || 1));
    actualizarPasillo(pisoIndice, pasilloIndice, (p) => {
      const arr = [...p[lado]];
      arr[estanteIndice] = v;
      return { ...p, [lado]: arr };
    });
  }

  function fijarEstantesPasillo(pisoIndice: number, pasilloIndice: number, lado: 'nivelesIzq' | 'nivelesDer', n: number) {
    const cantidad = Math.max(0, Math.min(MAX_ESTANTES, Math.round(n) || 0));
    actualizarPasillo(pisoIndice, pasilloIndice, (p) => ({ ...p, [lado]: ajustarEstantes(p[lado], cantidad) }));
  }

  // ---------- I35: áreas adicionales por piso ----------

  function agregarArea(indice: number) {
    actualizarPiso(indice, (piso) => ({
      ...piso,
      areas: [...piso.areas, { tipo: 'BAHIA_EMPAQUE', alias: '', permiteProductos: true }],
    }));
  }

  function actualizarArea(indice: number, areaIndice: number, cambios: Partial<AreaForm>) {
    actualizarPiso(indice, (piso) => ({
      ...piso,
      areas: piso.areas.map((a, k) => (k === areaIndice ? { ...a, ...cambios } : a)),
    }));
  }

  function quitarArea(indice: number, areaIndice: number) {
    actualizarPiso(indice, (piso) => ({ ...piso, areas: piso.areas.filter((_, k) => k !== areaIndice) }));
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
      setMensaje('Cambios guardados. Los niveles de los estantes ya quedaron aplicados.');
      setEstructuraSucia(false);
      setPendientes({});
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
    const cajones: CajonBodega[] = piso.areas.map((a) => {
      const colores = coloresArea(a.tipo);
      return {
        clave: `area:${a.id}`,
        tipo: 'area' as const,
        alias: a.alias,
        posX: a.posX,
        posY: a.posY,
        anchoM: a.anchoM,
        altoM: a.altoM,
        // I35: las áreas también admiten color propio.
        relleno: a.color ?? colores.relleno,
        borde: colores.borde,
        texto: colores.texto,
      };
    });
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

  /** I35: el arrastre queda pendiente; se persiste con el botón «Guardar cambios». */
  async function moverCajon(cajon: CajonBodega, posX: number, posY: number): Promise<boolean> {
    setPendientes((prev) => ({ ...prev, [cajon.clave]: { posX, posY } }));
    setMensajeEd('');
    return true;
  }

  async function guardarMovimientos() {
    const entradas = Object.entries(pendientes);
    if (entradas.length === 0) return;
    setGuardandoMovimientos(true);
    setErrorEd('');
    setMensajeEd('');
    for (const [clave, pos] of entradas) {
      const ref = cajonPorClave(clave);
      if (!ref) continue;
      const { status, body } = await api(`/warehouses/${ref.tipo}/${ref.id}/posicion`, {
        method: 'PATCH',
        body: JSON.stringify(pos),
      });
      if (status !== 200) {
        setGuardandoMovimientos(false);
        setErrorEd(mensajeError(body, 'No se pudo guardar la posición de un cajón'));
        return;
      }
    }
    setPendientes({});
    setGuardandoMovimientos(false);
    setMensajeEd('Cambios guardados. La vista previa de «1. Estructura» ya refleja la nueva distribución.');
    await cargarMapa();
  }

  function seleccionar(cajon: CajonBodega) {
    setSeleccion(cajon);
    setAliasEd(cajon.alias);
    // I35: pasillos y áreas admiten cambio de color.
    setColorEd(cajon.relleno);
    setAnchoEd(cajon.anchoM);
    setAltoEd(cajon.altoM);
    setErrorEd('');
    setMensajeEd('');
    // I38: al seleccionar un pasillo se cargan los niveles actuales de sus
    // estantes para editarlos de forma puntual (sin perder ubicaciones).
    const pas = pasilloSeleccionado(cajon);
    if (pas) {
      const inicial: Record<string, number> = {};
      for (const z of pas.zonas) for (const e of z.estantes) inicial[e.id] = e.niveles;
      setNivelesEd(inicial);
    } else {
      setNivelesEd({});
    }
  }

  /** I38: pasillo del mapa correspondiente al cajón seleccionado. */
  function pasilloSeleccionado(cajon: CajonBodega | null): MapaPasillo | null {
    if (!cajon || cajon.tipo !== 'pasillo' || !mapa) return null;
    const id = cajon.clave.replace('pasillo:', '');
    return mapa.pisos[pisoSel]?.pasillos.find((p) => p.id === id) ?? null;
  }

  /** I38: guarda los niveles modificados estante por estante (PATCH puntual,
   * sin reconfigurar). El backend rechaza bajar por debajo del nivel ocupado. */
  async function guardarNivelesEstantes() {
    const pas = pasilloSeleccionado(seleccion);
    if (!pas) return;
    const cambios: { id: string; alias: string; niveles: number; actual: number }[] = [];
    for (const z of pas.zonas) {
      for (const e of z.estantes) {
        const nuevo = nivelesEd[e.id];
        if (nuevo != null && nuevo !== e.niveles) {
          cambios.push({ id: e.id, alias: e.alias, niveles: nuevo, actual: e.niveles });
        }
      }
    }
    if (cambios.length === 0) {
      setMensajeEd('No hay cambios de niveles por guardar.');
      return;
    }
    setGuardandoNiveles(true);
    setErrorEd('');
    setMensajeEd('');
    for (const c of cambios) {
      const { status, body } = await api(`/warehouses/racks/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ niveles: c.niveles }),
      });
      if (status !== 200) {
        setGuardandoNiveles(false);
        setErrorEd(mensajeError(body, `No se pudo guardar los niveles del estante ${c.alias}`));
        return;
      }
    }
    setGuardandoNiveles(false);
    setMensajeEd(
      `Niveles actualizados (${cambios.length} estante${cambios.length === 1 ? '' : 's'}). ` +
        'Las ubicaciones de los productos se conservaron.',
    );
    await cargarMapa();
  }

  async function guardarCajon() {
    if (!seleccion) return;
    const ref = cajonPorClave(seleccion.clave);
    if (!ref) return;
    setErrorEd('');
    setMensajeEd('');
    const posPendiente = pendientes[seleccion.clave];
    const payload: Record<string, unknown> = {
      posX: posPendiente?.posX ?? seleccion.posX,
      posY: posPendiente?.posY ?? seleccion.posY,
      alias: aliasEd,
      anchoM: anchoEd,
      altoM: seleccion.tipo === 'area' && seleccion.altoM === 0 ? 0 : altoEd,
    };
    if (colorEd) payload.color = colorEd;
    const { status, body } = await api(`/warehouses/${ref.tipo}/${ref.id}/posicion`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (status === 200) {
      setMensajeEd(`"${aliasEd}" actualizado.`);
      setSeleccion(null);
      setPendientes((prev) => {
        const copia = { ...prev };
        delete copia[seleccion.clave];
        return copia;
      });
      await cargarMapa();
    } else {
      setErrorEd(mensajeError(body, 'No se pudo guardar el cajón'));
    }
  }

  if (!sesion) return null;

  const pisoPreviewSeguro = Math.min(pisoPreview, form.pisos.length - 1);
  const numPendientes = Object.keys(pendientes).length;

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
                        (incluye entrada, patio de maniobras y bahía de empaque)
                      </span>
                    )}
                    {i > 0 && (
                      <span className="ml-2 text-xs font-normal normal-case text-slate-400">
                        (los pasillos se ubican de arriba hacia abajo)
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
                      value={piso.pasillos[0]?.nivelesIzq.length ?? 0}
                      onChange={(e) => fijarEstantes(i, Number(e.target.value))}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Niveles por estante
                    <input
                      type="number"
                      min={1}
                      max={MAX_NIVELES}
                      className={`mt-1 ${CLASE_INPUT}`}
                      value={piso.pasillos[0]?.nivelesIzq[0] ?? 3}
                      onChange={(e) => fijarNiveles(i, Number(e.target.value))}
                    />
                  </label>                  <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={piso.pasillos.every((p) => p.conFondo)}
                      onChange={(e) => fijarFondo(i, e.target.checked)}
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
                  <div className="mt-3 space-y-3">
                    {piso.pasillos.map((p, j) => (
                      <div key={j} className="rounded-lg border border-slate-200 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium text-slate-700">Pasillo #{j + 1}</p>
                          <label className="flex items-center gap-2 text-xs text-slate-600">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={p.conFondo}
                              onChange={(e) =>
                                actualizarPasillo(i, j, (q) => ({ ...q, conFondo: e.target.checked }))
                              }
                            />
                            Fondo
                          </label>
                        </div>
                        {(['nivelesIzq', 'nivelesDer'] as const).map((lado) => (
                          <div key={lado} className="mb-2 last:mb-0">
                            <div className="flex items-center gap-2">
                              <span className="w-20 text-xs text-slate-500">
                                {lado === 'nivelesIzq' ? 'Izquierda' : 'Derecha'}
                              </span>
                              <label className="flex items-center gap-1 text-xs text-slate-600">
                                Estantes
                                <input
                                  type="number"
                                  min={0}
                                  max={MAX_ESTANTES}
                                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                                  value={p[lado].length}
                                  onChange={(e) => fijarEstantesPasillo(i, j, lado, Number(e.target.value))}
                                />
                              </label>
                            </div>
                            {p[lado].length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-2 sm:pl-20">
                                {p[lado].map((n, k) => (
                                  <label key={k} className="text-[10px] text-slate-400">
                                    E{k + 1}
                                    <input
                                      type="number"
                                      min={1}
                                      max={MAX_NIVELES}
                                      title={`Niveles del estante E${k + 1}`}
                                      className="mt-0.5 block w-14 rounded-lg border border-slate-300 px-1.5 py-1 text-sm"
                                      value={n}
                                      onChange={(e) => fijarNivelEstante(i, j, lado, k, Number(e.target.value))}
                                    />
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                    <p className="text-xs text-slate-400">
                      Cada estante puede tener un número de niveles distinto (2 o más).
                    </p>
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                      Recuerde: estos cambios solo se aplican al pulsar «Reconfigurar bodega» al
                      final, lo que empieza de cero y pierde las ubicaciones. Para ajustar los
                      niveles de una bodega ya configurada <strong>sin perder las ubicaciones</strong>,
                      use la pestaña «Organizar cajones» (toque el pasillo y edite sus estantes).
                    </p>
                  </div>
                )}

                {/* I35: áreas adicionales del piso (bahía, patio, entrada) */}
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Áreas adicionales{i === 0 ? ' (además de las fijas)' : ''}
                    </h3>
                    <button
                      onClick={() => agregarArea(i)}
                      className="text-xs font-medium text-sofia-700 underline hover:text-sofia-800"
                    >
                      + Añadir área
                    </button>
                  </div>
                  {piso.areas.length === 0 && (
                    <p className="text-xs text-slate-400">
                      Sin áreas adicionales. Puede añadir bahías, patios o entradas según el piso.
                    </p>
                  )}
                  <p className="mb-2 text-xs text-slate-400">
                    La bahía de empaque es obligatoria (allí se ubica la mercancía alistada): si la
                    elimina, se creará automáticamente al guardar. La bahía temporal es opcional.
                  </p>
                  {piso.areas.map((a, k) => (
                    <div
                      key={k}
                      className="mb-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto_auto]"
                    >
                      <label className="text-xs text-slate-600">
                        Tipo
                        <select
                          className={`mt-1 ${CLASE_INPUT}`}
                          value={a.tipo}
                          onChange={(e) => actualizarArea(i, k, { tipo: e.target.value as AreaForm['tipo'] })}
                        >
                          {TIPOS_AREA.map((t) => (
                            <option key={t} value={t}>
                              {ETIQUETA_AREA[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Alias
                        <input
                          className={`mt-1 ${CLASE_INPUT}`}
                          value={a.alias}
                          placeholder={ETIQUETA_AREA[a.tipo]}
                          onChange={(e) => actualizarArea(i, k, { alias: e.target.value })}
                        />
                      </label>
                      <label className="flex items-end gap-2 pb-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={a.permiteProductos}
                          onChange={(e) => actualizarArea(i, k, { permiteProductos: e.target.checked })}
                        />
                        Guarda productos
                      </label>
                      <button
                        onClick={() => quitarArea(i, k)}
                        className="self-center text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </Tarjeta>
            ))}

            <div>
              {form.pisos.length < MAX_PISOS && (
                <button
                  onClick={() =>
                    setForm((f) => ({ ...f, pisos: [...f.pisos, { pasillos: [clonarPasillo(PASILLO_BASE)], areas: [] }] }))
                  }
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  + Añadir piso
                </button>
              )}
            </div>

            <div>
              {/* I38: dos opciones claras — «Reconfigurar bodega» empieza de
                  cero (pierde ubicaciones); para ajustes puntuales sin perder
                  ubicaciones (p. ej. niveles de un estante) está la pestaña
                  «Organizar cajones». */}
              {estructuraSucia && !guardando && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Hay cambios de estructura sin guardar. Al pulsar{' '}
                  <strong>«Reconfigurar bodega»</strong> se empieza de cero y se pierden las
                  ubicaciones asignadas a los productos. Si solo desea ajustar los niveles de los
                  estantes <strong>sin perder las ubicaciones</strong>, use la pestaña{' '}
                  <strong>«Organizar cajones»</strong> (toque un pasillo y edite sus niveles).
                </p>
              )}
              <button
                onClick={guardarEstructura}
                disabled={guardando}
                className={CLASE_BOTON_PRIMARIO}
              >
                {guardando ? 'Guardando…' : mapa ? 'Reconfigurar bodega (empezar de cero)' : 'Crear bodega'}
              </button>
              {mapa && !estructuraSucia && (
                <p className="mt-2 text-xs text-slate-400">
                  Para ajustes puntuales sin perder las ubicaciones (niveles de estantes, alias,
                  colores, posiciones), use la pestaña «Organizar cajones».
                </p>
              )}
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
              cajones={previsualizarPiso(form, pisoPreviewSeguro, mapa)}
            />
            <p className="mt-3 text-xs text-slate-400">
              {mapa
                ? 'La vista previa refleja la distribución guardada en «Organizar cajones».'
                : 'Las posiciones son una propuesta inicial; en la pestaña «Organizar cajones» puede arrastrarlas dentro del perímetro.'}
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
                {/* I35: guardar los movimientos de arrastre */}
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">
                    {numPendientes > 0
                      ? `${numPendientes} cajón(es) movido(s) sin guardar.`
                      : 'Arrastre los cajones y luego guarde los cambios.'}
                  </p>
                  <button
                    onClick={guardarMovimientos}
                    disabled={numPendientes === 0 || guardandoMovimientos}
                    className={CLASE_BOTON_PRIMARIO}
                  >
                    {guardandoMovimientos ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </div>
                <MapaBodega
                  key={`editor-${pisoSel}-${mapaVersion}`}
                  anchoM={mapa.bodega.anchoM}
                  altoM={mapa.bodega.altoM}
                  cajones={cajonesPiso}
                  seleccionada={seleccion?.clave ?? null}
                  onSeleccionar={seleccionar}
                  onArrastrar={moverCajon}
                />
                <p className="mt-3 text-xs text-slate-400">
                  Arrastre los cajones para ubicarlos dentro del perímetro y pulse «Guardar cambios». Toque un cajón
                  para renombrarlo, cambiar su color o ajustar su tamaño.
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
                {/* I35: pasillos y áreas admiten cambio de color */}
                <label className="block text-sm text-slate-600">
                  Color
                  <input
                    type="color"
                    className="mt-1 h-9 w-full rounded-lg border border-slate-300"
                    value={colorEd || COLORES.pasillo.relleno}
                    onChange={(e) => setColorEd(e.target.value)}
                  />
                </label>
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

                {/* I38: edición puntual de niveles por estante — no reconfigura
                    la bodega y conserva las ubicaciones de los productos. */}
                {seleccion.tipo === 'pasillo' && pasilloSeleccionado(seleccion) && (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Niveles por estante
                    </h3>
                    <p className="mb-2 text-xs text-slate-400">
                      Ajuste puntual: conserva las ubicaciones de los productos. No se puede bajar
                      un estante por debajo del nivel más alto ocupado.
                    </p>
                    {pasilloSeleccionado(seleccion)!.zonas.map((z) =>
                      z.estantes.length === 0 ? null : (
                        <div key={z.id} className="mb-2 last:mb-0">
                          <p className="mb-1 text-[11px] font-medium text-slate-500">
                            {z.lado === 'IZQUIERDA' ? 'Izquierda' : z.lado === 'DERECHA' ? 'Derecha' : z.lado}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {z.estantes.map((e) => (
                              <label key={e.id} className="text-[10px] text-slate-400">
                                {e.alias}
                                <input
                                  type="number"
                                  min={1}
                                  max={MAX_NIVELES}
                                  title={`Niveles del estante ${e.alias}`}
                                  className="mt-0.5 block w-14 rounded-lg border border-slate-300 px-1.5 py-1 text-sm"
                                  value={nivelesEd[e.id] ?? e.niveles}
                                  onChange={(ev) =>
                                    setNivelesEd((prev) => ({
                                      ...prev,
                                      [e.id]: Math.max(1, Math.min(MAX_NIVELES, Number(ev.target.value) || 1)),
                                    }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                    <button
                      onClick={guardarNivelesEstantes}
                      disabled={guardandoNiveles}
                      className={`mt-2 ${CLASE_BOTON_PRIMARIO}`}
                    >
                      {guardandoNiveles ? 'Guardando…' : 'Guardar niveles'}
                    </button>
                  </div>
                )}
                {errorEd && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorEd}</p>}
                {mensajeEd && <p className="rounded-lg bg-menta-50 px-3 py-2 text-sm text-menta-700">{mensajeEd}</p>}
              </div>
            )}
            {!seleccion && (errorEd || mensajeEd) && (
              <div className="mt-3">
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
