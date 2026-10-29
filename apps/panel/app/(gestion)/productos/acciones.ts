'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { archivarProducto, guardarProducto } from '../../../lib/catalogo.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { registrarStock, revertirStock } from '../../../lib/stock.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export interface Resultado {
  error?: string;
}

export async function guardarProductoAccion(id: string | null, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await guardarProducto(s, id, datos);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  redirect('/productos');
}

export async function archivarProductoAccion(id: string, activo: boolean): Promise<void> {
  const s = await sesionObligatoria();
  await archivarProducto(s, id, activo);
  redirect('/productos');
}

export async function movimientoStockAccion(productoId: string, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await registrarStock(s, productoId, datos);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath(`/productos/${productoId}`);
  return {};
}

export async function revertirStockAccion(productoId: string, movimientoId: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await revertirStock(s, productoId, movimientoId);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath(`/productos/${productoId}`);
  return {};
}
