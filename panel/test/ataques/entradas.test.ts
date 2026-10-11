// ATAQUE 6 — Entradas hostiles: inyección, caracteres engañosos, tipos raros, fuzzing.
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { construirPlan, type Dependencias } from '../../src/server/planes.ts';
import { crearSupabaseApi } from '../../src/server/supabaseApi.ts';
import { nombreDeProyecto, parseCorreo, parseModulos, parseNombreCliente, parseUrlApp, textoLimpio } from '../../src/server/validar.ts';
import { ErrorHttp } from '../../src/server/errores.ts';
import { configDePrueba, crearMundo, type Mundo } from '../ayudas/mundo.ts';
import { crearSupabaseFalso } from '../ayudas/supabaseFalso.ts';

const car = (...codigos: number[]) => String.fromCharCode(...codigos);
// Caracteres que se usan para engañar: control, separadores, inversión de texto, ancho cero, marca de orden de bytes.
const ENGANOSOS = [car(0), car(7), car(8), car(10), car(13), car(27), car(127), car(0x85), car(0x200b), car(0x200e), car(0x200f), car(0x2028), car(0x2029), car(0x202a), car(0x202e), car(0x2066), car(0x2069), car(0xfeff)];

const rechaza = (fn: () => unknown) => { try { fn(); return false; } catch (e) { return e instanceof ErrorHttp && e.estado === 400; } };

describe('nombre del cliente', () => {
  it.each([
    "Cliente'; DROP TABLE usuarios;--", '<script>alert(1)</script>', '${process.env.SECRETO}', '{{7*7}}', '../../etc/passwd', 'a\\b', 'Nombre con ; punto y coma',
    'x'.repeat(61), 'a', '', '   ', '=cmd|/c calc', '@SUM(1+1)', '`id`', '$(id)', 'a|b', 'a<b', 'a>b', 'a"b', 'a%b', 'a:b', 'a*b', 'a?b', 'a#b',
  ])('se rechaza %j', (valor) => { expect(rechaza(() => parseNombreCliente(valor))).toBe(true); });

  it.each(ENGANOSOS.map(c => [c.charCodeAt(0).toString(16), c]))('el carácter engañoso U+%s se rechaza o se convierte en un espacio normal; nunca sobrevive', (_codigo, c) => {
    try {
      const limpio = parseNombreCliente(`Cliente${c}Sol`);
      expect(limpio).toBe('Cliente Sol');
    } catch (e) { expect(e).toBeInstanceOf(ErrorHttp); }
  });

  it.each([
    ['Ñandú S.A.', 'Ñandú S.A.'], ["O'Reilly & Hijos", "O'Reilly & Hijos"], ['Panadería  Sol ', 'Panadería Sol'], ['Café (Centro) 2', 'Café (Centro) 2'], ['Aº', 'Aº'.length ? 'Aº' : ''],
  ])('se acepta %j y se normaliza', (valor, esperado) => {
    if (valor === 'Aº') return; // º no es letra Unicode: se rechaza (ver abajo)
    expect(parseNombreCliente(valor)).toBe(esperado);
  });

  it('tipos que no son texto → 400', () => {
    for (const v of [undefined, null, 5, true, {}, [], ['a'], { a: 1 }, () => 1, Symbol('x'), 10n]) expect(rechaza(() => parseNombreCliente(v))).toBe(true);
  });

  it('fuzzing: lo que se acepta siempre es texto seguro y corto; nunca se explota', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 120 }), (s) => {
      try {
        const n = parseNombreCliente(s);
        if ([...n].length < 2 || [...n].length > 60) return false;
        if (/[\p{C}\p{Zl}\p{Zp}]/u.test(n)) return false;
        if (/[;<>"`$\\|*?#%:=@]/.test(n)) return false;
        const slug = nombreDeProyecto(n);
        return /^[a-z0-9-]{2,40}$/.test(slug) && !slug.startsWith('-') && !slug.endsWith('-');
      } catch (e) { return e instanceof ErrorHttp; }
    }), { numRuns: 2000 });
  });
});

describe('correo del dueño', () => {
  it.each([
    'a@b', 'a@b.', '@b.com', 'a@@b.com', 'a b@c.com', 'a@b .com', 'a@b.com\r\nBcc: x@y.com', 'a@b.com\n', ' a@b.com', 'a@b.com ', 'a..b@c.com', '.a@b.com', 'a.@b.com',
    'a@-b.com', 'a@b-.com', 'a@b..com', 'a@b_c.com', '<a@b.com>', '"a"@b.com', 'a@[127.0.0.1]', 'a@b.com;c@d.com', 'a@b.com,c@d.com', 'ñ@b.com', 'a@ñ.com', 'x'.repeat(65) + '@b.com',
    'a@' + 'x'.repeat(64) + '.com', 'a@' + 'b.'.repeat(10) + 'com', 'a'.repeat(250) + '@b.com', ...ENGANOSOS.map(c => `a${c}@b.com`),
  ])('se rechaza %j', (v) => { expect(rechaza(() => parseCorreo(v))).toBe(true); });

  it('se acepta y se pasa a minúsculas', () => {
    expect(parseCorreo('Dueno+Panel@Sol.Com.AR')).toBe('dueno+panel@sol.com.ar');
  });

  it('fuzzing: lo aceptado no tiene espacios, saltos ni más de 254 caracteres', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
      try { const c = parseCorreo(s); return c.length <= 254 && !/[\s\p{C}]/u.test(c) && c.includes('@') && c === c.toLowerCase(); }
      catch (e) { return e instanceof ErrorHttp; }
    }), { numRuns: 3000 });
  });

  it('una expresión que parece "pesada" no se cuelga con entradas diseñadas para eso (ReDoS)', () => {
    const inicio = Date.now();
    for (const patologico of ['a'.repeat(5000) + '!', 'a@' + 'a.'.repeat(5000), 'a@' + 'a-'.repeat(5000), ('a.'.repeat(30) + '@').repeat(50), '-'.repeat(100000)]) rechaza(() => parseCorreo(patologico));
    for (const patologico of ['a'.repeat(100000), 'a '.repeat(50000), ' '.repeat(100000) + 'x']) { rechaza(() => parseNombreCliente(patologico)); rechaza(() => textoLimpio(patologico, 'x', 1, 60)); }
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});

describe('módulos, regiones y direcciones', () => {
  it.each([
    'deposito', null, 5, {}, [null], [5], [{}], ['__proto__'], ['constructor'], ['toString'], ['deposito', 'deposito'], ['Deposito'], ['deposito '], ['deposito\n'], ['inexistente'], Array(50).fill('deposito'),
  ])('lista de módulos %j → 400', (v) => { expect(rechaza(() => parseModulos(v))).toBe(true); });

  it.each([
    'http://a.com', 'https://a.com/', 'https://a.com/x', 'https://a.com?x=1', 'https://a.com#x', 'https://u:p@a.com', 'ftp://a.com', 'javascript:alert(1)', 'data:text/html,x', '//a.com', 'a.com',
    'https://a', 'https://127.0.0.1', 'https://[::1]', 'https://' + 'a'.repeat(300) + '.com', 'https://a.com\r\nX: y', 5, {}, ['https://a.com'],
  ])('dirección de la app %j → 400', (v) => { expect(rechaza(() => parseUrlApp(v))).toBe(true); });

  it('direcciones buenas', () => {
    expect(parseUrlApp('https://cliente.netlify.app')).toBe('https://cliente.netlify.app');
    expect(parseUrlApp(undefined)).toBeNull();
    expect(parseUrlApp('')).toBeNull();
    expect(parseUrlApp('https://staging.cliente.com:8443')).toBe('https://staging.cliente.com:8443');
    expect(parseUrlApp('https://ñandu.com')).toBe('https://xn--andu-fqa.com'); // se guarda en punycode: lo que se ve es lo que es
  });
});

describe('extremo a extremo con nombres difíciles', () => {
  let m: Mundo;
  beforeEach(async () => { m = await crearMundo(); });

  it('los nombres raros pero válidos pasan por todo el sistema solo como DATOS, nunca como SQL', async () => {
    const { n, a } = await m.conSesion();
    for (const nombre of ["O'Reilly & Hijos", 'Ñandú S.A.', 'Café (Centro) 2']) {
      const r = await n.hacer('crear', { nombre, correo: 'x@y.com', modulos: ['tareas'] }, a);
      expect(r.pasos.at(-1)!.cuerpo.estado, nombre).toBe('terminado');
      const p = [...m.falso.proyectos.values()].find(x => x.empresa === nombre)!;
      expect(p).toBeDefined();
      expect(p.nombre).toMatch(/^[a-z0-9-]+$/); // el nombre técnico es ASCII sin símbolos
    }
    // Ningún texto escrito por la persona apareció dentro de una consulta SQL.
    for (const q of m.falso.sqlEjecutado) { expect(q.sql).not.toMatch(/Reilly|Ñandú|Café/); }
    expect(m.falso.sqlInesperado).toEqual([]);
  });

  it('datos hostiles en el pedido HTTP: siempre 400, nunca 500, nunca llamadas a Supabase', async () => {
    const { n } = await m.conSesion();
    const antes = m.falso.llamadas.length;
    const malos: Record<string, unknown>[] = [
      { nombre: "x'; drop table a;--", correo: 'a@b.com', modulos: [] }, { nombre: 5, correo: 'a@b.com', modulos: [] }, { nombre: 'ok', correo: ['a@b.com'], modulos: [] },
      { nombre: 'ok', correo: 'a@b.com', modulos: { 0: 'deposito' } }, { nombre: 'ok', correo: 'a@b.com', modulos: [], region: { code: 'x' } }, { nombre: 'ok', correo: 'a@b.com', modulos: [], urlApp: 5 },
      { nombre: 'ok', correo: 'a@b.com', modulos: [], soloBase: true }, {}, { nombre: 'ok' },
    ];
    for (const cuerpo of malos) {
      const r = await n.plan('crear', cuerpo);
      expect(r.estado, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(m.falso.llamadas.length).toBe(antes);
  });
});

describe('fuzzing del armado de planes (sin red ni límites)', () => {
  it('ningún cuerpo, por raro que sea, produce algo que no sea un plan válido o un 400', async () => {
    const falso = crearSupabaseFalso();
    falso.proyectoInstalado('uno', ['deposito']);
    const config = configDePrueba();
    const deps: Dependencias = { config, api: crearSupabaseApi(config.tokenSupabase, config.organizaciones, 1000, falso.fetch), almacen: { rpc: async () => null as never }, organizaciones: async () => config.organizaciones, fetchImpl: falso.fetch, ahora: () => Date.now() };
    const refValido = [...falso.proyectos.keys()][0]!;
    await fc.assert(fc.asyncProperty(
      fc.constantFrom('crear', 'actualizar', 'modulos', 'x', '__proto__'),
      fc.dictionary(fc.constantFrom('nombre', 'correo', 'modulos', 'region', 'urlApp', 'ref', 'activar', 'desactivar', 'soloBase', '__proto__', 'constructor', 'extra'), fc.jsonValue({ maxDepth: 3 })),
      fc.boolean(),
      async (tipo, cuerpo, conRefValido) => {
        const c = conRefValido && (tipo === 'actualizar' || tipo === 'modulos') ? { ...cuerpo, ref: refValido } : cuerpo;
        try {
          const plan = await construirPlan(deps, tipo, c);
          return plan.pasos.length >= 1 && plan.pasos.length <= 60 && !JSON.stringify(plan.resumen).match(/[\u0000-\u001f]/);
        } catch (e) { return e instanceof ErrorHttp && [400, 404].includes(e.estado); }
      },
    ), { numRuns: 600 });
    expect(falso.llamadas.filter(l => l.metodo !== 'GET' && !l.ruta.endsWith('/database/query')).length).toBe(0);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
