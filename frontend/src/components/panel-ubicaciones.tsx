'use client';

import { useEffect, useState } from 'react';
import { api, mensajeError } from '@/lib/api';
import { CLASE_BOTON_PRIMARIO, CLASE_BOTON_SECUNDARIO, CLASE_INPUT, Insignia } from '@/components/ui';

/**
 * I34 (Fase 2): asignación manual de ubicación de un producto (estante+nivel,
 * bahía, o tránsito) y lista de sus ubicaciones con baja. Usado desde el
 * mapa 2D y desde la ficha de producto. Solo Generador/Administrador.
 */

interface OpcionEstante {
  rackId: string;
  niveles: number;
  etiqueta: string;
}
interface OpcionArea {
  areaId: string;
  etiqueta: string;
}
interface Ubicacion {
  id: string;
  nivel?: number | null;
  cantidad: number;
  esOficial: boolean;
  transito: boolean;
  rack?: { id: string; alias: string; numero: number; zone?: { lado: string; aisle?: { numero: number; floor?: { numero: number } } } } | null;
  area?: { id: string; alias: string; tipo: string } | null;
}

const ETIQUETA_LADO: Record<string, string> = { IZQUIERDA: 'Izq', DERECHA: 'Der', FONDO: 'Fondo' };
const ETIQUETA_AREA: Record<string, string> = {
  ENTRADA: 'Entrada',
  PATIO_MANIOBRAS: 'Patio de maniobras',
  BAHIA_EMPAQUE: 'Bahía de empaque',
  BAHIA_TEMPORAL: 'Bahía temporal',
};

export function etiquetaUbicacion(u: Ubicacion): string {
  if (u.transito) return 'En tránsito';
  if (u.rack) {
    const piso = u.rack.zone?.aisle?.floor?.numero ?? 1;
    const pasillo = u.rack.zone?.aisle?.numero ?? 0;
    const lado = u.rack.zone ? ETIQUETA_LADO[u.rack.zone.lado] ?? u.rack.zone.lado : '';
    return `P${piso} · Pasillo ${pasillo} · ${lado} · ${u.rack.alias}${u.nivel ? ` · Nivel ${u.nivel}` : ''}`;
  }
  if (u.area) return u.area.alias || ETIQUETA_AREA[u.area.tipo] || u.area.tipo;
  return 'Ubicación';
}

export function PanelUbicaciones({
  productoId,
  codigo,
  soloLectura = false,
  alCambiar,
}: {
  productoId: string;
  codigo: string;
  soloLectura?: boolean;
  alCambiar?: () => void;
}) {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [estantes, setEstantes] = useState<OpcionEstante[]>([]);
  const [areas, setAreas] = useState<OpcionArea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  // formulario
  const [destino, setDestino] = useState<'rack' | 'area' | 'transito'>('rack');
  const [rackId, setRackId] = useState('');
  const [nivel, setNivel] = useState(1);
  const [areaId, setAreaId] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      const [locs, mapa] = await Promise.all([
        api<Ubicacion[]>(`/warehouses/products/${productoId}/locations`),
        api<any>('/warehouses/map'),
      ]);
      if (locs.status === 200) setUbicaciones(locs.body);
      if (mapa.status === 200) {
        const opsE: OpcionEstante[] = [];
        const opsA: OpcionArea[] = [];
        for (const piso of mapa.body.pisos) {
          for (const pas of piso.pasillos) {
            for (const z of pas.zonas) {
              for (const e of z.estantes) {
                opsE.push({
                  rackId: e.id,
                  niveles: e.niveles,
                  etiqueta: `P${piso.numero} · Pasillo ${pas.numero} · ${ETIQUETA_LADO[z.lado] ?? z.lado} · ${e.alias}`,
                });
              }
            }
          }
          for (const a of piso.areas) {
            if (a.permiteProductos) {
              opsA.push({ areaId: a.id, etiqueta: a.alias || ETIQUETA_AREA[a.tipo] || a.tipo });
            }
          }
        }
        setEstantes(opsE);
        setAreas(opsA);
        if (opsE.length && !rackId) setRackId(opsE[0].rackId);
        if (opsA.length && !areaId) setAreaId(opsA[0].areaId);
      }
    } catch {
      setError('No se pudieron cargar las ubicaciones.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId]);

  async function asignar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    setGuardando(true);
    const payload: Record<string, unknown> = { productId: productoId, cantidad };
    if (destino === 'rack') {
      payload.rackId = rackId;
      payload.nivel = nivel;
    } else if (destino === 'area') {
      payload.areaId = areaId;
    } else {
      payload.transito = true;
    }
    const { status, body } = await api('/warehouses/locations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setGuardando(false);
    if (status === 201) {
      setMensaje(`${codigo} asignado.`);
      setCantidad(1);
      cargar();
      alCambiar?.();
    } else {
      setError(mensajeError(body, 'No se pudo asignar la ubicación'));
    }
  }

  async function darDeBaja(u: Ubicacion) {
    if (!window.confirm(`¿Dar de baja la ubicación "${etiquetaUbicacion(u)}" (${u.cantidad} und)?`)) return;
    setError('');
    const { status, body } = await api(`/warehouses/locations/${u.id}`, { method: 'DELETE' });
    if (status === 200) {
      setMensaje('Ubicación dada de baja.');
      cargar();
      alCambiar?.();
    } else {
      setError(mensajeError(body, 'No se pudo dar de baja'));
    }
  }

  const nivelesDelRack = estantes.find((e) => e.rackId === rackId)?.niveles ?? 3;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Ubicaciones en bodega</h3>

      {cargando && <p className="text-sm text-slate-400">Cargando…</p>}

      {!cargando && ubicaciones.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">El producto no tiene ubicación asignada.</p>
      )}

      <ul className="mb-4 space-y-1.5">
        {ubicaciones.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-700">{etiquetaUbicacion(u)}</span>
            <span className="flex items-center gap-1">
              <Insignia tono="azul">{u.cantidad} und</Insignia>
              {u.esOficial && <Insignia tono="menta">Oficial</Insignia>}
              {!soloLectura && (
                <button
                  onClick={() => darDeBaja(u)}
                  className="rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  Baja
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {!soloLectura && (
        <form onSubmit={asignar} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ['rack', 'Estante + nivel'],
                ['area', 'Bahía'],
                ['transito', 'Tránsito'],
              ] as Array<['rack' | 'area' | 'transito', string]>
            ).map(([valor, etiqueta]) => (
              <label key={valor} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="destino"
                  className="h-4 w-4"
                  checked={destino === valor}
                  onChange={() => setDestino(valor)}
                />
                {etiqueta}
              </label>
            ))}
          </div>

          {destino === 'rack' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-600 sm:col-span-2">
                Estante
                <select className={`mt-1 ${CLASE_INPUT}`} value={rackId} onChange={(e) => setRackId(e.target.value)}>
                  {estantes.map((e) => (
                    <option key={e.rackId} value={e.rackId}>
                      {e.etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600">
                Nivel
                <select className={`mt-1 ${CLASE_INPUT}`} value={nivel} onChange={(e) => setNivel(Number(e.target.value))}>
                  {Array.from({ length: nivelesDelRack }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Nivel {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {destino === 'area' && (
            <label className="block text-sm text-slate-600">
              Bahía
              <select className={`mt-1 ${CLASE_INPUT}`} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                {areas.map((a) => (
                  <option key={a.areaId} value={a.areaId}>
                    {a.etiqueta}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              Cantidad
              <input
                type="number"
                min={0}
                className={`mt-1 w-28 ${CLASE_INPUT}`}
                value={cantidad}
                onChange={(e) => setCantidad(Number(e.target.value) || 0)}
              />
            </label>
            <button type="submit" disabled={guardando} className={CLASE_BOTON_PRIMARIO}>
              {guardando ? 'Asignando…' : 'Asignar ubicación'}
            </button>
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {mensaje && <p className="rounded-lg bg-menta-50 px-3 py-2 text-sm text-menta-700">{mensaje}</p>}
        </form>
      )}
      {soloLectura && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
