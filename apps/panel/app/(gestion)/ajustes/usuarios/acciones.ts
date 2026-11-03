'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { cambiarEstadoUsuario, guardarUsuario } from '../../../../lib/usuarios.ts';

export interface Resultado { error?: string; id?: string }

async function intentar(fn: (s: Awaited<ReturnType<typeof sesionObligatoria>>) => Promise<string | void>): Promise<Resultado> {
  const s = await sesionObligatoria();
  let id: string | void;
  try {
    id = await fn(s);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/ajustes', 'layout');
  return id ? { id } : {};
}

export async function guardarUsuarioAccion(id: string | null, d: unknown): Promise<Resultado> {
  return intentar((s) => guardarUsuario(s, id, d));
}
export async function estadoUsuarioAccion(id: string, activo: boolean): Promise<Resultado> {
  return intentar((s) => cambiarEstadoUsuario(s, id, activo));
}
