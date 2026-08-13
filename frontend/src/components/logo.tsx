'use client';

import { useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * QA Func. 4.2: logo dinámico. Intenta el logo configurado por el
 * Administrador (GET /documents/logo, público) y, si no hay ninguno o falla
 * la carga, usa el logo institucional de SofIA como fallback.
 * La imagen permanece oculta hasta cargar (sin flash de imagen rota) y el
 * efecto cubre el caso en que el error ocurre antes de la hidratación.
 */
export function LogoSofia({
  width,
  height,
  className,
}: {
  width: number;
  height: number;
  className?: string;
}) {
  const [fallo, setFallo] = useState(false);
  const [cargado, setCargado] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const src = fallo ? '/logo-sofia.png' : `${API_URL}/documents/logo`;

  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    if (img.complete && img.naturalWidth === 0 && !fallo) {
      // Falló antes de que React adjuntara los listeners (hidración)
      setFallo(true);
    } else if (img.complete && img.naturalWidth > 0) {
      setCargado(true);
    }
  }, [fallo]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt="SofIA"
      width={width}
      height={height}
      className={className}
      style={{ objectFit: 'contain', visibility: cargado ? 'visible' : 'hidden' }}
      onLoad={() => setCargado(true)}
      onError={() => {
        setFallo(true);
        setCargado(false);
      }}
    />
  );
}
