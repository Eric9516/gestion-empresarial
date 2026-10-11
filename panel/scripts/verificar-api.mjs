// Comprueba, SOLO LEYENDO, que la llave de Supabase del panel funciona y que la API contesta con la forma que el panel espera.
// No crea, cambia ni borra nada. No muestra la llave ni ningún valor secreto (solo nombres de campos y tipos).
//
//   SUPABASE_ACCESS_TOKEN=sbp_... PANEL_ORG_SLUGS=org1,org2 node scripts/verificar-api.mjs
//
// Qué NO puede comprobar sin escribir (se verifica la primera vez, creando un cliente de prueba): los permisos de
// escritura (Organization Projects, Database, Edge Functions, Edge Function Secrets, Auth Config).

const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const orgs = (process.env.PANEL_ORG_SLUGS ?? process.env.PANEL_ORG_SLUG ?? '').split(',').map(x => x.trim()).filter(Boolean);
if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(token) || !orgs.length || orgs.some(o => !/^[a-z0-9]{10,40}$/.test(o))) {
  console.error('Faltan SUPABASE_ACCESS_TOKEN (empieza con sbp_) y PANEL_ORG_SLUGS (identificadores de organización, separados por coma).');
  process.exit(1);
}

let fallas = 0;
const ok = (t) => console.log(`  ✔ ${t}`);
const mal = (t) => { fallas++; console.log(`  ✖ ${t}`); };
const tipo = (v) => (v === null ? 'null' : Array.isArray(v) ? 'lista' : typeof v);

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`https://api.supabase.com${ruta}`, {
    method: metodo, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { estado: r.status, datos, limite: r.headers.get('x-ratelimit-remaining') };
}

console.log('\n1) Proyectos de la organización');
const lista = await api('GET', '/v1/projects');
if (lista.estado !== 200 || !Array.isArray(lista.datos)) { mal(`GET /v1/projects respondió ${lista.estado}. ¿La llave tiene permiso de lectura de proyectos?`); process.exit(1); }
ok(`la API respondió (${lista.datos.length} proyecto(s) visibles con esta llave)`);
const campos = new Set(lista.datos.flatMap(p => Object.keys(p)));
for (const c of ['ref', 'name', 'organization_slug', 'status', 'region', 'created_at']) (campos.has(c) || lista.datos.length === 0) ? ok(`campo "${c}" presente`) : mal(`falta el campo "${c}" en la respuesta (la forma de la API cambió)`);
const propios = lista.datos.filter(p => orgs.includes(p.organization_slug));
const ajenos = lista.datos.length - propios.length;
for (const o of orgs) ok(`organización "${o}": ${lista.datos.filter(p => p.organization_slug === o).length} proyecto(s) visibles`);
if (ajenos > 0) console.log(`  ⚠ la llave también ve ${ajenos} proyecto(s) de OTRAS organizaciones: el panel los ignora (solo opera las de PANEL_ORG_SLUGS)`);
if (propios.length === 0) console.log('  ℹ la organización todavía no tiene proyectos: no se puede probar el resto en modo lectura.');

const p = propios.find(x => x.status === 'ACTIVE_HEALTHY');
if (p) {
  console.log(`\n2) Un proyecto de prueba (${p.name})`);
  const claves = await api('GET', `/v1/projects/${p.ref}/api-keys?reveal=true`);
  if (claves.estado !== 200 || !Array.isArray(claves.datos)) mal(`api-keys respondió ${claves.estado}. Hacen falta los permisos "API Keys" y "API Key Secrets" (lectura).`);
  else {
    ok(`api-keys respondió: ${claves.datos.map(k => `${k.name}(${k.type ?? '?'})`).join(', ')}`);
    const nombres = claves.datos.map(k => String(k.name));
    const tiene = (re, pref) => claves.datos.some(k => re.test(String(k.name)) || pref.test(String(k.api_key ?? '')));
    tiene(/^anon$/i, /^sb_publishable_/) ? ok('hay llave pública (anon / publishable)') : mal(`no encuentro la llave pública entre: ${nombres.join(', ')}`);
    tiene(/^service_role$/i, /^sb_secret_/) ? ok('hay llave de servicio (service_role / secret)') : mal(`no encuentro la llave de servicio entre: ${nombres.join(', ')}`);
    const visible = claves.datos.every(k => typeof k.api_key === 'string' && k.api_key.length > 20 && !/^[*•.]+$/.test(k.api_key));
    visible ? ok('"reveal=true" devuelve las llaves completas') : mal('las llaves vienen ocultas: falta el permiso "API Key Secrets" (lectura)');
  }
  const auth = await api('GET', `/v1/projects/${p.ref}/config/auth`);
  if (auth.estado !== 200) mal(`config/auth respondió ${auth.estado}. Hace falta el permiso "Auth Config" (lectura y escritura).`);
  else {
    ok(`config/auth respondió; "disable_signup" es de tipo ${tipo(auth.datos?.disable_signup)}, "site_url" de tipo ${tipo(auth.datos?.site_url)}, "uri_allow_list" de tipo ${tipo(auth.datos?.uri_allow_list)}`);
    if (auth.datos?.disable_signup === false) console.log('  ⚠ este proyecto tiene el registro público ABIERTO (el panel lo cierra al crear o actualizar clientes)');
  }
  const q = await api('POST', `/v1/projects/${p.ref}/database/query`, { query: 'select 1 as ok', read_only: true });
  (q.estado === 200 || q.estado === 201) && Array.isArray(q.datos) ? ok(`database/query (solo lectura) devuelve ${tipo(q.datos)} de filas`) : mal(`database/query respondió ${q.estado}. Hace falta el permiso "Database".`);
}

console.log(`\n${fallas ? `✖ ${fallas} problema(s). Corregí los permisos de la llave y volvé a correr este comando.` : '✔ Todo lo que se puede comprobar sin escribir está bien.'}`);
console.log('Falta comprobar los permisos de ESCRITURA: se hace la primera vez creando un cliente de prueba desde el panel.\n');
process.exit(fallas ? 1 : 0);
