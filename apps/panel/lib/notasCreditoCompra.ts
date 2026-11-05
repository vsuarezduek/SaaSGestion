// Notas de crédito de proveedor: devolución de mercadería comprada. Siempre contra la cuenta corriente del proveedor: baja el stock de lo devuelto
// y baja lo que se le debe; no mueve ninguna caja. No se edita ni se borra: se anula con los movimientos inversos (cada uno referencia al original).
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaNotaCreditoCompra, primerError } from './validacion.ts';
import { aCentavos, calcularCompra, deCentavos } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResultadoNotaCreditoCompra { id: string; numero: number; total: string; repetida: boolean }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':notas_credito_compra'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM notas_credito_compra');
  return r.rows[0]!.n;
}

/** Emite la nota de crédito de un proveedor. El costo se carga a mano (sin IVA); si el comprobante es nota de crédito A o B, el IVA se suma encima. */
export async function emitirNotaCreditoCompra(s: SesionActiva, entrada: unknown): Promise<ResultadoNotaCreditoCompra> {
  exigir(s, 'compras');
  const v = esquemaNotaCreditoCompra.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  const conIva = d.comprobante === 'nota_credito_a' || d.comprobante === 'nota_credito_b';
  return conTenant(s.tenantId, async (c) => {
    const previa = await c.query<{ id: string; numero: number; total: string }>('SELECT id, numero, total::text FROM notas_credito_compra WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], repetida: true };

    const prov = await c.query<{ activo: boolean }>('SELECT activo FROM proveedores WHERE id = $1', [d.proveedorId]);
    if (!prov.rows[0] || !prov.rows[0].activo) throw new ErrorDeUsuario('El proveedor no existe o está archivado');
    if (d.compraOrigenId) {
      const o = await c.query<{ proveedor_id: string }>('SELECT proveedor_id FROM compras WHERE id = $1', [d.compraOrigenId]);
      if (!o.rows[0]) throw new ErrorDeUsuario('La compra de referencia no existe');
      if (o.rows[0].proveedor_id !== d.proveedorId) throw new ErrorDeUsuario('La compra de referencia es de otro proveedor');
    }
    const ids = [...new Set(d.renglones.map((r) => r.productoId).filter((x): x is string => x !== null))];
    const prods = new Map<string, string>();
    if (ids.length) {
      const pr = await c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM productos WHERE id = ANY($1::uuid[])', [ids]);
      for (const f of pr.rows) prods.set(f.id, f.nombre);
      if (prods.size !== ids.length) throw new ErrorDeUsuario('Un producto no existe');
    }
    const lineas = d.renglones.map((r) => {
      const descripcion = r.productoId ? prods.get(r.productoId)! : r.descripcion;
      if (!descripcion) throw new ErrorDeUsuario('El ítem libre necesita una descripción');
      return { ...r, descripcion };
    });
    const calc = calcularCompra(lineas.map((r) => ({ cantidad: r.cantidad, costo: aCentavos(r.costo), descuentoPct: 0, iva: r.iva })), 0, conIva);

    const numero = await siguienteNumero(c);
    const nr = await c.query<{ id: string }>(
      `INSERT INTO notas_credito_compra (tenant_id, numero, estado, clave, proveedor_id, compra_origen_id, comprobante, nro_comprobante, fecha, subtotal, neto, iva, total, nota, usuario_id)
       VALUES (app.tenant_id(), $1, 'cerrada', $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10, $11, $12, $13) RETURNING id`,
      [numero, d.clave, d.proveedorId, d.compraOrigenId, d.comprobante, d.nroComprobante, d.fecha, deCentavos(calc.subtotal), deCentavos(calc.neto), deCentavos(calc.iva), deCentavos(calc.total), d.nota, s.usuarioId],
    );
    const id = nr.rows[0]!.id;
    for (const [i, r] of lineas.entries()) {
      const k = calc.renglones[i]!;
      await c.query(
        `INSERT INTO nota_credito_compra_renglones (tenant_id, nota_id, orden, producto_id, descripcion, cantidad, costo, iva, neto, iva_monto)
         VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, i + 1, r.productoId, r.descripcion, r.cantidad, r.costo, r.iva, deCentavos(k.neto), deCentavos(k.iva)],
      );
      if (!r.productoId) continue;
      await c.query(
        `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id, nota_credito_compra_id)
         VALUES (app.tenant_id(), $1, 'devolucion_compra', $2, $3, $4, $5)`,
        [r.productoId, `-${r.cantidad}`, `Nota de crédito de proveedor N° ${numero}`, s.usuarioId, id],
      );
    }
    if (calc.total > 0) { // una nota de $0 no mueve plata
      await c.query(
        `INSERT INTO cuenta_corriente_movimientos (tenant_id, proveedor_id, tipo, importe, concepto, usuario_id, nota_credito_compra_id)
         VALUES (app.tenant_id(), $1, 'nota_credito_compra', $2, $3, $4, $5)`,
        [d.proveedorId, deCentavos(-calc.total), `Nota de crédito de proveedor N° ${numero}`, s.usuarioId, id],
      );
    }
    await auditar(c, s.usuarioId, 'emitir', 'nota_credito_compra', { numero, proveedor: d.proveedorId, total: deCentavos(calc.total), comprobante: d.comprobante, compraOrigen: d.compraOrigenId }, { entidadId: id });
    return { id, numero, total: deCentavos(calc.total), repetida: false };
  });
}

/** Anula una nota de crédito de proveedor: vuelve al stock lo devuelto y se restituye la deuda con el proveedor. Nada se borra. */
export async function anularNotaCreditoCompra(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'compras');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La nota de crédito no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM notas_credito_compra WHERE id = $1 FOR UPDATE', [id]);
    const n = r.rows[0];
    if (!n) throw new ErrorDeUsuario('La nota de crédito no existe');
    if (n.estado === 'anulada') throw new ErrorDeUsuario('La nota de crédito ya está anulada');
    const concepto = `Anulación nota de crédito de proveedor N° ${n.numero}`;
    await c.query(
      `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, revierte_id, usuario_id, nota_credito_compra_id)
       SELECT app.tenant_id(), producto_id, 'reversion', -cantidad, $2, id, $3, nota_credito_compra_id FROM stock_movimientos
        WHERE nota_credito_compra_id = $1 AND tipo = 'devolucion_compra' ORDER BY id`, [id, concepto, s.usuarioId]);
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, nota_credito_compra_id)
       SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, nota_credito_compra_id FROM cuenta_corriente_movimientos
        WHERE nota_credito_compra_id = $1 AND tipo = 'nota_credito_compra' ORDER BY id`, [id, concepto, s.usuarioId]);
    await c.query(`UPDATE notas_credito_compra SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
    await auditar(c, s.usuarioId, 'anular', 'nota_credito_compra', { numero: n.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
  });
}

export interface FilaNotaCreditoCompra { id: string; numero: number; fecha: Date; comprobante: string; total: string; estado: string; compraNumero: number | null }
export interface DetalleNotaCreditoCompra extends FilaNotaCreditoCompra {
  proveedorId: string; proveedor: string; nroComprobante: string | null; neto: string; iva: string; nota: string | null; motivoAnulacion: string | null;
  renglones: { descripcion: string; cantidad: string; costo: string; iva: string; neto: string }[];
}

export async function notasDeCreditoDelProveedor(s: SesionActiva, proveedorId: string): Promise<FilaNotaCreditoCompra[]> {
  exigir(s, 'compras');
  if (!UUID.test(proveedorId)) return [];
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT n.id, n.numero, n.fecha, n.comprobante, n.total::text, n.estado, o.numero AS compra_numero
         FROM notas_credito_compra n LEFT JOIN compras o ON o.id = n.compra_origen_id WHERE n.proveedor_id = $1 ORDER BY n.numero DESC LIMIT 100`, [proveedorId]);
    return r.rows.map((f) => ({ id: f.id, numero: f.numero, fecha: f.fecha, comprobante: f.comprobante, total: f.total, estado: f.estado, compraNumero: f.compra_numero }));
  });
}

export async function obtenerNotaCreditoCompra(s: SesionActiva, id: string): Promise<DetalleNotaCreditoCompra | null> {
  exigir(s, 'compras');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT n.*, n.total::text AS total_t, n.neto::text AS neto_t, n.iva::text AS iva_t, p.nombre AS proveedor, o.numero AS compra_numero
         FROM notas_credito_compra n JOIN proveedores p ON p.id = n.proveedor_id LEFT JOIN compras o ON o.id = n.compra_origen_id WHERE n.id = $1`, [id]);
    const f = r.rows[0];
    if (!f) return null;
    const rg = await c.query('SELECT descripcion, cantidad::text, costo::text, iva::text, neto::text FROM nota_credito_compra_renglones WHERE nota_id = $1 ORDER BY orden', [id]);
    return {
      id: f.id, numero: f.numero, fecha: f.fecha, comprobante: f.comprobante, total: f.total_t, estado: f.estado, compraNumero: f.compra_numero,
      proveedorId: f.proveedor_id, proveedor: f.proveedor, nroComprobante: f.nro_comprobante, neto: f.neto_t, iva: f.iva_t, nota: f.nota, motivoAnulacion: f.motivo_anulacion,
      renglones: rg.rows.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, costo: x.costo, iva: x.iva, neto: x.neto })),
    };
  });
}

export interface DatosParaNotaCreditoCompra {
  proveedor: { id: string; nombre: string };
  compra: { id: string; numero: number } | null;
  /** Si se parte de una compra, sus renglones con producto (precargados con la misma cantidad y costo, para ajustar). */
  renglones: { productoId: string; descripcion: string; cantidad: string; costo: string; iva: number }[];
}

/** Lo que hace falta para armar una nota de crédito de proveedor; si viene una compra, se precarga con sus productos. */
export async function datosParaNotaCreditoCompra(s: SesionActiva, proveedorId: string | null, compraId: string | null): Promise<DatosParaNotaCreditoCompra | null> {
  exigir(s, 'compras');
  if ((proveedorId && !UUID.test(proveedorId)) || (compraId && !UUID.test(compraId))) return null;
  return conTenant(s.tenantId, async (c) => {
    let compra: { id: string; numero: number } | null = null;
    let prov = proveedorId;
    let renglones: DatosParaNotaCreditoCompra['renglones'] = [];
    if (compraId) {
      const o = await c.query<{ id: string; numero: number; proveedor_id: string; estado: string }>('SELECT id, numero, proveedor_id, estado FROM compras WHERE id = $1', [compraId]);
      const f = o.rows[0];
      if (!f || f.estado !== 'cerrada') return null;
      compra = { id: f.id, numero: f.numero };
      prov = f.proveedor_id;
      const rg = await c.query(`SELECT producto_id, descripcion, cantidad::text, costo::text, iva::text FROM compra_renglones WHERE compra_id = $1 AND producto_id IS NOT NULL ORDER BY orden`, [compraId]);
      renglones = rg.rows.map((x) => ({ productoId: x.producto_id, descripcion: x.descripcion, cantidad: x.cantidad, costo: x.costo, iva: Number(x.iva) }));
    }
    if (!prov) return null;
    const p = await c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM proveedores WHERE id = $1', [prov]);
    if (!p.rows[0]) return null;
    return { proveedor: p.rows[0], compra, renglones };
  });
}
