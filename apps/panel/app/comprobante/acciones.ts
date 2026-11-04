'use server';
import { z } from 'zod';
import { ErrorDeUsuario } from '../../lib/auth.ts';
import { enviarComprobante } from '../../lib/correo.ts';
import { ErrorDePermiso } from '../../lib/permisos.ts';
import { sesionObligatoria } from '../../lib/sesion.ts';

const esquema = z.object({ tipo: z.enum(['venta', 'compra']), id: z.string().uuid(), para: z.string().trim().min(3).max(200) });

export async function enviarPorMailAccion(entrada: unknown): Promise<{ error?: string; enviado?: string }> {
  const v = esquema.safeParse(entrada);
  if (!v.success) return { error: 'Revisá el mail de destino' };
  const s = await sesionObligatoria();
  try {
    await enviarComprobante(s, v.data);
  } catch (e) {
    if (e instanceof ErrorDeUsuario || e instanceof ErrorDePermiso) return { error: e.message };
    throw e;
  }
  return { enviado: v.data.para.toLowerCase() };
}
