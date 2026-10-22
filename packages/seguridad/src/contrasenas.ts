// Hash y verificación de contraseñas y PIN con scrypt (incluido en Node, sin dependencias).
// Formato guardado: scrypt$N$r$p$salt(base64)$hash(base64) — los parámetros viajan con el hash,
// así se pueden subir más adelante sin invalidar los hashes existentes.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const; // ~32 MiB, ~80 ms
const KEYLEN = 32;
const MAXMEM = 128 * 1024 * 1024;

export const LARGO_MINIMO_CONTRASENA = 8;

export function validarContrasena(contrasena: string): string | null {
  if (contrasena.length < LARGO_MINIMO_CONTRASENA) return `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`;
  if (contrasena.length > 200) return 'La contraseña es demasiado larga';
  return null;
}

export function validarPin(pin: string): string | null {
  return /^\d{4,8}$/.test(pin) ? null : 'El PIN debe tener entre 4 y 8 dígitos';
}

export async function hashear(secreto: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(secreto.normalize('NFKC'), salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verificar(secreto: string, guardado: string | null | undefined): Promise<boolean> {
  if (!guardado) return false;
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = partes;
  const N = Number(n), R = Number(r), P = Number(p);
  if (![N, R, P].every(Number.isInteger) || N < 2 ** 14 || N > 2 ** 20) return false;
  const salt = Buffer.from(saltB64!, 'base64');
  const esperado = Buffer.from(hashB64!, 'base64');
  const calculado = await scrypt(secreto.normalize('NFKC'), salt, esperado.length, { N, r: R, p: P, maxmem: MAXMEM });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}
