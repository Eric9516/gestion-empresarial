// ATAQUE 7 — Fugas de secretos: ¿aparece una llave, una contraseña o un token donde no debe?
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearManejador } from '../../src/server/manejador.ts';
import { limpiar, ocultarSecretos } from '../../src/server/registro.ts';
import { crearSupabaseApi } from '../../src/server/supabaseApi.ts';
import { CODIGO_ALTA, configDePrueba, crearMundo, ORIGEN, USUARIO_RED, type Mundo } from '../ayudas/mundo.ts';
import { TOKEN } from '../ayudas/supabaseFalso.ts';

let m: Mundo;
let salida: string[];
beforeEach(async () => {
  m = await crearMundo();
  salida = [];
  for (const nivel of ['log', 'error', 'warn', 'info', 'debug'] as const) vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => { salida.push(args.map(String).join(' ')); });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('ningún secreto sale de donde corresponde', () => {
  it('escenario completo: crear cliente, módulos, errores de Supabase y de la base', async () => {
    const { n, a } = await m.conSesion();
    const r = await n.hacer('crear', { nombre: 'Cliente Fugas', correo: 'dueno@fugas.com', modulos: ['deposito', 'tareas'], urlApp: 'https://fugas.netlify.app' }, a);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-fugas')!;
    const idPlan = r.plan.cuerpo.id as string;
    const claveInicial = (await n.post(`/api/planes/${idPlan}/clave`)).cuerpo.clave as string;
    await n.get(`/api/clientes/${p.ref}`);
    await n.hacer('modulos', { ref: p.ref, activar: ['comisionistas'] }, a);
    await n.hacer('actualizar', { ref: p.ref }, a);
    await n.get('/api/auditoria');

    // Errores provocados: Supabase devuelve mensajes con secretos adentro; la base falla.
    m.falso.hooks.antes = l => (l.host === 'api.supabase.com' ? new Response(JSON.stringify({ message: `fallo con ${TOKEN} y ${p.claves.servicio} y Bearer abcdefghijklmnopqrstuvwxyz0123` }), { status: 500 }) : undefined);
    await n.get('/api/clientes');
    await n.plan('actualizar', { ref: p.ref });
    m.falso.hooks.antes = undefined;

    // Cuerpo de la llamada que creó el proyecto: ahí viaja la contraseña aleatoria de la base.
    const dbPass = (m.falso.llamadas.find(l => l.metodo === 'POST' && l.ruta === '/v1/projects')!.cuerpo as { db_pass: string }).db_pass;
    expect(dbPass.length).toBeGreaterThanOrEqual(24);

    const secretos: Record<string, string> = {
      'llave de la API de Supabase': TOKEN, 'llave de servicio del cliente': p.claves.servicio, 'llave pública del cliente': p.claves.anon,
      'secreto del panel': m.config.secreto, 'código de alta': CODIGO_ALTA, 'contraseña de la base del panel': 'clave', 'contraseña de la base del cliente': dbPass,
      'cookie de sesión': n.sesion!, 'IP real': '203.0.113.7', 'navegador (User-Agent)': 'Mozilla/5.0 (Pruebas)',
    };
    secretos['contraseña de la base del panel'] = 'panel_app:clave@'; // lo que de verdad no debe aparecer (la cadena de conexión)

    const tablas = ['ajustes', 'credenciales', 'desafios', 'sesiones', 'planes', 'bloqueos', 'limites', 'auditoria'];
    const enBase = JSON.stringify(await Promise.all(tablas.map(t => m.base.sql(`select row_to_json(x)::text as j from panel.${t} x`))));
    const enAuditoria = JSON.stringify(await m.base.sql('select * from panel.auditoria'));
    const cuerposHttp = m.registro.filter(x => !x.ruta.endsWith('/clave'));
    const todasLasRespuestas = JSON.stringify(m.registro.map(x => x.texto));
    const enviadoALaBase = JSON.stringify(m.base.llamadas);

    for (const [nombre, valor] of Object.entries(secretos)) {
      expect(enBase, `${nombre} en las tablas`).not.toContain(valor);
      expect(enAuditoria, `${nombre} en la auditoría`).not.toContain(valor);
      expect(m.alertas.join('\n'), `${nombre} en los avisos al celular`).not.toContain(valor);
      expect(salida.join('\n'), `${nombre} en los logs`).not.toContain(valor);
      expect(JSON.stringify(cuerposHttp.map(x => x.texto)), `${nombre} en las respuestas`).not.toContain(valor);
      if (nombre !== 'cookie de sesión') expect(enviadoALaBase, `${nombre} enviado a la base`).not.toContain(valor);
    }
    // La cookie solo va en Set-Cookie; el hash que se manda a la base no es la cookie.
    expect(todasLasRespuestas).not.toContain(n.sesion!);
    expect(m.registro.some(x => x.cookies.some(c => c.includes(n.sesion!)))).toBe(true);

    // La contraseña inicial del dueño solo está en la respuesta de "/clave" y nunca en la base.
    expect(claveInicial).toBeTruthy();
    for (const x of cuerposHttp) expect(x.texto).not.toContain(claveInicial);
    expect(enBase).not.toContain(claveInicial);
    expect(enAuditoria).not.toContain(claveInicial);
    expect(m.alertas.join('\n')).not.toContain(claveInicial);
    expect(salida.join('\n')).not.toContain(claveInicial);
    expect(enviadoALaBase).not.toContain(claveInicial);
    // La IP se guarda solo como hash.
    expect(enBase).not.toMatch(/203\.0\.113\.7/);
  });

  it('un error de Supabase con secretos en el mensaje llega al navegador sin ellos', async () => {
    const { n } = await m.conSesion();
    m.falso.hooks.antes = l => (l.host === 'api.supabase.com' ? new Response(JSON.stringify({ message: `token ${TOKEN} inválido` }), { status: 403 }) : undefined);
    const r = await n.get('/api/clientes');
    expect(r.estado).toBe(502);
    expect(r.texto).not.toContain(TOKEN);
    expect(r.cuerpo.mensaje).toBe('Supabase rechazó la llave del panel.');
  });

  it('un error de la base nunca muestra detalles internos', async () => {
    const roto = crearManejador({
      config: configDePrueba(), api: crearSupabaseApi(TOKEN, ['orgprueba1234'], 1000),
      almacen: { rpc: async () => { const { ErrorAlmacen } = await import('../../src/server/almacen.ts'); throw new ErrorAlmacen(500, 'relation "panel.credenciales" does not exist at /var/lib/postgresql/x', '42P01'); } },
    });
    const r = await roto(new Request(ORIGEN + '/api/estado', { headers: { 'tailscale-user-login': USUARIO_RED } }));
    expect(r.status).toBe(503);
    const t = await r.text();
    expect(t).not.toMatch(/relation|panel\.|postgres|\/var\//);
  });
});

describe('redacción de secretos', () => {
  it('ocultarSecretos quita llaves conocidas de cualquier texto', () => {
    const t = ocultarSecretos(`a ${TOKEN} b sb_secret_abcdefghijklmnop c sb_publishable_abcdefghijklmnop d eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk e Bearer abcdefghijklmnopqrstuvwxyz`);
    expect(t).not.toMatch(/sbp_|sb_secret_|sb_publishable_|eyJ|abcdefghijklmnopqrstuvwxyz/);
    expect(t.match(/\[oculto\]/g)!.length).toBe(5);
  });

  it('limpiar oculta por NOMBRE de campo y deja el resto', () => {
    const r = limpiar({ nombre: 'ok', password: 'x', clave: 'x', secret: 'x', apikey: 'x', authorization: 'x', cookie: 'x', token: 'x', codigo: 'x', anidado: { llave: 'x', normal: 'y' } }) as Record<string, any>;
    expect(r.nombre).toBe('ok');
    for (const k of ['password', 'clave', 'secret', 'apikey', 'authorization', 'cookie', 'token', 'codigo']) expect(r[k], k).toBe('[oculto]');
    expect(r.anidado).toEqual({ llave: '[oculto]', normal: 'y' });
  });

  it('limpiar neutraliza saltos de línea (no se pueden falsificar líneas de log) y acota tamaño y profundidad', () => {
    const t = limpiar('linea1\n{"nivel":"info","evento":"falso"}\r\nlinea3') as string;
    expect(t).not.toMatch(/[\r\n]/);
    expect((limpiar('x'.repeat(5000)) as string).length).toBeLessThanOrEqual(304);
    let hondo: any = 'fin'; for (let i = 0; i < 50; i++) hondo = { a: hondo };
    expect(JSON.stringify(limpiar(hondo))).toContain('[…]');
    expect((limpiar(Array.from({ length: 1000 }, (_, i) => i)) as unknown[]).length).toBe(30);
  });
});
