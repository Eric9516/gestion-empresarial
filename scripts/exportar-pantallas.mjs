#!/usr/bin/env node
// Arma una carpeta con SOLO las pantallas de la aplicación (sin base de datos, instalador, panel, pruebas del servidor ni documentación
// del producto), para que otra persona desarrolle pantallas sin llevarse el resto. Ver docs/DESARROLLO-CON-SOCIO.md.
//
//   node scripts/exportar-pantallas.mjs [carpeta-destino] [--reemplazar] [--env-desde archivo.env]
//
// Con --env-desde la copia lleva su propio ".env" (solo la dirección y la clave PÚBLICA de un proyecto de Supabase de pruebas, que se verifica) y
// quien la recibe solo clona el repositorio y escribe "pnpm install" y "pnpm run dev". Con --arranque-automatico, "pnpm install" además deja la app corriendo.
//
// Por defecto crea ../gestion-empresarial-pantallas (al lado del proyecto, FUERA de él). Al terminar escanea que no se haya colado ninguna
// clave o archivo de claves, y deja la carpeta con git iniciado y la rama de trabajo lista.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const reemplazar = args.includes('--reemplazar');
const arranqueAuto = args.includes('--arranque-automatico'); // opcional: que "pnpm install" deje la app corriendo (por defecto no: son dos pasos, install y run dev)
const iEnv = args.indexOf('--env-desde');
const archivoEnv = iEnv >= 0 ? args[iEnv + 1] : null;
if (iEnv >= 0 && (!archivoEnv || archivoEnv.startsWith('--'))) { console.error('✖ Falta el archivo después de --env-desde.'); process.exit(1); }
const destino = resolve(args.find((a, i) => !a.startsWith('--') && i !== iEnv + 1) ?? join(RAIZ, '..', 'gestion-empresarial-pantallas'));
const falla = (m) => { console.error('✖ ' + m); process.exit(1); };

if (destino === RAIZ || destino.startsWith(RAIZ + '\\') || destino.startsWith(RAIZ + '/')) falla('El destino no puede estar dentro del proyecto.');
if (existsSync(destino)) {
  if (!reemplazar) falla(`Ya existe ${destino}. Usá --reemplazar para rehacerla (se borra y se vuelve a crear).`);
  rmSync(destino, { recursive: true, force: true });
}
mkdirSync(destino, { recursive: true });

// ---- 1) lo que se copia (lista cerrada: lo que no está acá, no viaja) ----
const COPIAR = ['src', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'components.json', '.oxlintrc.json', 'pnpm-workspace.yaml', 'vendor'];
for (const p of COPIAR) {
  const origen = join(RAIZ, p);
  if (!existsSync(origen)) falla(`Falta ${p} en el proyecto.`);
  cpSync(origen, join(destino, p), { recursive: true, filter: (f) => !/[\\/](node_modules|dist)([\\/]|$)/.test(f) });
}

// ---- 2) package.json recortado (sin los comandos del instalador, del panel ni de las pruebas del servidor) ----
const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
const limpio = {
  name: 'gestion-empresarial-pantallas', private: true, version: '0.0.0', type: 'module',
  scripts: { ...(arranqueAuto ? { postinstall: 'node arrancar.mjs' } : {}), dev: 'vite', build: 'tsc -b && vite build', lint: 'oxlint', preview: 'vite preview', test: 'vitest run' },
  dependencies: pkg.dependencies,
  devDependencies: Object.fromEntries(Object.entries(pkg.devDependencies).filter(([k]) => k !== '@electric-sql/pglite')),
  packageManager: pkg.packageManager,
};
writeFileSync(join(destino, 'package.json'), JSON.stringify(limpio, null, 2) + '\n');

// ---- 3) archivos propios de la copia ----
const plantillas = join(RAIZ, 'scripts', 'plantillas-pantallas');
cpSync(join(plantillas, 'LEEME.md'), join(destino, 'LEEME.md'));
cpSync(join(plantillas, 'CLAUDE.md'), join(destino, 'CLAUDE.md'));
cpSync(join(plantillas, 'MODULO-MANTENIMIENTO.md'), join(destino, 'MODULO-MANTENIMIENTO.md'));
mkdirSync(join(destino, '.claude'), { recursive: true });
cpSync(join(plantillas, 'claude-settings.json'), join(destino, '.claude', 'settings.json')); // arranca en modo plan: Claude no puede editar nada hasta que se apruebe el plan
writeFileSync(join(destino, '.env.example'), [
  '# Copiá este archivo con el nombre ".env" y completá las dos líneas con los datos que te dio Eric (sin comillas, sin espacios).',
  'VITE_SUPABASE_URL=',
  'VITE_SUPABASE_ANON_KEY=',
  '',
].join('\n'));
writeFileSync(join(destino, '.gitignore'), ['node_modules', 'dist', '*.log', '*.local', ...(archivoEnv ? ['.env.*'] : ['.env', '.env.*']), '!.env.example', 'datos-reales/', '.vscode/*', '.idea', '.DS_Store', ''].join('\n'));

// .env propio de la copia: SOLO las dos variables públicas, y la clave tiene que ser la pública (rol "anon" o "sb_publishable_…"), nunca la de servicio.
if (archivoEnv) {
  const lee = (txt, k) => txt.split('\n').map((l) => l.trim()).find((l) => l.startsWith(k + '='))?.slice(k.length + 1).trim();
  const origenEnv = readFileSync(resolve(archivoEnv), 'utf8');
  const url = lee(origenEnv, 'VITE_SUPABASE_URL'), clave = lee(origenEnv, 'VITE_SUPABASE_ANON_KEY');
  if (!url || !clave || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) falla('El archivo de --env-desde no tiene VITE_SUPABASE_URL (https://<proyecto>.supabase.co) y VITE_SUPABASE_ANON_KEY.');
  if (!clave.startsWith('sb_publishable_')) {
    let rol; try { rol = JSON.parse(Buffer.from(clave.split('.')[1], 'base64url').toString()).role; } catch { /* no es un JWT */ }
    if (rol !== 'anon') falla('La clave no es la pública (anon): no se copia. Una clave de servicio nunca viaja.');
  }
  writeFileSync(join(destino, '.env'), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${clave}\n`);
  if (arranqueAuto) cpSync(join(plantillas, 'arrancar.mjs'), join(destino, 'arrancar.mjs'));
}

// El archivo de versiones se genera para ESTE package.json (así "pnpm install" da siempre lo mismo y no arrastra nada del proyecto completo).
try { execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: destino, stdio: 'pipe', shell: true }); }
catch (e) { falla('No se pudo generar pnpm-lock.yaml: ' + String(e.stderr || e.message).slice(0, 300)); }

// ---- 4) escaneo: nada de claves ni archivos de claves ----
const PATRONES = [
  [/sbp_[A-Za-z0-9_]{20,}/, 'llave sbp_ de Supabase'], [/sb_secret_[A-Za-z0-9_-]{10,}/, 'llave secreta sb_secret_'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'token JWT'], [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'llave privada'],
  [/SUPABASE_SECRET_KEY\s*=\s*\S+/, 'clave de servicio'], [/(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/, 'token de GitHub'],
];
const NOMBRES_PROHIBIDOS = /(^|[\\/])(\.env(\..*)?|.*\.local|credenciales.*|clientes)$/i;
const hallazgos = []; let archivos = 0;
(function recorrer(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name); const rel = relative(destino, p);
    if (e.name === '.git') continue;
    const esElEnvPropio = Boolean(archivoEnv) && rel === '.env'; // ya verificado arriba
    if (NOMBRES_PROHIBIDOS.test(rel) && rel !== '.env.example' && !esElEnvPropio) hallazgos.push(`archivo prohibido: ${rel}`);
    if (e.isDirectory()) { recorrer(p); continue; }
    archivos++;
    if (statSync(p).size > 3_000_000 || /\.(png|jpe?g|webp|ico|woff2?|tgz|gz)$/i.test(e.name)) continue;
    const txt = readFileSync(p, 'utf8');
    if (!esElEnvPropio) for (const [re, nombre] of PATRONES) if (re.test(txt)) hallazgos.push(`${nombre} en ${rel}`);
  }
})(destino);
// lo que no debe estar nunca en la copia
for (const prohibida of ['supabase', 'scripts', 'panel', 'docs', 'servidor-manuales', 'clientes', '.github', ...(archivoEnv ? [] : ['.env'])]) if (existsSync(join(destino, prohibida))) hallazgos.push(`carpeta/archivo que no debe viajar: ${prohibida}`);
if (hallazgos.length) { console.error('✖ La copia NO es segura:\n  ' + hallazgos.join('\n  ')); process.exit(1); }

// ---- 5) git iniciado, con la rama de trabajo ----
const git = (...a) => execFileSync('git', ['-c', 'user.name=Gestion empresarial', '-c', 'user.email=copia@local', ...a], { cwd: destino, stdio: 'pipe' });
git('init', '-b', 'main'); git('add', '-A'); git('commit', '-m', 'Copia inicial de las pantallas');
console.log(`✔ Copia creada en ${destino}\n  ${archivos} archivos, sin claves, git iniciado en la rama "main".`);
