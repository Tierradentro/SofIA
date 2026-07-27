'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion } from '@/lib/api';
import { ConsultaProducto } from './consulta';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
}

interface Producto {
  id: string;
  empresaId: string;
  codigo: string;
  descripcion: string;
  marca?: string;
  unidadMedida?: string;
  precio: number;
  cantidad: number;
  cantidadBloqueada: number;
  ubicacion?: string;
  codigoOe?: string;
  codigoBarras?: { barcode: string; origen: string } | null;
  empresa?: { nombre: string };
}

/**
 * HU-009/011/012/013: catálogo de productos por empresa.
 * I14 (decisión #5): el producto creado en un ingreso nace ACTIVO y el
 * Generador completa después sus datos; este indicador marca los incompletos.
 */
function faltanDatos(p: { codigoOe?: string; marca?: string; ubicacion?: string }): boolean {
  return !p.codigoOe?.trim() || !p.marca?.trim() || !p.ubicacion?.trim();
}

/**
 * Crear/editar: solo Generador (el backend enforcea 403 al resto).
 */
export default function ProductosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({ codigo: '', descripcion: '', marca: '', unidadMedida: 'UND', precio: '0', ubicacion: '' });
  const [barcodeProducto, setBarcodeProducto] = useState<Producto | null>(null);
  const [barcode, setBarcode] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const esGenerador = sesion?.usuario.rol === 'GENERADOR';
  const puedeBarcode = ['OPERADOR', 'GENERADOR'].includes(sesion?.usuario.rol || '');

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    setSesion(s);
    api<Empresa[]>('/companies').then(({ status, body }) => {
      if (status === 200) {
        setEmpresas(body);
        if (body.length > 0) setEmpresaId(body[0].id);
      }
    });
  }, [router]);

  useEffect(() => {
    if (empresaId) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  async function cargar() {
    const { status, body } = await api<Producto[]>(`/products?empresaId=${empresaId}`);
    if (status === 200) setProductos(body);
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = await api('/products', {
      method: 'POST',
      body: JSON.stringify({ ...form, empresaId, precio: Number(form.precio) }),
    });
    if (status === 201) {
      setMensaje(`Producto ${body.codigo} creado`);
      setForm({ codigo: '', descripcion: '', marca: '', unidadMedida: 'UND', precio: '0', ubicacion: '' });
      setMostrarForm(false);
      cargar();
    } else {
      setError(body.message || 'No se pudo crear el producto');
    }
  }

  async function asociarBarcode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = await api(`/products/${barcodeProducto!.id}/barcode`, {
      method: 'POST',
      body: JSON.stringify({ barcode, origen: 'MANUAL' }),
    });
    if (status === 201) {
      setMensaje(`Código ${barcode} asociado a ${barcodeProducto!.codigo}`);
      setBarcodeProducto(null);
      setBarcode('');
      cargar();
    } else if (status === 409 && body.productoDueno) {
      setError(
        `El código ya pertenece al producto ${body.productoDueno.codigo} — ${body.productoDueno.descripcion} (${body.productoDueno.empresa})`,
      );
    } else {
      setError(body.message || 'No se pudo asociar el código');
    }
  }

  if (!sesion) return null;

  return (
    <main className="min-h-screen p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-sofia-600">
        ← Volver al dashboard
      </button>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Productos</h1>
        <div className="flex items-center gap-3">
          <select
            className="rounded border px-3 py-2"
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          {esGenerador && (
            <button
              onClick={() => setMostrarForm(!mostrarForm)}
              className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700"
            >
              {mostrarForm ? 'Cerrar' : 'Nuevo producto'}
            </button>
          )}
        </div>
      </div>

      {mensaje && <p className="mb-4 max-w-3xl rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      {error && <p className="mb-4 max-w-3xl rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* HU-013: consulta por código de barras, código, OE o referencia cruzada */}
      <div className="mb-6 max-w-3xl rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Consulta de producto (HU-013)
        </h2>
        <ConsultaProducto empresaId={empresaId || undefined} />
      </div>

      {mostrarForm && esGenerador && (
        <form onSubmit={crear} className="mb-6 grid max-w-3xl grid-cols-3 gap-3 rounded-lg bg-white p-5 shadow">
          <input placeholder="Código *" className="rounded border px-3 py-2" value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
          <input placeholder="Descripción *" className="col-span-2 rounded border px-3 py-2" value={form.descripcion}
            onChange={(e) => setForm({ ...form, descripcion: e.target.value })} required />
          <input placeholder="Marca" className="rounded border px-3 py-2" value={form.marca}
            onChange={(e) => setForm({ ...form, marca: e.target.value })} />
          <input placeholder="Unidad de medida" className="rounded border px-3 py-2" value={form.unidadMedida}
            onChange={(e) => setForm({ ...form, unidadMedida: e.target.value })} />
          <input placeholder="Precio" type="number" step="0.01" min="0" className="rounded border px-3 py-2" value={form.precio}
            onChange={(e) => setForm({ ...form, precio: e.target.value })} />
          <input placeholder="Ubicación (ej. A-01-2)" className="rounded border px-3 py-2" value={form.ubicacion}
            onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} />
          <button className="col-span-3 rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
            Crear producto
          </button>
        </form>
      )}

      {barcodeProducto && (
        <form onSubmit={asociarBarcode} className="mb-6 flex max-w-3xl items-end gap-3 rounded-lg bg-white p-4 shadow">
          <div className="flex-1">
            <p className="mb-1 text-sm font-medium">
              Asociar código de barras a <strong>{barcodeProducto.codigo}</strong>
            </p>
            <input
              placeholder="Escanee o digite el código"
              className="w-full rounded border px-3 py-2"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button className="rounded bg-sofia-600 px-4 py-2 text-white">Asociar</button>
          <button type="button" onClick={() => setBarcodeProducto(null)} className="rounded bg-slate-100 px-4 py-2">
            Cancelar
          </button>
        </form>
      )}

      <table className="w-full rounded-lg bg-white text-sm shadow">
        <thead>
          <tr className="border-b text-left">
            <th className="p-3">Código</th>
            <th className="p-3">Descripción</th>
            <th className="p-3">Marca</th>
            <th className="p-3">Código barras</th>
            <th className="p-3">Ubicación</th>
            <th className="p-3 text-right">Existencia</th>
            <th className="p-3 text-right">Bloqueada</th>
            {puedeBarcode && <th className="p-3">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="p-3 font-medium">
                {p.codigo}
                {faltanDatos(p) && (
                  <span
                    title="Datos incompletos: el Generador puede completar código OE, marca o ubicación"
                    className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                  >
                    Incompleto
                  </span>
                )}
              </td>
              <td className="p-3">{p.descripcion}</td>
              <td className="p-3">{p.marca}</td>
              <td className="p-3 font-mono text-xs">
                {p.codigoBarras ? `${p.codigoBarras.barcode} (${p.codigoBarras.origen})` : '—'}
              </td>
              <td className="p-3">{p.ubicacion || '—'}</td>
              <td className="p-3 text-right">{p.cantidad}</td>
              <td className="p-3 text-right">{p.cantidadBloqueada}</td>
              {puedeBarcode && (
                <td className="p-3">
                  {!p.codigoBarras && (
                    <button
                      onClick={() => { setBarcodeProducto(p); setError(''); setMensaje(''); }}
                      className="rounded bg-sofia-100 px-2 py-1 text-sofia-700"
                    >
                      Asociar código
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {productos.length === 0 && (
            <tr>
              <td colSpan={8} className="p-6 text-center text-slate-400">
                Sin productos en esta empresa
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
