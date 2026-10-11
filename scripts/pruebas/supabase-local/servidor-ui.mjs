// Levanta el Supabase local con TRES clientes de ejemplo (solo Tareas, Plan 1 y Plan 2) y con datos, para probar la app en el navegador.
// Escribe .env.ui-<cliente> en la raíz del proyecto (para `vite --mode ui-<cliente>`) y se queda corriendo hasta que se lo corta.
//
//   node scripts/pruebas/supabase-local/servidor-ui.mjs [puerto]
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archivosDeComponentes, publicarFunciones, RAIZ } from './preparar.mjs';
import { iniciarServidor } from './servidor.mjs';

const puerto = Number(process.argv[2] ?? 54399);
const servidor = await iniciarServidor({ puerto });
const CLAVE = 'Prueba-UI-9!zz';
const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

const CLIENTES = {
  tareas: { ref: 'aaaaaaaaaaaaaaaaaaaa', comps: ['base'], modulos: ['tareas'], nombre: 'Cliente Solo Tareas' },
  plan1: { ref: 'bbbbbbbbbbbbbbbbbbbb', comps: ['base', 'abastecimiento'], modulos: ['proveedores', 'comisionistas', 'envios', 'deposito', 'tareas'], nombre: 'Cliente Plan 1' },
  plan2: { ref: 'cccccccccccccccccccc', comps: ['base', 'abastecimiento', 'mantenimiento'], modulos: ['proveedores', 'comisionistas', 'envios', 'deposito', 'mantenimiento', 'tareas'], nombre: 'Cliente Plan 2' },
};
const TODOS = ['proveedores', 'comisionistas', 'envios', 'deposito', 'mantenimiento', 'tareas'];

for (const [clave, c] of Object.entries(CLIENTES)) {
  const p = await servidor.crearProyecto({ ref: c.ref, nombre: clave, archivos: archivosDeComponentes(c.comps), secretoJwt: `secreto-fijo-${clave}-para-pruebas-de-pantalla` });
  publicarFunciones(p); p.secretos.set('PROJECT_SECRET_KEY', p.claveServicio);
  const url = servidor.urlDe(p);
  const sv = async (metodo, ruta, cuerpo, prefer = 'return=representation') => { const r = await fetch(url + ruta, { method: metodo, headers: { apikey: p.claveServicio, Authorization: `Bearer ${p.claveServicio}`, 'Content-Type': 'application/json', Prefer: prefer }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${metodo} ${ruta}: ${t}`); return t ? JSON.parse(t) : null; };
  // licencia como la deja el instalador
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: Object.fromEntries(TODOS.map((m) => [m, c.modulos.includes(m)])) });
  await sv('PATCH', '/rest/v1/configuracion?id=eq.1', { empresa_nombre: c.nombre, inicial_cerrada_at: new Date().toISOString() });
  // usuarios
  const crear = async (email, extra) => {
    const u = await sv('POST', '/auth/v1/admin/users', { email, password: CLAVE, email_confirm: true, user_metadata: { full_name: email.split('@')[0] } });
    await sv('POST', '/rest/v1/usuarios_perfil?on_conflict=id', { id: u.id, email, nombre: email.split('@')[0], apellido: 'Prueba', rol: 'user', activo: true, ...extra }, 'resolution=merge-duplicates,return=representation');
    return u.id;
  };
  const dueno = await crear(`dueno@${clave}.test`, { es_owner: true, rol: 'admin', mantenimiento_rol: c.comps.includes('abastecimiento') ? 'admin' : null });
  await crear(`comun@${clave}.test`, { rol: 'user', mantenimiento_rol: c.comps.includes('abastecimiento') ? 'comun' : null });
  // datos
  if (c.comps.includes('abastecimiento')) {
    const fam = (await sv('POST', '/rest/v1/familias', { codigo: 'AA', nombre: 'Familia de ejemplo' }))[0].id;
    const sub = (await sv('POST', '/rest/v1/subfamilias', { familia_id: fam, codigo: 'AA', nombre: 'Subfamilia de ejemplo' }))[0].id;
    const prov = (await sv('POST', '/rest/v1/proveedores', { nombre: 'Proveedor de ejemplo', rubro: 'Repuestos' }))[0].id;
    await sv('POST', '/rest/v1/contactos', { proveedor_id: prov, nombre: 'Contacto de ejemplo', email: 'contacto@ejemplo.test' });
    await sv('POST', '/rest/v1/comisionistas', { nombre: 'Comisionista de ejemplo' });
    const sector = (await sv('POST', '/rest/v1/sectores', { nombre: 'Planta de ejemplo' }))[0].id;
    const item = (await sv('POST', '/rest/v1/items', { codigo: 'AA00001', numero: '1', descripcion: 'Rodamiento de ejemplo', familia_id: fam, subfamilia_id: sub, stock: 25, stock_minimo: 5, punto_pedido: 8 }))[0].id;
    const ret = (await sv('POST', '/rest/v1/retiros', { usuario_id: dueno, sector_id: sector, observacion_general: 'Retiro de ejemplo' }))[0].id;
    await sv('POST', '/rest/v1/retiro_items', { retiro_id: ret, item_id: item, cantidad: 2 });
    await sv('POST', '/rest/v1/rotulos_generados', { proveedor_id: prov, grupo_id: randomUUID(), numero_documento: 'R-0001' });
    if (c.comps.includes('mantenimiento')) {
      await sv('POST', '/rest/v1/equipos', { sector: 'Planta de ejemplo', nombre: 'Prensa de ejemplo' });
      const rep = (await sv('POST', '/rest/v1/reparaciones', { proveedor_id: prov, motivo: 'Reparación de ejemplo', fecha_salida: hoy, responsable_id: dueno }))[0].id;
      await sv('POST', '/rest/v1/reparacion_items', { reparacion_id: rep, item_id: item, cantidad: 1, descuenta_stock: false });
    }
  }
  await sv('POST', '/rest/v1/tasks', { user_id: dueno, title: 'Tarea de ejemplo', status: 'pending', traffic_level: 'green', start_date: hoy, assigned_date: hoy, pending_days: 0, carry_count: 0, is_stagnant: false });
  writeFileSync(join(RAIZ, `.env.ui-${clave}`), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${p.claveAnon}\n`);
  console.log(`${clave}: ${url}  (dueno@${clave}.test / ${CLAVE})  componentes: ${c.comps.join('+')}`);
}
console.log(`\nSupabase local listo en ${servidor.url}. Ctrl+C para cortar.`);
setInterval(() => {}, 1 << 30);
