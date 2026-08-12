/**
 * Cliente API del frontend. La seguridad real está en el backend (RBAC);
 * aquí solo se gestiona el token, la navegación y el manejo robusto de
 * respuestas (H-8: 401 → cierre de sesión; JSON protegido por content-type).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export interface Sesion {
  token: string;
  usuario: {
    id: string;
    nombre: string;
    username: string;
    rol: string;
    debeCambiarClave: boolean;
  };
}

export function guardarSesion(s: Sesion) {
  localStorage.setItem('sofia_sesion', JSON.stringify(s));
}

export function obtenerSesion(): Sesion | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('sofia_sesion');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Sesion;
  } catch {
    // Sesión corrupta: se descarta en lugar de reventar la app
    localStorage.removeItem('sofia_sesion');
    return null;
  }
}

export function cerrarSesionLocal() {
  localStorage.removeItem('sofia_sesion');
}

/**
 * Normaliza el `message` de una respuesta de error del backend para
 * mostrarlo en la UI (QA Func. 2.6): si es un array de mensajes de
 * validación los une en un texto legible; si es string lo devuelve tal
 * cual; si no hay mensaje usa el fallback. Nunca muestra [object Object].
 */
export function mensajeError(body: unknown, fallback: string): string {
  const msg = (body as { message?: unknown } | null | undefined)?.message;
  if (Array.isArray(msg)) {
    const legibles = msg.filter((m): m is string => typeof m === 'string');
    if (legibles.length > 0) return legibles.join('. ');
  }
  if (typeof msg === 'string' && msg.trim() !== '') return msg;
  return fallback;
}

/** 401 en cualquier llamada → sesión expirada: se limpia y se redirige. */
function manejar401(status: number): void {
  if (status === 401 && typeof window !== 'undefined') {
    cerrarSesionLocal();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
}

/** Parseo seguro: solo intenta JSON si el content-type lo declara. */
async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return {} as T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return (await res.json()) as T;
    } catch {
      return {} as T;
    }
  }
  // Respuesta no-JSON (CSV, HTML de error de proxy, etc.): texto plano
  return (await res.text()) as unknown as T;
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const sesion = obtenerSesion();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (sesion?.token) headers['Authorization'] = `Bearer ${sesion.token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  manejar401(res.status);
  const body = await parseBody<T>(res);
  return { status: res.status, body };
}

/** Subida multipart (L-5): FormData sin Content-Type manual. */
export async function apiUpload<T = any>(
  path: string,
  formData: FormData,
  method: 'POST' | 'PUT' = 'POST',
): Promise<{ status: number; body: T }> {
  const sesion = obtenerSesion();
  const headers: Record<string, string> = {};
  if (sesion?.token) headers['Authorization'] = `Bearer ${sesion.token}`;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: formData });
  manejar401(res.status);
  const body = await parseBody<T>(res);
  return { status: res.status, body };
}

export interface LoginResponse {
  access_token: string;
  usuario: Sesion['usuario'];
  message?: string;
}

export async function login(
  username: string,
  password: string,
): Promise<{ status: number; body: LoginResponse }> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await parseBody<LoginResponse>(res) };
}
