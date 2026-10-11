// ATAQUE 9 — Revisión estática del código: patrones peligrosos, dependencias, aislamiento.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(import.meta.dirname, '..', '..');
const leer = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');
function archivos(dir: string, exts = ['.ts', '.mjs', '.html', '.css']): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : archivos(ruta, exts);
    return exts.some(x => e.name.endsWith(x)) && e.name !== 'generado.ts' ? [ruta] : [];
  });
}
const servidor = archivos(join(RAIZ, 'src', 'server')).concat(join(RAIZ, 'src', 'servidor.ts'), join(RAIZ, 'src', 'principal.ts'));
const web = archivos(join(RAIZ, 'src', 'web'));
// Los comentarios explican lo que NO se hace y por eso nombran lo prohibido: se revisa solo el código.
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const nombre = (f: string) => relative(RAIZ, f).replaceAll('\\', '/');

describe('código del servidor', () => {
  it.each([
    ['eval', /\beval\s*\(/], ['new Function', /new\s+Function\s*\(/], ['child_process', /child_process|execSync|spawnSync|\bexec\(|\bspawn\(/],
    ['vm', /node:vm|require\(['"]vm['"]\)/], ['Math.random (no es seguro)', /Math\.random/], ['fetch sin tiempo máximo y sin "redirect"', /(?<!\.)\bfetch\(\s*[^)]*\)\s*(?!;)(?<!signal)/s],
    ['TLS desactivado', /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/], ['desactivar verificación', /unsafe-perm|--insecure|strictSSL/],
  ])('no usa %s', (_n, patron) => {
    if (_n.startsWith('fetch')) return; // revisado aparte (más abajo)
    for (const f of servidor) expect(readFileSync(f, 'utf8'), nombre(f)).not.toMatch(patron);
  });

  it('todo fetch hacia afuera lleva tiempo máximo y no sigue redirecciones', () => {
    for (const f of servidor) {
      const t = readFileSync(f, 'utf8');
      const llamadas = [...t.matchAll(/(?<![.\w])(?:fetchImpl|fetch)\(/g)];
      for (const l of llamadas) {
        const trozo = t.slice(l.index, l.index + 500);
        if (/function|=>\s*{?\s*$/.test(trozo.slice(0, 40))) continue;
        expect(trozo, `${nombre(f)} cerca de ${t.slice(0, l.index).split('\n').length}`).toMatch(/signal:\s*AbortSignal\.timeout/);
        expect(trozo).toMatch(/redirect:\s*'error'/);
      }
    }
  });

  it('solo almacen.ts habla con la base, y solo con parámetros (nunca pega valores en el SQL)', () => {
    for (const f of servidor) {
      const t = readFileSync(f, 'utf8');
      if (nombre(f).endsWith('almacen.ts')) continue;
      expect(t, nombre(f)).not.toMatch(/from 'postgres'|\.unsafe\(|\bsql`/);
    }
    const a = leer('src', 'server', 'almacen.ts');
    expect(a.match(/\.unsafe\(/g)!.length).toBe(1);
    expect(a).toMatch(/NOMBRE_FUNCION = \/\^panel_/);
  });

  it('el SQL que se manda a los proyectos de clientes sale solo de textos fijos y de las migraciones empaquetadas', () => {
    const p = leer('src', 'server', 'planes.ts');
    const consultas = [...p.matchAll(/api\.consultar\(\s*ref,\s*([^,)]+)/g)].map(x => x[1]!.trim());
    // Cada consulta es una plantilla fija; las únicas variables interpoladas son REG (constante) y m.nombre/m.sql (empaquetados y validados).
    for (const c of consultas) expect(c).toMatch(/^[`'"]|^\`/);
    const interpolaciones = [...p.matchAll(/consultar\([^;]*?\$\{([^}]+)\}/gs)].map(x => x[1]!.trim());
    for (const i of interpolaciones) expect(['REG', 'm.nombre', 'm.sql', 'REG'].includes(i), `interpolación inesperada en SQL: ${i}`).toBe(true);
  });

  it('process.env solo se lee en el arranque', () => {
    for (const f of servidor) {
      const t = readFileSync(f, 'utf8');
      if (/process\.env/.test(t)) expect(['src/principal.ts'], nombre(f)).toContain(nombre(f));
    }
  });

  it('console.* solo se usa en registro.ts (todo lo demás pasa por la redacción de secretos)', () => {
    for (const f of servidor) {
      if (nombre(f).endsWith('registro.ts')) continue;
      expect(readFileSync(f, 'utf8'), nombre(f)).not.toMatch(/console\.(log|error|warn|info|debug)/);
    }
  });

  it('el servidor no lee ni escribe archivos por pedido (solo carga la interfaz al arrancar)', () => {
    for (const f of servidor) {
      const t = readFileSync(f, 'utf8');
      if (/node:fs|from 'fs'/.test(t)) expect(['src/servidor.ts', 'src/principal.ts'], nombre(f)).toContain(nombre(f));
    }
    const s = leer('src', 'servidor.ts');
    expect(s).not.toMatch(/readFile\(|createReadStream|sendFile/); // solo readFileSync dentro de cargarInterfaz
    expect(s.match(/readFileSync\(/g)!.length).toBe(1);
  });

  it('solo escucha en 127.0.0.1 (nunca en todas las interfaces)', () => {
    const t = leer('src', 'principal.ts');
    expect(t).toMatch(/listen\(config\.puerto, '127\.0\.0\.1'/);
    for (const f of servidor) expect(readFileSync(f, 'utf8'), nombre(f)).not.toMatch(/0\.0\.0\.0|listen\(\s*\w+\s*\)|'::'/);
  });

  it('las comparaciones de secretos son en tiempo constante', () => {
    for (const f of servidor) {
      const t = readFileSync(f, 'utf8');
      expect(t, nombre(f)).not.toMatch(/(codigoAlta|tokenSupabase|secreto|usuarioRed)\s*(===|!==|==|!=)/);
      expect(t, nombre(f)).not.toMatch(/(===|!==)\s*config\.(codigoAlta|secreto|tokenSupabase|usuarioRed)/);
    }
  });

  it('no hay credenciales escritas en el código', () => {
    for (const f of [...servidor, ...web, ...archivos(join(RAIZ, 'test')), ...archivos(join(RAIZ, 'scripts'))]) {
      const t = readFileSync(f, 'utf8');
      expect(t, nombre(f)).not.toMatch(/sbp_[A-Za-z0-9]{30,}(?!.*a{30})/);
      expect(t, nombre(f)).not.toMatch(/sb_secret_[A-Za-z0-9]{20,}|BEGIN (RSA |EC )?PRIVATE KEY/);
    }
  });
});

describe('interfaz', () => {
  it.each([
    ['innerHTML', /innerHTML/], ['outerHTML', /outerHTML/], ['insertAdjacentHTML', /insertAdjacentHTML/], ['document.write', /document\.write/], ['eval', /\beval\s*\(/],
    ['new Function', /new\s+Function/], ['setTimeout con texto', /setTimeout\(\s*['"`]/], ['atributos on* escritos a mano', /\bon(click|load|error)=/i], ['javascript:', /javascript:/i],
    ['almacenamiento del navegador', /localStorage|sessionStorage|indexedDB|document\.cookie/], ['conexiones a otros sitios', /(fetch|import|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(\s*['"`]https?:/], ['postMessage', /postMessage/],
    ['window.open', /window\.open/], ['eventos de arrastre/pegado inseguros', /dangerouslySetInnerHTML/],
  ])('la interfaz no usa %s', (_n, patron) => {
    for (const f of web.filter(x => x.endsWith('.ts'))) expect(sinComentarios(readFileSync(f, 'utf8')), nombre(f)).not.toMatch(patron);
  });

  it('el HTML no tiene scripts ni estilos en línea, ni recursos de otros sitios', () => {
    const html = readFileSync(join(RAIZ, 'src', 'web', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/<style|style=|\bon\w+=/i);
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).toMatch(/<script type="module" src="\/app\.js">/);
  });

  it('el archivo que llega al navegador (ya empaquetado) no trae secretos, código dinámico ni sumideros peligrosos', () => {
    const salida = mkdtempSync(join(tmpdir(), 'panel-web-estatico-'));
    execFileSync('node', ['scripts/build-web.mjs'], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, PANEL_SALIDA_WEB: salida } });
    const js = readFileSync(join(salida, 'app.js'), 'utf8');
    expect(js.length).toBeGreaterThan(5000);
    for (const [nombre, patron] of [
      ['llave de Supabase', /sbp_|sb_secret_|service_role|eyJhbGci/], ['eval', /\beval\s*\(/], ['new Function', /new Function\s*\(/], ['innerHTML', /innerHTML|outerHTML|insertAdjacentHTML/],
      ['document.write', /document\.write/], ['mapa de código', /sourceMappingURL/], ['rutas del equipo', /C:\\\\Users|\/home\/|node_modules/], ['almacenamiento del navegador', /localStorage|sessionStorage|indexedDB/],
    ] as [string, RegExp][]) expect(js, nombre).not.toMatch(patron);
    expect(readdirSync(salida).sort()).toEqual(['app.js', 'estilos.css', 'index.html']); // sin mapas ni archivos de más
  }, 60_000);

  it('el CSS no carga nada de afuera', () => {
    const css = readFileSync(join(RAIZ, 'src', 'web', 'estilos.css'), 'utf8');
    expect(css).not.toMatch(/@import|url\(/i);
  });
});

describe('lo que el panel instala en los clientes (supply chain)', () => {
  it('las funciones del servidor importan librerías externas con versión EXACTA (nada de "@2" ni "latest")', async () => {
    const { FUNCIONES } = await import('../../src/server/generado.ts');
    expect(FUNCIONES.length).toBeGreaterThan(0);
    for (const f of FUNCIONES) {
      const imports = [...f.fuente.matchAll(/from\s+['"]((?:https?:\/\/|npm:|jsr:)[^'"]+)['"]/g)].map(x => x[1]!);
      expect(imports.length, f.slug).toBeGreaterThan(0);
      for (const i of imports) expect(i, `${f.slug}: ${i}`).toMatch(/@\d+\.\d+\.\d+(?:[/?]|$)/);
    }
  });
  it('las migraciones empaquetadas no descargan ni ejecutan nada de afuera', async () => {
    const { MIGRACIONES } = await import('../../src/server/generado.ts');
    for (const m of MIGRACIONES) {
      expect(m.sql, m.nombre).not.toMatch(/\bcopy\b[^;]*\bprogram\b|\bdblink\b|create\s+extension\s+(?:if\s+not\s+exists\s+)?(?:file_fdw|postgres_fdw|plpython|plperl|pltcl)|pg_read_server_files|lo_import|lo_export/i);
    }
  });
});

describe('dependencias y aislamiento', () => {
  const pkg = JSON.parse(leer('package.json'));
  it('solo hay dos dependencias de ejecución, con versión exacta', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@simplewebauthn/server', 'postgres']);
    for (const v of Object.values<string>({ ...pkg.dependencies, ...pkg.devDependencies })) expect(v, v).toMatch(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/);
  });
  it('NINGUNA dependencia de producción (ni las que trae por dentro) trae scripts que se ejecuten al instalar', () => {
    const salida = execFileSync('pnpm', ['ls', '--prod', '--depth', 'Infinity', '--parseable'], { cwd: RAIZ, shell: true, encoding: 'utf8' });
    const rutas = salida.split(/\r?\n/).map(x => x.trim()).filter(x => x && x !== RAIZ);
    expect(rutas.length).toBeGreaterThan(10);
    for (const r of rutas) {
      const p = JSON.parse(readFileSync(join(r, 'package.json'), 'utf8')) as { name: string; scripts?: Record<string, string> };
      for (const s of ['preinstall', 'install', 'postinstall']) expect(p.scripts?.[s], `${p.name} tiene script ${s}`).toBeUndefined();
    }
  }, 60_000);

  it('no hay scripts de instalación automáticos ni de publicación', () => {
    for (const s of ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare']) expect(pkg.scripts?.[s]).toBeUndefined();
    expect(pkg.private).toBe(true);
  });
  it('el candado de dependencias existe y exige antigüedad mínima', () => {
    expect(leer('pnpm-lock.yaml').length).toBeGreaterThan(1000);
    expect(leer('pnpm-workspace.yaml')).toMatch(/minimumReleaseAge:\s*\d{4,}/);
  });
  it('el panel no comparte código con las apps de los clientes (ni de ida ni de vuelta)', () => {
    for (const f of [...servidor, ...web]) expect(readFileSync(f, 'utf8'), nombre(f)).not.toMatch(/from ['"](\.\.\/)+src\/|from ['"]@\//);
    const raiz = readFileSync(join(RAIZ, '..', 'src', 'App.tsx'), 'utf8');
    expect(raiz).not.toMatch(/panel\//);
  });
});
