// Limpieza de lo que manda el navegador al registrar o usar una llave de acceso. La verificación criptográfica la hace
// la librería; acá solo se asegura que la forma sea la esperada (tipos, largos, alfabeto) y se arma un objeto nuevo
// con lo justo, para que no entre nada extra a la librería.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { createPublicKey } from 'node:crypto';
import { decodeCredentialPublicKey } from '@simplewebauthn/server/helpers';
import { malPedido } from './errores.ts';

const B64URL = /^[A-Za-z0-9_-]+$/;

function b64(v: unknown, campo: string, max: number, opcional = false): string | undefined {
  if (v === undefined || v === null) {
    if (opcional) return undefined;
    throw malPedido('llave', `Falta ${campo}.`);
  }
  if (typeof v !== 'string' || v.length === 0 || v.length > max || !B64URL.test(v)) throw malPedido('llave', `${campo} no es válido.`);
  return v;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const TRANSPORTES = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'] as const;

export function limpiarRespuestaRegistro(v: unknown): RegistrationResponseJSON {
  if (!esObjeto(v) || v.type !== 'public-key' || !esObjeto(v.response)) throw malPedido('llave', 'La respuesta de la llave no es válida.');
  const r = v.response;
  const transportes = Array.isArray(r.transports) ? r.transports.filter((t): t is (typeof TRANSPORTES)[number] => (TRANSPORTES as readonly string[]).includes(String(t))).slice(0, 7) : undefined;
  return {
    id: b64(v.id, 'id', 1024)!,
    rawId: b64(v.rawId, 'rawId', 1024)!,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(r.clientDataJSON, 'clientDataJSON', 4096)!,
      attestationObject: b64(r.attestationObject, 'attestationObject', 8192)!,
      ...(transportes ? { transports: transportes } : {}),
    },
  };
}

export function limpiarRespuestaIngreso(v: unknown): AuthenticationResponseJSON {
  if (!esObjeto(v) || v.type !== 'public-key' || !esObjeto(v.response)) throw malPedido('llave', 'La respuesta de la llave no es válida.');
  const r = v.response;
  const userHandle = b64(r.userHandle, 'userHandle', 256, true);
  return {
    id: b64(v.id, 'id', 1024)!,
    rawId: b64(v.rawId, 'rawId', 1024)!,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(r.clientDataJSON, 'clientDataJSON', 4096)!,
      authenticatorData: b64(r.authenticatorData, 'authenticatorData', 2048)!,
      signature: b64(r.signature, 'signature', 1024)!,
      ...(userHandle ? { userHandle } : {}),
    },
  };
}

export function transportesDe(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && (TRANSPORTES as readonly string[]).includes(t)) : [];
}

// Comprueba que la clave pública que se va a guardar sea una clave real (un punto válido de la curva P-256, o una clave
// RSA de al menos 2048 bits). Con atestación "none" nada protege la clave en el camino: sin esta revisión se podría
// guardar basura y quedarte sin poder entrar nunca más.
export function claveValida(publicKey: Uint8Array): boolean {
  try {
    const k = decodeCredentialPublicKey(publicKey as Uint8Array<ArrayBuffer>) as unknown as Map<number, unknown>;
    const alg = k.get(3);
    if (alg === -7) {
      const x = k.get(-2), y = k.get(-3);
      if (k.get(1) !== 2 || k.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return false;
      createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(x).toString('base64url'), y: Buffer.from(y).toString('base64url') }, format: 'jwk' });
      return true;
    }
    if (alg === -257) {
      const n = k.get(-1), e = k.get(-2);
      if (k.get(1) !== 3 || !(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256) return false;
      createPublicKey({ key: { kty: 'RSA', n: Buffer.from(n).toString('base64url'), e: Buffer.from(e).toString('base64url') }, format: 'jwk' });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
