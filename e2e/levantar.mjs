// Deja lista la app para las pruebas de pantalla: primero el Supabase local con los clientes de ejemplo y, cuando está listo, la app apuntando al Plan 2.
// Lo arranca Playwright (ver playwright.config.ts) y lo corta al terminar. Nada de esto toca un proyecto real.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const hijos = [];
const cerrar = () => { for (const h of hijos) { try { h.kill(); } catch { /* ya estaba cerrado */ } } };
process.on('SIGINT', () => { cerrar(); process.exit(0); });
process.on('SIGTERM', () => { cerrar(); process.exit(0); });
process.on('exit', cerrar);

const servidor = spawn(process.execPath, [join(RAIZ, 'scripts/pruebas/supabase-local/servidor-ui.mjs'), '54399'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'inherit'] });
hijos.push(servidor);
servidor.on('exit', code => { console.error('El Supabase local se cerró con código', code); process.exit(1); });

let arranco = false;
servidor.stdout.on('data', d => {
  const texto = d.toString();
  process.stdout.write(texto);
  if (!arranco && texto.includes('Supabase local listo')) {
    arranco = true;
    // `pnpm exec vite` en Windows necesita shell; se llama a vite directo con node para no depender de eso.
    const vite = spawn(process.execPath, [join(RAIZ, 'node_modules/vite/bin/vite.js'), '--mode', 'ui-plan2', '--port', '3013', '--strictPort'], { cwd: RAIZ, stdio: 'inherit' });
    hijos.push(vite);
    vite.on('exit', code => { console.error('La app se cerró con código', code); process.exit(1); });
  }
});
