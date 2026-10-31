'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { ErrorDeUsuario } from '../../../lib/auth.ts';
import { anularOrdenPago, registrarOrdenPago } from '../../../lib/ordenesPago.ts';
import { ErrorDePermiso } from '../../../lib/permisos.ts';
import { sesionObligatoria } from '../../../lib/sesion.ts';

export async function registrarOrdenPagoAccion(datos: Record<string, unknown>): Promise<{ error?: string; id?: string }> {
  const s = await sesionObligatoria();
  try {
    const r = await registrarOrdenPago(s, { compraId: null, fecha: '', nota: '', ...datos, clave: datos.clave ?? randomUUID() });
    for (const p of ['/proveedores', '/cajas', '/compras']) revalidatePath(p, 'layout');
    return { id: r.id };
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
}

export async function anularOrdenPagoAccion(id: string, motivo: string): Promise<{ error?: string }> {
  const s = await sesionObligatoria();
  try {
    await anularOrdenPago(s, id, motivo);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  for (const p of ['/proveedores', '/cajas', '/compras', '/ordenes-pago']) revalidatePath(p, 'layout');
  return {};
}
