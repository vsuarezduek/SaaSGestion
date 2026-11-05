'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../../lib/auth.ts';
import { agregarCostoFijo, fijarCantidadCostoFijo, guardarConfigCostosFijos, quitarCostoFijo } from '../../../../lib/costosFijos.ts';
import { ErrorDePermiso } from '../../../../lib/permisos.ts';
import { buscarIngredientes } from '../../../../lib/recetas.ts';
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

export async function configAccion(activo: boolean, dias: number, base: string): Promise<Resultado> {
  return correr((s) => guardarConfigCostosFijos(s, { activo, dias, base }));
}
export async function agregarCostoAccion(productoId: string): Promise<Resultado> {
  return correr((s) => agregarCostoFijo(s, productoId));
}
export async function cantidadCostoAccion(productoId: string, cantidad: string): Promise<Resultado> {
  return correr((s) => fijarCantidadCostoFijo(s, productoId, cantidad));
}
export async function quitarCostoAccion(productoId: string): Promise<Resultado> {
  return correr((s) => quitarCostoFijo(s, productoId));
}
export async function buscarCostoAccion(q: string): Promise<{ id: string; nombre: string; costo: string; stock: string }[]> {
  const s = await sesionObligatoria();
  try {
    return await buscarIngredientes(s, q, '');
  } catch (e) {
    if (e instanceof ErrorDePermiso) return [];
    throw e;
  }
}
