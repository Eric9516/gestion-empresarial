// Una PostgreSQL REAL (no la de memoria): se baja como paquete de npm (embedded-postgres), arranca como un proceso común en una carpeta temporal y se apaga sola.
// Sirve para lo que la base de memoria no puede probar: muchas conexiones a la vez, bloqueos, bloqueos mutuos y tiempos de verdad.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { PIEZAS_DE_SUPABASE_SQL } from '../esquema/base.mjs';

const RAIZ = join(import.meta.dirname, '..', '..', '..');

/** Los archivos SQL de los tres componentes, en el orden en que se aplican. */
export function archivosDeComponentes() {
  return ['base', 'abastecimiento', 'mantenimiento'].flatMap(c => {
    const dir = join(RAIZ, 'supabase', 'componentes', c);
    return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => join(dir, f));
  });
}

export async function iniciarPostgres({ puerto = 55432, conexiones = 200, registrar = () => {} } = {}) {
  const carpeta = mkdtempSync(join(tmpdir(), 'pg-real-'));
  const servidor = new EmbeddedPostgres({
    databaseDir: carpeta, initdbFlags: ['--encoding=UTF8', '--locale=C'], user: 'postgres', password: 'postgres', port: puerto, persistent: false,
    postgresFlags: ['-c', `max_connections=${conexiones}`, '-c', 'shared_buffers=256MB', '-c', 'deadlock_timeout=1s', '-c', 'log_min_messages=error'],
    onLog: m => registrar(String(m).trim()), onError: m => registrar(String(m).trim()),
  });
  await servidor.initialise();
  await servidor.start();
  await servidor.createDatabase('app');
  const url = `postgres://postgres:postgres@127.0.0.1:${puerto}/app`;
  const pools = [];
  const pool = (max) => { const p = new pg.Pool({ connectionString: url, max }); p.on('error', () => {}); pools.push(p); return p; };
  async function apagar() {
    for (const p of pools) await p.end().catch(() => {});
    await servidor.stop().catch(() => {});
    try { rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 }); } catch { /* en Windows a veces queda tomada un instante */ }
  }
  return { url, pool, apagar };
}

/** Arma el esquema completo del producto (piezas de Supabase + los tres componentes) sobre una PostgreSQL real. */
export async function instalarEsquema(clientePg) {
  await clientePg.query(PIEZAS_DE_SUPABASE_SQL);
  for (const archivo of archivosDeComponentes()) await clientePg.query(readFileSync(archivo, 'utf8'));
}
