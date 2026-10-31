// Historial de un producto: en qué ventas y compras participó (las más recientes primero).
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import type { SesionActiva } from './auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MovimientoHistorial { id: string; numero: number; fecha: Date; contraparte: string; comprobante: string; cantidad: string; importe: string; estado: string }
export interface HistorialProducto { ventas: MovimientoHistorial[]; compras: MovimientoHistorial[]; totalVendido: string; totalComprado: string }

export async function historialDeProducto(s: SesionActiva, productoId: string, limite = 30): Promise<HistorialProducto> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) return { ventas: [], compras: [], totalVendido: '0', totalComprado: '0' };
  const n = Math.min(Math.max(limite, 1), 200);
  return conTenant(s.tenantId, async (c) => {
    const v = await c.query<{ id: string; numero: number; fecha: Date; contraparte: string; comprobante: string; cantidad: string; importe: string; estado: string }>(
      `SELECT v.id, v.numero, v.fecha, COALESCE(cl.nombre, '') AS contraparte, v.comprobante, r.cantidad::text AS cantidad, r.total::text AS importe, v.estado
         FROM venta_renglones r JOIN ventas v ON v.tenant_id = r.tenant_id AND v.id = r.venta_id LEFT JOIN clientes cl ON cl.tenant_id = v.tenant_id AND cl.id = v.cliente_id
        WHERE r.producto_id = $1 AND v.estado <> 'abierta' ORDER BY v.fecha DESC, v.numero DESC LIMIT ${n}`, [productoId]);
    const k = await c.query<{ id: string; numero: number; fecha: Date; contraparte: string; comprobante: string; cantidad: string; importe: string; estado: string }>(
      `SELECT k.id, k.numero, k.fecha, COALESCE(pv.nombre, '') AS contraparte, k.comprobante, r.cantidad::text AS cantidad, r.neto::text AS importe, k.estado
         FROM compra_renglones r JOIN compras k ON k.tenant_id = r.tenant_id AND k.id = r.compra_id LEFT JOIN proveedores pv ON pv.tenant_id = k.tenant_id AND pv.id = k.proveedor_id
        WHERE r.producto_id = $1 ORDER BY k.fecha DESC, k.numero DESC LIMIT ${n}`, [productoId]);
    const tv = await c.query<{ t: string }>(
      `SELECT COALESCE(sum(CASE WHEN v.comprobante = 'nota_credito' THEN -r.cantidad ELSE r.cantidad END), 0)::text AS t
         FROM venta_renglones r JOIN ventas v ON v.tenant_id = r.tenant_id AND v.id = r.venta_id WHERE r.producto_id = $1 AND v.estado = 'cerrada'`, [productoId]);
    const tc = await c.query<{ t: string }>(
      `SELECT COALESCE(sum(r.cantidad), 0)::text AS t FROM compra_renglones r JOIN compras k ON k.tenant_id = r.tenant_id AND k.id = r.compra_id WHERE r.producto_id = $1 AND k.estado = 'cerrada'`, [productoId]);
    return { ventas: v.rows, compras: k.rows, totalVendido: tv.rows[0]!.t, totalComprado: tc.rows[0]!.t };
  });
}
