'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { ConsultaProducto } from './consulta';

interface Empresa {
  id: string;
  nombre: string;
  siglas: string;
}

/** Todos los campos del catálogo (QA Func. 2.2). */
interface Producto {
  id: string;
  empresaId: string;
  codigo: string;
  descripcion: string;
  proveedor?: string;
  marca?: string;
  vehiculo?: string;
  categoria?: string;
  subcategoria?: string;
  observaciones?: string;
  aplicacion?: string;
  codigoOE?: string;
  refCruzada1?: string;
  refCruzada2?: string;
  unidadMedida?: string;
  precio: number;
  linkImagen?: string;
  ubicacion?: string;
  grupoSiete?: string;
  grupoOcho?: string;
  estado: string;
  cantidad: number;
  cantidadBloqueada: number;
  codigoBarras?: { barcode: string; origen: string } | null;
  empresa?: { id: string; nombre: string; siglas: string };
}

const FORM_VACIO = {
  codigo: '', descripcion: '', proveedor: '', marca: '', vehiculo: '',
  categoria: '', subcategoria: '', observaciones: '', aplicacion: '',
  codigoOE: '', refCruzada1: '', refCruzada2: '', unidadMedida: 'UND',
  precio: '0', linkImagen: '', ubicacion: '', grupoSiete: '', grupoOcho: '',
};
type FormProducto = typeof FORM_VACIO;

const CAMPOS_EDICION: { clave: keyof FormProducto; etiqueta: string; tipo?: string }[] = [
  { clave: 'descripcion', etiqueta: 'Descripción *' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'marca', etiqueta: 'Marca' },
  { clave: 'vehiculo', etiqueta: 'Vehículo' },
  { clave: 'categoria', etiqueta: 'Categoría' },
  { clave: 'subcategoria', etiqueta: 'Subcategoría' },
  { clave: 'aplicacion', etiqueta: 'Aplicación' },
  { clave: 'codigoOE', etiqueta: 'Código OE' },
  { clave: 'refCruzada1', etiqueta: 'Referencia cruzada 1' },
  { clave: 'refCruzada2', etiqueta: 'Referencia cruzada 2' },
  { clave: 'unidadMedida', etiqueta: 'Unidad de medida' },
  { clave: 'precio', etiqueta: 'Precio', tipo: 'number' },
  { clave: 'linkImagen', etiqueta: 'Link de imagen' },
  { clave: 'ubicacion', etiqueta: 'Ubicación' },
  { clave: 'grupoSiete', etiqueta: 'Grupo siete' },
  { clave: 'grupoOcho', etiqueta: 'Grupo ocho' },
];

/** Indicador de datos incompletos (decisión previa: completar desde Generador). */
function faltanDatos(p: { codigoOE?: string; marca?: string; ubicacion?: string }): boolean {
  return !p.codigoOE?.trim() || !p.marca?.trim() || !p.ubicacion?.trim();
}

export default function ProductosPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [consulta, setConsulta] = useState(''); // QA Func. 2.4: búsqueda parcial
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState<FormProducto>(FORM_VACIO);
  const [ficha, setFicha] = useState<Producto | null>(null); // QA Func. 2.2
  const [editando, setEditando] = useState<Producto | null>(null);
  const [formEdicion, setFormEdicion] = useState<FormProducto>(FORM_VACIO);
  const [barcodeProducto, setBarcodeProducto] = useState<Producto | null>(null);
  const [correccion, setCorreccion] = useState<Producto | null>(null); // QA Func. 2.3
  const [barcode, setBarcode] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const esGenerador = sesion?.usuario.rol === 'GENERADOR';
  const esAdmin = sesion?.usuario.rol === 'ADMINISTRADOR';
  const puedeEditar = esGenerador || esAdmin;
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

  /** QA Func. 2.4: búsqueda parcial por código/OE/referencia/descripción. */
  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    const q = consulta.trim();
    if (!q) return cargar();
    const { status, body } = await api<Producto[]>(
      `/products/search?q=${encodeURIComponent(q)}&empresaId=${empresaId}`,
    );
    if (status === 200) {
      setProductos(body);
      if (body.length === 0) setMensaje('Sin resultados para la búsqueda');
    } else {
      setError(mensajeError(body, 'No se pudo buscar'));
    }
  }

  async function verFicha(p: Producto) {
    setError('');
    const { status, body } = await api<Producto>(`/products/${p.id}`);
    if (status === 200) {
      setFicha(body);
    } else {
      setError(mensajeError(body, 'No se pudo cargar la ficha'));
    }
  }

  function abrirEdicion(p: Producto) {
    setFormEdicion({
      codigo: p.codigo,
      descripcion: p.descripcion ?? '',
      proveedor: p.proveedor ?? '',
      marca: p.marca ?? '',
      vehiculo: p.vehiculo ?? '',
      categoria: p.categoria ?? '',
      subcategoria: p.subcategoria ?? '',
      observaciones: p.observaciones ?? '',
      aplicacion: p.aplicacion ?? '',
      codigoOE: p.codigoOE ?? '',
      refCruzada1: p.refCruzada1 ?? '',
      refCruzada2: p.refCruzada2 ?? '',
      unidadMedida: p.unidadMedida ?? 'UND',
      precio: String(p.precio ?? 0),
      linkImagen: p.linkImagen ?? '',
      ubicacion: p.ubicacion ?? '',
      grupoSiete: p.grupoSiete ?? '',
      grupoOcho: p.grupoOcho ?? '',
    });
    setEditando(p);
    setFicha(null);
    setError('');
    setMensaje('');
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setError('');
    setMensaje('');
    const payload: Record<string, unknown> = {};
    for (const { clave, tipo } of CAMPOS_EDICION) {
      const v = formEdicion[clave];
      payload[clave] = tipo === 'number' ? Number(v) || 0 : v;
    }
    const { status, body } = await api(`/products/${editando.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (status === 200) {
      setMensaje(`Producto ${editando.codigo} actualizado`);
      setEditando(null);
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo actualizar el producto'));
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const payload: Record<string, unknown> = { empresaId };
    for (const { clave, tipo } of CAMPOS_EDICION) {
      const v = form[clave];
      if (v === '') continue;
      payload[clave] = tipo === 'number' ? Number(v) || 0 : v;
    }
    payload.codigo = form.codigo;
    payload.descripcion = form.descripcion;
    const { status, body } = await api('/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (status === 201) {
      setMensaje(`Producto ${body.codigo} creado`);
      setForm(FORM_VACIO);
      setMostrarForm(false);
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo crear el producto'));
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
      setError(mensajeError(body, 'No se pudo asociar el código'));
    }
  }

  /** QA Func. 2.3: corregir un código mal asociado (reemplazo). */
  async function corregirBarcode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMensaje('');
    const { status, body } = await api(`/products/${correccion!.id}/barcode`, {
      method: 'PUT',
      body: JSON.stringify({ barcode, origen: 'MANUAL' }),
    });
    if (status === 200) {
      setMensaje(`Código de ${correccion!.codigo} corregido a ${barcode}`);
      setCorreccion(null);
      setBarcode('');
      cargar();
    } else {
      setError(mensajeError(body, 'No se pudo corregir el código'));
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
              onClick={() => { setMostrarForm(!mostrarForm); setEditando(null); setFicha(null); }}
              className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700"
            >
              {mostrarForm ? 'Cerrar' : 'Nuevo producto'}
            </button>
          )}
        </div>
      </div>

      {mensaje && <p className="mb-4 max-w-3xl rounded bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      {error && <p className="mb-4 max-w-3xl rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* QA Func. 2.4: búsqueda parcial */}
      <form onSubmit={buscar} className="mb-4 flex max-w-3xl gap-2">
        <input
          placeholder="Buscar por código, OE, referencia cruzada o descripción (coincidencia parcial)"
          className="flex-1 rounded border px-3 py-2"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
        />
        <button className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700">Buscar</button>
        {consulta && (
          <button
            type="button"
            onClick={() => { setConsulta(''); cargar(); }}
            className="rounded bg-slate-100 px-3 py-2"
          >
            Limpiar
          </button>
        )}
      </form>

      {/* Consulta exacta por código de barras (no se toca: match exacto) */}
      <div className="mb-6 max-w-3xl rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Consulta exacta (código de barras / código / OE / referencia)
        </h2>
        <ConsultaProducto empresaId={empresaId || undefined} />
      </div>

      {mostrarForm && esGenerador && (
        <form onSubmit={crear} className="mb-6 grid max-w-4xl grid-cols-3 gap-3 rounded-lg bg-white p-5 shadow">
          <input placeholder="Código *" className="rounded border px-3 py-2" value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
          {CAMPOS_EDICION.filter((c) => c.clave === 'descripcion').map((c) => (
            <input key={c.clave} placeholder={c.etiqueta} className="col-span-2 rounded border px-3 py-2"
              value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} required />
          ))}
          {CAMPOS_EDICION.filter((c) => c.clave !== 'descripcion').map((c) => (
            <input
              key={c.clave}
              placeholder={c.etiqueta}
              type={c.tipo ?? 'text'}
              step={c.tipo === 'number' ? '0.01' : undefined}
              min={c.tipo === 'number' ? 0 : undefined}
              className="rounded border px-3 py-2"
              value={form[c.clave]}
              onChange={(e) => setForm({ ...form, [c.clave]: e.target.value })}
            />
          ))}
          <button className="col-span-3 rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
            Crear producto
          </button>
        </form>
      )}

      {/* QA Func. 2.2: ficha técnica completa */}
      {ficha && (
        <section className="mb-6 max-w-4xl rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Ficha técnica — {ficha.codigo}</h2>
            <div className="flex gap-2">
              {puedeEditar && (
                <button onClick={() => abrirEdicion(ficha)}
                  className="rounded bg-sofia-600 px-3 py-1 text-sm text-white hover:bg-sofia-700">
                  Editar
                </button>
              )}
              <button onClick={() => setFicha(null)} className="rounded bg-slate-100 px-3 py-1 text-sm">
                Cerrar
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {(
              [
                ['Empresa', ficha.empresa ? `${ficha.empresa.siglas} — ${ficha.empresa.nombre}` : ficha.empresaId],
                ['Descripción', ficha.descripcion],
                ['Proveedor', ficha.proveedor],
                ['Marca', ficha.marca],
                ['Vehículo', ficha.vehiculo],
                ['Categoría', ficha.categoria],
                ['Subcategoría', ficha.subcategoria],
                ['Aplicación', ficha.aplicacion],
                ['Código OE', ficha.codigoOE],
                ['Ref. cruzada 1', ficha.refCruzada1],
                ['Ref. cruzada 2', ficha.refCruzada2],
                ['Unidad de medida', ficha.unidadMedida],
                ['Precio', ficha.precio],
                ['Ubicación', ficha.ubicacion],
                ['Grupo siete', ficha.grupoSiete],
                ['Grupo ocho', ficha.grupoOcho],
                ['Estado', ficha.estado],
                ['Existencia', ficha.cantidad],
                ['Bloqueada', ficha.cantidadBloqueada],
                ['Código de barras', ficha.codigoBarras ? `${ficha.codigoBarras.barcode} (${ficha.codigoBarras.origen})` : '—'],
              ] as [string, unknown][]
            ).map(([etiqueta, valor]) => (
              <div key={etiqueta}>
                <dt className="text-xs uppercase text-slate-400">{etiqueta}</dt>
                <dd className="font-medium">{valor === null || valor === undefined || valor === '' ? '—' : String(valor)}</dd>
              </div>
            ))}
            {ficha.observaciones && (
              <div className="col-span-3">
                <dt className="text-xs uppercase text-slate-400">Observaciones</dt>
                <dd className="font-medium">{ficha.observaciones}</dd>
              </div>
            )}
            {ficha.linkImagen && (
              <div className="col-span-3">
                <dt className="text-xs uppercase text-slate-400">Link de imagen</dt>
                <dd>
                  <a href={ficha.linkImagen} target="_blank" rel="noreferrer" className="text-sofia-700 hover:underline">
                    {ficha.linkImagen}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* QA Func. 2.2: formulario de edición */}
      {editando && (
        <form onSubmit={guardarEdicion} className="mb-6 grid max-w-4xl grid-cols-3 gap-3 rounded-lg bg-white p-5 shadow">
          <div className="col-span-3 flex items-center justify-between">
            <h2 className="font-semibold">Editar producto — {editando.codigo}</h2>
            <button type="button" onClick={() => setEditando(null)} className="rounded bg-slate-100 px-3 py-1 text-sm">
              Cancelar
            </button>
          </div>
          <p className="col-span-3 text-xs text-slate-500">
            El código y la empresa no se editan aquí; las cantidades solo cambian por movimientos.
          </p>
          {CAMPOS_EDICION.map((c) => (
            <input
              key={c.clave}
              placeholder={c.etiqueta}
              type={c.tipo ?? 'text'}
              step={c.tipo === 'number' ? '0.01' : undefined}
              min={c.tipo === 'number' ? 0 : undefined}
              className="rounded border px-3 py-2"
              value={formEdicion[c.clave]}
              onChange={(e) => setFormEdicion({ ...formEdicion, [c.clave]: e.target.value })}
              required={c.clave === 'descripcion'}
            />
          ))}
          <button className="col-span-3 rounded bg-sofia-600 py-2 font-medium text-white hover:bg-sofia-700">
            Guardar cambios
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

      {/* QA Func. 2.3: corrección de código mal asociado */}
      {correccion && (
        <form onSubmit={corregirBarcode} className="mb-6 flex max-w-3xl items-end gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow">
          <div className="flex-1">
            <p className="mb-1 text-sm font-medium">
              Corregir código de <strong>{correccion.codigo}</strong> (actual: {correccion.codigoBarras?.barcode})
            </p>
            <input
              placeholder="Escanee o digite el código correcto"
              className="w-full rounded border px-3 py-2"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button className="rounded bg-amber-600 px-4 py-2 text-white">Reemplazar</button>
          <button type="button" onClick={() => { setCorreccion(null); setBarcode(''); }} className="rounded bg-slate-100 px-4 py-2">
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
            <th className="p-3">Acciones</th>
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
              <td className="p-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => verFicha(p)}
                    className="rounded bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200"
                  >
                    Ficha
                  </button>
                  {!p.codigoBarras && puedeBarcode && (
                    <button
                      onClick={() => { setBarcodeProducto(p); setError(''); setMensaje(''); }}
                      className="rounded bg-sofia-100 px-2 py-1 text-sofia-700"
                    >
                      Asociar código
                    </button>
                  )}
                  {p.codigoBarras && puedeEditar && (
                    <button
                      onClick={() => { setCorreccion(p); setBarcode(''); setError(''); setMensaje(''); }}
                      className="rounded bg-amber-100 px-2 py-1 text-amber-700"
                    >
                      Corregir código
                    </button>
                  )}
                </div>
              </td>
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
