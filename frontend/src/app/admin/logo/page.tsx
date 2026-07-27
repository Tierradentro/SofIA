'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUpload, obtenerSesion } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/** HU-006: carga del logo empresarial (solo Administrador). */
export default function LogoPage() {
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string>(`${API_URL}/documents/logo?t=${Date.now()}`);
  const [logoExiste, setLogoExiste] = useState(true);

  // L-7: gating por rol en el cliente (la seguridad real está en el backend)
  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol !== 'ADMINISTRADOR') return router.replace('/dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    if (!archivo) {
      setError('Seleccione un archivo de imagen (PNG o JPG)');
      return;
    }
    const formData = new FormData();
    formData.append('file', archivo);
    // L-5: subida centralizada con manejo robusto de sesión y respuesta
    const { status, body } = await apiUpload('/documents/logo', formData);
    if (status === 201) {
      setMensaje('Logo actualizado correctamente');
      setPreview(`${API_URL}/documents/logo?t=${Date.now()}`);
      setLogoExiste(true);
      setArchivo(null);
    } else {
      setError(body.message || 'No se pudo cargar el logo');
    }
  }

  return (
    <main className="min-h-screen p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-sofia-600">
        ← Volver al dashboard
      </button>
      <h1 className="mb-4 text-xl font-semibold">Logo empresarial</h1>

      <div className="max-w-xl rounded-lg bg-white p-5 shadow">
        <p className="mb-3 text-sm text-slate-600">
          El logo se usa en reportes y etiquetas. Formato PNG o JPG, máximo 5 MB.
        </p>

        <div className="mb-4 flex h-32 items-center justify-center rounded border bg-slate-50">
          {logoExiste ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Logo actual"
              className="max-h-28"
              onError={() => setLogoExiste(false)}
            />
          ) : (
            <span className="text-sm text-slate-400">Sin logo configurado</span>
          )}
        </div>

        <form onSubmit={subir} className="space-y-3">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setArchivo(e.target.files?.[0] || null)}
            className="block w-full text-sm"
          />
          <button className="w-full rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
            Cargar logo
          </button>
        </form>
        {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {mensaje && <p className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      </div>
    </main>
  );
}
