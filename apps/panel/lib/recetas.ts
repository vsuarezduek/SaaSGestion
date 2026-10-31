// Recetas y elaboración. La receta de un producto lista sus ingredientes (otros productos) para una tanda y cuánto rinde.
// Registrar una elaboración es una sola transacción: suma el producto elaborado, resta los ingredientes (libro de stock)
// y guarda qué se usó. Se anula con movimientos inversos. Costos: ver costosFijos.ts para el costo fijo por unidad.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaElaboracion, primerError } from './validacion.ts';
import { costoFijoDe, costoIngredientesDe } from './costosFijos.ts';
import {
  aCentavos, costoIngredientes, deCentavos, insumoDeElaboracion, normalizarCantidad, precioMantenerUtilidad,
} from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IngredienteReceta { id: string; nombre: string; unidad: string; cantidad: string; costo: string; stock: string; subtotal: string }
export interface ElaboracionReciente { id: string; numero: number; fecha: Date; cantidad: string; estado: string; usuario: string | null; insumos: { nombre: string; cantidad: string }[] }
export interface Receta {
  productoId: string; rinde: string; instrucciones: string; ingredientes: IngredienteReceta[];
  costoIngredientes: string; costoFijo: string; costoFijoActivo: boolean; costoReceta: string; costoActual: string;
  elaboraciones: ElaboracionReciente[];
}

export async function obtenerReceta(s: SesionActiva, productoId: string): Promise<Receta | null> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) return null;
  return conTenant(s.tenantId, async (c) => {
    const p = await c.query<{ rinde: string; instrucciones: string | null; costo: string }>('SELECT rinde::text, instrucciones, costo::text FROM productos WHERE id = $1', [productoId]);
    if (!p.rows[0]) return null;
    const ing = await c.query<{ id: string; nombre: string; unidad: string; cantidad: string; costo: string; stock: string }>(
      `SELECT i.id, i.nombre, i.unidad, ri.cantidad::text AS cantidad, i.costo::text AS costo,
              (SELECT COALESCE(sum(sm.cantidad), 0)::text FROM stock_movimientos sm WHERE sm.producto_id = i.id) AS stock
         FROM receta_ingredientes ri JOIN productos i ON i.id = ri.ingrediente_id WHERE ri.producto_id = $1 ORDER BY ri.orden, lower(i.nombre)`, [productoId]);
    const ingredientes = ing.rows.map((f) => ({ ...f, subtotal: deCentavos(costoIngredientes([{ cantidad: f.cantidad, costo: aCentavos(f.costo) }], '1')) }));
    const ci = ingredientes.length ? await costoIngredientesDe(c, productoId) : 0;
    const fijo = ingredientes.length ? await costoFijoDe(c, productoId, ci) : { activo: false, porUnidad: 0 };
    const el = await c.query<{ id: string; numero: number; fecha: Date; cantidad: string; estado: string; usuario: string | null; insumos: { nombre: string; cantidad: string }[] }>(
      `SELECT e.id, e.numero, e.fecha, e.cantidad::text AS cantidad, e.estado, u.nombre AS usuario,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', x.cantidad::text) ORDER BY x.id)
                          FROM elaboracion_insumos x JOIN productos i ON i.id = x.ingrediente_id WHERE x.elaboracion_id = e.id), '[]'::jsonb) AS insumos
         FROM elaboraciones e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.producto_id = $1 ORDER BY e.fecha DESC, e.numero DESC LIMIT 10`, [productoId]);
    return {
      productoId, rinde: p.rows[0].rinde, instrucciones: p.rows[0].instrucciones ?? '', ingredientes,
      costoIngredientes: deCentavos(ci), costoFijo: deCentavos(fijo.porUnidad), costoFijoActivo: fijo.activo,
      costoReceta: deCentavos(ingredientes.length ? ci + fijo.porUnidad : 0), costoActual: p.rows[0].costo,
      elaboraciones: el.rows,
    };
  });
}

async function productoExiste(c: PoolClient, id: string): Promise<void> {
  if (!UUID.test(id)) throw new ErrorDeUsuario('El producto no existe');
  const r = await c.query('SELECT 1 FROM productos WHERE id = $1', [id]);
  if (r.rowCount === 0) throw new ErrorDeUsuario('El producto no existe');
}

export async function guardarRinde(s: SesionActiva, productoId: string, rinde: string): Promise<void> {
  exigir(s, 'productos');
  const n = normalizarCantidad(String(rinde ?? ''));
  if (n === null || Number(n) <= 0) throw new ErrorDeUsuario('El rendimiento debe ser mayor que cero');
  await conTenant(s.tenantId, async (c) => {
    await productoExiste(c, productoId);
    const a = await c.query<{ rinde: string }>('SELECT rinde::text FROM productos WHERE id = $1', [productoId]);
    await c.query('UPDATE productos SET rinde = $2 WHERE id = $1', [productoId, n]);
    await auditar(c, s.usuarioId, 'modificar', 'receta', { rinde: n }, { entidadId: productoId, antes: { rinde: a.rows[0]!.rinde } });
  });
}

export async function guardarInstrucciones(s: SesionActiva, productoId: string, texto: string): Promise<void> {
  exigir(s, 'productos');
  const t = String(texto ?? '').trim();
  if (t.length > 20000) throw new ErrorDeUsuario('Las instrucciones son demasiado largas');
  await conTenant(s.tenantId, async (c) => {
    await productoExiste(c, productoId);
    await c.query('UPDATE productos SET instrucciones = $2 WHERE id = $1', [productoId, t === '' ? null : t]);
    await auditar(c, s.usuarioId, 'modificar', 'receta', { instrucciones: t.length }, { entidadId: productoId });
  });
}

/** Agrega un ingrediente (cantidad 1) o le suma 1 si ya estaba. No permite recetas circulares. */
export async function agregarIngrediente(s: SesionActiva, productoId: string, ingredienteId: string): Promise<void> {
  exigir(s, 'productos');
  if (productoId === ingredienteId) throw new ErrorDeUsuario('Un producto no puede ser ingrediente de sí mismo');
  await conTenant(s.tenantId, async (c) => {
    await productoExiste(c, productoId);
    await productoExiste(c, ingredienteId);
    // El ingrediente no puede llevar, directa o indirectamente, al producto como ingrediente suyo.
    const ciclo = await c.query(
      `WITH RECURSIVE d AS (SELECT ingrediente_id FROM receta_ingredientes WHERE producto_id = $2
                            UNION SELECT r.ingrediente_id FROM receta_ingredientes r JOIN d ON r.producto_id = d.ingrediente_id)
       SELECT 1 FROM d WHERE ingrediente_id = $1`, [productoId, ingredienteId]);
    if ((ciclo.rowCount ?? 0) > 0) throw new ErrorDeUsuario('Ese producto ya usa a este como ingrediente: la receta quedaría circular');
    const o = await c.query<{ n: number }>('SELECT COALESCE(max(orden), 0) + 1 AS n FROM receta_ingredientes WHERE producto_id = $1', [productoId]);
    await c.query(
      `INSERT INTO receta_ingredientes (tenant_id, producto_id, ingrediente_id, cantidad, orden) VALUES (app.tenant_id(), $1, $2, 1, $3)
       ON CONFLICT (producto_id, ingrediente_id) DO UPDATE SET cantidad = receta_ingredientes.cantidad + 1`, [productoId, ingredienteId, o.rows[0]!.n]);
    await auditar(c, s.usuarioId, 'modificar', 'receta', { agrega: ingredienteId }, { entidadId: productoId });
  });
}

export async function fijarCantidadIngrediente(s: SesionActiva, productoId: string, ingredienteId: string, cantidad: string): Promise<void> {
  exigir(s, 'productos');
  const n = normalizarCantidad(String(cantidad ?? ''));
  if (n === null || Number(n) <= 0) throw new ErrorDeUsuario('La cantidad debe ser mayor que cero');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('UPDATE receta_ingredientes SET cantidad = $3 WHERE producto_id = $1 AND ingrediente_id = $2', [productoId, ingredienteId, n]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('El ingrediente no está en la receta');
    await auditar(c, s.usuarioId, 'modificar', 'receta', { ingrediente: ingredienteId, cantidad: n }, { entidadId: productoId });
  });
}

export async function quitarIngrediente(s: SesionActiva, productoId: string, ingredienteId: string): Promise<void> {
  exigir(s, 'productos');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('DELETE FROM receta_ingredientes WHERE producto_id = $1 AND ingrediente_id = $2', [productoId, ingredienteId]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('El ingrediente no está en la receta');
    await auditar(c, s.usuarioId, 'modificar', 'receta', { quita: ingredienteId }, { entidadId: productoId });
  });
}

/** Pone el costo de la receta como costo del producto; con "mantener utilidad" los precios acompañan al costo. */
export async function aplicarCostoReceta(s: SesionActiva, productoId: string, mantenerUtilidad: boolean): Promise<string> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, async (c) => {
    await productoExiste(c, productoId);
    const ci = await costoIngredientesDe(c, productoId);
    const fijo = await costoFijoDe(c, productoId, ci);
    const nuevo = ci + fijo.porUnidad;
    if (!(nuevo > 0)) throw new ErrorDeUsuario('La receta no tiene costo: cargá ingredientes con costo');
    const a = await c.query<{ costo: string }>('SELECT costo::text FROM productos WHERE id = $1 FOR UPDATE', [productoId]);
    const viejo = aCentavos(a.rows[0]!.costo);
    const precios = await c.query<{ lista_id: string; precio: string }>('SELECT lista_id, precio::text FROM producto_precios WHERE producto_id = $1', [productoId]);
    await c.query('UPDATE productos SET costo = $2 WHERE id = $1', [productoId, deCentavos(nuevo)]);
    const cambios: Record<string, string> = {};
    if (mantenerUtilidad) {
      for (const f of precios.rows) {
        const np = deCentavos(precioMantenerUtilidad(aCentavos(f.precio), viejo, nuevo));
        await c.query('UPDATE producto_precios SET precio = $3 WHERE producto_id = $1 AND lista_id = $2', [productoId, f.lista_id, np]);
        cambios[f.lista_id] = np;
      }
    }
    await auditar(c, s.usuarioId, 'modificar', 'producto', { costoDeReceta: true, costo: deCentavos(nuevo), precios: cambios }, { entidadId: productoId, antes: { costo: a.rows[0]!.costo, precios: Object.fromEntries(precios.rows.map((f) => [f.lista_id, f.precio])) } });
    return deCentavos(nuevo);
  });
}

// ───────── Elaboraciones ─────────
export interface ResultadoElaboracion { id: string; numero: number; repetida: boolean; faltantes: { nombre: string; stock: string }[] }

async function siguienteNumero(c: PoolClient): Promise<number> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(app.tenant_id()::text || ':elaboraciones'))");
  const r = await c.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM elaboraciones');
  return r.rows[0]!.n;
}

/** Vista previa de los insumos para una cantidad (para mostrar antes de registrar). */
export async function previsualizarElaboracion(s: SesionActiva, productoId: string, cantidad: string): Promise<{ nombre: string; usa: string; stock: string; queda: string }[]> {
  exigir(s, 'productos');
  const q = normalizarCantidad(String(cantidad ?? ''));
  if (q === null || Number(q) <= 0 || !UUID.test(productoId)) return [];
  return conTenant(s.tenantId, async (c) => {
    const p = await c.query<{ rinde: string }>('SELECT rinde::text FROM productos WHERE id = $1', [productoId]);
    if (!p.rows[0]) return [];
    const ing = await c.query<{ nombre: string; cantidad: string; stock: string }>(
      `SELECT i.nombre, ri.cantidad::text AS cantidad, (SELECT COALESCE(sum(sm.cantidad), 0)::text FROM stock_movimientos sm WHERE sm.producto_id = i.id) AS stock
         FROM receta_ingredientes ri JOIN productos i ON i.id = ri.ingrediente_id WHERE ri.producto_id = $1 ORDER BY ri.orden`, [productoId]);
    return ing.rows.map((f) => {
      const usa = insumoDeElaboracion(f.cantidad, q, p.rows[0]!.rinde);
      return { nombre: f.nombre, usa, stock: f.stock, queda: (Math.round(Number(f.stock) * 1000 - Number(usa) * 1000) / 1000).toFixed(3) };
    });
  });
}

export async function registrarElaboracion(s: SesionActiva, entrada: unknown): Promise<ResultadoElaboracion> {
  exigir(s, 'productos');
  const v = esquemaElaboracion.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    const previa = await c.query<{ id: string; numero: number }>('SELECT id, numero FROM elaboraciones WHERE clave = $1', [d.clave]);
    if (previa.rows[0]) return { ...previa.rows[0], repetida: true, faltantes: [] };

    const p = await c.query<{ nombre: string; rinde: string }>('SELECT nombre, rinde::text FROM productos WHERE id = $1 AND activo FOR UPDATE', [d.productoId]);
    if (!p.rows[0]) throw new ErrorDeUsuario('El producto no existe o está archivado');
    const ing = await c.query<{ id: string; nombre: string; cantidad: string }>(
      `SELECT i.id, i.nombre, ri.cantidad::text AS cantidad FROM receta_ingredientes ri JOIN productos i ON i.id = ri.ingrediente_id WHERE ri.producto_id = $1 ORDER BY ri.orden, lower(i.nombre)`, [d.productoId]);
    if (ing.rows.length === 0) throw new ErrorDeUsuario('Cargá primero los ingredientes de la receta');
    const usos = ing.rows.map((f) => ({ ...f, usa: insumoDeElaboracion(f.cantidad, d.cantidad, p.rows[0]!.rinde) })).filter((f) => Number(f.usa) > 0);

    const numero = await siguienteNumero(c);
    const r = await c.query<{ id: string }>(
      `INSERT INTO elaboraciones (tenant_id, numero, clave, producto_id, cantidad, fecha, nota, usuario_id)
       VALUES (app.tenant_id(), $1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7) RETURNING id`,
      [numero, d.clave, d.productoId, d.cantidad, d.fecha, d.nota, s.usuarioId]);
    const id = r.rows[0]!.id;
    const concepto = `Elaboración N° ${numero}`;
    await c.query(
      `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id, elaboracion_id)
       VALUES (app.tenant_id(), $1, 'elaboracion', $2, $3, $4, $5)`, [d.productoId, d.cantidad, concepto, s.usuarioId, id]);
    for (const u of usos) {
      await c.query('INSERT INTO elaboracion_insumos (tenant_id, elaboracion_id, ingrediente_id, cantidad) VALUES (app.tenant_id(), $1, $2, $3)', [id, u.id, u.usa]);
      await c.query(
        `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id, elaboracion_id)
         VALUES (app.tenant_id(), $1, 'elaboracion', $2, $3, $4, $5)`, [u.id, '-' + u.usa, concepto, s.usuarioId, id]);
    }
    const faltantes: { nombre: string; stock: string }[] = [];
    for (const u of usos) {
      const st = await c.query<{ s: string }>('SELECT COALESCE(sum(cantidad), 0)::text AS s FROM stock_movimientos WHERE producto_id = $1', [u.id]);
      if (Number(st.rows[0]!.s) < 0) faltantes.push({ nombre: u.nombre, stock: st.rows[0]!.s });
    }
    await auditar(c, s.usuarioId, 'registrar', 'elaboracion', { numero, producto: d.productoId, cantidad: d.cantidad, insumos: usos.map((u) => ({ id: u.id, cantidad: u.usa })) }, { entidadId: id });
    return { id, numero, repetida: false, faltantes };
  });
}

export async function anularElaboracion(s: SesionActiva, id: string, motivo: string): Promise<void> {
  exigir(s, 'productos');
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw new ErrorDeUsuario('Indicá el motivo de la anulación');
  if (m.length > 200) throw new ErrorDeUsuario('El motivo es demasiado largo (máximo 200 caracteres)');
  if (!UUID.test(id)) throw new ErrorDeUsuario('La elaboración no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ numero: number; estado: string }>('SELECT numero, estado FROM elaboraciones WHERE id = $1 FOR UPDATE', [id]);
    const e = r.rows[0];
    if (!e) throw new ErrorDeUsuario('La elaboración no existe');
    if (e.estado === 'anulada') throw new ErrorDeUsuario('La elaboración ya está anulada');
    await c.query(
      `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, revierte_id, usuario_id, elaboracion_id)
       SELECT app.tenant_id(), producto_id, 'reversion', -cantidad, $2, id, $3, elaboracion_id FROM stock_movimientos
        WHERE elaboracion_id = $1 AND tipo = 'elaboracion' ORDER BY id`, [id, `Anulación elaboración N° ${e.numero}`, s.usuarioId]);
    await c.query(`UPDATE elaboraciones SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`, [id, s.usuarioId, m]);
    await auditar(c, s.usuarioId, 'anular', 'elaboracion', { numero: e.numero, motivo: m }, { entidadId: id, antes: { estado: 'cerrada' } });
  });
}

/** Productos para elegir como ingrediente (búsqueda por nombre o código). */
export async function buscarIngredientes(s: SesionActiva, q: string, excluirId: string): Promise<{ id: string; nombre: string; costo: string; stock: string }[]> {
  exigir(s, 'productos');
  const t = String(q ?? '').trim();
  if (t.length < 2) return [];
  const r = await conTenant(s.tenantId, (c) => c.query<{ id: string; nombre: string; costo: string; stock: string }>(
    `SELECT p.id, p.nombre, p.costo::text AS costo, (SELECT COALESCE(sum(sm.cantidad), 0)::text FROM stock_movimientos sm WHERE sm.producto_id = p.id) AS stock
       FROM productos p WHERE p.activo AND p.id <> $2 AND unaccent(lower(p.nombre || ' ' || coalesce(p.codigo, ''))) LIKE '%' || unaccent(lower($1)) || '%' ORDER BY lower(p.nombre) LIMIT 8`,
    [t.replace(/[%_\\]/g, ''), UUID.test(excluirId) ? excluirId : '00000000-0000-0000-0000-000000000000']));
  return r.rows;
}
