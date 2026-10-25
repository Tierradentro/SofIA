/**
 * I57: huella del navegador para el control de dispositivos.
 * Un UUID generado una vez y conservado en localStorage identifica este
 * navegador; el login lo registra con sus características y el token queda
 * ligado a él. La autorización es por dispositivo, no por usuario.
 */

const CLAVE_DEVICE_ID = 'sofia_device_id';

/** UUID estable de este navegador (se genera en el primer uso). */
export function obtenerDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(CLAVE_DEVICE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLAVE_DEVICE_ID, id);
  }
  return id;
}

/** Nombre legible del navegador y sistema, p. ej. «Chrome 126 · Windows». */
function nombreNavegador(): string {
  const ua = navigator.userAgent;
  let navegador = 'Navegador';
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/))) navegador = `Edge ${m[1]}`;
  else if ((m = ua.match(/Chrome\/(\d+)/))) navegador = `Chrome ${m[1]}`;
  else if ((m = ua.match(/Firefox\/(\d+)/))) navegador = `Firefox ${m[1]}`;
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) navegador = `Safari ${m[1]}`;
  else if (ua.includes('Safari')) navegador = 'Safari';

  let so = '';
  if (/Windows NT 10/.test(ua)) so = 'Windows 10/11';
  else if (/Windows/.test(ua)) so = 'Windows';
  else if (/Mac OS X/.test(ua)) so = 'macOS';
  else if (/Android/.test(ua)) so = 'Android';
  else if (/iPhone|iPad/.test(ua)) so = 'iOS';
  else if (/Linux/.test(ua)) so = 'Linux';

  return so ? `${navegador} · ${so}` : navegador;
}

export interface InfoDispositivo {
  deviceId: string;
  nombre: string;
  userAgent: string;
  idioma: string;
  plataforma: string;
  resolucion: string;
}

/** Características del navegador que se registran en el login. */
export function caracteristicasDispositivo(): InfoDispositivo {
  return {
    deviceId: obtenerDeviceId(),
    nombre: nombreNavegador(),
    userAgent: navigator.userAgent,
    idioma: navigator.language || '',
    plataforma: navigator.platform || '',
    resolucion: `${window.screen.width}x${window.screen.height}`,
  };
}
