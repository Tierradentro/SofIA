'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';
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
  // I18: el pedido manual permite elegir la empresa registrada
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string }[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [clientes, setClientes] = useState<any[]>([]);
  const [comerciales, setComerciales] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    api<{ id: string; nombre: string }[]>('/companies').then(({ status, body }) => {
      if (status === 200 && body.length) {
        setEmpresas(body);
        setEmpresaId((prev) => prev || body[0].id);
      }
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
    // I26: el pedido solo ofrece productos con existencias
    api<any[]>(`/products?empresaId=${empresaId}&conStock=true`).then(({ status, body }) => {
      if (status === 200) setProductos(body);
    });
  }, [empresaId]);

  if (!sesion || !empresaId) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Nuevo pedido"
        descripcion="Cree la orden manualmente, desde un PDF con OCR (con revisión previa) o desde un archivo Excel."
      />
      <NuevoPedido
        key={empresaId}
        empresaId={empresaId}
        empresas={empresas}
        onCambiarEmpresa={setEmpresaId}
        clientes={clientes}
        comerciales={comerciales}
        productos={productos}
        rol={sesion.usuario.rol}
        onCreado={(id) => router.push(`/pedidos?abrir=${id}`)}
        onCancelar={() => router.push('/pedidos')}
      />
    </AppShell>
  );
}
