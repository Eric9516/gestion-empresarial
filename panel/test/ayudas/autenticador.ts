// Llave de acceso "virtual": hace lo mismo que un celular (crea una llave, firma desafíos) para poder probar el panel
// de punta a punta. También permite FALSIFICAR cada parte (origen, dominio, contador, banderas, firma…) para atacarlo.
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// --- CBOR mínimo (lo justo para armar una llave de acceso) ---
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cabeza(mayor: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(mayor << 5) | n]);
  if (n < 256) return Buffer.from([(mayor << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(mayor << 5) | 25, n >> 8, n & 255]);
  throw new Error('demasiado grande');
}
export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? cabeza(0, v) : cabeza(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([cabeza(3, b.length), b]); }
  if (v instanceof Uint8Array) return Buffer.concat([cabeza(2, v.length), Buffer.from(v)]);
  const partes: Buffer[] = [cabeza(5, v.size)];
  for (const [k, x] of v) partes.push(cbor(k), cbor(x));
  return Buffer.concat(partes);
}

const sha = (d: Buffer | string) => createHash('sha256').update(d).digest();
export const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

export interface OpcionesFalsas {
  origen?: string;
  rpId?: string;
  tipo?: string;
  /** Banderas del autenticador (por defecto: presencia + verificación de usuario). */
  banderas?: number;
  contador?: number;
  desafio?: string;
  /** Firmar con otra llave (para probar firmas que no corresponden). */
  firmarCon?: KeyObject;
  corromperFirma?: boolean;
}

export class Autenticador {
  readonly idCredencial: Buffer;
  readonly privada: KeyObject;
  readonly publicaJwk: { x: string; y: string };
  contador = 0;
  readonly rpId: string;
  readonly origen: string;

  constructor(origen: string, rpId: string) {
    this.origen = origen;
    this.rpId = rpId;
    this.idCredencial = randomBytes(32);
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privada = createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.publicaJwk = { x: jwk.x, y: jwk.y };
  }

  get id(): string { return b64u(this.idCredencial); }

  private datosAutenticador(rpId: string, banderas: number, contador: number, extra: Buffer = Buffer.alloc(0)): Buffer {
    const c = Buffer.alloc(4); c.writeUInt32BE(contador);
    return Buffer.concat([sha(rpId), Buffer.from([banderas]), c, extra]);
  }

  /** Respuesta a navigator.credentials.create() con atestación "none". */
  crear(desafio: string, o: OpcionesFalsas = {}): unknown {
    const clave = new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.publicaJwk.x, 'base64url')], [-3, Buffer.from(this.publicaJwk.y, 'base64url')]]);
    const credencial = Buffer.concat([Buffer.alloc(16), Buffer.from([this.idCredencial.length >> 8, this.idCredencial.length & 255]), this.idCredencial, cbor(clave)]);
    const banderas = o.banderas ?? 0x45; // UP | UV | AT
    const datos = this.datosAutenticador(o.rpId ?? this.rpId, banderas, o.contador ?? 0, credencial);
    const objeto = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', datos]]));
    const clientData = Buffer.from(JSON.stringify({ type: o.tipo ?? 'webauthn.create', challenge: o.desafio ?? desafio, origin: o.origen ?? this.origen, crossOrigin: false }));
    return {
      id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(objeto), transports: ['internal'] },
    };
  }

  /** Respuesta a navigator.credentials.get(). */
  firmar(desafio: string, o: OpcionesFalsas = {}): unknown {
    const banderas = o.banderas ?? 0x05; // UP | UV
    if (o.contador === undefined) this.contador += 1;
    const contador = o.contador ?? this.contador;
    const datos = this.datosAutenticador(o.rpId ?? this.rpId, banderas, contador);
    const clientData = Buffer.from(JSON.stringify({ type: o.tipo ?? 'webauthn.get', challenge: o.desafio ?? desafio, origin: o.origen ?? this.origen, crossOrigin: false }));
    const mensaje = Buffer.concat([datos, sha(clientData)]);
    let firma = sign('sha256', mensaje, o.firmarCon ?? this.privada);
    if (o.corromperFirma) { firma = Buffer.from(firma); firma[firma.length - 1] = (firma[firma.length - 1]! ^ 0xff); }
    return {
      id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(datos), signature: b64u(firma) },
    };
  }
}
