// Un Supabase local para pruebas: servidor HTTP que se parece al de verdad (REST, ingreso, archivos y funciones del servidor) y atiende
// varios proyectos a la vez, cada uno con su propia base PostgreSQL real (PGlite). Las migraciones, los permisos y las reglas de
// seguridad que se prueban son los reales; solo la "carcasa" de Supabase está simulada.
//
// Direcciones:  http://127.0.0.1:<puerto>/p/<proyecto>/rest/v1/...   /auth/v1/...   /storage/v1/...   /functions/v1/...
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { atenderAuth } from './auth.mjs';
import { ejecutarCli } from './cli.mjs';
import { ejecutarFuncion } from './funciones.mjs';
import { Proyecto, crearProyecto as crearProyectoBase, verificarJwt } from './proyecto.mjs';
import { ErrorRest, atenderRest, errorDePg } from './rest.mjs';
import { atenderStorage } from './storage.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept, accept-profile, content-profile, range, x-upsert, cache-control',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-expose-headers': 'content-range, content-type',
};

const leerCuerpo = (req) => new Promise((resolve, reject) => { const partes = []; req.on('data', (c) => partes.push(c)); req.on('end', () => resolve(Buffer.concat(partes))); req.on('error', reject); });

export async function iniciarServidor({ puerto = 0, silencioso = true } = {}) {
  const proyectos = new Map();
  const servidor = {
    proyectos, puerto: 0, url: '', organizaciones: [{ id: 'org-local', name: 'Organización local' }], bitacora: [],
    urlDe(proyecto) { return `${servidor.url}/p/${proyecto.ref}`; },
    async crearProyecto(opciones = {}) {
      const p = await crearProyectoBase(opciones);
      await p.db.exec('alter table storage.objects enable row level security; alter table storage.buckets enable row level security;');
      await p.db.exec("set max_stack_depth = '7MB'"); // PGlite (WebAssembly) a veces se queda sin pila en sesiones largas con muchas reglas de seguridad
      proyectos.set(p.ref, p);
      return p;
    },
    async cerrar() { await new Promise((r) => http.close(r)); http.closeAllConnections?.(); },
  };

  const http = createServer(async (req, res) => {
    const enviar = (estado, cabeceras, cuerpo) => {
      res.writeHead(estado, { ...CORS, ...cabeceras });
      res.end(cuerpo);
    };
    const json = (estado, cuerpo, cab = {}) => enviar(estado, { 'content-type': 'application/json; charset=utf-8', ...cab }, cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
    try {
      const url = new URL(req.url, 'http://local');
      if (req.method === 'OPTIONS') return enviar(204, {}, undefined);
      const bruto = await leerCuerpo(req);

      if (url.pathname === '/__control') {
        const { args, cwd } = JSON.parse(bruto.toString('utf8'));
        return json(200, await ejecutarCli(servidor, { args, cwd }));
      }

      const m = /^\/p\/([a-z0-9]+)\/(rest|auth|storage|functions)\/v1\/?(.*)$/.exec(url.pathname);
      if (!m) return json(404, { message: 'Ruta desconocida del Supabase local' });
      const proyecto = proyectos.get(m[1]);
      if (!proyecto) return json(404, { message: `No existe el proyecto ${m[1]}` });
      const [, , servicio, resto] = m;

      // quién llama: el token del encabezado Authorization, o la clave "apikey"
      const cab = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v]));
      const bearer = /^Bearer (.+)$/i.exec(cab.authorization ?? '')?.[1];
      const apikey = cab.apikey ?? url.searchParams.get('apikey');
      const claveValida = apikey ? verificarJwt(apikey, proyecto.secretoJwt) : null;
      const claims = bearer ? verificarJwt(bearer, proyecto.secretoJwt) : claveValida;
      const publico = servicio === 'storage' && req.method === 'GET' && /^object\/(public|sign)\//.test(resto);
      if (!publico) {
        if (!apikey && !bearer) return json(401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });
        if (apikey && !claveValida) return json(401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });
        if (bearer && !claims) return json(401, { code: 'PGRST301', message: 'JWT expired or invalid' });
      }
      const rol = claims?.role;
      if (!publico && !['anon', 'authenticated', 'service_role'].includes(rol)) return json(401, { code: 'PGRST301', message: 'Rol de token no permitido' });
      const auth = { rol, sub: claims?.sub ?? '', claims };

      let cuerpoJson;
      if (bruto.length && /json/.test(cab['content-type'] ?? '')) {
        try { cuerpoJson = JSON.parse(bruto.toString('utf8')); } catch { return json(400, { code: 'PGRST102', message: 'Empty or invalid json' }); }
      }

      if (servicio === 'rest') {
        try {
          const r = await atenderRest(proyecto, { metodo: req.method, ruta: resto, query: url.searchParams, cabeceras: cab, cuerpo: cuerpoJson, auth });
          return r.cuerpo === undefined ? enviar(r.estado, r.cabeceras, undefined) : json(r.estado, r.cuerpo, r.cabeceras);
        } catch (e) { const r = errorDePg(e, rol); return json(r.estado, r.cuerpo); }
      }
      if (servicio === 'auth') {
        try { const r = await atenderAuth(proyecto, { metodo: req.method, ruta: resto, query: url.searchParams, cuerpo: cuerpoJson, claims }); return r.cuerpo === undefined ? enviar(r.estado, {}, undefined) : json(r.estado, r.cuerpo); }
        catch (e) { const r = errorDePg(e, rol); return json(r.estado, r.cuerpo); }
      }
      if (servicio === 'storage') {
        let contenido = bruto;
        // supabase-js sube los archivos como formulario (multipart): se saca el archivo del formulario, como hace Storage
        if ((cab['content-type'] ?? '').includes('multipart/form-data') && bruto.length) {
          const form = await new Response(bruto, { headers: { 'content-type': cab['content-type'] } }).formData();
          const archivo = [...form.values()].find((v) => typeof v !== 'string');
          if (archivo) contenido = Buffer.from(await archivo.arrayBuffer());
        }
        const r = await atenderStorage(proyecto, { metodo: req.method, ruta: resto, query: url.searchParams, cabeceras: cab, cuerpoCrudo: contenido, cuerpoJson, auth: publico && !claims ? null : auth });
        if (r.binario) return enviar(r.estado, { 'content-type': r.tipo }, r.cuerpo);
        return json(r.estado, r.cuerpo);
      }
      if (servicio === 'functions') {
        const nombre = resto.split('/')[0];
        const pedido = new Request(`${servidor.urlDe(proyecto)}/functions/v1/${resto}`, { method: req.method, headers: cab, body: ['GET', 'HEAD'].includes(req.method) ? undefined : bruto });
        const r = await ejecutarFuncion(proyecto, nombre, servidor.urlDe(proyecto), pedido);
        const cuerpo = Buffer.from(await r.arrayBuffer());
        const cabeceras = Object.fromEntries(r.headers.entries());
        return enviar(r.status, cabeceras, cuerpo);
      }
    } catch (e) {
      if (e instanceof ErrorRest) return json(e.estado, { code: e.code, message: e.message });
      if (!silencioso) console.error('[supabase-local]', e);
      return json(500, { message: `Error interno del Supabase local: ${e?.message ?? e}` });
    }
  });

  await new Promise((r) => http.listen(puerto, '127.0.0.1', r));
  servidor.puerto = http.address().port;
  servidor.url = `http://127.0.0.1:${servidor.puerto}`;
  return servidor;
}

export { Proyecto, readFileSync, join };
