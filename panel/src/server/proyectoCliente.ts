// Llamadas a UN proyecto de cliente (su base y su autenticación) con la llave de servicio que se acaba de leer.
// La llave vive solo en memoria durante el paso: no se guarda, no se registra y no se devuelve al navegador.
import { REF } from './validar.ts';
import { normalizarLicencia, type EstadoModulos } from './modulos.ts';
import { ErrorSupabase, type Claves } from './supabaseApi.ts';

export interface ProyectoCliente {
  crearDueno(correo: string, clave: string): Promise<'creado' | 'ya_existia'>;
  definirDueno(correo: string): Promise<'definido' | 'ya_tenia'>;
  fijarNombreEmpresa(nombre: string): Promise<void>;
  leerLicencia(): Promise<EstadoModulos | null>;
  escribirLicencia(estado: EstadoModulos): Promise<void>;
  registroPublico(): Promise<'abierto' | 'cerrado' | 'desconocido'>;
}

export function crearProyectoCliente(ref: string, claves: Claves, tiempoMs: number, fetchImpl: typeof fetch = fetch): ProyectoCliente {
  if (!REF.test(ref)) throw new Error('Identificador de proyecto inválido');
  const base = `https://${ref}.supabase.co`;

  async function llamar(clave: string, metodo: string, ruta: string, json?: unknown): Promise<{ estado: number; datos: unknown }> {
    const encabezados: Record<string, string> = { apikey: clave, 'content-type': 'application/json', prefer: 'return=representation' };
    // Las llaves antiguas son JWT y van también como Bearer; las nuevas (sb_…) van solo en apikey.
    if (clave.startsWith('eyJ')) encabezados.authorization = `Bearer ${clave}`;
    let r: Response;
    try {
      r = await fetchImpl(base + ruta, { method: metodo, headers: encabezados, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'error', signal: AbortSignal.timeout(tiempoMs) });
    } catch {
      throw new ErrorSupabase(0, 'No se pudo conectar con el proyecto del cliente.');
    }
    const texto = (await r.text()).slice(0, 1024 * 1024);
    let datos: unknown = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }
    return { estado: r.status, datos };
  }

  const mensaje = (datos: unknown): string => (datos && typeof datos === 'object' && 'message' in datos ? String((datos as { message: unknown }).message) : '');

  return {
    async crearDueno(correo, clave) {
      const r = await llamar(claves.servicio, 'POST', '/auth/v1/admin/users', {
        email: correo, password: clave, email_confirm: true, user_metadata: { full_name: correo.split('@')[0] },
      });
      const codigo = r.datos && typeof r.datos === 'object' ? (r.datos as { error_code?: string }).error_code : undefined;
      if (r.estado === 422 || codigo === 'email_exists') return 'ya_existia';
      if (r.estado >= 300) throw new ErrorSupabase(r.estado, 'No se pudo crear al dueño.');
      return 'creado';
    },
    async definirDueno(correo) {
      const r = await llamar(claves.servicio, 'POST', '/rest/v1/rpc/definir_dueno_inicial', { p_email: correo });
      if (r.estado >= 300) {
        if (/ya tiene un due/i.test(mensaje(r.datos))) return 'ya_tenia';
        throw new ErrorSupabase(r.estado, 'No se pudo definir al dueño.');
      }
      return 'definido';
    },
    async fijarNombreEmpresa(nombre) {
      const r = await llamar(claves.servicio, 'PATCH', '/rest/v1/configuracion?id=eq.1', { empresa_nombre: nombre });
      if (r.estado >= 300) throw new ErrorSupabase(r.estado, 'No se pudo guardar el nombre de la empresa.');
    },
    async leerLicencia() {
      const r = await llamar(claves.servicio, 'GET', '/rest/v1/licencia?select=modulos&id=eq.1');
      if (r.estado >= 300 || !Array.isArray(r.datos) || !r.datos[0]) return null;
      return normalizarLicencia((r.datos[0] as { modulos?: unknown }).modulos);
    },
    async escribirLicencia(estado) {
      const r = await llamar(claves.servicio, 'PATCH', '/rest/v1/licencia?id=eq.1', { modulos: estado });
      if (r.estado >= 300 || !Array.isArray(r.datos) || !r.datos[0]) throw new ErrorSupabase(r.estado, 'No se pudo guardar la licencia.');
    },
    async registroPublico() {
      const r = await llamar(claves.anon, 'GET', '/auth/v1/settings');
      const d = r.datos as { disable_signup?: unknown } | null;
      if (r.estado >= 300 || !d || typeof d.disable_signup !== 'boolean') return 'desconocido';
      return d.disable_signup ? 'cerrado' : 'abierto';
    },
  };
}
