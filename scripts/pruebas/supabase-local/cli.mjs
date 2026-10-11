// El comando `supabase` simulado: lo que usa el instalador (scripts/cliente.mjs) y la prueba de integración, contra el Supabase local.
// Se instala poniendo un `npx` falso al principio del PATH (ver preparar.mjs).
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const valorDe = (args, nombre) => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined; };

export async function ejecutarCli(servidor, { args: crudos, cwd }) {
  const args = crudos.filter((a, i) => !(i < 2 && (a === '--yes' || a === 'supabase')));
  const salida = (texto) => ({ salida: texto, error: '', codigo: 0 });
  const falla = (mensaje) => ({ salida: '', error: mensaje + '\n', codigo: 1 });
  const ref = valorDe(args, '--project-ref');
  const proyecto = ref ? servidor.proyectos.get(ref) : null;
  const [a, b] = args;

  if (a === 'login') return salida('Sesión iniciada (simulada)\n');
  if (a === 'orgs' && b === 'list') return salida(JSON.stringify({ organizations: servidor.organizaciones }, null, 2) + '\n');
  if (a === 'projects' && b === 'list') {
    const lista = [...servidor.proyectos.values()].map((p) => ({ ref: p.ref, name: p.nombre, status: 'ACTIVE_HEALTHY', organization_id: servidor.organizaciones[0].id, region: 'sa-east-1' }));
    return salida(JSON.stringify(args.includes('json') ? lista : { projects: lista }, null, 2) + '\n');
  }
  if (a === 'projects' && b === 'create') {
    const nombre = args[2];
    const org = valorDe(args, '--org-id');
    if (org && !servidor.organizaciones.some((o) => o.id === org)) return falla(`Organización desconocida: ${org}`);
    if (!valorDe(args, '--db-password')) return falla('Falta --db-password');
    const p = await servidor.crearProyecto({ nombre });
    return salida(JSON.stringify({ ref: p.ref, name: nombre, status: 'ACTIVE_HEALTHY', organization_id: org ?? servidor.organizaciones[0].id }, null, 2) + '\n');
  }
  if (a === 'projects' && b === 'api-keys') {
    if (!proyecto) return falla(`No existe el proyecto ${ref}`);
    return salida(JSON.stringify([{ name: 'anon', api_key: proyecto.claveAnon }, { name: 'service_role', api_key: proyecto.claveServicio }], null, 2) + '\n');
  }
  if (a === 'secrets' && b === 'set') {
    if (!proyecto) return falla(`No existe el proyecto ${ref}`);
    for (const par of args.slice(2).filter((x) => x.includes('=') && !x.startsWith('--'))) proyecto.secretos.set(par.slice(0, par.indexOf('=')), par.slice(par.indexOf('=') + 1));
    return salida('Secretos guardados\n');
  }
  if (a === 'functions' && b === 'deploy') {
    if (!proyecto) return falla(`No existe el proyecto ${ref}`);
    const nombre = args[2];
    try { proyecto.funciones.set(nombre, readFileSync(join(cwd, 'supabase', 'functions', nombre, 'index.ts'), 'utf8')); }
    catch (e) { return falla(`No pude leer la función ${nombre}: ${e.message}`); }
    return salida(`Función ${nombre} publicada\n`);
  }
  if (a === 'db' && b === 'query') {
    if (!proyecto) return falla(`No existe el proyecto ${ref}`);
    const archivo = valorDe(args, '-f');
    const sql = archivo ? readFileSync(isAbsolute(archivo) ? archivo : join(cwd, archivo), 'utf8') : valorDe(args, '--sql') ?? args[2];
    try {
      const resultados = await proyecto.serializar(() => proyecto.db.exec(sql));
      proyecto.invalidarEsquema();
      const ultimo = [...resultados].reverse().find((r) => r.fields?.length) ?? { rows: [] };
      return salida(JSON.stringify({ rows: ultimo.rows }, null, 2) + '\n');
    } catch (e) { return falla(`Error SQL: ${e.message}`); }
  }
  return falla(`Comando no soportado por el supabase simulado: ${args.join(' ')}`);
}
