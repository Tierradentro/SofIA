'use client';

import { useRef, useState } from 'react';

/**
 * I32 (Fase 2 - Mapa 2D): lienzo SVG de la bodega. Origen de coordenadas del
 * modelo en la esquina inferior izquierda (metros); el SVG lo invierte.
 * Modo lectura (vista previa del asistente) e interactivo (arrastrar cajones
 * dentro del perímetro; I33 lo reutiliza para el mapa operativo).
 */

export interface CajonBodega {
  /** Clave única en el lienzo (p. ej. `pasillo:<uuid>`). */
  clave: string;
  tipo: 'pasillo' | 'area';
  alias: string;
  posX: number;
  posY: number;
  anchoM: number;
  altoM: number;
  /** Colores hex (paleta sofia/menta o color propio del cajón). */
  relleno: string;
  borde: string;
  texto: string;
  detalle?: string;
}

const E = 10; // unidades SVG por metro
const MARGEN = 3; // metros de margen alrededor de la forma

export function MapaBodega({
  anchoM,
  altoM,
  cajones,
  seleccionada,
  resaltadas,
  onSeleccionar,
  onArrastrar,
}: {
  anchoM: number;
  altoM: number;
  cajones: CajonBodega[];
  seleccionada?: string | null;
  /** Cajones resaltados (búsqueda/filtro por empresa): borde ámbar grueso. */
  resaltadas?: string[];
  onSeleccionar?: (cajon: CajonBodega) => void;
  /** Fin del arrastre: el padre persiste; si falla, devuelve false y se revierte. */
  onArrastrar?: (cajon: CajonBodega, posX: number, posY: number) => Promise<boolean> | boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [arrastre, setArrastre] = useState<{ clave: string; dx: number; dy: number; movio: boolean } | null>(null);
  const [posLocal, setPosLocal] = useState<Record<string, { x: number; y: number }>>({});

  const interactivo = Boolean(onArrastrar);

  function posicionDe(c: CajonBodega): { x: number; y: number } {
    return posLocal[c.clave] ?? { x: c.posX, y: c.posY };
  }

  function puntoEnMetros(ev: React.PointerEvent): { mx: number; my: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * anchoM;
    const my = altoM - ((ev.clientY - rect.top) / rect.height) * altoM;
    return { mx, my };
  }

  function iniciarArrastre(ev: React.PointerEvent, c: CajonBodega) {
    onSeleccionar?.(c);
    if (!interactivo) return;
    const p = puntoEnMetros(ev);
    if (!p) return;
    const pos = posicionDe(c);
    setArrastre({ clave: c.clave, dx: p.mx - pos.x, dy: p.my - pos.y, movio: false });
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  }

  function moverArrastre(ev: React.PointerEvent) {
    if (!arrastre) return;
    const c = cajones.find((k) => k.clave === arrastre.clave);
    const p = puntoEnMetros(ev);
    if (!c || !p) return;
    const x = Math.min(Math.max(p.mx - arrastre.dx, 0), Math.max(anchoM - c.anchoM, 0));
    const y = Math.min(Math.max(p.my - arrastre.dy, 0), Math.max(altoM - c.altoM, 0));
    const rx = Math.round(x * 10) / 10;
    const ry = Math.round(y * 10) / 10;
    const actual = posicionDe(c);
    if (Math.abs(actual.x - rx) > 0.01 || Math.abs(actual.y - ry) > 0.01) {
      setPosLocal((prev) => ({ ...prev, [c.clave]: { x: rx, y: ry } }));
      setArrastre({ ...arrastre, movio: true });
    }
  }

  async function terminarArrastre() {
    if (!arrastre) return;
    const c = cajones.find((k) => k.clave === arrastre.clave);
    const pos = c ? posLocal[c.clave] : undefined;
    const fin = arrastre;
    setArrastre(null);
    if (c && pos && fin.movio && onArrastrar) {
      const ok = await onArrastrar(c, pos.x, pos.y);
      if (!ok) {
        // Revertir a la posición del modelo.
        setPosLocal((prev) => {
          const copia = { ...prev };
          delete copia[c.clave];
          return copia;
        });
      }
    }
  }

  const w = (anchoM + MARGEN * 2) * E;
  const h = (altoM + MARGEN * 2) * E;

  return (
    <svg
      ref={svgRef}
      viewBox={`${-MARGEN * E} ${-MARGEN * E} ${w} ${h}`}
      className="w-full touch-none select-none rounded-lg bg-slate-50"
      style={{ maxHeight: '70vh' }}
      onPointerMove={moverArrastre}
      onPointerUp={terminarArrastre}
      onPointerLeave={terminarArrastre}
      role="img"
      aria-label="Mapa de la bodega"
    >
      {/* Forma de la bodega */}
      <rect
        x={0}
        y={0}
        width={anchoM * E}
        height={altoM * E}
        rx={E * 0.4}
        fill="#ffffff"
        stroke="#124381"
        strokeWidth={E * 0.25}
      />
      {/* Cuadrícula de metros (tenue) */}
      {Array.from({ length: Math.floor(anchoM / 5) - 1 }, (_, i) => (
        <line
          key={`gv${i}`}
          x1={(i + 1) * 5 * E}
          y1={0}
          x2={(i + 1) * 5 * E}
          y2={altoM * E}
          stroke="#eef2f7"
          strokeWidth={E * 0.08}
        />
      ))}
      {Array.from({ length: Math.floor(altoM / 5) - 1 }, (_, i) => (
        <line
          key={`gh${i}`}
          x1={0}
          y1={(i + 1) * 5 * E}
          x2={anchoM * E}
          y2={(i + 1) * 5 * E}
          stroke="#eef2f7"
          strokeWidth={E * 0.08}
        />
      ))}

      {cajones.map((c) => {
        const pos = posicionDe(c);
        const x = pos.x * E;
        const y = (altoM - pos.y - c.altoM) * E;
        const esLinea = c.altoM === 0;
        const sel = seleccionada === c.clave;
        const resaltado = resaltadas?.includes(c.clave) ?? false;
        const colorResalte = sel ? '#f59e0b' : resaltado ? '#f59e0b' : c.borde;
        const anchoResalte = sel ? E * 0.35 : resaltado ? E * 0.35 : E * 0.15;
        const arrastrando = arrastre?.clave === c.clave;
        return (
          <g
            key={c.clave}
            onPointerDown={(ev) => iniciarArrastre(ev, c)}
            style={{ cursor: interactivo ? (arrastrando ? 'grabbing' : 'grab') : 'default' }}
            opacity={arrastrando ? 0.85 : 1}
          >
            {esLinea ? (
              <>
                <rect
                  x={x}
                  y={y - E * 0.3}
                  width={c.anchoM * E}
                  height={E * 0.6}
                  rx={E * 0.3}
                  fill={c.relleno}
                  stroke={colorResalte}
                  strokeWidth={sel || resaltado ? E * 0.3 : E * 0.12}
                />
                <text
                  x={x + (c.anchoM * E) / 2}
                  y={y - E * 0.8}
                  textAnchor="middle"
                  fontSize={E * 0.55}
                  fill={c.texto}
                  fontWeight={600}
                >
                  {c.alias}
                </text>
              </>
            ) : (
              <>
                <rect
                  x={x}
                  y={y}
                  width={c.anchoM * E}
                  height={c.altoM * E}
                  rx={E * 0.3}
                  fill={c.relleno}
                  stroke={colorResalte}
                  strokeWidth={anchoResalte}
                  strokeDasharray={c.tipo === 'area' && !sel && !resaltado ? `${E * 0.5} ${E * 0.3}` : undefined}
                />
                <text
                  x={x + (c.anchoM * E) / 2}
                  y={y + (c.altoM * E) / 2 - (c.detalle ? E * 0.35 : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={E * 0.6}
                  fill={c.texto}
                  fontWeight={600}
                >
                  {c.alias}
                </text>
                {c.detalle && (
                  <text
                    x={x + (c.anchoM * E) / 2}
                    y={y + (c.altoM * E) / 2 + E * 0.55}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={E * 0.45}
                    fill={c.texto}
                    opacity={0.75}
                  >
                    {c.detalle}
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}

      {/* Cotas */}
      <text x={(anchoM * E) / 2} y={altoM * E + MARGEN * E * 0.65} textAnchor="middle" fontSize={E * 0.6} fill="#64748b">
        {anchoM} m
      </text>
      <text
        x={-MARGEN * E * 0.65}
        y={(altoM * E) / 2}
        textAnchor="middle"
        fontSize={E * 0.6}
        fill="#64748b"
        transform={`rotate(-90 ${-MARGEN * E * 0.65} ${(altoM * E) / 2})`}
      >
        {altoM} m
      </text>
    </svg>
  );
}
