/**
 * Verificación I20:
 *  Punto 1 — importación de clientes reconoce "casi-duplicados" de dirección
 *    (abreviaturas, puntuación, tipeo) y los descarta en vez de crear
 *    direcciones redundantes; el preview aplica el tope de 10.
 *  Punto 2 — lockfiles sin el mirror corporativo y .npmrc fijando el
 *    registry oficial a nivel repo (verificado por separado en shell).
 */
const XLSX = require('xlsx');
const { readFileSync } = require('fs');

const API = 'http://127.0.0.1:3001/api/v1';
let fallos = 0;
function ok(nombre, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${nombre}${extra ? ` (${extra})` : ''}`);
  if (!cond) fallos++;
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${API}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await r.json(); } catch { /* vacío */ }
  return { status: r.status, body: json };
}

async function login(username, password) {
  return req('POST', '/auth/login', { body: { username, password } });
}

function xlsxBuffer(filas) {
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function importar(token, nombre, filas) {
  const form = new FormData();
  form.append('file', new Blob([xlsxBuffer(filas)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), nombre);
  form.append('tipo', 'CLIENTES');
  form.append('mapeo', JSON.stringify({
    'Nombre': 'nombre', 'Identificación': 'identificacion',
    'Dirección': 'direccion', 'Ciudad': 'ciudad',
  }));
  return req('POST', '/imports', { token, form });
}

(async () => {
  let admin = null;
  for (const clave of ['Admin123', 'Admin']) {
    const r = await login('Admin', clave);
    if (r.body?.access_token) {
      admin = r.body.access_token;
      if (r.body.usuario?.debeCambiarClave) {
        await req('POST', '/auth/change-password', {
          token: admin,
          body: { claveActual: clave, claveNueva: 'Admin123', confirmacion: 'Admin123' },
        });
        admin = (await login('Admin', 'Admin123')).body.access_token;
      }
      break;
    }
  }
  ok('Login Administrador', !!admin);
  if (!admin) process.exit(1);

  // Cliente base con su dirección principal
  let cli = await req('POST', '/clients', {
    token: admin,
    body: { nombre: 'CLIENTE CASI-DUP I20', identificacion: 'I20-001', direccion: 'Calle 10 # 5-20', ciudad: 'Bogotá' },
  });
  if (cli.status !== 201) {
    const existentes = (await req('GET', '/clients?q=CASI-DUP', { token: admin })).body ?? [];
    cli = { status: 201, body: existentes[0] };
  }
  ok('Cliente base disponible', cli.status === 201 && !!cli.body?.id, cli.body?.id);
  const clienteId = cli.body.id;

  // ============ Casi-duplicados de dirección ============
  // La dirección original es "Calle 10 # 5-20 / Bogotá". Variantes que
  // DEBEN descartarse como la misma dirección:
  const variantes = [
    { dir: 'calle 10 #5-20', nota: 'minúsculas + espacio distinto tras #' },
    { dir: 'CALLE 10 # 5 - 20', nota: 'mayúsculas + guion con espacios' },
    { dir: 'Cl. 10 # 5-20.', nota: 'abreviatura Cl. + punto final' },
    { dir: 'Calle 10 No. 5-20', nota: 'No. en vez de #' },
    { dir: 'Calle  10   # 5-20', nota: 'espacios múltiples' },
  ];
  const filas = variantes.map((v) => ({
    'Nombre': 'CLIENTE CASI-DUP I20', 'Identificación': 'I20-001',
    'Dirección': v.dir, 'Ciudad': 'bogotá ',
  }));
  // Y una dirección GENUINAMENTE distinta que SÍ debe agregarse:
  filas.push({
    'Nombre': 'CLIENTE CASI-DUP I20', 'Identificación': 'I20-001',
    'Dirección': 'Carrera 45 # 128-30', 'Ciudad': 'Bogotá',
  });

  const job = await importar(admin, 'casi-dup-i20.xlsx', filas);
  ok('Importación validada (6/6 válidas)', job.status === 201 && job.body?.resumen?.validas === 6,
    `válidas=${job.body?.resumen?.validas}`);
  const r = job.body?.resumen ?? {};
  ok('Preview: 5 casi-duplicados descartados + 1 dirección nueva',
    r.descartados === 5 && r.direccionesAAgregar === 1,
    JSON.stringify({ descartados: r.descartados, direccionesAAgregar: r.direccionesAAgregar }));

  const aprob = await req('POST', `/imports/${job.body.id}/approve`, { token: admin });
  const ap = aprob.body?.resumen?.aplicado ?? {};
  ok('Aplicado: 5 descartados / 1 agregada / 0 omitidas',
    ap.descartados === 5 && ap.direccionesAgregadas === 1 && ap.omitidasMaximo === 0,
    JSON.stringify(ap));

  const dirs = (await req('GET', `/clients/${clienteId}/direcciones`, { token: admin })).body ?? [];
  ok('Cliente queda con 2 direcciones (original + Carrera 45), sin redundancia',
    dirs.length === 2 && dirs.some((d) => d.direccion.includes('Carrera 45')),
    dirs.map((d) => d.direccion).join(' | '));

  // ============ Preview con tope de 10 ============
  // Llenar el cliente hasta el tope (tiene 2; agregar 8 más)
  const ocho = [];
  for (let i = 1; i <= 8; i++) {
    ocho.push({
      'Nombre': 'CLIENTE CASI-DUP I20', 'Identificación': 'I20-001',
      'Dirección': `Diagonal ${i} # ${i}0-0${i}`, 'Ciudad': 'Bogotá',
    });
  }
  const job2 = await importar(admin, 'tope-ocho-i20.xlsx', ocho);
  await req('POST', `/imports/${job2.body.id}/approve`, { token: admin });
  const dirs10 = (await req('GET', `/clients/${clienteId}/direcciones`, { token: admin })).body ?? [];
  ok('Cliente llega al tope de 10 direcciones', dirs10.length === 10, `total=${dirs10.length}`);

  // Una fila más: el preview debe reportarla como omitida, NO como "a agregar"
  const job3 = await importar(admin, 'tope-once-i20.xlsx', [{
    'Nombre': 'CLIENTE CASI-DUP I20', 'Identificación': 'I20-001',
    'Dirección': 'Transversal 99 # 1-01', 'Ciudad': 'Bogotá',
  }]);
  const r3 = job3.body?.resumen ?? {};
  ok('Preview sobre el tope: 0 a agregar / 1 omitida (no promete de más)',
    r3.direccionesAAgregar === 0 && r3.omitidasMaximo === 1,
    JSON.stringify({ direccionesAAgregar: r3.direccionesAAgregar, omitidasMaximo: r3.omitidasMaximo }));
  const aprob3 = await req('POST', `/imports/${job3.body.id}/approve`, { token: admin });
  const ap3 = aprob3.body?.resumen?.aplicado ?? {};
  ok('Aplicado confirma el preview (0 agregadas / 1 omitida)',
    ap3.direccionesAgregadas === 0 && ap3.omitidasMaximo === 1, JSON.stringify(ap3));
  const dirsFinal = (await req('GET', `/clients/${clienteId}/direcciones`, { token: admin })).body ?? [];
  ok('El tope se mantiene en 10 tras aprobar', dirsFinal.length === 10);

  // ============ Punto 2: lockfiles limpios ============
  for (const f of ['../frontend/package-lock.json', 'package-lock.json', '../ocr-worker/package-lock.json']) {
    const contenido = readFileSync(f, 'utf8');
    ok(`${f.split('/').slice(-2).join('/')} sin mirror corporativo`,
      !contenido.includes('npm.mirrors.msh.team'));
    ok(`${f.split('/').slice(-2).join('/')}/.npmrc fija registry oficial`,
      readFileSync(f.replace('package-lock.json', '.npmrc'), 'utf8').includes('registry=https://registry.npmjs.org/'));
  }

  console.log(fallos === 0 ? '\nTODAS LAS VALIDACIONES I20 PASARON' : `\n${fallos} FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR INESPERADO:', e); process.exit(1); });
