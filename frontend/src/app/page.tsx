'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { obtenerSesion } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const sesion = obtenerSesion();
    if (!sesion) router.replace('/login');
    else if (sesion.usuario.debeCambiarClave) router.replace('/cambiar-clave');
    // I76: la portada del Comercial es su tablero, no el dashboard operativo
    else router.replace(sesion.usuario.rol === 'COMERCIAL' ? '/tablero' : '/dashboard');
  }, [router]);
  return null;
}
