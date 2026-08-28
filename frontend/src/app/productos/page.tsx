'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Filter, Plus, Search } from 'lucide-react';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_INPUT,
  CLASES_TABLA,
  EncabezadoPagina,
  Insignia,
  Tarjeta,
} from '@/components/ui';
import { ConsultaProducto } from './consulta';
import { PanelUbicaciones } from '@/components/panel-ubicaciones';

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
  // I25: filtros de la tabla (marca, ubicación y existencia)
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [filtroMarca, setFiltroMarca] = useState('');
  const [filtroUbicacion, setFiltroUbicacion] = useState('');
  const [filtroExistencia, setFiltroExistencia] = useState<'todas' | 'con' | 'sin'>('todas');
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

  // I25: se aplican sobre la lista ya cargada (empresa + búsqueda parcial)
  const filtrosActivos =
    filtroMarca.trim() !== '' || filtroUbicacion.trim() !== '' || filtroExistencia !== 'todas';
  const productosFiltrados = productos.filter((p) => {
    if (filtroMarca.trim() && !(p.marca ?? '').toLowerCase().includes(filtroMarca.trim().toLowerCase())) return false;
    if (filtroUbicacion.trim() && !(p.ubicacion ?? '').toLowerCase().includes(filtroUbicacion.trim().toLowerCase())) return false;
    if (filtroExistencia === 'con' && !(Number(p.cantidad) > 0)) return false;
    if (filtroExistencia === 'sin' && Number(p.cantidad) > 0) return false;
    return true;
  });

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina
        titulo="Productos"
        acciones={
          esGenerador ? (
            <button
              onClick={() => { setMostrarForm(!mostrarForm); setEditando(null); setFicha(null); }}
              className={`${CLASE_BOTON_PRIMARIO} flex items-center gap-2`}
            >
              <Plus size={16} />
              {mostrarForm ? 'Cerrar' : 'Nuevo producto'}
            </button>
          ) : undefined
        }
      />

      {/* Selector de empresa como tarjetas */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Empresas registradas
      </h2>
      <div className="mb-6 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {empresas.map((e) => {
          const activa = e.id === empresaId;
          return (
            <button
              key={e.id}
              onClick={() => setEmpresaId(e.id)}
              className={`flex items-center gap-4 rounded-xl border-2 p-4 text-left shadow-sm transition-colors ${
                activa
                  ? 'border-sofia-700 bg-white'
                  : 'border-transparent bg-white hover:border-sofia-200'
              }`}
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                  activa ? 'bg-sofia-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {e.siglas}
              </span>
              <span>
                <span className="block font-semibold text-slate-900">{e.siglas}</span>
                <span
                  className={`flex items-center gap-1 text-xs ${
                    activa ? 'text-sofia-700' : 'text-slate-400'
                  }`}
                >
                  {activa ? (
                    <>
                      <CheckCircle2 size={13} /> Seleccionada
                    </>
                  ) : (
                    'Cambiar a esta empresa'
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {mensaje && <p className="mb-4 max-w-3xl rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{mensaje}</p>}
      {error && <p className="mb-4 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Consulta exacta por código de barras (no se toca: match exacto) */}
      <Tarjeta className="mb-6 max-w-3xl p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Consulta exacta (código de barras / código / OE / referencia)
        </h2>
        <ConsultaProducto empresaId={empresaId || undefined} />
      </Tarjeta>

      {mostrarForm && esGenerador && (
        <Tarjeta className="mb-6 max-w-4xl p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Nuevo producto</h2>
          <form onSubmit={crear} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input placeholder="Código *" className={CLASE_INPUT} value={form.codigo}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
            {CAMPOS_EDICION.filter((c) => c.clave === 'descripcion').map((c) => (
              <input key={c.clave} placeholder={c.etiqueta} className={`${CLASE_INPUT} sm:col-span-2`}
                value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} required />
            ))}
            {CAMPOS_EDICION.filter((c) => c.clave !== 'descripcion').map((c) => (
              <input
                key={c.clave}
                placeholder={c.etiqueta}
                type={c.tipo ?? 'text'}
                step={c.tipo === 'number' ? '0.01' : undefined}
                min={c.tipo === 'number' ? 0 : undefined}
                className={CLASE_INPUT}
                value={form[c.clave]}
                onChange={(e) => setForm({ ...form, [c.clave]: e.target.value })}
              />
            ))}
            <button className={`${CLASE_BOTON_PRIMARIO} sm:col-span-2 lg:col-span-3`}>
              Crear producto
            </button>
          </form>
        </Tarjeta>
      )}

      {/* QA Func. 2.2: ficha técnica completa */}
      {ficha && (
        <Tarjeta className="mb-6 max-w-4xl border-l-4 border-menta-400 p-5">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-semibold text-slate-900">Ficha técnica — {ficha.codigo}</h2>
            <div className="flex gap-2">
              {puedeEditar && (
                <button onClick={() => abrirEdicion(ficha)}
                  className="rounded-lg bg-sofia-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sofia-600">
                  Editar
                </button>
              )}
              {/* I33: ubicar el producto en el mapa 2D de la bodega */}
              <a
                href={`/mapa?q=${encodeURIComponent(ficha.codigo)}`}
                className="rounded-lg bg-menta-50 px-3 py-1.5 text-sm font-medium text-menta-700 hover:bg-menta-100"
              >
                Ver en mapa
              </a>
              <button onClick={() => setFicha(null)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">
                Cerrar
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
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
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</dt>
                <dd className="mt-0.5 font-medium text-slate-800">
                  {etiqueta === 'Estado' ? (
                    <Insignia tono={valor === 'ACTIVO' ? 'menta' : 'gris'}>{String(valor)}</Insignia>
                  ) : valor === null || valor === undefined || valor === '' ? (
                    '—'
                  ) : (
                    String(valor)
                  )}
                </dd>
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

          {/* I34: ubicaciones del producto en la bodega (asignación manual) */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <PanelUbicaciones productoId={ficha.id} codigo={ficha.codigo} soloLectura={!puedeEditar} />
          </div>
        </Tarjeta>
      )}

      {/* QA Func. 2.2: formulario de edición */}
      {editando && (
        <Tarjeta className="mb-6 max-w-4xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Editar producto — {editando.codigo}</h2>
            <button type="button" onClick={() => setEditando(null)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">
              Cancelar
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            El código y la empresa no se editan aquí; las cantidades solo cambian por movimientos.
          </p>
          <form onSubmit={guardarEdicion} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPOS_EDICION.map((c) => (
              <input
                key={c.clave}
                placeholder={c.etiqueta}
                type={c.tipo ?? 'text'}
                step={c.tipo === 'number' ? '0.01' : undefined}
                min={c.tipo === 'number' ? 0 : undefined}
                className={CLASE_INPUT}
                value={formEdicion[c.clave]}
                onChange={(e) => setFormEdicion({ ...formEdicion, [c.clave]: e.target.value })}
                required={c.clave === 'descripcion'}
              />
            ))}
            <button className={`${CLASE_BOTON_PRIMARIO} sm:col-span-2 lg:col-span-3`}>
              Guardar cambios
            </button>
          </form>
        </Tarjeta>
      )}

      {barcodeProducto && (
        <form onSubmit={asociarBarcode} className="mb-6 flex max-w-3xl flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:flex-row sm:items-end">
          <div className="flex-1">
            <p className="mb-1 text-sm font-medium">
              Asociar código de barras a <strong>{barcodeProducto.codigo}</strong>
            </p>
            <input
              placeholder="Escanee o digite el código"
              className={CLASE_INPUT}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex gap-2">
            <button className={CLASE_BOTON_PRIMARIO}>Asociar</button>
            <button type="button" onClick={() => setBarcodeProducto(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* QA Func. 2.3: corrección de código mal asociado */}
      {correccion && (
        <form onSubmit={corregirBarcode} className="mb-6 flex max-w-3xl flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:flex-row sm:items-end">
          <div className="flex-1">
            <p className="mb-1 text-sm font-medium">
              Corregir código de <strong>{correccion.codigo}</strong> (actual: {correccion.codigoBarras?.barcode})
            </p>
            <input
              placeholder="Escanee o digite el código correcto"
              className={CLASE_INPUT}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex gap-2">
            <button className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">Reemplazar</button>
            <button type="button" onClick={() => { setCorreccion(null); setBarcode(''); }} className="rounded-lg bg-white px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* QA Func. 2.4: búsqueda parcial */}
      <Tarjeta className="mb-4 p-4">
        <form onSubmit={buscar} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Buscar por código, OE, referencia cruzada o descripción (coincidencia parcial)"
              className={`${CLASE_INPUT} pl-9`}
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button className={CLASE_BOTON_PRIMARIO}>Buscar</button>
            <button
              type="button"
              onClick={() => setMostrarFiltros((v) => !v)}
              className={`flex items-center gap-1 rounded-lg px-4 text-sm ${
                mostrarFiltros || filtrosActivos
                  ? 'bg-sofia-100 font-medium text-sofia-700 hover:bg-sofia-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="Filtrar la tabla por marca, ubicación o existencia"
            >
              <Filter size={14} /> Filtrar
            </button>
            {(consulta || filtrosActivos) && (
              <button
                type="button"
                onClick={() => {
                  setConsulta('');
                  setFiltroMarca('');
                  setFiltroUbicacion('');
                  setFiltroExistencia('todas');
                  cargar();
                }}
                className="rounded-lg bg-slate-100 px-4 text-sm text-slate-600 hover:bg-slate-200"
                title="Limpiar búsqueda y filtros"
              >
                Limpiar
              </button>
            )}
          </div>
        </form>
        {mostrarFiltros && (
          <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs font-medium text-slate-500">
              Marca
              <input
                className={`${CLASE_INPUT} mt-1`}
                placeholder="Ej.: SKF"
                value={filtroMarca}
                onChange={(e) => setFiltroMarca(e.target.value)}
              />
            </label>
            <label className="flex-1 text-xs font-medium text-slate-500">
              Ubicación
              <input
                className={`${CLASE_INPUT} mt-1`}
                placeholder="Ej.: A-01-03"
                value={filtroUbicacion}
                onChange={(e) => setFiltroUbicacion(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-slate-500">
              Existencia
              <select
                className={`${CLASE_INPUT} mt-1`}
                value={filtroExistencia}
                onChange={(e) => setFiltroExistencia(e.target.value as 'todas' | 'con' | 'sin')}
              >
                <option value="todas">Todas</option>
                <option value="con">Con existencias</option>
                <option value="sin">Sin existencias</option>
              </select>
            </label>
          </div>
        )}
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className={CLASES_TABLA.tabla}>
            <thead>
              <tr className={CLASES_TABLA.cabecera}>
                <th className={CLASES_TABLA.celdaCabecera}>Código</th>
                <th className={CLASES_TABLA.celdaCabecera}>Descripción</th>
                <th className={CLASES_TABLA.celdaCabecera}>Marca</th>
                <th className={CLASES_TABLA.celdaCabecera}>Código barras</th>
                <th className={CLASES_TABLA.celdaCabecera}>Ubicación</th>
                <th className={`${CLASES_TABLA.celdaCabecera} text-right`}>Existencia</th>
                <th className={`${CLASES_TABLA.celdaCabecera} text-right`}>Bloqueada</th>
                <th className={CLASES_TABLA.celdaCabecera}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productosFiltrados.map((p) => (
                <tr key={p.id} className={CLASES_TABLA.fila}>
                  <td className={`${CLASES_TABLA.celda} font-medium`}>
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
                  <td className={`${CLASES_TABLA.celda} max-w-xs truncate`} title={p.descripcion}>{p.descripcion}</td>
                  <td className={CLASES_TABLA.celda}>{p.marca || '—'}</td>
                  <td className={`${CLASES_TABLA.celda} font-mono text-xs`}>
                    {p.codigoBarras ? (
                      <>
                        {p.codigoBarras.barcode}
                        <span className="block text-[10px] uppercase text-slate-400">({p.codigoBarras.origen})</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className={CLASES_TABLA.celda}>{p.ubicacion || '—'}</td>
                  <td className={`${CLASES_TABLA.celda} text-right`}>{p.cantidad}</td>
                  <td className={`${CLASES_TABLA.celda} text-right`}>{p.cantidadBloqueada}</td>
                  <td className={CLASES_TABLA.celda}>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => verFicha(p)}
                        className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                      >
                        Ficha
                      </button>
                      {!p.codigoBarras && puedeBarcode && (
                        <button
                          onClick={() => { setBarcodeProducto(p); setError(''); setMensaje(''); }}
                          className="rounded-md bg-sofia-100 px-2.5 py-1 text-xs font-medium text-sofia-700 hover:bg-sofia-200"
                        >
                          Asociar código
                        </button>
                      )}
                      {p.codigoBarras && puedeEditar && (
                        <button
                          onClick={() => { setCorreccion(p); setBarcode(''); setError(''); setMensaje(''); }}
                          className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200"
                        >
                          Corregir código
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {productosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                    {productos.length === 0
                      ? 'Sin productos en esta empresa'
                      : 'Ningún producto coincide con los filtros'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {productosFiltrados.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
            Mostrando {productosFiltrados.length} de {productos.length} resultado{productos.length === 1 ? '' : 's'}
          </p>
        )}
      </Tarjeta>
    </AppShell>
  );
}
