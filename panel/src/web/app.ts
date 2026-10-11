// Interfaz del panel (celular primero). Reglas de seguridad de este archivo:
//  * Nada de innerHTML / insertAdjacentHTML / document.write / eval: todo el texto entra con createTextNode (textContent).
//    Así, aunque un dato del servidor trajera código, se vería como texto y no se ejecutaría.
//  * Ninguna llave, token ni contraseña se guarda en el navegador (ni localStorage ni cookies legibles): lo único que
//    queda es la cookie de sesión, que el navegador no deja leer desde acá (HttpOnly).
//  * La contraseña inicial de un cliente se muestra una vez y se borra de la pantalla al cerrarla.

type Json = any; // las respuestas del servidor son de confianza en forma, no en contenido: se usan solo con textContent

// ---------- DOM seguro ----------
type Hijo = Node | string | null | undefined | false;
function h(etiqueta: string, atributos: Record<string, string | boolean | ((e: Event) => void)> = {}, ...hijos: Hijo[]): HTMLElement {
  const e = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
    else if (typeof v === 'boolean') { if (v) e.setAttribute(k, ''); }
    else if (!/^on/i.test(k) && !['href', 'src', 'srcdoc', 'style'].includes(k)) e.setAttribute(k, v);
  }
  for (const x of hijos) if (x) e.append(typeof x === 'string' ? document.createTextNode(x) : x);
  return e;
}
const raiz = document.getElementById('app')!;
const mostrar = (...nodos: Hijo[]) => { raiz.replaceChildren(...nodos.filter((n): n is Node | string => !!n).map(n => (typeof n === 'string' ? document.createTextNode(n) : n))); window.scrollTo(0, 0); };

// ---------- API ----------
class ErrorApi extends Error { estado: number; codigo: string; constructor(estado: number, codigo: string, mensaje: string) { super(mensaje); this.estado = estado; this.codigo = codigo; } }
async function api(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<Json> {
  const r = await fetch(ruta, {
    method: metodo, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'x-panel': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
  let datos: Json = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/api/ingreso/verificar') { sesionVencida(); }
    throw new ErrorApi(r.status, String(datos?.error ?? 'error'), String(datos?.mensaje ?? `Error ${r.status}`));
  }
  return datos;
}

// ---------- llaves de acceso (WebAuthn) ----------
const aBytes = (b64: string): ArrayBuffer => {
  const s = atob(b64.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer;
};
const aB64 = (buf: ArrayBuffer): string => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); };

async function crearLlave(opciones: Json): Promise<Json> {
  const pk: PublicKeyCredentialCreationOptions = {
    ...opciones, challenge: aBytes(opciones.challenge), user: { ...opciones.user, id: aBytes(opciones.user.id) },
    excludeCredentials: (opciones.excludeCredentials ?? []).map((c: Json) => ({ ...c, id: aBytes(c.id) })),
  };
  const cred = (await navigator.credentials.create({ publicKey: pk })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se creó la llave.');
  const r = cred.response as AuthenticatorAttestationResponse;
  return { id: cred.id, rawId: aB64(cred.rawId), type: cred.type, response: { clientDataJSON: aB64(r.clientDataJSON), attestationObject: aB64(r.attestationObject), transports: r.getTransports?.() ?? [] } };
}
async function usarLlave(opciones: Json): Promise<Json> {
  const pk: PublicKeyCredentialRequestOptions = { ...opciones, challenge: aBytes(opciones.challenge), allowCredentials: (opciones.allowCredentials ?? []).map((c: Json) => ({ ...c, id: aBytes(c.id) })) };
  const cred = (await navigator.credentials.get({ publicKey: pk })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se usó la llave.');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: aB64(cred.rawId), type: cred.type,
    response: { clientDataJSON: aB64(r.clientDataJSON), authenticatorData: aB64(r.authenticatorData), signature: aB64(r.signature), ...(r.userHandle ? { userHandle: aB64(r.userHandle) } : {}) },
  };
}

// ---------- piezas comunes ----------
const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.message : e instanceof DOMException && e.name === 'NotAllowedError' ? 'Cancelaste o no se pudo confirmar con la llave.' : e instanceof Error ? e.message : 'Error inesperado.');
const errorBox = (m: string) => h('div', { class: 'error', role: 'alert' }, m);

function encabezado(titulo: string, atras?: () => void): HTMLElement {
  return h('div', { class: 'barra' },
    h('div', { class: 'fila' }, atras ? h('button', { onclick: atras, 'aria-label': 'Volver' }, '←') : null, h('h1', {}, titulo)),
  );
}

let ultimoMovimiento = Date.now();
let ocultoDesde = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ocultoDesde = Date.now(); return; }
  // Si el celular estuvo 5 minutos con otra app, se cierra la sesión (y se borra lo que había en pantalla).
  if (ocultoDesde && Date.now() - ocultoDesde > 5 * 60_000) void salir();
  ocultoDesde = 0;
});
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { ultimoMovimiento = Date.now(); }, { passive: true });
setInterval(() => { if (Date.now() - ultimoMovimiento > 14 * 60_000 && enSesion) void salir(); }, 30_000);

// Último recurso: ningún error queda sin atrapar. Si la sesión venció ya se mostró la pantalla de ingreso; cualquier otro error se muestra.
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  if (e.reason instanceof ErrorApi && e.reason.estado === 401) return;
  raiz.prepend(errorBox(mensajeDe(e.reason)));
});

let enSesion = false;
function sesionVencida() { if (!enSesion) return; enSesion = false; pantallaIngreso(false, 'La sesión venció. Entrá de nuevo.'); }
async function salir() { enSesion = false; try { await api('POST', '/api/salida', {}); } catch { /* ya estaba cerrada */ } pantallaIngreso(false); }

// ---------- pantallas de acceso ----------
function pantallaAlta(modo: string, mensaje = '') {
  const codigo = h('input', { type: 'password', autocomplete: 'off', id: 'codigo', 'aria-label': 'Código de alta' }) as HTMLInputElement;
  const nombre = h('input', { type: 'text', id: 'nombre', maxlength: '40' }) as HTMLInputElement;
  nombre.value = modo === 'primera' ? 'Celular' : 'Respaldo';
  const caja = h('div');
  const boton = h('button', { class: 'primario ancho' }, 'Registrar esta llave') as HTMLButtonElement;
  boton.onclick = async () => {
    boton.disabled = true; caja.replaceChildren();
    try {
      const o = await api('POST', '/api/alta/opciones', { codigo: codigo.value });
      const respuesta = await crearLlave(o.opciones);
      const r = await api('POST', '/api/alta/verificar', { codigo: codigo.value, nombre: nombre.value, respuesta });
      codigo.value = '';
      mostrar(encabezado('Llave registrada'), h('div', { class: 'tarjeta' }, h('p', {}, `Listo. Ya hay ${r.llaves} llave(s) registrada(s).`),
        h('p', { class: 'chica' }, 'Registrá también una llave de respaldo (otro celular o una llave USB) por si perdés este teléfono. Tenés 15 minutos.'),
        h('button', { class: 'ancho', onclick: () => pantallaAlta('respaldo') }, 'Registrar otra llave'),
        h('button', { class: 'primario ancho', onclick: () => { void iniciar(); } }, 'Terminar')));
    } catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); boton.disabled = false; }
  };
  mostrar(encabezado('Registrar llave de acceso'),
    h('div', { class: 'tarjeta' },
      mensaje ? errorBox(mensaje) : null,
      h('p', {}, 'Vas a guardar una llave de acceso en este dispositivo (huella o rostro). Después entrás sin contraseña.'),
      h('label', { for: 'codigo' }, 'Código de alta'), codigo,
      h('label', { for: 'nombre' }, 'Nombre de esta llave'), nombre, boton, caja));
}

function pantallaIngreso(altaAbierta: boolean, mensaje = '') {
  const caja = h('div');
  const boton = h('button', { class: 'primario ancho' }, 'Entrar con huella o rostro') as HTMLButtonElement;
  boton.onclick = async () => {
    boton.disabled = true; caja.replaceChildren();
    try {
      const o = await api('POST', '/api/ingreso/opciones', {});
      const respuesta = await usarLlave(o.opciones);
      await api('POST', '/api/ingreso/verificar', { respuesta });
      enSesion = true; ultimoMovimiento = Date.now();
      await principal();
    } catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); boton.disabled = false; }
  };
  mostrar(encabezado('Panel de clientes'),
    h('div', { class: 'tarjeta' }, mensaje ? errorBox(mensaje) : null, h('p', {}, 'Acceso solo para el proveedor.'), boton, caja,
      altaAbierta ? h('button', { class: 'ancho', onclick: () => pantallaAlta('respaldo') }, 'Registrar una llave') : null));
}

async function iniciar() {
  try {
    const e = await api('GET', '/api/estado');
    if (e.sesion) { enSesion = true; await principal(); return; }
    if (e.altaAbierta && !e.hayLlaves) { pantallaAlta('primera'); return; }
    pantallaIngreso(e.altaAbierta);
  } catch (e) { mostrar(encabezado('Panel de clientes'), errorBox(mensajeDe(e)), h('button', { class: 'ancho', onclick: () => { void iniciar(); } }, 'Reintentar')); }
}

// ---------- panel principal ----------
const etiquetaEstado = (estado: string) => h('span', { class: `etiqueta ${estado === 'ACTIVE_HEALTHY' ? 'ok' : estado.includes('FAIL') ? 'mal' : ''}` }, estado.toLowerCase().replaceAll('_', ' '));

async function principal() {
  mostrar(encabezado('Clientes'), h('p', { class: 'chica' }, 'Cargando…'));
  try {
    const [{ clientes }, estado] = await Promise.all([api('GET', '/api/clientes'), api('GET', '/api/estado')]);
    mostrar(
      h('div', { class: 'barra' }, h('h1', {}, 'Clientes'), h('div', { class: 'fila' },
        h('button', { onclick: () => { void salir(); } }, 'Salir'))),
      h('button', { class: 'primario ancho', onclick: () => { void formularioNuevo(); } }, '＋ Nuevo cliente'),
      ...(clientes as Json[]).map(c => h('div', { class: 'tarjeta clic', role: 'button', tabindex: '0', onclick: () => { void detalle(c.ref); } },
        h('div', { class: 'fila' }, h('strong', {}, c.nombre), etiquetaEstado(c.estado)),
        h('div', { class: 'chica' }, `${c.region} · creado ${String(c.creado).slice(0, 10)} · org ${c.org}`))),
      clientes.length ? null : h('p', { class: 'chica' }, 'Todavía no hay clientes.'),
      h('div', { class: 'fila arriba' },
        h('button', { onclick: () => { void auditoria(); } }, 'Auditoría'),
        h('button', { onclick: () => { void organizaciones(); } }, 'Organizaciones'),
        h('button', { class: 'peligro', onclick: () => { void panico(); } }, 'Pánico')),
      h('p', { class: 'chica' }, `Versión de la plantilla: ${estado.version}`));
  } catch (e) { if (enSesion) mostrar(encabezado('Clientes'), errorBox(mensajeDe(e)), h('button', { class: 'ancho', onclick: () => { void principal(); } }, 'Reintentar')); }
}

async function panico() {
  if (!confirm('Esto cierra TODAS las sesiones y cancela todos los planes pendientes. ¿Seguro?')) return;
  try { await api('POST', '/api/panico', {}); } catch { /* si falla, igual se sale */ }
  enSesion = false; pantallaIngreso(false, 'Pánico: todas las sesiones fueron cerradas.');
}

// ---------- organizaciones de Supabase (una por cliente) ----------
async function organizaciones() {
  const volver = () => { void principal(); };
  try {
    const { organizaciones: lista } = await api('GET', '/api/organizaciones') as { organizaciones: { slug: string; origen: string }[] };
    const caja = h('div');
    const campo = h('input', { type: 'text', id: 'orgnueva', maxlength: '40', autocomplete: 'off', autocapitalize: 'none', placeholder: 'identificador de la organización' }) as HTMLInputElement;
    const agregar = h('button', { class: 'primario ancho' }, 'Agregar organización') as HTMLButtonElement;
    agregar.onclick = async () => {
      caja.replaceChildren();
      try { await abrirPlan('org_agregar', { org: campo.value.trim() }, () => { void organizaciones(); }); } catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); }
    };
    mostrar(encabezado('Organizaciones', volver),
      h('div', { class: 'tarjeta' },
        h('p', {}, 'Cada cliente tiene su propia organización de Supabase. El panel solo opera las que figuran acá.'),
        ...(lista.length ? lista.map(o => h('div', { class: 'opcion' },
          h('div', { class: 'fila' }, h('strong', {}, o.slug), h('span', { class: 'etiqueta' }, o.origen === 'servidor' ? 'del servidor' : 'agregada')),
          o.origen === 'panel' ? h('button', { onclick: async () => { try { await abrirPlan('org_quitar', { org: o.slug }, () => { void organizaciones(); }); } catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); } } }, 'Quitar') : null))
          : [h('p', { class: 'chica' }, 'Todavía no hay ninguna.')])),
      h('div', { class: 'tarjeta' },
        h('strong', {}, 'Agregar la organización de un cliente'),
        h('p', { class: 'chica' }, 'Antes, el cliente tiene que invitar a la cuenta del panel como Administrator en su organización de Supabase, y la invitación tiene que estar aceptada. El identificador es el texto que aparece en la dirección de Supabase: .../dashboard/org/IDENTIFICADOR.'),
        h('label', { for: 'orgnueva' }, 'Identificador'), campo, agregar, caja));
  } catch (e) { mostrar(encabezado('Organizaciones', volver), errorBox(mensajeDe(e))); }
}

async function auditoria() {
  try {
    const r = await api('GET', '/api/auditoria');
    mostrar(encabezado('Auditoría', () => { void principal(); }),
      h('div', { class: r.cadena.ok ? 'tarjeta' : 'error' }, r.cadena.ok ? `Cadena íntegra (${r.cadena.total} registros).` : `¡CADENA ROTA en el registro ${r.cadena.roto_en}! Alguien tocó el historial.`),
      ...(r.eventos as Json[]).map(ev => h('div', { class: 'evento' }, `${String(ev.at).slice(0, 19).replace('T', ' ')} · ${ev.actor} · ${ev.evento}${ev.detalle?.tipo ? ` · ${ev.detalle.tipo}` : ''}${ev.detalle?.ref ? ` · ${ev.detalle.ref}` : ''}`)));
  } catch (e) { mostrar(encabezado('Auditoría', () => { void principal(); }), errorBox(mensajeDe(e))); }
}

// ---------- detalle de un cliente ----------
async function detalle(ref: string) {
  mostrar(encabezado('Cliente', () => { void principal(); }), h('p', { class: 'chica' }, 'Cargando…'));
  try {
    const [c, { modulos }] = await Promise.all([api('GET', `/api/clientes/${ref}`), api('GET', '/api/modulos')]);
    const d = c.detalle;
    const actuales: Record<string, boolean> = d?.modulos ?? {};
    const marcas = new Map<string, HTMLInputElement>();
    const lista = h('div', { class: 'tarjeta' }, h('strong', {}, 'Módulos contratados'),
      ...(modulos as Json[]).map(m => {
        const cb = h('input', { type: 'checkbox', id: `m-${m.id}` }) as HTMLInputElement; cb.checked = !!actuales[m.id]; marcas.set(m.id, cb);
        // Un módulo cuyo componente no está instalado no se puede activar hasta instalarlo.
        const sinComponente = !!d?.componentes && !(d.componentes.instalados as Json[]).some(x => x.id === m.componente);
        if (sinComponente) cb.disabled = true;
        return h('label', { class: 'opcion', for: `m-${m.id}` }, cb, h('span', {}, h('strong', {}, m.nombre), h('div', { class: 'chica' }, sinComponente ? 'Primero hay que instalar su componente (botón de arriba).' : m.descripcion)));
      }));
    const componentes = d?.componentes ? h('div', { class: 'tarjeta' }, h('strong', {}, 'Componentes'),
      h('div', { class: 'fila' }, h('span', {}, 'Instalados'), h('span', {}, (d.componentes.instalados as Json[]).map(x => x.nombre).join(' + '))),
      ...(d.componentes.instalables as Json[]).map(x => h('button', { class: 'ancho', onclick: () => { void abrirPlan('componente', { ref, componente: x.id }, () => { void detalle(ref); }).catch(e => caja.replaceChildren(errorBox(mensajeDe(e)))); } }, `Instalar ${x.nombre} (agrega: ${(x.modulos as string[]).join(', ')})`))) : null;
    const caja = h('div');
    const aplicar = h('button', { class: 'primario ancho' }, 'Aplicar cambios de módulos') as HTMLButtonElement;
    aplicar.onclick = async () => {
      const activar = [...marcas].filter(([id, cb]) => cb.checked && !actuales[id]).map(([id]) => id);
      const desactivar = [...marcas].filter(([id, cb]) => !cb.checked && actuales[id]).map(([id]) => id);
      if (!activar.length && !desactivar.length) { caja.replaceChildren(errorBox('No cambiaste ningún módulo.')); return; }
      try { await abrirPlan('modulos', { ref, activar, desactivar }, () => { void detalle(ref); }); } catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); }
    };
    mostrar(encabezado(c.nombre, () => { void principal(); }),
      h('div', { class: 'tarjeta' }, h('div', { class: 'fila' }, h('span', {}, 'Estado'), etiquetaEstado(c.estado)),
        d ? h('div', { class: 'fila' }, h('span', {}, 'Registro público'), h('span', { class: `etiqueta ${d.registroPublico === 'cerrado' ? 'ok' : 'mal'}` }, String(d.registroPublico ?? 'desconocido'))) : null,
        d?.migraciones ? h('div', { class: 'fila' }, h('span', {}, 'Base de datos'), h('span', { class: `etiqueta ${d.migraciones.pendientes.length ? 'mal' : 'ok'}` }, d.migraciones.pendientes.length ? `${d.migraciones.pendientes.length} pendiente(s)` : 'al día')) : null,
        d && d.instalado === false ? h('div', { class: 'aviso' }, 'Este proyecto no fue instalado con este sistema: se adopta desde la computadora (pnpm cliente actualizar --marcar-hasta).') : null,
        d?.incompleto ? h('div', { class: 'aviso' }, 'No se pudo leer todo el detalle ahora.') : null,
        !d ? h('div', { class: 'aviso' }, 'El proyecto no está disponible todavía.') : null),
      d?.instalado ? componentes : null, d?.instalado ? lista : null, d?.instalado ? aplicar : null,
      d?.instalado ? h('button', { class: 'ancho', onclick: () => { void abrirPlan('actualizar', { ref }, () => { void detalle(ref); }).catch(e => caja.replaceChildren(errorBox(mensajeDe(e)))); } }, 'Actualizar este cliente') : null,
      d?.instalado ? h('button', { class: 'ancho', onclick: () => { void datosParaPublicar(ref, caja); } }, 'Datos para publicar la app') : null,
      caja);
  } catch (e) { mostrar(encabezado('Cliente', () => { void principal(); }), errorBox(mensajeDe(e))); }
}

// ---------- datos para publicar la app del cliente (Netlify) ----------
async function datosParaPublicar(ref: string, destino: HTMLElement) {
  try {
    const d = await api('GET', `/api/clientes/${ref}/publicar`);
    const fila = (nombre: string, valor: string) => {
      const copiar = h('button', { class: 'ancho' }, 'Copiar') as HTMLButtonElement;
      copiar.onclick = async () => { try { await navigator.clipboard.writeText(`${nombre}=${valor}`); copiar.textContent = 'Copiado ✓'; } catch { copiar.textContent = 'No se pudo copiar: seleccionalo a mano'; } };
      return h('div', {}, h('label', {}, nombre), h('div', { class: 'clave' }, valor), copiar);
    };
    destino.replaceChildren(h('div', { class: 'tarjeta' },
      h('strong', {}, `Publicar la app de ${d.nombre}`),
      h('p', { class: 'chica' }, 'En Netlify: tu sitio → Site configuration → Environment variables. Cargá estas dos variables y publicá con el comando "pnpm build" y la carpeta "dist". La llave que se muestra es la pública: va dentro de la web y no es secreta. Las llaves privadas nunca se muestran.'),
      fila('VITE_SUPABASE_URL', d.url), fila('VITE_SUPABASE_ANON_KEY', d.anon)));
  } catch (e) { destino.replaceChildren(errorBox(mensajeDe(e))); }
}

// ---------- cliente nuevo ----------
async function formularioNuevo() {
  let modulos: Json[]; let organizaciones: string[];
  try { ({ modulos, organizaciones } = await api('GET', '/api/modulos')); }
  catch (e) { if (enSesion) mostrar(encabezado('Nuevo cliente', () => { void principal(); }), errorBox(mensajeDe(e))); return; }
  const nombre = h('input', { type: 'text', id: 'n', maxlength: '60', autocomplete: 'off' }) as HTMLInputElement;
  const correo = h('input', { type: 'email', id: 'c', maxlength: '254', autocomplete: 'off', inputmode: 'email' }) as HTMLInputElement;
  const org = h('select', { id: 'org' }, ...organizaciones.map(o => h('option', { value: o }, o))) as HTMLSelectElement;
  const url = h('input', { type: 'text', id: 'u', maxlength: '200', autocomplete: 'off', placeholder: 'https://cliente.netlify.app (opcional)' }) as HTMLInputElement;
  const region = h('select', { id: 'r' }, ...['sa-east-1', 'us-east-1', 'eu-west-1'].map(r => h('option', { value: r }, r))) as HTMLSelectElement;
  // Se vende por plan, no módulo por módulo: lo que el cliente no quiera usar lo apaga él desde su Configuración → Módulos.
  // Los planes 3 y 4 todavía no existen: se muestran pero no se pueden elegir.
  const PLANES: { id: string; nombre: string; componentes: string[] | null }[] = [
    { id: 'plan1', nombre: 'Plan 1 — Gestión', componentes: ['base', 'abastecimiento'] },
    { id: 'plan2', nombre: 'Plan 2 — Gestión + Mantenimiento', componentes: ['base', 'abastecimiento', 'mantenimiento'] },
    { id: 'plan3', nombre: 'Plan 3 — Próximamente (en desarrollo)', componentes: null },
    { id: 'plan4', nombre: 'Plan 4 — Próximamente (en desarrollo)', componentes: null },
  ];
  const plan = h('select', { id: 'plan' }, ...PLANES.map(p => h('option', { value: p.id, ...(p.componentes ? {} : { disabled: '' }) }, p.nombre))) as HTMLSelectElement;
  const incluye = h('div', { class: 'chica' });
  const modulosDelPlan = () => modulos.filter(m => PLANES.find(p => p.id === plan.value)?.componentes?.includes(m.componente));
  const mostrarIncluye = () => incluye.replaceChildren(h('strong', {}, 'Incluye:'),
    ...modulosDelPlan().map(m => h('div', {}, `• ${m.nombre} — ${m.descripcion}`)),
    h('div', {}, 'El cliente puede apagar desde su Configuración los módulos que no use.'));
  plan.addEventListener('change', mostrarIncluye);
  mostrarIncluye();
  const caja = h('div');
  const boton = h('button', { class: 'primario ancho' }, 'Revisar plan') as HTMLButtonElement;
  boton.onclick = async () => {
    caja.replaceChildren();
    const activos = modulosDelPlan().map(m => m.id);
    if (!activos.length) { caja.replaceChildren(errorBox('Ese plan todavía no está disponible. Elegí el Plan 1 o el Plan 2.')); return; }
    try { await abrirPlan('crear', { nombre: nombre.value, correo: correo.value, modulos: activos, region: region.value, org: org.value, ...(url.value.trim() ? { urlApp: url.value.trim() } : {}) }, () => { void principal(); }); }
    catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); }
  };
  mostrar(encabezado('Nuevo cliente', () => { void principal(); }), h('div', { class: 'tarjeta' },
    h('label', { for: 'n' }, 'Nombre del cliente'), nombre,
    h('label', { for: 'c' }, 'Correo del dueño'), correo,
    organizaciones.length > 1 ? h('label', { for: 'org' }, 'Organización de Supabase del cliente') : null, organizaciones.length > 1 ? org : null,
    h('label', { for: 'r' }, 'Región'), region,
    h('label', { for: 'u' }, 'Dirección de la app del cliente'), url,
    h('label', { for: 'plan' }, 'Plan'), plan, incluye,
    boton, caja));
}

// ---------- plan: revisar, firmar y ejecutar ----------
async function abrirPlan(tipo: string, parametros: Record<string, unknown>, alTerminar: () => void): Promise<void> {
  const plan = await api('POST', '/api/planes', { tipo, ...parametros });
  let opciones = plan.opciones;
  const listaPasos = h('ul', { class: 'pasos' }) as HTMLUListElement;
  const filas: HTMLElement[] = (plan.pasos as Json[]).map(p => h('li', {}, h('span', { class: 'marca' }, '○'), h('span', {}, p.etiqueta)));
  listaPasos.append(...filas);
  const caja = h('div');
  const boton = h('button', { class: 'primario ancho' }, 'Firmar con tu huella y ejecutar') as HTMLButtonElement;
  const marcar = (i: number, clase: string, simbolo: string) => { const f = filas[i]; if (!f) return; f.className = clase; (f.firstChild as HTMLElement).textContent = simbolo; };

  boton.onclick = async () => {
    boton.disabled = true; caja.replaceChildren();
    try {
      try { await api('POST', `/api/planes/${plan.id}/firmar`, { respuesta: await usarLlave(opciones) }); }
      catch (e) {
        if (e instanceof ErrorApi && e.codigo === 'firma') { opciones = (await api('POST', `/api/planes/${plan.id}/desafio`, {})).opciones; throw new Error('La firma venció. Tocá de nuevo para firmar.'); }
        throw e;
      }
      boton.textContent = 'Ejecutando… no cierres esta pantalla';
      let indice = 0;
      for (let vueltas = 0; vueltas < 2000; vueltas++) {
        let r: Json;
        try { r = await api('POST', `/api/planes/${plan.id}/paso`, {}); }
        catch (e) { if (e instanceof ErrorApi && e.estado === 409 && (e.codigo === 'ocupado' || e.codigo === 'proyecto_ocupado')) { await dormir(2000); continue; } throw e; }
        indice = r.cursor;
        if (r.resultado === 'ok') marcar(Math.max(0, r.cursor - 1), 'hecho', '✓');
        else if (r.resultado === 'reintentar') { marcar(r.cursor, 'actual', '…'); await dormir(4000); continue; }
        else { marcar(r.cursor, 'fallo', '✗'); throw new Error(`Falló: ${r.mensaje}`); }
        if (r.estado === 'terminado') break;
        marcar(indice, 'actual', '…');
      }
      boton.remove();
      caja.replaceChildren(h('div', { class: 'tarjeta' }, h('strong', {}, '✓ Terminado')));
      if (tipo === 'crear') caja.append(botonClave(plan.id));
      caja.append(h('button', { class: 'ancho', onclick: alTerminar }, 'Volver'));
    } catch (e) { caja.replaceChildren(errorBox(mensajeDe(e))); boton.disabled = false; boton.textContent = 'Firmar con tu huella y ejecutar'; }
  };

  mostrar(encabezado('Revisá antes de firmar', () => { void api('POST', `/api/planes/${plan.id}/cancelar`, {}).catch(() => {}); alTerminar(); }),
    h('div', { class: 'tarjeta' }, h('strong', {}, plan.resumen.titulo),
      ...(plan.resumen.lineas as string[]).map(l => h('p', {}, l)),
      ...(plan.resumen.avisos as string[]).map(a => h('div', { class: 'aviso' }, a))),
    listaPasos, boton, caja);
}

function botonClave(planId: string): HTMLElement {
  const zona = h('div');
  const b = h('button', { class: 'ancho' }, 'Ver la contraseña inicial del dueño (se muestra una vez)') as HTMLButtonElement;
  b.onclick = async () => {
    try {
      const r = await api('POST', `/api/planes/${planId}/clave`, {});
      const clave = h('div', { class: 'clave' }, r.clave ?? '(sin contraseña nueva)');
      zona.replaceChildren(h('div', { class: 'tarjeta' }, h('p', {}, `Dueño: ${r.correo}`), r.clave ? clave : h('p', {}, r.motivo ?? ''),
        r.clave ? h('p', { class: 'chica' }, 'Pasásela por un canal privado y pedile que la cambie al entrar. No se guarda en ningún lado.') : null,
        h('button', { class: 'primario ancho', onclick: async () => { clave.textContent = ''; try { await api('POST', `/api/planes/${planId}/acuse`, {}); } catch { /* ya no estaba */ } zona.replaceChildren(h('p', { class: 'chica' }, 'Listo. La contraseña ya no se puede ver.')); } }, 'Ya la copié: borrarla de la pantalla')));
    } catch (e) { zona.replaceChildren(errorBox(mensajeDe(e))); }
  };
  zona.append(b);
  return zona;
}

void iniciar();
