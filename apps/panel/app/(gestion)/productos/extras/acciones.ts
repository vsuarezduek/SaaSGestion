'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { asignarValorExtra, buscarProductosParaExtra, crearDatoExtra, quitarDatoExtra, quitarValorExtra, renombrarDatoExtra, renombrarValorExtra } from '../../../../lib/extras.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';

export type Resultado = { error?: string };

async function correr(f: (s: Awaited<ReturnType<typeof sesionObligatoria>>) => Promise<unknown>): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await f(s);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/productos', 'layout');
  return {};
}

export async function crearDatoAccion(nombre: string): Promise<Resultado> {
  return correr((s) => crearDatoExtra(s, nombre));
}
export async function renombrarDatoAccion(id: string, nombre: string): Promise<Resultado> {
  return correr((s) => renombrarDatoExtra(s, id, nombre));
}
export async function quitarDatoAccion(id: string): Promise<Resultado> {
  return correr((s) => quitarDatoExtra(s, id));
}
export async function asignarValorAccion(datoId: string, valor: string, productoIds: string[]): Promise<Resultado> {
  return correr((s) => asignarValorExtra(s, datoId, valor, productoIds));
}
export async function renombrarValorAccion(datoId: string, viejo: string, nuevo: string): Promise<Resultado> {
  return correr((s) => renombrarValorExtra(s, datoId, viejo, nuevo));
}
export async function quitarValorAccion(datoId: string, valor: string): Promise<Resultado> {
  return correr((s) => quitarValorExtra(s, datoId, valor));
}

export async function buscarProductosAccion(q: string): Promise<{ id: string; nombre: string; codigo: string | null }[]> {
  const s = await sesionObligatoria();
  try {
    return await buscarProductosParaExtra(s, q);
  } catch (e) {
    if (e instanceof ErrorDePermiso) return [];
    throw e;
  }
}
