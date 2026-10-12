// Saca la "foto" del esquema de un proyecto REAL de Supabase de pruebas (solo lectura) y la guarda, o la compara con otra guardada.
// Sirve para comprobar que un cliente instalado por partes (Plan 1 y después ampliado) quedó IDÉNTICO a uno instalado de una vez.
//
//   PROYECTO_REAL=clientes/x.env.local SUPABASE_ACCESS_TOKEN=sbp_... node foto-real.mjs guardar foto.json
//   PROYECTO_REAL=clientes/y.env.local SUPABASE_ACCESS_TOKEN=sbp_... node foto-real.mjs comparar foto.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparar, sacarFoto } from '../esquema/catalogo.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [modo, archivo] = process.argv.slice(2);
if (!['guardar', 'comparar'].includes(modo) || !archivo || !process.env.PROYECTO_REAL || !process.env.SUPABASE_ACCESS_TOKEN) {
  console.error('Uso: PROYECTO_REAL=clientes/x.env.local SUPABASE_ACCESS_TOKEN=... node foto-real.mjs guardar|comparar archivo.json'); process.exit(1);
}
const ref = readFileSync(join(RAIZ, process.env.PROYECTO_REAL), 'utf8').match(/^SUPABASE_PROJECT_REF=(.+)$/m)?.[1]?.trim();
const db = {
  async query(sql) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    if (!r.ok) throw new Error(`SQL real falló (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return { rows: await r.json() };
  },
};
const foto = await sacarFoto(db);
const piezas = Object.values(foto).reduce((n, s) => n + Object.keys(s).length, 0);
if (modo === 'guardar') { writeFileSync(archivo, JSON.stringify(foto)); console.log(`Foto guardada: ${piezas} piezas en ${Object.keys(foto).length} secciones.`); process.exit(0); }
const dif = comparar(JSON.parse(readFileSync(archivo, 'utf8')), foto);
console.log(dif.length ? `${dif.length} diferencia(s):\n  ${dif.slice(0, 40).join('\n  ')}` : `IDÉNTICO: ${piezas} piezas iguales.`);
process.exit(dif.length ? 1 : 0);
