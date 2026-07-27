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
    else router.replace('/dashboard');
  }, [router]);
  return null;
}
