'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { desconectar } from '../../../../lib/correo.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';

export async function desconectarCorreoAccion(): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await desconectar(s);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/', 'layout');
  return {};
}
