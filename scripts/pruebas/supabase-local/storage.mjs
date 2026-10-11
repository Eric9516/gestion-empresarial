// La parte "Storage" del Supabase local: subir, borrar, listar y abrir archivos. Los permisos los aplican las reglas de seguridad
// que las migraciones dejan sobre storage.objects (la base real); los bytes se guardan en memoria.
import { createHmac } from 'node:crypto';

const falla = (estado, error, message, statusCode = String(estado)) => ({ estado, cuerpo: { statusCode, error, message } });

const enTx = (p, auth, fn) => p.serializar(() => p.db.transaction(async (tx) => {
  await tx.exec(`set local role ${auth.rol}`);
  await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)`, [JSON.stringify(auth.claims ?? {}), auth.sub ?? '', auth.rol]);
  return fn(tx);
}));

const esRls = (e) => e?.code === '42501' || /row-level security|permission denied/i.test(e?.message ?? '');
const firma = (p, texto) => createHmac('sha256', p.secretoJwt).update(texto).digest('base64url');

export async function atenderStorage(p, { metodo, ruta, query, cabeceras, cuerpoCrudo, cuerpoJson, auth }) {
  const trozos = ruta.split('/').map(decodeURIComponent);

  // abrir un archivo público / autenticado / firmado
  if (metodo === 'GET' && trozos[0] === 'object') {
    let modo = 'directo'; let resto = trozos.slice(1);
    if (['public', 'authenticated', 'sign'].includes(resto[0])) { modo = resto[0]; resto = resto.slice(1); }
    const [bucket, ...nombre] = resto; const ruta2 = nombre.join('/');
    const clave = `${bucket}/${ruta2}`;
    if (modo === 'sign') {
      if (query.get('token') !== firma(p, clave)) return falla(400, 'InvalidJWT', 'invalid signature');
    } else if (modo === 'public') {
      const filas = await p.serializar(async () => (await p.db.query('select public from storage.buckets where id = $1', [bucket])).rows);
      if (!filas[0]?.public) return falla(400, 'Bucket not found', 'Bucket not found', '404');
    } else {
      if (!auth || auth.rol === 'anon') return falla(400, 'Unauthorized', 'Unauthorized', '403');
      const hay = await enTx(p, auth, async (tx) => (await tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, ruta2])).rows.length);
      if (!hay) return falla(400, 'not_found', 'Object not found', '404');
    }
    const bytes = p.objetos.get(clave);
    if (!bytes) return falla(400, 'not_found', 'Object not found', '404');
    return { estado: 200, cuerpo: bytes, binario: true, tipo: 'application/octet-stream' };
  }

  if (!auth || auth.rol === 'anon') {
    // sin sesión solo se puede lo que permitan las reglas para el rol anon: igual se prueba contra la base
  }

  if (metodo === 'POST' && trozos[0] === 'object' && trozos[1] === 'list') {
    const bucket = trozos[2]; const prefijo = cuerpoJson?.prefix ?? '';
    const filas = await enTx(p, auth, async (tx) => (await tx.query(`select name, id, created_at from storage.objects where bucket_id = $1 and name like $2 order by name limit $3`, [bucket, `${prefijo}%`, cuerpoJson?.limit ?? 100])).rows);
    return { estado: 200, cuerpo: filas.map((f) => ({ name: f.name.slice(prefijo.length).replace(/^\//, ''), id: f.id, created_at: f.created_at })) };
  }

  if (metodo === 'POST' && trozos[0] === 'object' && trozos[1] === 'sign') {
    const [bucket, ...nombre] = trozos.slice(2); const clave = `${bucket}/${nombre.join('/')}`;
    const hay = await enTx(p, auth, async (tx) => (await tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, nombre.join('/')])).rows.length);
    if (!hay) return falla(400, 'not_found', 'Object not found', '404');
    return { estado: 200, cuerpo: { signedURL: `/object/sign/${clave}?token=${firma(p, clave)}` } };
  }

  if (metodo === 'POST' && trozos[0] === 'object') {
    const [bucket, ...nombre] = trozos.slice(1); const ruta2 = nombre.join('/');
    if (!bucket || !ruta2) return falla(400, 'InvalidKey', 'Ruta inválida');
    const upsert = String(cabeceras['x-upsert'] ?? '') === 'true';
    try {
      await enTx(p, auth, async (tx) => {
        const hay = (await tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, ruta2])).rows.length;
        if (hay && !upsert) throw Object.assign(new Error('The resource already exists'), { duplicado: true });
        if (hay) await tx.query('update storage.objects set metadata = $3::jsonb where bucket_id = $1 and name = $2', [bucket, ruta2, JSON.stringify({ size: cuerpoCrudo.length })]);
        else await tx.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, nullif($3, \'\')::uuid, $4::jsonb)', [bucket, ruta2, auth.sub ?? '', JSON.stringify({ size: cuerpoCrudo.length, mimetype: cabeceras['content-type'] ?? null })]);
      });
    } catch (e) {
      if (e.duplicado) return falla(400, 'Duplicate', 'The resource already exists', '409');
      if (esRls(e)) return falla(400, 'Unauthorized', 'new row violates row-level security policy', '403');
      return falla(400, 'Error', e.message);
    }
    p.objetos.set(`${bucket}/${ruta2}`, Buffer.from(cuerpoCrudo));
    return { estado: 200, cuerpo: { Key: `${bucket}/${ruta2}`, Id: `${bucket}/${ruta2}` } };
  }

  if (metodo === 'DELETE' && trozos[0] === 'object') {
    const resto = trozos.slice(1);
    const nombres = resto.length === 1 ? (cuerpoJson?.prefixes ?? []).map((n) => [resto[0], n]) : [[resto[0], resto.slice(1).join('/')]];
    const borrados = [];
    for (const [bucket, nombre] of nombres) {
      try {
        const filas = await enTx(p, auth, async (tx) => (await tx.query('delete from storage.objects where bucket_id = $1 and name = $2 returning name', [bucket, nombre])).rows);
        if (filas.length) { p.objetos.delete(`${bucket}/${nombre}`); borrados.push({ name: nombre, bucket_id: bucket }); }
      } catch (e) { if (esRls(e)) return falla(400, 'Unauthorized', 'permission denied', '403'); throw e; }
    }
    if (resto.length > 1 && !borrados.length) return falla(400, 'not_found', 'Object not found', '404');
    return { estado: 200, cuerpo: resto.length === 1 ? borrados : { message: 'Successfully deleted' } };
  }

  return falla(404, 'not_found', `Ruta de storage no soportada por el Supabase local: ${metodo} ${ruta}`);
}
