'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { NuevoPedido } from './formulario';

/**
 * QA Func. 3.2/3.3: ruta dedicada de creación de pedido (formato
 * "Orden de Pedido"). Antes el formulario vivía inline en el listado;
 * ahora es una vista a pantalla completa con las 3 vías (manual, OCR
 * con revisión previa, Excel).
 */
export default function NuevoPedidoPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresaId, setEmpresaId] = useState('');
  const [clientes, setClientes] = useState<any[]>([]);
  const [comerciales, setComerciales] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    api<{ id: string }[]>('/companies').then(({ status, body }) => {
      if (status === 200 && body.length) setEmpresaId(body[0].id);
    });
    api<any[]>('/clients').then(({ status, body }) => {
      if (status === 200) setClientes(body);
    });
    api<any[]>('/comerciales').then(({ status, body }) => {
      if (status === 200) setComerciales(body);
    });
  }, [router]);

  useEffect(() => {
    if (!empresaId) return;
    api<any[]>(`/products?empresaId=${empresaId}`).then(({ status, body }) => {
      if (status === 200) setProductos(body);
    });
  }, [empresaId]);

  if (!sesion || !empresaId) return null;

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <button
        onClick={() => router.push('/pedidos')}
        className="mb-4 text-sm text-sofia-600 hover:underline"
      >
        ← Volver a pedidos
      </button>
      <NuevoPedido
        empresaId={empresaId}
        clientes={clientes}
        comerciales={comerciales}
        productos={productos}
        rol={sesion.usuario.rol}
        onCreado={(id) => router.push(`/pedidos?abrir=${id}`)}
        onCancelar={() => router.push('/pedidos')}
      />
    </main>
  );
}
