// Deja listo el entorno para correr comandos reales (el instalador, la prueba de integración) contra el Supabase local:
//   · un `npx` falso al principio del PATH, que atiende `npx supabase ...` con el comando simulado;
//   · una precarga que manda a este servidor lo que el instalador pide a https://<proyecto>.supabase.co.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AQUI = import.meta.dirname;
const RAIZ = join(AQUI, '..', '..', '..');

/** Archivos SQL de los tres componentes (o los pedidos), en el orden en que se aplican. */
export function archivosDeComponentes(componentes = ['base', 'abastecimiento', 'mantenimiento']) {
  return componentes.flatMap((c) => readdirSync(join(RAIZ, 'supabase', 'componentes', c)).filter((f) => f.endsWith('.sql')).sort().map((f) => join(RAIZ, 'supabase', 'componentes', c, f)));
}

/** Publica las funciones del servidor del repositorio en un proyecto del Supabase local (como `supabase functions deploy`). */
export function publicarFunciones(proyecto) {
  for (const nombre of readdirSync(join(RAIZ, 'supabase', 'functions'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    proyecto.funciones.set(nombre, readFileSync(join(RAIZ, 'supabase', 'functions', nombre, 'index.ts'), 'utf8'));
  }
}

/** Devuelve las variables de entorno para los procesos hijos. */
export function entornoParaHijos(servidor, base = process.env) {
  const carpeta = mkdtempSync(join(tmpdir(), 'supabase-falso-'));
  const npxFalso = join(AQUI, 'npx-falso.mjs');
  writeFileSync(join(carpeta, 'npx.cmd'), `@echo off\r\nnode "${npxFalso}" %*\r\n`);
  writeFileSync(join(carpeta, 'npx'), `#!/bin/sh\nexec node "${npxFalso}" "$@"\n`);
  try { chmodSync(join(carpeta, 'npx'), 0o755); } catch { /* en Windows no hace falta */ }
  const precarga = pathToFileURL(join(AQUI, 'redirigir-fetch.mjs')).href;
  return {
    ...base,
    PATH: `${carpeta}${delimiter}${base.PATH ?? base.Path ?? ''}`,
    Path: `${carpeta}${delimiter}${base.PATH ?? base.Path ?? ''}`,
    SUPABASE_LOCAL_CONTROL: `${servidor.url}/__control`,
    SUPABASE_LOCAL_PUERTO: String(servidor.puerto),
    NODE_OPTIONS: `${base.NODE_OPTIONS ?? ''} --import ${precarga}`.trim(),
  };
}

export { RAIZ, mkdirSync };
