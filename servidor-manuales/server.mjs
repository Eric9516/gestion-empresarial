// Servidor de archivos de Directorio: recibe y entrega manuales, despieces y planos.
// No guarda datos de negocio (eso está en Supabase): solo los archivos y, al lado de
// cada uno, un .json chico con su nombre original, tipo y tamaño.
//
// Quién puede qué (se pregunta a Supabase con la sesión de la persona):
//   subir / borrar        → administradores del Depósito y dueños
//   pedir link de descarga → cualquier usuario del Depósito
// La descarga en sí se hace con un link firmado que vence a los pocos minutos y que
// Nginx entrega directo del disco (X-Accel-Redirect).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import busboy from 'busboy';

function requerida(nombre) {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable ${nombre}`);
  return v;
}

const CFG = {
  puerto: Number(process.env.PORT || 3001),
  supabaseUrl: requerida('SUPABASE_URL').replace(/\/$/, ''),
  anonKey: requerida('SUPABASE_ANON_KEY'),
  secreto: requerida('LINK_SECRET'),
  baseUrl: requerida('PUBLIC_BASE_URL').replace(/\/$/, ''),
  dir: process.env.ARCHIVOS_DIR || '/srv/manuales/archivos',
  tmp: process.env.TMP_DIR || '/srv/manuales/tmp',
  maxBytes: Number(process.env.MAX_BYTES || 500 * 1024 * 1024),
  minLibre: 2 * 1024 ** 3,
  ttlLinkSeg: 600,
  origenes: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
};
if (CFG.secreto.length < 32) throw new Error('LINK_SECRET debe tener al menos 32 caracteres');

// Extensiones permitidas y su tipo de contenido (no se confía en el que manda el navegador).
const TIPOS = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip', '.dwg': 'application/octet-stream', '.dxf': 'application/octet-stream',
};
const SE_ABRE_EN_EL_NAVEGADOR = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.txt']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------- utilidades ----------
function responder(res, estado, cuerpo, cabeceras = {}) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabeceras });
  res.end(JSON.stringify(cuerpo));
}
const error = (res, estado, mensaje) => responder(res, estado, { error: mensaje });

function cors(req, res) {
  const origen = req.headers.origin;
  if (origen && CFG.origenes.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function rutaDe(id, ext) {
  return path.join(CFG.dir, id.slice(0, 2), id + ext);
}
const metaDe = id => path.join(CFG.dir, id.slice(0, 2), id + '.json');

async function leerMeta(id) {
  try { return JSON.parse(await fsp.readFile(metaDe(id), 'utf8')); } catch { return null; }
}

function limpiarNombre(nombre) {
  const base = path.basename(String(nombre || 'archivo')).replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, '_').trim();
  return (base || 'archivo').slice(0, 180);
}

async function espacioLibre() {
  const s = await fsp.statfs(CFG.dir);
  return s.bavail * s.bsize;
}

// ---------- links firmados ----------
const b64 = b => Buffer.from(b).toString('base64url');
const firmar = datos => crypto.createHmac('sha256', CFG.secreto).update(datos).digest('base64url');

function crearLink(id) {
  const exp = Math.floor(Date.now() / 1000) + CFG.ttlLinkSeg;
  const datos = b64(JSON.stringify({ i: id, e: exp }));
  return { url: `${CFG.baseUrl}/api/d/${datos}.${firmar(datos)}`, exp };
}

function leerLink(token) {
  const [datos, firma] = String(token).split('.');
  if (!datos || !firma) return null;
  const esperada = Buffer.from(firmar(datos));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  try {
    const { i, e } = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
    if (!UUID.test(i) || typeof e !== 'number' || e < Date.now() / 1000) return null;
    return i;
  } catch { return null; }
}

// ---------- quién es quién (Supabase) ----------
const cache = new Map(); // token → { usuario, hasta }
async function usuarioDe(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const token = m[1];
  const clave = crypto.createHash('sha256').update(token).digest('hex');
  const guardado = cache.get(clave);
  if (guardado && guardado.hasta > Date.now()) return guardado.usuario;

  const cab = { apikey: CFG.anonKey, Authorization: `Bearer ${token}` };
  try {
    const r = await fetch(`${CFG.supabaseUrl}/auth/v1/user`, { headers: cab, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id || !UUID.test(u.id)) return null;
    const p = await fetch(`${CFG.supabaseUrl}/rest/v1/usuarios_perfil?select=mantenimiento_rol,es_owner,activo&id=eq.${u.id}`, { headers: cab, signal: AbortSignal.timeout(8000) });
    if (!p.ok) return null;
    const [perfil] = await p.json();
    if (!perfil || perfil.activo === false) return null;
    const esOwner = perfil.es_owner === true;
    const usuario = {
      id: u.id,
      tieneDeposito: esOwner || perfil.mantenimiento_rol != null,
      esAdminDeposito: esOwner || perfil.mantenimiento_rol === 'admin',
    };
    if (cache.size > 200) cache.clear();
    cache.set(clave, { usuario, hasta: Date.now() + 30_000 });
    return usuario;
  } catch (e) {
    console.error('No se pudo consultar a Supabase:', e.message);
    return null;
  }
}

// ---------- subir ----------
function subir(req, res, usuario) {
  return new Promise(async resolve => {
    const largo = Number(req.headers['content-length'] || 0);
    if (largo > CFG.maxBytes + 1024 * 1024) { error(res, 413, `El archivo supera el máximo de ${Math.round(CFG.maxBytes / 1048576)} MB.`); return resolve(); }
    if (await espacioLibre() < CFG.minLibre + largo) { error(res, 507, 'El servidor no tiene espacio suficiente.'); return resolve(); }
    if (!/^multipart\/form-data/i.test(req.headers['content-type'] || '')) { error(res, 400, 'Se esperaba un formulario con el archivo.'); return resolve(); }

    await fsp.mkdir(CFG.tmp, { recursive: true });
    const id = crypto.randomUUID();
    const tmp = path.join(CFG.tmp, id + '.part');
    let recibido = null, fallo = null, truncado = false, terminado = false;

    const limpiar = () => fsp.unlink(tmp).catch(() => {});
    res.on('close', () => { if (!terminado) limpiar(); });

    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fields: 4, parts: 6, fileSize: CFG.maxBytes }, defParamCharset: 'utf8' });
    } catch { error(res, 400, 'Formulario inválido.'); return resolve(); }

    bb.on('file', (campo, flujo, info) => {
      const ext = path.extname(info.filename || '').toLowerCase();
      if (campo !== 'archivo' || recibido || fallo) { flujo.resume(); return; }
      if (!TIPOS[ext]) { fallo = [415, 'Tipo de archivo no permitido.']; flujo.resume(); return; }
      const salida = fs.createWriteStream(tmp, { mode: 0o640 });
      let bytes = 0;
      flujo.on('data', c => { bytes += c.length; });
      flujo.on('limit', () => { truncado = true; });
      recibido = {
        ext, nombre: limpiarNombre(info.filename),
        fin: new Promise((ok, ko) => { salida.on('finish', () => ok(bytes)); salida.on('error', ko); flujo.on('error', ko); }),
      };
      flujo.pipe(salida);
    });

    bb.on('error', () => { fallo = fallo || [400, 'No se pudo leer el archivo.']; });

    bb.on('close', async () => {
      try {
        if (fallo) { await limpiar(); error(res, ...fallo); return resolve(); }
        if (!recibido) { await limpiar(); error(res, 400, 'Falta el archivo.'); return resolve(); }
        const bytes = await recibido.fin;
        if (truncado) { await limpiar(); error(res, 413, `El archivo supera el máximo de ${Math.round(CFG.maxBytes / 1048576)} MB.`); return resolve(); }
        if (bytes === 0) { await limpiar(); error(res, 400, 'El archivo está vacío.'); return resolve(); }
        if (recibido.ext === '.pdf') {
          const fd = await fsp.open(tmp, 'r');
          const cab = Buffer.alloc(5);
          await fd.read(cab, 0, 5, 0);
          await fd.close();
          if (cab.toString('latin1') !== '%PDF-') { await limpiar(); error(res, 415, 'El archivo no es un PDF válido.'); return resolve(); }
        }
        await fsp.mkdir(path.dirname(rutaDe(id, recibido.ext)), { recursive: true });
        await fsp.rename(tmp, rutaDe(id, recibido.ext));
        const meta = { id, nombre: recibido.nombre, ext: recibido.ext, mime: TIPOS[recibido.ext], tamano: bytes, subidoPor: usuario.id, fecha: new Date().toISOString() };
        await fsp.writeFile(metaDe(id), JSON.stringify(meta), { mode: 0o640 });
        terminado = true;
        responder(res, 201, { id, nombre: meta.nombre, mime: meta.mime, tamano: bytes });
        console.log(`subido ${id} (${bytes} bytes) por ${usuario.id}`);
      } catch (e) {
        console.error('Error al guardar:', e);
        await limpiar();
        if (!res.headersSent) error(res, 500, 'No se pudo guardar el archivo.');
      }
      resolve();
    });

    req.pipe(bb);
  });
}

// ---------- rutas ----------
async function manejar(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  const ruta = url.pathname;

  if (req.method === 'GET' && ruta === '/api/salud') return responder(res, 200, { ok: true });

  // Descarga con link firmado (la abre el navegador directo, sin encabezado de sesión)
  let m = /^\/api\/d\/([A-Za-z0-9_.-]+)$/.exec(ruta);
  if (req.method === 'GET' && m) {
    const id = leerLink(m[1]);
    const meta = id && await leerMeta(id);
    if (!meta) return error(res, 404, 'El link venció o no es válido. Pedí uno nuevo desde la app.');
    const inline = SE_ABRE_EN_EL_NAVEGADOR.has(meta.ext);
    res.writeHead(200, {
      'Content-Type': meta.mime,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.nombre)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
      'X-Accel-Redirect': `/_archivos/${id.slice(0, 2)}/${id}${meta.ext}`,
    });
    return res.end();
  }

  // El resto pide sesión
  const usuario = await usuarioDe(req);
  if (!usuario) return error(res, 401, 'Tenés que iniciar sesión.');

  if (req.method === 'POST' && ruta === '/api/archivos') {
    if (!usuario.esAdminDeposito) return error(res, 403, 'Solo los administradores del Depósito pueden subir archivos.');
    return subir(req, res, usuario);
  }

  m = /^\/api\/archivos\/([0-9a-f-]{36})\/enlace$/.exec(ruta);
  if (req.method === 'GET' && m && UUID.test(m[1])) {
    if (!usuario.tieneDeposito) return error(res, 403, 'No tenés acceso al Depósito.');
    const meta = await leerMeta(m[1]);
    if (!meta) return error(res, 404, 'El archivo no existe.');
    const { url: link, exp } = crearLink(m[1]);
    return responder(res, 200, { url: link, expira: exp, nombre: meta.nombre, mime: meta.mime, tamano: meta.tamano });
  }

  m = /^\/api\/archivos\/([0-9a-f-]{36})$/.exec(ruta);
  if (req.method === 'DELETE' && m && UUID.test(m[1])) {
    if (!usuario.esAdminDeposito) return error(res, 403, 'Solo los administradores del Depósito pueden borrar archivos.');
    const meta = await leerMeta(m[1]);
    if (!meta) return error(res, 404, 'El archivo no existe.');
    await fsp.unlink(rutaDe(m[1], meta.ext)).catch(() => {});
    await fsp.unlink(metaDe(m[1])).catch(() => {});
    console.log(`borrado ${m[1]} por ${usuario.id}`);
    return responder(res, 200, { ok: true });
  }

  return error(res, 404, 'No existe.');
}

// Archivos a medio subir que quedaron de un corte: se limpian al arrancar.
async function limpiarTemporales() {
  try {
    await fsp.mkdir(CFG.tmp, { recursive: true });
    for (const n of await fsp.readdir(CFG.tmp)) {
      const p = path.join(CFG.tmp, n);
      const st = await fsp.stat(p);
      if (Date.now() - st.mtimeMs > 24 * 3600 * 1000) await fsp.unlink(p).catch(() => {});
    }
  } catch (e) { console.error('No se pudo limpiar temporales:', e.message); }
}

const servidor = http.createServer((req, res) => {
  manejar(req, res).catch(e => {
    console.error('Error no controlado:', e);
    if (!res.headersSent) error(res, 500, 'Error interno.');
    else res.end();
  });
});
servidor.requestTimeout = 30 * 60 * 1000; // subidas grandes con conexión lenta
servidor.headersTimeout = 30 * 1000;

await limpiarTemporales();
servidor.listen(CFG.puerto, '127.0.0.1', () => console.log(`Servidor de archivos escuchando en 127.0.0.1:${CFG.puerto}`));
