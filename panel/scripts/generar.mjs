// Empaqueta, como código, lo que el panel necesita instalar en los clientes: las migraciones SQL, el código de las
// funciones del servidor y la lista de módulos. Las migraciones salen de supabase/componentes/<componente>/ (se aplican en el orden base, abastecimiento, mantenimiento). Se leen UNA vez (al construir) desde la plantilla: así el panel
// no depende de archivos sueltos en producción y siempre instala exactamente lo que está en el repositorio.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');

const COMPONENTES = ['base', 'abastecimiento', 'mantenimiento'];
const migraciones = COMPONENTES.flatMap(componente => {
  const dir = join(RAIZ, 'supabase/componentes', componente);
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(archivo => {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(archivo)) throw new Error(`Nombre de migración no permitido: ${componente}/${archivo}`);
    const sql = readFileSync(join(dir, archivo), 'utf8');
    return { nombre: `${componente}/${archivo}`, componente, sql, sha256: sha(sql) };
  });
});

const funciones = readdirSync(join(RAIZ, 'supabase/functions'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort().map(slug => {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(slug)) throw new Error(`Nombre de función no permitido: ${slug}`);
  const fuente = readFileSync(join(RAIZ, 'supabase/functions', slug, 'index.ts'), 'utf8');
  return { slug, fuente, sha256: sha(fuente) };
});

const modulos = JSON.parse(readFileSync(join(RAIZ, 'src/lib/modulos.json'), 'utf8')).modulos;
for (const m of modulos) {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(m.id)) throw new Error(`Id de módulo no permitido: ${m.id}`);
}

const version = sha(JSON.stringify({ m: migraciones.map(x => x.sha256), f: funciones.map(x => x.sha256) })).slice(0, 12);

writeFileSync(join(AQUI, '..', 'src', 'server', 'generado.ts'),
  `// ARCHIVO GENERADO por scripts/generar.mjs — no se edita a mano.\n` +
  `export interface Migracion { nombre: string; componente: string; sql: string; sha256: string }\n` +
  `export interface Funcion { slug: string; fuente: string; sha256: string }\n` +
  `export interface Modulo { id: string; nombre: string; componente: string; descripcion: string; requiere: string[]; bloquea: string }\n` +
  `export const VERSION_PLANTILLA = ${JSON.stringify(version)};\n` +
  `export const MIGRACIONES: Migracion[] = ${JSON.stringify(migraciones)};\n` +
  `export const FUNCIONES: Funcion[] = ${JSON.stringify(funciones)};\n` +
  `export const MODULOS: Modulo[] = ${JSON.stringify(modulos)};\n`);
console.log(`Generado: ${migraciones.length} migraciones, ${funciones.length} funciones, ${modulos.length} módulos. Versión ${version}.`);
