'use client';

/**
 * HU-013: componente de consulta de producto por código de barras, código,
 * código OE o referencia cruzada. Se usa en la pantalla de consulta y en
 * los flujos operativos (picking, despacho, ingreso).
 */
import { useState } from 'react';
import { api } from '@/lib/api';

export interface ProductoDetalle {
  id: string;
  codigo: string;
  descripcion: string;
  marca?: string;
  ubicacion?: string;
  codigoBarras?: { barcode: string; origen: string } | null;
  empresa: { nombre: string; siglas: string };
  inventario: { cantidad: number; cantidadBloqueada: number; disponible: number };
}

export function ConsultaProducto({ empresaId }: { empresaId?: string }) {
  const [criterio, setCriterio] = useState('');
  const [resultado, setResultado] = useState<ProductoDetalle | null>(null);
  const [error, setError] = useState('');

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResultado(null);
    const qs = empresaId ? `?empresaId=${empresaId}` : '';
    const { status, body } = await api<any>(
      `/products/lookup/${encodeURIComponent(criterio)}${qs}`,
    );
    if (status === 200) setResultado(body as ProductoDetalle);
    else setError(body.message || 'Producto no encontrado');
  }

  return (
    <div>
      <form onSubmit={buscar} className="flex gap-3">
        <input
          placeholder="Código de barras, código, OE o referencia cruzada"
          className="flex-1 rounded border px-3 py-2"
          value={criterio}
          onChange={(e) => setCriterio(e.target.value)}
          required
        />
        <button className="rounded bg-sofia-600 px-4 py-2 text-white">Consultar</button>
      </form>
      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {resultado && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm">
          <p><span className="font-medium">Empresa:</span> {resultado.empresa.nombre}</p>
          <p><span className="font-medium">Referencia:</span> {resultado.codigo}</p>
          <p className="col-span-2"><span className="font-medium">Descripción:</span> {resultado.descripcion}</p>
          <p>
            <span className="font-medium">Código de barras:</span>{' '}
            {resultado.codigoBarras?.barcode || 'Sin asociar'}
          </p>
          <p><span className="font-medium">Ubicación:</span> {resultado.ubicacion || '—'}</p>
          <p><span className="font-medium">Existencia:</span> {resultado.inventario.cantidad}</p>
          <p><span className="font-medium">Disponible:</span> {resultado.inventario.disponible}</p>
        </div>
      )}
    </div>
  );
}
