// Validación de entradas con Zod. Los importes entran como texto de una persona y salen como "1234.50".
import { z } from 'zod';
import { ALICUOTAS_IVA, normalizarImporte } from '../../../packages/dominio/src/index.ts';

const importe = (campo: string) =>
  z.string().transform((s, ctx) => {
    const n = normalizarImporte(s === '' ? '0' : s);
    if (n === null || n.startsWith('-')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${campo}: importe inválido` });
      return z.NEVER;
    }
    return n;
  });

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s));

export const esquemaProducto = z.object({
  codigo: textoOpcional(40),
  nombre: z.string().trim().min(1, 'Falta el nombre').max(200, 'El nombre es demasiado largo'),
  rubroId: z.string().uuid().nullable(),
  tipo: textoOpcional(60),
  unidad: z.string().trim().min(1, 'Falta la unidad').max(20),
  costo: importe('Costo'),
  iva: z.number().refine((v) => (ALICUOTAS_IVA as readonly number[]).includes(v), 'El IVA no es válido'),
  vendible: z.boolean(),
  comprable: z.boolean(),
  integrable: z.boolean(),
  publicadoWeb: z.boolean(),
  urlWeb: textoOpcional(500).refine((v) => v === null || /^https?:\/\//.test(v), 'El enlace debe empezar con http:// o https://'),
  precios: z.record(z.string().uuid(), importe('Precio')),
});

export type DatosProducto = z.infer<typeof esquemaProducto>;

export const esquemaRubro = z.object({
  nombre: z.string().trim().min(1, 'Falta el nombre del rubro').max(120, 'El nombre es demasiado largo'),
  padreId: z.string().uuid().nullable(),
});

/** Primer mensaje de error legible de un resultado de validación. */
export function primerError(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'Datos inválidos';
}
