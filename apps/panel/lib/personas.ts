// Clientes, proveedores, categorías de cliente y libro de cuenta corriente (solo agregar).
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import {
  esquemaCategoriaCliente, esquemaCliente, esquemaMovimiento, esquemaProveedor, primerError,
  type DatosCliente, type DatosProveedor,
} from './validacion.ts';
import { escaparLike, terminosDeBusqueda } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Estado = 'activos' | 'archivados' | 'todos';

function mapearError(e: unknown): never {
  const codigo = (e as { code?: string }).code;
  if (codigo === '23503') throw new ErrorDeUsuario('La categoría o la lista de precios no existe');
  if (codigo === '23505') throw new ErrorDeUsuario('Ya existe un registro con ese nombre');
  throw e;
}

/** Condición de búsqueda por partes, sin tildes ni mayúsculas, en cualquier orden. */
function buscar(q: string | undefined, columnas: string, params: unknown[]): string[] {
  return terminosDeBusqueda(q ?? '').map((t) => {
    params.push('%' + escaparLike(t) + '%');
    return `unaccent(lower(${columnas})) LIKE $${params.length} ESCAPE '\\'`;
  });
}

// ───────── Categorías de cliente ─────────
export interface CategoriaCliente {
  id: string;
  nombre: string;
  listaId: string | null;
  cuentaCorriente: boolean;
  descuento: number;
  ventaACosto: boolean;
  activa: boolean;
}

const mapCategoria = (f: { id: string; nombre: string; lista_id: string | null; cuenta_corriente: boolean; descuento: string; venta_a_costo: boolean; activa: boolean }): CategoriaCliente => ({
  id: f.id, nombre: f.nombre, listaId: f.lista_id, cuentaCorriente: f.cuenta_corriente, descuento: Number(f.descuento), ventaACosto: f.venta_a_costo, activa: f.activa,
});

export async function listarCategorias(s: SesionActiva): Promise<CategoriaCliente[]> {
  exigir(s, 'clientes');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query('SELECT id, nombre, lista_id, cuenta_corriente, descuento::text, venta_a_costo, activa FROM categorias_cliente ORDER BY lower(nombre)');
    return r.rows.map(mapCategoria);
  });
}

export async function guardarCategoria(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'clientes');
  const v = esquemaCategoriaCliente.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  try {
    return await conTenant(s.tenantId, async (c) => {
      const valores = [d.nombre, d.listaId, d.cuentaCorriente, d.descuento, d.ventaACosto];
      let cid = id;
      let antes: unknown = null;
      if (id) {
        const a = await c.query('SELECT nombre, lista_id, cuenta_corriente, descuento::text, venta_a_costo FROM categorias_cliente WHERE id = $1', [id]);
        if (!a.rows[0]) throw new ErrorDeUsuario('La categoría no existe');
        antes = a.rows[0];
        await c.query('UPDATE categorias_cliente SET nombre=$2, lista_id=$3, cuenta_corriente=$4, descuento=$5, venta_a_costo=$6 WHERE id=$1', [id, ...valores]);
      } else {
        const r = await c.query<{ id: string }>(
          'INSERT INTO categorias_cliente (tenant_id, nombre, lista_id, cuenta_corriente, descuento, venta_a_costo) VALUES (app.tenant_id(),$1,$2,$3,$4,$5) RETURNING id',
          valores,
        );
        cid = r.rows[0]!.id;
      }
      await auditar(c, s.usuarioId, id ? 'modificar' : 'crear', 'categoria_cliente', d, { entidadId: cid!, antes });
      return cid!;
    });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) throw e;
    return mapearError(e);
  }
}

// ───────── Clientes ─────────
export interface FilaCliente {
  id: string; nombre: string; categoria: string | null; telefono: string | null; localidad: string | null;
  activo: boolean; esConsumidorFinal: boolean; saldo: string;
}

export async function asegurarConsumidorFinal(c: PoolClient): Promise<void> {
  await c.query(
    `INSERT INTO clientes (tenant_id, nombre, es_consumidor_final) VALUES (app.tenant_id(), 'Consumidor Final', true)
     ON CONFLICT DO NOTHING`,
  );
}

export async function listarClientes(s: SesionActiva, f: { q?: string; estado?: Estado; limite?: number } = {}): Promise<{ filas: FilaCliente[]; total: number }> {
  exigir(s, 'clientes');
  const params: unknown[] = [];
  const cond: string[] = [];
  if ((f.estado ?? 'activos') === 'activos') cond.push('c.activo');
  if (f.estado === 'archivados') cond.push('NOT c.activo');
  cond.push(...buscar(f.q, "c.nombre || ' ' || coalesce(c.cuit,'') || ' ' || coalesce(c.telefono,'') || ' ' || coalesce(c.localidad,'')", params));
  const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const limite = Math.min(Math.max(f.limite ?? 50, 1), 500);
  return conTenant(s.tenantId, async (c) => {
    await asegurarConsumidorFinal(c);
    const total = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM clientes c ${donde}`, params);
    const r = await c.query(
      `SELECT c.id, c.nombre, k.nombre AS categoria, c.telefono, c.localidad, c.activo, c.es_consumidor_final,
              COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.cliente_id = c.id), 0)::text AS saldo
         FROM clientes c LEFT JOIN categorias_cliente k ON k.tenant_id = c.tenant_id AND k.id = c.categoria_id
         ${donde} ORDER BY lower(c.nombre), c.id LIMIT ${limite}`,
      params,
    );
    return {
      total: Number(total.rows[0]!.n),
      filas: r.rows.map((x) => ({ id: x.id, nombre: x.nombre, categoria: x.categoria, telefono: x.telefono, localidad: x.localidad, activo: x.activo, esConsumidorFinal: x.es_consumidor_final, saldo: x.saldo })),
    };
  });
}

export interface DetalleCliente extends DatosCliente {
  id: string; activo: boolean; esConsumidorFinal: boolean; saldo: string;
}

async function clienteEn(c: PoolClient, id: string): Promise<DetalleCliente | null> {
  const r = await c.query(
    `SELECT c.*, COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.cliente_id = c.id), 0)::text AS saldo FROM clientes c WHERE c.id = $1`,
    [id],
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    id: f.id, nombre: f.nombre, categoriaId: f.categoria_id, telefono: f.telefono, email: f.email, domicilio: f.domicilio, localidad: f.localidad,
    cuit: f.cuit, condicionIva: f.condicion_iva, activo: f.activo, esConsumidorFinal: f.es_consumidor_final, saldo: f.saldo,
  };
}

export async function obtenerCliente(s: SesionActiva, id: string): Promise<DetalleCliente | null> {
  exigir(s, 'clientes');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, (c) => clienteEn(c, id));
}

export async function guardarCliente(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'clientes');
  const v = esquemaCliente.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  try {
    return await conTenant(s.tenantId, async (c) => {
      const valores = [d.nombre, d.categoriaId, d.telefono, d.email, d.domicilio, d.localidad, d.cuit, d.condicionIva];
      let cid = id;
      let antes: DetalleCliente | null = null;
      if (id) {
        antes = await clienteEn(c, id);
        if (!antes) throw new ErrorDeUsuario('El cliente no existe');
        await c.query('UPDATE clientes SET nombre=$2, categoria_id=$3, telefono=$4, email=$5, domicilio=$6, localidad=$7, cuit=$8, condicion_iva=$9 WHERE id=$1', [id, ...valores]);
      } else {
        const r = await c.query<{ id: string }>(
          'INSERT INTO clientes (tenant_id, nombre, categoria_id, telefono, email, domicilio, localidad, cuit, condicion_iva) VALUES (app.tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          valores,
        );
        cid = r.rows[0]!.id;
      }
      await auditar(c, s.usuarioId, id ? 'modificar' : 'crear', 'cliente', d, { entidadId: cid!, antes });
      return cid!;
    });
  } catch (e) {
    if (e instanceof ErrorDeUsuario) throw e;
    return mapearError(e);
  }
}

/** Se oculta pero conserva su historial (regla 15). El Consumidor Final no se puede archivar. */
export async function archivarCliente(s: SesionActiva, id: string, activo: boolean): Promise<void> {
  exigir(s, 'clientes');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('UPDATE clientes SET activo = $2 WHERE id = $1 AND NOT es_consumidor_final', [id, activo]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('No se puede archivar este cliente');
    await auditar(c, s.usuarioId, activo ? 'restaurar' : 'archivar', 'cliente', undefined, { entidadId: id });
  });
}

// ───────── Proveedores ─────────
export interface FilaProveedor { id: string; nombre: string; contacto: string | null; categoria: string | null; telefono: string | null; activo: boolean; saldo: string }

export async function listarProveedores(s: SesionActiva, f: { q?: string; estado?: Estado; limite?: number } = {}): Promise<{ filas: FilaProveedor[]; total: number }> {
  exigir(s, 'proveedores');
  const params: unknown[] = [];
  const cond: string[] = [];
  if ((f.estado ?? 'activos') === 'activos') cond.push('p.activo');
  if (f.estado === 'archivados') cond.push('NOT p.activo');
  cond.push(...buscar(f.q, "p.nombre || ' ' || coalesce(p.contacto,'') || ' ' || coalesce(p.categoria,'') || ' ' || coalesce(p.cuit,'')", params));
  const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const limite = Math.min(Math.max(f.limite ?? 50, 1), 500);
  return conTenant(s.tenantId, async (c) => {
    const total = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM proveedores p ${donde}`, params);
    const r = await c.query(
      `SELECT p.id, p.nombre, p.contacto, p.categoria, p.telefono, p.activo,
              COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.proveedor_id = p.id), 0)::text AS saldo
         FROM proveedores p ${donde} ORDER BY lower(p.nombre), p.id LIMIT ${limite}`,
      params,
    );
    return { total: Number(total.rows[0]!.n), filas: r.rows };
  });
}

export interface DetalleProveedor extends DatosProveedor { id: string; activo: boolean; saldo: string }

async function proveedorEn(c: PoolClient, id: string): Promise<DetalleProveedor | null> {
  const r = await c.query(
    `SELECT p.*, COALESCE((SELECT sum(m.importe) FROM cuenta_corriente_movimientos m WHERE m.proveedor_id = p.id), 0)::text AS saldo FROM proveedores p WHERE p.id = $1`,
    [id],
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    id: f.id, nombre: f.nombre, contacto: f.contacto, categoria: f.categoria, telefono: f.telefono, email: f.email, domicilio: f.domicilio,
    localidad: f.localidad, cuit: f.cuit, condicionIva: f.condicion_iva, activo: f.activo, saldo: f.saldo,
  };
}

export async function obtenerProveedor(s: SesionActiva, id: string): Promise<DetalleProveedor | null> {
  exigir(s, 'proveedores');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, (c) => proveedorEn(c, id));
}

export async function categoriasDeProveedor(s: SesionActiva): Promise<string[]> {
  exigir(s, 'proveedores');
  const r = await conTenant(s.tenantId, (c) => c.query<{ categoria: string }>('SELECT DISTINCT categoria FROM proveedores WHERE categoria IS NOT NULL ORDER BY categoria'));
  return r.rows.map((f) => f.categoria);
}

export async function guardarProveedor(s: SesionActiva, id: string | null, entrada: unknown): Promise<string> {
  exigir(s, 'proveedores');
  const v = esquemaProveedor.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  const d = v.data;
  return conTenant(s.tenantId, async (c) => {
    const valores = [d.nombre, d.contacto, d.categoria, d.telefono, d.email, d.domicilio, d.localidad, d.cuit, d.condicionIva];
    let pid = id;
    let antes: DetalleProveedor | null = null;
    if (id) {
      antes = await proveedorEn(c, id);
      if (!antes) throw new ErrorDeUsuario('El proveedor no existe');
      await c.query('UPDATE proveedores SET nombre=$2, contacto=$3, categoria=$4, telefono=$5, email=$6, domicilio=$7, localidad=$8, cuit=$9, condicion_iva=$10 WHERE id=$1', [id, ...valores]);
    } else {
      const r = await c.query<{ id: string }>(
        'INSERT INTO proveedores (tenant_id, nombre, contacto, categoria, telefono, email, domicilio, localidad, cuit, condicion_iva) VALUES (app.tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        valores,
      );
      pid = r.rows[0]!.id;
    }
    await auditar(c, s.usuarioId, id ? 'modificar' : 'crear', 'proveedor', d, { entidadId: pid!, antes });
    return pid!;
  });
}

export async function archivarProveedor(s: SesionActiva, id: string, activo: boolean): Promise<void> {
  exigir(s, 'proveedores');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('UPDATE proveedores SET activo = $2 WHERE id = $1', [id, activo]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('El proveedor no existe');
    await auditar(c, s.usuarioId, activo ? 'restaurar' : 'archivar', 'proveedor', undefined, { entidadId: id });
  });
}

// ───────── Cuenta corriente (libro de solo agregar) ─────────
export type Titular = { cliente: string } | { proveedor: string };

export interface Movimiento {
  id: string; tipo: string; importe: string; concepto: string | null; revierteId: string | null; revertido: boolean; creadoEn: Date; usuario: string | null;
  saldo: string; ventaId: string | null; reciboId: string | null; devolucionId: string | null; // saldo = lo que quedó después de este movimiento
}

export async function movimientosDe(s: SesionActiva, t: Titular, limite = 50): Promise<Movimiento[]> {
  exigir(s, 'cliente' in t ? 'clientes' : 'proveedores');
  const [col, id] = 'cliente' in t ? ['cliente_id', t.cliente] : ['proveedor_id', t.proveedor];
  if (!UUID.test(id)) return [];
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT * FROM (
         SELECT m.id, m.id::text AS id_t, m.tipo, m.importe::text, m.concepto, m.revierte_id::text, m.creado_en, u.nombre AS usuario, m.venta_id, m.recibo_id, m.devolucion_id,
                sum(m.importe) OVER (ORDER BY m.id)::numeric(14,2)::text AS saldo,
                EXISTS (SELECT 1 FROM cuenta_corriente_movimientos x WHERE x.revierte_id = m.id) AS revertido
           FROM cuenta_corriente_movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.${col} = $1) t
        ORDER BY id DESC LIMIT ${Math.min(Math.max(limite, 1), 500)}`,
      [id],
    );
    return r.rows.map((f) => ({ id: f.id_t, tipo: f.tipo, importe: f.importe, concepto: f.concepto, revierteId: f.revierte_id, revertido: f.revertido, creadoEn: f.creado_en, usuario: f.usuario, saldo: f.saldo, ventaId: f.venta_id, reciboId: f.recibo_id, devolucionId: f.devolucion_id }));
  });
}

async function insertarMovimiento(c: PoolClient, s: SesionActiva, t: Titular, tipo: string, importe: string, concepto: string | null, revierteId: string | null): Promise<string> {
  const cliente = 'cliente' in t ? t.cliente : null;
  const proveedor = 'proveedor' in t ? t.proveedor : null;
  const r = await c.query<{ id: string }>(
    `INSERT INTO cuenta_corriente_movimientos (tenant_id, cliente_id, proveedor_id, tipo, importe, concepto, revierte_id, usuario_id)
     VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
    [cliente, proveedor, tipo, importe, concepto, revierteId, s.usuarioId],
  );
  return r.rows[0]!.id;
}

/** Saldo inicial o ajuste manual. Positivo aumenta la deuda; negativo la reduce. Nunca modifica un movimiento anterior. */
export async function registrarMovimiento(s: SesionActiva, t: Titular, entrada: unknown): Promise<string> {
  exigir(s, 'cliente' in t ? 'clientes' : 'proveedores');
  const v = esquemaMovimiento.safeParse(entrada);
  if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
  try {
    return await conTenant(s.tenantId, async (c) => {
      const id = await insertarMovimiento(c, s, t, v.data.tipo, v.data.importe, v.data.concepto, null);
      await auditar(c, s.usuarioId, 'movimiento', 'cuenta_corriente', { ...t, ...v.data }, { entidadId: id });
      return id;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23503') throw new ErrorDeUsuario('El cliente o proveedor no existe');
    throw e;
  }
}

/** Corrige generando el movimiento inverso que referencia al original. */
export async function revertirMovimiento(s: SesionActiva, t: Titular, movimientoId: string, concepto?: string): Promise<string> {
  exigir(s, 'cliente' in t ? 'clientes' : 'proveedores');
  const col = 'cliente' in t ? 'cliente_id' : 'proveedor_id';
  const titular = 'cliente' in t ? t.cliente : t.proveedor;
  if (!/^\d+$/.test(movimientoId) || !UUID.test(titular)) throw new ErrorDeUsuario('El movimiento no existe');
  return conTenant(s.tenantId, async (c) => {
    const o = await c.query<{ importe: string; tipo: string }>(`SELECT importe::text, tipo FROM cuenta_corriente_movimientos WHERE id = $1 AND ${col} = $2`, [movimientoId, titular]);
    const orig = o.rows[0];
    if (!orig) throw new ErrorDeUsuario('El movimiento no existe');
    if (orig.tipo === 'reversion') throw new ErrorDeUsuario('Una reversión no se puede revertir');
    if (orig.tipo === 'venta' || orig.tipo === 'recibo' || orig.tipo === 'nota_credito' || orig.tipo === 'devolucion_pago') throw new ErrorDeUsuario('Este movimiento viene de una venta, un recibo, una nota de crédito o una devolución: se anula desde ahí');
    try {
      const inverso = orig.importe.startsWith('-') ? orig.importe.slice(1) : '-' + orig.importe;
      const id = await insertarMovimiento(c, s, t, 'reversion', inverso, concepto?.trim().slice(0, 200) || 'Reversión', movimientoId);
      await auditar(c, s.usuarioId, 'revertir', 'cuenta_corriente', { revierte: movimientoId }, { entidadId: id });
      return id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ese movimiento ya fue revertido');
      throw e;
    }
  });
}
