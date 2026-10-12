// Planes de operación: qué se puede hacer desde el panel y cómo se hace, paso a paso.
//
// Un plan es una lista cerrada de pasos que se arma en el servidor, se muestra completa, se firma UNA vez con la llave
// de acceso y se ejecuta de a un paso por pedido (así cada pedido es corto y se puede reintentar sin duplicar nada).
// Nada de lo que escribe la persona llega a un comando o a SQL: los datos libres (nombre, correo) van siempre como
// datos JSON; el SQL que se ejecuta sale solo de las migraciones empaquetadas (con su huella) y de textos fijos.
import type { Almacen } from './almacen.ts';
import type { Config } from './config.ts';
import { malPedido, noExiste } from './errores.ts';
import { componentesInstalados, componentesParaModulos, etiquetaMigracion, expandirRegistro, faltantesPara, migracionesDe, NOMBRE_COMPONENTE, type Componente } from './componentes.ts';
import { FUNCIONES, MIGRACIONES, MODULOS } from './generado.ts';
import { estadoDesdeLista, IDS_MODULOS, nombreModulo, problemasDeDependencias, type EstadoModulos } from './modulos.ts';
import { aleatorio, hmacHex, sha256Hex } from './cripto.ts';
import { conocerSecreto } from './registro.ts';
import { crearProyectoCliente, type ProyectoCliente } from './proyectoCliente.ts';
import { ErrorSupabase, type SupabaseApi } from './supabaseApi.ts';
import { nombreDeProyecto, parseBooleano, parseComponente, parseCorreo, parseModulos, parseNombreCliente, parseOrg, parseOrgNueva, parseRef, parseRegion, parseUrlApp, soloClaves } from './validar.ts';

export type TipoPlan = 'crear' | 'actualizar' | 'modulos' | 'componente' | 'org_agregar' | 'org_quitar';
export interface Paso { id: string; etiqueta: string }
export interface Resumen { titulo: string; lineas: string[]; avisos: string[] }
export interface PlanNuevo { tipo: TipoPlan; ref: string | null; parametros: Record<string, unknown>; pasos: Paso[]; resumen: Resumen }

export interface Dependencias {
  config: Config;
  api: SupabaseApi;
  almacen: Almacen;
  /** Organizaciones que el panel puede operar (servidor + agregadas desde el panel). */
  organizaciones: () => Promise<string[]>;
  fetchImpl?: typeof fetch;
  ahora: () => number;
  /** Fábrica del acceso a un proyecto de cliente (se reemplaza en las pruebas). */
  proyectoCliente?: (ref: string, claves: { anon: string; servicio: string }) => ProyectoCliente;
}

const OCUPADO_MIN = 30; // minutos que se acepta "adoptar" un proyecto recién creado si se perdió la respuesta

// ---------------------------------------------------------------------------------------------
// Armado de planes (antes de firmar)
// ---------------------------------------------------------------------------------------------

const nombresEstadoEsperado = (estado: EstadoModulos): string[] => IDS_MODULOS.filter(id => estado[id]).map(nombreModulo);

export async function construirPlan(deps: Dependencias, tipo: string, cuerpo: Record<string, unknown>): Promise<PlanNuevo> {
  if (tipo === 'crear') return construirCrear(deps, cuerpo);
  if (tipo === 'actualizar') return construirActualizar(deps, cuerpo);
  if (tipo === 'modulos') return construirModulos(deps, cuerpo);
  if (tipo === 'componente') return construirComponente(deps, cuerpo);
  if (tipo === 'org_agregar') return construirOrgAgregar(deps, cuerpo);
  if (tipo === 'org_quitar') return construirOrgQuitar(deps, cuerpo);
  throw malPedido('tipo', 'Esa operación no existe.');
}

async function construirCrear(deps: Dependencias, c: Record<string, unknown>): Promise<PlanNuevo> {
  soloClaves(c, ['nombre', 'correo', 'modulos', 'region', 'urlApp', 'org'], ['nombre', 'correo', 'modulos']);
  const org = parseOrg(c.org, await deps.organizaciones());
  const nombre = parseNombreCliente(c.nombre);
  const correo = parseCorreo(c.correo);
  const modulos = parseModulos(c.modulos);
  const region = parseRegion(c.region);
  const urlApp = parseUrlApp(c.urlApp);
  const estado = estadoDesdeLista(modulos);
  const problemas = problemasDeDependencias(estado);
  if (problemas.length) throw malPedido('modulos', `Esa combinación de módulos no es posible: ${problemas.join(' ')}`);
  const nombreProyecto = nombreDeProyecto(nombre);
  // Solo se instalan los componentes de los módulos contratados: lo que no se contrata no existe en la base de datos del cliente.
  const componentes = componentesParaModulos(modulos);

  const existentes = await deps.api.listarProyectos();
  if (existentes.some(p => p.nombre.toLowerCase() === nombreProyecto)) throw malPedido('nombre', 'Ya hay un proyecto con ese nombre.');
  if (existentes.length >= deps.config.maxProyectos) throw malPedido('limite', `La organización ya tiene ${existentes.length} proyectos (tope: ${deps.config.maxProyectos}). Subí el tope en la configuración del panel si es a propósito.`);

  const pasos: Paso[] = [
    { id: 'verificar_nombre', etiqueta: 'Comprobar que el nombre está libre' },
    { id: 'crear_proyecto', etiqueta: 'Crear el proyecto en Supabase' },
    { id: 'esperar_proyecto', etiqueta: 'Esperar a que el proyecto esté listo (puede tardar unos minutos)' },
    { id: 'registro_migraciones', etiqueta: 'Preparar el registro de la base de datos' },
    ...migracionesDe(componentes).map(m => ({ id: `migracion:${m.nombre}`, etiqueta: etiquetaMigracion(m) })),
    { id: 'secreto', etiqueta: 'Configurar el secreto de las funciones' },
    ...FUNCIONES.map(f => ({ id: `funcion:${f.slug}`, etiqueta: `Publicar la función ${f.slug}` })),
    { id: 'cerrar_registro', etiqueta: 'Cerrar el registro público de usuarios' },
    { id: 'dueno', etiqueta: 'Crear al primer dueño' },
    { id: 'licencia', etiqueta: 'Definir los módulos contratados' },
    { id: 'verificar_final', etiqueta: 'Verificar que todo quedó bien' },
  ];
  return {
    tipo: 'crear',
    ref: null,
    parametros: { nombre, correo, modulos, region, urlApp, nombreProyecto, org, componentes },
    pasos,
    resumen: {
      titulo: `Crear cliente: ${nombre}`,
      lineas: [
        `Dueño: ${correo}`,
        `Módulos: ${nombresEstadoEsperado(estado).join(', ') || '(ninguno)'}`,
        `Se instala: ${componentes.map(c => NOMBRE_COMPONENTE[c]).join(' + ')}`,
        `Organización de Supabase: ${org}`,
        `Región: ${region}`,
        `Proyecto: ${nombreProyecto}`,
        urlApp ? `Dirección de la app: ${urlApp}` : 'Dirección de la app: sin definir (la ponés después en Supabase)',
      ],
      avisos: ['Se crea un proyecto nuevo en Supabase (puede tener costo según tu plan).'],
    },
  };
}

const MAX_ORGANIZACIONES = 30;

async function construirOrgAgregar(deps: Dependencias, c: Record<string, unknown>): Promise<PlanNuevo> {
  soloClaves(c, ['org'], ['org']);
  const org = parseOrgNueva(c.org);
  const actuales = await deps.organizaciones();
  if (actuales.includes(org)) throw malPedido('ya_esta', 'Esa organización ya está en el panel.');
  if (actuales.length >= MAX_ORGANIZACIONES) throw malPedido('limite', `El panel ya tiene ${actuales.length} organizaciones (tope: ${MAX_ORGANIZACIONES}).`);
  // El panel solo puede operar organizaciones que lo invitaron: se comprueba que la llave la ve.
  if (!(await deps.api.listarOrganizaciones()).includes(org)) {
    throw malPedido('no_visible', 'El panel no ve esa organización. Revisá que el cliente haya invitado a la cuenta del panel como Administrator, que la invitación esté aceptada y que el identificador sea el correcto.');
  }
  return {
    tipo: 'org_agregar', ref: null, parametros: { org },
    pasos: [{ id: 'registrar_org', etiqueta: 'Agregar la organización al panel' }],
    resumen: {
      titulo: `Agregar organización: ${org}`,
      lineas: ['El panel podrá ver y operar los proyectos de esa organización (crear clientes, actualizarlos y cambiar sus módulos).'],
      avisos: ['Solo agregá organizaciones de clientes que te dieron acceso a propósito.'],
    },
  };
}

async function construirOrgQuitar(deps: Dependencias, c: Record<string, unknown>): Promise<PlanNuevo> {
  soloClaves(c, ['org'], ['org']);
  const org = parseOrgNueva(c.org);
  const guardadas = ((await deps.almacen.rpc<string[] | null>('panel_org_listar', {})) ?? []);
  if (!guardadas.includes(org)) {
    if (deps.config.organizaciones.includes(org)) throw malPedido('de_servidor', 'Esa organización viene de la configuración del servidor: se quita editando PANEL_ORG_SLUGS ahí.');
    throw malPedido('no_esta', 'Esa organización no está en el panel.');
  }
  return {
    tipo: 'org_quitar', ref: null, parametros: { org },
    pasos: [{ id: 'quitar_org', etiqueta: 'Quitar la organización del panel' }],
    resumen: {
      titulo: `Quitar organización: ${org}`,
      lineas: ['El panel dejará de ver y de operar los proyectos de esa organización.'],
      avisos: ['No se borra nada en Supabase: los proyectos del cliente siguen funcionando igual. Solo se corta el acceso desde el panel.'],
    },
  };
}

// Proyecto que existe y está instalado con este sistema (tiene su registro de migraciones).
async function leerRegistro(deps: Dependencias, ref: string): Promise<string[]> {
  const proyecto = await deps.api.obtenerProyecto(ref);
  if (!proyecto) throw noExiste();
  let filas;
  try {
    filas = await deps.api.consultar(ref, 'select nombre from public.migraciones_aplicadas', { soloLectura: true });
  } catch (e) {
    if (e instanceof ErrorSupabase && (e.estado === 400 || e.estado === 500)) {
      throw malPedido('no_instalado', 'Ese proyecto no fue instalado con este sistema (no tiene el registro de migraciones). Adoptalo con el comando "pnpm cliente actualizar --marcar-hasta" desde tu computadora.');
    }
    throw e;
  }
  return filas.map(f => String(f.nombre));
}

// Lo que el cliente tiene instalado y lo que le falta de ello. Un registro de antes de los componentes cuenta como completo.
async function estadoInstalacion(deps: Dependencias, ref: string) {
  const registro = await leerRegistro(deps, ref);
  const instalados = componentesInstalados(registro);
  if (!instalados.length) throw malPedido('no_instalado', 'Ese proyecto tiene el registro de migraciones vacío: no se sabe qué tiene instalado.');
  const hechas = expandirRegistro(registro);
  return { instalados, hechas, faltan: migracionesDe(instalados).filter(m => !hechas.has(m.nombre)) };
}

async function construirActualizar(deps: Dependencias, c: Record<string, unknown>): Promise<PlanNuevo> {
  soloClaves(c, ['ref', 'soloBase'], ['ref']);
  const ref = parseRef(c.ref);
  const soloBase = parseBooleano(c.soloBase, 'soloBase');
  const proyecto = await deps.api.obtenerProyecto(ref);
  if (!proyecto) throw noExiste();
  const { instalados, faltan } = await estadoInstalacion(deps, ref);
  const pasos: Paso[] = [
    { id: 'preparar', etiqueta: 'Comprobar que el proyecto está disponible' },
    ...faltan.map(m => ({ id: `migracion:${m.nombre}`, etiqueta: etiquetaMigracion(m) })),
    ...(soloBase ? [] : [
      { id: 'secreto', etiqueta: 'Configurar el secreto de las funciones' },
      ...FUNCIONES.map(f => ({ id: `funcion:${f.slug}`, etiqueta: `Publicar la función ${f.slug}` })),
    ]),
    { id: 'cerrar_registro', etiqueta: 'Comprobar que el registro público está cerrado' },
    { id: 'verificar_final', etiqueta: 'Verificar que todo quedó bien' },
  ];
  return {
    tipo: 'actualizar', ref, parametros: { soloBase }, pasos,
    resumen: {
      titulo: `Actualizar cliente: ${proyecto.nombre}`,
      lineas: [
        `Componentes instalados: ${instalados.map(c => NOMBRE_COMPONENTE[c]).join(' + ')}`,
        faltan.length ? `Migraciones pendientes (${faltan.length}): ${faltan.map(m => m.nombre.replace(/\.sql$/, '')).join(', ')}` : 'La base de datos ya está al día.',
        soloBase ? 'No se vuelven a publicar las funciones.' : `Se vuelven a publicar las funciones (${FUNCIONES.map(f => f.slug).join(', ')}).`,
      ],
      avisos: faltan.length ? ['Cambia la base de datos del cliente. Hacelo fuera de su horario de uso.'] : [],
    },
  };
}

// Instalar en un cliente un componente que no tenía (por ejemplo, Mantenimiento más adelante). No toca los datos que ya hay.
async function construirComponente(deps: Dependencias, c: Record<string, unknown>): Promise<PlanNuevo> {
  soloClaves(c, ['ref', 'componente'], ['ref', 'componente']);
  const ref = parseRef(c.ref);
  const componente = parseComponente(c.componente);
  const proyecto = await deps.api.obtenerProyecto(ref);
  if (!proyecto) throw noExiste();
  const { instalados, hechas } = await estadoInstalacion(deps, ref);
  if (instalados.includes(componente)) throw malPedido('ya_instalado', `El componente ${NOMBRE_COMPONENTE[componente]} ya está instalado en ese cliente.`);
  const faltan = faltantesPara(componente, instalados);
  if (faltan.length) throw malPedido('requisitos', `Para instalar ${NOMBRE_COMPONENTE[componente]} primero hace falta: ${faltan.map(x => NOMBRE_COMPONENTE[x]).join(', ')}.`);
  const nuevas = migracionesDe([componente]).filter(m => !hechas.has(m.nombre));
  const modulosDelComponente = MODULOS.filter(m => m.componente === componente).map(m => m.nombre);
  return {
    tipo: 'componente', ref, parametros: { componente },
    pasos: [
      { id: 'preparar', etiqueta: 'Comprobar que el proyecto está disponible' },
      { id: 'verificar_requisitos', etiqueta: 'Comprobar que tiene instalado lo que ese componente necesita' },
      ...nuevas.map(m => ({ id: `migracion:${m.nombre}`, etiqueta: etiquetaMigracion(m) })),
      { id: 'verificar_final', etiqueta: 'Verificar que todo quedó bien' },
    ],
    resumen: {
      titulo: `Instalar ${NOMBRE_COMPONENTE[componente]} en: ${proyecto.nombre}`,
      lineas: [
        `Ya tiene: ${instalados.map(x => NOMBRE_COMPONENTE[x]).join(' + ')}`,
        `Se agrega: ${NOMBRE_COMPONENTE[componente]} (${nuevas.length} migraciones)`,
        `Módulos que trae: ${modulosDelComponente.join(', ')}. Quedan APAGADOS hasta que los actives con "Aplicar cambios de módulos".`,
      ],
      avisos: ['Agrega tablas a la base de datos del cliente. Los datos que ya tiene no se tocan. Hacelo fuera de su horario de uso.'],
    },
  };
}

async function claves(deps: Dependencias, ref: string) { return deps.api.claves(ref); }
function acceso(deps: Dependencias, ref: string, k: { anon: string; servicio: string }): ProyectoCliente {
  return deps.proyectoCliente ? deps.proyectoCliente(ref, k) : crearProyectoCliente(ref, k, deps.config.pasoTimeoutMs, deps.fetchImpl);
}

async function construirModulos(deps: Dependencias, c: Record<string, unknown>): Promise<PlanNuevo> {
  soloClaves(c, ['ref', 'activar', 'desactivar'], ['ref']);
  const ref = parseRef(c.ref);
  const activar = c.activar === undefined ? [] : parseModulos(c.activar, 'activar');
  const desactivar = c.desactivar === undefined ? [] : parseModulos(c.desactivar, 'desactivar');
  if (activar.some(m => desactivar.includes(m))) throw malPedido('modulos', 'Un módulo no puede activarse y apagarse a la vez.');
  const proyecto = await deps.api.obtenerProyecto(ref);
  if (!proyecto) throw noExiste();
  const k = await claves(deps, ref);
  const antes = await acceso(deps, ref, k).leerLicencia();
  if (!antes) throw malPedido('licencia', 'No pude leer la licencia del cliente. ¿Tiene instaladas todas las migraciones? Actualizalo primero.');
  const despues: EstadoModulos = { ...antes };
  for (const m of activar) despues[m] = true;
  for (const m of desactivar) despues[m] = false;
  const problemas = problemasDeDependencias(despues);
  if (problemas.length) throw malPedido('modulos', `Esa combinación no es posible: ${problemas.join(' ')}`);
  // Un módulo solo se puede activar si el cliente tiene instalado su componente.
  const { instalados } = await estadoInstalacion(deps, ref);
  for (const m of MODULOS) {
    if (despues[m.id] && !antes[m.id] && !instalados.includes(m.componente as Componente)) {
      throw malPedido('componente', `"${m.nombre}" es del componente ${NOMBRE_COMPONENTE[m.componente as Componente]}, que no está instalado en ese cliente. Instalalo primero.`);
    }
  }
  const cambian = IDS_MODULOS.filter(id => antes[id] !== despues[id]);
  if (!cambian.length) throw malPedido('sin_cambios', 'No hay cambios que hacer.');
  const avisos: string[] = [];
  for (const id of cambian.filter(i => !despues[i])) {
    avisos.push(`Apagar "${nombreModulo(id)}" bloquea para TODOS (también para el dueño): ${MODULOS.find(m => m.id === id)?.bloquea}. Los datos no se borran.`);
  }
  return {
    tipo: 'modulos', ref, parametros: { antes, despues },
    pasos: [{ id: 'licencia', etiqueta: 'Cambiar la licencia de módulos y verificarla' }],
    resumen: {
      titulo: `Cambiar módulos: ${proyecto.nombre}`,
      lineas: cambian.map(id => `${nombreModulo(id)}: ${antes[id] ? 'activo' : 'apagado'} → ${despues[id] ? 'ACTIVO' : 'APAGADO'}`),
      avisos,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Ejecución de un paso
// ---------------------------------------------------------------------------------------------

export interface EntradaPaso {
  planId: string;
  tipo: TipoPlan;
  paso: Paso;
  indice: number;
  total: number;
  parametros: Record<string, unknown>;
  contexto: Record<string, unknown>;
  ref: string | null;
}
export interface SalidaPaso {
  resultado: 'ok' | 'reintentar' | 'fallo';
  mensaje: string;
  contexto?: Record<string, unknown>;
  ref?: string;
}

// La contraseña inicial del dueño no se guarda en ningún lado: se calcula a partir del secreto del servidor y
// del plan, así se puede volver a mostrar (una vez, hasta que se acuse) si se perdió la respuesta.
export function claveInicial(config: Config, planId: string, ref: string): string {
  const base = Buffer.from(hmacHex(config.secreto, `dueno|${planId}|${ref}`), 'hex').toString('base64url');
  return `${base.slice(0, 18)}-9a`;
}

const MAX_FALLOS_TRANSITORIOS = 5;
const ESPERA_TIMEOUT_MS = 60_000;
const MAX_ESPERAS_PROYECTO = 90;

const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const cadena = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function ejecutarPaso(deps: Dependencias, e: EntradaPaso): Promise<SalidaPaso> {
  const fallosPrevios = numero((e.contexto.fallos as Record<string, unknown> | undefined)?.[e.paso.id]);
  try {
    // Si el paso anterior se cortó por tiempo, la consulta puede seguir corriendo del otro lado: se espera un poco
    // antes de volver a intentarlo (para no lanzar dos veces la misma migración al mismo tiempo).
    const esperaHasta = numero(e.contexto.esperaHasta);
    if (cadena(e.contexto.esperaPaso) === e.paso.id && esperaHasta > deps.ahora()) {
      return { resultado: 'reintentar', mensaje: 'Esperando a que termine el intento anterior…' };
    }
    return await correr(deps, e);
  } catch (err) {
    if (err instanceof ErrorSupabase) {
      const transitorio = err.estado === 0 || err.estado === 408 || err.estado === 429 || err.estado >= 500;
      if (transitorio && fallosPrevios + 1 < MAX_FALLOS_TRANSITORIOS) {
        const ctx: Record<string, unknown> = { fallos: { ...(e.contexto.fallos as object | undefined), [e.paso.id]: fallosPrevios + 1 } };
        if (err.estado === 408) { ctx.esperaPaso = e.paso.id; ctx.esperaHasta = deps.ahora() + ESPERA_TIMEOUT_MS; }
        return { resultado: 'reintentar', mensaje: `${err.message} Se reintenta.`, contexto: ctx };
      }
      if (err.estado === 401 || err.estado === 403) return { resultado: 'fallo', mensaje: 'Supabase rechazó la llave del panel (permisos o vencimiento). Revisá el token.' };
      return { resultado: 'fallo', mensaje: err.message || 'Falló una llamada a Supabase.' };
    }
    throw err;
  }
}

const REG = `public.migraciones_aplicadas`;

async function correr(deps: Dependencias, e: EntradaPaso): Promise<SalidaPaso> {
  const { api } = deps;
  const id = e.paso.id;
  const ref = e.ref ?? cadena(e.contexto.ref);

  // ---- pasos de "crear" que todavía no tienen proyecto ----
  if (id === 'verificar_nombre') {
    const nombreProyecto = cadena(e.parametros.nombreProyecto);
    const lista = await api.listarProyectos();
    if (lista.some(p => p.nombre.toLowerCase() === nombreProyecto)) return { resultado: 'fallo', mensaje: 'Ya hay un proyecto con ese nombre.' };
    return { resultado: 'ok', mensaje: 'El nombre está libre.', contexto: { t0: deps.ahora() } };
  }
  if (id === 'registrar_org') {
    const org = cadena(e.parametros.org);
    if (!(await api.listarOrganizaciones()).includes(org)) return { resultado: 'fallo', mensaje: 'El panel ya no ve esa organización: revisá la invitación.' };
    const nueva = await deps.almacen.rpc<boolean>('panel_org_agregar', { p_slug: org });
    return { resultado: 'ok', mensaje: nueva ? 'Organización agregada.' : 'Esa organización ya estaba.' };
  }
  if (id === 'quitar_org') {
    const quitada = await deps.almacen.rpc<boolean>('panel_org_quitar', { p_slug: cadena(e.parametros.org) });
    return { resultado: 'ok', mensaje: quitada ? 'Organización quitada del panel.' : 'Esa organización ya no estaba.' };
  }
  if (id === 'crear_proyecto') {
    const nombreProyecto = cadena(e.parametros.nombreProyecto);
    const t0 = numero(e.contexto.t0);
    // Si una ejecución anterior llegó a crear el proyecto pero se perdió la respuesta, se lo "adopta" en vez de duplicarlo.
    const lista = await api.listarProyectos();
    const adoptable = lista.find(p => p.nombre.toLowerCase() === nombreProyecto && p.org === cadena(e.parametros.org) && Date.parse(p.creado) >= t0 - 60_000 && deps.ahora() - Date.parse(p.creado) < OCUPADO_MIN * 60_000);
    if (adoptable) return { resultado: 'ok', mensaje: 'Proyecto encontrado (ya estaba creado).', ref: adoptable.ref, contexto: { ref: adoptable.ref } };
    // La contraseña de la base es aleatoria y NO se guarda: el panel no la necesita (puede restablecerse desde Supabase).
    const claveBase = aleatorio(24);
    conocerSecreto(claveBase);
    const p = await api.crearProyecto({ nombre: nombreProyecto, region: cadena(e.parametros.region), clave: claveBase, org: cadena(e.parametros.org) });
    return { resultado: 'ok', mensaje: 'Proyecto creado.', ref: p.ref, contexto: { ref: p.ref } };
  }
  if (!ref) return { resultado: 'fallo', mensaje: 'El plan no tiene proyecto.' };

  if (id === 'esperar_proyecto' || id === 'preparar') {
    const intentos = numero(e.contexto.esperas) + 1;
    const p = await api.obtenerProyecto(ref);
    const fin = (m: string): SalidaPaso => ({ resultado: 'reintentar', mensaje: m, contexto: { esperas: intentos } });
    if (intentos > MAX_ESPERAS_PROYECTO) return { resultado: 'fallo', mensaje: 'El proyecto no quedó listo a tiempo. Revisalo en Supabase.' };
    if (!p) return fin('Esperando que aparezca el proyecto…');
    if (['INIT_FAILED', 'REMOVED', 'GOING_DOWN', 'PAUSED', 'INACTIVE'].includes(p.estado) && id === 'preparar') return { resultado: 'fallo', mensaje: `El proyecto está en estado ${p.estado}.` };
    if (['INIT_FAILED', 'REMOVED', 'GOING_DOWN'].includes(p.estado)) return { resultado: 'fallo', mensaje: `El proyecto quedó en estado ${p.estado}.` };
    if (p.estado !== 'ACTIVE_HEALTHY') return fin(`Estado: ${p.estado.toLowerCase().replaceAll('_', ' ')}…`);
    try { await api.consultar(ref, 'select 1 as ok', { soloLectura: true }); } catch { return fin('La base todavía no responde…'); }
    return { resultado: 'ok', mensaje: 'El proyecto está listo.' };
  }

  if (id === 'registro_migraciones') {
    const hay = await api.consultar(ref, `select to_regclass('${REG}') is not null as hay`, { soloLectura: true });
    if (!hay[0]?.hay) {
      const t = await api.consultar(ref, `select count(*)::int as n from pg_tables where schemaname = 'public'`, { soloLectura: true });
      if (Number(t[0]?.n ?? 0) > 0) return { resultado: 'fallo', mensaje: 'Ese proyecto ya tiene tablas: no se toca nada.' };
      await api.consultar(ref, `create table if not exists ${REG} (nombre text primary key, aplicada_at timestamptz not null default now());
        alter table ${REG} enable row level security;
        revoke all on ${REG} from anon, authenticated;`);
    }
    return { resultado: 'ok', mensaje: 'Registro listo.' };
  }

  if (id.startsWith('migracion:')) {
    const nombre = id.slice('migracion:'.length);
    const m = MIGRACIONES.find(x => x.nombre === nombre);
    if (!m) return { resultado: 'fallo', mensaje: 'Migración desconocida.' };
    if (sha256Hex(m.sql) !== m.sha256) return { resultado: 'fallo', mensaje: 'La migración empaquetada no coincide con su huella.' };
    // También cuenta como hecha si el registro es de antes de los componentes (ahí figura solo el nombre del archivo).
    const archivo = m.nombre.slice(m.nombre.indexOf('/') + 1);
    const hecha = await api.consultar(ref, `select 1 as ok from ${REG} where nombre in ('${m.nombre}', '${archivo}')`, { soloLectura: true });
    if (hecha.length) return { resultado: 'ok', mensaje: `${m.nombre}: ya estaba aplicada.` };
    // La migración y su registro van en el mismo envío: o se aplica todo o nada.
    await api.consultar(ref, `${m.sql}\n;\ninsert into ${REG} (nombre) values ('${m.nombre}') on conflict do nothing;`);
    return { resultado: 'ok', mensaje: `${m.nombre}: aplicada.` };
  }

  if (id === 'secreto') {
    const k = await claves(deps, ref);
    await api.fijarSecretos(ref, [{ name: 'PROJECT_SECRET_KEY', value: k.servicio }]);
    return { resultado: 'ok', mensaje: 'Secreto configurado.' };
  }

  if (id.startsWith('funcion:')) {
    const slug = id.slice('funcion:'.length);
    const f = FUNCIONES.find(x => x.slug === slug);
    if (!f) return { resultado: 'fallo', mensaje: 'Función desconocida.' };
    if (sha256Hex(f.fuente) !== f.sha256) return { resultado: 'fallo', mensaje: 'La función empaquetada no coincide con su huella.' };
    await api.desplegarFuncion(ref, f.slug, f.fuente);
    return { resultado: 'ok', mensaje: `Función ${f.slug} publicada.` };
  }

  if (id === 'cerrar_registro') {
    const cambios: { disable_signup: boolean; site_url?: string; uri_allow_list?: string } = { disable_signup: true };
    const urlApp = typeof e.parametros.urlApp === 'string' ? e.parametros.urlApp : '';
    if (e.tipo === 'crear' && urlApp) { cambios.site_url = urlApp; cambios.uri_allow_list = urlApp; }
    await api.configurarAuth(ref, cambios);
    const k = await claves(deps, ref);
    const estado = await acceso(deps, ref, k).registroPublico();
    if (estado === 'abierto') return { resultado: 'reintentar', mensaje: 'El cambio todavía no se refleja…' };
    return { resultado: 'ok', mensaje: estado === 'cerrado' ? 'Registro público cerrado.' : 'Registro cerrado (no se pudo comprobar).' };
  }

  if (id === 'dueno') {
    const k = await claves(deps, ref);
    const cliente = acceso(deps, ref, k);
    const correo = cadena(e.parametros.correo);
    const clave = claveInicial(deps.config, e.planId, ref);
    conocerSecreto(clave);
    const r = await cliente.crearDueno(correo, clave);
    await cliente.definirDueno(correo);
    await cliente.fijarNombreEmpresa(cadena(e.parametros.nombre));
    return { resultado: 'ok', mensaje: r === 'creado' ? 'Dueño creado.' : 'Ese correo ya existía: se conserva su contraseña.', contexto: { duenoExistia: r === 'ya_existia' } };
  }

  if (id === 'licencia') {
    const k = await claves(deps, ref);
    const cliente = acceso(deps, ref, k);
    if (e.tipo === 'crear') {
      const deseado = estadoDesdeLista(Array.isArray(e.parametros.modulos) ? (e.parametros.modulos as string[]) : []);
      await cliente.escribirLicencia(deseado);
      const leida = await cliente.leerLicencia();
      if (!leida || IDS_MODULOS.some(m => leida[m] !== deseado[m])) return { resultado: 'fallo', mensaje: 'La licencia no quedó como se esperaba.' };
      return { resultado: 'ok', mensaje: `Módulos: ${nombresEstadoEsperado(deseado).join(', ') || '(ninguno)'}.` };
    }
    // modulos: solo si la licencia sigue como estaba cuando se armó el plan (si alguien la cambió, no se pisa).
    const antes = e.parametros.antes as EstadoModulos, despues = e.parametros.despues as EstadoModulos;
    const actual = await cliente.leerLicencia();
    if (!actual || IDS_MODULOS.some(m => actual[m] !== antes[m])) return { resultado: 'fallo', mensaje: 'La licencia cambió desde que se armó el plan. Armá el plan de nuevo.' };
    await cliente.escribirLicencia(despues);
    const leida = await cliente.leerLicencia();
    if (!leida || IDS_MODULOS.some(m => leida[m] !== despues[m])) return { resultado: 'fallo', mensaje: 'La licencia no quedó como se esperaba. Revisala.' };
    return { resultado: 'ok', mensaje: 'Licencia actualizada. Queda anotado en el Historial del cliente.' };
  }

  if (id === 'verificar_requisitos') {
    // Se vuelve a comprobar al ejecutar (no solo al armar el plan): el cliente pudo cambiar mientras tanto.
    const componente = parseComponente(e.parametros.componente);
    const registro = await leerRegistro(deps, ref);
    const instalados = componentesInstalados(registro);
    if (instalados.includes(componente)) return { resultado: 'fallo', mensaje: `${NOMBRE_COMPONENTE[componente]} ya estaba instalado: armá el plan de nuevo.` };
    const faltan = faltantesPara(componente, instalados);
    if (faltan.length) return { resultado: 'fallo', mensaje: `Falta instalar antes: ${faltan.map(x => NOMBRE_COMPONENTE[x]).join(', ')}.` };
    return { resultado: 'ok', mensaje: 'Tiene lo que hace falta.' };
  }

  if (id === 'verificar_final') {
    // Qué componentes tienen que estar completos: los del plan (crear), los instalados (actualizar) o esos más el agregado (componente).
    const registro = await leerRegistro(deps, ref);
    const esperados = new Set<string>(e.tipo === 'crear' ? (e.parametros.componentes as string[]) : componentesInstalados(registro));
    if (e.tipo === 'componente') esperados.add(parseComponente(e.parametros.componente));
    const hechas = expandirRegistro(registro);
    const faltan = migracionesDe([...esperados]).filter(m => !hechas.has(m.nombre));
    if (faltan.length) return { resultado: 'fallo', mensaje: `Faltan migraciones: ${faltan.map(m => m.nombre).join(', ')}` };
    const k = await claves(deps, ref);
    const registroPublico = await acceso(deps, ref, k).registroPublico();
    if (registroPublico === 'abierto') return { resultado: 'fallo', mensaje: 'El registro público quedó abierto: cerralo en Supabase.' };
    return { resultado: 'ok', mensaje: 'Todo verificado.' };
  }

  return { resultado: 'fallo', mensaje: 'Paso desconocido.' };
}
