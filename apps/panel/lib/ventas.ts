// Ventas: cerrar una venta genera, en una sola transacción, la venta con sus renglones, el cobro en caja (más la comisión)
// o el movimiento de cuenta corriente, y el descuento de stock. Si algo falla, no queda nada a medias.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { cajaEn } from './cajas.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaMedioPago, esquemaNotaCredito, esquemaVenta, primerError, type Borrador } from './validacion.ts';
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

    // Si sale de una venta abierta, se bloquea para que dos personas no la cierren a la vez.
    if (d.abiertaId) {
      const ab = await c.query<{ estado: string }>('SELECT estado FROM ventas_abiertas WHERE id = $1 FOR UPDATE', [d.abiertaId]);
      if (!ab.rows[0]) throw new ErrorDeUsuario('La venta abierta no existe');
      if (ab.rows[0].estado !== 'abierta') throw new ErrorDeUsuario('Esa venta abierta ya fue cerrada o descartada por otra persona');
    }

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
    // Edición de una venta cerrada: la vieja se anula (con sus movimientos inversos) y esta la reemplaza, en la misma transacción.
    let reemplazada: number | null = null;
    if (d.reemplazaVentaId) {
      const ant = await c.query<{ numero: number }>('SELECT numero FROM ventas WHERE id = $1', [d.reemplazaVentaId]);
      if (!ant.rows[0]) throw new ErrorDeUsuario('La venta que se quiere editar no existe');
      reemplazada = ant.rows[0].numero;
      await anularEnTransaccion(c, s, d.reemplazaVentaId, `Modificada: reemplazada por la venta N° ${numero}`);
    }
    const vr = await c.query<{ id: string }>(
      `INSERT INTO ventas (tenant_id, numero, estado, clave, cliente_id, comprobante, nro_comprobante, lista_id, fecha, descuento_pct, subtotal, descuento_total,
                           total, iva_incluido, en_cuenta_corriente, medio_pago_id, caja_id, comision, nota, usuario_id)
       VALUES (app.tenant_id(), $1, 'cerrada', $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
      [numero, d.clave, d.clienteId, d.comprobante, d.nroComprobante, d.listaId, d.fecha, descuentoPctGuardado, deCentavos(calc.subtotal), deCentavos(calc.descuentoTotal),
       deCentavos(calc.total), deCentavos(calc.ivaIncluido), d.cobro.tipo === 'cuenta_corriente', medio?.id ?? null, cajaDestino?.id ?? null, deCentavos(comision), d.nota, s.usuarioId],
    );
    const ventaId = vr.rows[0]!.id;
    if (d.abiertaId) {
      await c.query(`UPDATE ventas_abiertas SET estado = 'cerrada', venta_id = $2, cerrada_en = now(), modificada_por = $3, modificado_en = now() WHERE id = $1`, [d.abiertaId, ventaId, s.usuarioId]);
    }

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

    if (cajaDestino && calc.total > 0) { // una venta de $0 (todo descontado) no mueve la caja
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

    await auditar(c, s.usuarioId, 'cerrar', 'venta', { numero, cliente: d.clienteId, total: deCentavos(calc.total), comprobante: d.comprobante, cobro: d.cobro.tipo, reemplaza: reemplazada }, { entidadId: ventaId });
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
  origen: { id: string; numero: number } | null; notasCredito: { id: string; numero: number; total: string }[];
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
    const origen = f.venta_origen_id ? (await c.query<{ id: string; numero: number }>('SELECT id, numero FROM ventas WHERE id = $1', [f.venta_origen_id])).rows[0] ?? null : null;
    const ncs = await c.query<{ id: string; numero: number; total: string }>("SELECT id, numero, total::text FROM ventas WHERE venta_origen_id = $1 AND estado = 'cerrada' ORDER BY numero", [id]);
    return {
      origen, notasCredito: ncs.rows,
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
  await conTenant(s.tenantId, (c) => anularEnTransaccion(c, s, id, m));
}

/** El cuerpo de la anulación, para poder hacerla dentro de otra transacción (editar una venta = anular la vieja + crear la nueva, todo o nada). */
async function anularEnTransaccion(c: PoolClient, s: SesionActiva, id: string, m: string): Promise<void> {
  const v = await c.query<{ numero: number; estado: string; comprobante: string }>('SELECT numero, estado, comprobante FROM ventas WHERE id = $1 FOR UPDATE', [id]);
  const venta = v.rows[0];
  if (!venta) throw new ErrorDeUsuario('La venta no existe');
  if (venta.estado === 'anulada') throw new ErrorDeUsuario('La venta ya está anulada');
  if (venta.estado !== 'cerrada') throw new ErrorDeUsuario('Solo se anulan ventas cerradas');
  const esNota = venta.comprobante === 'nota_credito';
  if (!esNota) {
    const nc = await c.query<{ numero: number }>("SELECT numero FROM ventas WHERE venta_origen_id = $1 AND estado = 'cerrada' ORDER BY numero LIMIT 1", [id]);
    if (nc.rows[0]) throw new ErrorDeUsuario(`Esta venta tiene la nota de crédito N° ${nc.rows[0].numero}: anulala primero`);
  }
  const concepto = `${esNota ? 'Anulación nota de crédito' : 'Anulación venta'} N° ${venta.numero}`;
  // Una reversión de caja se permite aunque la caja ya esté cerrada (queda en el libro, sin turno).
  await c.query(
    `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, revierte_id, usuario_id, venta_id)
     SELECT app.tenant_id(), caja_id, NULL, 'reversion', -importe, $2, id, $3, venta_id FROM caja_movimientos
      WHERE venta_id = $1 AND tipo IN ('cobro_venta', 'comision_venta', 'devolucion_venta') ORDER BY id`, [id, concepto, s.usuarioId]);
  await c.query(
    `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, revierte_id, usuario_id, venta_id)
     SELECT app.tenant_id(), producto_id, 'reversion', -cantidad, $2, id, $3, venta_id FROM stock_movimientos
      WHERE venta_id = $1 AND tipo IN ('venta', 'devolucion_venta') ORDER BY id`, [id, concepto, s.usuarioId]);
  await c.query(
    `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id, venta_id)
     SELECT app.tenant_id(), cliente_id, proveedor_id, 'reversion', -importe, $2, id, $3, venta_id FROM cuenta_corriente_movimientos
      WHERE venta_id = $1 AND tipo IN ('venta', 'nota_credito') ORDER BY id`, [id, concepto, s.usuarioId]);
  await c.query(`UPDATE ventas SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
  await auditar(c, s.usuarioId, 'anular', esNota ? 'nota_credito' : 'venta', { numero: venta.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
}

// ───────── Nota de crédito (devolución de una venta) ─────────
export interface DatosParaNotaCredito {
  venta: { id: string; numero: number; clienteId: string; cliente: string; descuentoPct: string; total: string };
  renglones: { id: string; descripcion: string; cantidad: string; disponible: string; precio: string; descuentoPct: string; iva: string }[];
  /** true si ya se devolvió algo de esta venta (la devolución total exacta solo vale la primera vez). */
  conDevoluciones: boolean;
  cuentaCorriente: boolean;
}

/** Lo que hace falta para armar la nota de crédito de una venta cerrada: sus renglones con lo que todavía se puede devolver. */
export async function datosParaNotaCredito(s: SesionActiva, ventaId: string): Promise<DatosParaNotaCredito | null> {
  exigir(s, 'ventas');
  if (!UUID.test(ventaId)) return null;
  return conTenant(s.tenantId, async (c) => {
    const v = await c.query(
      `SELECT v.id, v.numero, v.cliente_id, c.nombre AS cliente, v.descuento_pct::text, v.total::text, COALESCE(k.cuenta_corriente, false) AS cc, c.es_consumidor_final AS cf
         FROM ventas v JOIN clientes c ON c.id = v.cliente_id LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id
        WHERE v.id = $1 AND v.estado = 'cerrada' AND v.comprobante <> 'nota_credito'`, [ventaId]);
    const f = v.rows[0];
    if (!f) return null;
    const r = await c.query(
      `SELECT r.id::text, r.descripcion, r.cantidad::text, r.precio::text, r.descuento_pct::text, r.iva::text,
              (r.cantidad - COALESCE((SELECT sum(x.cantidad) FROM venta_renglones x JOIN ventas nv ON nv.id = x.venta_id AND nv.estado = 'cerrada' WHERE x.renglon_origen_id = r.id), 0))::text AS disponible
         FROM venta_renglones r WHERE r.venta_id = $1 ORDER BY r.orden`, [ventaId]);
    const renglones = r.rows.map((x) => ({ id: x.id, descripcion: x.descripcion, cantidad: x.cantidad, disponible: x.disponible, precio: x.precio, descuentoPct: x.descuento_pct, iva: x.iva }));
    return {
      venta: { id: f.id, numero: f.numero, clienteId: f.cliente_id, cliente: f.cliente, descuentoPct: f.descuento_pct, total: f.total },
      renglones, conDevoluciones: renglones.some((x) => Number(x.disponible) !== Number(x.cantidad)), cuentaCorriente: f.cc && !f.cf,
    };
  });
}

export interface ResultadoNotaCredito { id: string; numero: number; total: string; repetida: boolean }
const milesimas = (n: string) => Math.round(Number(n) * 1000);

/** Emite la nota de crédito de una venta cerrada: devuelve stock, devuelve la plata (caja, sin comisión) o baja la deuda del cliente.
 *  Los precios, descuentos e IVA salen de la venta original. No se puede devolver más de lo vendido (descontando devoluciones anteriores). */
export async function emitirNotaCredito(s: SesionActiva, entrada: unknown): Promise<ResultadoNotaCredito> {
  exigir(s, 'ventas');
  const v = esquemaNotaCredito.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  if (new Set(d.renglones.map((r) => r.renglonOrigenId)).size !== d.renglones.length) throw new ErrorDeUsuario('Un producto está repetido en la devolución');
  return conTenant(s.tenantId, async (c) => {
    const previa = await c.query<{ id: string; numero: number; total: string }>('SELECT id, numero, total::text FROM ventas WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], repetida: true };

    // Se bloquea la venta de origen: dos devoluciones a la vez no pueden pasarse del total vendido.
    const o = await c.query<{ id: string; numero: number; estado: string; comprobante: string; cliente_id: string; descuento_pct: string; total: string }>(
      'SELECT id, numero, estado, comprobante, cliente_id, descuento_pct::text, total::text FROM ventas WHERE id = $1 FOR UPDATE', [d.ventaOrigenId]);
    const origen = o.rows[0];
    if (!origen) throw new ErrorDeUsuario('La venta de origen no existe');
    if (origen.estado !== 'cerrada') throw new ErrorDeUsuario('Solo se hace nota de crédito de ventas cerradas (no anuladas)');
    if (origen.comprobante === 'nota_credito') throw new ErrorDeUsuario('No se hace una nota de crédito de otra nota de crédito');

    const rg = await c.query<{ id: string; orden: number; producto_id: string | null; descripcion: string; cantidad: string; precio: string; descuento_pct: string; iva: string; disponible: string }>(
      `SELECT r.id::text, r.orden, r.producto_id, r.descripcion, r.cantidad::text, r.precio::text, r.descuento_pct::text, r.iva::text,
              (r.cantidad - COALESCE((SELECT sum(x.cantidad) FROM venta_renglones x JOIN ventas nv ON nv.id = x.venta_id AND nv.estado = 'cerrada' WHERE x.renglon_origen_id = r.id), 0))::text AS disponible
         FROM venta_renglones r WHERE r.venta_id = $1 ORDER BY r.orden`, [origen.id]);
    const porId = new Map(rg.rows.map((x) => [x.id, x]));
    const lineas = d.renglones.map((r) => {
      const o2 = porId.get(r.renglonOrigenId);
      if (!o2) throw new ErrorDeUsuario('Un renglón no pertenece a esa venta');
      if (milesimas(r.cantidad) > milesimas(o2.disponible)) {
        throw new ErrorDeUsuario(`No se puede devolver más de lo vendido: de "${o2.descripcion}" quedan ${o2.disponible} por devolver`);
      }
      return { ...o2, devuelve: r.cantidad };
    });

    const cli = await c.query<{ cc: boolean | null; cf: boolean }>(
      `SELECT k.cuenta_corriente AS cc, c.es_consumidor_final AS cf FROM clientes c LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id WHERE c.id = $1`, [origen.cliente_id]);

    // Devolución total y exacta (todo lo vendido, sin devoluciones previas): se devuelve exactamente lo cobrado, sin diferencias de centavos por redondeo del descuento.
    const esTotal = lineas.length === rg.rows.length && lineas.every((l) => milesimas(l.devuelve) === milesimas(l.cantidad) && milesimas(l.disponible) === milesimas(l.cantidad));
    const calc = calcularVenta(
      lineas.map((l) => ({ cantidad: l.devuelve, precio: aCentavos(l.precio), descuentoPct: Number(l.descuento_pct), iva: Number(l.iva) })),
      esTotal ? { totalFinal: aCentavos(origen.total) } : Number(origen.descuento_pct),
    );

    let cajaDestino: Awaited<ReturnType<typeof cajaEn>> | null = null;
    let medioId: string | null = null;
    if (d.cobro.tipo === 'cuenta_corriente') {
      if (!cli.rows[0]?.cc || cli.rows[0].cf) throw new ErrorDeUsuario('La categoría de este cliente no tiene cuenta corriente habilitada');
    } else {
      const m = await c.query<{ id: string }>(
        `SELECT m.id FROM medios_pago m WHERE m.id = $1 AND m.activo AND EXISTS (SELECT 1 FROM medio_pago_cajas x WHERE x.medio_id = m.id AND x.caja_id = $2)`,
        [d.cobro.medioPagoId, d.cobro.cajaId]);
      if (!m.rows[0]) throw new ErrorDeUsuario('Ese medio de pago no está habilitado para esa caja');
      medioId = m.rows[0].id;
      cajaDestino = await cajaEn(c, s, d.cobro.cajaId);
      if (!cajaDestino.turnoId) throw new ErrorDeUsuario(`La caja ${cajaDestino.nombre} está cerrada: abrila para devolver el dinero`);
    }

    const numero = await siguienteNumero(c);
    const pct = calc.subtotal > 0 ? Math.round((calc.descuentoTotal / calc.subtotal) * 10000) / 100 : 0;
    const vr = await c.query<{ id: string }>(
      `INSERT INTO ventas (tenant_id, numero, estado, clave, cliente_id, comprobante, fecha, descuento_pct, subtotal, descuento_total, total, iva_incluido,
                           en_cuenta_corriente, medio_pago_id, caja_id, comision, nota, usuario_id, venta_origen_id)
       VALUES (app.tenant_id(), $1, 'cerrada', $2, $3, 'nota_credito', COALESCE($4::timestamptz, now()), $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14, $15) RETURNING id`,
      [numero, d.clave, origen.cliente_id, d.fecha, pct, deCentavos(calc.subtotal), deCentavos(calc.descuentoTotal), deCentavos(calc.total), deCentavos(calc.ivaIncluido),
       d.cobro.tipo === 'cuenta_corriente', medioId, cajaDestino?.id ?? null, d.nota, s.usuarioId, origen.id],
    );
    const ncId = vr.rows[0]!.id;
    for (const [i, l] of lineas.entries()) {
      const k = calc.renglones[i]!;
      await c.query(
        `INSERT INTO venta_renglones (tenant_id, venta_id, orden, producto_id, descripcion, cantidad, precio, descuento_pct, iva, subtotal, total, iva_incluido, renglon_origen_id)
         VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [ncId, i + 1, l.producto_id, l.descripcion, l.devuelve, l.precio, l.descuento_pct, l.iva, deCentavos(k.subtotal), deCentavos(k.total), deCentavos(k.iva), l.id],
      );
      if (l.producto_id) {
        await c.query(
          `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id, venta_id)
           VALUES (app.tenant_id(), $1, 'devolucion_venta', $2, $3, $4, $5)`,
          [l.producto_id, l.devuelve, `Nota de crédito N° ${numero}`, s.usuarioId, ncId],
        );
      }
    }
    if (calc.total > 0) { // una nota de $0 no mueve plata
      if (cajaDestino) {
        await c.query(
          `INSERT INTO caja_movimientos (tenant_id, caja_id, turno_id, tipo, importe, concepto, usuario_id, venta_id, fecha)
           VALUES (app.tenant_id(), $1, $2, 'devolucion_venta', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
          [cajaDestino.id, cajaDestino.turnoId, deCentavos(-calc.total), `Nota de crédito N° ${numero} (venta N° ${origen.numero})`, s.usuarioId, ncId, d.fecha],
        );
      } else {
        await c.query(
          `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, tipo, importe, concepto, usuario_id, venta_id)
           VALUES (app.tenant_id(), $1, 'nota_credito', $2, $3, $4, $5)`,
          [origen.cliente_id, deCentavos(-calc.total), `Nota de crédito N° ${numero} (venta N° ${origen.numero})`, s.usuarioId, ncId],
        );
      }
    }
    await auditar(c, s.usuarioId, 'emitir', 'nota_credito', { numero, origen: origen.numero, total: deCentavos(calc.total), cobro: d.cobro.tipo }, { entidadId: ncId });
    return { id: ncId, numero, total: deCentavos(calc.total), repetida: false };
  });
}

// ───────── Editar una venta cerrada ─────────
export interface DatosParaEditar { numero: number; datos: Borrador; cliente: ClienteParaVenta }

const ARG = (f: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(f).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

/** Arma el formulario de venta con los datos de una venta cerrada, para corregirla. Al cerrarlo, la original se anula y la nueva la reemplaza. */
export async function datosParaEditar(s: SesionActiva, ventaId: string): Promise<DatosParaEditar | null> {
  exigir(s, 'ventas');
  if (!UUID.test(ventaId)) return null;
  return conTenant(s.tenantId, async (c) => {
    const v = await c.query(
      `SELECT v.*, v.total::text AS total_t, v.descuento_pct::text AS dpct_t FROM ventas v
        WHERE v.id = $1 AND v.estado = 'cerrada' AND v.comprobante <> 'nota_credito'
          AND NOT EXISTS (SELECT 1 FROM ventas n WHERE n.venta_origen_id = v.id AND n.estado = 'cerrada')`, [ventaId]);
    const f = v.rows[0];
    if (!f) return null;
    const rg = await c.query(
      `SELECT r.producto_id, r.descripcion, r.cantidad::text, r.precio::text, r.descuento_pct::text, r.iva::text,
              (SELECT COALESCE(sum(sm.cantidad), 0) FROM stock_movimientos sm WHERE sm.producto_id = r.producto_id)::numeric(14,3)::text AS stock
         FROM venta_renglones r WHERE r.venta_id = $1 ORDER BY r.orden`, [ventaId]);
    const cl = await c.query(
      `SELECT c.id, c.nombre, c.es_consumidor_final, k.lista_id, COALESCE(k.descuento, 0)::text AS descuento, COALESCE(k.cuenta_corriente, false) AS cc,
              COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.cliente_id = c.id), 0)::numeric(14,2)::text AS saldo
         FROM clientes c LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id WHERE c.id = $1`, [f.cliente_id]);
    const x = cl.rows[0];
    if (!x) return null;
    const pct = String(Number(f.dpct_t));
    const datos: Borrador = {
      clienteId: f.cliente_id, comprobante: f.comprobante, nroComprobante: f.nro_comprobante ?? '', listaId: f.lista_id, fecha: ARG(f.fecha),
      modoDesc: 'pct', descTotal: pct, totalFinal: '', cobroTipo: f.en_cuenta_corriente ? 'cuenta_corriente' : 'caja',
      medioId: f.medio_pago_id ?? '', cajaId: f.caja_id ?? '', nota: f.nota ?? '', total: f.total_t, pedido: false, entrega: '',
      // Al anular la original, lo vendido vuelve al stock: el aviso de stock negativo se calcula con eso ya devuelto.
      renglones: rg.rows.map((r) => ({
        productoId: r.producto_id, descripcion: r.descripcion, cantidad: r.cantidad, precio: r.precio, descuentoPct: String(Number(r.descuento_pct)), iva: Number(r.iva),
        stock: r.producto_id ? String(Number(r.stock) + Number(r.cantidad)) : null,
      })),
    };
    const cliente: ClienteParaVenta = { id: x.id, nombre: x.nombre, saldo: x.saldo, listaId: x.lista_id, descuento: Number(x.descuento), cuentaCorriente: x.cc && !x.es_consumidor_final, esConsumidorFinal: x.es_consumidor_final };
    return { numero: f.numero, datos, cliente };
  });
}

/** Nombre del comercio, para los comprobantes. */
export async function nombreDelComercio(s: SesionActiva): Promise<string> {
  return conTenant(s.tenantId, async (c) => (await c.query<{ nombre: string }>('SELECT nombre FROM tenants WHERE id = app.tenant_id()')).rows[0]?.nombre ?? s.comercio);
}
