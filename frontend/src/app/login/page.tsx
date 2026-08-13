'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, LogIn, ShieldCheck, User } from 'lucide-react';
import { guardarSesion, login, mensajeError } from '@/lib/api';
import { LogoSofia } from '@/components/logo';

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
      setError(mensajeError(body, 'Usuario o contraseña incorrectos'));
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-sofia-950">
      {/* Fondo: almacén inteligente a pantalla completa */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/login-fondo.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-sofia-950/55" />

      {/* Marca superior */}
      <header className="relative z-10 px-6 py-5 md:px-10">
        <p className="text-lg font-bold tracking-tight text-white drop-shadow">
          SofIA Logística Inteligente
        </p>
      </header>

      {/* Tarjeta de identificación */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 pb-10">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md rounded-2xl bg-white/95 p-8 shadow-2xl backdrop-blur"
        >
          <div className="mb-6 flex flex-col items-center gap-2">
            <LogoSofia width={96} height={96} />
            <h1 className="text-xl font-semibold text-sofia-900">
              Identificación de Usuario
            </h1>
          </div>

          <label className="mb-1 block text-sm font-medium text-slate-600">
            Usuario
          </label>
          <div className="relative mb-4">
            <User size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
              placeholder="nombre de usuario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <label className="mb-1 block text-sm font-medium text-slate-600">
            Contraseña
          </label>
          <div className="relative mb-3">
            <Lock size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm focus:border-sofia-500 focus:outline-none focus:ring-1 focus:ring-sofia-500"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <p className="mb-5 text-right text-xs text-slate-500">
            ¿Olvidó su contraseña? Contacte al administrador del sistema.
          </p>

          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sofia-700 py-2.5 font-medium text-white transition-colors hover:bg-sofia-600 disabled:opacity-50"
          >
            <LogIn size={18} />
            {cargando ? 'Ingresando…' : 'Ingresar al Sistema'}
          </button>

          <p className="mt-6 flex items-start justify-center gap-1.5 text-center text-xs text-slate-400">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            Solo personal autorizado. El acceso no autorizado está prohibido y es monitoreado.
          </p>
        </form>
      </div>

      {/* Pie */}
      <footer className="relative z-10 flex flex-col items-center justify-between gap-2 border-t border-white/10 px-6 py-4 text-xs text-sofia-100/80 sm:flex-row md:px-10">
        <p>© 2026 SofIA Logística Inteligente. Uso exclusivo para empleados.</p>
        <div className="flex gap-5">
          <span>Privacidad</span>
          <span>Términos</span>
          <span>Soporte</span>
        </div>
      </footer>
    </main>
  );
}
