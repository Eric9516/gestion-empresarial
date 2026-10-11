// Configuración del panel: sale SOLO de variables de entorno del servidor. Si algo falta o es débil, el panel
// no arranca ("falla cerrado"): se niega a iniciar y deja el detalle (qué variable, nunca su valor) en el registro.

export interface Config {
  /** Dirección exacta del panel, sin barra final: p. ej. https://panel.tu-red.ts.net */
  origen: string;
  /** Dominio de las llaves de acceso (el del origen). Cambiarlo invalida todas las llaves. */
  rpId: string;
  rpNombre: string;
  /** Secreto de 32+ caracteres: firma hashes de IP/navegador y deriva las contraseñas iniciales. */
  secreto: string;
  /** Código para registrar llaves la primera vez (o para recuperar acceso). */
  codigoAlta: string;
  /** Llave de la API de Supabase, con alcance a UNA organización. */
  tokenSupabase: string;
  /** Organizaciones de Supabase de los clientes que vienen en la configuración del servidor (opcional: también se pueden agregar desde el panel, con firma). El panel no ve ni toca nada fuera de esta lista y de las agregadas. */
  organizaciones: string[];
  /** Conexión a la base propia del panel (usuario que SOLO puede ejecutar las funciones panel_*). */
  dbUrl: string;
  /** Aviso al celular (p. ej. https://ntfy.sh/mi-tema-largo-y-secreto). Opcional. */
  alertaUrl: string | null;
  /** Encabezado del que se lee la IP del visitante (lo pone el proxy de confianza). Vacío: no se usa IP. */
  encabezadoIp: string;
  /** Si está definido, TODO pedido debe traer este usuario de la red privada (encabezado de Tailscale). */
  usuarioRed: string | null;
  /** Solo para pruebas locales: permite http://localhost. */
  desarrollo: boolean;
  pasoTimeoutMs: number;
  puerto: number;
  /** Tope de proyectos en la organización de clientes: el panel se niega a crear más (protege contra gastos por error o abuso). */
  maxProyectos: number;
}

export type Entorno = Record<string, string | undefined>;

export class ConfigInvalida extends Error {
  readonly problemas: string[];
  constructor(problemas: string[]) {
    super(`Configuración inválida: ${problemas.join('; ')}`);
    this.problemas = problemas;
  }
}

const hostValido = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function cargarConfig(env: Entorno): Config {
  const problemas: string[] = [];
  const desarrollo = env.PANEL_DESARROLLO === '1';
  const pedir = (nombre: string, min = 1): string => {
    const v = env[nombre]?.trim() ?? '';
    if (v.length < min) problemas.push(`${nombre} falta o es demasiado corta`);
    return v;
  };

  const origen = pedir('PANEL_ORIGEN');
  let rpId = '';
  try {
    const u = new URL(origen);
    const esLocal = desarrollo && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (!esLocal && u.protocol !== 'https:') problemas.push('PANEL_ORIGEN debe ser https');
    if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) problemas.push('PANEL_ORIGEN no debe tener ruta, parámetros ni usuario');
    if (!esLocal && !hostValido.test(u.hostname)) problemas.push('PANEL_ORIGEN debe ser un dominio (no una IP)');
    if (origen.endsWith('/')) problemas.push('PANEL_ORIGEN no debe terminar en /');
    rpId = u.hostname;
  } catch {
    problemas.push('PANEL_ORIGEN no es una dirección válida');
  }

  const secreto = pedir('PANEL_SECRETO', 32);
  const codigoAlta = pedir('PANEL_CODIGO_ALTA', 32);
  const tokenSupabase = pedir('SUPABASE_ACCESS_TOKEN');
  if (tokenSupabase && !/^sbp_[A-Za-z0-9_]{20,}$/.test(tokenSupabase)) problemas.push('SUPABASE_ACCESS_TOKEN no tiene el formato esperado (sbp_…)');
  // PANEL_ORG_SLUGS: identificadores separados por coma. (PANEL_ORG_SLUG, con una sola, sigue funcionando.)
  const organizaciones = (env.PANEL_ORG_SLUGS ?? env.PANEL_ORG_SLUG ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (organizaciones.length > 30) problemas.push('PANEL_ORG_SLUGS tiene demasiadas organizaciones');
  if (organizaciones.some(o => !/^[a-z0-9]{10,40}$/.test(o))) problemas.push('PANEL_ORG_SLUGS tiene un identificador con formato inesperado');
  if (new Set(organizaciones).size !== organizaciones.length) problemas.push('PANEL_ORG_SLUGS tiene identificadores repetidos');

  const dbUrl = pedir('PANEL_DB_URL');
  if (dbUrl) {
    try {
      const u = new URL(dbUrl);
      if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') problemas.push('PANEL_DB_URL debe empezar con postgres://');
      const local = ['localhost', '127.0.0.1', 'db', 'panel-db'].includes(u.hostname);
      if (!local && !desarrollo) problemas.push('PANEL_DB_URL debe apuntar a la base local del servidor (no a internet)');
      if (!u.password) problemas.push('PANEL_DB_URL debe incluir contraseña');
      if (u.username === 'postgres') problemas.push('PANEL_DB_URL no debe usar el superusuario postgres');
    } catch { problemas.push('PANEL_DB_URL no es una dirección válida'); }
  }

  let alertaUrl: string | null = null;
  if (env.PANEL_ALERTA_URL?.trim()) {
    try {
      const u = new URL(env.PANEL_ALERTA_URL.trim());
      if (u.protocol !== 'https:') problemas.push('PANEL_ALERTA_URL debe ser https');
      else alertaUrl = u.toString();
    } catch { problemas.push('PANEL_ALERTA_URL no es una dirección válida'); }
  }

  const encabezadoIp = (env.PANEL_ENCABEZADO_IP ?? '').trim().toLowerCase();
  if (encabezadoIp && !/^[a-z][a-z0-9-]{1,40}$/.test(encabezadoIp)) problemas.push('PANEL_ENCABEZADO_IP no es válido');

  const usuarioRed = env.PANEL_USUARIO_RED?.trim() || null;
  if (usuarioRed && (usuarioRed.length > 200 || /[\r\n]/.test(usuarioRed))) problemas.push('PANEL_USUARIO_RED no es válido');
  if (!usuarioRed && !desarrollo) problemas.push('PANEL_USUARIO_RED falta: el panel exige que cada pedido venga de tu usuario de la red privada');

  const pasoTimeoutMs = Number(env.PANEL_PASO_TIMEOUT_MS ?? 60000);
  if (!Number.isInteger(pasoTimeoutMs) || pasoTimeoutMs < 1000 || pasoTimeoutMs > 300000) problemas.push('PANEL_PASO_TIMEOUT_MS fuera de rango');
  const puerto = Number(env.PANEL_PUERTO ?? 3100);
  if (!Number.isInteger(puerto) || puerto < 1024 || puerto > 65535) problemas.push('PANEL_PUERTO fuera de rango');

  const maxProyectos = Number(env.PANEL_MAX_PROYECTOS ?? 40);
  if (!Number.isInteger(maxProyectos) || maxProyectos < 1 || maxProyectos > 500) problemas.push('PANEL_MAX_PROYECTOS fuera de rango');

  if (problemas.length) throw new ConfigInvalida(problemas);
  return {
    origen, rpId, rpNombre: 'Panel de clientes', secreto, codigoAlta, tokenSupabase, organizaciones, dbUrl,
    alertaUrl, encabezadoIp, usuarioRed, desarrollo, pasoTimeoutMs, puerto, maxProyectos,
  };
}
