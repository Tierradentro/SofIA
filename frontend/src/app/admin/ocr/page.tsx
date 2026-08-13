'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, obtenerSesion, Sesion, mensajeError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EncabezadoPagina } from '@/components/ui';

interface Proveedor {
  id: string;
  proveedor: 'OPENAI' | 'GEMINI' | 'OPENROUTER';
  nombre: string;
  modelo: string;
  apiKeyMasked: string;
  estado: 'ACTIVO' | 'INACTIVO';
  prioridad: number;
}

const FORM_VACIO = {
  proveedor: 'OPENAI' as Proveedor['proveedor'],
  nombre: '',
  modelo: '',
  apiKey: '',
  prioridad: 100,
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * HU-018/019/020 (M13): configuración OCR — motor activo (un solo motor),
 * proveedores LLM (un solo activo) y prueba de procesamiento.
 */
export default function AdminOcrPage() {
  const router = useRouter();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [engine, setEngine] = useState<'OCR_LOCAL' | 'OCR_LLM'>('OCR_LOCAL');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [archivoPrueba, setArchivoPrueba] = useState<File | null>(null);
  const [resultadoPrueba, setResultadoPrueba] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const s = obtenerSesion();
    if (!s) return router.replace('/login');
    if (s.usuario.rol !== 'ADMINISTRADOR') return router.replace('/dashboard');
    setSesion(s);
    cargar();
  }, [router]);

  async function cargar() {
    const [e, p] = await Promise.all([
      api<{ engine: 'OCR_LOCAL' | 'OCR_LLM' }>('/ocr/engine'),
      api<Proveedor[]>('/ocr-providers'),
    ]);
    if (e.status === 200) setEngine(e.body.engine);
    if (p.status === 200) setProveedores(p.body);
  }

  async function cambiarMotor(nuevo: 'OCR_LOCAL' | 'OCR_LLM') {
    setError('');
    setMensaje('');
    const { status, body } = await api('/ocr/engine', {
      method: 'POST',
      body: JSON.stringify({ engine: nuevo, motivo: motivo || undefined }),
    });
    if (status === 200 || status === 201) {
      setEngine(nuevo);
      setMotivo('');
      setMensaje(`Motor activo: ${nuevo} (cambio auditado)`);
    } else {
      setError(mensajeError(body, 'No se pudo cambiar el motor'));
    }
  }

  async function guardarProveedor(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const payload: Record<string, unknown> = { ...form };
    if (editando && !form.apiKey) delete payload.apiKey; // conservar la actual
    const { status, body } = editando
      ? await api(`/ocr-providers/${editando}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/ocr-providers', { method: 'POST', body: JSON.stringify(payload) });
    if (status === 200 || status === 201) {
      setMensaje(editando ? 'Proveedor actualizado' : 'Proveedor registrado');
      setMostrarForm(false);
      setEditando(null);
      setForm(FORM_VACIO);
      cargar();
    } else {
      setError(mensajeError(body, 'Error al guardar'));
    }
  }

  async function activar(id: string) {
    setError('');
    const { status, body } = await api(`/ocr-providers/${id}/activate`, { method: 'POST' });
    if (status === 200 || status === 201) {
      setMensaje('Proveedor activado (el anterior quedó inactivo)');
      cargar();
    } else {
      setError(mensajeError(body, 'Error al activar'));
    }
  }

  async function eliminar(id: string) {
    setError('');
    const { status, body } = await api(`/ocr-providers/${id}`, { method: 'DELETE' });
    if (status === 200) {
      setMensaje('Proveedor eliminado');
      cargar();
    } else {
      setError(mensajeError(body, 'Error al eliminar'));
    }
  }

  async function probar() {
    if (!archivoPrueba) return;
    setCargando(true);
    setError('');
    setResultadoPrueba('');
    const fd = new FormData();
    fd.append('tipoDocumento', 'FACTURA_IMPORTACION');
    fd.append('file', archivoPrueba);
    const s = obtenerSesion();
    const res = await fetch(`${API_BASE}/ocr/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s?.token}` },
      body: fd,
    });
    const body = await res.json();
    setCargando(false);
    if (res.status === 201) {
      setResultadoPrueba(JSON.stringify(body, null, 2));
    } else {
      setError(mensajeError(body, 'La prueba de procesamiento falló'));
    }
  }

  if (!sesion) return null;

  return (
    <AppShell sesion={sesion}>
      <EncabezadoPagina titulo="Configuración OCR" />
      <div className="mx-auto max-w-4xl">

        {mensaje && (
          <p className="mb-3 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{mensaje}</p>
        )}
        {error && (
          <p className="mb-3 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>
        )}

        {/* HU-020: motor activo */}
        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold">Motor OCR activo</h2>
          <div className="flex flex-wrap items-center gap-3">
            {(['OCR_LOCAL', 'OCR_LLM'] as const).map((m) => (
              <label
                key={m}
                className={`flex cursor-pointer items-center gap-2 rounded border px-4 py-2 text-sm ${
                  engine === m ? 'border-sofia-600 bg-sofia-50 font-semibold' : ''
                }`}
              >
                <input
                  type="radio"
                  name="engine"
                  checked={engine === m}
                  onChange={() => cambiarMotor(m)}
                />
                {m === 'OCR_LOCAL' ? 'OCR Local (contingencia)' : 'OCR LLM (proveedor externo)'}
              </label>
            ))}
            <input
              type="text"
              placeholder="Motivo del cambio (opcional)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Solo un motor queda activo y el cambio se audita. OCR_LLM exige un
            proveedor activo; OCR local es la contingencia sin conectividad.
          </p>
        </section>

        {/* HU-019: proveedores */}
        <section className="mb-4 rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Proveedores LLM</h2>
            <button
              onClick={() => {
                setForm(FORM_VACIO);
                setEditando(null);
                setMostrarForm(!mostrarForm);
              }}
              className="rounded bg-sofia-600 px-3 py-1.5 text-sm text-white hover:bg-sofia-700"
            >
              {mostrarForm ? 'Cancelar' : '+ Nuevo proveedor'}
            </button>
          </div>

          {mostrarForm && (
            <form onSubmit={guardarProveedor} className="mb-4 grid grid-cols-1 gap-3 rounded bg-slate-50 p-4 sm:grid-cols-2">
              <label className="text-sm">
                Proveedor
                <select
                  value={form.proveedor}
                  onChange={(e) => setForm({ ...form, proveedor: e.target.value as Proveedor['proveedor'] })}
                  className="mt-1 block w-full rounded border px-2 py-1.5"
                >
                  <option value="OPENAI">OpenAI</option>
                  <option value="GEMINI">Gemini</option>
                  <option value="OPENROUTER">OpenRouter</option>
                </select>
              </label>
              <label className="text-sm">
                Nombre
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  required
                  className="mt-1 block w-full rounded border px-2 py-1.5"
                />
              </label>
              <label className="text-sm">
                Modelo
                <input
                  type="text"
                  value={form.modelo}
                  onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                  required
                  placeholder="gpt-4o-mini / gemini-2.0-flash / …"
                  className="mt-1 block w-full rounded border px-2 py-1.5"
                />
              </label>
              <label className="text-sm">
                API Key {editando && '(vacío = conservar)'}
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  required={!editando}
                  className="mt-1 block w-full rounded border px-2 py-1.5"
                />
              </label>
              <label className="text-sm">
                Prioridad
                <input
                  type="number"
                  min={1}
                  value={form.prioridad}
                  onChange={(e) => setForm({ ...form, prioridad: Number(e.target.value) })}
                  className="mt-1 block w-full rounded border px-2 py-1.5"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700"
                >
                  {editando ? 'Actualizar' : 'Registrar'}
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Proveedor</th>
                <th>Nombre</th>
                <th>Modelo</th>
                <th>API Key</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-1">{p.proveedor}</td>
                  <td>{p.nombre}</td>
                  <td>{p.modelo}</td>
                  <td className="font-mono text-xs">{p.apiKeyMasked}</td>
                  <td>
                    <span className={p.estado === 'ACTIVO' ? 'font-semibold text-green-700' : 'text-slate-500'}>
                      {p.estado}
                    </span>
                  </td>
                  <td className="py-1 text-right">
                    {p.estado !== 'ACTIVO' && (
                      <>
                        <button onClick={() => activar(p.id)} className="mr-2 text-sofia-700 hover:underline">
                          Activar
                        </button>
                        <button
                          onClick={() => {
                            setForm({ proveedor: p.proveedor, nombre: p.nombre, modelo: p.modelo, apiKey: '', prioridad: p.prioridad });
                            setEditando(p.id);
                            setMostrarForm(true);
                          }}
                          className="mr-2 text-slate-700 hover:underline"
                        >
                          Editar
                        </button>
                        <button onClick={() => eliminar(p.id)} className="text-red-700 hover:underline">
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {proveedores.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-2 text-slate-500">
                    Sin proveedores registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>

        {/* HU-018: prueba de procesamiento */}
        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-3 font-semibold">Probar procesamiento</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Documento de prueba (PDF o imagen)
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp"
                onChange={(e) => e.target.files?.[0] && setArchivoPrueba(e.target.files[0])}
                className="mt-1 block text-sm"
              />
            </label>
            <button
              onClick={probar}
              disabled={!archivoPrueba || cargando}
              className="rounded bg-sofia-600 px-4 py-2 text-white hover:bg-sofia-700 disabled:opacity-50"
            >
              {cargando ? 'Procesando…' : 'Probar motor activo'}
            </button>
          </div>
          {resultadoPrueba && (
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs text-green-300">
              {resultadoPrueba}
            </pre>
          )}
        </section>
      </div>
        </AppShell>
  );
}
