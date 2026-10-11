// Acceso a la base propia del panel. Solo se llama a funciones "panel_*" (nunca a tablas). La conexión usa un usuario
// que NO es dueño de nada y que únicamente tiene permiso de ejecutar esas funciones (ver db/instalar.sql).
import postgres from 'postgres';

export interface Almacen {
  rpc<T = unknown>(nombre: string, argumentos: Record<string, unknown>): Promise<T>;
}

export class ErrorAlmacen extends Error {
  readonly estado: number;
  /** Código SQLSTATE del error de la base (p. ej. 53400 = límite superado, 42501 = no permitido). */
  readonly codigoSql: string;
  /** Mensaje interno de la base: va solo al registro del servidor (con redacción), nunca a una respuesta. */
  readonly causa: string;
  constructor(estado: number, mensaje: string, codigoSql = '', causa = '') {
    super(mensaje);
    this.estado = estado;
    this.codigoSql = codigoSql;
    this.causa = causa.slice(0, 300);
  }
}

const NOMBRE_FUNCION = /^panel_[a-z_]{3,60}$/;
const NOMBRE_PARAMETRO = /^p_[a-z_]{1,40}$/;

// Los datos estructurados viajan como TEXTO y la base los convierte (`$n::text::jsonb`): así el resultado no depende de cómo cada
// cliente de Postgres decida serializar un objeto (uno real y el simulador de las pruebas lo hacen distinto).
const CONVERSION: Record<string, string> = {
  p_detalle: '::text::jsonb', p_parametros: '::text::jsonb', p_pasos: '::text::jsonb', p_contexto: '::text::jsonb', p_transportes: '::text::text[]',
};

// Lo único que se envía a la base: el nombre de una función conocida y parámetros por posición ($1, $2…).
// Los valores nunca se pegan dentro del texto SQL.
export function construirLlamada(nombre: string, argumentos: Record<string, unknown>): { texto: string; valores: (string | number | boolean | null)[] } {
  if (!NOMBRE_FUNCION.test(nombre)) throw new Error('Nombre de función no permitido');
  const claves = Object.keys(argumentos);
  for (const k of claves) if (!NOMBRE_PARAMETRO.test(k)) throw new Error('Nombre de parámetro no permitido');
  return {
    texto: `select public.${nombre}(${claves.map((k, i) => `${k} => $${i + 1}${CONVERSION[k] ?? ''}`).join(', ')}) as r`,
    valores: claves.map(k => serializar(k, argumentos[k])),
  };
}

function serializar(clave: string, valor: unknown): string | number | boolean | null {
  if (valor === undefined || valor === null) return null;
  // Única lista de texto: se manda como literal de arreglo de Postgres.
  if (clave === 'p_transportes' && Array.isArray(valor)) return `{${valor.map(x => `"${String(x).replace(/["\\]/g, '')}"`).join(',')}}`;
  if (typeof valor === 'object') return JSON.stringify(valor);
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') return valor;
  throw new Error('Tipo de parámetro no permitido');
}

export function crearAlmacenPg(url: string): Almacen & { cerrar(): Promise<void> } {
  const sql = postgres(url, {
    max: 6, idle_timeout: 30, connect_timeout: 5, max_lifetime: 60 * 30, ssl: false,
    onnotice: () => {}, connection: { application_name: 'panel', statement_timeout: 20000 },
  });
  return {
    async rpc<T>(nombre: string, argumentos: Record<string, unknown>): Promise<T> {
      const { texto, valores } = construirLlamada(nombre, argumentos);
      try {
        const filas = await sql.unsafe(texto, valores);
        return (filas[0]?.r ?? null) as T;
      } catch (e) {
        const codigo = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
        // No se copia el mensaje de la base (puede traer detalles internos).
        throw new ErrorAlmacen(500, `La base del panel falló en ${nombre}`, codigo, e instanceof Error ? e.message : '');
      }
    },
    cerrar: () => sql.end({ timeout: 5 }),
  };
}
