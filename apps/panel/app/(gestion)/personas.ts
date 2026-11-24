'use server';
// Acciones compartidas por clientes y proveedores.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ErrorDeUsuario } from '../../lib/auth.ts';
import { archivarCliente, archivarProveedor, guardarCategoria, guardarCliente, guardarProveedor, listarClientes, listarProveedores, registrarMovimiento, revertirMovimiento, type Estado, type FilaCliente, type FilaProveedor } from '../../lib/personas.ts';
import { clienteParaVenta, type ClienteParaVenta } from '../../lib/ventas.ts';
import { ErrorDePermiso } from '../../lib/permisos.ts';
import { sesionObligatoria } from '../../lib/sesion.ts';

export interface Resultado { error?: string }
type Tipo = 'cliente' | 'proveedor';
const ruta = (t: Tipo) => (t === 'cliente' ? '/clientes' : '/proveedores');

async function intentar(fn: () => Promise<unknown>): Promise<Resultado> {
  try {
    await fn();
    return {};
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function guardarPersonaAccion(tipo: Tipo, id: string | null, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => (tipo === 'cliente' ? guardarCliente(s, id, datos) : guardarProveedor(s, id, datos)));
  if (r.error) return r;
  // Editando desde la ficha se queda en la ficha (vuelve a la vista de lectura); un alta va al listado.
  if (id) { revalidatePath(`${ruta(tipo)}/${id}`); return {}; }
  redirect(ruta(tipo));
}

export async function archivarPersonaAccion(tipo: Tipo, id: string, activo: boolean): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => (tipo === 'cliente' ? archivarCliente(s, id, activo) : archivarProveedor(s, id, activo)));
  if (r.error) return r;
  redirect(ruta(tipo));
}

export async function movimientoAccion(tipo: Tipo, id: string, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => registrarMovimiento(s, tipo === 'cliente' ? { cliente: id } : { proveedor: id }, datos));
  revalidatePath(`${ruta(tipo)}/${id}`);
  return r;
}

export async function revertirAccion(tipo: Tipo, id: string, movimientoId: string): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => revertirMovimiento(s, tipo === 'cliente' ? { cliente: id } : { proveedor: id }, movimientoId));
  revalidatePath(`${ruta(tipo)}/${id}`);
  return r;
}

export async function guardarCategoriaAccion(id: string | null, datos: unknown): Promise<Resultado> {
  const s = await sesionObligatoria();
  const r = await intentar(() => guardarCategoria(s, id, datos));
  revalidatePath('/clientes/categorias');
  return r;
}

/**
 * Alta rápida de un cliente desde una ventana emergente (Ventas o Clientes), sin salir de la pantalla.
 * Devuelve el id y, si quien lo crea puede vender, los datos que la venta necesita (lista, descuento, cuenta corriente).
 */
export async function crearClienteAccion(datos: unknown): Promise<{ error?: string; id?: string; cliente?: ClienteParaVenta | null }> {
  const s = await sesionObligatoria();
  let id = '';
  const r = await intentar(async () => { id = await guardarCliente(s, null, datos); });
  if (r.error) return r;
  revalidatePath('/clientes');
  const cliente = await clienteParaVenta(s, id).catch(() => null);
  return { id, cliente };
}

/** Buscador de la pantalla Clientes: resultados mientras se escribe. */
export async function buscarClientesAccion(q: string): Promise<FilaCliente[]> {
  return (await listarClientes(await sesionObligatoria(), { q, limite: 40 })).filas;
}

/** Listado completo de clientes (se pide recién al desplegarlo). */
export async function listadoClientesAccion(estado: Estado): Promise<{ filas: FilaCliente[]; total: number }> {
  return listarClientes(await sesionObligatoria(), { estado, limite: 500 });
}

/** Alta rápida de un proveedor desde una ventana emergente (Compras o Proveedores). */
export async function crearProveedorAccion(datos: unknown): Promise<{ error?: string; id?: string }> {
  const s = await sesionObligatoria();
  let id = '';
  const r = await intentar(async () => { id = await guardarProveedor(s, null, datos); });
  if (r.error) return r;
  revalidatePath('/proveedores');
  return { id };
}

/** Buscador de la pantalla Proveedores. */
export async function buscarProveedoresAccion(q: string): Promise<FilaProveedor[]> {
  return (await listarProveedores(await sesionObligatoria(), { q, limite: 40 })).filas;
}

/** Listado completo de proveedores (se pide recién al desplegarlo). */
export async function listadoProveedoresAccion(estado: Estado): Promise<{ filas: FilaProveedor[]; total: number }> {
  return listarProveedores(await sesionObligatoria(), { estado, limite: 500 });
}
