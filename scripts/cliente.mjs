#!/usr/bin/env node
// Instala y actualiza el backend (Supabase) de un cliente. Solo usa Node y la CLI de Supabase.
//
//   pnpm cliente nuevo --nombre "Mi Cliente SA" --email dueno@cliente.com
//   pnpm cliente nuevo --nombre "Mi Cliente SA" --email dueno@cliente.com --ref abcdefghij   (proyecto ya creado y vacío)
//   pnpm cliente actualizar --ref abcdefghij
//   pnpm cliente --ayuda
//
// Requisitos: haber iniciado sesión una vez con `npx supabase login`.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACIONES = 'supabase/migrations';
const FUNCIONES = 'supabase/functions';
// La misma lista (con sus dependencias) que usa la app: src/lib/modulos.json
const MODULOS = JSON.parse(readFileSync(join(RAIZ, 'src/lib/modulos.json'), 'utf8')).modulos;
const IDS_MODULOS = MODULOS.map(m => m.id);

// ---------- utilidades ----------
const log = (...a) => console.log(...a);
const paso = t => log(`\n▶ ${t}`);
// Un error "esperado" (datos mal puestos, algo que falta): se corta con un mensaje claro y sin detalles técnicos.
class ErrorDeUso extends Error {}
const falla = msg => { throw new ErrorDeUso(msg); };

function parsearArgumentos(argv) {
  const [comando, ...resto] = argv;
  const opciones = {};
  for (let i = 0; i < resto.length; i++) {
    if (!resto[i].startsWith('--')) falla(`Argumento inesperado: ${resto[i]}`);
    const clave = resto[i].slice(2);
    const siguiente = resto[i + 1];
    if (siguiente === undefined || siguiente.startsWith('--')) opciones[clave] = true;
    else { opciones[clave] = siguiente; i++; }
  }
  return { comando, opciones };
}

// Ejecuta la CLI de Supabase desde la raíz del proyecto (así las rutas relativas no llevan espacios).
function supabase(args, { silencioso = false } = {}) {
  try {
    return execFileSync('npx', ['--yes', 'supabase', ...args], { cwd: RAIZ, shell: true, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (!silencioso) console.error(String(e.stdout || '') + String(e.stderr || ''));
    throw new Error(`Falló: supabase ${args.slice(0, 3).join(' ')}…`);
  }
}

function json(salida) {
  const i = salida.search(/[{[]/);
  const j = Math.max(salida.lastIndexOf('}'), salida.lastIndexOf(']'));
  return JSON.parse(salida.slice(i, j + 1));
}

const dormir = ms => new Promise(r => setTimeout(r, ms));
const aleatoria = (bytes = 18) => randomBytes(bytes).toString('base64url');
const slug = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function consultar(ref, sql) {
  const temporal = `scripts/.consulta-${process.pid}.sql`;
  writeFileSync(join(RAIZ, temporal), sql);
  try { return json(supabase(['db', 'query', '--linked', '--project-ref', ref, '-f', temporal])).rows ?? []; }
  finally { try { writeFileSync(join(RAIZ, temporal), ''); } catch { /* nada */ } }
}

function ejecutarArchivo(ref, archivoRelativo) {
  supabase(['db', 'query', '--linked', '--project-ref', ref, '-f', archivoRelativo]);
}

// ---------- pasos ----------
async function esperarProyecto(ref) {
  paso('Esperando que el proyecto esté listo (puede tardar un par de minutos)');
  for (let i = 0; i < 60; i++) {
    const lista = json(supabase(['projects', 'list'], { silencioso: true })).projects ?? [];
    const p = lista.find(x => x.ref === ref);
    if (p?.status === 'ACTIVE_HEALTHY') {
      // El estado puede adelantarse a la base: se prueba una consulta simple.
      for (let k = 0; k < 20; k++) {
        try { consultar(ref, 'select 1 as ok'); return; } catch { await dormir(5000); }
      }
    }
    await dormir(10000);
  }
  falla('El proyecto no quedó listo a tiempo. Revisalo en el panel de Supabase y volvé a correr el comando con --ref.');
}

function crearProyecto(nombre, region, orgId) {
  paso(`Creando el proyecto "${nombre}" en Supabase (${region})`);
  if (!orgId) {
    const orgs = json(supabase(['orgs', 'list'])).organizations ?? [];
    if (orgs.length !== 1) falla(`Tenés ${orgs.length} organizaciones: indicá cuál con --org <id>.`);
    orgId = orgs[0].id;
  }
  const claveDb = aleatoria(24);
  const creado = json(supabase(['projects', 'create', nombre, '--org-id', orgId, '--region', region, '--db-password', claveDb]));
  if (!creado.ref) falla('Supabase no devolvió el identificador del proyecto.');
  log(`  Proyecto creado: ${creado.ref}`);
  return { ref: creado.ref, claveDb };
}

function archivosDeMigracion() {
  return readdirSync(join(RAIZ, MIGRACIONES)).filter(f => f.endsWith('.sql')).sort();
}

// Aplica solo las migraciones que faltan y deja el registro de cuáles se aplicaron.
// marcarHasta: nombre de una migración; las que llegan hasta esa (inclusive) se registran como hechas
// sin ejecutarlas (para instalaciones que ya tenían esa parte), y las siguientes se aplican.
function aplicarMigraciones(ref, { marcarHasta = null } = {}) {
  paso('Aplicando la base de datos');
  const hayRegistro = consultar(ref, `select to_regclass('public.migraciones_aplicadas') is not null as hay`)[0]?.hay;
  if (!hayRegistro) {
    const tablas = Number(consultar(ref, `select count(*)::int as n from pg_tables where schemaname = 'public'`)[0]?.n ?? 0);
    if (tablas > 0 && !marcarHasta) {
      falla('Este proyecto ya tiene tablas pero no fue instalado con este script. No toco nada. ' +
        'Si es una instalación existente, usá --marcar-hasta <migración> para registrar como hechas las que ya tiene (sin ejecutarlas).');
    }
    consultar(ref, `create table if not exists public.migraciones_aplicadas (nombre text primary key, aplicada_at timestamptz not null default now());
      alter table public.migraciones_aplicadas enable row level security;
      select 1 as ok`);
  }
  const hechas = new Set(consultar(ref, 'select nombre from public.migraciones_aplicadas').map(r => r.nombre));
  let aplicadas = 0;
  for (const archivo of archivosDeMigracion()) {
    if (hechas.has(archivo)) continue;
    if (marcarHasta && archivo <= marcarHasta) log(`  · registrada sin ejecutar: ${archivo}`);
    else { log(`  · ${archivo}`); ejecutarArchivo(ref, `${MIGRACIONES}/${archivo}`); }
    consultar(ref, `insert into public.migraciones_aplicadas (nombre) values ('${archivo.replace(/'/g, "''")}') on conflict do nothing; select 1 as ok`);
    aplicadas++;
  }
  log(aplicadas ? `  ${aplicadas} migración(es) aplicada(s).` : '  La base ya estaba al día.');
}

function obtenerClaves(ref) {
  const claves = json(supabase(['projects', 'api-keys', '--project-ref', ref, '-o', 'json']));
  const lista = Array.isArray(claves) ? claves : claves.keys ?? [];
  const anon = lista.find(k => /anon/i.test(k.name))?.api_key;
  const servicio = lista.find(k => /service_role/i.test(k.name))?.api_key;
  if (!anon || !servicio) falla('No pude leer las claves del proyecto.');
  return { anon, servicio };
}

function publicarFunciones(ref, claveServicio) {
  paso('Publicando las funciones del servidor');
  supabase(['secrets', 'set', `PROJECT_SECRET_KEY=${claveServicio}`, '--project-ref', ref], { silencioso: true });
  for (const nombre of readdirSync(join(RAIZ, FUNCIONES), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    log(`  · ${nombre}`);
    supabase(['functions', 'deploy', nombre, '--project-ref', ref, '--use-api'], { silencioso: true });
  }
}

async function api(url, clave, ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(url + ruta, {
    method: metodo,
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { estado: r.status, datos };
}

async function crearPrimerDueno(ref, claveServicio, email, nombreEmpresa) {
  paso('Creando al primer dueño');
  const url = `https://${ref}.supabase.co`;
  const clave = aleatoria(12) + '9!';
  let r = await api(url, claveServicio, '/auth/v1/admin/users', {
    metodo: 'POST', cuerpo: { email, password: clave, email_confirm: true, user_metadata: { full_name: email.split('@')[0] } },
  });
  let claveMostrada = clave;
  if (r.estado === 422 || r.datos?.error_code === 'email_exists') { log('  Ese correo ya existía: se conserva su contraseña.'); claveMostrada = null; }
  else if (r.estado >= 300) falla(`No se pudo crear el usuario: ${JSON.stringify(r.datos).slice(0, 200)}`);
  r = await api(url, claveServicio, '/rest/v1/rpc/definir_dueno_inicial', { metodo: 'POST', cuerpo: { p_email: email } });
  if (r.estado >= 300) {
    const msg = r.datos?.message ?? '';
    if (/ya tiene un due/i.test(msg)) log('  La instalación ya tenía un dueño: no se cambió nada.');
    else falla(`No se pudo definir al dueño: ${msg}`);
  }
  if (nombreEmpresa) await api(url, claveServicio, '/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', cuerpo: { empresa_nombre: nombreEmpresa } });
  return claveMostrada;
}

// ---------- módulos (la licencia) ----------
function listaDeModulos(valor, opcion) {
  if (typeof valor !== 'string') falla(`Falta la lista en --${opcion}. Ejemplo: --${opcion} deposito,tareas. Módulos: ${IDS_MODULOS.join(', ')}`);
  const lista = valor.split(',').map(x => x.trim()).filter(Boolean);
  const desconocidos = lista.filter(x => !IDS_MODULOS.includes(x));
  if (desconocidos.length) falla(`Módulo desconocido: ${desconocidos.join(', ')}. Módulos: ${IDS_MODULOS.join(', ')}`);
  return lista;
}

// Cada módulo activo necesita que estén activos los que requiere.
function validarDependencias(estado) {
  const errores = [];
  for (const m of MODULOS) {
    if (!estado[m.id]) continue;
    for (const r of m.requiere) if (!estado[r]) errores.push(`"${m.id}" necesita "${r}", que quedaría apagado.`);
  }
  if (errores.length) falla(`Esa combinación no es posible:\n  - ${errores.join('\n  - ')}`);
}

async function leerLicencia(ref, servicio) {
  const r = await api(`https://${ref}.supabase.co`, servicio, '/rest/v1/licencia?select=modulos&id=eq.1');
  if (r.estado >= 300 || !r.datos?.[0]) falla('No pude leer la licencia. ¿El proyecto ya tiene instaladas todas las migraciones? Probá con "pnpm cliente actualizar".');
  return Object.fromEntries(IDS_MODULOS.map(id => [id, r.datos[0].modulos?.[id] !== false]));
}

async function escribirLicencia(ref, servicio, estado) {
  const r = await api(`https://${ref}.supabase.co`, servicio, '/rest/v1/licencia?id=eq.1', { metodo: 'PATCH', cuerpo: { modulos: estado } });
  if (r.estado >= 300 || !r.datos?.[0]) falla(`No se pudo guardar la licencia: ${JSON.stringify(r.datos).slice(0, 200)}`);
}

const nombreModulo = id => MODULOS.find(m => m.id === id)?.nombre ?? id;

// ---------- comandos ----------
async function modulos(op) {
  if (!op.ref || op.ref === true) falla('Falta el proyecto. Uso: pnpm cliente modulos --ref <identificador> [--activar a,b] [--desactivar c] [--confirmo]');
  const { servicio } = obtenerClaves(op.ref);
  const antes = await leerLicencia(op.ref, servicio);
  const despues = { ...antes };
  if (op.activar !== undefined) for (const m of listaDeModulos(op.activar, 'activar')) despues[m] = true;
  if (op.desactivar !== undefined) for (const m of listaDeModulos(op.desactivar, 'desactivar')) despues[m] = false;
  validarDependencias(despues);

  log(`\nMódulos del proyecto ${op.ref}\n`);
  for (const m of MODULOS) {
    const cambia = antes[m.id] !== despues[m.id];
    log(` ${cambia ? '→' : ' '} ${nombreModulo(m.id).padEnd(28)} ${antes[m.id] ? 'activo ' : 'apagado'}${cambia ? `  →  ${despues[m.id] ? 'ACTIVO' : 'APAGADO'}` : ''}`);
  }
  const cambios = MODULOS.filter(m => antes[m.id] !== despues[m.id]);
  if (!cambios.length) { log('\nNo hay cambios.'); return; }

  for (const m of cambios.filter(x => !despues[x.id])) log(`\n ⚠ Apagar "${nombreModulo(m.id)}" bloquea para TODOS (también para el dueño): ${m.bloquea}.\n   Los datos no se borran: si se vuelve a activar, vuelven a estar.`);
  for (const m of cambios.filter(x => despues[x.id])) log(`\n ✔ Activar "${nombreModulo(m.id)}" habilita: ${m.bloquea}.`);

  if (!op.confirmo) { log('\nSimulación: no se cambió nada. Para aplicar el cambio, repetí el comando agregando --confirmo'); return; }
  await escribirLicencia(op.ref, servicio, despues);
  const verificada = await leerLicencia(op.ref, servicio);
  if (IDS_MODULOS.some(id => verificada[id] !== despues[id])) falla('La licencia no quedó como se esperaba. Revisala.');
  log('\n✔ Licencia actualizada. Queda anotado en el Historial del cliente.');
}

async function nuevo(op) {
  const nombre = op.nombre, email = op.email;
  if (!nombre || !email || nombre === true || email === true) falla('Faltan datos. Uso: pnpm cliente nuevo --nombre "Mi Cliente SA" --email dueno@cliente.com');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) falla('El email no parece válido.');
  const id = slug(nombre);
  if (!id) falla('El nombre no sirve para armar un identificador.');
  // Módulos que contrata este cliente (por defecto, todos). Se validan antes de crear nada.
  const activos = op.modulos === undefined ? IDS_MODULOS : listaDeModulos(op.modulos, 'modulos');
  const licencia = Object.fromEntries(IDS_MODULOS.map(m => [m, activos.includes(m)]));
  validarDependencias(licencia);

  let ref = op.ref, claveDb = null;
  if (ref) log(`Usando el proyecto existente ${ref}`);
  else ({ ref, claveDb } = crearProyecto(id, op.region || 'sa-east-1', op.org));
  await esperarProyecto(ref);
  aplicarMigraciones(ref);
  const { anon, servicio } = obtenerClaves(ref);
  publicarFunciones(ref, servicio);
  const claveDueno = await crearPrimerDueno(ref, servicio, email, nombre);
  paso('Definiendo los módulos del cliente');
  await escribirLicencia(ref, servicio, licencia);
  log(`  Activos: ${activos.map(nombreModulo).join(', ') || '(ninguno)'}`);

  mkdirSync(join(RAIZ, 'clientes'), { recursive: true });
  const archivo = `clientes/${id}.env.local`;
  writeFileSync(join(RAIZ, archivo), [
    `# Cliente: ${nombre}   (archivo privado: no se sube a Git)`,
    `SUPABASE_PROJECT_REF=${ref}`,
    `VITE_SUPABASE_URL=https://${ref}.supabase.co`,
    `VITE_SUPABASE_ANON_KEY=${anon}`,
    `SUPABASE_SECRET_KEY=${servicio}`,
    claveDb ? `SUPABASE_DB_PASSWORD=${claveDb}` : '# (la contraseña de la base ya existía)',
    `PRIMER_DUENO_EMAIL=${email}`,
    claveDueno ? `PRIMER_DUENO_CLAVE_INICIAL=${claveDueno}` : '# (el dueño ya tenía contraseña)',
    '',
  ].join('\n'), { mode: 0o600 });

  log(`
══════════════════════════════════════════════════════════════
 ✔ Listo: ${nombre}
══════════════════════════════════════════════════════════════
 Proyecto de Supabase : ${ref}
 Primer dueño         : ${email}${claveDueno ? `\n Contraseña inicial   : (guardada en ${archivo}; que la cambie al entrar)` : ''}
 Datos privados       : ${archivo}

 Falta hacer a mano (la plataforma no lo permite por comando):
  1. Supabase → Authentication → Sign In / Providers: desactivar "Allow new users to sign up"
     (los usuarios los crea el dueño desde la app).
  2. Supabase → Authentication → URL Configuration: poner la dirección donde se publique la app.
  3. Publicar la app (por ejemplo en Netlify): comando "pnpm build", carpeta "dist", y estas variables:
        VITE_SUPABASE_URL  y  VITE_SUPABASE_ANON_KEY   (están en ${archivo})
  4. Entrar con el correo del dueño: se abre solo el asistente de Configuración inicial (empresa, colores,
     usuarios y datos de arranque).
  Para cambiar los módulos más adelante:  pnpm cliente modulos --ref ${ref} --activar ... --desactivar ...
`);
}

async function actualizar(op) {
  if (!op.ref || op.ref === true) falla('Falta el proyecto. Uso: pnpm cliente actualizar --ref <identificador>');
  await esperarProyecto(op.ref);
  const marcarHasta = op['marcar-aplicadas'] ? archivosDeMigracion().at(-1) : (typeof op['marcar-hasta'] === 'string' ? op['marcar-hasta'] : null);
  if (marcarHasta && !archivosDeMigracion().includes(marcarHasta)) falla(`No existe la migración ${marcarHasta}.`);
  aplicarMigraciones(op.ref, { marcarHasta });
  if (!op['solo-base']) {
    const claves = obtenerClaves(op.ref);
    publicarFunciones(op.ref, claves.servicio);
  }
  log('\n✔ Cliente actualizado.');
}

const AYUDA = `Uso:
  pnpm cliente nuevo --nombre "Nombre del cliente" --email dueno@cliente.com [--modulos a,b,c] [--region sa-east-1] [--org <id>] [--ref <proyecto-vacío>]
  pnpm cliente actualizar --ref <identificador> [--solo-base] [--marcar-hasta <migración> | --marcar-aplicadas]
  pnpm cliente modulos --ref <identificador> [--activar a,b] [--desactivar c] [--confirmo]

  nuevo        Crea el proyecto en Supabase (o usa uno vacío con --ref), instala la base, publica las
               funciones y crea al primer dueño. --modulos elige los que contrata el cliente
               (por defecto, todos). Módulos: ${IDS_MODULOS.join(', ')}.
  modulos      Muestra y cambia los módulos de un cliente. Sin --confirmo solo simula. Valida las dependencias
               (por ejemplo, envios necesita proveedores). Es lo único que puede cambiar la licencia: el cliente no.
  actualizar   Aplica las migraciones que falten y vuelve a publicar las funciones.
               --solo-base            no toca las funciones
               --marcar-hasta M       en una instalación que ya existía: registra como hechas (sin ejecutar) las
                                      migraciones hasta M inclusive, y aplica las siguientes
               --marcar-aplicadas     igual, pero con todas las migraciones`;

try {
  const { comando, opciones } = parsearArgumentos(process.argv.slice(2));
  if (!comando || comando === '--ayuda' || opciones.ayuda) log(AYUDA);
  else if (!existsSync(join(RAIZ, MIGRACIONES))) falla('No encuentro supabase/migrations: ejecutá el comando desde el proyecto.');
  else if (comando === 'nuevo') await nuevo(opciones);
  else if (comando === 'actualizar') await actualizar(opciones);
  else if (comando === 'modulos') await modulos(opciones);
  else falla(`Comando desconocido: ${comando}\n\n${AYUDA}`);
} catch (e) {
  if (e instanceof ErrorDeUso) { console.error(`\n✖ ${e.message}`); process.exitCode = 1; }
  else { console.error('\n✖ Falló algo inesperado:', e.message ?? e); process.exitCode = 1; }
}
