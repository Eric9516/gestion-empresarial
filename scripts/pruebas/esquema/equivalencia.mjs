// Prueba de equivalencia (E1b): la cadena por componentes (supabase/componentes/) tiene que dejar EXACTAMENTE el mismo esquema que
// la cadena original (supabase/migrations/), y cada plan tiene que instalar solo lo suyo.
//
//   node scripts/pruebas/esquema/equivalencia.mjs                  → compara contra la foto guardada
//   node scripts/pruebas/esquema/equivalencia.mjs --regenerar      → vuelve a sacar la foto desde supabase/migrations (solo si cambió a propósito)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { limpiar } from '../../herramientas/clasificar.mjs';
import { aplicar, crearBase } from './base.mjs';
import { comparar, sacarFoto } from './catalogo.mjs';
import { COMPONENTE } from './componentes.mjs';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const MIGRACIONES = join(RAIZ, 'supabase', 'migrations');
const COMPONENTES = join(RAIZ, 'supabase', 'componentes');
const REFERENCIA = join(import.meta.dirname, 'esquema-de-referencia.json');
const ORDEN = ['base', 'abastecimiento', 'mantenimiento'];

// Las migraciones originales se congelaron en una versión; la comparación con la foto usa solo los archivos hasta esa versión.
// Lo que se agregó después (E1c en adelante) vive solo en los componentes y se prueba aparte (esquema.mjs --componentes y la sección final de este archivo).
const ULTIMA_ORIGINAL = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort().at(-1).split('_')[0];
const cadena = (comps, { completa = false } = {}) => comps.flatMap((c) => readdirSync(join(COMPONENTES, c)).filter((f) => f.endsWith('.sql') && (completa || f.split('_')[0] <= ULTIMA_ORIGINAL)).sort().map((f) => join(COMPONENTES, c, f)));

if (process.argv.includes('--regenerar')) {
  const db = await crearBase(readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort());
  const foto = await sacarFoto(db);
  writeFileSync(REFERENCIA, JSON.stringify(foto, null, 1) + '\n');
  console.log('Foto de referencia guardada:', REFERENCIA);
  process.exit(0);
}
if (!existsSync(REFERENCIA)) { console.log('Falta la foto de referencia. Generala con --regenerar.'); process.exit(1); }
const referencia = JSON.parse(readFileSync(REFERENCIA, 'utf8'));

let fallas = 0;
const ok = (n, c, d = '') => { if (!c) fallas++; console.log(`${c ? 'OK   ' : 'FALLA'} ${n}${d ? '  → ' + d : ''}`); };
const palabra = (t) => new RegExp(`(?<![A-Za-z0-9_])(?:public\\.)?"?${t}"?(?![A-Za-z0-9_])`, 'i');

// Ningún objeto instalado puede nombrar algo de un componente que no está instalado.
function fugas(foto, instalados) {
  const ausentes = Object.keys(COMPONENTE).filter((t) => !instalados.includes(COMPONENTE[t]));
  const funcionesAusentes = Object.keys(referencia.funciones).map((k) => k.split('(')[0]).filter((f) => !Object.keys(foto.funciones).some((k) => k.split('(')[0] === f));
  const res = [];
  for (const t of ausentes) if (t in foto.tablas) res.push(`tabla ${t} instalada sin su componente`);
  for (const seccion of ['restricciones', 'indices', 'funciones', 'disparadores', 'reglas']) {
    for (const [k, texto] of Object.entries(foto[seccion])) {
      const limpio = limpiar(texto);
      for (const t of ausentes) if (palabra(t).test(limpio)) res.push(`${seccion} ${k} nombra la tabla ${t}`);
      for (const f of funcionesAusentes) if (new RegExp(`(?<![A-Za-z0-9_])${f}\\s*\\(`, 'i').test(limpio)) res.push(`${seccion} ${k} llama a la función ${f}`);
    }
  }
  return res;
}
const verDif = (d) => d.slice(0, 12).forEach((x) => console.log('      ' + x));

// 1) Los tres componentes juntos = la cadena original
const completa = await crearBase(cadena(ORDEN));
const fotoCompleta = await sacarFoto(completa);
const difCompleta = comparar(referencia, fotoCompleta);
ok(`Base + Abastecimiento + Mantenimiento deja el mismo esquema que las ${readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).length} migraciones originales (${Object.values(referencia).reduce((n, s) => n + Object.keys(s).length, 0)} piezas comparadas)`, difCompleta.length === 0, difCompleta.length ? `${difCompleta.length} diferencias` : '');
verDif(difCompleta);
ok('instalación completa: ninguna fuga (todo lo instalado nombra solo lo instalado)', fugas(fotoCompleta, ORDEN).length === 0, fugas(fotoCompleta, ORDEN).slice(0, 3).join('; '));

// 2) Plan sin Mantenimiento: no hay ni una pieza de Mantenimiento
const sinMant = await crearBase(cadena(['base', 'abastecimiento']));
const fotoSinMant = await sacarFoto(sinMant);
const tablasMant = Object.keys(COMPONENTE).filter((t) => COMPONENTE[t] === 'mantenimiento');
ok('Base + Abastecimiento: ninguna tabla de Mantenimiento', tablasMant.every((t) => !(t in fotoSinMant.tablas)));
ok('Base + Abastecimiento: tiene todas las tablas de Base y Abastecimiento', Object.keys(COMPONENTE).filter((t) => COMPONENTE[t] !== 'mantenimiento' && t in referencia.tablas).every((t) => t in fotoSinMant.tablas));
ok('Base + Abastecimiento: sin carpeta de archivos "documentos" (es de Mantenimiento)', !('documentos' in fotoSinMant.carpetas_de_archivos) && 'items' in fotoSinMant.carpetas_de_archivos && 'rotulos' in fotoSinMant.carpetas_de_archivos);
const f2 = fugas(fotoSinMant, ['base', 'abastecimiento']);
ok('Base + Abastecimiento: ninguna fuga hacia Mantenimiento', f2.length === 0, f2.slice(0, 3).join('; '));
verDif(f2);

// 3) Solo Base
const soloBase = await crearBase(cadena(['base']));
const fotoBase = await sacarFoto(soloBase);
const tablasBase = Object.keys(fotoBase.tablas).filter((t) => fotoBase.tablas[t].startsWith('r '));
ok('Solo Base: únicamente tablas de la Base', tablasBase.every((t) => COMPONENTE[t] === 'base'), tablasBase.filter((t) => COMPONENTE[t] !== 'base').join(', '));
ok('Solo Base: están las 8 tablas de la Base', Object.keys(COMPONENTE).filter((t) => COMPONENTE[t] === 'base' && t in referencia.tablas).every((t) => tablasBase.includes(t)));
ok('Solo Base: sin carpetas de archivos', Object.keys(fotoBase.carpetas_de_archivos).length === 0, Object.keys(fotoBase.carpetas_de_archivos).join(', '));
const f3 = fugas(fotoBase, ['base']);
ok('Solo Base: ninguna fuga hacia Abastecimiento ni Mantenimiento', f3.length === 0, f3.slice(0, 3).join('; '));
verDif(f3);
ok('Solo Base: todas las tablas con RLS y sin permisos para anon', (await soloBase.query(`select 1 from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`)).rows.length === 0
  && (await soloBase.query(`select 1 from information_schema.role_table_grants where grantee='anon' and table_schema='public' and not (table_name='configuracion' and privilege_type='SELECT')`)).rows.length === 0);

// 4) Ampliar: Base + Abastecimiento y después instalar Mantenimiento = plan completo, sin perder datos
await sinMant.exec(`insert into public.proveedores (nombre) values ('Proveedor de prueba')`);
await aplicar(sinMant, cadena(['mantenimiento']));
const fotoAmpliada = await sacarFoto(sinMant);
const difAmpliada = comparar(referencia, fotoAmpliada);
ok('Ampliar con Mantenimiento más tarde deja el mismo esquema que instalar todo junto', difAmpliada.length === 0, difAmpliada.length ? `${difAmpliada.length} diferencias` : '');
verDif(difAmpliada);
ok('Ampliar con Mantenimiento no pierde datos', (await sinMant.query(`select count(*)::int as n from public.proveedores where nombre = 'Proveedor de prueba'`)).rows[0].n === 1);

// 5) Con todo lo nuevo (E1c en adelante): cada plan sigue instalando solo lo suyo, y ampliar da lo mismo que instalar todo junto
const totalCompleto = await sacarFoto(await crearBase(cadena(ORDEN, { completa: true })));
ok('cadena completa (con E1c): ninguna fuga', fugas(totalCompleto, ORDEN).length === 0);
const fotoSinMantNueva = await sacarFoto(await crearBase(cadena(['base', 'abastecimiento'], { completa: true })));
ok('cadena completa, Base + Abastecimiento: ninguna fuga hacia Mantenimiento', fugas(fotoSinMantNueva, ['base', 'abastecimiento']).length === 0, fugas(fotoSinMantNueva, ['base', 'abastecimiento']).slice(0, 3).join('; '));
const fotoBaseNueva = await sacarFoto(await crearBase(cadena(['base'], { completa: true })));
ok('cadena completa, solo Base: ninguna fuga', fugas(fotoBaseNueva, ['base']).length === 0, fugas(fotoBaseNueva, ['base']).slice(0, 3).join('; '));
const ampliada = await crearBase(cadena(['base', 'abastecimiento'], { completa: true }));
await aplicar(ampliada, cadena(['mantenimiento'], { completa: true }));
const difNueva = comparar(totalCompleto, await sacarFoto(ampliada));
ok('cadena completa: ampliar con Mantenimiento más tarde da lo mismo que instalar todo junto', difNueva.length === 0, difNueva.length ? difNueva.length + ' diferencias' : '');
verDif(difNueva);

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO BIEN: los componentes dejan el mismo esquema que la cadena original');
process.exit(fallas ? 1 : 0);
