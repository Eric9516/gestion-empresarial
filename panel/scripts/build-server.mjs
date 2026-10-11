// Empaqueta el servidor (con sus dependencias) en UN archivo: dist/panel.mjs.
// En el servidor de producción solo hace falta Node: no se corre "npm install" ahí (así no hay descargas de paquetes en
// la máquina que guarda las llaves). El paquete se arma en tu computadora o en CI, desde el candado de dependencias.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
mkdirSync(join(RAIZ, 'dist'), { recursive: true });
await build({
  entryPoints: [join(RAIZ, 'src', 'principal.ts')],
  outfile: join(RAIZ, 'dist', 'panel.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: false, sourcemap: false, legalComments: 'none', logLevel: 'warning',
  // Las dependencias CommonJS que usan "require" funcionan dentro de un paquete ESM con este puente.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const huella = createHash('sha256').update(readFileSync(join(RAIZ, 'dist', 'panel.mjs'))).digest('hex');
writeFileSync(join(RAIZ, 'dist', 'panel.mjs.sha256'), `${huella}  panel.mjs\n`);
console.log(`Servidor empaquetado: dist/panel.mjs  sha256=${huella}`);
