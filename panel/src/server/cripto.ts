import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const aleatorio = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256Hex = (texto: string): string => createHash('sha256').update(texto, 'utf8').digest('hex');
export const hmacHex = (secreto: string | Buffer, texto: string): string => createHmac('sha256', secreto).update(texto, 'utf8').digest('hex');

// Comparación en tiempo constante: no filtra, por el tiempo que tarda, cuántos caracteres coinciden.
// Se comparan los hashes (de largo fijo) para que tampoco se filtre el largo del valor real.
export function iguales(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
