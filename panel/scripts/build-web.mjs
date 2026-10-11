// Arma la interfaz: un solo archivo JS (sin dependencias de terceros), el HTML y el CSS, en dist/web.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
// PANEL_SALIDA_WEB solo lo usan las pruebas (para no pisar la carpeta de producción mientras otras pruebas la leen).
const SALIDA = process.env.PANEL_SALIDA_WEB ?? join(AQUI, '..', 'dist', 'web');
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });

await build({
  entryPoints: [join(AQUI, '..', 'src', 'web', 'app.ts')],
  outfile: join(SALIDA, 'app.js'),
  bundle: true, minify: true, format: 'esm', target: 'es2022', platform: 'browser',
  sourcemap: false, legalComments: 'none', logLevel: 'warning',
});
for (const f of ['index.html', 'estilos.css']) copyFileSync(join(AQUI, '..', 'src', 'web', f), join(SALIDA, f));
console.log('Interfaz generada en dist/web');
