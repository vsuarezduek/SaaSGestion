'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import {
  agregarCategoriaDeCompra, anularCompra, buscarProductosParaCompra, buscarProveedoresParaCompra, cerrarCompra, faltantesParaComprar,
  type Faltante, type ProductoParaCompra, type ProveedorParaCompra,
} from '../../../lib/compras.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export async function buscarProveedoresAccion(q: string): Promise<ProveedorParaCompra[]> {
  return buscarProveedoresParaCompra(await sesionObligatoria(), q);
}

export async function buscarProductosCompraAccion(q: string, ids?: string[]): Promise<ProductoParaCompra[]> {
  return buscarProductosParaCompra(await sesionObligatoria(), q, ids);
}

export async function faltantesAccion(): Promise<Faltante[]> {
  return faltantesParaComprar(await sesionObligatoria());
}

export async function cerrarCompraAccion(datos: unknown): Promise<{ error?: string; id?: string; numero?: number }> {
  const s = await sesionObligatoria();
  try {
    const r = await cerrarCompra(s, datos);
    for (const p of ['/compras', '/cajas', '/productos', '/proveedores']) revalidatePath(p, 'layout');
    return { id: r.id, numero: r.numero };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function anularCompraAccion(id: string, motivo: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await anularCompra(s, id, motivo);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const p of ['/compras', '/cajas', '/productos', '/proveedores']) revalidatePath(p, 'layout');
  return {};
}

export async function agregarCategoriaAccion(nombre: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await agregarCategoriaDeCompra(s, nombre);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/compras', 'layout');
  return {};
}
