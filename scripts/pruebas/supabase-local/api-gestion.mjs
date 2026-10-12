// La API de administración de Supabase (https://api.supabase.com) simulada: lo que usa scripts/cliente.mjs (a través de
// scripts/herramientas/supabase-api.mjs) para crear proyectos, correr SQL, leer claves, guardar secretos y publicar funciones.
// Las direcciones son /__gestion/v1/...  (redirigir-fetch.mjs manda ahí lo que se pide a api.supabase.com).

/** Atiende un pedido. Devuelve { estado, cuerpo }. `formulario` es el FormData ya leído (o undefined). */
export async function atenderApiGestion(servidor, { metodo, ruta, query, token, cuerpo, formulario }) {
  const no = (estado, message) => ({ estado, cuerpo: { message } });
  if (!/^sbp_[A-Za-z0-9_]{10,}$/.test(token ?? '')) return no(401, 'Invalid access token format. Must be like `sbp_0102...1920`.');
  if (token === 'sbp_llave_vencida_000000') return no(401, 'Unauthorized');

  if (metodo === 'GET' && ruta === '/v1/organizations') return { estado: 200, cuerpo: servidor.organizaciones.map(o => ({ id: o.id, slug: o.id, name: o.name })) };

  const proyecto = (o) => ({ id: o.ref, ref: o.ref, name: o.nombre, organization_slug: servidor.organizaciones[0].id, organization_id: servidor.organizaciones[0].id, status: 'ACTIVE_HEALTHY', region: 'sa-east-1', created_at: new Date().toISOString() });
  if (metodo === 'GET' && ruta === '/v1/projects') return { estado: 200, cuerpo: [...servidor.proyectos.values()].map(proyecto) };
  if (metodo === 'POST' && ruta === '/v1/projects') {
    if (!cuerpo?.name || !cuerpo?.db_pass) return no(400, 'Falta name o db_pass');
    if (!servidor.organizaciones.some(o => o.id === cuerpo.organization_slug)) return no(404, `Organización desconocida: ${cuerpo.organization_slug}`);
    const p = await servidor.crearProyecto({ nombre: cuerpo.name });
    return { estado: 201, cuerpo: proyecto(p) };
  }

  const m = /^\/v1\/projects\/([a-z0-9]{20})\/(database\/query|api-keys|secrets|functions\/deploy)$/.exec(ruta);
  if (!m) return no(404, `Ruta desconocida de la API simulada: ${metodo} ${ruta}`);
  const p = servidor.proyectos.get(m[1]);
  if (!p) return no(404, `Project ${m[1]} not found`);

  if (m[2] === 'api-keys' && metodo === 'GET') return { estado: 200, cuerpo: [{ name: 'anon', api_key: p.claveAnon }, { name: 'service_role', api_key: p.claveServicio }] };
  if (m[2] === 'secrets' && metodo === 'POST') {
    for (const s of Array.isArray(cuerpo) ? cuerpo : []) p.secretos.set(s.name, s.value);
    return { estado: 201, cuerpo: null };
  }
  if (m[2] === 'functions/deploy' && metodo === 'POST') {
    const slug = query.get('slug');
    const archivo = formulario?.get('file');
    if (!slug || !archivo || typeof archivo === 'string') return no(400, 'Falta slug o file');
    p.funciones.set(slug, await archivo.text());
    return { estado: 201, cuerpo: { id: slug, slug, status: 'ACTIVE' } };
  }
  if (m[2] === 'database/query' && metodo === 'POST') {
    if (typeof cuerpo?.query !== 'string') return no(400, 'Falta query');
    try {
      const resultados = await p.serializar(() => p.db.exec(cuerpo.query));
      p.invalidarEsquema();
      const ultimo = [...resultados].reverse().find(r => r.fields?.length);
      return { estado: 201, cuerpo: ultimo ? ultimo.rows : [] };
    } catch (e) { return no(400, `Error SQL: ${e.message}`); }
  }
  return no(405, `Método no permitido: ${metodo} ${ruta}`);
}
