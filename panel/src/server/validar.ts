// Validación estricta de todo lo que llega de afuera. Regla: se acepta solo lo que se reconoce ("lista de permitidos"),
// se rechazan las claves que sobran y nunca se copia un objeto del pedido tal cual a otro lado.
import { malPedido } from './errores.ts';
import { esComponente, type Componente } from './componentes.ts';
import { MODULOS } from './generado.ts';

export const REF = /^[a-z]{20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const REGIONES = [
  'sa-east-1', 'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-central-1', 'eu-central-2', 'eu-north-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
] as const;

const propia = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Verifica que el objeto tenga exactamente las claves esperadas (ni de más ni de menos las obligatorias).
export function soloClaves(o: Record<string, unknown>, permitidas: readonly string[], obligatorias: readonly string[] = []): void {
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) throw malPedido('campo', 'Hay un dato que no corresponde.');
  for (const k of obligatorias) if (!propia(o, k)) throw malPedido('falta', 'Falta un dato.');
}

export function parseRef(v: unknown): string {
  if (typeof v !== 'string' || !REF.test(v)) throw malPedido('ref', 'El identificador del proyecto no es válido.');
  return v;
}

// Organización elegida: tiene que estar en la lista que el panel tiene permitida. Si hay una sola, se usa esa.
export function parseOrg(v: unknown, permitidas: readonly string[]): string {
  if (v === undefined && permitidas.length === 1) return permitidas[0]!;
  if (typeof v !== 'string' || !permitidas.includes(v)) throw malPedido('org', 'Elegí la organización de Supabase del cliente (tiene que ser una de las configuradas en el panel).');
  return v;
}

// Identificador de organización de Supabase escrito por la persona (para agregar o quitar).
export function parseOrgNueva(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-z0-9]{10,40}$/.test(v)) throw malPedido('org', 'El identificador de la organización no es válido (son letras y números, sin espacios).');
  return v;
}

export function parseUuid(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw malPedido('id', 'El identificador no es válido.');
  return v;
}

// Texto "limpio": normalizado, sin caracteres de control ni de dirección (los que invierten el texto), con largo acotado.
const PROHIBIDOS = /[\p{C}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/u;
export function textoLimpio(v: unknown, campo: string, min: number, max: number): string {
  if (typeof v !== 'string') throw malPedido(campo, `Falta ${campo}.`);
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  const largo = [...t].length;
  if (largo < min || largo > max) throw malPedido(campo, `${campo}: largo no permitido.`);
  if (PROHIBIDOS.test(t)) throw malPedido(campo, `${campo}: contiene caracteres no permitidos.`);
  return t;
}

const NOMBRE_CLIENTE = /^[\p{L}\p{N}][\p{L}\p{N} .,&'’()/-]*$/u;
export function parseNombreCliente(v: unknown): string {
  const t = textoLimpio(v, 'nombre', 2, 60);
  if (!NOMBRE_CLIENTE.test(t)) throw malPedido('nombre', 'El nombre tiene caracteres no permitidos.');
  return t;
}

// Correo: forma simple y acotada (sin expresiones que se puedan "colgar" con entradas largas).
const CORREO = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?){1,6}$/;
export function parseCorreo(v: unknown): string {
  if (typeof v !== 'string' || v.length > 254 || !CORREO.test(v) || v.includes('..') || v.startsWith('.') || v.split('@')[0]!.endsWith('.')) {
    throw malPedido('correo', 'El correo no parece válido.');
  }
  return v.toLowerCase();
}

export function parseRegion(v: unknown): string {
  if (v === undefined) return 'sa-east-1';
  if (typeof v !== 'string' || !(REGIONES as readonly string[]).includes(v)) throw malPedido('region', 'La región no es válida.');
  return v;
}

export function parseModulos(v: unknown, campo = 'modulos'): string[] {
  if (!Array.isArray(v) || v.length > MODULOS.length) throw malPedido(campo, 'La lista de módulos no es válida.');
  const ids = MODULOS.map(m => m.id);
  const vistos = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || !ids.includes(x)) throw malPedido(campo, 'Hay un módulo que no existe.');
    if (vistos.has(x)) throw malPedido(campo, 'Hay un módulo repetido.');
    vistos.add(x);
  }
  return [...vistos];
}

// Solo se pueden instalar después de la creación los componentes que no son la Base (la Base siempre está).
export function parseComponente(v: unknown): Componente {
  if (!esComponente(v) || v === 'base') throw malPedido('componente', 'Ese componente no se puede instalar.');
  return v;
}

// Dirección donde se publica la app del cliente: solo https, solo el origen (sin ruta ni parámetros).
export function parseUrlApp(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 200) throw malPedido('urlApp', 'La dirección de la app no es válida.');
  let u: URL;
  try { u = new URL(v); } catch { throw malPedido('urlApp', 'La dirección de la app no es válida.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/' || v.endsWith('/')) {
    throw malPedido('urlApp', 'Usá la dirección completa con https y sin barra al final (ej.: https://cliente.netlify.app).');
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(u.hostname)) throw malPedido('urlApp', 'La dirección de la app no es válida.');
  return u.origin;
}

export function parseBooleano(v: unknown, campo: string, porDefecto = false): boolean {
  if (v === undefined) return porDefecto;
  if (typeof v !== 'boolean') throw malPedido(campo, `${campo} no es válido.`);
  return v;
}

// Nombre técnico del proyecto en Supabase (ASCII, sin símbolos).
export function nombreDeProyecto(nombre: string): string {
  const s = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
  if (s.length < 2) throw malPedido('nombre', 'El nombre no sirve para armar el nombre del proyecto.');
  return s;
}
