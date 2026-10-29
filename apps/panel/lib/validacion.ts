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

// ───────── Cajas ─────────
const importePositivo = (campo: string) =>
  z.string().transform((s, ctx) => {
    const n = normalizarImporte(s);
    if (n === null || n.startsWith('-') || Number(n) === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${campo}: tiene que ser un importe mayor a cero` });
      return z.NEVER;
    }
    return n;
  });

const importeNoNegativo = (campo: string) =>
  z.string().transform((s, ctx) => {
    const n = normalizarImporte(s === '' ? '0' : s);
    if (n === null || n.startsWith('-')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${campo}: importe inválido` });
      return z.NEVER;
    }
    return n;
  });

/** "2026-10-29T13:30" (hora de Argentina, UTC−3 todo el año) → instante ISO; vacío → null (= ahora). */
const fechaArgentina = z
  .string()
  .default('')
  .transform((s, ctx) => {
    if (s.trim() === '') return null;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(s.trim());
    const d = m ? new Date(`${m[1]}T${m[2]}:00-03:00`) : null;
    if (!d || Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha no es válida' });
      return z.NEVER;
    }
    return d.toISOString();
  });

export const esquemaCaja = z.object({
  nombre: z.string().trim().min(1, 'Falta el nombre de la caja').max(60, 'El nombre es demasiado largo'),
  tipo: z.enum(['efectivo', 'digital']),
  impuestoTransaccion: z.number().min(0, 'El impuesto no puede ser negativo').max(100, 'El impuesto no puede pasar de 100'),
});

export const esquemaMovimientoCaja = z.object({
  tipo: z.enum(['ingreso', 'egreso']),
  importe: importePositivo('Importe'),
  concepto: textoOpcional(200),
  fecha: fechaArgentina,
});

export const esquemaTransferencia = z.object({
  origenId: z.string().uuid(),
  destinoId: z.string().uuid(),
  importe: importePositivo('Importe').nullable(), // null = transferir todo el saldo
  concepto: textoOpcional(200),
});

export const esquemaApertura = z.object({ contado: importeNoNegativo('Efectivo contado') });

export const esquemaCierre = z.object({
  contado: importeNoNegativo('Efectivo contado'),
  cambioDejado: importeNoNegativo('Cambio que se deja'),
  destinoId: z.string().uuid().nullable(),
});

// ───────── Ventas ─────────
export const COMPROBANTES = ['remito', 'factura_b', 'factura_a', 'sin_comprobante'] as const; // la nota de crédito va con las devoluciones
const pct = (campo: string) => z.number().min(0, `${campo} no puede ser negativo`).max(100, `${campo} no puede pasar de 100`);
const alicuota = z.number().refine((v) => (ALICUOTAS_IVA as readonly number[]).includes(v), 'El IVA no es válido');

export const esquemaMedioPago = z.object({
  nombre: z.string().trim().min(1, 'Falta el nombre del medio de pago').max(60),
  comisionPct: pct('La comisión'),
  ivaComision: alicuota,
  cajaIds: z.array(z.string().uuid()).max(50),
});

export const esquemaVenta = z.object({
  clave: z.string().uuid(),
  clienteId: z.string().uuid(),
  comprobante: z.enum(COMPROBANTES),
  nroComprobante: textoOpcional(30),
  listaId: z.string().uuid().nullable(),
  fecha: fechaArgentina,
  descuentoTotalPct: pct('El descuento'),
  totalFinal: importeNoNegativo('El total final').nullable().default(null), // si viene, manda sobre el porcentaje: la venta cierra en ese total
  nota: textoOpcional(500),
  renglones: z
    .array(
      z.object({
        productoId: z.string().uuid().nullable(),                 // null = ítem libre
        descripcion: z.string().trim().max(200),
        cantidad: cantidad('Cantidad', { cero: false }),
        precio: importeNoNegativo('Precio'),
        descuentoPct: pct('El descuento del renglón'),
        iva: alicuota,
      }),
    )
    .min(1, 'Agregá al menos un producto')
    .max(200, 'Demasiados renglones'),
  cobro: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('caja'), medioPagoId: z.string().uuid(), cajaId: z.string().uuid() }),
    z.object({ tipo: z.literal('cuenta_corriente') }),
  ]),
});
export type DatosVenta = z.infer<typeof esquemaVenta>;

// ───────── Recibos de cuenta corriente ─────────
export const esquemaRecibo = z.object({
  clave: z.string().uuid(),
  clienteId: z.string().uuid(),
  ventaId: z.string().uuid().nullable(),
  importe: importePositivo('Importe'),
  medioPagoId: z.string().uuid(),
  cajaId: z.string().uuid(),
  fecha: fechaArgentina,
  nota: textoOpcional(500),
});
export type DatosRecibo = z.infer<typeof esquemaRecibo>;
