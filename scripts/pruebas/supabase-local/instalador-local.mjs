// Prueba de punta a punta del instalador REAL (scripts/cliente.mjs) contra el Supabase local: crea clientes, amplía componentes,
// cambia módulos, adopta una instalación que ya existía y comprueba, en la base de cada cliente, que quedó exactamente lo contratado.
//
//   node scripts/pruebas/supabase-local/instalador-local.mjs        (o:  pnpm pruebas:instalador)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { comparar, sacarFoto } from '../esquema/catalogo.mjs';
import { archivosDeComponentes, entornoParaHijos, RAIZ } from './preparar.mjs';
import { iniciarServidor } from './servidor.mjs';

const servidor = await iniciarServidor();
const env = entornoParaHijos(servidor);
let fallas = 0;
const ok = (nombre, cond, detalle = '') => { if (!cond) fallas++; console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${!cond && detalle ? '  → ' + String(detalle).slice(0, 300) : ''}`); };
const archivosCreados = [];

const cliente = (...args) => cliente2(env, ...args);
function cliente2(entorno, ...args) {
  return new Promise((resolve) => {
    const hijo = spawn(process.execPath, [join(RAIZ, 'scripts', 'cliente.mjs'), ...args], { cwd: RAIZ, env: entorno });
    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; }); hijo.stderr.on('data', (d) => { salida += d; });
    hijo.on('exit', (codigo) => resolve({ codigo, salida }));
  });
}
const proyectoPorNombre = (nombre) => [...servidor.proyectos.values()].find((p) => p.nombre === nombre);
const q = async (p, sql) => (await p.serializar(() => p.db.query(sql))).rows;
const tablas = async (p) => (await q(p, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname);
const licencia = async (p) => (await q(p, 'select modulos, componentes from public.licencia'))[0];
const registro = async (p) => (await q(p, 'select nombre from public.migraciones_aplicadas order by nombre')).map((r) => r.nombre);

const TABLAS_BASE = ['audit_log', 'configuracion', 'error_logs', 'licencia', 'migraciones_aplicadas', 'preferencias_modulos', 'sugerencias', 'task_history', 'tasks', 'usuarios_perfil'];

// ---- 1) un cliente que solo contrata Tareas ----
let r = await cliente('nuevo', '--nombre', 'Local Solo Tareas', '--email', 'dueno@solotareas.com', '--modulos', 'tareas');
archivosCreados.push('clientes/local-solo-tareas.env.local');
ok('nuevo --modulos tareas termina bien', r.codigo === 0 && /Listo: Local Solo Tareas/.test(r.salida), r.salida.slice(-300));
let A = proyectoPorNombre('local-solo-tareas');
ok('el proyecto existe y tiene solo las tablas de la Base', JSON.stringify(await tablas(A)) === JSON.stringify([...TABLAS_BASE, 'preferencias_modulos'].filter((v, i, a) => a.indexOf(v) === i).sort()), (await tablas(A)).join(','));
let lic = await licencia(A);
ok('la licencia dice: solo Tareas activo y componente Base', lic.modulos.tareas === true && Object.entries(lic.modulos).filter(([k, v]) => v && k !== 'tareas').length === 0 && JSON.stringify(lic.componentes) === '["base"]', JSON.stringify(lic));
ok('no hay carpetas de archivos (son de Abastecimiento y Mantenimiento)', (await q(A, 'select id from storage.buckets')).length === 0);
ok('el registro anota solo migraciones de la Base', (await registro(A)).every((n) => n.startsWith('base/')) && (await registro(A)).length > 0);
// Regresión (se vio contra Supabase real): una tabla nueva hereda permisos para "anon" y "authenticated"; la del registro la crea el instalador, no una migración.
ok('el registro de migraciones no tiene permisos para anon ni authenticated', (await q(A, `select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'migraciones_aplicadas' and grantee in ('anon', 'authenticated')`))[0].n === 0);
ok('quedó el primer dueño y el nombre de la empresa', (await q(A, `select es_owner from public.usuarios_perfil where email = 'dueno@solotareas.com'`))[0]?.es_owner === true && (await q(A, 'select empresa_nombre from public.configuracion'))[0].empresa_nombre === 'Local Solo Tareas');
ok('las tres funciones del servidor quedaron publicadas con su secreto', ['create-user', 'delete-user', 'reset-password'].every((f) => A.funciones.has(f)) && A.secretos.get('PROJECT_SECRET_KEY') === A.claveServicio);
const envCliente = existsSync(join(RAIZ, 'clientes/local-solo-tareas.env.local')) ? readFileSync(join(RAIZ, 'clientes/local-solo-tareas.env.local'), 'utf8') : '';
ok('el archivo privado del cliente tiene las claves y la contraseña inicial', /SUPABASE_SECRET_KEY=/.test(envCliente) && /PRIMER_DUENO_CLAVE_INICIAL=/.test(envCliente) && /VITE_SUPABASE_ANON_KEY=/.test(envCliente));

// ---- 2) lo que el instalador se niega a hacer ----
r = await cliente('nuevo', '--nombre', 'Sin Modulos', '--email', 'a@b.com');
ok('nuevo sin --modulos se rechaza', r.codigo !== 0 && /Falta --modulos/.test(r.salida));
r = await cliente('nuevo', '--nombre', 'Mal Modulo', '--email', 'a@b.com', '--modulos', 'inventado');
ok('un módulo inexistente se rechaza', r.codigo !== 0 && /Módulo desconocido/.test(r.salida));
r = await cliente('nuevo', '--nombre', 'Dependencia', '--email', 'a@b.com', '--modulos', 'envios');
ok('"envios" sin "proveedores" se rechaza', r.codigo !== 0 && /necesita "proveedores"/.test(r.salida));
ok('...y no crea ningún proyecto', !proyectoPorNombre('sin-modulos') && !proyectoPorNombre('mal-modulo') && !proyectoPorNombre('dependencia'));
r = await cliente('modulos', '--ref', A.ref, '--activar', 'proveedores', '--confirmo');
ok('activar un módulo de un componente no instalado se rechaza', r.codigo !== 0 && /no está instalado/.test(r.salida) && /componente/.test(r.salida), r.salida.slice(-200));
r = await cliente('componente', '--ref', A.ref, '--agregar', 'mantenimiento', '--confirmo');
ok('instalar Mantenimiento sin Abastecimiento se rechaza', r.codigo !== 0 && /primero hace falta: abastecimiento/.test(r.salida), r.salida.slice(-200));
r = await cliente('componente', '--ref', A.ref, '--agregar', 'base', '--confirmo');
ok('"base" no se puede agregar', r.codigo !== 0 && /desconocido/.test(r.salida), r.salida.slice(-150));

// ---- 3) ampliar a Abastecimiento ----
r = await cliente('componente', '--ref', A.ref, '--agregar', 'abastecimiento');
ok('sin --confirmo solo simula (no instala nada)', r.codigo === 0 && /Simulación/.test(r.salida) && !(await tablas(A)).includes('proveedores'), r.salida.slice(-150));
r = await cliente('componente', '--ref', A.ref, '--agregar', 'abastecimiento', '--confirmo');
ok('instalar Abastecimiento', r.codigo === 0 && /Componente instalado/.test(r.salida), r.salida.slice(-250));
ok('aparecen las tablas de Abastecimiento y siguen las de la Base', (await tablas(A)).includes('proveedores') && (await tablas(A)).includes('items') && (await tablas(A)).includes('tasks') && (await tablas(A)).includes('reparaciones') && !(await tablas(A)).includes('equipos'));
lic = await licencia(A);
ok('la licencia anota Abastecimiento y los módulos nuevos siguen APAGADOS', JSON.stringify(lic.componentes) === '["abastecimiento","base"]' && lic.modulos.proveedores === false && lic.modulos.deposito === false, JSON.stringify(lic));
r = await cliente('componente', '--ref', A.ref, '--agregar', 'abastecimiento', '--confirmo');
ok('instalarlo de nuevo se rechaza', r.codigo !== 0 && /ya está instalado/.test(r.salida));
r = await cliente('modulos', '--ref', A.ref, '--activar', 'proveedores,deposito', '--confirmo');
ok('ahora sí se pueden activar sus módulos', r.codigo === 0 && /Licencia actualizada/.test(r.salida), r.salida.slice(-200));
lic = await licencia(A);
ok('la licencia quedó con Tareas, Proveedores y Depósito', lic.modulos.tareas && lic.modulos.proveedores && lic.modulos.deposito && !lic.modulos.mantenimiento && !lic.modulos.envios);

// ---- 4) ampliar a Mantenimiento ----
await q(A, `insert into public.proveedores (nombre) values ('Proveedor que ya estaba')`);
r = await cliente('componente', '--ref', A.ref, '--agregar', 'mantenimiento', '--confirmo');
ok('instalar Mantenimiento', r.codigo === 0, r.salida.slice(-250));
ok('aparecen sus tablas (equipos) y los datos que había siguen', (await tablas(A)).includes('equipos') && (await tablas(A)).includes('reparaciones') && (await q(A, 'select count(*)::int as n from public.proveedores'))[0].n === 1);
lic = await licencia(A);
ok('la licencia anota los tres componentes', JSON.stringify(lic.componentes) === '["abastecimiento","base","mantenimiento"]', JSON.stringify(lic.componentes));
r = await cliente('modulos', '--ref', A.ref, '--activar', 'mantenimiento', '--confirmo');
ok('se activa el módulo Mantenimiento', r.codigo === 0, r.salida.slice(-150));
r = await cliente('modulos', '--ref', A.ref, '--desactivar', 'deposito', '--confirmo');
ok('apagar Depósito con Mantenimiento prendido se rechaza', r.codigo !== 0 && /necesita "deposito"/.test(r.salida), r.salida.slice(-200));

// ---- 5) actualizar sin novedades ----
r = await cliente('actualizar', '--ref', A.ref);
ok('actualizar un cliente al día no aplica nada', r.codigo === 0 && /ya estaba al día/.test(r.salida) && /Cliente actualizado/.test(r.salida), r.salida.slice(-250));

// ---- 6) cliente con todo desde el principio: queda igual que el ampliado de a poco ----
r = await cliente('nuevo', '--nombre', 'Local Completo', '--email', 'dueno@completo.com', '--modulos', 'todos');
archivosCreados.push('clientes/local-completo.env.local');
ok('nuevo --modulos todos', r.codigo === 0, r.salida.slice(-250));
const B = proyectoPorNombre('local-completo');
ok('instala los tres componentes', JSON.stringify((await licencia(B)).componentes) === '["abastecimiento","base","mantenimiento"]');
const dif = comparar(await sacarFoto(B.db), await sacarFoto(A.db));
const sinRuido = dif.filter((d) => !/datos_(configuracion|licencia)|carpetas_de_archivos/.test(d));
ok('ampliado de a poco (Tareas → Abastecimiento → Mantenimiento) = instalado completo (mismo esquema)', sinRuido.length === 0, sinRuido.slice(0, 3).join(' | '));

// ---- 7) una instalación que ya existía (el camino de Cremac) ----
const base0 = archivosDeComponentes().filter((f) => /20260101000000_esquema_base/.test(f));
const cremac = await servidor.crearProyecto({ nombre: 'cremac-simulado', archivos: base0 });
await q(cremac, `insert into public.proveedores (nombre) values ('Dato real de Cremac')`);
r = await cliente('actualizar', '--ref', cremac.ref);
ok('sin --marcar-hasta, el instalador se niega a tocar una base que no instaló', r.codigo !== 0 && /no fue instalado con este (script|sistema)/.test(r.salida), r.salida.slice(-250));
ok('...y no cambió nada', (await tablas(cremac)).length > 20 && !(await tablas(cremac)).includes('migraciones_aplicadas'));
r = await cliente('actualizar', '--ref', cremac.ref, '--marcar-hasta', '20260101000000_esquema_base.sql');
ok('adoptarla con --marcar-hasta', r.codigo === 0 && /Cliente actualizado \(componentes: base, abastecimiento, mantenimiento\)/.test(r.salida), r.salida.slice(-300));
const reg = await registro(cremac);
ok('registró como hechas (sin ejecutar) las de la base inicial de cada componente', ['base', 'abastecimiento', 'mantenimiento'].every((c) => reg.includes(`${c}/20260101000000_esquema_base.sql`)) && /registrada sin ejecutar/.test(r.salida));
ok('sus datos siguen ahí', (await q(cremac, 'select count(*)::int as n from public.proveedores'))[0].n === 1);
const difC = comparar(await sacarFoto(B.db), await sacarFoto(cremac.db)).filter((d) => !/datos_(configuracion|licencia)|carpetas_de_archivos/.test(d));
ok('queda con el mismo esquema que una instalación nueva', difC.length === 0, difC.slice(0, 3).join(' | '));
const licC = await licencia(cremac);
ok('su licencia tiene Mantenimiento prendido (heredó el depósito) y los tres componentes', licC.modulos.mantenimiento === true && licC.componentes.length === 3, JSON.stringify(licC));
r = await cliente('actualizar', '--ref', cremac.ref);
ok('actualizarla otra vez no hace nada', r.codigo === 0 && /ya estaba al día/.test(r.salida));

// ---- 7b) la llave de la cuenta de Supabase (el instalador habla directo con la API, sin la CLI) ----
const sinLlave = { ...env }; delete sinLlave.SUPABASE_ACCESS_TOKEN;
const archivoLlave = join(RAIZ, 'clientes', 'cuenta-supabase.env.local');
if (existsSync(archivoLlave)) {
  console.log('OMITIDA la prueba de la llave faltante: ya existe clientes/cuenta-supabase.env.local (no se toca)');
} else {
  r = await cliente2(sinLlave, 'modulos', '--ref', A.ref);
  ok('sin llave: se corta con instrucciones claras (dónde sacarla y dónde pegarla)', r.codigo !== 0 && /Falta la llave de tu cuenta de Supabase/.test(r.salida) && /dashboard\/account\/tokens/.test(r.salida) && /cuenta-supabase\.env\.local/.test(r.salida), r.salida.slice(-300));
  ok('...y deja preparado el archivo para pegarla (vacío)', existsSync(archivoLlave) && /^SUPABASE_ACCESS_TOKEN=$/m.test(readFileSync(archivoLlave, 'utf8')));
  r = await cliente2(sinLlave, 'modulos', '--ref', A.ref);
  ok('con el archivo vacío sigue pidiendo la llave', r.codigo !== 0 && /Falta la llave/.test(r.salida));
  writeFileSync(archivoLlave, '# prueba\nSUPABASE_ACCESS_TOKEN=sbp_llave_de_prueba_local_00000000\n');
  r = await cliente2(sinLlave, 'modulos', '--ref', A.ref);
  ok('con la llave en el archivo funciona', r.codigo === 0 && /Proveedores/.test(r.salida), r.salida.slice(-200));
  rmSync(archivoLlave, { force: true });
}
r = await cliente2({ ...env, SUPABASE_ACCESS_TOKEN: 'sbp_llave_vencida_000000' }, 'modulos', '--ref', A.ref);
ok('una llave vencida o revocada se explica (y dónde sacar otra)', r.codigo !== 0 && /no sirve/.test(r.salida) && /account\/tokens/.test(r.salida), r.salida.slice(-300));
ok('...y la llave no aparece en lo que se muestra', !r.salida.includes('sbp_llave_vencida_000000'));
r = await cliente2({ ...env, SUPABASE_ACCESS_TOKEN: 'cualquier-cosa' }, 'modulos', '--ref', A.ref);
ok('una llave con formato raro también se explica', r.codigo !== 0 && /account\/tokens/.test(r.salida), r.salida.slice(-300));
r = await cliente('actualizar', '--ref', 'zzzzzzzzzzzzzzzzzzzz');
ok('un proyecto que la llave no ve se explica sin esperar', r.codigo !== 0 && /no ve el proyecto/.test(r.salida), r.salida.slice(-300));

// ---- 8) ver el estado ----
r = await cliente('modulos', '--ref', A.ref);
ok('"modulos" sin cambios muestra el estado de cada uno de los 6 módulos', r.codigo === 0 && ['Proveedores', 'Comisionistas', 'Envíos con rótulos', 'Depósito', 'Mantenimiento', 'Tareas'].every((n) => r.salida.includes(n)), r.salida.slice(-200));
r = await cliente('--ayuda');
ok('la ayuda lista los comandos nuevos', /componente/.test(r.salida) && /mantenimiento/.test(r.salida));

for (const f of archivosCreados) rmSync(join(RAIZ, f), { force: true });
await servidor.cerrar();
console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO BIEN: el instalador hace lo que dice');
process.exit(fallas ? 1 : 0);
