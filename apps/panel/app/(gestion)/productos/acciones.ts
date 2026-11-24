'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { marcarParaPedir } from '../../../lib/aPedir.ts';
import { archivarProducto, eliminarProducto, guardarProducto, listarProductos, type FilaProducto } from '../../../lib/catalogo.ts';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { registrarStock, revertirStock } from '../../../lib/stock.ts';
import { modificacionMasiva, type EntradaMasiva, type ResultadoMasiva } from '../../../lib/masiva.ts';
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
  // Un producto existente se queda en su página (ya guardado); uno nuevo vuelve al listado.
  if (id !== null) { revalidatePath('/productos', 'layout'); return {}; }
  redirect('/productos');
}

export async function archivarProductoAccion(id: string, activo: boolean): Promise<void> {
  const s = await sesionObligatoria();
  await archivarProducto(s, id, activo);
  redirect('/productos');
}

export async function eliminarProductoAccion(id: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await eliminarProducto(s, id);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/productos', 'layout');
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

export async function masivaAccion(entrada: EntradaMasiva, simular: boolean): Promise<{ error?: string; resultado?: ResultadoMasiva }> {
  const s = await sesionObligatoria();
  try {
    const resultado = await modificacionMasiva(s, entrada, { simular });
    if (!simular) revalidatePath('/productos', 'layout');
    return { resultado };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function marcarParaPedirAccion(id: string, marcado: boolean): Promise<Resultado> {
  const s = await sesionObligatoria();
  try {
    await marcarParaPedir(s, id, marcado);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/', 'layout');   // la ficha y el Inicio
  return {};
}

/** Buscador de la pantalla Productos (como el prototipo): resultados mientras se escribe, por nombre o código y tipo. */
export async function buscarProductosAccion(q: string, tipo: string): Promise<FilaProducto[]> {
  return (await listarProductos(await sesionObligatoria(), { q, tipo: tipo || undefined, limite: 40 })).filas;
}
