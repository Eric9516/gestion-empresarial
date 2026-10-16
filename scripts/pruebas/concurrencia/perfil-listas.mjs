// Herramienta de análisis (no es una prueba): muestra el plan de ejecución de la búsqueda de texto en el historial de retiros, para ver dónde se va el tiempo.
//   node scripts/pruebas/concurrencia/perfil-listas.mjs [--retiros 300000]
import { sembrar } from '../escala/sembrar.mjs';
import { iniciarPostgres, instalarEsquema } from './postgres-real.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const RETIROS = arg('retiros', 300_000), ITEMS = 100_000;
const U = '00000000-0000-0000-0000-000000000001';
const servidor = await iniciarPostgres({ puerto: arg('puerto', 55435), conexiones: 10 });
let admin;
try {
  admin = await servidor.pool(1).connect();
  await instalarEsquema(admin);
  await admin.query(`update public.licencia set modulos = '{"deposito":true,"proveedores":true,"comisionistas":true,"envios":true,"mantenimiento":true,"tareas":true}'::jsonb`);
  await sembrar(sql => admin.query(sql), { items: ITEMS, retiros: RETIROS, auditoria: 1000 });
  await admin.query(`insert into public.usuarios_perfil (id, email, nombre, apellido, rol, activo) select id, email, 'Usuario', 'Prueba', 'admin', true from auth.users on conflict (id) do nothing`);
  await admin.query(`update public.usuarios_perfil set es_owner = true, mantenimiento_rol = 'admin' where id = '${U}'`);
  await admin.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false)`);
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const texto of ['zzzz-nada']) {
    for (let i = 0; i < 2; i++) {
      const t = Date.now();
      await admin.query('select * from public.historial_de_retiros($1, $2, null, null, null, null, 50)', [texto, desde]);
      console.log(`"${texto}" (${i + 1}): ${Date.now() - t} ms`);
    }
    await admin.query(`load 'auto_explain'`).catch(() => {});
    const plan = await admin.query(`explain (analyze, buffers, costs off, timing on) select * from public.historial_de_retiros('${texto}', '${desde}', null, null, null, null, 50)`);
    console.log(plan.rows.map(r => r['QUERY PLAN']).join('\n'));
    // el mismo trabajo hecho "a mano" y por partes, para ver cuál es la costosa
    const partes = {
      'solo retiros de la ventana': `select count(*) from public.retiros r where r.created_at >= '${desde}'`,
      'ventana + sector': `select count(*) from public.retiros r left join public.sectores s on s.id = r.sector_id where r.created_at >= '${desde}' and coalesce(s.nombre ilike public.patron_de_busqueda('${texto}'), false)`,
      'ventana + usuario': `select count(*) from public.retiros r where r.created_at >= '${desde}' and exists (select 1 from public.usuarios_perfil u where u.id = r.usuario_id and (coalesce(u.nombre,'') || ' ' || coalesce(u.apellido,'') || ' ' || coalesce(u.email,'')) ilike public.patron_de_busqueda('${texto}'))`,
      'ventana + repuestos': `select count(*) from public.retiros r where r.created_at >= '${desde}' and exists (select 1 from public.retiro_items ri2 join (select x as item_id from public.repuestos_con_palabra('${texto}', 3000) x) m on m.item_id = ri2.item_id where ri2.retiro_id = r.id)`,
    };
    for (const [nombre, sql] of Object.entries(partes)) { const t = Date.now(); await admin.query(sql); console.log(`${nombre.padEnd(30)} ${Date.now() - t} ms`); }
  }
} catch (e) { console.error(e); process.exitCode = 1; }
finally { try { admin?.release(); } catch { /* ya liberada */ } await servidor.apagar(); }
process.exit(process.exitCode ?? 0);
