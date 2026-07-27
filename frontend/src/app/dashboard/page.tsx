'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { api, cerrarSesionLocal, obtenerSesion, Sesion } from '@/lib/api';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
  ciudad?: string;
}

/** Dashboard I1: empresas registradas (M03) y accesos según rol. */
export default function DashboardPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.debeCambiarClave) return router.replace('/cambiar-clave');
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) setEmpresas(body);
    });
  }, [router]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    cerrarSesionLocal();
    router.replace('/login');
  }

  if (!sesion) return null;
  const esAdmin = sesion.usuario.rol === 'ADMINISTRADOR';

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between bg-sofia-900 px-6 py-3 text-white">
        <div className="flex items-center gap-3">
          <Image src="/logo-sofia.png" alt="SofIA" width={40} height={40} />
          <span className="font-semibold">SofIA Logística Inteligente</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span>
            {sesion.usuario.nombre} · <strong>{sesion.usuario.rol}</strong>
          </span>
          <button
            onClick={() => router.push('/cambiar-clave')}
            className="rounded bg-sofia-700 px-3 py-1 hover:bg-sofia-600"
          >
            Cambiar clave
          </button>
          <button
            onClick={logout}
            className="rounded bg-red-600 px-3 py-1 hover:bg-red-700"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <section className="p-6">
        <div className="mb-6 flex flex-wrap gap-3">
          <button
            onClick={() => router.push('/productos')}
            className="rounded bg-sofia-600 px-4 py-2 text-white shadow hover:bg-sofia-700"
          >
            Productos
          </button>
          <button
            onClick={() => router.push('/clientes')}
            className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
          >
            Clientes
          </button>
          <button
            onClick={() => router.push('/comerciales')}
            className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
          >
            Comerciales
          </button>
          {['GENERADOR', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/importaciones')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Importaciones
            </button>
          )}
          {['GENERADOR', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/ocr')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              OCR Documentos
            </button>
          )}
          {['GENERADOR', 'OPERADOR', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/ingresos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Ingresos
            </button>
          )}
          {['GENERADOR', 'OPERADOR', 'COMERCIAL', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/pedidos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Pedidos
            </button>
          )}
          {['GENERADOR', 'OPERADOR', 'COMERCIAL', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/despachos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Despachos
            </button>
          )}
          {['GENERADOR', 'OPERADOR', 'COMERCIAL', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/devoluciones')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Devoluciones
            </button>
          )}
          {['GENERADOR', 'OPERADOR', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/movimientos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Movimientos
            </button>
          )}
          {['GENERADOR', 'OPERADOR', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/inventarios')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Inventarios
            </button>
          )}
          {sesion.usuario.rol === 'COMERCIAL' && (
            <button
              onClick={() => router.push('/tablero')}
              className="rounded bg-sofia-600 px-4 py-2 text-white shadow hover:bg-sofia-700"
            >
              Mi tablero
            </button>
          )}
        </div>
        <h1 className="mb-4 text-lg font-semibold">Empresas registradas</h1>
        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          {empresas.map((e) => (
            <div key={e.id} className="rounded-lg bg-white p-5 shadow">
              <p className="text-xl font-bold text-sofia-700">{e.siglas}</p>
              <p className="font-medium">{e.nombre}</p>
              {e.ciudad && <p className="text-sm text-slate-500">{e.ciudad}</p>}
            </div>
          ))}
        </div>

        {esAdmin && (
          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">Administración</h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => router.push('/admin/usuarios')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Usuarios
              </button>
              <button
                onClick={() => router.push('/empresas')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Empresas
              </button>
              <button
                onClick={() => router.push('/admin/auditoria')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Auditoría
              </button>
              <button
                onClick={() => router.push('/admin/transportadoras')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Transportadoras
              </button>
              <button
                onClick={() => router.push('/admin/api-keys')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                API Keys
              </button>
              <button
                onClick={() => router.push('/admin/parametros')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Parámetros
              </button>
              <button
                onClick={() => router.push('/admin/logo')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Logo
              </button>
              <button
                onClick={() => router.push('/admin/ocr')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                OCR
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
