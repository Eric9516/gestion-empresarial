// Precarga para los procesos de prueba: lo que se pide a https://<proyecto>.supabase.co va al Supabase local.
const puerto = process.env.SUPABASE_LOCAL_PUERTO;
if (puerto) {
  const original = globalThis.fetch;
  const reescribir = (url) => { const g = /^https:\/\/api\.supabase\.com(\/.*)$/.exec(url); if (g) return `http://127.0.0.1:${puerto}/__gestion${g[1]}`; const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co(.*)$/.exec(url); return m ? `http://127.0.0.1:${puerto}/p/${m[1]}${m[2]}` : null; };
  globalThis.fetch = (entrada, opciones) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada?.url;
    const nueva = url ? reescribir(url) : null;
    if (!nueva) return original(entrada, opciones);
    return original(typeof entrada === 'string' || entrada instanceof URL ? nueva : new Request(nueva, entrada), opciones);
  };
}
