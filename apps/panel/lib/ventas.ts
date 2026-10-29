// Ventas: cerrar una venta genera, en una sola transacción, la venta con sus renglones, el cobro en caja (más la comisión)
// o el movimiento de cuenta corriente, y el descuento de stock. Si algo falla, no queda nada a medias.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { cajaEn } from './cajas.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaMedioPago, esquemaVenta, primerError } from './validacion.ts';
import { aCentavos, calcularVenta, comisionDeCobro, deCentavos, escaparLike, terminosDeBusqueda } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ───────── Medios de pago (configuración) ─────────
export interface MedioPago { id: string; nombre: string; comisionPct: number; ivaComision: number; activo: boolean; cajaIds: string[] }

export async function listarMediosDePago(s: SesionActiva): Promise<MedioPago[]> {
  exigir(s, 'ventas');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT m.id, m.nombre, m.comision_pct::text, m.iva_comision::text, m.activo,
              COALESCE((SELECT array_agg(x.caja_id) FROM medio_pago_cajas x WHERE x.medio_id = m.id), '{}') AS cajas
         FROM medios_pago m ORDER BY m.orden, lower(m.nombre)`,
    );
    return r.rows.map((f) => ({ id: f.id, nombre: f.nombre, comisionPct: Number(f.comision_pct), ivaComision: Number(f.iva_comision), activo: f.activo, cajaIds: f.cajas }));
  });
}

export async function guardarMedioDePago(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'ajustes');
  const v = esquemaMedioPago.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  try {
    return await conTenant(s.tenantId, async (c) => {
      let mid = id;
      if (id) {
        const r = await c.query('UPDATE medios_pago SET nombre=$2, comision_pct=$3, iva_comision=$4 WHERE id=$1', [id, d.nombre, d.comisionPct, d.ivaComision]);
        if (r.rowCount === 0) throw new ErrorDeUsuario('El medio de pago no existe');
        await c.query('DELETE FROM medio_pago_cajas WHERE medio_id = $1', [id]);
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO medios_pago (tenant_id, nombre, comision_pct, iva_comision, orden)
           VALUES (app.tenant_id(), $1, $2, $3, (SELECT COALESCE(max(orden), 0) + 1 FROM medios_pago)) RETURNING id`,
          [d.nombre, d.comisionPct, d.ivaComision],
        );
        mid = r.rows[0]!.id;
      }
      for (const cajaId of new Set(d.cajaIds)) {
        await c.query('INSERT INTO medio_pago_cajas (tenant_id, medio_id, caja_id) VALUES (app.tenant_id(), $1, $2)', [mid, cajaId]);
      }
      await auditar(c, s.usuarioId, id ? 'modificar' : 'crear', 'medio_pago', d, { entidadId: mid! });
      return mid!;
    });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) throw e;
    const codigo = (e as { code?: string }).code;
    if (codigo === '23505') throw new ErrorDeUsuario('Ya hay un medio de pago con ese nombre');
    if (codigo === '23503') throw new ErrorDeUsuario('Una de las cajas no existe');
    throw e;
  }
}

// ───────── Datos para armar la venta ─────────
export interface ClienteParaVenta { id: string; nombre: string; saldo: string; listaId: string | null; descuento: number; cuentaCorriente: boolean; esConsumidorFinal: boolean }

export async function buscarClientesParaVenta(s: SesionActiva, q: string): Promise<ClienteParaVenta[]> {
  exigir(s, 'ventas');
  const params: unknown[] = [];
  const cond = terminosDeBusqueda(q).map((t) => {
    params.push('%' + escaparLike(t) + '%');
    return `unaccent(lower(c.nombre || ' ' || coalesce(c.cuit,'') || ' ' || coalesce(c.telefono,''))) LIKE $${params.length} ESCAPE '\\'`;
  });
  return conTenant(s.tenantId, async (c) => {
    // El Consumidor Final siempre existe (se crea la primera vez).
    await c.query(`INSERT INTO clientes (tenant_id, nombre, es_consumidor_final) VALUES (app.tenant_id(), 'Consumidor Final', true) ON CONFLICT DO NOTHING`);
    const r = await c.query(
      `SELECT c.id, c.nombre, c.es_consumidor_final, k.lista_id, COALESCE(k.descuento, 0)::text AS descuento, COALESCE(k.cuenta_corriente, false) AS cc,
              COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.cliente_id = c.id), 0)::numeric(14,2)::text AS saldo
         FROM clientes c LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id
        WHERE c.activo ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
        ORDER BY c.es_consumidor_final DESC, lower(c.nombre) LIMIT 15`,
      params,
    );
    return r.rows.map((f) => ({ id: f.id, nombre: f.nombre, saldo: f.saldo, listaId: f.lista_id, descuento: Number(f.descuento), cuentaCorriente: f.cc && !f.es_consumidor_final, esConsumidorFinal: f.es_consumidor_final }));
  });
}

export interface ProductoParaVenta { id: string; nombre: string; codigo: string | null; unidad: string; precio: string; iva: number; stock: string }

/** Productos vendibles con el precio de la lista elegida (también sirve para "Actualizar precios"). */
export async function buscarProductosParaVenta(s: SesionActiva, q: string, listaId: string | null, ids?: string[]): Promise<ProductoParaVenta[]> {
  exigir(s, 'ventas');
  const params: unknown[] = [listaId && UUID.test(listaId) ? listaId : null];
  const cond: string[] = ['p.activo', 'p.vendible'];
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
      `SELECT p.id, p.nombre, p.codigo, p.unidad, p.iva::text, COALESCE(pp.precio, 0)::text AS precio,
              (SELECT COALESCE(sum(sm.cantidad), 0)::numeric(14,3) FROM stock_movimientos sm WHERE sm.producto_id = p.id)::text AS stock
         FROM productos p LEFT JOIN producto_precios pp ON pp.producto_id = p.id AND pp.lista_id = $1
        WHERE ${cond.join(' AND ')} ORDER BY lower(p.nombre) LIMIT ${ids ? 200 : 15}`,
      params,
    );
    return r.rows.map((f) => ({ id: f.id, nombre: f.nombre, codigo: f.codigo, unidad: f.unidad, precio: f.precio, iva: Number(f.iva), stock: f.stock }));
  });
}

// ───────── Cerrar una venta ─────────
export interface ResultadoVenta { id: string; numero: number; total: string; comision: string; avisosStock: string[]; repetida: boolean }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':ventas'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM ventas');
  return r.rows[0]!.n;
}

export async function cerrarVenta(s: SesionActiva, entrada: unknown): Promise<ResultadoVenta> {
  exigir(s, 'ventas');
  const v = esquemaVenta.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    // Doble clic o reintento: la misma clave devuelve la venta ya cerrada, sin duplicar nada.
    const previa = await c.query<{ id: string; numero: number; total: string; comision: string }>('SELECT id, numero, total::text, comision::text FROM ventas WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], avisosStock: [], repetida: true };

    const cli = await c.query<{ activo: boolean; es_cf: boolean; cc: boolean | null }>(
      `SELECT c.activo, c.es_consumidor_final AS es_cf, k.cuenta_corriente AS cc FROM clientes c
         LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id WHERE c.id = $1`, [d.clienteId]);
    if (!cli.rows[0] || !cli.rows[0].activo) throw new ErrorDeUsuario('El cliente no existe o está archivado');
    if (d.listaId) {
      const l = await c.query('SELECT 1 FROM listas_precios WHERE id = $1', [d.listaId]);
      if (l.rowCount === 0) throw new ErrorDeUsuario('La lista de precios no existe');
    }

    // Los productos del catálogo aportan su nombre e IVA reales; el ítem libre trae los suyos.
    const ids = [...new Set(d.renglones.map((r) => r.productoId).filter((x): x is string => x !== null))];
    const prods = new Map<string, { nombre: string; iva: number }>();
    if (ids.length) {
      const pr = await c.query<{ id: string; nombre: string; iva: string }>('SELECT id, nombre, iva::text FROM productos WHERE id = ANY($1::uuid[]) AND activo AND vendible', [ids]);
      for (const f of pr.rows) prods.set(f.id, { nombre: f.nombre, iva: Number(f.iva) });
      if (prods.size !== ids.length) throw new ErrorDeUsuario('Un producto no existe, está archivado o no se vende');
    }
    const lineas = d.renglones.map((r) => {
      const p = r.productoId ? prods.get(r.productoId)! : null;
      const descripcion = p ? p.nombre : r.descripcion;
      if (!descripcion) throw new ErrorDeUsuario('El ítem libre necesita una descripción');
      return { ...r, descripcion, iva: p ? p.iva : r.iva };
    });
    const entrada = lineas.map((r) => ({ cantidad: r.cantidad, precio: aCentavos(r.precio), descuentoPct: r.descuentoPct, iva: r.iva }));
    // Un solo descuento: por porcentaje o por total final. Si es por total, el porcentaje que se guarda es el equivalente (informativo).
    let calc;
    try {
      calc = calcularVenta(entrada, d.totalFinal !== null ? { totalFinal: aCentavos(d.totalFinal) } : d.descuentoTotalPct);
    } catch (e) {
      if (d.totalFinal !== null) throw new ErrorDeUsuario('El total final no puede superar al subtotal');
      throw e;
    }
    const descuentoPctGuardado = d.totalFinal !== null ? (calc.subtotal > 0 ? Math.round((calc.descuentoTotal / calc.subtotal) * 10000) / 100 : 0) : d.descuentoTotalPct;

    // Forma de cobro
    let cajaDestino: Awaited<ReturnType<typeof cajaEn>> | null = null;
    let medio: { id: string; comision_pct: string; iva_comision: string } | null = null;
    let comision = 0;
    if (d.cobro.tipo === 'cuenta_corriente') {
      if (!cli.rows[0].cc) throw new ErrorDeUsuario('La categoría de este cliente no tiene cuenta corriente habilitada');
    } else {
      const m = await c.query<{ id: string; comision_pct: string; iva_comision: string }>(
        `SELECT m.id, m.comision_pct::text, m.iva_comision::text FROM medios_pago m
          WHERE m.id = $1 AND m.activo AND EXISTS (SELECT 1 FROM medio_pago_cajas x WHERE x.medio_id = m.id AND x.caja_id = $2)`,
        [d.cobro.medioPagoId, d.cobro.cajaId]);
      if (!m.rows[0]) throw new ErrorDeUsuario('Ese medio de pago no está habilitado para esa caja');
      medio = m.rows[0];
      cajaDestino = await cajaEn(c, s, d.cobro.cajaId);
      if (!cajaDestino.turnoId) throw new ErrorDeUsuario(`La caja ${cajaDestino.nombre} está cerrada: abrila para cobrar`);
      comision = comisionDeCobro(calc.total, Number(medio.comision_pct), Number(medio.iva_comision));
    }

    const numero = await siguienteNumero(c);
    const vr = await c.query<{ id: string }>(
      `INSERT INTO ventas (tenant_id, numero, estado, clave, cliente_id, comprobante, nro_comprobante, lista_id, fecha, descuento_pct, subtotal, descuento_total,
                           total, iva_incluido, en_cuenta_corriente, medio_pago_id, caja_id, comision, nota, usuario_id)
       VALUES (app.tenant_id(), $1, 'cerrada', $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
      [numero, d.clave, d.clienteId, d.comprobante, d.nroComprobante, d.listaId, d.fecha, descuentoPctGuardado, deCentavos(calc.subtotal), deCentavos(calc.descuentoTotal),
       deCentavos(calc.total), deCentavos(calc.ivaIncluido), d.cobro.tipo === 'cuenta_corriente', medio?.id ?? null, cajaDestino?.id ?? null, deCentavos(comision), d.nota, s.usuarioId],
    );
    const ventaId = vr.rows[0]!.id;

    for (const [i, r] of lineas.entries()) {
      const k = calc.renglones[i]!;
      await c.query(
        `INSERT INTO venta_renglones (tenant_id, venta_id, orden, producto_id, descripcion, cantidad, precio, descuento_pct, iva, subtotal, total, iva_incluido)
         VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [ventaId, i + 1, r.productoId, r.descripcion, r.cantidad, r.precio, r.descuentoPct, r.iva, deCentavos(k.subtotal), deCentavos(k.total), deCentavos(k.iva)],
      );
      // El stock baja por cada producto del catálogo (puede quedar negativo; se avisa abajo).
      if (r.productoId) {
        await c.query(
          `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id, venta_id)
           VALUES (app.tenant_id(), $1, 'venta', $2, $3, $4, $5)`,
          [r.productoId, '-' + r.cantidad, `Venta N° ${numero}`, s.usuarioId, ventaId],
        );
      }
    }

    if (cajaDestino) {
      const fecha = d.fecha;
      await c.query(
        `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, venta_id, fecha)
         VALUES (app.tenant_id(), $1, $2, 'cobro_venta', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [cajaDestino.id, cajaDestino.turnoId, deCentavos(calc.total), `Venta N° ${numero}`, s.usuarioId, ventaId, fecha],
      );
      if (comision > 0) {
        await c.query(
          `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, venta_id, fecha)
           VALUES (app.tenant_id(), $1, $2, 'comision_venta', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
          [cajaDestino.id, cajaDestino.turnoId, deCentavos(-comision), `Comisión venta N° ${numero}`, s.usuarioId, ventaId, fecha],
        );
      }
    } else if (calc.total > 0) {
      await c.query(
        `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, concepto, usuario_id, venta_id)
         VALUES (app.tenant_id(), $1, 'venta', $2, $3, $4, $5)`,
        [d.clienteId, deCentavos(calc.total), `Venta N° ${numero}`, s.usuarioId, ventaId],
      );
    }

    const neg = ids.length
      ? await c.query<{ nombre: string }>(
          `SELECT p.nombre FROM productos p WHERE p.id = ANY($1::uuid[])
             AND (SELECT COALESCE(sum(sm.cantidad), 0) FROM stock_movimientos sm WHERE sm.producto_id = p.id) < 0 ORDER BY lower(p.nombre)`, [ids])
      : { rows: [] as { nombre: string }[] };

    await auditar(c, s.usuarioId, 'cerrar', 'venta', { numero, cliente: d.clienteId, total: deCentavos(calc.total), comprobante: d.comprobante, cobro: d.cobro.tipo }, { entidadId: ventaId });
    return { id: ventaId, numero, total: deCentavos(calc.total), comision: deCentavos(comision), avisosStock: neg.rows.map((f) => f.nombre), repetida: false };
  });
}

// ───────── Consultas ─────────
export interface FilaVenta { id: string; numero: number; fecha: Date; cliente: string; comprobante: string; total: string; estado: string; cobro: string }

export async function listarVentas(s: SesionActiva, f: { q?: string; limite?: number } = {}): Promise<FilaVenta[]> {
  exigir(s, 'ventas');
  const params: unknown[] = [];
  const cond = terminosDeBusqueda(f.q ?? '').map((t) => {
    params.push('%' + escaparLike(t) + '%');
    return `unaccent(lower(c.nombre || ' ' || v.numero::text || ' ' || coalesce(v.nro_comprobante,''))) LIKE $${params.length} ESCAPE '\\'`;
  });
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT v.id, v.numero, v.fecha, c.nombre AS cliente, v.comprobante, v.total::text, v.estado,
              CASE WHEN v.en_cuenta_corriente THEN 'Cuenta corriente' ELSE COALESCE(m.nombre, '') || ' · ' || COALESCE(k.nombre, '') END AS cobro
         FROM ventas v JOIN clientes c ON c.id = v.cliente_id LEFT JOIN medios_pago m ON m.id = v.medio_pago_id LEFT JOIN cajas k ON k.id = v.caja_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY v.numero DESC LIMIT ${Math.min(Math.max(f.limite ?? 10, 1), 200)}`,
      params,
    );
    return r.rows.map((x) => ({ id: x.id, numero: x.numero, fecha: x.fecha, cliente: x.cliente, comprobante: x.comprobante, total: x.total, estado: x.estado, cobro: x.cobro }));
  });
}

export interface DetalleVenta extends FilaVenta {
  nroComprobante: string | null; subtotal: string; descuentoTotal: string; descuentoPct: string; ivaIncluido: string; comision: string; nota: string | null; usuario: string | null;
  clienteId: string; lista: string | null; motivoAnulacion: string | null; anuladaEn: Date | null;
  renglones: { descripcion: string; cantidad: string; precio: string; descuentoPct: string; iva: string; total: string; ivaIncluido: string }[];
}

export async function obtenerVenta(s: SesionActiva, id: string): Promise<DetalleVenta | null> {
  exigir(s, 'ventas');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT v.*, v.total::text AS total_t, v.subtotal::text AS subtotal_t, v.descuento_total::text AS dtotal_t, v.descuento_pct::text AS dpct_t, v.iva_incluido::text AS iva_t, v.comision::text AS com_t,
              c.nombre AS cliente, u.nombre AS usuario, l.nombre AS lista,
              CASE WHEN v.en_cuenta_corriente THEN 'Cuenta corriente' ELSE COALESCE(m.nombre, '') || ' · ' || COALESCE(k.nombre, '') END AS cobro
         FROM ventas v JOIN clientes c ON c.id = v.cliente_id LEFT JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN listas_precios l ON l.id = v.lista_id
         LEFT JOIN medios_pago m ON m.id = v.medio_pago_id LEFT JOIN cajas k ON k.id = v.caja_id WHERE v.id = $1`, [id]);
    const f = r.rows[0];
    if (!f) return null;
    const rg = await c.query(
      `SELECT descripcion, cantidad::text, precio::text, descuento_pct::text, iva::text, total::text, iva_incluido::text FROM venta_renglones WHERE venta_id = $1 ORDER BY orden`, [id]);
    return {
      id: f.id, numero: f.numero, fecha: f.fecha, cliente: f.cliente, clienteId: f.cliente_id, comprobante: f.comprobante, total: f.total_t, estado: f.estado, cobro: f.cobro,
      nroComprobante: f.nro_comprobante, subtotal: f.subtotal_t, descuentoTotal: f.dtotal_t, descuentoPct: f.dpct_t, ivaIncluido: f.iva_t, comision: f.com_t, nota: f.nota, usuario: f.usuario, lista: f.lista, motivoAnulacion: f.motivo_anulacion, anuladaEn: f.anulada_en,
      renglones: rg.rows.map((x) => ({ descripcion: x.descripcion, cantidad: x.cantidad, precio: x.precio, descuentoPct: x.descuento_pct, iva: x.iva, total: x.total, ivaIncluido: x.iva_incluido })),
    };
  });
}

// ───────── Anular una venta ─────────
/** Anula una venta cerrada. No borra nada: genera el movimiento inverso de cada movimiento de caja, de stock y de cuenta corriente
 *  que dejó la venta (cada uno referencia al original) y marca la venta como anulada con quién, cuándo y por qué. Todo o nada. */
export async function anularVenta(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'ventas');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La venta no existe');
  await conTenant(s.tenantId, async (c) => {
    const v = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM ventas WHERE id = $1 FOR UPDATE', [id]);
    const venta = v.rows[0];
    if (!venta) throw new ErrorDeUsuario('La venta no existe');
    if (venta.estado === 'anulada') throw new ErrorDeUsuario('La venta ya está anulada');
    if (venta.estado !== 'cerrada') throw new ErrorDeUsuario('Solo se anulan ventas cerradas');
    const concepto = `Anulación venta N° ${venta.numero}`;
    // Una reversión de caja se permite aunque la caja ya esté cerrada (queda en el libro, sin turno).
    await c.query(
      `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, revierte_id, usuario_id, venta_id)
       SELECT app.tenant_id(), caja_id, NULL, 'reversion', -importe, $2, id, $3, venta_id FROM caja_movimientos
        WHERE venta_id = $1 AND tipo IN ('cobro_venta', 'comision_venta')`, [id, concepto, s.usuarioId]);
    await c.query(
      `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, revierte_id, usuario_id, venta_id)
       SELECT app.tenant_id(), producto_id, 'reversion', -cantidad, $2, id, $3, venta_id FROM stock_movimientos
        WHERE venta_id = $1 AND tipo = 'venta'`, [id, concepto, s.usuarioId]);
    await c.query(
      `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, venta_id)
       SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, venta_id FROM cuenta_corriente_movimientos
        WHERE venta_id = $1 AND tipo = 'venta'`, [id, concepto, s.usuarioId]);
    await c.query(`UPDATE ventas SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
    await auditar(c, s.usuarioId, 'anular', 'venta', { numero: venta.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
  });
}
