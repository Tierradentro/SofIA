'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, guardarSesion, mensajeError } from '@/lib/api';

/** HU-003 / M02: cambio de clave (obligatorio en primer login o tras reseteo). */
export default function CambiarClavePage() {
  const router = useRouter();
  const [claveActual, setClaveActual] = useState('');
  const [claveNueva, setClaveNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ claveActual, claveNueva, confirmacion }),
    });
    if (status === 200) {
      const sesion = obtenerSesion();
      if (sesion) {
        sesion.usuario.debeCambiarClave = false;
        guardarSesion(sesion);
      }
      setMensaje('Contraseña actualizada. Redirigiendo…');
      setTimeout(() => router.replace('/dashboard'), 800);
    } else {
      const detalle = Array.isArray(body.detalles) ? `: ${body.detalles.join(', ')}` : '';
      setError(mensajeError(body, 'No se pudo cambiar la contraseña') + detalle);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sofia-900">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg"
      >
        <h1 className="mb-2 text-xl font-semibold text-sofia-900">
          Cambio de contraseña
        </h1>
        <p className="mb-6 text-sm text-slate-600">
          Por seguridad debe establecer una nueva contraseña (mínimo 6
          caracteres, con mayúsculas, minúsculas y números).
        </p>
        <label className="mb-1 block text-sm font-medium">Contraseña actual</label>
        <input
          type="password"
          className="mb-4 w-full rounded border px-3 py-2"
          value={claveActual}
          onChange={(e) => setClaveActual(e.target.value)}
          required
        />
        <label className="mb-1 block text-sm font-medium">Nueva contraseña</label>
        <input
          type="password"
          className="mb-4 w-full rounded border px-3 py-2"
          value={claveNueva}
          onChange={(e) => setClaveNueva(e.target.value)}
          required
        />
        <label className="mb-1 block text-sm font-medium">Confirmación</label>
        <input
          type="password"
          className="mb-4 w-full rounded border px-3 py-2"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          required
        />
        {error && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {mensaje && (
          <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700"
        >
          Actualizar contraseña
        </button>
      </form>
    </main>
  );
}
