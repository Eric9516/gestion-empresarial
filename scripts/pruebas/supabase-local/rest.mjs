// La parte "PostgREST" del Supabase local: traduce pedidos REST (filtros, relaciones embebidas, altas, cambios, borrados, funciones)
// a SQL y los ejecuta sobre la base REAL con el rol del que llama (anon, authenticated o service_role), igual que hace PostgREST:
// los permisos y las reglas de seguridad por fila (RLS) los aplica PostgreSQL, no este archivo.

export class ErrorRest extends Error {
  constructor(estado, code, message, extra = {}) { super(message); this.estado = estado; this.code = code; this.extra = extra; }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (nombre) => { if (!IDENT.test(nombre)) throw new ErrorRest(400, 'PGRST100', `Nombre inválido: ${nombre}`); return `"${nombre}"`; };

// ---------- esquema (tablas, columnas, claves) ----------
export async function esquemaDe(proyecto) {
  if (proyecto.esquema) return proyecto.esquema;
  const esquema = await proyecto.serializar(async () => {
    const cols = (await proyecto.db.query(`select c.relname as tabla, a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo
      from pg_class c join pg_attribute a on a.attrelid = c.oid
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','p','m') and a.attnum > 0 and not a.attisdropped order by c.relname, a.attnum`)).rows;
    const restr = (await proyecto.db.query(`select c.contype::text as tipo, c.conname, cl.relname as hijo, cf.relname as padre,
        array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by o) as cols_h,
        array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by o) as cols_p
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid left join pg_class cf on cf.oid = c.confrelid
      where cl.relnamespace = 'public'::regnamespace and c.contype in ('p','f')`)).rows;
    const tablas = new Map();
    for (const r of cols) { if (!tablas.has(r.tabla)) tablas.set(r.tabla, { cols: new Map(), pk: [] }); tablas.get(r.tabla).cols.set(r.col, r.tipo); }
    const fks = [];
    for (const r of restr) {
      if (r.tipo === 'p') tablas.get(r.hijo).pk = r.cols_h;
      else fks.push({ nombre: r.conname, hijo: r.hijo, padre: r.padre, colsH: r.cols_h, colsP: r.cols_p });
    }
    return { tablas, fks, funciones: new Map() };
  });
  proyecto.esquema = esquema;
  return esquema;
}

function tabla(esq, nombre) {
  const t = esq.tablas.get(nombre);
  if (!t) throw new ErrorRest(404, '42P01', `relation "public.${nombre}" does not exist`, { hint: null });
  return t;
}
function columna(esq, nombreTabla, col) {
  const t = tabla(esq, nombreTabla);
  const tipo = t.cols.get(col);
  if (!tipo) throw new ErrorRest(400, '42703', `column ${nombreTabla}.${col} does not exist`);
  return tipo;
}

// ---------- ?select= ----------
function partirNivel0(texto) {
  const partes = []; let prof = 0, actual = '', comillas = false;
  for (const c of texto) {
    if (c === '"') comillas = !comillas;
    if (!comillas) { if (c === '(') prof++; if (c === ')') prof--; if (c === ',' && prof === 0) { partes.push(actual); actual = ''; continue; } }
    actual += c;
  }
  if (actual.trim() !== '') partes.push(actual);
  return partes.map((p) => p.trim());
}

export function parsearSelect(texto) {
  const items = [];
  for (const crudo of partirNivel0(texto || '*')) {
    const abre = crudo.indexOf('(');
    if (abre >= 0 && crudo.endsWith(')')) {
      let cabeza = crudo.slice(0, abre), alias = null;
      const m = /^([A-Za-z_]\w*):(?!:)(.+)$/.exec(cabeza); if (m) { alias = m[1]; cabeza = m[2]; }
      const [nombre, ...flags] = cabeza.split('!');
      items.push({ tipo: 'embed', nombre, alias: alias ?? nombre, inner: flags.includes('inner'), hijos: parsearSelect(crudo.slice(abre + 1, -1)) });
    } else if (crudo === '*') items.push({ tipo: 'star' });
    else {
      let resto = crudo, alias = null, cast = null;
      const m = /^([A-Za-z_]\w*):(?!:)(.+)$/.exec(resto); if (m) { alias = m[1]; resto = m[2]; }
      const c = resto.split('::'); resto = c[0]; cast = c[1] ?? null;
      items.push({ tipo: 'col', nombre: resto, alias: alias ?? resto, cast });
    }
  }
  return items;
}

// ---------- filtros ----------
const RESERVADAS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey']);

function partirLista(texto) { return partirNivel0(texto); }

function parsearValorLista(v) {
  const dentro = v.startsWith('(') && v.endsWith(')') ? v.slice(1, -1) : v;
  return partirLista(dentro).map((x) => (x.startsWith('"') && x.endsWith('"') ? x.slice(1, -1).replace(/\\"/g, '"') : x));
}

// nodo: { col, op, val, neg } | { logica: 'and'|'or', items, neg }
function parsearCondicionPunto(texto) {
  const partes = texto.split('.');
  if (partes[0] === 'and' || partes[0] === 'or' || (partes[0] === 'not' && (partes[1] === 'and' || partes[1] === 'or'))) return parsearGrupoTexto(texto);
  const col = partes.shift();
  let neg = false; if (partes[0] === 'not') { neg = true; partes.shift(); }
  const op = partes.shift();
  return { col, op, val: partes.join('.'), neg };
}
function parsearGrupoTexto(texto) {
  let neg = false, t = texto;
  if (t.startsWith('not.')) { neg = true; t = t.slice(4); }
  const logica = t.startsWith('and') ? 'and' : 'or';
  const dentro = t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'));
  return { logica, neg, items: partirLista(dentro).map(parsearCondicionPunto) };
}
function parsearFiltroParam(clave, valor) {
  if (clave === 'and' || clave === 'or' || clave === 'not.and' || clave === 'not.or') return parsearGrupoTexto(`${clave}${valor}`);
  let neg = false; let op = valor; const m = /^not\.(.*)$/.exec(valor); if (m) { neg = true; op = m[1]; }
  const punto = op.indexOf('.');
  return { col: clave, op: op.slice(0, punto), val: op.slice(punto + 1), neg };
}

function sqlCondicion(nodo, a, nombreTabla, esq, params) {
  if (nodo.logica) {
    const partes = nodo.items.map((n) => sqlCondicion(n, a, nombreTabla, esq, params));
    const c = `(${partes.join(nodo.logica === 'and' ? ' and ' : ' or ')})`;
    return nodo.neg ? `not ${c}` : c;
  }
  const tipo = columna(esq, nombreTabla, nodo.col);
  const col = `${a}.${q(nodo.col)}`;
  const p = (v) => { params.push(v); return `$${params.length}`; };
  let c;
  switch (nodo.op) {
    case 'eq': c = `${col} = ${p(nodo.val)}`; break;
    case 'neq': c = `${col} <> ${p(nodo.val)}`; break;
    case 'gt': c = `${col} > ${p(nodo.val)}`; break;
    case 'gte': c = `${col} >= ${p(nodo.val)}`; break;
    case 'lt': c = `${col} < ${p(nodo.val)}`; break;
    case 'lte': c = `${col} <= ${p(nodo.val)}`; break;
    case 'like': c = `${col} like ${p(nodo.val.replaceAll('*', '%'))}`; break;
    case 'ilike': c = `${col} ilike ${p(nodo.val.replaceAll('*', '%'))}`; break;
    case 'in': c = `${col} = any(${p(parsearValorLista(nodo.val))}::text[]::${tipo}[])`; break;
    case 'is': {
      const v = nodo.val.toLowerCase();
      if (!['null', 'true', 'false', 'unknown'].includes(v)) throw new ErrorRest(400, 'PGRST100', `Valor inválido para is: ${nodo.val}`);
      c = `${col} is ${v === 'null' ? 'null' : v}`; break;
    }
    case 'cs': c = `${col} @> ${p(nodo.val)}::${tipo}`; break;
    case 'cd': c = `${col} <@ ${p(nodo.val)}::${tipo}`; break;
    case 'ov': c = `${col} && ${p(nodo.val)}::${tipo}`; break;
    default: throw new ErrorRest(400, 'PGRST100', `Operador no soportado por el Supabase local: ${nodo.op}`);
  }
  return nodo.neg ? `not (${c})` : `(${c})`;
}

function sqlOrden(texto, a, nombreTabla, esq) {
  return partirLista(texto).map((t) => {
    const [col, ...mods] = t.split('.');
    columna(esq, nombreTabla, col);
    let s = `${a}.${q(col)}`;
    s += mods.includes('desc') ? ' desc' : ' asc';
    if (mods.includes('nullsfirst')) s += ' nulls first'; else if (mods.includes('nullslast')) s += ' nulls last';
    return s;
  }).join(', ');
}

// ---------- relaciones embebidas ----------
function relacion(esq, padreTabla, embed) {
  const haciaPadre = esq.fks.find((f) => f.hijo === padreTabla && f.padre === embed);
  if (haciaPadre) return { cardinalidad: 'uno', cond: (e, a) => haciaPadre.colsH.map((c, i) => `${e}.${q(haciaPadre.colsP[i])} = ${a}.${q(c)}`).join(' and ') };
  const haciaHijos = esq.fks.find((f) => f.padre === padreTabla && f.hijo === embed);
  if (haciaHijos) return { cardinalidad: 'muchos', cond: (e, a) => haciaHijos.colsH.map((c, i) => `${e}.${q(c)} = ${a}.${q(haciaHijos.colsP[i])}`).join(' and ') };
  throw new ErrorRest(400, 'PGRST200', `Could not find a relationship between '${padreTabla}' and '${embed}' in the schema cache`);
}

// filtros dirigidos a una relación: "proveedores.eliminado=eq.false", "items.order=..."
function filtrosPara(embed, extra) { return extra.filter((f) => f.embed === embed); }

function jsonDeFila(esq, nombreTabla, a, items, extra, ctx) {
  const partes = [];
  for (const it of items) {
    if (it.tipo === 'star') partes.push(`to_jsonb(${a})`);
    else if (it.tipo === 'col') { columna(esq, nombreTabla, it.nombre); partes.push(`jsonb_build_object('${it.alias}', ${a}.${q(it.nombre)}${it.cast ? `::${it.cast}` : ''})`); }
    else {
      const rel = relacion(esq, nombreTabla, it.nombre);
      const e = `e${++ctx.n}`;
      const propios = filtrosPara(it.nombre, extra);
      const condiciones = [rel.cond(e, a)];
      for (const f of propios.filter((x) => x.nodo)) condiciones.push(sqlCondicion(f.nodo, e, it.nombre, esq, ctx.params));
      const orden = propios.find((x) => x.orden);
      const lim = propios.find((x) => x.limite);
      const subJson = jsonDeFila(esq, it.nombre, e, it.hijos, [], ctx);
      const ordenSql = orden ? ` order by ${sqlOrden(orden.orden, e, it.nombre, esq)}` : '';
      const limSql = lim ? ` limit ${Number(lim.limite) | 0}` : '';
      if (rel.cardinalidad === 'muchos') partes.push(`jsonb_build_object('${it.alias}', coalesce((select jsonb_agg(${subJson}) from (select * from ${q(it.nombre)} ${e} where ${condiciones.join(' and ')}${ordenSql}${limSql}) ${e}), '[]'::jsonb))`);
      else partes.push(`jsonb_build_object('${it.alias}', (select ${subJson} from ${q(it.nombre)} ${e} where ${condiciones.join(' and ')} limit 1))`);
    }
  }
  return partes.length ? `(${partes.join(' || ')})` : `'{}'::jsonb`;
}

// condiciones "!inner": la fila solo está si existe la relación (y cumple los filtros de esa relación)
function condicionesInner(esq, nombreTabla, a, items, extra, ctx) {
  const conds = [];
  for (const it of items.filter((x) => x.tipo === 'embed' && x.inner)) {
    const rel = relacion(esq, nombreTabla, it.nombre);
    const e = `i${++ctx.n}`;
    const c = [rel.cond(e, a)];
    for (const f of filtrosPara(it.nombre, extra).filter((x) => x.nodo)) c.push(sqlCondicion(f.nodo, e, it.nombre, esq, ctx.params));
    conds.push(`exists (select 1 from ${q(it.nombre)} ${e} where ${c.join(' and ')})`);
  }
  return conds;
}

// ---------- pedido ----------
function leerFiltros(query, nombresEmbebidos) {
  const propios = [], extra = [];
  for (const [clave, valor] of query.entries()) {
    if (RESERVADAS.has(clave)) continue;
    const punto = clave.indexOf('.');
    if (punto > 0 && !['not'].includes(clave.slice(0, punto)) && nombresEmbebidos.has(clave.slice(0, punto))) {
      const emb = clave.slice(0, punto), resto = clave.slice(punto + 1);
      if (resto === 'order') extra.push({ embed: emb, orden: valor });
      else if (resto === 'limit') extra.push({ embed: emb, limite: valor });
      else extra.push({ embed: emb, nodo: parsearFiltroParam(resto, valor) });
    } else propios.push(parsearFiltroParam(clave, valor));
  }
  return { propios, extra };
}
function nombresEmbebidosDe(items, set = new Set()) { for (const it of items) if (it.tipo === 'embed') { set.add(it.nombre); nombresEmbebidosDe(it.hijos, set); } return set; }

function preferencias(cabeceras) {
  const p = {}; for (const parte of String(cabeceras.prefer ?? '').split(',')) { const [k, v] = parte.trim().split('='); if (k) p[k] = v ?? true; }
  return p;
}

export function errorDePg(e, rol) {
  if (e instanceof ErrorRest) return { estado: e.estado, cuerpo: { code: e.code, message: e.message, details: e.extra.details ?? null, hint: e.extra.hint ?? null } };
  const code = e.code ?? 'XX000';
  let estado = 400;
  if (code === '42501') estado = rol === 'anon' ? 401 : 403;
  else if (code === '23505' || code === '23503' || code === '40001') estado = 409;
  else if (code === '42P01' || code === '42883') estado = 404;
  return { estado, cuerpo: { code, message: e.message ?? String(e), details: e.detail ?? null, hint: e.hint ?? null } };
}

/**
 * Atiende un pedido a /rest/v1/<ruta>.
 *   auth: { rol, sub, claims }   cuerpo: JSON ya leído (o undefined)
 */
export async function atenderRest(proyecto, { metodo, ruta, query, cabeceras, cuerpo, auth }) {
  const esq = await esquemaDe(proyecto);
  const pref = preferencias(cabeceras);
  const devolver = metodo === 'GET' || metodo === 'HEAD' ? true : pref.return === 'representation';
  const unico = /vnd\.pgrst\.object\+json/.test(String(cabeceras.accept ?? ''));

  const enTx = (fn) => proyecto.serializar(() => proyecto.db.transaction(async (tx) => {
    await tx.exec(`set local role ${auth.rol}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)`, [JSON.stringify(auth.claims ?? {}), auth.sub ?? '', auth.rol]);
    return fn(tx);
  }));

  if (ruta.startsWith('rpc/')) return rpc(proyecto, esq, ruta.slice(4), { metodo, query, cuerpo, enTx });

  const nombre = ruta;
  tabla(esq, nombre);
  const items = parsearSelect(query.get('select') || '*');
  const { propios, extra } = leerFiltros(query, nombresEmbebidosDe(items));
  const ctx = { n: 0, params: [] };

  const respuestaJson = (filas, extraCab = {}) => {
    if (unico) {
      if (filas.length !== 1) return { estado: 406, cabeceras: {}, cuerpo: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${filas.length} rows`, hint: null } };
      return { estado: extraCab.estado ?? 200, cabeceras: extraCab.cabeceras ?? {}, cuerpo: filas[0] };
    }
    return { estado: extraCab.estado ?? 200, cabeceras: extraCab.cabeceras ?? {}, cuerpo: filas };
  };

  if (metodo === 'GET' || metodo === 'HEAD') {
    const where = [...propios.map((n) => sqlCondicion(n, 't0', nombre, esq, ctx.params)), ...condicionesInner(esq, nombre, 't0', items, extra, ctx)];
    const orden = query.get('order') ? ` order by ${sqlOrden(query.get('order'), 't0', nombre, esq)}` : '';
    const limite = query.get('limit') != null ? ` limit ${Number(query.get('limit')) | 0}` : '';
    const desde = query.get('offset') != null ? ` offset ${Number(query.get('offset')) | 0}` : '';
    const sub = `select * from ${q(nombre)} t0${where.length ? ` where ${where.join(' and ')}` : ''}${orden}${limite}${desde}`;
    const nWhere = ctx.params.length;
    const sqlFilas = `select coalesce(jsonb_agg(${jsonDeFila(esq, nombre, 'q0', items, extra, ctx)}), '[]'::jsonb) as r from (${sub}) q0`;
    const paramsFilas = ctx.params.slice();
    const conteo = pref.count === 'exact';
    const sqlConteo = `select count(*)::int as n from ${q(nombre)} t0${where.length ? ` where ${where.join(' and ')}` : ''}`;
    const [filas, total] = await enTx(async (tx) => [
      metodo === 'HEAD' ? [] : (await tx.query(sqlFilas, paramsFilas)).rows[0].r,
      conteo ? (await tx.query(sqlConteo, paramsFilas.slice(0, nWhere))).rows[0].n : null,
    ]);
    const cab = {};
    if (conteo) cab['content-range'] = `${filas.length ? `0-${filas.length - 1}` : '*'}/${total}`;
    if (metodo === 'HEAD') return { estado: 200, cabeceras: cab, cuerpo: undefined };
    return respuestaJson(filas, { cabeceras: cab });
  }

  if (metodo === 'POST') {
    const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    if (!filas.length || filas.some((f) => f == null || typeof f !== 'object' || Array.isArray(f))) throw new ErrorRest(400, 'PGRST102', 'Empty or invalid json');
    const t = tabla(esq, nombre);
    const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
    for (const c of cols) if (!t.cols.has(c)) throw new ErrorRest(400, 'PGRST204', `Could not find the '${c}' column of '${nombre}' in the schema cache`);
    ctx.params.push(JSON.stringify(filas));
    let sql = `insert into ${q(nombre)} (${cols.map(q).join(', ')}) select ${cols.map(q).join(', ')} from jsonb_populate_recordset(null::${q(nombre)}, $1::jsonb)`;
    const resol = pref.resolution;
    if (resol === 'merge-duplicates' || resol === 'ignore-duplicates') {
      const objetivo = (query.get('on_conflict') ? partirLista(query.get('on_conflict')) : t.pk);
      if (resol === 'ignore-duplicates') sql += ` on conflict (${objetivo.map(q).join(', ')}) do nothing`;
      else {
        const sets = cols.filter((c) => !objetivo.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`);
        sql += ` on conflict (${objetivo.map(q).join(', ')}) ${sets.length ? `do update set ${sets.join(', ')}` : 'do nothing'}`;
      }
    }
    if (devolver) sql += ' returning *'; // sin pedir la fila de vuelta (return=minimal) no hace falta poder leerla
    const salida = await enTx(async (tx) => {
      if (!devolver) { await tx.query(sql, ctx.params); return null; }
      return (await tx.query(`with w as (${sql}) select coalesce(jsonb_agg(${jsonDeFila(esq, nombre, 'q0', items, extra, ctx)}), '[]'::jsonb) as r from (select * from w) q0`, ctx.params)).rows[0].r;
    });
    if (salida === null) return { estado: 201, cabeceras: {}, cuerpo: undefined };
    return respuestaJson(salida, { estado: 201 });
  }

  if (metodo === 'PATCH' || metodo === 'DELETE') {
    const t = tabla(esq, nombre);
    let sql;
    if (metodo === 'PATCH') {
      if (cuerpo == null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new ErrorRest(400, 'PGRST102', 'Empty or invalid json');
      const cols = Object.keys(cuerpo);
      for (const c of cols) if (!t.cols.has(c)) throw new ErrorRest(400, 'PGRST204', `Could not find the '${c}' column of '${nombre}' in the schema cache`);
      ctx.params.push(JSON.stringify(cuerpo));
      if (!cols.length) { return { estado: 200, cabeceras: {}, cuerpo: [] }; }
      const where = propios.map((n) => sqlCondicion(n, 't0', nombre, esq, ctx.params));
      sql = `update ${q(nombre)} t0 set ${cols.map((c) => `${q(c)} = r.${q(c)}`).join(', ')} from jsonb_populate_record(null::${q(nombre)}, $1::jsonb) r${where.length ? ` where ${where.join(' and ')}` : ''}${devolver ? ' returning t0.*' : ''}`;
    } else {
      const where = propios.map((n) => sqlCondicion(n, 't0', nombre, esq, ctx.params));
      sql = `delete from ${q(nombre)} t0${where.length ? ` where ${where.join(' and ')}` : ''}${devolver ? ' returning t0.*' : ''}`;
    }
    const salida = await enTx(async (tx) => {
      if (!devolver) { await tx.query(sql, ctx.params); return null; }
      return (await tx.query(`with w as (${sql}) select coalesce(jsonb_agg(${jsonDeFila(esq, nombre, 'q0', items, extra, ctx)}), '[]'::jsonb) as r from (select * from w) q0`, ctx.params)).rows[0].r;
    });
    if (salida === null) return { estado: 204, cabeceras: {}, cuerpo: undefined };
    return respuestaJson(salida, { estado: 200 });
  }

  throw new ErrorRest(405, 'PGRST117', `Método no permitido: ${metodo}`);
}

// ---------- funciones (rpc) ----------
async function metaFuncion(proyecto, nombre) {
  const esq = await esquemaDe(proyecto);
  if (esq.funciones.has(nombre)) return esq.funciones.get(nombre);
  const filas = await proyecto.serializar(async () => (await proyecto.db.query(`select p.proretset, p.prokind::text as tipo, t.typtype::text as typtype, format_type(p.prorettype, null) as ret,
      p.proargnames as nombres, p.proargmodes::text[] as modos,
      array(select format_type(x, null) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) with ordinality u(x, o) order by o) as tipos_in,
      array(select format_type(x, null) from unnest(coalesce(p.proallargtypes, string_to_array(p.proargtypes::text, ' ')::oid[])) with ordinality u(x, o) order by o) as tipos_todos
    from pg_proc p join pg_type t on t.oid = p.prorettype where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [nombre])).rows);
  const metas = filas.map((f) => {
    const todosNombres = f.nombres ?? [];
    const modos = f.modos;
    const entradas = [];
    f.tipos_todos.forEach((tipo, i) => { const m = modos ? modos[i] : 'i'; if (m === 'i' || m === 'b' || m === 'v') entradas.push({ nombre: todosNombres[i] ?? null, tipo }); });
    return { retset: f.proretset, ret: f.ret, typtype: f.typtype, entradas };
  });
  esq.funciones.set(nombre, metas);
  return metas;
}

async function rpc(proyecto, esq, nombre, { metodo, query, cuerpo, enTx }) {
  const metas = await metaFuncion(proyecto, nombre);
  if (!metas.length) throw new ErrorRest(404, 'PGRST202', `Could not find the function public.${nombre} in the schema cache`);
  let args = {};
  if (metodo === 'GET') for (const [k, v] of query.entries()) args[k] = v; else args = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? cuerpo : {};
  const claves = Object.keys(args);
  const meta = metas.find((m) => claves.every((c) => m.entradas.some((e) => e.nombre === c))) ?? null;
  if (!meta) throw new ErrorRest(404, 'PGRST202', `Could not find the function public.${nombre}(${claves.join(', ')}) in the schema cache`);
  const params = [];
  const llamada = claves.map((c) => {
    const e = meta.entradas.find((x) => x.nombre === c);
    const v = args[c];
    if (v === null || v === undefined) { params.push(null); return `${q(c)} => $${params.length}::${e.tipo}`; }
    if (e.tipo === 'json' || e.tipo === 'jsonb') { params.push(typeof v === 'string' && metodo === 'GET' ? v : JSON.stringify(v)); return `${q(c)} => $${params.length}::${e.tipo}`; }
    if (e.tipo.endsWith('[]')) { params.push(Array.isArray(v) ? v.map(String) : parsearValorLista(String(v))); return `${q(c)} => $${params.length}::text[]::${e.tipo}`; }
    params.push(String(v)); return `${q(c)} => $${params.length}::${e.tipo}`;
  }).join(', ');
  const escalar = !meta.retset && meta.typtype !== 'c' && meta.ret !== 'record';
  // to_jsonb: las fechas, números y demás salen como las manda PostgREST (texto JSON), no como objetos de JavaScript
  const filas = await enTx(async (tx) => (await tx.query(`select to_jsonb(f) as r from (select * from public.${q(nombre)}(${llamada})) f`, params)).rows.map((x) => x.r));
  if (meta.ret === 'void') return { estado: 204, cabeceras: {}, cuerpo: undefined };
  if (escalar) return { estado: 200, cabeceras: {}, cuerpo: filas[0]?.[nombre] ?? null };
  // Una función que devuelve una lista de valores simples (setof uuid, setof integer…) sale, como en PostgREST, como lista de valores y no como lista de objetos.
  if (meta.retset && meta.typtype !== 'c' && meta.ret !== 'record') return { estado: 200, cabeceras: {}, cuerpo: filas.map((x) => x[nombre]) };
  return { estado: 200, cabeceras: {}, cuerpo: meta.retset ? filas : filas[0] ?? null };
}
