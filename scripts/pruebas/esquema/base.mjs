// Base de pruebas: PostgreSQL real en memoria (PGlite) con las piezas de Supabase que las migraciones necesitan (auth, storage, roles).
// Sirve para probar que las migraciones se aplican desde cero y que las reglas de seguridad y los disparadores se comportan como se espera.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const BASE = join(import.meta.dirname, '..', '..', '..', 'supabase', 'migrations');
// Aplica archivos SQL en orden (nombres dentro de supabase/migrations, o rutas absolutas).
export async function aplicar(db, archivos) {
  for (const a of archivos) await db.exec(readFileSync(isAbsolute(a) ? a : `${BASE}/${a}`, 'utf8'));
}

// Las piezas de Supabase que las migraciones necesitan (roles, esquemas auth y storage, auth.uid()). Se exporta para usarlo también con una PostgreSQL real (pruebas de concurrencia).
export const PIEZAS_DE_SUPABASE_SQL = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions; create schema storage;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text unique not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
    grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant all on all tables in schema storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function crearBase(archivos) {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto, uuid_ossp } });
  await db.exec(PIEZAS_DE_SUPABASE_SQL);
  await aplicar(db, archivos);
  return db;
}

