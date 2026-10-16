// Ensayo del "pase" de una instalación que ya existe (Cremac) a la plantilla, sobre una copia LOCAL con sus datos reales.
// No toca ninguna base de internet: carga un respaldo (carpeta con datos/*.json) en el Supabase local, aplica la adopción
// (`cliente actualizar --marcar-hasta ...`) con el instalador real y comprueba que no se perdió ni cambió ningún dato.
//
//   node scripts/pruebas/supabase-local/ensayo-pase.mjs <carpeta-del-respaldo>
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { comparar, sacarFoto } from '../esquema/catalogo.mjs';
import { archivosDeComponentes, entornoParaHijos, RAIZ } from './preparar.mjs';
import { iniciarServidor } from './servidor.mjs';

const carpeta = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(carpeta, 'datos'))) { console.error('Uso: node scripts/pruebas/supabase-local/ensayo-pase.mjs <carpeta-del-respaldo>  (tiene que tener la carpeta datos/)'); process.exit(2); }

const servidor = await iniciarServidor();
const env = entornoParaHijos(servidor);
let fallas = 0;
const ok = (nombre, cond, detalle = '') => { if (!cond) fallas++; console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${!cond && detalle ? '  → ' + String(detalle).slice(0, 400) : ''}`); };
const cliente = (...args) => new Promise((resolver) => {
  const hijo = spawn(process.execPath, [join(RAIZ, 'scripts', 'cliente.mjs'), ...args], { cwd: RAIZ, env });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; }); hijo.stderr.on('data', (d) => { salida += d; });
  hijo.on('exit', (codigo) => resolver({ codigo, salida }));
});
const q = async (p, sql, params) => (await p.serializar(() => p.db.query(sql, params))).rows;

// ---- 1) la copia: la base inicial de la plantilla (igual a la de Cremac) con los datos del respaldo ----
const base0 = archivosDeComponentes().filter((f) => /20260101000000_esquema_base/.test(f));
const copia = await servidor.crearProyecto({ nombre: 'cremac-copia-local', archivos: base0 });
const archivos = readdirSync(join(carpeta, 'datos')).filter((f) => f.endsWith('.json')).sort();
const cargadas = {};
await q(copia, `set session_replication_role = replica`); // sin disparadores ni claves mientras se carga (como un restore)
for (const a of archivos) {
  const [esquema, tabla] = a.replace(/\.json$/, '').split('.');
  const filas = JSON.parse(readFileSync(join(carpeta, 'datos', a), 'utf8'));
  const existe = await q(copia, `select 1 from information_schema.tables where table_schema = $1 and table_name = $2`, [esquema, tabla]);
  if (!existe.length) continue; // tablas de Supabase que el emulador no tiene (migraciones de Supabase, etc.)
  if (esquema === 'public' || esquema === 'storage') await q(copia, `delete from ${esquema}.${tabla}`); // la base nueva trae filas iniciales: se restaura exactamente lo del respaldo
  if (!filas.length) { cargadas[`${esquema}.${tabla}`] = 0; continue; }
  const propias = (await q(copia, `select column_name from information_schema.columns where table_schema = $1 and table_name = $2 and is_generated = 'NEVER'`, [esquema, tabla])).map((c) => c.column_name);
  const columnas = Object.keys(filas[0]).filter((c) => propias.includes(c));
  const lista = columnas.map((c) => `"${c}"`).join(', ');
  await q(copia, `insert into ${esquema}.${tabla} (${lista}) overriding system value select ${lista} from json_populate_recordset(null::${esquema}.${tabla}, $1::json)`, [JSON.stringify(filas)]);
  // la numeración automática sigue desde el último número del respaldo
  for (const c of columnas) {
    const sec = (await q(copia, `select pg_get_serial_sequence($1, $2) as s`, [`${esquema}.${tabla}`, c]))[0].s;
    if (sec) await q(copia, `select setval($1, coalesce((select max("${c}") from ${esquema}.${tabla}), 1))`, [sec]);
  }
  cargadas[`${esquema}.${tabla}`] = filas.length;
}
await q(copia, `set session_replication_role = origin`);
const cuenta = async (p, esquema, tabla) => (await q(p, `select count(*)::int as n from ${esquema}.${tabla}`))[0].n;
ok(`copia cargada: ${Object.keys(cargadas).length} tablas, ${Object.values(cargadas).reduce((a, b) => a + b, 0)} filas`, Object.keys(cargadas).length > 20);
for (const u of await q(copia, 'select id from auth.users')) copia.establecerClave(u.id, 'ClaveDeEnsayo-9!zz');

const antes = {};
for (const t of Object.keys(cargadas)) { const [e, n] = t.split('.'); antes[t] = await cuenta(copia, e, n); }
ok('lo cargado coincide con el respaldo, tabla por tabla', Object.entries(cargadas).every(([t, n]) => antes[t] === n), JSON.stringify(Object.entries(cargadas).filter(([t, n]) => antes[t] !== n)));
const fotoAntes = {};
for (const t of ['items', 'proveedores', 'comisionistas', 'contactos', 'tasks', 'usuarios_perfil', 'configuracion', 'reparaciones', 'rotulos_generados']) {
  fotoAntes[t] = (await q(copia, `select to_jsonb(x) as j from public.${t} x order by to_jsonb(x)->>'id', to_jsonb(x)::text`)).map((r) => r.j);
}
for (const _ of [0]) {
}

// ---- 2) el pase: lo que se va a correr en Cremac real ----
let r = await cliente('actualizar', '--ref', copia.ref);
ok('sin --marcar-hasta el instalador se niega a tocar la base', r.codigo !== 0 && /no fue instalado con este (script|sistema)/.test(r.salida), r.salida.slice(-250));
r = await cliente('actualizar', '--ref', copia.ref, '--marcar-hasta', '20260101000000_esquema_base.sql');
console.log(r.salida.split('\n').map((l) => '     ' + l).join('\n'));
ok('el pase termina bien (componentes: base, abastecimiento, mantenimiento)', r.codigo === 0 && /Cliente actualizado \(componentes: base, abastecimiento, mantenimiento\)/.test(r.salida), r.salida.slice(-400));

// ---- 3) qué quedó ----
const despues = {};
for (const t of Object.keys(cargadas)) { const [e, n] = t.split('.'); despues[t] = await cuenta(copia, e, n); }
const cambiadas = Object.keys(cargadas).filter((t) => despues[t] !== antes[t] && t !== 'public.audit_log');
ok('ninguna tabla con datos cambió de cantidad de filas', cambiadas.length === 0, cambiadas.map((t) => `${t}: ${antes[t]} → ${despues[t]}`).join(' | '));
for (const [t, filasAntes] of Object.entries(fotoAntes)) {
  const ahora = (await q(copia, `select to_jsonb(x) as j from public.${t} x order by to_jsonb(x)->>'id'`)).map((r) => r.j);
  const cambios = [], nuevas = new Set();
  filasAntes.forEach((fa, i) => {
    const fd = ahora.find((x) => String(x.id) === String(fa.id)) ?? ahora[i] ?? {};
    for (const k of Object.keys(fd)) if (!(k in fa)) nuevas.add(k);
    for (const k of Object.keys(fa)) if (JSON.stringify(fa[k]) !== JSON.stringify(fd[k])) cambios.push(`${t}[${fa.id}].${k}: ${JSON.stringify(fa[k])?.slice(0, 40)} → ${JSON.stringify(fd[k])?.slice(0, 40)}`);
  });
  ok(`${t}: todo lo que había quedó igual${nuevas.size ? ' (columnas nuevas: ' + [...nuevas].join(', ') + ')' : ''}`, cambios.length === 0 && ahora.length === filasAntes.length, cambios.slice(0, 6).join(' | '));
}
const auditNuevas = (await q(copia, 'select tabla, accion, descripcion from public.audit_log order by id')).slice(-(despues['public.audit_log'] - antes['public.audit_log']));
if (auditNuevas.length) console.log('     movimientos de auditoría que dejó el pase:', JSON.stringify(auditNuevas));
const lic = (await q(copia, 'select modulos, componentes from public.licencia'))[0];
ok('licencia: los tres componentes', JSON.stringify(lic.componentes) === '["abastecimiento","base","mantenimiento"]', JSON.stringify(lic.componentes));
ok('licencia: Mantenimiento prendido y ningún módulo que tenía se apagó', lic.modulos.mantenimiento === true, JSON.stringify(lic.modulos));
console.log('     módulos:', JSON.stringify(lic.modulos));
const asistente = await q(copia, `select * from public.configuracion_inicial limit 1`).catch(() => null);
console.log('     asistente de configuración inicial:', JSON.stringify(asistente?.[0] ?? 'sin tabla/fila'));
const usuarios = await q(copia, 'select id, email from auth.users');
ok('los usuarios siguen y su perfil también', usuarios.length === (cargadas['auth.users'] ?? 0) && (await cuenta(copia, 'public', 'usuarios_perfil')) === (cargadas['public.usuarios_perfil'] ?? 0));

const nueva = await servidor.crearProyecto({ nombre: 'plantilla-nueva-comparacion', archivos: archivosDeComponentes() });
const dif = comparar(await sacarFoto(nueva.db), await sacarFoto(copia.db)).filter((d) => !/datos_(configuracion|licencia)|carpetas_de_archivos|migraciones_aplicadas/.test(d));
ok('el esquema de la copia queda igual al de una instalación nueva de la plantilla', dif.length === 0, dif.slice(0, 4).join(' | '));

// ---- 4) correcciones nuevas, sobre datos reales ----
const bloq = await q(copia, `select count(*)::int as n from pg_proc where proname in ('usuario_activo','hoy_local')`);
ok('están las funciones nuevas (usuario activo, hoy de la empresa)', bloq[0].n >= 2);
const abierto = await q(copia, `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename in ('contactos','planilla_familias') and 'anon' = any(roles::text[]::name[])`).catch(() => [{ n: -1 }]);
ok('contactos y planilla de familias ya no son legibles sin iniciar sesión', abierto[0].n === 0, JSON.stringify(abierto));
const ventana = await q(copia, `select qual, with_check from pg_policies where tablename = 'retiros' and policyname = 'retiros_update'`);
ok('los retiros solo se editan dentro de las 24 horas', ventana.length === 1 && /created_at/.test(ventana[0].qual) && /24:00:00|24 hours/.test(ventana[0].qual), JSON.stringify(ventana));

// ---- 5) segunda pasada y estado ----
r = await cliente('actualizar', '--ref', copia.ref);
ok('correr el pase otra vez no hace nada (ya estaba al día)', r.codigo === 0 && /ya estaba al día/.test(r.salida), r.salida.slice(-250));
r = await cliente('modulos', '--ref', copia.ref);
ok('"modulos" muestra los seis módulos', r.codigo === 0 && ['Proveedores', 'Comisionistas', 'Envíos con rótulos', 'Depósito', 'Mantenimiento', 'Tareas'].every((n) => r.salida.includes(n)), r.salida.slice(-300));

await servidor.cerrar();
console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO BIEN: el pase sobre los datos reales de Cremac funciona y no pierde nada');
process.exit(fallas ? 1 : 0);
