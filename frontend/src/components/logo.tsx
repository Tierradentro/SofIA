'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * QA Func. 4.2: logo dinámico. Intenta el logo configurado por el
 * Administrador (GET /documents/logo, público) y, si no hay ninguno o falla
 * la carga, usa el logo institucional de SofIA como fallback.
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
  const src = fallo ? '/logo-sofia.png' : `${API_URL}/documents/logo`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="SofIA"
      width={width}
      height={height}
      className={className}
      style={{ objectFit: 'contain' }}
      onError={() => setFallo(true)}
    />
  );
}
