// «Marcar para pedir»: un producto marcado a mano aparece en la mercadería a pedir aunque no esté bajo el mínimo.
// La marca se quita sola cuando se carga una compra que lo incluye.
import { z } from 'zod';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { normalizarCantidad } from '../../../packages/dominio/src/index.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function estaMarcadoParaPedir(s: SesionActiva, productoId: string): Promise<boolean> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) return false;
  return conTenant(s.tenantId, async (c) => (await c.query<{ a_pedir: boolean }>('SELECT a_pedir FROM productos WHERE id = $1', [productoId])).rows[0]?.a_pedir ?? false);
}

export async function marcarParaPedir(s: SesionActiva, productoId: string, marcado: boolean): Promise<void> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) throw new ErrorDeUsuario('El producto no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ a_pedir: boolean; comprable: boolean }>('SELECT a_pedir, comprable FROM productos WHERE id = $1 AND activo FOR UPDATE', [productoId]);
    const p = r.rows[0];
    if (!p) throw new ErrorDeUsuario('El producto no existe o está archivado');
    if (marcado && !p.comprable) throw new ErrorDeUsuario('Este producto no se compra');
    if (p.a_pedir === marcado) return;
    await c.query('UPDATE productos SET a_pedir = $2 WHERE id = $1', [productoId, marcado]);
    await auditar(c, s.usuarioId, marcado ? 'marcar_pedir' : 'desmarcar_pedir', 'producto', undefined, { entidadId: productoId });
  });
}

// ───────── Mercadería fuera del catálogo (D-041) ─────────
// En el «Pedido de mercadería pendiente» se anota como texto algo que no está cargado como producto. No mueve stock.

export interface MercaderiaManual { id: string; descripcion: string; cantidad: string | null; proveedorId: string | null; proveedor: string | null }

const esquemaMercaderia = z.object({
  descripcion: z.string().trim().min(1, 'Escribí qué hay que pedir').max(200, 'El texto es demasiado largo'),
  cantidad: z.string().default('').transform((t, ctx) => {
    if (t.trim() === '') return null;
    const n = normalizarCantidad(t);
    if (n === null || Number(n) <= 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La cantidad no es válida' }); return z.NEVER; }
    return n;
  }),
  proveedorId: z.string().uuid().nullable().default(null),
});

/** Lo anotado a mano que sigue pendiente. Si la base todavía no tiene la tabla (migración sin aplicar), devuelve vacío. */
export async function mercaderiaManual(s: SesionActiva, filtro: { ids?: string[] } = {}): Promise<MercaderiaManual[]> {
  exigir(s, 'compras');
  const ids = filtro.ids?.filter((x) => UUID.test(x));
  if (ids && ids.length === 0) return [];
  try {
    return await conTenant(s.tenantId, async (c) => {
      const r = await c.query<{ id: string; descripcion: string; cantidad: string | null; proveedor_id: string | null; proveedor: string | null }>(
        `SELECT m.id, m.descripcion, m.cantidad::text AS cantidad, m.proveedor_id, pv.nombre AS proveedor
           FROM mercaderia_a_pedir m LEFT JOIN proveedores pv ON pv.tenant_id = m.tenant_id AND pv.id = m.proveedor_id
          WHERE m.estado = 'pendiente' AND ($1::uuid[] IS NULL OR m.id = ANY($1::uuid[]))
          ORDER BY lower(pv.nombre) NULLS LAST, m.creado_en LIMIT 200`, [ids ?? null]);
      return r.rows.map((f) => ({ id: f.id, descripcion: f.descripcion, cantidad: f.cantidad, proveedorId: f.proveedor_id, proveedor: f.proveedor }));
    });
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return [];
    throw e;
  }
}

export async function agregarMercaderiaManual(s: SesionActiva, entrada: unknown): Promise<string> {
  exigir(s, 'compras');
  const v = esquemaMercaderia.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(v.error.issues[0]?.message ?? 'Datos inválidos');
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    if (d.proveedorId) {
      const p = await c.query('SELECT 1 FROM proveedores WHERE id = $1 AND activo', [d.proveedorId]);
      if (p.rowCount === 0) throw new ErrorDeUsuario('El proveedor no existe o está archivado');
    }
    const r = await c.query<{ id: string }>(
      'INSERT INTO mercaderia_a_pedir (tenant_id, descripcion, cantidad, proveedor_id, creado_por) VALUES (app.tenant_id(), $1, $2, $3, $4) RETURNING id',
      [d.descripcion, d.cantidad, d.proveedorId, s.usuarioId]);
    const id = r.rows[0]!.id;
    await auditar(c, s.usuarioId, 'marcar_pedir', 'mercaderia_a_pedir', { descripcion: d.descripcion }, { entidadId: id });
    return id;
  });
}

/** Quita lo anotado del pedido pendiente (queda registrado como quitado; no se borra). */
export async function quitarMercaderiaManual(s: SesionActiva, id: string): Promise<void> {
  exigir(s, 'compras');
  if (!UUID.test(id)) throw new ErrorDeUsuario('No existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query("UPDATE mercaderia_a_pedir SET estado = 'quitada', quitada_en = now(), quitada_por = $2 WHERE id = $1 AND estado = 'pendiente'", [id, s.usuarioId]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('Ya no está en el pedido pendiente');
    await auditar(c, s.usuarioId, 'desmarcar_pedir', 'mercaderia_a_pedir', undefined, { entidadId: id });
  });
}

/** Proveedores activos para elegir al anotar mercadería (permiso de compras, no de proveedores). */
export async function proveedoresParaPedir(s: SesionActiva): Promise<{ id: string; nombre: string }[]> {
  exigir(s, 'compras');
  const r = await conTenant(s.tenantId, (c) => c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM proveedores WHERE activo ORDER BY lower(nombre)'));
  return r.rows;
}
