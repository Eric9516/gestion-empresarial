// "Todos los planes × todos los tipos de usuario" contra el Supabase local: corre la matriz de permisos con 16 estados de licencia
// (Plan 1, Plan 2, cada módulo apagado por la licencia o por el dueño, solo Tareas, ninguno) en tandas, para que el simulador no se degrade.
// Contra un proyecto real de pruebas no hace falta partirlo: PROYECTO_REAL=... CRUZAR_MODULOS=1 SOLO_CRUZAR=1 node matriz-permisos.mjs
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const TANDAS = ['0-3', '4-7', '8-11', '12-15'];
let fallo = false;
for (const t of TANDAS) {
  console.log(`\n=== Tanda de estados ${t} ===`);
  const r = spawnSync(process.execPath, [join(aqui, 'matriz-permisos.mjs')], { stdio: 'inherit', env: { ...process.env, CRUZAR_MODULOS: '1', SOLO_CRUZAR: '1', ESTADOS: t } });
  if (r.status !== 0) fallo = true;
}
process.exit(fallo ? 1 : 0);
