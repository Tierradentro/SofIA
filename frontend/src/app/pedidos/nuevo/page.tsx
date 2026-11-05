'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';
import { BorradorPedido, NuevoPedido } from './formulario';

/**
 * QA Func. 3.2/3.3: ruta dedicada de creación de pedido (formato
 * "Orden de Pedido"). Antes el formulario vivía inline en el listado;
 * ahora es una vista a pantalla completa con las 3 vías (manual, OCR
 * con revisión previa, Excel).
 * I67: si hay borradores guardados (la aplicación se cerró o se fue la
 * luz en medio de la digitación), se ofrece retomarlos o descartarlos.
 */

interface BorradorResumen extends BorradorPedido {
  clienteId: string | null;
  productos: number;
  via: string;
  updatedAt: string;
}

export default function NuevoPedidoPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  // I18: el pedido manual permite elegir la empresa registrada
  // I39: la razón social emisora se muestra con su NIT
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string; identificacion?: string | null }[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [clientes, setClientes] = useState<any[]>([]);
  const [comerciales, setComerciales] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  // I67: borradores pendientes de retomar o descartar
  const [borradores, setBorradores] = useState<BorradorResumen[]>([]);
  const [borradorActivo, setBorradorActivo] = useState<BorradorResumen | null>(null);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol === 'API') return router.replace('/dashboard');
    setSesion(s);
    api<{ id: string; nombre: string; identificacion?: string | null }[]>('/companies').then(({ status, body }) => {
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
    // I67: recuperación de trabajo sin confirmar
    api<BorradorResumen[]>('/orders/drafts').then(({ status, body }) => {
      if (status === 200) setBorradores(body);
    });
  }, [router]);

  useEffect(() => {
    if (!empresaId) return;
    // I26: el pedido solo ofrece productos con existencias
    api<any[]>(`/products?empresaId=${empresaId}&conStock=true`).then(({ status, body }) => {
      if (status === 200) setProductos(body);
    });
  }, [empresaId]);

  /** I67: retomar el borrador en el formulario (cambia empresa si hace falta). */
  function retomar(b: BorradorResumen) {
    setBorradores((prev) => prev.filter((x) => x.id !== b.id));
    setBorradorActivo(b);
    if (b.empresaId && b.empresaId !== empresaId) setEmpresaId(b.empresaId);
  }

  /** I67: descartar el borrador definitivamente (empieza de cero). */
  async function descartar(id: string) {
    await api(`/orders/drafts/${id}`, { method: 'DELETE' });
    setBorradores((prev) => prev.filter((x) => x.id !== id));
  }

  if (!sesion || !empresaId) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Nuevo pedido"
        descripcion="Cree la orden manualmente, desde un PDF con OCR (con revisión previa) o desde un archivo Excel."
      />
      {/* I67: aviso de recuperación — el trabajo digitado no se pierde */}
      {borradores.length > 0 && (
        <div className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-900">
            {borradores.length === 1
              ? 'Hay un pedido en borrador sin confirmar'
              : `Hay ${borradores.length} pedidos en borrador sin confirmar`}
          </p>
          <p className="mb-3 text-xs text-amber-800">
            El contenido se guardó automáticamente. Puede retomarlo donde quedó o descartarlo.
          </p>
          <ul className="space-y-2">
            {borradores.map((b) => {
              const cliente = clientes.find((c) => c.id === b.clienteId);
              const empresa = empresas.find((e) => e.id === b.empresaId);
              const fecha = new Date(b.updatedAt);
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800">
                    {cliente?.nombre ?? 'Sin cliente aún'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {empresa?.nombre ? `${empresa.nombre} · ` : ''}
                    {b.productos} producto(s) · guardado{' '}
                    {fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })}{' '}
                    {fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => retomar(b)}
                      className="rounded bg-sofia-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sofia-600"
                    >
                      Continuar
                    </button>
                    <button
                      type="button"
                      onClick={() => descartar(b.id)}
                      className="rounded bg-red-50 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
                    >
                      Descartar
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <NuevoPedido
        key={`${empresaId}-${borradorActivo?.id ?? 'nuevo'}`}
        empresaId={empresaId}
        empresas={empresas}
        onCambiarEmpresa={setEmpresaId}
        clientes={clientes}
        comerciales={comerciales}
        productos={productos}
        rol={sesion.usuario.rol}
        borrador={borradorActivo}
        onCreado={(id) => router.push(`/pedidos?abrir=${id}`)}
        onCancelar={() => router.push('/pedidos')}
      />
    </AppShell>
  );
}
