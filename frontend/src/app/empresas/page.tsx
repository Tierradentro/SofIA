'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Empresas (M03, B-10): el Administrador crea y edita las empresas que
 * comparten la bodega (multiempresa 1..N). Las siglas componen los
 * consecutivos visibles de pedido e inventario.
 */
export default function EmpresasPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [nombre, setNombre] = useState('');
  const [siglas, setSiglas] = useState('');
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [mensaje, setMensaje] = useState('');

  const cargar = () =>
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) setEmpresas(body);
    });

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol !== 'ADMINISTRADOR') return router.replace('/dashboard');
    setSesion(s);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const limpiar = () => {
    setEditando(null);
    setNombre('');
    setSiglas('');
    setMensaje('');
  };

  const guardar = async () => {
    setMensaje('');
    if (!nombre.trim() || !siglas.trim()) {
      setMensaje('Nombre y siglas son obligatorios');
      return;
    }
    const payload = { nombre: nombre.trim(), siglas: siglas.trim().toUpperCase() };
    const { status, body } = editando
      ? await api(`/companies/${editando.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/companies', { method: 'POST', body: JSON.stringify(payload) });
    if (status === 200 || status === 201) {
      limpiar();
      cargar();
    } else {
      setMensaje((body as any)?.message ?? `Error ${status}`);
    }
  };

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Empresas"
      descripcion="Empresas que comparten la bodega. Las existencias nunca se mezclan entre ellas." />

      <div className="mb-4 rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">{editando ? `Editar ${editando.nombre}` : 'Nueva empresa'}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
              placeholder="Importadora Ejemplo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Siglas (2–5 letras)</label>
            <input
              value={siglas}
              onChange={(e) => setSiglas(e.target.value.toUpperCase())}
              className="w-24 rounded border px-2 py-1 text-sm uppercase"
              placeholder="IEJ"
              maxLength={5}
            />
          </div>
          <button onClick={guardar} className="rounded bg-sofia-600 px-4 py-1.5 text-sm text-white hover:bg-sofia-700">
            {editando ? 'Guardar cambios' : 'Crear empresa'}
          </button>
          {editando && (
            <button onClick={limpiar} className="rounded bg-slate-200 px-3 py-1.5 text-sm">Cancelar</button>
          )}
        </div>
        {mensaje && <p className="mt-2 text-sm text-red-600">{mensaje}</p>}
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
              <th className="p-2">Nombre</th>
              <th className="p-2">Siglas</th>
              <th className="p-2">Creada</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id} className="border-b last:border-0">
                <td className="p-2 font-medium">{e.nombre}</td>
                <td className="p-2 font-mono">{e.siglas}</td>
                <td className="p-2 text-xs">{new Date(e.createdAt).toLocaleDateString('es-CO')}</td>
                <td className="p-2 text-right">
                  <button
                    onClick={() => { setEditando(e); setNombre(e.nombre); setSiglas(e.siglas); setMensaje(''); }}
                    className="rounded bg-slate-100 px-3 py-1 text-xs hover:bg-slate-200"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </AppShell>
  );
}
