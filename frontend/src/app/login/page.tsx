'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { guardarSesion, login } from '@/lib/api';

/** HU-001: inicio de sesión. Error genérico sin revelar información sensible. */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError('');
    const { status, body } = await login(username, password);
    setCargando(false);
    if (status === 200) {
      guardarSesion({ token: body.access_token, usuario: body.usuario });
      router.replace(body.usuario.debeCambiarClave ? '/cambiar-clave' : '/dashboard');
    } else {
      setError(body.message || 'Usuario o contraseña incorrectos');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sofia-900">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg"
      >
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src="/logo-sofia.png" alt="SofIA" width={120} height={120} />
          <h1 className="text-xl font-semibold text-sofia-900">
            SofIA Logística Inteligente
          </h1>
        </div>
        <label className="mb-1 block text-sm font-medium">Usuario</label>
        <input
          className="mb-4 w-full rounded border px-3 py-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <label className="mb-1 block text-sm font-medium">Contraseña</label>
        <input
          type="password"
          className="mb-4 w-full rounded border px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={cargando}
          className="w-full rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700 disabled:opacity-50"
        >
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="mt-4 text-center text-xs text-slate-500">
          ¿Olvidó su contraseña? Contacte al administrador del sistema.
        </p>
      </form>
    </main>
  );
}
