// Catálogo: rubros, listas de precios y productos. Toda consulta pasa por conTenant (comercio + Row Level Security)
// y verifica el permiso en el servidor.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaProducto, esquemaRubro, primerError, type DatosProducto } from './validacion.ts';
import { escaparLike, terminosDeBusqueda } from '../../../packages/dominio/src/index.ts';

// ───────── Listas de precios ─────────
export interface Lista {
  id: string;
  nombre: string;
}

const LISTAS_INICIALES = ['Minorista', 'Mayorista'];

async function listasEn(c: PoolClient): Promise<Lista[]> {
  const r = await c.query<Lista>('SELECT id, nombre FROM listas_precios WHERE activa ORDER BY orden, nombre');
  if (r.rows.length > 0) return r.rows;
  // Primer uso del comercio: se crean las listas básicas (después se pueden renombrar o agregar).
  for (const [i, nombre] of LISTAS_INICIALES.entries()) {
    await c.query('INSERT INTO listas_precios (tenant_id, nombre, orden) VALUES (app.tenant_id(), $1, $2)', [nombre, i + 1]);
  }
  return (await c.query<Lista>('SELECT id, nombre FROM listas_precios WHERE activa ORDER BY orden, nombre')).rows;
}

export function listasDePrecios(s: SesionActiva): Promise<Lista[]> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, listasEn);
}

// ───────── Rubros ─────────
export interface Rubro {
  id: string;
  nombre: string;
  padreId: string | null;
  activo: boolean;
  ruta: string;
  nivel: number;
  productos: number;
}

export async function listarRubros(s: SesionActiva): Promise<Rubro[]> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ id: string; nombre: string; padre_id: string | null; activo: boolean; ruta: string; nivel: number; productos: string }>(
      `WITH RECURSIVE arbol AS (
         SELECT id, nombre, padre_id, activo, nombre::text AS ruta, 0 AS nivel, lower(nombre)::text AS orden
           FROM rubros WHERE padre_id IS NULL
         UNION ALL
         SELECT r.id, r.nombre, r.padre_id, r.activo, a.ruta || ' › ' || r.nombre, a.nivel + 1, a.orden || '/' || lower(r.nombre)
           FROM rubros r JOIN arbol a ON r.padre_id = a.id)
       SELECT a.id, a.nombre, a.padre_id, a.activo, a.ruta, a.nivel,
              (SELECT count(*) FROM productos p WHERE p.rubro_id = a.id AND p.activo)::text AS productos
         FROM arbol a ORDER BY a.orden`,
    );
    return r.rows.map((f) => ({
      id: f.id, nombre: f.nombre, padreId: f.padre_id, activo: f.activo, ruta: f.ruta, nivel: f.nivel, productos: Number(f.productos),
    }));
  });
}

function mapearErrorRubro(e: unknown): never {
  const codigo = (e as { code?: string }).code;
  if (codigo === '23505') throw new ErrorDeUsuario('Ya hay un rubro con ese nombre en ese lugar');
  if (codigo === '23503') throw new ErrorDeUsuario('El rubro de origen no existe');
  throw e;
}

export async function crearRubro(s: SesionActiva, entrada: { nombre: string; padreId: string | null }): Promise<string> {
  exigir(s, 'productos');
  const v = esquemaRubro.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  try {
    return await conTenant(s.tenantId, async (c) => {
      const r = await c.query<{ id: string }>('INSERT INTO rubros (tenant_id, nombre, padre_id) VALUES (app.tenant_id(), $1, $2) RETURNING id', [
        v.data.nombre,
        v.data.padreId,
      ]);
      const id = r.rows[0]!.id;
      await auditar(c, s.usuarioId, 'crear', 'rubro', v.data, { entidadId: id });
      return id;
    });
  } catch (e) {
    return mapearErrorRubro(e);
  }
}

export async function renombrarRubro(s: SesionActiva, id: string, nombre: string): Promise<void> {
  exigir(s, 'productos');
  const v = esquemaRubro.shape.nombre.safeParse(nombre);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  try {
    await conTenant(s.tenantId, async (c) => {
      const antes = await c.query<{ nombre: string }>('SELECT nombre FROM rubros WHERE id = $1', [id]);
      if (!antes.rows[0]) throw new ErrorDeUsuario('El rubro no existe');
      await c.query('UPDATE rubros SET nombre = $2 WHERE id = $1', [id, v.data]);
      await auditar(c, s.usuarioId, 'modificar', 'rubro', { nombre: v.data }, { entidadId: id, antes: antes.rows[0] });
    });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) throw e;
    mapearErrorRubro(e);
  }
}

export async function archivarRubro(s: SesionActiva, id: string, activo: boolean): Promise<void> {
  exigir(s, 'productos');
  await conTenant(s.tenantId, async (c) => {
    if (!activo) {
      const uso = await c.query<{ n: string }>(
        `SELECT ((SELECT count(*) FROM productos WHERE rubro_id = $1 AND activo) + (SELECT count(*) FROM rubros WHERE padre_id = $1 AND activo))::text AS n`,
        [id],
      );
      if (Number(uso.rows[0]!.n) > 0) throw new ErrorDeUsuario('El rubro tiene productos o subrubros activos: movelos o archivalos antes');
    }
    const r = await c.query('UPDATE rubros SET activo = $2 WHERE id = $1', [id, activo]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('El rubro no existe');
    await auditar(c, s.usuarioId, activo ? 'restaurar' : 'archivar', 'rubro', undefined, { entidadId: id });
  });
}

// ───────── Productos ─────────
export interface FiltroProductos {
  q?: string;
  rubroId?: string;
  tipo?: string;
  estado?: 'activos' | 'archivados' | 'todos';
  alerta?: 'negativo' | 'bajo_minimo';
  limite?: number;
}

export interface FilaProducto {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string | null;
  unidad: string;
  costo: string;
  iva: string;
  activo: boolean;
  rubro: string | null;
  precios: Record<string, string>;
  stock: string;
  stockMinimo: string;
}

/** Stock actual = suma del libro de movimientos (nunca un número guardado). */
const STOCK_SQL = '(SELECT COALESCE(sum(sm.cantidad), 0) FROM stock_movimientos sm WHERE sm.producto_id = p.id)';

export async function listarProductos(s: SesionActiva, f: FiltroProductos = {}): Promise<{ filas: FilaProducto[]; total: number }> {
  exigir(s, 'productos');
  const params: unknown[] = [];
  const cond: string[] = [];
  const p = (valor: unknown): string => {
    params.push(valor);
    return `$${params.length}`;
  };
  const estado = f.estado ?? 'activos';
  if (estado === 'activos') cond.push('p.activo');
  if (estado === 'archivados') cond.push('NOT p.activo');
  for (const t of terminosDeBusqueda(f.q ?? '')) {
    cond.push(`unaccent(lower(p.nombre || ' ' || coalesce(p.codigo, '') || ' ' || coalesce(p.tipo, ''))) LIKE ${p('%' + escaparLike(t) + '%')} ESCAPE '\\'`);
  }
  if (f.rubroId) {
    cond.push(`p.rubro_id IN (WITH RECURSIVE d AS (SELECT id FROM rubros WHERE id = ${p(f.rubroId)}::uuid UNION ALL SELECT x.id FROM rubros x JOIN d ON x.padre_id = d.id) SELECT id FROM d)`);
  }
  if (f.tipo) cond.push(`p.tipo = ${p(f.tipo)}`);
  if (f.alerta === 'negativo') cond.push(`${STOCK_SQL} < 0`);
  if (f.alerta === 'bajo_minimo') cond.push(`(p.stock_minimo > 0 AND ${STOCK_SQL} >= 0 AND ${STOCK_SQL} < p.stock_minimo)`);
  const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const limite = Math.min(Math.max(f.limite ?? 50, 1), 500);

  return conTenant(s.tenantId, async (c) => {
    const total = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM productos p ${donde}`, params);
    const r = await c.query<{
      id: string; codigo: string | null; nombre: string; tipo: string | null; unidad: string; costo: string; iva: string;
      activo: boolean; rubro: string | null; precios: Record<string, string>; stock: string; stock_minimo: string;
    }>(
      `SELECT p.id, p.codigo, p.nombre, p.tipo, p.unidad, p.costo::text AS costo, p.iva::text AS iva, p.activo, r.nombre AS rubro, ${STOCK_SQL}::text AS stock, p.stock_minimo::text AS stock_minimo,
              COALESCE((SELECT jsonb_object_agg(pp.lista_id, pp.precio::text) FROM producto_precios pp WHERE pp.producto_id = p.id), '{}'::jsonb) AS precios
         FROM productos p LEFT JOIN rubros r ON r.tenant_id = p.tenant_id AND r.id = p.rubro_id
         ${donde} ORDER BY lower(p.nombre), p.id LIMIT ${limite}`,
      params,
    );
    return { filas: r.rows.map(({ stock_minimo, ...f }) => ({ ...f, stockMinimo: stock_minimo })), total: Number(total.rows[0]!.n) };
  });
}

export interface DetalleProducto {
  id: string;
  codigo: string | null;
  nombre: string;
  rubroId: string | null;
  tipo: string | null;
  unidad: string;
  costo: string;
  iva: number;
  vendible: boolean;
  comprable: boolean;
  integrable: boolean;
  publicadoWeb: boolean;
  urlWeb: string | null;
  activo: boolean;
  precios: Record<string, string>;
  stock: string;
  stockMinimo: string;
  stockIdeal: string;
}

async function detalleEn(c: PoolClient, id: string): Promise<DetalleProducto | null> {
  const r = await c.query<{
    id: string; codigo: string | null; nombre: string; rubro_id: string | null; tipo: string | null; unidad: string; costo: string; iva: string;
    vendible: boolean; comprable: boolean; integrable: boolean; publicado_web: boolean; url_web: string | null; activo: boolean; precios: Record<string, string>; stock: string; stock_minimo: string; stock_ideal: string;
  }>(
    `SELECT p.id, p.codigo, p.nombre, p.rubro_id, p.tipo, p.unidad, p.costo::text AS costo, p.iva::text AS iva, p.vendible, p.comprable,
            p.integrable, p.publicado_web, p.url_web, p.activo, ${STOCK_SQL}::text AS stock, p.stock_minimo::text AS stock_minimo, p.stock_ideal::text AS stock_ideal,
            COALESCE((SELECT jsonb_object_agg(pp.lista_id, pp.precio::text) FROM producto_precios pp WHERE pp.producto_id = p.id), '{}'::jsonb) AS precios
       FROM productos p WHERE p.id = $1`,
    [id],
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    id: f.id, codigo: f.codigo, nombre: f.nombre, rubroId: f.rubro_id, tipo: f.tipo, unidad: f.unidad, costo: f.costo, iva: Number(f.iva),
    vendible: f.vendible, comprable: f.comprable, integrable: f.integrable, publicadoWeb: f.publicado_web, urlWeb: f.url_web, activo: f.activo,
    precios: f.precios, stock: f.stock, stockMinimo: f.stock_minimo, stockIdeal: f.stock_ideal,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function obtenerProducto(s: SesionActiva, id: string): Promise<DetalleProducto | null> {
  exigir(s, 'productos');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, (c) => detalleEn(c, id));
}

export async function tiposDeProducto(s: SesionActiva): Promise<string[]> {
  exigir(s, 'productos');
  const r = await conTenant(s.tenantId, (c) => c.query<{ tipo: string }>('SELECT DISTINCT tipo FROM productos WHERE tipo IS NOT NULL ORDER BY tipo'));
  return r.rows.map((f) => f.tipo);
}

function mapearErrorProducto(e: unknown): never {
  const codigo = (e as { code?: string }).code;
  if (codigo === '23505') throw new ErrorDeUsuario('Ya hay otro producto con ese código');
  if (codigo === '23503') throw new ErrorDeUsuario('El rubro o la lista de precios no existe');
  throw e;
}

/** Crea (id = null) o modifica un producto con sus precios por lista. Deja auditoría con el antes y el después. */
export async function guardarProducto(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'productos');
  const v = esquemaProducto.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d: DatosProducto = v.data;
  try {
    return await conTenant(s.tenantId, async (c) => {
      const listas = await listasEn(c);
      const idsListas = new Set(listas.map((l) => l.id));
      for (const lid of Object.keys(d.precios)) if (!idsListas.has(lid)) throw new ErrorDeUsuario('Una lista de precios no existe');
      if (d.rubroId) {
        const ru = await c.query('SELECT 1 FROM rubros WHERE id = $1 AND activo', [d.rubroId]);
        if (ru.rowCount === 0) throw new ErrorDeUsuario('El rubro no existe o está archivado');
      }
      const valores = [d.codigo, d.nombre, d.rubroId, d.tipo, d.unidad, d.costo, d.iva, d.vendible, d.comprable, d.integrable, d.publicadoWeb, d.urlWeb, d.stockMinimo, d.stockIdeal];
      let pid: string;
      let antes: DetalleProducto | null = null;
      if (id) {
        antes = await detalleEn(c, id);
        if (!antes) throw new ErrorDeUsuario('El producto no existe');
        await c.query(
          `UPDATE productos SET codigo=$2, nombre=$3, rubro_id=$4, tipo=$5, unidad=$6, costo=$7, iva=$8, vendible=$9, comprable=$10,
                  integrable=$11, publicado_web=$12, url_web=$13, stock_minimo=$14, stock_ideal=$15 WHERE id = $1`,
          [id, ...valores],
        );
        pid = id;
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO productos (tenant_id, codigo, nombre, rubro_id, tipo, unidad, costo, iva, vendible, comprable, integrable, publicado_web, url_web, stock_minimo, stock_ideal)
           VALUES (app.tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          valores,
        );
        pid = r.rows[0]!.id;
      }
      for (const [lid, precio] of Object.entries(d.precios)) {
        await c.query(
          `INSERT INTO producto_precios (tenant_id, producto_id, lista_id, precio) VALUES (app.tenant_id(), $1, $2, $3)
           ON CONFLICT (producto_id, lista_id) DO UPDATE SET precio = EXCLUDED.precio`,
          [pid, lid, precio],
        );
      }
      const despues = await detalleEn(c, pid);
      await auditar(c, s.usuarioId, id ? 'modificar' : 'crear', 'producto', despues, { entidadId: pid, antes });
      return pid;
    });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) throw e;
    return mapearErrorProducto(e);
  }
}

/** Los productos no se borran: se archivan y conservan su historial (regla 15). */
export async function archivarProducto(s: SesionActiva, id: string, activo: boolean): Promise<void> {
  exigir(s, 'productos');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('UPDATE productos SET activo = $2 WHERE id = $1', [id, activo]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('El producto no existe');
    await auditar(c, s.usuarioId, activo ? 'restaurar' : 'archivar', 'producto', undefined, { entidadId: id });
  });
}
