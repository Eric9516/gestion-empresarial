// "Foto" del esquema de una base: todo lo que las migraciones dejan armado, en texto ordenado para poder compararlo.
// Dos instalaciones son equivalentes si sus fotos son idénticas.

// Cada sección devuelve filas { clave, texto }: la clave identifica la pieza (se usa para decir qué falta o sobra) y el texto es su definición.
const CONSULTAS = {
  tablas: `select c.relname as clave, c.relkind::text || ' rls=' || c.relrowsecurity || ' forzada=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, '-') as texto
           from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S')`,
  columnas: `select c.relname || '.' || a.attname as clave,
               (row_number() over (partition by c.relname order by a.attnum))::text || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
               || ' ident=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') as texto
             from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') and a.attnum > 0 and not a.attisdropped`,
  restricciones: `select conrelid::regclass::text || '.' || conname as clave, contype::text || ' ' || pg_get_constraintdef(oid) as texto
                  from pg_constraint where connamespace = 'public'::regnamespace`,
  indices: `select tablename || '.' || indexname as clave, indexdef as texto from pg_indexes where schemaname = 'public'`,
  funciones: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as clave,
                pg_get_functiondef(p.oid) || ' acl=' || coalesce(p.proacl::text, '-') as texto
              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
                and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
  disparadores: `select tgrelid::regclass::text || '.' || tgname as clave, pg_get_triggerdef(oid) as texto from pg_trigger where not tgisinternal and tgrelid::regclass::text !~ '^(auth|storage)\\.' `,
  disparadores_de_eventos: `select evtname as clave, evtevent || ' ' || evtfoid::regproc::text || ' ' || evtenabled::text as texto from pg_event_trigger`,
  reglas: `select schemaname || '.' || tablename || '.' || policyname as clave,
             permissive || ' ' || roles::text || ' ' || cmd || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-') as texto
           from pg_policies where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')`,
  extensiones: `select e.extname as clave, n.nspname as texto from pg_extension e join pg_namespace n on n.oid = e.extnamespace`,
  privilegios_por_defecto: `select defaclrole::regrole::text || ' ' || defaclobjtype::text as clave, coalesce(defaclacl::text, '-') as texto from pg_default_acl`,
  comentarios: `select d.objoid::regclass::text || '.' || d.objsubid as clave, d.description as texto from pg_description d join pg_class c on c.oid = d.objoid where c.relnamespace = 'public'::regnamespace`,
  // datos que las migraciones dejan sembrados
  datos_configuracion: `select id::text as clave, (to_jsonb(t) - 'created_at' - 'updated_at')::text as texto from public.configuracion t`,
  datos_licencia: `select id::text as clave, (to_jsonb(t) - 'created_at' - 'updated_at' - 'actualizada_at')::text as texto from public.licencia t`,
  carpetas_de_archivos: `select id as clave, (to_jsonb(t) - 'created_at' - 'updated_at')::text as texto from storage.buckets t`,
};

export async function sacarFoto(db) {
  const foto = {};
  for (const [seccion, sql] of Object.entries(CONSULTAS)) {
    const filas = (await db.query(sql)).rows;
    foto[seccion] = Object.fromEntries(filas.map((f) => [f.clave, f.texto]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return foto;
}

/** Diferencias entre dos fotos: lista de textos cortos ("sobra …", "falta …", "cambia …"). */
export function comparar(esperada, real) {
  const dif = [];
  for (const seccion of new Set([...Object.keys(esperada), ...Object.keys(real)])) {
    const e = esperada[seccion] ?? {}, r = real[seccion] ?? {};
    for (const k of Object.keys(e)) {
      if (!(k in r)) dif.push(`falta ${seccion}: ${k}`);
      else if (e[k] !== r[k]) dif.push(`cambia ${seccion}: ${k}\n      esperado: ${e[k].replace(/\s+/g, ' ').slice(0, 200)}\n      real:     ${r[k].replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    for (const k of Object.keys(r)) if (!(k in e)) dif.push(`sobra ${seccion}: ${k}`);
  }
  return dif;
}
