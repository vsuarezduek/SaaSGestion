// Validación de entradas con Zod. Los importes entran como texto de una persona y salen como "1234.50".
import { z } from 'zod';
import { ALICUOTAS_IVA, normalizarCantidad, normalizarImporte } from '../../../packages/dominio/src/index.ts';

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

const cantidad = (campo: string, { cero = true, negativo = false } = {}) =>
  z.string().default('').transform((s, ctx) => {
    const n = normalizarCantidad(s === '' ? '0' : s);
    if (n === null || (!negativo && n.startsWith('-')) || (!cero && Number(n) === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${campo}: cantidad inválida` });
      return z.NEVER;
    }
    return n;
  });

export const esquemaProducto = z.object({
  codigo: textoOpcional(40),
  nombre: z.string().trim().min(1, 'Falta el nombre').max(200, 'El nombre es demasiado largo'),
  rubroId: z.string().uuid().nullable(),
  tipo: textoOpcional(60),
  unidad: z.string().trim().min(1, 'Falta la unidad').max(20),
  costo: importe('Costo'),
  stockMinimo: cantidad('Stock mínimo'),
  stockIdeal: cantidad('Stock ideal'),
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

// ───────── Clientes, proveedores y cuenta corriente ─────────
const CONDICIONES = ['consumidor_final', 'responsable_inscripto', 'monotributo', 'exento'] as const;

const cuit = z
  .string()
  .trim()
  .transform((s) => s.replace(/[-\s]/g, ''))
  .refine((s) => s === '' || /^\d{11}$/.test(s), 'El CUIT debe tener 11 números')
  .transform((s) => (s === '' ? null : s));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine((s) => s === '' || /^[^@\s]+@[^@\s]+$/.test(s), 'El mail no es válido')
  .transform((s) => (s === '' ? null : s));

const datosPersona = {
  nombre: z.string().trim().min(1, 'Falta el nombre').max(200, 'El nombre es demasiado largo'),
  telefono: textoOpcional(40),
  email,
  domicilio: textoOpcional(200),
  localidad: textoOpcional(100),
  cuit,
};

export const esquemaCliente = z.object({
  ...datosPersona,
  categoriaId: z.string().uuid().nullable(),
  condicionIva: z.enum(CONDICIONES),
});
export type DatosCliente = z.infer<typeof esquemaCliente>;

export const esquemaProveedor = z.object({
  ...datosPersona,
  contacto: textoOpcional(120),
  categoria: textoOpcional(60),
  condicionIva: z.enum(CONDICIONES).nullable(),
});
export type DatosProveedor = z.infer<typeof esquemaProveedor>;

export const esquemaCategoriaCliente = z.object({
  nombre: z.string().trim().min(1, 'Falta el nombre de la categoría').max(60),
  listaId: z.string().uuid().nullable(),
  cuentaCorriente: z.boolean(),
  descuento: z.number().min(0, 'El descuento no puede ser negativo').max(100, 'El descuento no puede pasar de 100'),
  ventaACosto: z.boolean(),
});

export const esquemaMovimiento = z.object({
  tipo: z.enum(['saldo_inicial', 'ajuste']),
  importe: z.string().transform((s, ctx) => {
    const n = normalizarImporte(s);
    if (n === null || Number(n) === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Importe inválido' });
      return z.NEVER;
    }
    return n; // con signo: + aumenta la deuda, − la reduce
  }),
  concepto: textoOpcional(200),
});

export const esquemaMovimientoStock = z.object({
  tipo: z.enum(['saldo_inicial', 'ajuste']),
  cantidad: cantidad('Cantidad', { cero: false, negativo: true }), // + entra, − sale
  concepto: textoOpcional(200),
});
