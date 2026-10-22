// Tokens de sesión: el navegador recibe el token; la base guarda solo su hash (sha256).
// Si la base se filtrara, los tokens guardados no sirven para entrar.
import { createHash, randomBytes } from 'node:crypto';

export const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12 horas

export interface TokenNuevo {
  token: string;      // se entrega al navegador (cookie HttpOnly)
  tokenHash: string;  // se guarda en la tabla sesiones
  expiraEn: Date;
}

export function hashDeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function nuevoToken(ahora: Date = new Date(), duracionMs: number = DURACION_SESION_MS): TokenNuevo {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashDeToken(token), expiraEn: new Date(ahora.getTime() + duracionMs) };
}

export function estaVigente(expiraEn: Date, ahora: Date = new Date()): boolean {
  return expiraEn.getTime() > ahora.getTime();
}
