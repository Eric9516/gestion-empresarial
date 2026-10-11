import { describe, expect, it } from 'vitest';
import { cargarConfig, ConfigInvalida, type Entorno } from '../src/server/config.ts';

const BUENO: Entorno = {
  PANEL_ORIGEN: 'https://panel.red-privada.ts.net', PANEL_SECRETO: 's'.repeat(40), PANEL_CODIGO_ALTA: 'c'.repeat(40),
  SUPABASE_ACCESS_TOKEN: 'sbp_' + 'a'.repeat(40), PANEL_ORG_SLUG: 'abcdefghijklmnopqrst',
  PANEL_DB_URL: 'postgres://panel_app:clave-larga@127.0.0.1:5432/panel', PANEL_USUARIO_RED: 'eric@ejemplo.com',
};
const con = (cambios: Entorno) => ({ ...BUENO, ...cambios });
const problemas = (env: Entorno): string[] => { try { cargarConfig(env); return []; } catch (e) { return e instanceof ConfigInvalida ? e.problemas : ['otro']; } };

describe('configuración: falla cerrado', () => {
  it('la configuración correcta carga', () => {
    const c = cargarConfig(BUENO);
    expect(c.rpId).toBe('panel.red-privada.ts.net');
    expect(c.puerto).toBe(3100);
    expect(c.pasoTimeoutMs).toBe(60000);
  });

  it.each([
    ['sin origen', { PANEL_ORIGEN: '' }, 'PANEL_ORIGEN'],
    ['origen http', { PANEL_ORIGEN: 'http://panel.ts.net' }, 'https'],
    ['origen con ruta', { PANEL_ORIGEN: 'https://panel.ts.net/app' }, 'ruta'],
    ['origen con barra final', { PANEL_ORIGEN: 'https://panel.ts.net/' }, 'terminar en /'],
    ['origen con usuario', { PANEL_ORIGEN: 'https://u:p@panel.ts.net' }, 'usuario'],
    ['origen con IP', { PANEL_ORIGEN: 'https://100.64.0.1' }, 'dominio'],
    ['origen localhost sin modo desarrollo', { PANEL_ORIGEN: 'https://localhost' }, 'dominio'],
    ['secreto corto', { PANEL_SECRETO: 'corto' }, 'PANEL_SECRETO'],
    ['código de alta corto', { PANEL_CODIGO_ALTA: '123456' }, 'PANEL_CODIGO_ALTA'],
    ['token con otro formato', { SUPABASE_ACCESS_TOKEN: 'abc123' }, 'formato'],
    ['token vacío', { SUPABASE_ACCESS_TOKEN: '' }, 'SUPABASE_ACCESS_TOKEN'],
    ['organización inválida', { PANEL_ORG_SLUGS: 'Mi Org!' }, 'PANEL_ORG_SLUGS'],
    ['organizaciones repetidas', { PANEL_ORG_SLUGS: 'abcdefghijklmnopqrst,abcdefghijklmnopqrst' }, 'repetidos'],
    ['una organización mala entre varias', { PANEL_ORG_SLUGS: 'abcdefghijklmnopqrst,MALA' }, 'formato inesperado'],
    ['base a internet', { PANEL_DB_URL: 'postgres://panel_app:x@db.ejemplo.com:5432/panel' }, 'local'],
    ['base con superusuario', { PANEL_DB_URL: 'postgres://postgres:x@127.0.0.1:5432/panel' }, 'postgres'],
    ['base sin contraseña', { PANEL_DB_URL: 'postgres://panel_app@127.0.0.1:5432/panel' }, 'contraseña'],
    ['base con otro protocolo', { PANEL_DB_URL: 'mysql://a:b@127.0.0.1/x' }, 'postgres://'],
    ['alerta http', { PANEL_ALERTA_URL: 'http://ntfy.sh/tema' }, 'https'],
    ['alerta inválida', { PANEL_ALERTA_URL: 'no-es-url' }, 'PANEL_ALERTA_URL'],
    ['sin usuario de red privada', { PANEL_USUARIO_RED: '' }, 'PANEL_USUARIO_RED'],
    ['usuario de red con salto de línea', { PANEL_USUARIO_RED: 'a@b.com\r\nX: y' }, 'PANEL_USUARIO_RED'],
    ['encabezado de IP inválido', { PANEL_ENCABEZADO_IP: 'x y' }, 'PANEL_ENCABEZADO_IP'],
    ['timeout absurdo', { PANEL_PASO_TIMEOUT_MS: '99999999' }, 'PANEL_PASO_TIMEOUT_MS'],
    ['timeout no numérico', { PANEL_PASO_TIMEOUT_MS: 'abc' }, 'PANEL_PASO_TIMEOUT_MS'],
    ['puerto privilegiado', { PANEL_PUERTO: '80' }, 'PANEL_PUERTO'],
  ])('%s → no arranca', (_n, cambio, texto) => {
    const p = problemas(con(cambio as Entorno));
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(' | ')).toContain(texto);
  });

  it('las organizaciones del servidor son opcionales (se pueden agregar desde el panel)', () => {
    expect(cargarConfig({ ...BUENO, PANEL_ORG_SLUG: undefined, PANEL_ORG_SLUGS: undefined }).organizaciones).toEqual([]);
  });

  it('acepta varias organizaciones (y la variable vieja con una sola)', () => {
    expect(cargarConfig(con({ PANEL_ORG_SLUGS: 'abcdefghijklmnopqrst, uvwxyzabcdefghijklmn' })).organizaciones).toEqual(['abcdefghijklmnopqrst', 'uvwxyzabcdefghijklmn']);
    expect(cargarConfig({ ...BUENO, PANEL_ORG_SLUG: 'abcdefghijklmnopqrst', PANEL_ORG_SLUGS: undefined }).organizaciones).toEqual(['abcdefghijklmnopqrst']);
  });

  it('los mensajes de error nombran la variable, nunca su valor', () => {
    const p = problemas(con({ PANEL_SECRETO: 'secretisimo', SUPABASE_ACCESS_TOKEN: 'sbp_zzzzzz' })).join(' ');
    expect(p).not.toContain('secretisimo');
    expect(p).not.toContain('sbp_zzzzzz');
  });

  it('el modo desarrollo solo relaja localhost, no el resto', () => {
    expect(problemas(con({ PANEL_DESARROLLO: '1', PANEL_ORIGEN: 'http://localhost:3100', PANEL_USUARIO_RED: '' }))).toEqual([]);
    expect(problemas(con({ PANEL_DESARROLLO: '1', PANEL_ORIGEN: 'http://evil.com' })).length).toBeGreaterThan(0);
    expect(problemas(con({ PANEL_DESARROLLO: '1', PANEL_SECRETO: 'x' })).length).toBeGreaterThan(0);
  });
});
