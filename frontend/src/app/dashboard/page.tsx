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

interface PedidoKanban {
  id: string;
  numero: string;
  estado: 'ABIERTO' | 'ALISTADO' | 'APROBADO' | 'PENDIENTE_CORRECCION' | 'CANCELADO';
  valorTotal: number;
  createdAt: string;
  cliente: { id: string; nombre: string } | null;
}

interface DespachoKanban {
  id: string;
  numero: string;
  estado: 'CREADO' | 'ABIERTO' | 'PENDIENTE_CORRECCION' | 'PARCIAL' | 'DESPACHADO' | 'CANCELADO';
  tipoTransporte: string | null;
  clienteId: string;
}

/** QA Func. 3.1: columnas del tablero en el orden del ciclo de vida. */
const COLUMNAS_PEDIDOS: { valor: PedidoKanban['estado']; etiqueta: string; color: string }[] = [
  { valor: 'ABIERTO', etiqueta: 'Abierto', color: 'border-blue-400 bg-blue-50' },
  { valor: 'ALISTADO', etiqueta: 'Alistado', color: 'border-amber-400 bg-amber-50' },
  { valor: 'APROBADO', etiqueta: 'Aprobado', color: 'border-green-400 bg-green-50' },
  { valor: 'PENDIENTE_CORRECCION', etiqueta: 'Pendiente corrección', color: 'border-red-400 bg-red-50' },
  { valor: 'CANCELADO', etiqueta: 'Cancelado', color: 'border-slate-300 bg-slate-100' },
];

const COLUMNAS_DESPACHOS: { valor: DespachoKanban['estado']; etiqueta: string; color: string }[] = [
  { valor: 'CREADO', etiqueta: 'Creado', color: 'border-slate-400 bg-slate-50' },
  { valor: 'ABIERTO', etiqueta: 'Abierto', color: 'border-blue-400 bg-blue-50' },
  { valor: 'PARCIAL', etiqueta: 'Parcial', color: 'border-amber-400 bg-amber-50' },
  { valor: 'DESPACHADO', etiqueta: 'Despachado', color: 'border-green-400 bg-green-50' },
  { valor: 'PENDIENTE_CORRECCION', etiqueta: 'Pendiente corrección', color: 'border-red-400 bg-red-50' },
  { valor: 'CANCELADO', etiqueta: 'Cancelado', color: 'border-slate-300 bg-slate-100' },
];

/** Dashboard I1: empresas (M03), tablero operativo (QA Func. 3.1) y accesos según rol. */
export default function DashboardPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [pedidos, setPedidos] = useState<PedidoKanban[]>([]);
  const [despachos, setDespachos] = useState<DespachoKanban[]>([]);
  const [nombreClientes, setNombreClientes] = useState<Record<string, string>>({});

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.debeCambiarClave) return router.replace('/cambiar-clave');
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) setEmpresas(body);
    });
    // QA Func. 3.1: el backend filtra por rol (COMERCIAL solo ve lo suyo)
    api<PedidoKanban[]>('/orders').then(({ status, body }) => {
      if (status === 200) setPedidos(body);
    });
    api<DespachoKanban[]>('/dispatches').then(({ status, body }) => {
      if (status === 200) setDespachos(body);
    });
    // El listado de despachos trae clienteId; se resuelve el nombre con el catálogo
    api<{ id: string; nombre: string }[]>('/clients').then(({ status, body }) => {
      if (status === 200) {
        const mapa: Record<string, string> = {};
        for (const c of body) mapa[c.id] = c.nombre;
        setNombreClientes(mapa);
      }
    });
  }, [router]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    cerrarSesionLocal();
    router.replace('/login');
  }

  if (!sesion) return null;
  const esAdmin = sesion.usuario.rol === 'ADMINISTRADOR';
  const veTablero = ['GENERADOR', 'OPERADOR', 'COMERCIAL', 'ADMINISTRADOR'].includes(sesion.usuario.rol);

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
          {['GENERADOR', 'OPERADOR', 'ADMINISTRADOR'].includes(sesion.usuario.rol) && (
            <button
              onClick={() => router.push('/ingresos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Ingresos
            </button>
          )}
          {veTablero && (
            <button
              onClick={() => router.push('/pedidos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Pedidos
            </button>
          )}
          {veTablero && (
            <button
              onClick={() => router.push('/despachos')}
              className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
            >
              Despachos
            </button>
          )}
          {veTablero && (
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

        {/* QA Func. 3.1: tablero Kanban de Pedidos y Despachos por estado */}
        {veTablero && (
          <div className="mb-8 space-y-6">
            <div>
              <h2 className="mb-2 text-lg font-semibold">Pedidos</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {COLUMNAS_PEDIDOS.map((col) => {
                  const tarjetas = pedidos.filter((p) => p.estado === col.valor);
                  return (
                    <div key={col.valor} className={`w-56 shrink-0 rounded-lg border-t-4 p-2 ${col.color}`}>
                      <p className="mb-2 text-sm font-semibold text-slate-700">
                        {col.etiqueta} <span className="text-slate-400">({tarjetas.length})</span>
                      </p>
                      <div className="space-y-2">
                        {tarjetas.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => router.push('/pedidos')}
                            className="block w-full rounded bg-white p-2 text-left text-sm shadow-sm hover:shadow"
                          >
                            <span className="font-medium text-sofia-800">{p.numero}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {p.cliente?.nombre ?? 'Sin cliente'}
                            </span>
                            <span className="block text-xs text-slate-400">
                              $ {Number(p.valorTotal).toLocaleString('es-CO')}
                            </span>
                          </button>
                        ))}
                        {!tarjetas.length && <p className="text-xs text-slate-400">Vacío</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-lg font-semibold">Despachos</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {COLUMNAS_DESPACHOS.map((col) => {
                  const tarjetas = despachos.filter((d) => d.estado === col.valor);
                  return (
                    <div key={col.valor} className={`w-56 shrink-0 rounded-lg border-t-4 p-2 ${col.color}`}>
                      <p className="mb-2 text-sm font-semibold text-slate-700">
                        {col.etiqueta} <span className="text-slate-400">({tarjetas.length})</span>
                      </p>
                      <div className="space-y-2">
                        {tarjetas.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => router.push('/despachos')}
                            className="block w-full rounded bg-white p-2 text-left text-sm shadow-sm hover:shadow"
                          >
                            <span className="font-medium text-sofia-800">{d.numero}</span>
                            <span className="block truncate text-xs text-slate-500">
                              {nombreClientes[d.clienteId] ?? 'Cliente'}
                            </span>
                            {d.tipoTransporte && (
                              <span className="block text-xs text-slate-400">{d.tipoTransporte}</span>
                            )}
                          </button>
                        ))}
                        {!tarjetas.length && <p className="text-xs text-slate-400">Vacío</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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
              {/* QA Func. 3.4: importaciones y procesamiento OCR solo en el menú
                  del Administrador (la ejecución de OCR sigue abierta en la API) */}
              <button
                onClick={() => router.push('/importaciones')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Importaciones
              </button>
              <button
                onClick={() => router.push('/ocr')}
                className="rounded bg-white px-4 py-2 shadow hover:bg-slate-50"
              >
                Procesar documentos OCR
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
                Configurar motor OCR
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
