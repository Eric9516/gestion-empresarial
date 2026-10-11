// Base de pruebas: Postgres real en memoria (PGlite) con el esquema del panel y el mismo conjunto de funciones.
// Las pruebas "viajan en el tiempo" modificando fechas con SQL directo (nunca desde el código del panel).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { construirLlamada, ErrorAlmacen, type Almacen } from '../../src/server/almacen.ts';

export interface BaseDePrueba {
  db: PGlite;
  almacen: Almacen;
  /** Llamadas hechas al almacén, para comprobar qué funciones usó el servidor. */
  llamadas: { nombre: string; args: Record<string, unknown> }[];
  sql<T = Record<string, unknown>>(texto: string, params?: unknown[]): Promise<T[]>;
}

// Crear la base cuesta unos segundos: se arma una vez por archivo de pruebas y entre pruebas se la vacía.
let compartida: PGlite | null = null;
const TABLAS = 'panel.ajustes, panel.credenciales, panel.desafios, panel.sesiones, panel.planes, panel.bloqueos, panel.limites, panel.organizaciones, panel.auditoria';

async function nuevaBase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create role panel_app nologin;`);
  await db.exec(readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8'));
  return db;
}

export async function crearBase(opciones: { aislada?: boolean } = {}): Promise<BaseDePrueba> {
  let db: PGlite;
  if (opciones.aislada) db = await nuevaBase();
  else {
    compartida ??= await nuevaBase();
    db = compartida;
    // replica: no se disparan los triggers que protegen la auditoría (solo así se puede vaciar, y solo en pruebas).
    await db.exec(`set session_replication_role = replica; truncate ${TABLAS} restart identity; set session_replication_role = origin;`);
  }
  const llamadas: BaseDePrueba['llamadas'] = [];
  const almacen: Almacen = {
    async rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
      llamadas.push({ nombre, args });
      const { texto, valores } = construirLlamada(nombre, args);
      try {
        const r = await db.query<{ r: T }>(texto, valores);
        return (r.rows[0]?.r ?? null) as T;
      } catch (e) {
        throw new ErrorAlmacen(500, e instanceof Error ? e.message : 'error', e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '');
      }
    },
  };
  return {
    db, almacen, llamadas,
    async sql<T>(texto: string, params: unknown[] = []) { return (await db.query(texto, params)).rows as T[]; },
  };
}
