// Compras: cerrar una compra genera, en una sola transacción, la compra con sus renglones, el pago desde una caja (más el impuesto por
// transacción de esa caja) o el movimiento de cuenta corriente del proveedor, la entrada de stock y, según el modo elegido, la actualización
// de costos y precios. Si algo falla, no queda nada a medias. Una compra no se edita ni se borra: se anula con los movimientos inversos.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { cajaEn } from './cajas.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaCompra, primerError } from './validacion.ts';
import {
  aCentavos, calcularCompra, deCentavos, escaparLike, impuestoDeTransaccion, precioMantenerUtilidad, terminosDeBusqueda,
} from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ───────── Categorías de compra (configuración por comercio) ─────────
// Al primer uso se crean las que pide la especificación; después cada comercio las agrega o las desactiva.
const CATEGORIAS_INICIALES = ['Mercadería', 'Impuestos', 'Servicios', 'Envases', 'Arreglos', 'Logística', 'Marketing', 'Sueldos'];

async function asegurarCategorias(c: PoolClient): Promise<void> {
  const n = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM categorias_compra');
  if (Number(n.rows[0]!.n) > 0) return;
  for (const [i, nombre] of CATEGORIAS_INICIALES.entries()) {
    await c.query('INSERT INTO categorias_compra (tenant_id, nombre, orden) VALUES (app.tenant_id(), $1, $2) ON CONFLICT DO NOTHING', [nombre, i]);
  }
}

export async function categoriasDeCompra(s: SesionActiva): Promise<string[]> {
  exigir(s, 'compras');
  return conTenant(s.tenantId, async (c) => {
    await asegurarCategorias(c);
    const r = await c.query<{ nombre: string }>('SELECT nombre FROM categorias_compra WHERE activa ORDER BY orden, lower(nombre)');
    return r.rows.map((f) => f.nombre);
  });
}

export async function agregarCategoriaDeCompra(s: SesionActiva, nombre: string): Promise<void> {
  exigir(s, 'ajustes');
  const n = String(nombre ?? '').trim();
  if (!n || n.length > 60) throw new ErrorDeUsuario('El nombre de la categoría tiene que tener entre 1 y 60 letras');
  await conTenant(s.tenantId, async (c) => {
    await asegurarCategorias(c);
    await c.query(
      `INSERT INTO categorias_compra (tenant_id, nombre, orden) VALUES (app.tenant_id(), $1, (SELECT COALESCE(max(orden), 0) + 1 FROM categorias_compra))
       ON CONFLICT (tenant_id, lower(nombre)) DO UPDATE SET activa = true`, [n]);
    await auditar(c, s.usuarioId, 'crear', 'categoria_compra', { nombre: n });
  });
}

// ───────── Datos para armar la compra ─────────
export interface ProveedorParaCompra { id: string; nombre: string; saldo: string }

export async function buscarProveedoresParaCompra(s: SesionActiva, q: string): Promise<ProveedorParaCompra[]> {
  exigir(s, 'compras');
  const params: unknown[] = [];
  const cond = terminosDeBusqueda(q).map((t) => {
    params.push('%' + escaparLike(t) + '%');
    return `unaccent(lower(p.nombre || ' ' || coalesce(p.cuit,'') || ' ' || coalesce(p.contacto,''))) LIKE $${params.length} ESCAPE '\\'`;
  });
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT p.id, p.nombre, COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.proveedor_id = p.id), 0)::numeric(14,2)::text AS saldo
         FROM proveedores p WHERE p.activo ${cond.length ? 'AND ' + cond.join(' AND ') : ''} ORDER BY lower(p.nombre) LIMIT 15`,
      params,
    );
    return r.rows.map((f) => ({ id: f.id, nombre: f.nombre, saldo: f.saldo }));
  });
}

export interface ProductoParaCompra { id: string; nombre: string; codigo: string | null; unidad: string; costo: string; iva: number; stock: string }

/** Productos comprables con su último costo (sin IVA). */
export async function buscarProductosParaCompra(s: SesionActiva, q: string, ids?: string[]): Promise<ProductoParaCompra[]> {
  exigir(s, 'compras');
  const params: unknown[] = [];
  const cond: string[] = ['p.activo', 'p.comprable'];
  if (ids) {
    params.push(ids.filter((i) => UUID.test(i)));
    cond.push(`p.id = ANY($${params.length}::uuid[])`);
  }
  for (const t of terminosDeBusqueda(q)) {
    params.push('%' + escaparLike(t) + '%');
    cond.push(`unaccent(lower(p.nombre || ' ' || coalesce(p.codigo,'') || ' ' || coalesce(p.tipo,''))) LIKE $${params.length} ESCAPE '\\'`);
  }
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT p.id, p.nombre, p.codigo, p.unidad, p.iva::text, p.costo::text,
              (SELECT COALESCE(sum(sm.cantidad), 0)::numeric(14,3) FROM stock_movimientos sm WHERE sm.producto_id = p.id)::text AS stock
         FROM productos p WHERE ${cond.join(' AND ')} ORDER BY lower(p.nombre) LIMIT ${ids ? 200 : 15}`,
      params,
    );
    return r.rows.map((f) => ({ id: f.id, nombre: f.nombre, codigo: f.codigo, unidad: f.unidad, costo: f.costo, iva: Number(f.iva), stock: f.stock }));
  });
}

export interface Faltante extends ProductoParaCompra { cantidad: string }

/** Productos bajo el stock mínimo, con lo que hay que comprar para llegar al stock ideal (o al mínimo, si no hay ideal). */
export async function faltantesParaComprar(s: SesionActiva): Promise<Faltante[]> {
  exigir(s, 'compras');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT * FROM (
         SELECT p.id, p.nombre, p.codigo, p.unidad, p.iva::text, p.costo::text, p.stock_minimo, p.stock_ideal,
                (SELECT COALESCE(sum(sm.cantidad), 0) FROM stock_movimientos sm WHERE sm.producto_id = p.id) AS stock
           FROM productos p WHERE p.activo AND p.comprable AND p.stock_minimo > 0) t
        WHERE stock < stock_minimo ORDER BY lower(nombre) LIMIT 200`);
    return r.rows.map((f) => {
      const meta = Number(f.stock_ideal) > Number(f.stock) ? Number(f.stock_ideal) : Number(f.stock_minimo);
      const falta = Math.round((meta - Number(f.stock)) * 1000) / 1000;
      return { id: f.id, nombre: f.nombre, codigo: f.codigo, unidad: f.unidad, costo: f.costo, iva: Number(f.iva), stock: String(Number(f.stock)), cantidad: String(falta) };
    });
  });
}

// ───────── Cerrar una compra ─────────
export interface ResultadoCompra { id: string; numero: number; total: string; impuesto: string; repetida: boolean }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':compras'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM compras');
  return r.rows[0]!.n;
}

/** Costo unitario después del descuento del renglón, en centavos, "mitad hacia arriba". */
function costoConDescuento(costo: number, descuentoPct: number): number {
  const factor = BigInt(10000 - Math.round(descuentoPct * 100));
  return Number((BigInt(costo) * factor * 2n + 10000n) / 20000n);
}

export async function cerrarCompra(s: SesionActiva, entrada: unknown): Promise<ResultadoCompra> {
  exigir(s, 'compras');
  const v = esquemaCompra.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  const conIva = d.comprobante === 'factura_a' || d.comprobante === 'factura_b';
  return conTenant(s.tenantId, async (c) => {
    // Doble clic o reintento: la misma clave devuelve la compra ya cerrada, sin duplicar nada.
    const previa = await c.query<{ id: string; numero: number; total: string; impuesto: string }>('SELECT id, numero, total::text, impuesto::text FROM compras WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], repetida: true };

    const prov = await c.query<{ activo: boolean }>('SELECT activo FROM proveedores WHERE id = $1', [d.proveedorId]);
    if (!prov.rows[0] || !prov.rows[0].activo) throw new ErrorDeUsuario('El proveedor no existe o está archivado');
    await asegurarCategorias(c);
    const cat = await c.query('SELECT 1 FROM categorias_compra WHERE lower(nombre) = lower($1) AND activa', [d.categoria]);
    if (cat.rowCount === 0) throw new ErrorDeUsuario('La categoría de la compra no existe');

    const ids = [...new Set(d.renglones.map((r) => r.productoId).filter((x): x is string => x !== null))];
    const prods = new Map<string, { nombre: string; iva: number; costo: string }>();
    if (ids.length) {
      const pr = await c.query<{ id: string; nombre: string; iva: string; costo: string }>('SELECT id, nombre, iva::text, costo::text FROM productos WHERE id = ANY($1::uuid[]) AND activo AND comprable FOR UPDATE', [ids]);
      for (const f of pr.rows) prods.set(f.id, { nombre: f.nombre, iva: Number(f.iva), costo: f.costo });
      if (prods.size !== ids.length) throw new ErrorDeUsuario('Un producto no existe, está archivado o no se compra');
    }
    const lineas = d.renglones.map((r) => {
      const p = r.productoId ? prods.get(r.productoId)! : null;
      const descripcion = p ? p.nombre : r.descripcion;
      if (!descripcion) throw new ErrorDeUsuario('El ítem libre necesita una descripción');
      return { ...r, descripcion, iva: p ? p.iva : r.iva };
    });
    const calc = calcularCompra(lineas.map((r) => ({ cantidad: r.cantidad, costo: aCentavos(r.costo), descuentoPct: r.descuentoPct, iva: r.iva })), d.descuentoTotalPct, conIva);

    // Forma de pago
    let caja: Awaited<ReturnType<typeof cajaEn>> | null = null;
    let impuesto = 0;
    if (d.pago.tipo === 'caja') {
      caja = await cajaEn(c, s, d.pago.cajaId);
      if (!caja.turnoId) throw new ErrorDeUsuario(`La caja ${caja.nombre} está cerrada: abrila para pagar desde ahí`);
      impuesto = impuestoDeTransaccion(calc.total, caja.impuestoTransaccion);
    }

    const numero = await siguienteNumero(c);
    let reemplazada: number | null = null;
    if (d.reemplazaCompraId) {
      const ant = await c.query<{ numero: number }>('SELECT numero FROM compras WHERE id = $1', [d.reemplazaCompraId]);
      if (!ant.rows[0]) throw new ErrorDeUsuario('La compra que se quiere editar no existe');
      reemplazada = ant.rows[0].numero;
      await anularEnTransaccion(c, s, d.reemplazaCompraId, `Modificada: reemplazada por la compra N° ${numero}`);
    }
    const pctGuardado = d.descuentoTotalPct;
    const cr = await c.query<{ id: string }>(
      `INSERT INTO compras (tenant_id, numero, estado, clave, proveedor_id, categoria, comprobante, nro_comprobante, fecha, descuento_pct, subtotal, descuento_total,
                            neto, iva, total, en_cuenta_corriente, caja_id, impuesto, modo_costos, nota, compra_origen_id, usuario_id)
       VALUES (app.tenant_id(), $1, 'cerrada', $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
      [numero, d.clave, d.proveedorId, d.categoria, d.comprobante, d.nroComprobante, d.fecha, pctGuardado, deCentavos(calc.subtotal), deCentavos(calc.descuentoTotal),
       deCentavos(calc.neto), deCentavos(calc.iva), deCentavos(calc.total), d.pago.tipo === 'cuenta_corriente', caja?.id ?? null, deCentavos(impuesto), d.modoCostos, d.nota,
       d.reemplazaCompraId, s.usuarioId],
    );
    const compraId = cr.rows[0]!.id;

    const cambiosDeCosto: { producto: string; antes: string; despues: string }[] = [];
    for (const [i, r] of lineas.entries()) {
      const k = calc.renglones[i]!;
      await c.query(
        `INSERT INTO compra_renglones (tenant_id, compra_id, orden, producto_id, descripcion, cantidad, costo, descuento_pct, iva, subtotal, neto, iva_monto)
         VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [compraId, i + 1, r.productoId, r.descripcion, r.cantidad, r.costo, r.descuentoPct, r.iva, deCentavos(k.subtotal), deCentavos(k.neto), deCentavos(k.iva)],
      );
      if (!r.productoId) continue;
      await c.query(
        `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id, compra_id)
         VALUES (app.tenant_id(), $1, 'compra', $2, $3, $4, $5)`,
        [r.productoId, r.cantidad, `Compra N° ${numero}`, s.usuarioId, compraId],
      );
      if (d.modoCostos === 'ninguno') continue;
      // El costo nuevo es el de la compra, ya con el descuento del renglón (el descuento total no cambia el costo de lista).
      const actual = (await c.query<{ costo: string }>('SELECT costo::text FROM productos WHERE id = $1', [r.productoId])).rows[0]!.costo;
      const nuevo = costoConDescuento(aCentavos(r.costo), r.descuentoPct);
      const anterior = aCentavos(actual);
      if (nuevo === anterior) continue;
      await c.query('UPDATE productos SET costo = $2 WHERE id = $1', [r.productoId, deCentavos(nuevo)]);
      if (d.modoCostos === 'costo_y_precio' && anterior > 0) {
        // Mantener la utilidad: nuevo precio = precio × costo nuevo ÷ costo anterior (en cada lista).
        const precios = await c.query<{ lista_id: string; precio: string }>('SELECT lista_id, precio::text FROM producto_precios WHERE producto_id = $1', [r.productoId]);
        for (const pp of precios.rows) {
          await c.query('UPDATE producto_precios SET precio = $3 WHERE producto_id = $1 AND lista_id = $2', [r.productoId, pp.lista_id, deCentavos(precioMantenerUtilidad(aCentavos(pp.precio), anterior, nuevo))]);
        }
      }
      cambiosDeCosto.push({ producto: r.descripcion, antes: actual, despues: deCentavos(nuevo) });
    }

    if (calc.total > 0) { // una compra de $0 no mueve plata
      if (caja) {
        await c.query(
          `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, compra_id, fecha)
           VALUES (app.tenant_id(), $1, $2, 'pago_compra', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
          [caja.id, caja.turnoId, deCentavos(-calc.total), `Compra N° ${numero}`, s.usuarioId, compraId, d.fecha],
        );
        if (impuesto > 0) {
          await c.query(
            `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, compra_id, fecha)
             VALUES (app.tenant_id(), $1, $2, 'impuesto_compra', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
            [caja.id, caja.turnoId, deCentavos(-impuesto), `Impuesto por transacción ${caja.impuestoTransaccion}% · compra N° ${numero}`, s.usuarioId, compraId, d.fecha],
          );
        }
      } else {
        await c.query(
          `INSERT INTO cuenta_corriente_movimientos (tenant_id, proveedor_id, tipo, importe, concepto, usuario_id, compra_id)
           VALUES (app.tenant_id(), $1, 'compra', $2, $3, $4, $5)`,
          [d.proveedorId, deCentavos(calc.total), `Compra N° ${numero}`, s.usuarioId, compraId],
        );
      }
    }

    await auditar(c, s.usuarioId, 'cerrar', 'compra', { numero, proveedor: d.proveedorId, total: deCentavos(calc.total), comprobante: d.comprobante, pago: d.pago.tipo, categoria: d.categoria, modoCostos: d.modoCostos, costos: cambiosDeCosto, reemplaza: reemplazada }, { entidadId: compraId });
    return { id: compraId, numero, total: deCentavos(calc.total), impuesto: deCentavos(impuesto), repetida: false };
  });
}

// ───────── Consultas ─────────
export interface FilaCompra { id: string; numero: number; fecha: Date; proveedor: string; comprobante: string; categoria: string; total: string; estado: string; pago: string }

export async function listarCompras(s: SesionActiva, f: { q?: string; limite?: number } = {}): Promise<FilaCompra[]> {
  exigir(s, 'compras');
  const params: unknown[] = [];
  const cond = terminosDeBusqueda(f.q ?? '').map((t) => {
    params.push('%' + escaparLike(t) + '%');
    return `unaccent(lower(p.nombre || ' ' || c.numero::text || ' ' || coalesce(c.nro_comprobante,'') || ' ' || c.categoria)) LIKE $${params.length} ESCAPE '\\'`;
  });
  return conTenant(s.tenantId, async (cl) => {
    const r = await cl.query(
      `SELECT c.id, c.numero, c.fecha, p.nombre AS proveedor, c.comprobante, c.categoria, c.total::text, c.estado,
              CASE WHEN c.en_cuenta_corriente THEN 'Cuenta corriente' ELSE COALESCE(k.nombre, '') END AS pago
         FROM compras c JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN cajas k ON k.id = c.caja_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY c.numero DESC LIMIT ${Math.min(Math.max(f.limite ?? 10, 1), 200)}`,
      params,
    );
    return r.rows.map((x) => ({ id: x.id, numero: x.numero, fecha: x.fecha, proveedor: x.proveedor, comprobante: x.comprobante, categoria: x.categoria, total: x.total, estado: x.estado, pago: x.pago }));
  });
}

export interface DetalleCompra extends FilaCompra {
  proveedorId: string; nroComprobante: string | null; subtotal: string; descuentoTotal: string; descuentoPct: string; neto: string; iva: string; impuesto: string;
  modoCostos: string; nota: string | null; usuario: string | null; motivoAnulacion: string | null; anuladaEn: Date | null;
  renglones: { descripcion: string; cantidad: string; costo: string; descuentoPct: string; iva: string; neto: string; ivaMonto: string }[];
  ordenesPago: { id: string; numero: number; importe: string; estado: string }[];
}

export async function obtenerCompra(s: SesionActiva, id: string): Promise<DetalleCompra | null> {
  exigir(s, 'compras');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (cl) => {
    const r = await cl.query(
      `SELECT c.*, c.total::text AS total_t, c.subtotal::text AS subtotal_t, c.descuento_total::text AS dtotal_t, c.descuento_pct::text AS dpct_t, c.neto::text AS neto_t,
              c.iva::text AS iva_t, c.impuesto::text AS imp_t, p.nombre AS proveedor, u.nombre AS usuario,
              CASE WHEN c.en_cuenta_corriente THEN 'Cuenta corriente' ELSE COALESCE(k.nombre, '') END AS pago
         FROM compras c JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN cajas k ON k.id = c.caja_id WHERE c.id = $1`, [id]);
    const f = r.rows[0];
    if (!f) return null;
    const rg = await cl.query(
      `SELECT descripcion, cantidad::text, costo::text, descuento_pct::text, iva::text, neto::text, iva_monto::text FROM compra_renglones WHERE compra_id = $1 ORDER BY orden`, [id]);
    const op = await cl.query<{ id: string; numero: number; importe: string; estado: string }>('SELECT id, numero, importe::text, estado FROM ordenes_pago WHERE compra_id = $1 ORDER BY numero', [id]);
    return {
      id: f.id, numero: f.numero, fecha: f.fecha, proveedor: f.proveedor, proveedorId: f.proveedor_id, comprobante: f.comprobante, categoria: f.categoria, total: f.total_t, estado: f.estado, pago: f.pago,
      nroComprobante: f.nro_comprobante, subtotal: f.subtotal_t, descuentoTotal: f.dtotal_t, descuentoPct: f.dpct_t, neto: f.neto_t, iva: f.iva_t, impuesto: f.imp_t,
      modoCostos: f.modo_costos, nota: f.nota, usuario: f.usuario, motivoAnulacion: f.motivo_anulacion, anuladaEn: f.anulada_en,
      renglones: rg.rows.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, costo: x.costo, descuentoPct: x.descuento_pct, iva: x.iva, neto: x.neto, ivaMonto: x.iva_monto })),
      ordenesPago: op.rows,
    };
  });
}

// ───────── Anular una compra ─────────
/** Anula una compra cerrada. No borra nada: genera el movimiento inverso de cada movimiento de caja, de stock y de cuenta corriente
 *  que dejó la compra (cada uno referencia al original) y la marca como anulada con quién, cuándo y por qué. Todo o nada.
 *  Los costos y precios que actualizó la compra NO se restauran (pueden haber cambiado después): se corrigen desde el producto. */
export async function anularCompra(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'compras');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La compra no existe');
  await conTenant(s.tenantId, (c) => anularEnTransaccion(c, s, id, m));
}

async function anularEnTransaccion(c: PoolClient, s: SesionActiva, id: string, m: string): Promise<void> {
  const r = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM compras WHERE id = $1 FOR UPDATE', [id]);
  const compra = r.rows[0];
  if (!compra) throw new ErrorDeUsuario('La compra no existe');
  if (compra.estado === 'anulada') throw new ErrorDeUsuario('La compra ya está anulada');
  const concepto = `Anulación compra N° ${compra.numero}`;
  // Una reversión de caja se permite aunque la caja ya esté cerrada (queda en el libro, sin turno).
  await c.query(
    `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, revierte_id, usuario_id, compra_id)
     SELECT app.tenant_id(), caja_id, NULL, 'reversion', -importe, $2, id, $3, compra_id FROM caja_movimientos
      WHERE compra_id = $1 AND tipo IN ('pago_compra', 'impuesto_compra')`, [id, concepto, s.usuarioId]);
  await c.query(
    `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, revierte_id, usuario_id, compra_id)
     SELECT app.tenant_id(), producto_id, 'reversion', -cantidad, $2, id, $3, compra_id FROM stock_movimientos
      WHERE compra_id = $1 AND tipo = 'compra'`, [id, concepto, s.usuarioId]);
  await c.query(
    `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, compra_id)
     SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, compra_id FROM cuenta_corriente_movimientos
      WHERE compra_id = $1 AND tipo = 'compra'`, [id, concepto, s.usuarioId]);
  await c.query(`UPDATE compras SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
  await auditar(c, s.usuarioId, 'anular', 'compra', { numero: compra.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
}

// ───────── Editar una compra cerrada ─────────
export interface DatosParaEditarCompra {
  numero: number;
  proveedor: ProveedorParaCompra;
  datos: {
    categoria: string; comprobante: string; nroComprobante: string; fecha: string; descTotal: string; modoCostos: string; pagoTipo: 'caja' | 'cuenta_corriente'; cajaId: string; nota: string;
    renglones: { productoId: string | null; descripcion: string; cantidad: string; costo: string; descuentoPct: string; iva: number }[];
  };
}

const ARG = (f: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(f).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

/** Arma el formulario de compra con los datos de una compra cerrada, para corregirla. Al cerrarlo, la original se anula y la nueva la reemplaza. */
export async function datosParaEditarCompra(s: SesionActiva, compraId: string): Promise<DatosParaEditarCompra | null> {
  exigir(s, 'compras');
  if (!UUID.test(compraId)) return null;
  return conTenant(s.tenantId, async (c) => {
    const v = await c.query(`SELECT c.*, c.descuento_pct::text AS dpct_t FROM compras c WHERE c.id = $1 AND c.estado = 'cerrada'`, [compraId]);
    const f = v.rows[0];
    if (!f) return null;
    const rg = await c.query(`SELECT producto_id, descripcion, cantidad::text, costo::text, descuento_pct::text, iva::text FROM compra_renglones WHERE compra_id = $1 ORDER BY orden`, [compraId]);
    const pv = await c.query(
      `SELECT p.id, p.nombre, COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.proveedor_id = p.id), 0)::numeric(14,2)::text AS saldo FROM proveedores p WHERE p.id = $1`, [f.proveedor_id]);
    const x = pv.rows[0];
    if (!x) return null;
    return {
      numero: f.numero,
      proveedor: { id: x.id, nombre: x.nombre, saldo: x.saldo },
      datos: {
        categoria: f.categoria, comprobante: f.comprobante, nroComprobante: f.nro_comprobante ?? '', fecha: ARG(f.fecha), descTotal: String(Number(f.dpct_t)), modoCostos: f.modo_costos,
        pagoTipo: f.en_cuenta_corriente ? 'cuenta_corriente' : 'caja', cajaId: f.caja_id ?? '', nota: f.nota ?? '',
        renglones: rg.rows.map((r) => ({ productoId: r.producto_id, descripcion: r.descripcion, cantidad: r.cantidad, costo: r.costo, descuentoPct: String(Number(r.descuento_pct)), iva: Number(r.iva) })),
      },
    };
  });
}
