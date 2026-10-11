// La parte "GoTrue" del Supabase local: ingreso con correo y contraseña, renovación de sesión y administración de usuarios.
import { ErrorRest } from './rest.mjs';

const falla = (estado, error_code, msg) => ({ estado, cuerpo: { code: estado, error_code, msg } });
const normalizar = (c) => String(c ?? '').trim().toLowerCase();

const consultar = (p, sql, params = []) => p.serializar(async () => (await p.db.query(sql, params)).rows);

async function usuarioPorEmail(p, email) { return (await consultar(p, 'select id, email, raw_user_meta_data, created_at from auth.users where lower(email) = $1', [normalizar(email)]))[0]; }
async function usuarioPorId(p, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return undefined;
  return (await consultar(p, 'select id, email, raw_user_meta_data, created_at from auth.users where id = $1', [id]))[0];
}

export async function atenderAuth(p, { metodo, ruta, query, cuerpo, claims }) {
  const rol = claims?.role;

  if (ruta === 'settings' && metodo === 'GET') return { estado: 200, cuerpo: { external: { email: true }, disable_signup: true, mailer_autoconfirm: true, phone_autoconfirm: false } };

  if (ruta === 'token' && metodo === 'POST') {
    const tipo = query.get('grant_type');
    if (tipo === 'password') {
      const u = await usuarioPorEmail(p, cuerpo?.email);
      if (!u || typeof cuerpo?.password !== 'string' || !p.claveCorrecta(u.id, cuerpo.password)) return falla(400, 'invalid_credentials', 'Invalid login credentials');
      return { estado: 200, cuerpo: p.tokenDeUsuario(u) };
    }
    if (tipo === 'refresh_token') {
      const id = p.refrescos.get(cuerpo?.refresh_token);
      const u = id ? await usuarioPorId(p, id) : null;
      if (!u) return falla(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      p.refrescos.delete(cuerpo.refresh_token);
      return { estado: 200, cuerpo: p.tokenDeUsuario(u) };
    }
    return falla(400, 'validation_failed', 'Unsupported grant_type');
  }

  if (ruta === 'signup' && metodo === 'POST') return falla(422, 'signup_disabled', 'Signups not allowed for this instance');
  if (ruta === 'logout' && metodo === 'POST') return { estado: 204, cuerpo: undefined };

  if (ruta === 'user') {
    if (rol !== 'authenticated') return falla(401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is malformed or has no user');
    const u = await usuarioPorId(p, claims.sub);
    if (!u) return falla(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    if (metodo === 'GET') return { estado: 200, cuerpo: p.usuarioPublico(u) };
    if (metodo === 'PUT') {
      if (cuerpo?.password) p.establecerClave(u.id, cuerpo.password);
      return { estado: 200, cuerpo: p.usuarioPublico(u) };
    }
  }

  // ---- administración (solo con la clave de servicio) ----
  if (ruta === 'admin/users' || ruta.startsWith('admin/users/')) {
    if (rol !== 'service_role') return falla(403, 'not_admin', 'User not allowed');
    const id = ruta.startsWith('admin/users/') ? ruta.slice('admin/users/'.length) : null;
    if (!id && metodo === 'POST') {
      const email = normalizar(cuerpo?.email);
      if (!email || typeof cuerpo?.password !== 'string' || cuerpo.password.length < 6) return falla(422, 'validation_failed', 'Email o contraseña inválidos');
      if (await usuarioPorEmail(p, email)) return falla(422, 'email_exists', 'A user with this email address has already been registered');
      const fila = (await consultar(p, 'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id, email, raw_user_meta_data, created_at', [email, JSON.stringify(cuerpo.user_metadata ?? {})]))[0];
      p.establecerClave(fila.id, cuerpo.password);
      p.invalidarEsquema();
      return { estado: 200, cuerpo: p.usuarioPublico(fila) };
    }
    if (!id && metodo === 'GET') {
      const filas = await consultar(p, 'select id, email, raw_user_meta_data, created_at from auth.users order by created_at');
      return { estado: 200, cuerpo: { users: filas.map((f) => p.usuarioPublico(f)), aud: 'authenticated' } };
    }
    if (id) {
      const u = await usuarioPorId(p, id);
      if (!u) return falla(404, 'user_not_found', 'User not found');
      if (metodo === 'GET') return { estado: 200, cuerpo: p.usuarioPublico(u) };
      if (metodo === 'PUT') {
        if (cuerpo?.password) p.establecerClave(u.id, cuerpo.password);
        if (cuerpo?.email) await consultar(p, 'update auth.users set email = $2 where id = $1', [u.id, normalizar(cuerpo.email)]);
        if (cuerpo?.user_metadata) await consultar(p, 'update auth.users set raw_user_meta_data = $2::jsonb where id = $1', [u.id, JSON.stringify(cuerpo.user_metadata)]);
        return { estado: 200, cuerpo: p.usuarioPublico((await usuarioPorId(p, id))) };
      }
      if (metodo === 'DELETE') {
        await consultar(p, 'delete from auth.users where id = $1', [u.id]);
        p.claves.delete(u.id);
        return { estado: 200, cuerpo: {} };
      }
    }
  }
  throw new ErrorRest(404, 'not_found', `Ruta de auth no soportada por el Supabase local: ${metodo} ${ruta}`);
}
