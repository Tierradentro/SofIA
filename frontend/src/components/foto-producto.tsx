'use client';

/**
 * I41: foto del producto. Se muestra en las tarjetas de consulta y en la
 * ficha técnica. La cargan los tres roles (Operador, Generador y
 * Administrador); solo Generador y Administrador pueden eliminarla.
 * La imagen es un recurso protegido: se descarga con el token de sesión
 * y se muestra como blob local.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { API_URL, api, apiUpload, obtenerSesion } from '@/lib/api';

export function FotoProducto({
  productoId,
  tieneFoto,
  puedeEliminar,
  soloLectura = false,
  onCambio,
  className = '',
}: {
  productoId: string;
  tieneFoto: boolean;
  /** Generador/Administrador: muestra el botón de eliminar. */
  puedeEliminar: boolean;
  /** Solo visualización (consulta operativa): oculta cargar/eliminar. */
  soloLectura?: boolean;
  /** Se llama tras subir o eliminar para refrescar los datos del producto. */
  onCambio?: () => void;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let vivo = true;
    setUrl(null);
    if (tieneFoto) {
      const ses = obtenerSesion();
      fetch(`${API_URL}/products/${productoId}/foto`, {
        headers: { Authorization: `Bearer ${ses?.token}` },
      })
        .then(async (res) => {
          if (!res.ok || !vivo) return;
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => undefined);
    }
    return () => {
      vivo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [productoId, tieneFoto]);

  async function subir(archivo: File | null) {
    if (!archivo) return;
    setError('');
    setCargando(true);
    const form = new FormData();
    form.append('file', archivo);
    const { status, body } = await apiUpload(`/products/${productoId}/foto`, form);
    setCargando(false);
    if (inputRef.current) inputRef.current.value = '';
    if (status === 200 || status === 201) {
      onCambio?.();
    } else {
      setError((body as any)?.message ?? 'No se pudo cargar la foto');
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar la foto del producto?')) return;
    setError('');
    const { status, body } = await api(`/products/${productoId}/foto`, { method: 'DELETE' });
    if (status === 200) onCambio?.();
    else setError((body as any)?.message ?? 'No se pudo eliminar la foto');
  }

  return (
    <div className={className}>
      {url ? (
        <img
          src={url}
          alt="Foto del producto"
          className="h-36 w-36 rounded-lg border border-slate-200 bg-white object-cover"
        />
      ) : (
        <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
          {tieneFoto ? 'Cargando…' : 'Sin foto'}
        </div>
      )}
      {!soloLectura && (
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => subir(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={cargando}
          className="flex items-center gap-1 rounded-lg bg-sofia-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-sofia-600 disabled:opacity-50"
        >
          <ImagePlus size={14} /> {tieneFoto ? 'Cambiar foto' : 'Cargar foto'}
        </button>
        {tieneFoto && puedeEliminar && (
          <button
            type="button"
            onClick={eliminar}
            className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
          >
            <Trash2 size={14} /> Eliminar
          </button>
        )}
      </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
