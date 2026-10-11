// Punto de entrada único del servidor del panel. Todo pedido pasa por acá, en este orden:
//   1. ¿La configuración es válida?            (si no, 503 sin detalles)
//   2. ¿Ruta y método permitidos?               (lista cerrada; todo lo demás es 404/405)
//   3. ¿Viene del propio panel?                 (origen, encabezado propio, JSON)
//   4. Límites de velocidad                     (por IP y global, en la base: atómicos)
//   5. ¿Hay sesión? (solo para las rutas que la exigen)
//   6. El trabajo de la ruta, con datos validados.
// Denegar por defecto: una ruta nueva sin "sesion: true" sería pública, por eso el tipo obliga a decirlo siempre.
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { Config } from './config.ts';
import { aleatorio, hmacHex, iguales, sha256Hex } from './cripto.ts';
import {
  demasiados, ErrorHttp, malPedido, noExiste, prohibido, sinSesion,
} from './errores.ts';
import { ErrorAlmacen, type Almacen } from './almacen.ts';
import { crearPermitidas, organizacionesConOrigen } from './organizaciones.ts';
import { componentesInstalados, expandirRegistro, faltantesPara, migracionesDe, NOMBRE_COMPONENTE, ORDEN_COMPONENTES } from './componentes.ts';
import { MODULOS, VERSION_PLANTILLA } from './generado.ts';
import {
  cookieBorrar, cookieSesion, COOKIE_SESION, exigirMismoOrigen, leerCookie, leerJson, respuestaError, respuestaJson,
} from './http.ts';
import { claveValida, limpiarRespuestaIngreso, limpiarRespuestaRegistro, transportesDe } from './llaves.ts';
import { claveInicial, construirPlan, ejecutarPaso, type Dependencias, type TipoPlan } from './planes.ts';
import { crearProyectoCliente } from './proyectoCliente.ts';
import { conocerSecreto, enviarAlerta, limpiar, registrar } from './registro.ts';
import { ErrorSupabase, type SupabaseApi } from './supabaseApi.ts';
import { parseUuid, parseRef, soloClaves, textoLimpio } from './validar.ts';

export interface DepsManejador {
  config: Config;
  almacen: Almacen;
  api: SupabaseApi;
  fetchImpl?: typeof fetch;
  ahora?: () => number;
  proyectoCliente?: Dependencias['proyectoCliente'];
}

interface Sesion { hash: string; credencialId: string }
interface Contexto {
  req: Request;
  params: string[];
  ipHash: string;
  navHash: string;
  sesion: Sesion | null;
}
type Resultado = { estado?: number; cuerpo: unknown; encabezados?: Record<string, string> };
interface Ruta {
  metodo: 'GET' | 'POST';
  patron: RegExp;
  sesion: boolean;
  /** Tope de pedidos por IP en 5 minutos para esta ruta. */
  limite: number;
  ejecutar: (c: Contexto) => Promise<Resultado>;
}

// IP del visitante según el proxy de confianza. Si el encabezado trae varias (cadena de proxies), vale la ÚLTIMA:
// es la que agregó nuestro proxy; las anteriores las puede escribir cualquiera.
export function ipDe(req: Request, encabezado: string): string {
  if (!encabezado) return '';
  const crudo = req.headers.get(encabezado) ?? '';
  const ultima = crudo.split(',').at(-1)?.trim() ?? '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(ultima) ? ultima : '';
}

const ALGORITMOS = [-7, -257]; // ES256 (celulares, llaves USB) y RS256 (algunos Windows Hello)

export function crearManejador(deps: DepsManejador): (req: Request) => Promise<Response> {
  const { config, almacen, api } = deps;
  const ahora = deps.ahora ?? (() => Date.now());
  const orgsPermitidas = crearPermitidas(config, almacen);
  const depsPlanes: Dependencias = { config, api, almacen, organizaciones: orgsPermitidas, ahora, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.proyectoCliente ? { proyectoCliente: deps.proyectoCliente } : {}) };
  const codigoHash = sha256Hex(config.codigoAlta);
  for (const s of [config.secreto, config.codigoAlta, config.tokenSupabase]) conocerSecreto(s);
  try { conocerSecreto(decodeURIComponent(new URL(config.dbUrl).password)); } catch { /* sin contraseña que ocultar */ }

  const rpc = <T>(nombre: string, args: Record<string, unknown>) => almacen.rpc<T>(nombre, args);

  // ---------- utilidades ----------
  async function limitar(clave: string, maximo: number, segundos: number): Promise<void> {
    const permitido = await rpc<boolean>('panel_limite_golpear', { p_clave: clave, p_maximo: maximo, p_ventana_segundos: segundos });
    if (!permitido) throw demasiados();
  }

  async function auditar(actor: string, evento: string, detalle: Record<string, unknown>, ipHash: string, alertar = false): Promise<void> {
    try {
      await rpc('panel_auditoria_agregar', { p_actor: actor, p_evento: evento, p_detalle: limpiar(detalle), p_ip_hash: ipHash });
    } catch (e) {
      registrar('error', 'auditoria_fallo', { evento, mensaje: e instanceof Error ? e.message : 'desconocido' });
    }
    if (alertar) {
      // Para no llenarte el celular si alguien insiste, el mismo tipo de aviso se limita a 6 por hora.
      try {
        await limitar(`alerta:${evento}`, 6, 3600);
        await enviarAlerta(config.alertaUrl, `${evento}${detalle.ref ? ` · ${String(detalle.ref)}` : ''}${detalle.tipo ? ` · ${String(detalle.tipo)}` : ''}`, deps.fetchImpl);
      } catch { /* el límite de avisos no frena nada */ }
    }
  }

  const hashSesion = (token: string): string => sha256Hex(`sesion|${token}`);

  async function leerSesion(req: Request, navHash: string, ipHash: string): Promise<Sesion | null> {
    const token = leerCookie(req, COOKIE_SESION);
    if (!token) return null;
    const hash = hashSesion(token);
    const r = await rpc<{ hash?: string; credencial_id?: string; revocada_por_navegador?: boolean } | null>('panel_sesion_validar', { p_hash: hash, p_navegador_hash: navHash });
    if (!r) return null;
    if (r.revocada_por_navegador) {
      await auditar('sistema', 'sesion_otro_navegador', {}, ipHash, true);
      return null;
    }
    return { hash, credencialId: String(r.credencial_id ?? '') };
  }

  async function opcionesDeFirma(planId: string | null, sesionHash: string | null, proposito: 'ingreso' | 'plan'): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
    const credenciales = await rpc<{ id: string; transportes: string[] }[]>('panel_credenciales_listar', {});
    if (!credenciales.length) throw new ErrorHttp(409, 'sin_llaves', 'No hay llaves registradas.');
    const opciones = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: credenciales.map(c => ({ id: c.id, transports: transportesDe(c.transportes) as never })),
      userVerification: 'required',
      timeout: 120_000,
    });
    try {
      await rpc('panel_desafio_crear', { p_desafio: opciones.challenge, p_proposito: proposito, p_plan_id: planId, p_sesion_hash: sesionHash, p_segundos: 120 });
    } catch (e) {
      if (e instanceof ErrorAlmacen && e.codigoSql === '53400') throw demasiados();
      throw e;
    }
    return opciones;
  }

  // Verifica una firma de login/plan. El desafío se CONSUME (se borra) apenas se lee: sirve una sola vez, pase lo que pase después.
  async function verificarFirma(respuesta: ReturnType<typeof limpiarRespuestaIngreso>, proposito: 'ingreso' | 'plan'): Promise<{ credencialId: string; desafio: { plan_id: string | null; sesion_hash: string | null } }> {
    let consumido: { plan_id: string | null; sesion_hash: string | null } | null = null;
    const cred = await rpc<{ id: string; clave_publica: string; contador: number; transportes: string[] } | null>('panel_credencial_obtener', { p_id: respuesta.id });
    if (!cred) throw new ErrorHttp(401, 'firma', 'No se pudo verificar la llave.');
    let verificacion;
    try {
      verificacion = await verifyAuthenticationResponse({
        response: respuesta,
        expectedChallenge: async (desafio: string) => {
          consumido = await rpc('panel_desafio_consumir', { p_desafio: desafio, p_proposito: proposito });
          return consumido !== null;
        },
        expectedOrigin: config.origen,
        expectedRPID: config.rpId,
        credential: { id: cred.id, publicKey: Buffer.from(cred.clave_publica, 'base64url'), counter: Number(cred.contador), transports: transportesDe(cred.transportes) as never },
        requireUserVerification: true,
      });
    } catch {
      throw new ErrorHttp(401, 'firma', 'No se pudo verificar la llave.');
    }
    if (!verificacion.verified || !consumido) throw new ErrorHttp(401, 'firma', 'No se pudo verificar la llave.');
    const sirvio = await rpc<boolean>('panel_credencial_usar', { p_id: cred.id, p_nuevo_contador: verificacion.authenticationInfo.newCounter });
    if (!sirvio) throw new ErrorHttp(401, 'contador', 'La llave repitió un contador: puede estar clonada.');
    return { credencialId: cred.id, desafio: consumido };
  }

  // ---------- rutas ----------
  const rutas: Ruta[] = [
    // --- público ---
    {
      metodo: 'GET', patron: /^\/api\/estado$/, sesion: false, limite: 120,
      async ejecutar(c) {
        const [alta, hay] = await Promise.all([
          rpc<string>('panel_alta_estado', { p_codigo_hash: codigoHash }),
          rpc<boolean>('panel_hay_credenciales', {}),
        ]);
        const s = await leerSesion(c.req, c.navHash, c.ipHash);
        return { cuerpo: { altaAbierta: alta !== 'cerrado', hayLlaves: hay, sesion: s !== null, version: VERSION_PLANTILLA } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/alta\/opciones$/, sesion: false, limite: 10,
      async ejecutar(c) {
        const cuerpo = await leerJson(c.req);
        soloClaves(cuerpo, ['codigo'], ['codigo']);
        await limitar('alta:global', 12, 3600);
        await limitar(`alta:ip:${c.ipHash}`, 6, 3600);
        if (typeof cuerpo.codigo !== 'string' || !iguales(cuerpo.codigo, config.codigoAlta)) {
          await auditar('anonimo', 'alta_codigo_incorrecto', {}, c.ipHash, true);
          throw prohibido('codigo', 'Código incorrecto.');
        }
        const estado = await rpc<string>('panel_alta_estado', { p_codigo_hash: codigoHash });
        if (estado === 'cerrado') throw prohibido('alta_cerrada', 'El registro de llaves está cerrado.');
        const existentes = estado === 'abierto_ventana' ? await rpc<{ id: string; transportes: string[] }[]>('panel_credenciales_listar', {}) : [];
        const opciones = await generateRegistrationOptions({
          rpName: config.rpNombre, rpID: config.rpId, userName: 'proveedor', userDisplayName: 'Proveedor',
          userID: new TextEncoder().encode('proveedor-unico'), attestationType: 'none',
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          supportedAlgorithmIDs: ALGORITMOS, timeout: 120_000,
          excludeCredentials: existentes.map(x => ({ id: x.id, transports: transportesDe(x.transportes) as never })),
        });
        try {
          await rpc('panel_desafio_crear', { p_desafio: opciones.challenge, p_proposito: 'alta', p_plan_id: null, p_sesion_hash: null, p_segundos: 120 });
        } catch (e) { if (e instanceof ErrorAlmacen && e.codigoSql === '53400') throw demasiados(); throw e; }
        return { cuerpo: { opciones, modo: estado === 'abierto_nuevo' ? 'nuevo' : 'ventana' } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/alta\/verificar$/, sesion: false, limite: 10,
      async ejecutar(c) {
        const cuerpo = await leerJson(c.req);
        soloClaves(cuerpo, ['codigo', 'nombre', 'respuesta'], ['codigo', 'respuesta']);
        await limitar('alta:global', 12, 3600);
        await limitar(`alta:ip:${c.ipHash}`, 6, 3600);
        if (typeof cuerpo.codigo !== 'string' || !iguales(cuerpo.codigo, config.codigoAlta)) {
          await auditar('anonimo', 'alta_codigo_incorrecto', {}, c.ipHash, true);
          throw prohibido('codigo', 'Código incorrecto.');
        }
        const nombre = cuerpo.nombre === undefined ? 'Llave' : textoLimpio(cuerpo.nombre, 'nombre', 1, 40);
        const respuesta = limpiarRespuestaRegistro(cuerpo.respuesta);
        let desafioOk = false;
        let r;
        try {
          r = await verifyRegistrationResponse({
            response: respuesta,
            expectedChallenge: async (d: string) => { desafioOk = (await rpc('panel_desafio_consumir', { p_desafio: d, p_proposito: 'alta' })) !== null; return desafioOk; },
            expectedOrigin: config.origen, expectedRPID: config.rpId, requireUserVerification: true, supportedAlgorithmIDs: ALGORITMOS,
          });
        } catch { throw new ErrorHttp(401, 'firma', 'No se pudo verificar la llave.'); }
        if (!r.verified || !desafioOk) throw new ErrorHttp(401, 'firma', 'No se pudo verificar la llave.');
        const cred = r.registrationInfo.credential;
        if (!claveValida(cred.publicKey)) throw new ErrorHttp(401, 'firma', 'No se pudo verificar la llave.');
        let modo: string;
        try {
          modo = await rpc<string>('panel_credencial_agregar', {
            p_codigo_hash: codigoHash, p_id: cred.id, p_clave_publica: Buffer.from(cred.publicKey).toString('base64url'),
            p_contador: cred.counter, p_transportes: transportesDe(cred.transports), p_nombre: nombre,
          });
        } catch (e) { if (e instanceof ErrorAlmacen && e.codigoSql === '42501') throw prohibido('alta_cerrada', 'El registro de llaves está cerrado.'); throw e; }
        const total = (await rpc<unknown[]>('panel_credenciales_listar', {})).length;
        await auditar('anonimo', modo === 'abierto_nuevo' ? 'alta_llave_nueva' : 'alta_llave_respaldo', { llaves: total }, c.ipHash, true);
        return { cuerpo: { ok: true, llaves: total } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/ingreso\/opciones$/, sesion: false, limite: 20,
      async ejecutar(c) {
        const cuerpo = await leerJson(c.req);
        soloClaves(cuerpo, []);
        await limitar('ingreso:global', 120, 300);
        const opciones = await opcionesDeFirma(null, null, 'ingreso');
        return { cuerpo: { opciones } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/ingreso\/verificar$/, sesion: false, limite: 20,
      async ejecutar(c) {
        const cuerpo = await leerJson(c.req);
        soloClaves(cuerpo, ['respuesta'], ['respuesta']);
        await limitar('ingreso:global', 120, 300);
        const respuesta = limpiarRespuestaIngreso(cuerpo.respuesta);
        let credencialId: string;
        try {
          ({ credencialId } = await verificarFirma(respuesta, 'ingreso'));
        } catch (e) {
          if (e instanceof ErrorHttp) {
            await auditar('anonimo', e.codigo === 'contador' ? 'llave_clonada' : 'ingreso_fallido', {}, c.ipHash, true);
            throw new ErrorHttp(401, 'ingreso', 'No se pudo iniciar sesión.');
          }
          throw e;
        }
        const token = aleatorio(32);
        await rpc('panel_sesion_crear', { p_hash: hashSesion(token), p_navegador_hash: c.navHash, p_ip_hash: c.ipHash, p_credencial_id: credencialId });
        await auditar('proveedor', 'ingreso', {}, c.ipHash, true);
        return { cuerpo: { ok: true }, encabezados: { 'set-cookie': cookieSesion(token) } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/salida$/, sesion: false, limite: 30,
      async ejecutar(c) {
        const token = leerCookie(c.req, COOKIE_SESION);
        if (token) await rpc('panel_sesion_revocar', { p_hash: hashSesion(token) });
        return { cuerpo: { ok: true }, encabezados: { 'set-cookie': cookieBorrar() } };
      },
    },

    // --- con sesión: mirar ---
    {
      metodo: 'GET', patron: /^\/api\/clientes$/, sesion: true, limite: 60,
      async ejecutar() {
        const lista = await api.listarProyectos();
        return { cuerpo: { clientes: lista.map(p => ({ ref: p.ref, nombre: p.nombre, estado: p.estado, region: p.region, creado: p.creado, org: p.org })) } };
      },
    },
    {
      metodo: 'GET', patron: /^\/api\/clientes\/([a-z]{20})$/, sesion: true, limite: 60,
      async ejecutar(c) {
        const ref = parseRef(c.params[0]);
        const p = await api.obtenerProyecto(ref);
        if (!p) throw noExiste();
        const base = { ref: p.ref, nombre: p.nombre, estado: p.estado, region: p.region, creado: p.creado, org: p.org };
        if (p.estado !== 'ACTIVE_HEALTHY') return { cuerpo: { ...base, detalle: null } };
        const detalle: Record<string, unknown> = { versionPlantilla: VERSION_PLANTILLA, incompleto: false };
        try {
          const filas = await api.consultar(ref, 'select nombre from public.migraciones_aplicadas', { soloLectura: true });
          const registro = filas.map(f => String(f.nombre));
          const hechas = expandirRegistro(registro);
          const instalados = componentesInstalados(registro);
          const propias = migracionesDe(instalados);
          detalle.instalado = true;
          detalle.migraciones = { total: propias.length, aplicadas: propias.filter(m => hechas.has(m.nombre)).length, pendientes: propias.filter(m => !hechas.has(m.nombre)).map(m => m.nombre) };
          // Componentes: los que tiene y los que se le podrían agregar ahora (los que tienen sus requisitos instalados).
          detalle.componentes = {
            instalados: instalados.map(c => ({ id: c, nombre: NOMBRE_COMPONENTE[c] })),
            instalables: ORDEN_COMPONENTES.filter(c => c !== 'base' && !instalados.includes(c) && faltantesPara(c, instalados).length === 0).map(c => ({ id: c, nombre: NOMBRE_COMPONENTE[c], modulos: MODULOS.filter(m => m.componente === c).map(m => m.nombre) })),
          };
        } catch (e) {
          if (e instanceof ErrorSupabase && (e.estado === 400 || e.estado === 500)) detalle.instalado = false; else detalle.incompleto = true;
        }
        if (detalle.instalado) {
          try {
            const k = await api.claves(ref);
            const cliente = (deps.proyectoCliente ?? ((r, kk) => crearProyectoCliente(r, kk, config.pasoTimeoutMs, deps.fetchImpl)))(ref, k);
            detalle.modulos = await cliente.leerLicencia();
            detalle.registroPublico = await cliente.registroPublico();
          } catch { detalle.incompleto = true; }
        }
        return { cuerpo: { ...base, detalle } };
      },
    },
    {
      // Lo que hace falta para publicar la app del cliente en Netlify: la dirección de su proyecto y su llave PÚBLICA (la que va
      // dentro de la web). La llave de servicio nunca sale del servidor.
      metodo: 'GET', patron: /^\/api\/clientes\/([a-z]{20})\/publicar$/, sesion: true, limite: 30,
      async ejecutar(c) {
        const ref = parseRef(c.params[0]);
        const p = await api.obtenerProyecto(ref);
        if (!p) throw noExiste();
        if (p.estado !== 'ACTIVE_HEALTHY') throw new ErrorHttp(409, 'no_listo', 'El proyecto todavía no está listo.');
        const k = await api.claves(ref);
        return { cuerpo: { nombre: p.nombre, url: `https://${ref}.supabase.co`, anon: k.anon } };
      },
    },
    {
      metodo: 'GET', patron: /^\/api\/modulos$/, sesion: true, limite: 60,
      async ejecutar() {
        return { cuerpo: { modulos: MODULOS.map(x => ({ id: x.id, nombre: x.nombre, componente: x.componente, descripcion: x.descripcion, requiere: x.requiere })), organizaciones: await orgsPermitidas() } };
      },
    },
    {
      metodo: 'GET', patron: /^\/api\/organizaciones$/, sesion: true, limite: 60,
      async ejecutar() {
        return { cuerpo: { organizaciones: await organizacionesConOrigen(config, almacen) } };
      },
    },
    {
      metodo: 'GET', patron: /^\/api\/auditoria$/, sesion: true, limite: 30,
      async ejecutar() {
        const [eventos, cadena] = await Promise.all([rpc<unknown[]>('panel_auditoria_recientes', { p_limite: 60 }), rpc('panel_auditoria_verificar', {})]);
        return { cuerpo: { eventos, cadena } };
      },
    },

    // --- con sesión: cambiar (siempre con plan firmado) ---
    {
      metodo: 'POST', patron: /^\/api\/planes$/, sesion: true, limite: 20,
      async ejecutar(c) {
        const cuerpo = await leerJson(c.req);
        const { tipo, ...resto } = cuerpo;
        if (typeof tipo !== 'string') throw malPedido('tipo', 'Falta el tipo de operación.');
        await limitar(`plan:sesion:${c.sesion!.hash.slice(0, 16)}`, 30, 3600);
        const plan = await construirPlan(depsPlanes, tipo, resto);
        // Crear un proyecto cuesta plata: como mucho 5 clientes nuevos por día. Solo cuentan los planes válidos (los pedidos
        // mal formados ya se rechazaron arriba y no cuestan nada).
        if (plan.tipo === 'crear') await limitar('plan:crear:dia', 5, 86400);
        let id: string;
        try {
          id = await rpc<string>('panel_plan_crear', { p_sesion_hash: c.sesion!.hash, p_tipo: plan.tipo, p_ref: plan.ref, p_parametros: plan.parametros, p_pasos: plan.pasos });
        } catch (e) { if (e instanceof ErrorAlmacen && e.codigoSql === '53400') throw demasiados(); throw e; }
        const opciones = await opcionesDeFirma(id, c.sesion!.hash, 'plan');
        await auditar('proveedor', 'plan_creado', { tipo: plan.tipo, ref: plan.ref, plan: id, org: (plan.parametros as { org?: string }).org }, c.ipHash);
        return { estado: 201, cuerpo: { id, tipo: plan.tipo, resumen: plan.resumen, pasos: plan.pasos, opciones } };
      },
    },
    {
      metodo: 'GET', patron: /^\/api\/planes\/([0-9a-f-]{36})$/, sesion: true, limite: 240,
      async ejecutar(c) {
        const p = await rpc<Record<string, unknown> | null>('panel_plan_obtener', { p_id: parseUuid(c.params[0]), p_sesion_hash: c.sesion!.hash });
        if (!p) throw noExiste();
        return { cuerpo: { plan: p } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/planes\/([0-9a-f-]{36})\/desafio$/, sesion: true, limite: 30,
      async ejecutar(c) {
        const id = parseUuid(c.params[0]);
        const p = await rpc<{ estado: string } | null>('panel_plan_obtener', { p_id: id, p_sesion_hash: c.sesion!.hash });
        if (!p) throw noExiste();
        if (p.estado !== 'pendiente') throw new ErrorHttp(409, 'estado', 'El plan ya no está pendiente.');
        return { cuerpo: { opciones: await opcionesDeFirma(id, c.sesion!.hash, 'plan') } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/planes\/([0-9a-f-]{36})\/firmar$/, sesion: true, limite: 20,
      async ejecutar(c) {
        const id = parseUuid(c.params[0]);
        const cuerpo = await leerJson(c.req);
        soloClaves(cuerpo, ['respuesta'], ['respuesta']);
        await limitar('firma:global', 60, 3600);
        const respuesta = limpiarRespuestaIngreso(cuerpo.respuesta);
        let resultado;
        try { resultado = await verificarFirma(respuesta, 'plan'); } catch (e) {
          if (e instanceof ErrorHttp) { await auditar('proveedor', e.codigo === 'contador' ? 'llave_clonada' : 'firma_fallida', { plan: id }, c.ipHash, true); }
          throw e;
        }
        // La firma tiene que ser de ESTE plan y de ESTA sesión: una firma de otra cosa no autoriza nada.
        if (resultado.desafio.plan_id !== id || resultado.desafio.sesion_hash !== c.sesion!.hash) {
          await auditar('proveedor', 'firma_ajena', { plan: id }, c.ipHash, true);
          throw prohibido('firma', 'Esa firma no corresponde a este plan.');
        }
        const ok = await rpc<boolean>('panel_plan_autorizar', { p_id: id, p_sesion_hash: c.sesion!.hash });
        if (!ok) throw new ErrorHttp(409, 'estado', 'El plan venció o ya estaba firmado.');
        const p = await rpc<{ tipo: string; ref: string | null } | null>('panel_plan_obtener', { p_id: id, p_sesion_hash: c.sesion!.hash });
        await auditar('proveedor', 'plan_autorizado', { tipo: p?.tipo, ref: p?.ref, plan: id }, c.ipHash, true);
        return { cuerpo: { ok: true } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/planes\/([0-9a-f-]{36})\/paso$/, sesion: true, limite: 300,
      async ejecutar(c) {
        const id = parseUuid(c.params[0]);
        const cuerpo = await leerJson(c.req);
        soloClaves(cuerpo, []);
        await limitar(`pasos:sesion:${c.sesion!.hash.slice(0, 16)}`, 600, 3600);
        const token = aleatorio(16);
        const inicio = await rpc<Record<string, unknown>>('panel_plan_paso_empezar', { p_id: id, p_sesion_hash: c.sesion!.hash, p_token: token, p_segundos: Math.ceil(config.pasoTimeoutMs / 1000) + 30 });
        if (inicio.error) {
          const e = String(inicio.error);
          if (e === 'no_existe') throw noExiste();
          if (e === 'ocupado' || e === 'proyecto_ocupado') throw new ErrorHttp(409, e, 'Hay otro paso en curso. Reintentá en unos segundos.');
          if (e === 'vencido') throw new ErrorHttp(410, 'vencido', 'El plan venció. Armalo de nuevo.');
          throw new ErrorHttp(409, 'estado', `El plan no se puede ejecutar (${String(inicio.estado ?? 'estado')}).`);
        }
        const paso = inicio.paso as { id: string; etiqueta: string };
        const indice = Number(inicio.indice);
        const total = Number(inicio.total);
        let salida;
        try {
          salida = await ejecutarPaso(depsPlanes, {
            planId: id, tipo: String(inicio.tipo) as TipoPlan, paso, indice, total,
            parametros: (inicio.parametros ?? {}) as Record<string, unknown>, contexto: (inicio.contexto ?? {}) as Record<string, unknown>,
            ref: (inicio.ref as string | null) ?? null,
          });
        } catch (e) {
          registrar('error', 'paso_error_inesperado', { plan: id, paso: paso.id, mensaje: e instanceof Error ? e.message : 'desconocido' });
          salida = { resultado: 'fallo' as const, mensaje: 'Error inesperado en el servidor. Revisá el registro.' };
        }
        const fin = await rpc<{ estado: string; cursor: number; total: number; error?: string }>('panel_plan_paso_terminar', {
          p_id: id, p_token: token, p_indice: indice, p_resultado: salida.resultado, p_contexto: limpiar(salida.contexto ?? {}),
          p_error: salida.resultado === 'ok' ? null : salida.mensaje, p_ref: salida.ref ?? null,
        });
        const critico = salida.resultado === 'fallo' || fin.estado === 'terminado';
        await auditar('proveedor', fin.estado === 'terminado' ? 'plan_terminado' : salida.resultado === 'fallo' ? 'plan_fallido' : 'paso', { plan: id, paso: paso.id, resultado: salida.resultado, mensaje: salida.mensaje, tipo: inicio.tipo, ref: salida.ref ?? inicio.ref }, c.ipHash, critico);
        return { cuerpo: { estado: fin.estado, cursor: fin.cursor, total: fin.total, paso: { id: paso.id, etiqueta: paso.etiqueta }, resultado: salida.resultado, mensaje: salida.mensaje } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/planes\/([0-9a-f-]{36})\/cancelar$/, sesion: true, limite: 30,
      async ejecutar(c) {
        const id = parseUuid(c.params[0]);
        const ok = await rpc<boolean>('panel_plan_cancelar', { p_id: id, p_sesion_hash: c.sesion!.hash });
        if (!ok) throw noExiste();
        await auditar('proveedor', 'plan_cancelado', { plan: id }, c.ipHash);
        return { cuerpo: { ok: true } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/planes\/([0-9a-f-]{36})\/clave$/, sesion: true, limite: 20,
      async ejecutar(c) {
        const id = parseUuid(c.params[0]);
        const disponible = await rpc<boolean>('panel_plan_clave_disponible', { p_id: id, p_sesion_hash: c.sesion!.hash });
        if (!disponible) throw new ErrorHttp(404, 'sin_clave', 'La contraseña ya no se puede mostrar.');
        const p = await rpc<{ ref: string; parametros: { correo?: string }; contexto: { duenoExistia?: boolean } } | null>('panel_plan_obtener', { p_id: id, p_sesion_hash: c.sesion!.hash });
        if (!p?.ref) throw noExiste();
        await auditar('proveedor', 'clave_mostrada', { plan: id, ref: p.ref }, c.ipHash, true);
        const correo = String(p.parametros.correo ?? '');
        if (p.contexto.duenoExistia) return { cuerpo: { correo, clave: null, motivo: 'Ese correo ya tenía una cuenta: se conserva su contraseña.' } };
        const claveMostrada = claveInicial(config, id, p.ref);
        conocerSecreto(claveMostrada);
        return { cuerpo: { correo, clave: claveMostrada } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/planes\/([0-9a-f-]{36})\/acuse$/, sesion: true, limite: 20,
      async ejecutar(c) {
        const id = parseUuid(c.params[0]);
        const ok = await rpc<boolean>('panel_plan_clave_acusar', { p_id: id, p_sesion_hash: c.sesion!.hash });
        if (!ok) throw noExiste();
        await auditar('proveedor', 'clave_acusada', { plan: id }, c.ipHash);
        return { cuerpo: { ok: true } };
      },
    },
    {
      metodo: 'POST', patron: /^\/api\/panico$/, sesion: true, limite: 10,
      async ejecutar(c) {
        const r = await rpc<{ sesiones: number; planes: number }>('panel_panico', {});
        await auditar('proveedor', 'panico', { ...r }, c.ipHash, true);
        return { cuerpo: { ok: true, ...r }, encabezados: { 'set-cookie': cookieBorrar() } };
      },
    },
  ];

  const metodosPorRuta = (ruta: string): string[] => rutas.filter(r => r.patron.test(ruta)).map(r => r.metodo);

  return async function manejar(req: Request): Promise<Response> {
    try {
      // Primera barrera: el pedido tiene que venir de TU usuario de la red privada (lo agrega el proxy de Tailscale).
      // Cualquier otro recibe siempre la misma respuesta, sin tocar la base ni revelar rutas.
      if (config.usuarioRed && !iguales(req.headers.get('tailscale-user-login') ?? '', config.usuarioRed)) {
        return respuestaError(new ErrorHttp(403, 'red', 'No permitido.'));
      }
      const url = new URL(req.url);
      const ruta = url.pathname;
      // Sin parámetros en la dirección, sin codificaciones raras ni trucos de ruta: ninguna ruta legítima los usa.
      // eslint-disable-next-line no-control-regex -- a propósito: se rechazan los caracteres de control en la ruta
      if (url.search || !ruta.startsWith('/api/') || /%|\\|\/\/|\.\.|[\u0000-\u001f]/.test(ruta) || ruta.length > 120) {
        return respuestaError(new ErrorHttp(404, 'no_existe', 'No existe.'));
      }
      const candidatas = rutas.filter(r => r.patron.test(ruta));
      if (!candidatas.length) return respuestaError(new ErrorHttp(404, 'no_existe', 'No existe.'));
      const elegida = candidatas.find(r => r.metodo === req.method);
      if (!elegida) return respuestaError(new ErrorHttp(405, 'metodo', 'Método no permitido.'), { allow: metodosPorRuta(ruta).join(', ') });

      exigirMismoOrigen(req, config);

      const ip = ipDe(req, config.encabezadoIp);
      const ipHash = hmacHex(config.secreto, `ip|${ip}`).slice(0, 32);
      const navHash = hmacHex(config.secreto, `ua|${req.headers.get('user-agent') ?? ''}`).slice(0, 32);

      await limitar(`ip:${ipHash}:r${rutas.indexOf(elegida)}`, elegida.limite, 300);
      await limitar('todo:global', 3000, 300);

      let sesion: Sesion | null = null;
      if (elegida.sesion) {
        sesion = await leerSesion(req, navHash, ipHash);
        if (!sesion) return respuestaError(sinSesion(), { 'set-cookie': cookieBorrar() });
      }
      const m = ruta.match(elegida.patron);
      const r = await elegida.ejecutar({ req, params: m ? m.slice(1) : [], ipHash, navHash, sesion });
      return respuestaJson(r.estado ?? 200, r.cuerpo, r.encabezados);
    } catch (e) {
      if (e instanceof ErrorHttp) return respuestaError(e);
      if (e instanceof ErrorSupabase) {
        registrar('aviso', 'supabase_error', { estado: e.estado, mensaje: e.message });
        return respuestaJson(502, { error: 'supabase', mensaje: e.estado === 401 || e.estado === 403 ? 'Supabase rechazó la llave del panel.' : 'Supabase no respondió bien. Probá de nuevo.' });
      }
      if (e instanceof ErrorAlmacen) {
        registrar('error', 'almacen_error', { estado: e.estado, mensaje: e.message, codigoSql: e.codigoSql, causa: e.causa });
        return respuestaJson(503, { error: 'no_disponible', mensaje: 'El servicio no está disponible ahora.' });
      }
      registrar('error', 'error_inesperado', { mensaje: e instanceof Error ? e.message : 'desconocido' });
      return respuestaJson(500, { error: 'interno', mensaje: 'Error interno.' });
    }
  };
}

