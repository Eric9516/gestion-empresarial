// Decide a qué componente (base, abastecimiento, mantenimiento) pertenece cada sentencia del SQL existente.
// Regla: una sentencia va con el componente más "alto" de todo lo que nombra (tablas, funciones, buckets de archivos).
// Ejemplo: una función de la Base que escribe en `items` pasa a Abastecimiento; una política sobre `equipos` va a Mantenimiento.
import { COMPONENTE } from '../pruebas/esquema/componentes.mjs';
import { sinComentariosIniciales, sinComillas } from './sql.mjs';

export const ORDEN = ['base', 'abastecimiento', 'mantenimiento'];
const nivel = (c) => ORDEN.indexOf(c);
const mayor = (a, b) => (nivel(a) >= nivel(b) ? a : b);

// Carpetas de archivos (buckets) y su componente. `documentos` es donde irán los manuales de equipos.
export const BUCKET = { items: 'abastecimiento', rotulos: 'abastecimiento', documentos: 'mantenimiento' };

// Funciones que no nombran ninguna tabla pero son de un componente (por lo que hacen). Solo pueden subir de nivel, nunca bajar.
// Los "permisos por módulo" (can_view_all_retiros, is_directorio_admin, …) se quedan en la Base a propósito: son banderas del perfil, no tocan datos (ver docs/COMPONENTES.md, N3).
export const FUNCIONES = {
  items_trg_estado_reposicion: 'abastecimiento',
  items_trg_fotos_pendientes: 'abastecimiento',
  rotulo_disenos_limpiar_predeterminado: 'abastecimiento',
  ajustes_proteger: 'abastecimiento',
  fn_audit_log_ajustes: 'abastecimiento',
  fn_audit_log_reparaciones: 'abastecimiento',
};

// Sentencias que, por el nombre que mencionan, tienen que ir con otro componente para respetar el orden (la clave se agregó en Abastecimiento y se quita en una versión posterior).
export const FORZAR = [{ contiene: 'configuracion_rotulo_diseno_id_fkey', componente: 'abastecimiento' }];

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Saca los comentarios y los textos entre comillas simples (así un nombre dentro de un texto, como 'items' en el historial, no cuenta como tabla).
export function limpiar(sql) {
  let salida = '', i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === '-' && d === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const f = sql.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue; }
    if (c === "'") { i++; while (i < n) { if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } break; } i++; } i++; salida += "''"; continue; }
    salida += c; i++;
  }
  return salida;
}

const RE_FUNCION = /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/i;
export const nombreFuncionDefinida = (s) => RE_FUNCION.exec(sinComentariosIniciales(s))?.[1] ?? null;

export function clasificar(sentencias) {
  const tablas = Object.keys(COMPONENTE);
  const reTabla = new Map(tablas.map((t) => [t, new RegExp(`(?<![A-Za-z0-9_])(?:public\\.)?"?${escapar(t)}"?(?![A-Za-z0-9_])`, 'i')]));
  const limpias = sentencias.map((s) => sinComillas(limpiar(s)));

  // funciones definidas en toda la cadena (cada una puede definirse más de una vez: se reemplaza)
  const funciones = new Map(); // nombre -> componente
  sentencias.forEach((s) => { const f = nombreFuncionDefinida(s); if (f) funciones.set(f, 'base'); });
  const reFun = new Map([...funciones.keys()].map((f) => [f, new RegExp(`(?<![A-Za-z0-9_])(?:public\\.)?${escapar(f)}(?![A-Za-z0-9_])`, 'i')]));

  const tablasDe = (txt) => tablas.filter((t) => reTabla.get(t).test(txt));
  const funcionesDe = (txt) => [...funciones.keys()].filter((f) => reFun.get(f).test(txt));

  // 1) cada función va con lo más alto que toca; se repite hasta que no cambie nada (una función puede llamar a otra)
  const cuerpos = new Map(); // nombre -> [textos limpios]
  sentencias.forEach((s, i) => { const f = nombreFuncionDefinida(s); if (f) { if (!cuerpos.has(f)) cuerpos.set(f, []); cuerpos.get(f).push(limpias[i]); } });
  for (const [f, textos] of cuerpos) {
    let c = 'base';
    for (const t of textos) for (const tb of tablasDe(t)) c = mayor(c, COMPONENTE[tb]);
    funciones.set(f, c);
  }
  for (const [f, comp] of Object.entries(FUNCIONES)) {
    if (!funciones.has(f)) throw new Error('FUNCIONES: la función ' + f + ' no existe en el SQL');
    if (nivel(funciones.get(f)) > nivel(comp)) throw new Error('FUNCIONES: ' + f + ' ya toca algo de ' + funciones.get(f) + ', no puede ir a ' + comp);
    funciones.set(f, comp);
  }
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const [f, textos] of cuerpos) {
      let c = funciones.get(f);
      for (const t of textos) for (const g of funcionesDe(t)) if (g !== f) c = mayor(c, funciones.get(g));
      if (c !== funciones.get(f)) { funciones.set(f, c); cambio = true; }
    }
  }

  // 2) cada sentencia
  return sentencias.map((s, i) => {
    const txt = limpias[i];
    const definida = nombreFuncionDefinida(s);
    const motivos = {}; // nombre -> componente (para el informe)
    let c = 'base';
    if (definida) { c = funciones.get(definida); motivos[`función ${definida}`] = c; }
    else {
      for (const t of tablasDe(txt)) { motivos[`tabla ${t}`] = COMPONENTE[t]; c = mayor(c, COMPONENTE[t]); }
      for (const f of funcionesDe(txt)) { motivos[`función ${f}`] = funciones.get(f); c = mayor(c, funciones.get(f)); }
      // archivos: creación del bucket y reglas de storage.objects que lo nombran
      const crudo = sentencias[i];
      for (const [b, comp] of Object.entries(BUCKET)) {
        if (new RegExp(`'${b}'`).test(crudo) && /storage\./i.test(crudo)) { motivos[`archivos ${b}`] = comp; c = mayor(c, comp); }
      }
    }
    for (const r of FORZAR) if (s.includes(r.contiene)) { motivos['forzada por ' + r.contiene] = r.componente; c = mayor(c, r.componente); }
    return { sentencia: s, componente: c, motivos, funcion: definida };
  });
}
