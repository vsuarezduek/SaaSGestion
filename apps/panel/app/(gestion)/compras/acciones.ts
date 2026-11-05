'use server';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import {
  agregarCategoriaDeCompra, anularCompra, buscarProductosParaCompra, buscarProveedoresParaCompra, cerrarCompra, faltantesParaComprar,
  type Faltante, type ProductoParaCompra, type ProveedorParaCompra,
} from '../../../lib/compras.ts';
import { ConflictoDeVersionCompra, descartarCompraAbierta, guardarCompraAbierta } from '../../../lib/comprasAbiertas.ts';
import { anularNotaCreditoCompra, emitirNotaCreditoCompra } from '../../../lib/notasCreditoCompra.ts';
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

export async function guardarCompraAbiertaAccion(id: string | null, version: number, datos: unknown): Promise<{ id?: string; version?: number; error?: string; conflicto?: boolean }> {
  const s = await sesionObligatoria();
  try {
    const r = await guardarCompraAbierta(s, id, version, datos);
    revalidatePath('/compras', 'layout');
    return { id: r.id, version: r.version };
  } catch (e) {
    if (e instanceof ConflictoDeVersionCompra) return { error: e.message, conflicto: true };
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function descartarCompraAbiertaAccion(id: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await descartarCompraAbierta(s, id);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  revalidatePath('/compras', 'layout');
  return {};
}

export async function emitirNotaCreditoCompraAccion(datos: unknown): Promise<{ error?: string; id?: string }> {
  const s = await sesionObligatoria();
  let id: string;
  try {
    id = (await emitirNotaCreditoCompra(s, datos)).id;
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const p of ['/compras', '/productos', '/proveedores']) revalidatePath(p, 'layout');
  return { id };
}

export async function anularNotaCreditoCompraAccion(id: string, motivo: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await anularNotaCreditoCompra(s, id, motivo);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const p of ['/compras', '/productos', '/proveedores']) revalidatePath(p, 'layout');
  return {};
}
