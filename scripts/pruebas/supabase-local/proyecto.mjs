// Un "proyecto de Supabase" local: una base PostgreSQL real (PGlite) con las piezas de Supabase simuladas, claves firmadas,
// usuarios con contraseña, archivos en memoria, secretos y funciones del servidor. Lo usa servidor.mjs.
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { crearBase } from '../esquema/base.mjs';

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export function firmarJwt(payload, secreto) {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${cuerpo}.${createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}

/** Devuelve el contenido del token si la firma y el vencimiento están bien; si no, null. */
export function verificarJwt(token, secreto) {
  const partes = String(token ?? '').split('.');
  if (partes.length !== 3) return null;
  const esperada = createHmac('sha256', secreto).update(`${partes[0]}.${partes[1]}`).digest();
  const dada = Buffer.from(partes[2], 'base64url');
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  let p; try { p = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')); } catch { return null; }
  if (typeof p.exp === 'number' && p.exp < Date.now() / 1000) return null;
  return p;
}

const hashClave = (clave, sal = randomBytes(16)) => ({ sal, hash: scryptSync(clave, sal, 32) });

export class Proyecto {
  constructor({ ref, nombre, db, secretoJwt }) {
    this.ref = ref; this.nombre = nombre; this.db = db;
    this.secretoJwt = secretoJwt ?? randomBytes(32).toString('hex');
    const ahora = Math.floor(Date.now() / 1000);
    this.claveAnon = firmarJwt({ iss: 'supabase-local', ref, role: 'anon', iat: ahora, exp: ahora + 10 * 365 * 86400 }, this.secretoJwt);
    this.claveServicio = firmarJwt({ iss: 'supabase-local', ref, role: 'service_role', iat: ahora, exp: ahora + 10 * 365 * 86400 }, this.secretoJwt);
    this.claves = new Map();            // id de usuario -> { sal, hash }
    this.refrescos = new Map();         // refresh_token -> id de usuario
    this.objetos = new Map();           // "bucket/ruta" -> Buffer
    this.secretos = new Map();
    this.funciones = new Map();         // nombre -> código fuente
    this.esquema = null;                // caché de tablas, columnas y claves (se recalcula cuando cambia la base)
    this.registro = [];                 // pedidos atendidos (para depurar)
    this._cola = Promise.resolve();
  }

  /** Las consultas de PGlite van de a una: se ordenan en una cola. */
  serializar(fn) {
    const siguiente = this._cola.then(fn, fn);
    this._cola = siguiente.catch(() => {});
    return siguiente;
  }

  invalidarEsquema() { this.esquema = null; }

  establecerClave(id, clave) { this.claves.set(id, hashClave(clave)); }
  claveCorrecta(id, clave) {
    const r = this.claves.get(id);
    if (!r) return false;
    const h = scryptSync(clave, r.sal, 32);
    return timingSafeEqual(h, r.hash);
  }

  tokenDeUsuario(usuario, segundos = 3600) {
    const ahora = Math.floor(Date.now() / 1000);
    const access = firmarJwt({ iss: 'supabase-local', ref: this.ref, aud: 'authenticated', role: 'authenticated', sub: usuario.id, email: usuario.email, user_metadata: usuario.raw_user_meta_data ?? {}, iat: ahora, exp: ahora + segundos }, this.secretoJwt);
    const refresh = randomBytes(18).toString('base64url');
    this.refrescos.set(refresh, usuario.id);
    return { access_token: access, token_type: 'bearer', expires_in: segundos, expires_at: ahora + segundos, refresh_token: refresh, user: this.usuarioPublico(usuario) };
  }

  usuarioPublico(u) {
    return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {}, created_at: u.created_at, updated_at: u.created_at };
  }
}

/** Crea un proyecto con la base armada con esos archivos SQL (rutas absolutas) y sus piezas de Supabase. */
export async function crearProyecto({ ref = [...Array(20)].map(() => 'abcdefghijklmnopqrst'[Math.floor(Math.random() * 20)]).join(''), nombre = ref, archivos = [], secretoJwt } = {}) {
  const db = await crearBase(archivos);
  return new Proyecto({ ref, nombre, db, secretoJwt });
}

export { randomUUID };
