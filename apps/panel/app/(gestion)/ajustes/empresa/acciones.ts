'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { guardarEmpresa, guardarLogo, quitarLogo } from '../../../../lib/empresa.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';

export interface Resultado { error?: string }

async function intentar(fn: (s: Awaited<ReturnType<typeof sesionObligatoria>>) => Promise<void>): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await fn(s);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/', 'layout');
  return {};
}

export async function guardarEmpresaAccion(d: unknown): Promise<Resultado> {
  return intentar((s) => guardarEmpresa(s, d));
}
export async function subirLogoAccion(datos: FormData): Promise<Resultado> {
  const archivo = datos.get('logo');
  if (!(archivo instanceof File)) return { error: 'Elegí una imagen' };
  return intentar(async (s) => guardarLogo(s, new Uint8Array(await archivo.arrayBuffer())));
}
export async function quitarLogoAccion(): Promise<Resultado> {
  return intentar((s) => quitarLogo(s));
}
