'use server';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';
import { cambiarMiContrasena, cambiarMiPin } from '../../../lib/usuarios.ts';

export interface Resultado { error?: string }

export async function cambiarContrasenaAccion(actual: string, nueva: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  try { await cambiarMiContrasena(s, actual, nueva); } catch (e) { if (e instanceof ErrorDeUsuario) return { error: e.message }; throw e; }
  return {};
}
export async function cambiarPinAccion(actual: string, nuevo: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  try { await cambiarMiPin(s, actual, nuevo); } catch (e) { if (e instanceof ErrorDeUsuario) return { error: e.message }; throw e; }
  return {};
}
