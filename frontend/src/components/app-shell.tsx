'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Container,
  FileUp,
  Image as ImageIcon,
  Inbox,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Package,
  RotateCcw,
  ScanText,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api, cerrarSesionLocal, Sesion } from '@/lib/api';
import { LogoSofia } from '@/components/logo';

/** I17: navegación persistente por rol (reemplaza los botones del dashboard). */
interface ItemNav {
  href: string;
  etiqueta: string;
  icono: LucideIcon;
  roles: string[];
}

const TODOS = ['ADMINISTRADOR', 'GENERADOR', 'OPERADOR', 'COMERCIAL'];
const GOA = ['GENERADOR', 'OPERADOR', 'ADMINISTRADOR'];
const GOCA = [...GOA, 'COMERCIAL'];

const NAV_OPERACIONES: ItemNav[] = [
  { href: '/dashboard', etiqueta: 'Dashboard', icono: LayoutDashboard, roles: TODOS },
  { href: '/productos', etiqueta: 'Productos', icono: Package, roles: TODOS },
  { href: '/clientes', etiqueta: 'Clientes', icono: Users, roles: TODOS },
  // I21: Comerciales y Movimientos ya no se ofrecen al perfil Operador
  { href: '/comerciales', etiqueta: 'Comerciales', icono: Briefcase, roles: ['ADMINISTRADOR', 'GENERADOR', 'COMERCIAL'] },
  { href: '/ingresos', etiqueta: 'Ingresos', icono: Inbox, roles: GOA },
  { href: '/pedidos', etiqueta: 'Pedidos', icono: ShoppingCart, roles: GOCA },
  { href: '/despachos', etiqueta: 'Despachos', icono: Truck, roles: GOCA },
  { href: '/devoluciones', etiqueta: 'Devoluciones', icono: RotateCcw, roles: GOCA },
  { href: '/movimientos', etiqueta: 'Movimientos', icono: ArrowLeftRight, roles: ['ADMINISTRADOR', 'GENERADOR'] },
  { href: '/inventarios', etiqueta: 'Inventarios', icono: Warehouse, roles: GOA },
  { href: '/tablero', etiqueta: 'Mi tablero', icono: KanbanSquare, roles: ['COMERCIAL'] },
];

const NAV_ADMIN: ItemNav[] = [
  { href: '/admin/usuarios', etiqueta: 'Usuarios', icono: UserCog, roles: ['ADMINISTRADOR'] },
  { href: '/empresas', etiqueta: 'Empresas', icono: Building2, roles: ['ADMINISTRADOR'] },
  { href: '/importaciones', etiqueta: 'Importaciones', icono: FileUp, roles: ['ADMINISTRADOR'] },
  { href: '/ocr', etiqueta: 'Procesar OCR', icono: ScanText, roles: ['ADMINISTRADOR'] },
  { href: '/admin/auditoria', etiqueta: 'Auditoría', icono: ClipboardList, roles: ['ADMINISTRADOR'] },
  { href: '/admin/transportadoras', etiqueta: 'Transportadoras', icono: Container, roles: ['ADMINISTRADOR'] },
  { href: '/admin/api-keys', etiqueta: 'API Keys', icono: KeyRound, roles: ['ADMINISTRADOR'] },
  { href: '/admin/parametros', etiqueta: 'Parámetros', icono: SlidersHorizontal, roles: ['ADMINISTRADOR'] },
  { href: '/admin/logo', etiqueta: 'Logo', icono: ImageIcon, roles: ['ADMINISTRADOR'] },
  { href: '/admin/ocr', etiqueta: 'Motor OCR', icono: Settings, roles: ['ADMINISTRADOR'] },
];

function esActivo(ruta: string, href: string): boolean {
  if (href === '/dashboard') return ruta === href;
  return ruta === href || ruta.startsWith(`${href}/`);
}

/** Ítem del menú: píldora marino con barra menta cuando está activo. */
function ItemMenu({
  item,
  activo,
  colapsado,
  alNavegar,
}: {
  item: ItemNav;
  activo: boolean;
  colapsado: boolean;
  alNavegar?: () => void;
}) {
  const router = useRouter();
  const Icono = item.icono;
  return (
    <button
      type="button"
      title={colapsado ? item.etiqueta : undefined}
      onClick={() => {
        router.push(item.href);
        alNavegar?.();
      }}
      className={`group flex w-full items-center gap-3 rounded-lg border-l-4 px-3 py-2 text-sm transition-colors ${
        activo
          ? 'border-menta-400 bg-sofia-700 font-medium text-white'
          : 'border-transparent text-sofia-100 hover:bg-sofia-800 hover:text-white'
      } ${colapsado ? 'justify-center px-2' : ''}`}
    >
      <Icono
        size={18}
        className={`shrink-0 ${activo ? 'text-menta-300' : 'text-sofia-200 group-hover:text-menta-300'}`}
      />
      {!colapsado && <span className="truncate">{item.etiqueta}</span>}
    </button>
  );
}

function SeccionMenu({
  titulo,
  items,
  rol,
  ruta,
  colapsado,
  alNavegar,
  plegable,
}: {
  titulo: string;
  items: ItemNav[];
  rol: string;
  ruta: string;
  colapsado: boolean;
  alNavegar?: () => void;
  /** I25: permite recoger/desplegar la lista de opciones de la sección. */
  plegable?: boolean;
}) {
  const [recogida, setRecogida] = useState(false);
  const visibles = items.filter((i) => i.roles.includes(rol));
  if (!visibles.length) return null;
  const mostrarItems = !recogida || colapsado;
  return (
    <div className="mb-4">
      {!colapsado && (
        plegable ? (
          <button
            type="button"
            onClick={() => setRecogida((v) => !v)}
            aria-expanded={!recogida}
            className="mb-1 flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-sofia-200/70 hover:text-white"
          >
            {titulo}
            {recogida ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        ) : (
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-sofia-200/70">
            {titulo}
          </p>
        )
      )}
      {mostrarItems && (
        <div className="space-y-0.5">
          {visibles.map((item) => (
            <ItemMenu
              key={item.href}
              item={item}
              activo={esActivo(ruta, item.href)}
              colapsado={colapsado}
              alNavegar={alNavegar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContenidoSidebar({
  sesion,
  colapsado,
  alNavegar,
}: {
  sesion: Sesion;
  colapsado: boolean;
  alNavegar?: () => void;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const rol = sesion.usuario.rol;

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    cerrarSesionLocal();
    router.replace('/login');
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-sofia-900 to-sofia-950 text-white">
      {/* Marca */}
      <div className={`flex items-center gap-3 border-b border-sofia-800 px-4 py-4 ${colapsado ? 'justify-center px-2' : ''}`}>
        <LogoSofia width={40} height={40} />
        {!colapsado && (
          <div className="leading-tight">
            <p className="text-lg font-bold">SofIA</p>
            <p className="text-xs text-sofia-200">Logística Inteligente</p>
          </div>
        )}
      </div>

      {/* Menú */}
      <nav className={`flex-1 overflow-y-auto px-2 py-4 ${colapsado ? 'px-1.5' : ''}`}>
        <SeccionMenu titulo="Operaciones" items={NAV_OPERACIONES} rol={rol} ruta={ruta} colapsado={colapsado} alNavegar={alNavegar} />
        <SeccionMenu titulo="Administración" items={NAV_ADMIN} rol={rol} ruta={ruta} colapsado={colapsado} alNavegar={alNavegar} plegable />
      </nav>

      {/* Pie: usuario + sesión */}
      <div className={`border-t border-sofia-800 p-3 ${colapsado ? 'px-1.5' : ''}`}>
        <div className={`mb-2 flex items-center gap-2 ${colapsado ? 'justify-center' : 'px-1'}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-menta-400 text-sm font-bold text-sofia-900">
            {sesion.usuario.nombre.charAt(0).toUpperCase()}
          </span>
          {!colapsado && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium">{sesion.usuario.nombre}</p>
              <p className="text-xs text-sofia-200">{sesion.usuario.rol}</p>
            </div>
          )}
        </div>
        <div className={`flex gap-1 ${colapsado ? 'flex-col items-center' : ''}`}>
          <button
            type="button"
            title="Cambiar clave"
            onClick={() => router.push('/cambiar-clave')}
            className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs text-sofia-100 hover:bg-sofia-800 hover:text-white"
          >
            <Lock size={15} className="shrink-0" />
            {!colapsado && 'Cambiar clave'}
          </button>
          <button
            type="button"
            title="Cerrar sesión"
            onClick={logout}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs text-sofia-100 hover:bg-red-600/80 hover:text-white"
          >
            <LogOut size={15} className="shrink-0" />
            {!colapsado && 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * I17: layout de la aplicación autenticada.
 * - PC (lg+): sidebar expandido de 256 px.
 * - Tablet (md): riel de solo iconos de 64 px.
 * - Móvil: barra superior con menú deslizable.
 */
export function AppShell({ sesion, children }: { sesion: Sesion; children: React.ReactNode }) {
  const [menuMovil, setMenuMovil] = useState(false);

  return (
    <div className="min-h-screen">
      {/* Sidebar fijo: riel en tablet, completo en PC */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 md:block lg:w-64">
        <div className="hidden h-full lg:block">
          <ContenidoSidebar sesion={sesion} colapsado={false} />
        </div>
        <div className="h-full lg:hidden">
          <ContenidoSidebar sesion={sesion} colapsado />
        </div>
      </aside>

      {/* Barra superior móvil */}
      <div className="sticky top-0 z-30 flex items-center gap-3 bg-sofia-900 px-4 py-3 text-white md:hidden">
        <button type="button" aria-label="Abrir menú" onClick={() => setMenuMovil(true)}>
          <Menu size={22} />
        </button>
        <span className="font-semibold">SofIA Logística Inteligente</span>
      </div>

      {/* Menú deslizable móvil */}
      {menuMovil && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuMovil(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={() => setMenuMovil(false)}
              className="absolute -right-10 top-3 text-white"
            >
              <X size={24} />
            </button>
            <ContenidoSidebar sesion={sesion} colapsado={false} alNavegar={() => setMenuMovil(false)} />
          </div>
        </div>
      )}

      {/* Contenido */}
      <main className="md:pl-16 lg:pl-64">
        <div className="p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
