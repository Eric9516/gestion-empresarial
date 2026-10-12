#!/usr/bin/env node
// Instala y actualiza el backend (Supabase) de un cliente. Solo usa Node: habla directo con la API de Supabase.
//
//   pnpm cliente nuevo --nombre "Mi Cliente SA" --email dueno@cliente.com
//   pnpm cliente nuevo --nombre "Mi Cliente SA" --email dueno@cliente.com --ref abcdefghij   (proyecto ya creado y vacío)
//   pnpm cliente actualizar --ref abcdefghij
//   pnpm cliente --ayuda
//
// Requisitos: la llave de tu cuenta de Supabase (se genera una vez en https://supabase.com/dashboard/account/tokens y se
// guarda en clientes/cuenta-supabase.env.local, o en la variable SUPABASE_ACCESS_TOKEN). No hace falta la CLI de Supabase.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDEN_COMPONENTES, componentesInstalados, componentesParaModulos, expandirRegistro, faltantesPara } from './herramientas/componentes.mjs';
import { ErrorApi, crearApi, leerLlave } from './herramientas/supabase-api.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// La base de datos se instala por componentes (base, abastecimiento, mantenimiento): supabase/componentes/<componente>/*.sql
const MIGRACIONES = 'supabase/componentes';
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

const dormir = ms => new Promise(r => setTimeout(r, ms));
const aleatoria = (bytes = 18) => randomBytes(bytes).toString('base64url');
const slug = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// La API de administración de Supabase (se crea al arrancar, cuando ya se leyó la llave de la cuenta).
let gestion;
const consultar = (ref, sql) => gestion.consultar(ref, sql);
const ejecutarArchivo = (ref, archivoRelativo) => gestion.consultar(ref, readFileSync(join(RAIZ, archivoRelativo), 'utf8'));

// ---------- pasos ----------
async function esperarProyecto(ref) {
  paso('Esperando que el proyecto esté listo (puede tardar un par de minutos)');
  for (let i = 0; i < 60; i++) {
    const p = (await gestion.proyectos()).find(x => x.ref === ref);
    if (!p && i === 0) falla(`Esa llave de Supabase no ve el proyecto ${ref}. Revisá que el identificador esté bien y que la llave sea de la cuenta donde está el proyecto.`);
    if (p?.estado === 'ACTIVE_HEALTHY') {
      // El estado puede adelantarse a la base: se prueba una consulta simple.
      for (let k = 0; k < 20; k++) {
        try { await consultar(ref, 'select 1 as ok'); return; } catch (e) { if (k === 0 || k === 4) log(`  · todavía no responde la base (${String(e.message).slice(0, 300)})`); await dormir(5000); }
      }
    }
    await dormir(10000);
  }
  falla('El proyecto no quedó listo a tiempo. Revisalo en el panel de Supabase y volvé a correr el comando con --ref.');
}

async function crearProyecto(nombre, region, orgId) {
  paso(`Creando el proyecto "${nombre}" en Supabase (${region})`);
  if (!orgId) {
    const orgs = await gestion.organizaciones();
    if (orgs.length !== 1) falla(`Tenés ${orgs.length} organizaciones: indicá cuál con --org <id>. Las que ve tu llave: ${orgs.map(o => `${o.nombre} (${o.id})`).join(', ') || '(ninguna)'}.`);
    orgId = orgs[0].id;
  }
  const claveDb = aleatoria(24);
  const creado = await gestion.crearProyecto({ nombre, region, clave: claveDb, org: orgId });
  if (!creado.ref) falla('Supabase no devolvió el identificador del proyecto.');
  log(`  Proyecto creado: ${creado.ref}`);
  return { ref: creado.ref, claveDb };
}

// Nombres "componente/archivo.sql" de las migraciones de los componentes pedidos, en el orden en que se aplican
// (primero la Base, después Abastecimiento, después Mantenimiento; dentro de cada uno, por número de versión).
function archivosDeMigracion(componentes = ORDEN_COMPONENTES) {
  return ORDEN_COMPONENTES.filter(c => componentes.includes(c)).flatMap(c => {
    const dir = join(RAIZ, MIGRACIONES, c);
    return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => c + '/' + f) : [];
  });
}
const versionDe = nombre => nombre.split('/').pop().split('_')[0];

// Qué se aplicó ya en el proyecto. null = todavía no tiene el registro de migraciones.
async function leerRegistro(ref) {
  const hayRegistro = (await consultar(ref, "select to_regclass('public.migraciones_aplicadas') is not null as hay"))[0]?.hay;
  if (!hayRegistro) return null;
  return (await consultar(ref, 'select nombre from public.migraciones_aplicadas')).map(r => String(r.nombre));
}
// Componentes instalados en el proyecto (se deducen del registro; uno de antes de los componentes cuenta como completo).
async function componentesDelProyecto(ref) {
  const registro = await leerRegistro(ref);
  return registro ? componentesInstalados(registro) : [];
}

// Aplica solo las migraciones que faltan de los componentes pedidos y deja el registro de cuáles se aplicaron.
// marcarHasta: número de versión (o nombre de una migración); las que llegan hasta esa versión se registran como hechas
// sin ejecutarlas (para instalaciones que ya tenían esa parte), y las siguientes se aplican.
async function aplicarMigraciones(ref, componentes, { marcarHasta = null } = {}) {
  paso('Aplicando la base de datos (' + componentes.join(' + ') + ')');
  let registro = await leerRegistro(ref);
  if (registro === null) {
    const tablas = Number((await consultar(ref, "select count(*)::int as n from pg_tables where schemaname = 'public'"))[0]?.n ?? 0);
    if (tablas > 0 && !marcarHasta) {
      falla('Este proyecto ya tiene tablas pero no fue instalado con este script. No toco nada. ' +
        'Si es una instalación existente, usá --marcar-hasta <migración> para registrar como hechas las que ya tiene (sin ejecutarlas).');
    }
    await consultar(ref, `create table if not exists public.migraciones_aplicadas (nombre text primary key, aplicada_at timestamptz not null default now());
      alter table public.migraciones_aplicadas enable row level security;
      revoke all on public.migraciones_aplicadas from anon, authenticated;
      select 1 as ok`);
    registro = [];
  }
  const hechas = expandirRegistro(registro, archivosDeMigracion());
  const version = marcarHasta ? versionDe(marcarHasta) : null;
  let aplicadas = 0;
  for (const archivo of archivosDeMigracion(componentes)) {
    if (hechas.has(archivo)) continue;
    if (version && versionDe(archivo) <= version) log(`  · registrada sin ejecutar: ${archivo}`);
    else { log(`  · ${archivo}`); await ejecutarArchivo(ref, `${MIGRACIONES}/${archivo}`); }
    await consultar(ref, `insert into public.migraciones_aplicadas (nombre) values ('${archivo.replace(/'/g, "''")}') on conflict do nothing; select 1 as ok`);
    aplicadas++;
  }
  log(aplicadas ? `  ${aplicadas} migración(es) aplicada(s).` : '  La base ya estaba al día.');
}

async function obtenerClaves(ref) {
  const { anon, servicio } = await gestion.claves(ref);
  if (!anon || !servicio) falla('No pude leer las claves del proyecto.');
  return { anon, servicio };
}

// El registro público de usuarios se cierra a mano en el panel de Supabase (la CLI no lo permite). Este aviso lo
// comprueba de verdad, para que no se pase por alto: sin cerrarlo, cualquiera con la dirección del proyecto puede
// crearse una cuenta (quedaría sin permisos, pero conviene que no exista).
async function avisarSiElRegistroEstaAbierto(ref, anon) {
  try {
    const r = await fetch(`https://${ref}.supabase.co/auth/v1/settings`, { headers: { apikey: anon } });
    const ajustes = await r.json();
    if (ajustes.disable_signup === false) {
      log(`\n ⚠ ATENCIÓN: el registro público de usuarios de ${ref} está ABIERTO.\n   Cerralo en Supabase → Authentication → Sign In / Providers → "Allow new users to sign up" (apagado).`);
    } else if (ajustes.disable_signup === true) {
      log('  ✔ El registro público de usuarios está cerrado.');
    }
  } catch {
    // Sin conexión o respuesta rara: no se avisa nada (es solo una ayuda).
  }
}

async function publicarFunciones(ref, claveServicio) {
  paso('Publicando las funciones del servidor');
  await gestion.fijarSecretos(ref, [{ name: 'PROJECT_SECRET_KEY', value: claveServicio }]);
  for (const nombre of readdirSync(join(RAIZ, FUNCIONES), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    log(`  · ${nombre}`);
    await gestion.desplegarFuncion(ref, nombre, readFileSync(join(RAIZ, FUNCIONES, nombre, 'index.ts'), 'utf8'));
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
  // Solo cuenta como activo lo que la licencia dice de forma expresa (igual que la base de datos).
  return Object.fromEntries(IDS_MODULOS.map(id => [id, r.datos[0].modulos?.[id] === true]));
}

async function escribirLicencia(ref, servicio, estado) {
  const r = await api(`https://${ref}.supabase.co`, servicio, '/rest/v1/licencia?id=eq.1', { metodo: 'PATCH', cuerpo: { modulos: estado } });
  if (r.estado >= 300 || !r.datos?.[0]) falla(`No se pudo guardar la licencia: ${JSON.stringify(r.datos).slice(0, 200)}`);
}

const nombreModulo = id => MODULOS.find(m => m.id === id)?.nombre ?? id;

// ---------- comandos ----------
async function modulos(op) {
  if (!op.ref || op.ref === true) falla('Falta el proyecto. Uso: pnpm cliente modulos --ref <identificador> [--activar a,b] [--desactivar c] [--confirmo]');
  const { servicio } = await obtenerClaves(op.ref);
  const antes = await leerLicencia(op.ref, servicio);
  const despues = { ...antes };
  if (op.activar !== undefined) for (const m of listaDeModulos(op.activar, 'activar')) despues[m] = true;
  if (op.desactivar !== undefined) for (const m of listaDeModulos(op.desactivar, 'desactivar')) despues[m] = false;
  validarDependencias(despues);
  const instalados = await componentesDelProyecto(op.ref);
  for (const m of MODULOS) {
    if (despues[m.id] && !antes[m.id] && !instalados.includes(m.componente)) {
      falla(`"${m.nombre}" es del componente ${m.componente}, que no está instalado en este cliente. Instalalo primero:  pnpm cliente componente --ref ${op.ref} --agregar ${m.componente} --confirmo`);
    }
  }

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

// Instala un componente que el cliente no tenía (por ejemplo, Mantenimiento más adelante). No toca los datos que ya hay.
async function componente(op) {
  if (!op.ref || op.ref === true || typeof op.agregar !== 'string') falla('Uso: pnpm cliente componente --ref <identificador> --agregar <abastecimiento|mantenimiento> [--confirmo]');
  if (!ORDEN_COMPONENTES.includes(op.agregar) || op.agregar === 'base') falla(`Componente desconocido: ${op.agregar}. Se puede agregar: ${ORDEN_COMPONENTES.filter(c => c !== 'base').join(', ')}.`);
  await esperarProyecto(op.ref);
  const instalados = await componentesDelProyecto(op.ref);
  if (!instalados.length) falla('Ese proyecto no fue instalado con este sistema.');
  if (instalados.includes(op.agregar)) falla(`El componente ${op.agregar} ya está instalado en ese cliente.`);
  const faltan = faltantesPara(op.agregar, instalados);
  if (faltan.length) falla(`Para instalar ${op.agregar} primero hace falta: ${faltan.join(', ')}.`);
  const pendientes = archivosDeMigracion([op.agregar]);
  log(`\nComponente a instalar: ${op.agregar}  (ya tiene: ${instalados.join(', ')})\nMigraciones:\n${pendientes.map(a => '  · ' + a).join('\n')}`);
  if (!op.confirmo) { log('\nSimulación: no se cambió nada. Para instalarlo, repetí el comando agregando --confirmo'); return; }
  await aplicarMigraciones(op.ref, [...instalados, op.agregar]);
  log(`\n✔ Componente instalado. Sus módulos quedan apagados hasta que los actives:  pnpm cliente modulos --ref ${op.ref} --activar ...`);
}

async function nuevo(op) {
  const nombre = op.nombre, email = op.email;
  if (!nombre || !email || nombre === true || email === true) falla('Faltan datos. Uso: pnpm cliente nuevo --nombre "Mi Cliente SA" --email dueno@cliente.com');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) falla('El email no parece válido.');
  const id = slug(nombre);
  if (!id) falla('El nombre no sirve para armar un identificador.');
  // Módulos que contrata este cliente. Hay que decirlos de forma expresa (o poner "todos"): así nunca se
  // activa por descuido un módulo que el cliente no compró. Se validan antes de crear nada.
  if (op.modulos === undefined || op.modulos === true) falla(`Falta --modulos: indicá qué contrata el cliente. Ejemplo: --modulos proveedores,deposito (o --modulos todos). Módulos: ${IDS_MODULOS.join(', ')}`);
  const activos = op.modulos === 'todos' ? IDS_MODULOS : listaDeModulos(op.modulos, 'modulos');
  const licencia = Object.fromEntries(IDS_MODULOS.map(m => [m, activos.includes(m)]));
  validarDependencias(licencia);

  let ref = op.ref, claveDb = null;
  if (ref) log(`Usando el proyecto existente ${ref}`);
  else ({ ref, claveDb } = await crearProyecto(id, op.region || 'sa-east-1', op.org));
  await esperarProyecto(ref);
  // Solo se instalan los componentes de los módulos que contrata el cliente (lo no contratado no existe en su base de datos).
  const componentes = componentesParaModulos(activos, MODULOS);
  log(`  Componentes: ${componentes.join(', ')}`);
  await aplicarMigraciones(ref, componentes);
  const { anon, servicio } = await obtenerClaves(ref);
  await publicarFunciones(ref, servicio);
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

  await avisarSiElRegistroEstaAbierto(ref, anon);

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

// Muestra las organizaciones de Supabase que ve la llave, con el identificador que se usa en --org.
async function organizaciones() {
  const orgs = await gestion.organizaciones();
  if (!orgs.length) { log('Esa llave no ve ninguna organización. Si un cliente te invitó, aceptá primero la invitación (revisá el correo).'); return; }
  log('\nOrganizaciones que ve tu llave de Supabase (el identificador es lo que va en --org):\n');
  for (const o of orgs) log(`  ${o.nombre.padEnd(30)} ${o.id}`);
  log('');
}

async function actualizar(op) {
  if (!op.ref || op.ref === true) falla('Falta el proyecto. Uso: pnpm cliente actualizar --ref <identificador>');
  await esperarProyecto(op.ref);
  const todas = archivosDeMigracion();
  const marcarHasta = op['marcar-aplicadas'] ? todas.map(versionDe).sort().at(-1) : (typeof op['marcar-hasta'] === 'string' ? op['marcar-hasta'] : null);
  if (marcarHasta && !todas.some(a => versionDe(a) === versionDe(marcarHasta))) falla(`No existe la migración ${marcarHasta}.`);
  // Se actualizan los componentes que el proyecto ya tiene. Un proyecto que todavía no tiene registro (instalación de antes) se adopta como completo.
  let componentes = await componentesDelProyecto(op.ref);
  if (!componentes.length) {
    if (!marcarHasta) falla('Ese proyecto no fue instalado con este sistema. Para adoptarlo usá --marcar-hasta <migración> (o --marcar-aplicadas).');
    componentes = ORDEN_COMPONENTES;
  }
  await aplicarMigraciones(op.ref, componentes, { marcarHasta });
  if (!op['solo-base']) {
    const claves = await obtenerClaves(op.ref);
    await publicarFunciones(op.ref, claves.servicio);
    await avisarSiElRegistroEstaAbierto(op.ref, claves.anon);
  }
  log(`\n✔ Cliente actualizado (componentes: ${componentes.join(', ')}).`);
}

// La llave de la cuenta de Supabase. Si falta, se deja preparado el archivo donde pegarla y se explica cómo sacarla.
function llaveDeLaCuenta() {
  const llave = leerLlave(RAIZ);
  if (llave) return llave;
  const archivo = 'clientes/cuenta-supabase.env.local';
  if (!existsSync(join(RAIZ, archivo))) {
    mkdirSync(join(RAIZ, 'clientes'), { recursive: true });
    writeFileSync(join(RAIZ, archivo), '# Llave de tu cuenta de Supabase. Archivo privado: Git lo ignora.\n# Pegala después del signo = (sin comillas ni espacios) y guardá el archivo.\nSUPABASE_ACCESS_TOKEN=\n', { mode: 0o600 });
  }
  falla(`Falta la llave de tu cuenta de Supabase (se saca una sola vez):
  1. Entrá a https://supabase.com/dashboard/account/tokens y tocá "Generate new token" (poné de nombre "cliente").
  2. Copiala: se muestra una sola vez.
  3. Abrí el archivo ${archivo} y pegala después del signo = en la línea SUPABASE_ACCESS_TOKEN=. Guardá.
  4. Volvé a correr el mismo comando.`);
}

const AYUDA = `Uso:
  pnpm cliente nuevo --nombre "Nombre del cliente" --email dueno@cliente.com --modulos a,b,c [--region sa-east-1] [--org <id>] [--ref <proyecto-vacío>]
  pnpm cliente actualizar --ref <identificador> [--solo-base] [--marcar-hasta <migración> | --marcar-aplicadas]
  pnpm cliente modulos --ref <identificador> [--activar a,b] [--desactivar c] [--confirmo]
  pnpm cliente componente --ref <identificador> --agregar <componente> [--confirmo]
  pnpm cliente organizaciones

  nuevo        Crea el proyecto en Supabase (o usa uno vacío con --ref), instala la base, publica las
               funciones y crea al primer dueño. --modulos es obligatorio: los que contrata el cliente
               (o "todos"). Solo se instalan los componentes de esos módulos. Módulos: ${IDS_MODULOS.join(', ')}.
  modulos      Muestra y cambia los módulos de un cliente. Sin --confirmo solo simula. Valida las dependencias
               (por ejemplo, envios necesita proveedores). Es lo único que puede cambiar la licencia: el cliente no.
  componente   Instala en un cliente un componente que no tenía (abastecimiento o mantenimiento), sin tocar sus datos.
               Sin --confirmo solo simula. Después se activan sus módulos con "modulos".
  organizaciones  Lista las organizaciones de Supabase que ve tu llave, con el identificador para --org.
  actualizar   Aplica las migraciones que falten y vuelve a publicar las funciones.
               --solo-base            no toca las funciones
               --marcar-hasta M       en una instalación que ya existía: registra como hechas (sin ejecutar) las
                                      migraciones hasta M inclusive, y aplica las siguientes
               --marcar-aplicadas     igual, pero con todas las migraciones`;

try {
  const { comando, opciones } = parsearArgumentos(process.argv.slice(2));
  if (!comando || comando === '--ayuda' || opciones.ayuda) log(AYUDA);
  else if (!existsSync(join(RAIZ, MIGRACIONES))) falla('No encuentro supabase/componentes: ejecutá el comando desde el proyecto.');
  else if (!['nuevo', 'actualizar', 'modulos', 'componente', 'organizaciones'].includes(comando)) falla(`Comando desconocido: ${comando}\n\n${AYUDA}`);
  else {
    gestion = crearApi(llaveDeLaCuenta());
    if (comando === 'nuevo') await nuevo(opciones);
    else if (comando === 'actualizar') await actualizar(opciones);
    else if (comando === 'modulos') await modulos(opciones);
    else if (comando === 'organizaciones') await organizaciones();
    else await componente(opciones);
  }
} catch (e) {
  if (e instanceof ErrorDeUso || e instanceof ErrorApi) { console.error(`\n✖ ${e.message}`); process.exitCode = 1; }
  else { console.error('\n✖ Falló algo inesperado:', e.message ?? e); process.exitCode = 1; }
}
