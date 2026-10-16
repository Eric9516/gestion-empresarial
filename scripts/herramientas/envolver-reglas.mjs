// Genera la migración "reglas_sin_costo_por_fila" de cada componente.
//
// Por qué: una regla de seguridad (RLS) que llama a una función sin más (por ejemplo `using (modulo_activo('deposito'))` o `is_owner()`) hace que Postgres la evalúe
// UNA VEZ POR FILA, y además le impide usar índices para las búsquedas de texto (ILIKE) del usuario: con 100.000 repuestos una búsqueda pasaba de 38 ms a 1.471 ms,
// y crece con la tabla. Envuelta en `(select ...)` se evalúa una sola vez por consulta y los índices vuelven a servir. Es la misma regla, dicha de otra forma.
//
// Cómo: arma la base con las migraciones actuales, lee las reglas tal como las guarda Postgres y escribe un `alter policy` por cada una que lo necesite.
//   node scripts/herramientas/envolver-reglas.mjs [--escribir]      (sin --escribir solo muestra lo que cambiaría)
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearBase } from '../pruebas/esquema/base.mjs';
import { COMPONENTE } from '../pruebas/esquema/componentes.mjs';

const RAIZ = join(import.meta.dirname, '..', '..');
const COMP = join(RAIZ, 'supabase', 'componentes');
const NOMBRE = '20260101001500_reglas_sin_costo_por_fila.sql';
const ESCRIBIR = process.argv.includes('--escribir');

const archivos = ['base', 'abastecimiento', 'mantenimiento'].flatMap(c => readdirSync(join(COMP, c)).filter(f => f.endsWith('.sql') && f < NOMBRE).sort().map(f => join(COMP, c, f)));
const db = await crearBase(archivos);
const { rows } = await db.query(`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname`);

// Funciones de permisos que se llaman sin tocar columnas de la fila: se pueden calcular una sola vez por consulta.
const FUNCIONES = ['modulo_activo', 'is_owner', 'is_directorio_admin', 'is_mantenimiento_admin', 'tiene_acceso_mantenimiento', 'can_view_all_retiros', 'can_ajustar_inventario', 'can_view_errores', 'can_view_sugerencias', 'is_admin', 'has_active_access'];

function envolver(expr) {
  if (expr == null) return null;
  let s = expr;
  // 1) llamadas a funciones de permisos: `f(args)` -> `(select f(args))` (args sin paréntesis anidados, salvo auth.uid())
  const re = new RegExp(`(?<![\\w.]|select )\\b(${FUNCIONES.join('|')})\\(((?:[^()]|auth\\.uid\\(\\))*)\\)`, 'g');
  s = s.replace(re, (m) => `(select ${m})`);
  // 2) auth.uid() suelto (no dentro de otra llamada ni ya envuelto)
  s = s.replace(/(?<![\w(])auth\.uid\(\)/g, '(select auth.uid())');
  return s;
}

const porComponente = { base: [], abastecimiento: [], mantenimiento: [] };
let cambios = 0;
for (const p of rows) {
  const usando = envolver(p.qual), con = envolver(p.with_check);
  if (usando === p.qual && con === p.with_check) continue;
  // las que ya eran "( SELECT usuario_activo() ...)" no se tocan: ya están envueltas
  const comp = COMPONENTE[p.tablename];
  if (!comp) throw new Error('tabla sin componente: ' + p.tablename);
  const partes = [];
  if (usando != null) partes.push(`using (${usando})`);
  if (con != null) partes.push(`with check (${con})`);
  porComponente[comp].push(`alter policy ${JSON.stringify(p.policyname)} on public.${p.tablename}\n  ${partes.join('\n  ')};`);
  cambios++;
}

const ENCABEZADO = `-- Reglas de seguridad que se calculan una vez por consulta y no una vez por fila (generado por scripts/herramientas/envolver-reglas.mjs).
--
-- Una regla escrita como \`using (modulo_activo('deposito'))\` o \`using (is_owner())\` se evaluaba por cada fila que la consulta recorría, y además impedía que
-- Postgres usara los índices de búsqueda de texto de las búsquedas de la app: con 100.000 repuestos, una búsqueda pasaba de 38 ms a 1.471 ms, y crece con la tabla.
-- Escrita como \`(select modulo_activo('deposito'))\` se calcula una sola vez por consulta y los índices vuelven a servir. Es exactamente la misma regla:
-- quién puede ver o hacer qué no cambia (lo comprueban las pruebas de permisos). Lo mismo para auth.uid().
--
-- Regla de oro para las reglas nuevas: toda llamada a una función de permisos o a auth.uid() va envuelta en (select ...).

`;
for (const [comp, sentencias] of Object.entries(porComponente)) {
  const contenido = ENCABEZADO + (sentencias.length ? sentencias.join('\n\n') + '\n' : '-- Este componente no tiene reglas que cambiar.\n');
  console.log(`${comp}: ${sentencias.length} regla(s)`);
  if (ESCRIBIR) writeFileSync(join(COMP, comp, NOMBRE), contenido);
}
console.log(`total: ${cambios} regla(s) ${ESCRIBIR ? 'escritas' : '(use --escribir para generar los archivos)'}`);
