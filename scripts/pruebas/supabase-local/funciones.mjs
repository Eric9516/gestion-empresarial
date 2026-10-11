// Las "Edge Functions" del Supabase local: ejecuta el código REAL de supabase/functions/*/index.ts en Node, con un `Deno` mínimo y la
// librería de Supabase tomada de node_modules (en vez de bajarla de esm.sh). Cada función habla con el Supabase local por HTTP.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPABASE_JS = import.meta.resolve('@supabase/supabase-js');
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (/^https:\/\/esm\.sh\/@supabase\/supabase-js@/.test(especificador)) return { url: SUPABASE_JS, shortCircuit: true };
    return siguiente(especificador, contexto);
  },
});

let entornoActual = new Map();
let capturado = null;
globalThis.Deno = {
  env: { get: (clave) => entornoActual.get(clave) },
  serve: (manejador) => { capturado = manejador; return { shutdown: async () => {} }; },
};

const cargados = new Map(); // "ref/nombre/huella" -> manejador
let candado = Promise.resolve();
const conCandado = (fn) => { const r = candado.then(fn, fn); candado = r.catch(() => {}); return r; };

function entornoDe(proyecto, urlPublica) {
  const e = new Map([
    ['SUPABASE_URL', urlPublica],
    ['SUPABASE_ANON_KEY', proyecto.claveAnon],
    ['SUPABASE_SERVICE_ROLE_KEY', proyecto.claveServicio],
  ]);
  for (const [k, v] of proyecto.secretos) e.set(k, v);
  return e;
}

export async function ejecutarFuncion(proyecto, nombre, urlPublica, pedido) {
  const fuente = proyecto.funciones.get(nombre);
  if (fuente == null) return new Response(JSON.stringify({ message: 'Function not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const huella = createHash('sha256').update(fuente).digest('hex').slice(0, 16);
  return conCandado(async () => {
    entornoActual = entornoDe(proyecto, urlPublica);
    const clave = `${proyecto.ref}/${nombre}/${huella}`;
    let manejador = cargados.get(clave);
    if (!manejador) {
      const carpeta = join(tmpdir(), 'supabase-local-funciones');
      mkdirSync(carpeta, { recursive: true });
      writeFileSync(join(carpeta, 'package.json'), '{"type":"module"}');
      const archivo = join(carpeta, `${proyecto.ref}-${nombre}-${huella}.ts`);
      writeFileSync(archivo, fuente);
      capturado = null;
      try { await import(`${pathToFileURL(archivo).href}?v=${huella}`); }
      catch (e) { return new Response(JSON.stringify({ message: `La función no pudo cargarse: ${e.message}` }), { status: 500, headers: { 'content-type': 'application/json' } }); }
      manejador = capturado;
      if (!manejador) return new Response(JSON.stringify({ message: 'La función no llamó a Deno.serve' }), { status: 500, headers: { 'content-type': 'application/json' } });
      cargados.set(clave, manejador);
    }
    try { return await manejador(pedido); }
    catch (e) { return new Response(JSON.stringify({ message: `Error en la función: ${e.message}` }), { status: 500, headers: { 'content-type': 'application/json' } }); }
  });
}
