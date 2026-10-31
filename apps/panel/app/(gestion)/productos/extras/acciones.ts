'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { asignarValorExtra, buscarProductosParaExtra, crearDatoExtra, quitarDatoExtra, quitarValorExtra, renombrarDatoExtra, renombrarValorExtra } from '../../../../lib/extras.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';

export interface Resultado { error?: string }

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

export const crearDatoAccion = (nombre: string) => correr((s) => crearDatoExtra(s, nombre));
export const renombrarDatoAccion = (id: string, nombre: string) => correr((s) => renombrarDatoExtra(s, id, nombre));
export const quitarDatoAccion = (id: string) => correr((s) => quitarDatoExtra(s, id));
export const asignarValorAccion = (datoId: string, valor: string, productoIds: string[]) => correr((s) => asignarValorExtra(s, datoId, valor, productoIds));
export const renombrarValorAccion = (datoId: string, viejo: string, nuevo: string) => correr((s) => renombrarValorExtra(s, datoId, viejo, nuevo));
export const quitarValorAccion = (datoId: string, valor: string) => correr((s) => quitarValorExtra(s, datoId, valor));

export async function buscarProductosAccion(q: string): Promise<{ id: string; nombre: string; codigo: string | null }[]> {
  const s = await sesionObligatoria();
  try {
    return await buscarProductosParaExtra(s, q);
  } catch (e) {
    if (e instanceof ErrorDePermiso) return [];
    throw e;
  }
}
