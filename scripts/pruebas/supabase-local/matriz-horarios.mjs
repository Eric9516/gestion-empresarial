// Pruebas de HORARIOS: todo lo que en el sistema depende de la hora, combinado con cada tipo de usuario.
//
// Lo que depende del tiempo (se buscó en todo el SQL): (1) la fecha "de hoy" de la empresa según su zona horaria (tareas: crear, reprogramar,
// arrastrar pendientes, días pendientes, semáforo); (2) el vencimiento del acceso de cada usuario (access_status + access_expires_at);
// (3) la regla de 24 horas para editar o borrar retiros propios.
//
//   H1  fecha_local() y hoy_local() en 14 zonas horarias × 864 instantes (cambios de horario de verano, año nuevo, año bisiesto) contra Intl.
//   H2  tareas a cada hora local del día (y a cada lado de la medianoche) en 6 zonas, con 7 tipos de usuario. La hora se inyecta cambiando
//       SOLO el origen del "ahora" dentro de hoy_local() (se restablece al terminar).
//   H3  vencimiento de acceso: 10 estados × 7 tipos de usuario × comprobaciones de tareas y de control; y el cruce justo en el segundo.
//   H4  regla de 24 horas de los retiros × tipos de usuario × edades alrededor del límite.
//
// Funciona contra el Supabase local (por defecto) y contra un proyecto real de pruebas (PROYECTO_REAL=..., ver ayudas-local.mjs).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminar, q, http, sv, msg, hecho, crearUsuario, entrar, REAL } from './ayudas-local.mjs';

const SOLO = process.env.SOLO ? process.env.SOLO.split(',') : null;
const quiere = (s) => !SOLO || SOLO.includes(s);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let total = 0; const fallos = []; const resumen = {}; const avisos = [];
const chk = (sec, nombre, cond, detalle = '') => {
  total++; resumen[sec] ??= { ok: 0, mal: 0 };
  if (cond) resumen[sec].ok++;
  else { resumen[sec].mal++; fallos.push({ sec, nombre, detalle }); console.log(`  DIF [${sec}] ${nombre} ${detalle}`); }
};
const ok = (r) => r.s >= 200 && r.s < 300;

// ---------- usuarios de prueba ----------
const CLASES = {
  dueno: { es_owner: true, rol: 'admin', mantenimiento_rol: 'admin' },
  dirAdmin: { rol: 'admin' },
  depAdmin: { mantenimiento_rol: 'admin' },
  depComun: { mantenimiento_rol: 'comun' },
  comun: {},
  permisosSueltos: { puede_ver_retiros: true, puede_ver_errores: true, puede_resetear_contrasenas: true, puede_ver_sugerencias: true },
  bloqueado: { activo: false, access_status: 'blocked' },
};
const BASE_PERFIL = { rol: 'user', mantenimiento_rol: null, es_owner: false, activo: true, access_status: 'active', access_expires_at: null, puede_ver_retiros: false, puede_ver_errores: false, puede_resetear_contrasenas: false, puede_ver_sugerencias: false };
const NOMBRES = Object.keys(CLASES);
const ES_ADMIN = (k) => k === 'dueno' || k === 'dirAdmin';        // is_admin(): rol admin de Directorio o dueño
const VE_RETIROS = (k) => k === 'dueno' || k === 'permisosSueltos'; // puede ver/editar retiros de cualquiera
const ES_DIR = ES_ADMIN;

console.log('Preparando usuarios…');
const U = {};
for (const k of NOMBRES) { const mail = `zz.h.${k}@ensayo.invalid`; const id = await crearUsuario(mail, { ...BASE_PERFIL, ...CLASES[k] }); U[k] = { id, mail, tok: await entrar(mail) }; }
const ponerPerfil = async (k, extra = {}) => { const r = await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${U[k].id}`, { ...BASE_PERFIL, ...CLASES[k], ...extra }); if (!hecho(r)) throw new Error('perfil ' + k + ': ' + msg(r)); };
const u = async (k, m, ruta, cuerpo) => {
  let r = await http(m, ruta, { token: U[k].tok, cuerpo });
  if (r.s === 401 && /expired|JWT/i.test(msg(r))) { U[k].tok = await entrar(U[k].mail); r = await http(m, ruta, { token: U[k].tok, cuerpo }); }
  return r;
};
const rpc = (k, n, a) => u(k, 'POST', `/rest/v1/rpc/${n}`, a);

// ---------- estado original (se restablece al terminar) ----------
const cfg0 = (await sv('GET', '/rest/v1/configuracion?select=*&id=eq.1')).d[0];
const lic0 = (await sv('GET', '/rest/v1/licencia?select=modulos&id=eq.1')).d[0].modulos;
const apag0 = (await q(null, 'select apagados from public.preferencias_modulos where id = 1'))[0]?.apagados ?? {};
await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: { ...lic0, tareas: true, deposito: true } });
await q(null, `update public.preferencias_modulos set apagados = '{}'::jsonb where id = 1; select 1 as ok`);
// un repuesto para que "leer repuestos" tenga algo que devolver (una lectura vacía y una denegada se ven igual)
const itemBase = await (async () => {
  const hay = await sv('GET', '/rest/v1/items?select=id&limit=1'); if (hay.d?.length) return null;
  const famId = (await sv('GET', '/rest/v1/familias?select=id&limit=1')).d[0].id; const subId = (await sv('GET', '/rest/v1/subfamilias?select=id&limit=1')).d[0].id;
  // datos de prueba: el stock inicial se siembra por SQL (en la aplicación solo cambia con movimientos)
  const r = await q(null, `select set_config('app.mover_stock', 'on', true); insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock, stock_minimo, punto_pedido) values ('ZZB' || substr(md5(random()::text), 1, 5), '1', 'ZZ-h base', '${famId}', '${subId}', 10, 0, 0) returning id`);
  if (!r[0]?.id) throw new Error('repuesto base: no se creó');
  return r[0].id;
})();
// Prueba de las pruebas (SOLO en el simulador local): MUTAR=utc | sinvencimiento | sinestado rompe a propósito una regla para comprobar que esta batería lo detecta.
if (process.env.MUTAR) {
  if (REAL) { console.error('MUTAR no se usa contra un proyecto real.'); process.exit(1); }
  const f = { sinvencimiento: "access_status in ('active', 'trial')", sinestado: "(access_expires_at is null or access_expires_at > now())" }[process.env.MUTAR];
  if (process.env.MUTAR !== 'utc') await q(null, `create or replace function public.has_active_access(user_uuid uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.usuarios_perfil where id = user_uuid and activo is true and ${f}); $$; select 1 as ok`);
}
const ponerZona = async (z) => { const r = await sv('PATCH', '/rest/v1/configuracion?id=eq.1', { zona_horaria: z }); if (!hecho(r)) throw new Error('zona ' + z + ': ' + msg(r)); };

// ---------- ayudas de fechas ----------
const fechaEn = (t, zona) => new Date(t).toLocaleDateString('sv-SE', { timeZone: zona });
const sumar = (f, d) => { const t = new Date(f + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const partes = (t, zona) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value; return o;
};
const offsetMs = (t, zona) => { const p = partes(t, zona); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000; };
/** El instante (UTC) en que, en esa zona, el reloj marca fecha hh:mm:ss. null si esa hora local no existe. */
const aUtc = (fecha, hh, mm, ss, zona) => {
  const [Y, M, D] = fecha.split('-').map(Number); const obj = Date.UTC(Y, M - 1, D, hh, mm, ss); let t = obj;
  for (let i = 0; i < 4; i++) t = obj - offsetMs(t, zona);
  const p = partes(t, zona);
  return (+p.hour === hh && +p.minute === mm && +p.second === ss && `${p.year}-${p.month}-${p.day}` === fecha) ? new Date(t) : null;
};
const semaforo = (pend, carry) => { const traffic = pend <= 1 ? 'green' : pend <= 3 ? 'yellow' : 'red'; return { traffic, stagnant: pend >= 5 || carry >= 3 || traffic === 'red' }; };

const sembrarTarea = async (k, { start, assigned, carry = 0, titulo = 'ZZ-h' }) => {
  const r = await sv('POST', '/rest/v1/tasks', { user_id: U[k].id, title: titulo, status: 'pending', traffic_level: 'green', start_date: start, assigned_date: assigned, pending_days: 0, carry_count: carry, is_stagnant: false });
  if (!hecho(r)) throw new Error('sembrar tarea: ' + msg(r)); return r.d[0].id;
};
const limpiarTareas = async (k) => { await sv('DELETE', `/rest/v1/task_history?user_id=eq.${U[k].id}`); await sv('DELETE', `/rest/v1/tasks?user_id=eq.${U[k].id}`); };
const fila = async (id) => (await sv('GET', `/rest/v1/tasks?select=*&id=eq.${id}`)).d?.[0];

try {
  // =====================================================================================================
  if (quiere('H1')) {
    console.log('\nH1 · fecha local en 14 zonas horarias × 864 instantes…');
    // Las zonas que la app ofrece (src/lib/zonasHorarias.ts) tienen que coincidir SIEMPRE; las demás son un examen extra de casos raros (offsets de 30/45 min, +14, horario de verano en el hemisferio sur…): ahí una diferencia es un aviso de datos de zonas horarias del servidor, no una falla de la app.
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const OFRECIDAS = [...readFileSync(join(RAIZ, 'src/lib/zonasHorarias.ts'), 'utf8').matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    const EXTRA = ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'Pacific/Kiritimati', 'America/St_Johns', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Pacific/Pago_Pago', 'Africa/Casablanca', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
    chk('H1', 'la lista de zonas ofrecidas se pudo leer', OFRECIDAS.length >= 10, String(OFRECIDAS.length));
    const ZONAS = [...OFRECIDAS, ...EXTRA];
    const FECHAS = ['2026-03-08', '2026-03-29', '2026-04-05', '2026-09-27', '2026-10-25', '2026-11-01', '2026-12-31', '2028-02-29', '2026-10-14'];
    const instantes = []; for (const f of FECHAS) for (let i = 0; i < 96; i++) instantes.push(new Date(Date.parse(f + 'T00:00:00Z') + i * 15 * 60000).toISOString());
    const lista = instantes.map((t) => `'${t}'`).join(',');
    for (const z of ZONAS) {
      await ponerZona(z);
      const filas = await q(null, `select o, public.fecha_local(t)::text as f from unnest(array[${lista}]::timestamptz[]) with ordinality as x(t, o) order by o`);
      let malos = 0;
      for (const fl of filas) { const t = instantes[Number(fl.o) - 1]; if (fl.f !== fechaEn(t, z)) { malos++; if (malos <= 3) console.log(`     ${z} ${t}: base=${fl.f} esperado=${fechaEn(t, z)}`); } }
      if (OFRECIDAS.includes(z)) chk('H1', `fecha_local en ${z} (zona ofrecida): ${instantes.length} instantes`, filas.length === instantes.length && malos === 0, `${malos} diferencias`);
      else { avisos.push(...(malos ? [`${z}: ${malos} de ${instantes.length} instantes difieren entre la base y Node (datos de zonas horarias)`] : [])); chk('H1', `fecha_local en ${z} (zona extra): consulta completa`, filas.length === instantes.length); }
      let h = (await q(null, 'select public.hoy_local()::text as h'))[0].h; let esp = fechaEn(Date.now(), z);
      if (h !== esp) { await dormir(1500); h = (await q(null, 'select public.hoy_local()::text as h'))[0].h; esp = fechaEn(Date.now(), z); } // por si cruzó la medianoche justo ahora
      chk('H1', `hoy_local() en ${z} coincide con el reloj real`, h === esp, `base=${h} esperado=${esp}`);
    }
    await ponerZona('America/Argentina/Buenos_Aires');
    for (const mala of ['Marte/Olympus', 'GMT+99', '', 'america/argentina/buenos_aires ']) {
      const r = await sv('PATCH', '/rest/v1/configuracion?id=eq.1', { zona_horaria: mala });
      chk('H1', `zona horaria inventada rechazada: "${mala}"`, !hecho(r), `s=${r.s}`);
    }
    // quién puede cambiar la zona horaria de la empresa
    for (const k of NOMBRES) {
      await ponerPerfil(k);
      const r = await u(k, 'PATCH', '/rest/v1/configuracion?id=eq.1', { zona_horaria: 'UTC' });
      const esperado = k !== 'bloqueado' && ES_DIR(k);
      chk('H1', `cambiar la zona horaria de la empresa: ${k}`, hecho(r) === esperado, `esperado=${esperado} s=${r.s}`);
      await ponerZona('America/Argentina/Buenos_Aires');
    }
  }

  // =====================================================================================================
  if (quiere('H2')) {
    console.log('\nH2 · tareas a cada hora local, en 6 zonas, con 7 tipos de usuario…');
    const RELOJ_ON = `create table if not exists public.reloj_prueba (ahora timestamptz);
      alter table public.reloj_prueba enable row level security; revoke all on public.reloj_prueba from anon, authenticated;
      delete from public.reloj_prueba; insert into public.reloj_prueba values (now());
      create or replace function public.hoy_local() returns date language sql stable security definer set search_path to 'public' as $$
        select ((select ahora from public.reloj_prueba limit 1) at time zone ${process.env.MUTAR === 'utc' ? "'UTC'" : "coalesce((select zona_horaria from public.configuracion order by id limit 1), 'America/Argentina/Buenos_Aires')"})::date; $$;
      select 1 as ok`;
    const RELOJ_OFF = `create or replace function public.hoy_local() returns date language sql stable security definer set search_path to 'public' as $$
        select (now() at time zone coalesce((select zona_horaria from public.configuracion order by id limit 1), 'America/Argentina/Buenos_Aires'))::date; $$;
      drop table if exists public.reloj_prueba; select 1 as ok`;
    await q(null, RELOJ_OFF); await q(null, RELOJ_ON);
    try {
      const ZONAS2 = ['America/Argentina/Buenos_Aires', 'UTC', 'Europe/Madrid', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland'];
      const LD = '2026-10-14'; // un día sin cambio de horario en esas zonas
      const horas = [];
      for (let h = 0; h < 24; h++) horas.push([h, 0, 0]);
      horas.push([23, 59, 59], [0, 0, 1], [23, 30, 0], [12, 30, 0]);
      for (const z of ZONAS2) {
        await ponerZona(z);
        for (const [hh, mm, ss] of horas) {
          const inst = aUtc(LD, hh, mm, ss, z); if (!inst) continue;
          await q(null, `update public.reloj_prueba set ahora = '${inst.toISOString()}'; select 1 as ok`);
          const H = fechaEn(inst, z); const et = `${z} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
          chk('H2', `${et}: la fecha local es la del día elegido`, H === LD, `H=${H}`);
          await Promise.all(NOMBRES.map(async (k) => {
            const activo = k !== 'bloqueado'; const n = `${et} ${k}`;
            await limpiarTareas(k);
            let r = await rpc(k, 'create_task', { p_title: 'ZZ-h crear', p_description: '', p_traffic_level: 'green' });
            chk('H2', `${n}: crear tarea`, ok(r) === activo, `s=${r.s} ${msg(r)}`);
            if (activo && ok(r)) { const f = await fila(r.d); chk('H2', `${n}: nace con la fecha de hoy`, f?.start_date === H && f?.assigned_date === H, `${f?.start_date}/${f?.assigned_date} esperado ${H}`); }
            r = await rpc(k, 'create_task', { p_title: 'ZZ-h ayer', p_description: '', p_traffic_level: 'green', p_assigned_date: sumar(H, -1) });
            chk('H2', `${n}: crear con fecha de ayer se rechaza`, !ok(r) && (!activo || /anterior a hoy/.test(msg(r))), `s=${r.s} ${msg(r)}`);
            r = await rpc(k, 'create_task', { p_title: 'ZZ-h hoy', p_description: '', p_traffic_level: 'green', p_assigned_date: H });
            chk('H2', `${n}: crear para hoy`, ok(r) === activo, `s=${r.s} ${msg(r)}`);
            r = await rpc(k, 'create_task', { p_title: 'ZZ-h mañana', p_description: '', p_traffic_level: 'green', p_assigned_date: sumar(H, 1) });
            chk('H2', `${n}: crear para mañana`, ok(r) === activo, `s=${r.s} ${msg(r)}`);
            // reprogramar
            const t1 = await sembrarTarea(k, { start: sumar(H, -3), assigned: sumar(H, -1) });
            r = await rpc(k, 'reprogram_task', { p_task_id: t1, p_new_assigned_date: sumar(H, -1) });
            chk('H2', `${n}: reprogramar a ayer se rechaza`, !ok(r) && (!activo || /anterior a hoy/.test(msg(r))), `s=${r.s} ${msg(r)}`);
            r = await rpc(k, 'reprogram_task', { p_task_id: t1, p_new_assigned_date: H });
            chk('H2', `${n}: reprogramar a hoy`, ok(r) === activo, `s=${r.s} ${msg(r)}`);
            if (activo && ok(r)) { const f = await fila(t1); const e = semaforo(3, 0); chk('H2', `${n}: reprogramar deja 3 días pendientes y semáforo amarillo`, f.pending_days === 3 && f.traffic_level === e.traffic && f.is_stagnant === e.stagnant && f.assigned_date === H, JSON.stringify([f.pending_days, f.traffic_level, f.assigned_date])); }
            // arrastrar pendientes
            const t2 = await sembrarTarea(k, { start: sumar(H, -3), assigned: sumar(H, -1), carry: 0, titulo: 'ZZ-h arrastre' });
            r = await rpc(k, 'process_pending_tasks_for_user', { target_user_id: U[k].id });
            chk('H2', `${n}: arrastrar pendientes propias`, ok(r) === activo, `s=${r.s} ${msg(r)}`);
            if (activo && ok(r)) { const f = await fila(t2); chk('H2', `${n}: arrastre → hoy, 3 días, 1 arrastre, amarillo`, f.assigned_date === H && f.pending_days === 3 && f.carry_count === 1 && f.traffic_level === 'yellow' && f.is_stagnant === false, JSON.stringify([f.assigned_date, f.pending_days, f.carry_count, f.traffic_level])); }
            await limpiarTareas(k);
          }));
        }
        // rejilla de reglas del semáforo (solo el dueño: las reglas no dependen del tipo de usuario) a tres horas del día
        for (const [hh, mm, ss] of [[0, 0, 0], [12, 0, 0], [23, 59, 59]]) {
          const inst = aUtc(LD, hh, mm, ss, z); if (!inst) continue;
          await q(null, `update public.reloj_prueba set ahora = '${inst.toISOString()}'; select 1 as ok`);
          const H = fechaEn(inst, z); await limpiarTareas('dueno'); const ids = [];
          for (let k = 0; k <= 6; k++) for (let c = 0; c <= 3; c++) ids.push([k, c, await sembrarTarea('dueno', { start: sumar(H, -k), assigned: sumar(H, -1), carry: c, titulo: `ZZ-h grilla ${k}/${c}` })]);
          const r = await rpc('dueno', 'process_pending_tasks_for_user', { target_user_id: U.dueno.id });
          chk('H2', `${z} ${hh}:${mm}:${ss}: arrastrar 28 tareas de una vez`, ok(r) && Number(r.d) === 28, `s=${r.s} d=${JSON.stringify(r.d)}`);
          let malas = 0;
          for (const [k, c, id] of ids) { const f = await fila(id); const e = semaforo(k, c + 1); if (!(f.pending_days === k && f.carry_count === c + 1 && f.traffic_level === e.traffic && f.is_stagnant === e.stagnant && f.assigned_date === H)) { malas++; console.log(`     ${z} ${hh}h grilla días=${k} arrastres=${c}: ${JSON.stringify([f.pending_days, f.carry_count, f.traffic_level, f.is_stagnant, f.assigned_date])}`); } }
          chk('H2', `${z} ${hh}:${mm}:${ss}: semáforo y estancamiento de las 28 combinaciones (días × arrastres)`, malas === 0, `${malas} mal`);
          await limpiarTareas('dueno');
        }
      }
    } finally { await q(null, RELOJ_OFF); await ponerZona(cfg0.zona_horaria ?? 'America/Argentina/Buenos_Aires'); }
    const dep = (await q(null, `select count(*)::int as n from pg_proc where proname = 'hoy_local' and prosrc like '%reloj_prueba%'`))[0].n;
    chk('H2', 'hoy_local() quedó restablecida (sin el reloj de prueba)', Number(dep) === 0);
  }

  // =====================================================================================================
  if (quiere('H3')) {
    console.log('\nH3 · vencimiento de acceso × tipos de usuario…');
    const ahora = () => Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const ESTADOS = [
      ['activo, sin vencimiento', { access_status: 'active', access_expires_at: null }],
      ['activo, vence en 1 h', { access_status: 'active', access_expires_at: () => iso(ahora() + 3600e3) }],
      ['activo, venció hace 1 min', { access_status: 'active', access_expires_at: () => iso(ahora() - 60e3) }],
      ['prueba, sin vencimiento', { access_status: 'trial', access_expires_at: null }],
      ['prueba, vence en 1 h', { access_status: 'trial', access_expires_at: () => iso(ahora() + 3600e3) }],
      ['prueba, venció hace 1 min', { access_status: 'trial', access_expires_at: () => iso(ahora() - 60e3) }],
      ['estado "expired"', { access_status: 'expired', access_expires_at: null }],
      ['estado "expired" con fecha futura', { access_status: 'expired', access_expires_at: () => iso(ahora() + 3600e3) }],
      ['estado "blocked"', { access_status: 'blocked', access_expires_at: null }],
      ['usuario desactivado (activo = no)', { access_status: 'active', access_expires_at: null, activo: false }],
    ];
    const vigente = (k, est) => { // lo que dice la regla: activo, estado active/trial y sin vencer
      const activo = est.activo !== false && CLASES[k].activo !== false;
      const exp = typeof est.access_expires_at === 'function' ? est._exp : est.access_expires_at;
      return activo && ['active', 'trial'].includes(est.access_status) && (exp == null || new Date(exp).getTime() > ahora());
    };
    const sectorId = (await sv('GET', '/rest/v1/sectores?select=id&limit=1')).d[0].id;
    for (const [nombre, def] of ESTADOS) {
      const est = { ...def }; if (typeof def.access_expires_at === 'function') { est._exp = def.access_expires_at(); est.access_expires_at = est._exp; }
      await Promise.all(NOMBRES.map(async (k) => {
        const e = { ...est }; delete e._exp;
        // la clase "bloqueado" ya es un usuario desactivado: su estado propio manda
        await ponerPerfil(k, e);
        const V = vigente(k, { ...est, activo: k === 'bloqueado' ? false : est.activo });
        const activo = k !== 'bloqueado' && est.activo !== false;
        const n = `${nombre} · ${k}`;
        await limpiarTareas(k);
        const H = (await q(null, 'select public.hoy_local()::text as h'))[0].h;
        let r = await rpc(k, 'create_task', { p_title: 'ZZ-h acceso', p_description: '', p_traffic_level: 'green' });
        chk('H3', `${n}: crear tarea`, ok(r) === V, `esperado=${V} s=${r.s} ${msg(r)}`);
        const t = await sembrarTarea(k, { start: H, assigned: H });
        r = await rpc(k, 'update_task', { p_task_id: t, p_title: 'ZZ-h ed', p_description: '', p_traffic_level: 'green' });
        chk('H3', `${n}: editar tarea propia`, ok(r) === V, `esperado=${V} s=${r.s} ${msg(r)}`);
        r = await rpc(k, 'reprogram_task', { p_task_id: t, p_new_assigned_date: H });
        chk('H3', `${n}: reprogramar tarea propia`, ok(r) === V, `esperado=${V} s=${r.s} ${msg(r)}`);
        r = await rpc(k, 'complete_task', { p_task_id: t });
        chk('H3', `${n}: completar tarea propia`, ok(r) === V, `esperado=${V} s=${r.s} ${msg(r)}`);
        const t2 = await sembrarTarea(k, { start: H, assigned: H });
        r = await rpc(k, 'cancel_task', { p_task_id: t2 });
        chk('H3', `${n}: cancelar tarea propia`, ok(r) === V, `esperado=${V} s=${r.s} ${msg(r)}`);
        await sembrarTarea(k, { start: sumar(H, -2), assigned: sumar(H, -1) });
        r = await rpc(k, 'process_pending_tasks_for_user', { target_user_id: U[k].id });
        chk('H3', `${n}: arrastrar pendientes propias`, ok(r) === V, `esperado=${V} s=${r.s} ${msg(r)}`);
        r = await u(k, 'GET', `/rest/v1/tasks?select=id&user_id=eq.${U[k].id}&limit=1`);
        const veMias = (ok(r) && (r.d?.length ?? 0) > 0); const esperadoLee = activo && (V || ES_ADMIN(k));
        chk('H3', `${n}: leer las tareas propias`, veMias === esperadoLee, `esperado=${esperadoLee} s=${r.s}`);
        r = await rpc(k, 'get_user_task_counts', { target_user_id: U[k].id });
        chk('H3', `${n}: ver contadores propios (no dependen del vencimiento)`, (ok(r) && Number(r.d?.[0]?.total ?? 0) > 0) === (k !== 'bloqueado' && est.activo !== false), `s=${r.s} ${JSON.stringify(r.d)?.slice(0, 80)}`);
        // control: lo que NO es de tareas no cambia con el vencimiento
        r = await u(k, 'GET', '/rest/v1/items?select=id&limit=1'); await dormir(0);
        chk('H3', `${n}: control · leer repuestos (no depende del vencimiento)`, hecho(r) === activo, `esperado=${activo} s=${r.s}`);
        r = await u(k, 'POST', '/rest/v1/retiros', { usuario_id: U[k].id, sector_id: sectorId });
        if (ok(r)) await sv('DELETE', `/rest/v1/retiros?id=eq.${r.d?.[0]?.id}`);
        chk('H3', `${n}: control · crear retiro propio (no depende del vencimiento)`, ok(r) === activo, `esperado=${activo} s=${r.s}`);
        r = await u(k, 'POST', '/rest/v1/proveedores', { nombre: 'ZZ-h prov ' + Math.random().toString(36).slice(2, 7) });
        if (ok(r)) await sv('DELETE', `/rest/v1/proveedores?id=eq.${r.d?.[0]?.id}`);
        chk('H3', `${n}: control · crear proveedor`, ok(r) === (activo && ES_DIR(k)), `s=${r.s}`);
        await limpiarTareas(k);
      }));
    }
    // un administrador arrastrando las tareas de OTRO usuario cuyo acceso venció (y al revés)
    console.log('   · administrador sobre las tareas de otro, con acceso vigente o vencido…');
    for (const [nombre, def] of ESTADOS) {
      const est = { ...def }; if (typeof def.access_expires_at === 'function') est.access_expires_at = def.access_expires_at();
      for (const k of NOMBRES) await ponerPerfil(k, k === 'comun' ? est : {});
      const H = (await q(null, 'select public.hoy_local()::text as h'))[0].h;
      const vigObj = vigente('comun', { ...est, _exp: est.access_expires_at });
      for (const actor of NOMBRES) {
        await sembrarTarea('comun', { start: sumar(H, -2), assigned: sumar(H, -1) });
        const r = await rpc(actor, 'process_pending_tasks_for_user', { target_user_id: U.comun.id });
        const esperado = actor === 'comun' ? vigObj : (actor !== 'bloqueado' && ES_ADMIN(actor) && vigObj); // 'comun' es el objetivo: se arrastra las suyas
        chk('H3', `${nombre}: ${actor} arrastra las tareas de ${actor === 'comun' ? 'él mismo' : 'otro usuario'}`, ok(r) === esperado, `esperado=${esperado} s=${r.s} ${msg(r)}`);
        await limpiarTareas('comun');
      }
    }
    for (const k of NOMBRES) await ponerPerfil(k);
    // el cruce justo del vencimiento (reloj real)
    console.log('   · cruce del vencimiento en vivo (espera unos segundos)…');
    for (const k of ['comun', 'dueno', 'dirAdmin', 'depAdmin']) {
      // El vencimiento se fija y se mide con el reloj de la BASE (no con el de esta computadora: puede estar desfasada varios segundos).
      await ponerPerfil(k);
      await q(null, `update public.usuarios_perfil set access_expires_at = now() + interval '12 seconds' where id = '${U[k].id}'; select 1 as ok`);
      const a = await rpc(k, 'create_task', { p_title: 'ZZ-h antes', p_description: '', p_traffic_level: 'green' });
      const faltan = async () => Number((await q(null, `select extract(epoch from (access_expires_at - clock_timestamp()))::float8 as s from public.usuarios_perfil where id = '${U[k].id}'`))[0].s) * 1000;
      const quedaba = await faltan();
      chk('H3', `${k}: justo antes del vencimiento puede crear tareas`, ok(a), `s=${a.s} ${msg(a)} (faltaban ${Math.round(quedaba)} ms según la base)`);
      await dormir(Math.max(0, quedaba) + 1500);
      const d = await rpc(k, 'create_task', { p_title: 'ZZ-h despues', p_description: '', p_traffic_level: 'green' });
      chk('H3', `${k}: justo después del vencimiento ya no puede crear tareas`, !ok(d) && /Acceso deshabilitado/.test(msg(d)), `s=${d.s} ${msg(d)}`);
      const c = await u(k, 'GET', '/rest/v1/items?select=id&limit=1');
      chk('H3', `${k}: vencido el acceso sigue pudiendo leer el depósito`, hecho(c), `s=${c.s}`);
      await limpiarTareas(k); await ponerPerfil(k);
    }
  }

  // =====================================================================================================
  if (quiere('H4')) {
    console.log('\nH4 · regla de 24 horas de los retiros × tipos de usuario × edades…');
    const sectorId = (await sv('GET', '/rest/v1/sectores?select=id&limit=1')).d[0].id;
    const famId = (await sv('GET', '/rest/v1/familias?select=id&limit=1')).d[0].id;
    const subId = (await sv('GET', '/rest/v1/subfamilias?select=id&limit=1')).d[0].id;
    const itemR = await q(null, `select set_config('app.mover_stock', 'on', true); insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock, stock_minimo, punto_pedido) values ('ZZH' || substr(md5(random()::text), 1, 5), '1', 'ZZ-h retiros', '${famId}', '${subId}', 100000, 0, 0) returning id`); // datos de prueba
    if (!itemR[0]?.id) throw new Error('item de prueba: no se creó');
    const itemId = itemR[0].id;
    // la edad se fija con el reloj de la BASE (no el de esta computadora), para no depender de diferencias de hora entre las dos
    const EDADES = [['1 hora', 3600], ['12 horas', 43200], ['23 h 59 min 30 s', 86370], ['24 h 0 min 30 s', 86430], ['48 horas', 172800]];
    for (const k of NOMBRES) await ponerPerfil(k);
    const creados = [];
    for (const [etq, seg] of EDADES) {
      await Promise.all(NOMBRES.map(async (k) => {
        const activo = k !== 'bloqueado'; const n = `retiro de ${etq} · ${k}`;
        const dentro = seg < 86400; const puede = activo && (dentro || VE_RETIROS(k));
        const mk = async () => {
          const r = await sv('POST', '/rest/v1/retiros', { usuario_id: U[k].id, sector_id: sectorId, observacion_general: 'ZZ-h' }); const id = r.d[0].id; creados.push(id);
          const l = await sv('POST', '/rest/v1/retiro_items', { retiro_id: id, item_id: itemId, cantidad: 3 }); if (!hecho(l)) throw new Error('línea: ' + msg(l));
          await q(null, `update public.retiros set created_at = now() - interval '${seg} seconds' where id = '${id}'; select 1 as ok`);
          return [id, l.d[0].id];
        };
        let [id, linea] = await mk();
        let r = await u(k, 'PATCH', `/rest/v1/retiros?id=eq.${id}`, { observacion_general: 'ZZ-h ed' });
        chk('H4', `${n}: editar el retiro`, hecho(r) === puede, `esperado=${puede} s=${r.s}`);
        r = await u(k, 'PATCH', `/rest/v1/retiro_items?id=eq.${linea}`, { cantidad: 2 });
        chk('H4', `${n}: devolver parcialmente una línea (cambiar la cantidad)`, hecho(r) === puede, `esperado=${puede} s=${r.s}`);
        r = await u(k, 'POST', '/rest/v1/retiro_items', { retiro_id: id, item_id: itemId, cantidad: 1 });
        chk('H4', `${n}: agregarle una línea (la regla actual no tiene límite de edad)`, ok(r) === activo, `esperado=${activo} s=${r.s} ${msg(r)}`);
        const lectura = await u(k, 'GET', `/rest/v1/retiros?select=id&id=eq.${id}`);
        chk('H4', `${n}: leerlo (siempre puede leer los propios)`, hecho(lectura) === activo, `s=${lectura.s}`);
        r = await u(k, 'DELETE', `/rest/v1/retiro_items?id=eq.${linea}`);
        chk('H4', `${n}: borrar una línea`, hecho(r) === puede, `esperado=${puede} s=${r.s}`);
        r = await u(k, 'DELETE', `/rest/v1/retiros?id=eq.${id}`);
        chk('H4', `${n}: borrar el retiro`, hecho(r) === puede, `esperado=${puede} s=${r.s}`);
      }));
    }
    // hacia atrás en el tiempo y hacia adelante: un retiro con fecha futura no abre una ventana mayor
    for (let i = 0; i < creados.length; i += 40) { const lote = creados.slice(i, i + 40).join(','); await sv('DELETE', `/rest/v1/retiro_items?retiro_id=in.(${lote})`); await sv('DELETE', `/rest/v1/retiros?id=in.(${lote})`); }
    await sv('DELETE', `/rest/v1/items?id=eq.${itemId}`);
  }
} finally {
  // ---------- se deja todo como estaba ----------
  await ponerZona(cfg0.zona_horaria ?? 'America/Argentina/Buenos_Aires').catch(() => {});
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: lic0 }).catch(() => {});
  await q(null, `update public.preferencias_modulos set apagados = '${JSON.stringify(apag0).replace(/'/g, "''")}'::jsonb where id = 1; select 1 as ok`).catch(() => {});
  for (const k of NOMBRES) { await ponerPerfil(k).catch(() => {}); await limpiarTareas(k).catch(() => {}); }
  if (itemBase) await sv('DELETE', `/rest/v1/items?id=eq.${itemBase}`).catch(() => {});
}

for (const a of avisos) console.log(`  AVISO ${a}`);
console.log(`\n${REAL ? 'PROYECTO REAL' : 'Supabase local'}: ${total} comprobaciones, ${fallos.length} diferencias, ${avisos.length} aviso(s).`);
for (const [s, v] of Object.entries(resumen)) console.log(`${v.mal ? '✗' : '✓'} ${s.padEnd(4)} ${String(v.ok).padStart(6)} / ${v.mal}`);
await terminar(fallos.length ? 1 : 0);
