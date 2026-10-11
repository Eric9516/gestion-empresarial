// Corre la prueba de integración REAL (scripts/pruebas/integracion.mjs) contra el Supabase local:
// arma un proyecto con los tres componentes, las funciones del servidor y un primer dueño, y le pasa el archivo del cliente.
//
//   node scripts/pruebas/supabase-local/integracion-local.mjs        (o:  pnpm pruebas:supabase-local)
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archivosDeComponentes, entornoParaHijos, publicarFunciones, RAIZ } from './preparar.mjs';
import { iniciarServidor } from './servidor.mjs';

const servidor = await iniciarServidor();
const proyecto = await servidor.crearProyecto({ nombre: 'plantilla-local', archivos: archivosDeComponentes() });
publicarFunciones(proyecto);
proyecto.secretos.set('PROJECT_SECRET_KEY', proyecto.claveServicio);
const url = servidor.urlDe(proyecto);

// primer dueño, igual que hace el instalador
const email = 'propietario@instalacion-prueba.com', clave = 'Inicial-Local-9!x';
const cabecera = { apikey: proyecto.claveServicio, Authorization: `Bearer ${proyecto.claveServicio}`, 'Content-Type': 'application/json' };
let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: cabecera, body: JSON.stringify({ email, password: clave, email_confirm: true, user_metadata: { full_name: 'propietario' } }) });
if (!r.ok) throw new Error('No se pudo crear al dueño: ' + await r.text());
r = await fetch(`${url}/rest/v1/rpc/definir_dueno_inicial`, { method: 'POST', headers: cabecera, body: JSON.stringify({ p_email: email }) });
if (!r.ok) throw new Error('No se pudo definir al dueño: ' + await r.text());
await fetch(`${url}/rest/v1/configuracion?id=eq.1`, { method: 'PATCH', headers: cabecera, body: JSON.stringify({ empresa_nombre: 'Empresa local de pruebas' }) });

mkdirSync(join(RAIZ, 'clientes'), { recursive: true });
const archivo = 'clientes/local-pruebas.env.local';
writeFileSync(join(RAIZ, archivo), [
  `SUPABASE_PROJECT_REF=${proyecto.ref}`, `VITE_SUPABASE_URL=${url}`, `VITE_SUPABASE_ANON_KEY=${proyecto.claveAnon}`, `SUPABASE_SECRET_KEY=${proyecto.claveServicio}`,
  `PRIMER_DUENO_EMAIL=${email}`, `PRIMER_DUENO_CLAVE_INICIAL=${clave}`, '',
].join('\n'));

const hijo = spawn(process.execPath, [join(RAIZ, 'scripts', 'pruebas', 'integracion.mjs'), '--cliente', archivo, '--es-un-proyecto-de-pruebas'], { cwd: RAIZ, env: entornoParaHijos(servidor), stdio: 'inherit' });
const codigo = await new Promise((resolve) => hijo.on('exit', resolve));
rmSync(join(RAIZ, archivo), { force: true });
await servidor.cerrar();
process.exit(codigo ?? 1);
