// Registro (logs) y aviso al celular, siempre con redacción: ninguna llave ni contraseña debe llegar a un log,
// a la auditoría ni a una alerta, ni siquiera por error.

const PATRONES_SECRETOS = [
  /sbp_[A-Za-z0-9_]{8,}/g, // llave de la API de Supabase
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, // llaves nuevas de proyecto
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT (llaves antiguas, sesiones)
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];
const CLAVES_SENSIBLES = /pass|clave|secret|token|llave|key|authorization|cookie|codigo|credencial|apikey|bearer/i;

// Valores exactos de secretos que el panel maneja en este momento (llaves leídas, token, contraseñas…). Además de los patrones,
// cualquier texto que contenga uno de estos valores exactos sale con [oculto]: protege aunque la llave tenga un formato nuevo.
const conocidos = new Set<string>();
export function conocerSecreto(valor: string | null | undefined): void {
  if (!valor || valor.length < 8) return;
  conocidos.delete(valor);
  conocidos.add(valor);
  if (conocidos.size > 500) conocidos.delete(conocidos.values().next().value as string);
}

export function ocultarSecretos(texto: string): string {
  let t = texto;
  for (const s of conocidos) if (t.includes(s)) t = t.split(s).join('[oculto]');
  for (const p of PATRONES_SECRETOS) t = t.replace(p, '[oculto]');
  return t;
}

// Deja un valor listo para guardar o mostrar: oculta claves sensibles, acota tamaño y profundidad,
// y reemplaza caracteres de control (evita "inyectar" líneas falsas en un log).
export function limpiar(valor: unknown, nivel = 0): unknown {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') {
    // eslint-disable-next-line no-control-regex -- a propósito: se neutralizan los caracteres de control
    const t = ocultarSecretos(valor).replace(/[\u0000-\u001f\u007f-\u009f\p{Zl}\p{Zp}]/gu, ' ');
    return t.length > 300 ? `${t.slice(0, 300)}...` : t;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (nivel >= 4) return '[…]';
  if (Array.isArray(valor)) return valor.slice(0, 30).map(x => limpiar(x, nivel + 1));
  if (typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor).slice(0, 40)) {
      salida[k.slice(0, 60)] = CLAVES_SENSIBLES.test(k) ? '[oculto]' : limpiar(v, nivel + 1);
    }
    return salida;
  }
  return String(valor).slice(0, 60);
}

export type Nivel = 'info' | 'aviso' | 'error';

export function registrar(nivel: Nivel, evento: string, datos: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ t: new Date().toISOString(), nivel, evento, ...(limpiar(datos) as Record<string, unknown>) });
  if (nivel === 'error') console.error(linea); else console.log(linea);
}

// Aviso al celular (webhook tipo ntfy). Nunca rompe ni demora la operación: si falla, se ignora.
export async function enviarAlerta(url: string | null, texto: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!url) return;
  try {
    await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
      headers: { 'content-type': 'text/plain; charset=utf-8', title: 'Panel de clientes' },
      body: String(limpiar(texto)).slice(0, 300),
    });
  } catch {
    // sin aviso: no se frena nada por esto
  }
}
