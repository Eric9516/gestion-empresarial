// Reparte las migraciones que ya existen (supabase/migrations) en una cadena por componente (supabase/componentes/<componente>/).
// No reescribe SQL a mano: cada sentencia se copia tal cual al componente que le toca (ver clasificar.mjs).
// Tres cosas se repiten en cada componente porque "valen para todo lo que exista en ese momento":
//   · las líneas `set …` del principio de cada archivo
//   · `revoke … on all tables/sequences in schema public` (idempotente)
//   · el bucle que agrega la regla "requiere_usuario_activo" a cada tabla (se limita a las tablas de cada componente)
//
// Uso:  node scripts/herramientas/repartir.mjs [--escribir]      (sin --escribir solo muestra el resumen)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMPONENTE } from '../pruebas/esquema/componentes.mjs';
import { ORDEN, clasificar } from './clasificar.mjs';
import { partirSentencias, sinComentariosIniciales } from './sql.mjs';

const RAIZ = join(import.meta.dirname, '..', '..');
export const ENTRADA = join(RAIZ, 'supabase', 'migrations');
export const SALIDA = join(RAIZ, 'supabase', 'componentes');

const esPreambulo = (s) => /^set\s/i.test(sinComentariosIniciales(s));
const esGlobal = (s) => /\bon\s+all\s+(tables|sequences|functions)\s+in\s+schema\s+public\b/i.test(sinComentariosIniciales(s));
const REVOCAR_TODAS = /\bon\s+all\s+tables\s+in\s+schema\s+public\b/i;
const esBucleDeTablas = (s) => /^do\s*\$\$/i.test(sinComentariosIniciales(s)) && /pg_class/.test(s) && /relrowsecurity/.test(s);

function limitarBucleAlComponente(s, componente) {
  const tablas = Object.keys(COMPONENTE).filter((t) => COMPONENTE[t] === componente);
  const ancla = 'and c.relrowsecurity';
  if (!s.includes(ancla)) throw new Error('no encuentro dónde limitar el bucle de tablas');
  return s.split(ancla).join(`${ancla}\n      and c.relname = any (array[${tablas.map((t) => `'${t}'`).join(', ')}])`);
}

// "on all tables in schema public" tocaría también las tablas de los otros componentes (por ejemplo, le sacaría a la Base lo que ya dio); se limita a las tablas que este componente creó hasta ese archivo.
function sobreTablasDelComponente(s, componente, creadas) {
  if (creadas.size === 0) return `-- (sin tablas en ${componente} todavía: nada que ajustar)
select 1`;
  return s.replace(REVOCAR_TODAS, () => `on table ${[...creadas].map((t) => `public."${t}"`).join(', ')}`);
}

const RE_CREAR_TABLA = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\."?([a-z_0-9]+)"?/i;
const termina = (s) => (s.trimEnd().endsWith(';') ? s.trimEnd() : s.trimEnd() + ';');

/** Devuelve { archivos: Map<"componente/archivo.sql", texto>, resumen: [{archivo, base, abastecimiento, mantenimiento}] } */
export function repartir(carpetaEntrada = ENTRADA) {
  const archivos = new Map();
  const resumen = [];
  // se clasifica toda la cadena junta: una función definida en un archivo y usada en otro tiene que tener un solo componente
  const entradas = readdirSync(carpetaEntrada).filter((x) => x.endsWith('.sql')).sort()
    .map((nombre) => ({ nombre, sentencias: partirSentencias(readFileSync(join(carpetaEntrada, nombre), 'utf8')).filter((s) => sinComentariosIniciales(s) !== '') }));
  const todas = clasificar(entradas.flatMap((e) => e.sentencias));
  let desde = 0;
  const creadas = Object.fromEntries(ORDEN.map((c) => [c, new Set()])); // tablas que cada componente ya creó
  for (const { nombre, sentencias } of entradas) {
    const clasificadas = todas.slice(desde, desde + sentencias.length);
    desde += sentencias.length;
    for (const c of clasificadas) { const m = RE_CREAR_TABLA.exec(sinComentariosIniciales(c.sentencia)); if (m && !c.funcion) creadas[c.componente].add(m[1]); }
    const preambulo = clasificadas.filter((c) => esPreambulo(c.sentencia)).map((c) => termina(c.sentencia));
    const porComponente = Object.fromEntries(ORDEN.map((c) => [c, []]));
    for (const c of clasificadas) {
      if (esPreambulo(c.sentencia)) continue;
      if (esGlobal(c.sentencia)) {
        for (const comp of ORDEN) porComponente[comp].push(termina(REVOCAR_TODAS.test(c.sentencia) ? sobreTablasDelComponente(c.sentencia, comp, creadas[comp]) : c.sentencia));
        continue;
      }
      if (esBucleDeTablas(c.sentencia)) { for (const comp of ORDEN) porComponente[comp].push(termina(limitarBucleAlComponente(c.sentencia, comp))); continue; }
      porComponente[c.componente].push(termina(c.sentencia));
    }
    const fila = { archivo: nombre };
    for (const comp of ORDEN) {
      const propias = clasificadas.filter((c) => !esPreambulo(c.sentencia) && !esGlobal(c.sentencia) && !esBucleDeTablas(c.sentencia) && c.componente === comp).length;
      fila[comp] = propias;
      if (porComponente[comp].length === 0) continue;
      const cabecera = `-- Parte "${comp}" de supabase/migrations/${nombre} (generado por scripts/herramientas/repartir.mjs).\n-- Se aplica después de la parte de los componentes anteriores (base → abastecimiento → mantenimiento).\n`;
      archivos.set(`${comp}/${nombre}`, `${cabecera}\n${[...new Set(preambulo)].join('\n')}${preambulo.length ? '\n\n' : ''}${porComponente[comp].join('\n\n')}\n`);
    }
    resumen.push(fila);
  }
  return { archivos, resumen };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { archivos, resumen } = repartir();
  for (const f of resumen) console.log(f.archivo.padEnd(62), `base ${String(f.base).padStart(3)} · abastecimiento ${String(f.abastecimiento).padStart(3)} · mantenimiento ${String(f.mantenimiento).padStart(3)}`);
  if (process.argv.includes('--escribir')) {
    rmSync(SALIDA, { recursive: true, force: true });
    for (const [ruta, texto] of archivos) {
      mkdirSync(join(SALIDA, ruta, '..'), { recursive: true });
      writeFileSync(join(SALIDA, ruta), texto);
    }
    console.log(`\nEscribí ${archivos.size} archivos en supabase/componentes/`);
  } else console.log('\n(sin --escribir no se guardó nada)');
}
