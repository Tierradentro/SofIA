'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ShieldCheck } from 'lucide-react';
import { api, obtenerSesion, guardarSesion, mensajeError } from '@/lib/api';
import { LogoSofia } from '@/components/logo';
import { CLASE_BOTON_PRIMARIO, CLASE_INPUT } from '@/components/ui';

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/login-fondo.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-sofia-950/60" />

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl bg-white/95 p-8 shadow-2xl backdrop-blur"
      >
        <div className="mb-6 flex justify-center">
          <LogoSofia width={180} height={72} />
        </div>
        <h1 className="mb-2 text-center text-xl font-bold text-sofia-900">
          Cambio de contraseña
        </h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          Por seguridad debe establecer una nueva contraseña (mínimo 6
          caracteres, con mayúsculas, minúsculas y números).
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña actual</label>
        <div className="relative mb-4">
          <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            className={`${CLASE_INPUT} pl-9`}
            value={claveActual}
            onChange={(e) => setClaveActual(e.target.value)}
            required
          />
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">Nueva contraseña</label>
        <div className="relative mb-4">
          <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            className={`${CLASE_INPUT} pl-9`}
            value={claveNueva}
            onChange={(e) => setClaveNueva(e.target.value)}
            required
          />
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-700">Confirmación</label>
        <div className="relative mb-4">
          <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            className={`${CLASE_INPUT} pl-9`}
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        {mensaje && (
          <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>
        )}

        <button type="submit" className={`${CLASE_BOTON_PRIMARIO} w-full`}>
          Actualizar contraseña
        </button>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
          <ShieldCheck size={13} className="text-menta-600" />
          La contraseña se almacena cifrada y nunca se muestra en pantalla.
        </p>
      </form>
    </main>
  );
}
