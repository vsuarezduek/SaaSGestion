// Datos extras de los productos (configurables por comercio): "Lista mayorista", "Ferias", etc.
// La definición vive en datos_extra; el valor de cada producto, en productos.datos_extra con el id del dato como clave.
// Quitar un dato lo desactiva (los valores se conservan); renombrar un dato o un valor no pierde nada.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DatoExtra { id: string; nombre: string; productos: number; valores: number }

const nombreValido = (txt: unknown, campo: string, max: number): string => {
  const t = String(txt ?? '').trim();
  if (!t) throw new ErrorDeUsuario(`Falta ${campo}`);
  if (t.length > max) throw new ErrorDeUsuario(`${campo[0]!.toUpperCase()}${campo.slice(1)} es demasiado largo (máximo ${max} caracteres)`);
  return t;
};

/** Datos extras activos con cuántos productos tienen valor y cuántos valores distintos hay. */
export async function listarDatosExtra(s: SesionActiva): Promise<DatoExtra[]> {
  exigir(s, 'productos');
  const r = await conTenant(s.tenantId, (c) => c.query<{ id: string; nombre: string; productos: string; valores: string }>(
    `SELECT d.id, d.nombre,
            (SELECT count(*) FROM productos p WHERE p.activo AND coalesce(p.datos_extra ->> d.id::text, '') <> '')::text AS productos,
            (SELECT count(DISTINCT p.datos_extra ->> d.id::text) FROM productos p WHERE p.activo AND coalesce(p.datos_extra ->> d.id::text, '') <> '')::text AS valores
       FROM datos_extra d WHERE d.activo ORDER BY d.orden, lower(d.nombre)`));
  return r.rows.map((f) => ({ id: f.id, nombre: f.nombre, productos: Number(f.productos), valores: Number(f.valores) }));
}

export async function crearDatoExtra(s: SesionActiva, nombre: string): Promise<string> {
  exigir(s, 'ajustes');
  const n = nombreValido(nombre, 'el nombre del dato', 60);
  try {
    return await conTenant(s.tenantId, async (c) => {
      const o = await c.query<{ n: number }>('SELECT COALESCE(max(orden), 0) + 1 AS n FROM datos_extra');
      const r = await c.query<{ id: string }>('INSERT INTO datos_extra (tenant_id, nombre, orden) VALUES (app.tenant_id(), $1, $2) RETURNING id', [n, o.rows[0]!.n]);
      await auditar(c, s.usuarioId, 'crear', 'dato_extra', { nombre: n }, { entidadId: r.rows[0]!.id });
      return r.rows[0]!.id;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ya hay un dato extra con ese nombre');
    throw e;
  }
}

export async function renombrarDatoExtra(s: SesionActiva, id: string, nombre: string): Promise<void> {
  exigir(s, 'ajustes');
  const n = nombreValido(nombre, 'el nombre del dato', 60);
  if (!UUID.test(id)) throw new ErrorDeUsuario('El dato extra no existe');
  try {
    await conTenant(s.tenantId, async (c) => {
      const a = await c.query<{ nombre: string }>('SELECT nombre FROM datos_extra WHERE id = $1 AND activo', [id]);
      if (!a.rows[0]) throw new ErrorDeUsuario('El dato extra no existe');
      await c.query('UPDATE datos_extra SET nombre = $2 WHERE id = $1', [id, n]);
      await auditar(c, s.usuarioId, 'modificar', 'dato_extra', { nombre: n }, { entidadId: id, antes: { nombre: a.rows[0].nombre } });
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ErrorDeUsuario('Ya hay un dato extra con ese nombre');
    throw e;
  }
}

/** Quitar un dato extra: deja de usarse en pantallas, informes y archivos, pero los valores quedan guardados. */
export async function quitarDatoExtra(s: SesionActiva, id: string): Promise<void> {
  exigir(s, 'ajustes');
  if (!UUID.test(id)) throw new ErrorDeUsuario('El dato extra no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query('UPDATE datos_extra SET activo = false WHERE id = $1 AND activo', [id]);
    if (r.rowCount === 0) throw new ErrorDeUsuario('El dato extra no existe');
    await auditar(c, s.usuarioId, 'archivar', 'dato_extra', undefined, { entidadId: id });
  });
}

export interface ValorExtra { valor: string; productos: { id: string; nombre: string; codigo: string | null }[] }
export interface DetalleDatoExtra { id: string; nombre: string; valores: ValorExtra[]; sinValor: number }

/** Los productos activos con valor, agrupados por valor. */
export async function detalleDatoExtra(s: SesionActiva, id: string): Promise<DetalleDatoExtra | null> {
  exigir(s, 'productos');
  if (!UUID.test(id)) return null;
  return conTenant(s.tenantId, async (c) => {
    const d = await c.query<{ nombre: string }>('SELECT nombre FROM datos_extra WHERE id = $1 AND activo', [id]);
    if (!d.rows[0]) return null;
    const r = await c.query<{ id: string; nombre: string; codigo: string | null; valor: string }>(
      `SELECT id, nombre, codigo, datos_extra ->> $1 AS valor FROM productos
        WHERE activo AND coalesce(datos_extra ->> $1, '') <> '' ORDER BY lower(datos_extra ->> $1), lower(nombre)`, [id]);
    const grupos = new Map<string, ValorExtra>();
    for (const f of r.rows) {
      const g = grupos.get(f.valor) ?? { valor: f.valor, productos: [] };
      g.productos.push({ id: f.id, nombre: f.nombre, codigo: f.codigo });
      grupos.set(f.valor, g);
    }
    const sin = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM productos WHERE activo AND coalesce(datos_extra ->> $1, '') = ''`, [id]);
    return { id, nombre: d.rows[0].nombre, valores: [...grupos.values()], sinValor: Number(sin.rows[0]!.n) };
  });
}

async function exigirDato(c: import('pg').PoolClient, id: string): Promise<void> {
  if (!UUID.test(id)) throw new ErrorDeUsuario('El dato extra no existe');
  const d = await c.query('SELECT 1 FROM datos_extra WHERE id = $1 AND activo', [id]);
  if (d.rowCount === 0) throw new ErrorDeUsuario('El dato extra no existe');
}

/** Pone un valor a varios productos (o se lo saca si el valor viene vacío). */
export async function asignarValorExtra(s: SesionActiva, datoId: string, valor: string, productoIds: string[]): Promise<number> {
  exigir(s, 'productos');
  const v = String(valor ?? '').trim();
  if (v.length > 120) throw new ErrorDeUsuario('El valor es demasiado largo (máximo 120 caracteres)');
  const ids = [...new Set(productoIds.filter((x) => UUID.test(x)))];
  if (ids.length === 0) throw new ErrorDeUsuario('Elegí al menos un producto');
  if (ids.length > 1000) throw new ErrorDeUsuario('Demasiados productos a la vez (máximo 1.000)');
  return conTenant(s.tenantId, async (c) => {
    await exigirDato(c, datoId);
    const r = v === ''
      ? await c.query('UPDATE productos SET datos_extra = datos_extra - $1::text WHERE id = ANY($2::uuid[])', [datoId, ids])
      : await c.query('UPDATE productos SET datos_extra = jsonb_set(datos_extra, ARRAY[$1::text], to_jsonb($3::text)) WHERE id = ANY($2::uuid[])', [datoId, ids, v]);
    await auditar(c, s.usuarioId, 'modificar', 'dato_extra', { valor: v, productos: r.rowCount }, { entidadId: datoId });
    return r.rowCount ?? 0;
  });
}

/** Cambia el nombre de un valor en todos los productos que lo tienen. Si el nuevo ya existe, se unen. */
export async function renombrarValorExtra(s: SesionActiva, datoId: string, viejo: string, nuevo: string): Promise<number> {
  exigir(s, 'productos');
  const n = nombreValido(nuevo, 'el valor', 120);
  return conTenant(s.tenantId, async (c) => {
    await exigirDato(c, datoId);
    const r = await c.query('UPDATE productos SET datos_extra = jsonb_set(datos_extra, ARRAY[$1::text], to_jsonb($3::text)) WHERE datos_extra ->> $1 = $2', [datoId, viejo, n]);
    await auditar(c, s.usuarioId, 'modificar', 'dato_extra', { renombraValor: { de: viejo, a: n }, productos: r.rowCount }, { entidadId: datoId });
    return r.rowCount ?? 0;
  });
}

/** Saca un valor a todos los productos que lo tienen (no borra los productos). */
export async function quitarValorExtra(s: SesionActiva, datoId: string, valor: string): Promise<number> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, async (c) => {
    await exigirDato(c, datoId);
    const r = await c.query('UPDATE productos SET datos_extra = datos_extra - $1::text WHERE datos_extra ->> $1 = $2', [datoId, valor]);
    await auditar(c, s.usuarioId, 'modificar', 'dato_extra', { quitaValor: valor, productos: r.rowCount }, { entidadId: datoId });
    return r.rowCount ?? 0;
  });
}

/** Productos activos para elegir al agregar a un valor (búsqueda simple por nombre o código). */
export async function buscarProductosParaExtra(s: SesionActiva, q: string): Promise<{ id: string; nombre: string; codigo: string | null }[]> {
  exigir(s, 'productos');
  const t = String(q ?? '').trim();
  if (t.length < 2) return [];
  const r = await conTenant(s.tenantId, (c) => c.query<{ id: string; nombre: string; codigo: string | null }>(
    `SELECT id, nombre, codigo FROM productos WHERE activo AND unaccent(lower(nombre || ' ' || coalesce(codigo, ''))) LIKE '%' || unaccent(lower($1)) || '%' ORDER BY lower(nombre) LIMIT 20`, [t.replace(/[%_\\]/g, '')]));
  return r.rows;
}

export interface DatoExtraConValores { id: string; nombre: string; valores: string[] }

/** Para la ficha del producto: cada dato extra con los valores que ya se usaron (para elegir en un desplegable). */
export async function datosExtraConValores(s: SesionActiva): Promise<DatoExtraConValores[]> {
  exigir(s, 'productos');
  return conTenant(s.tenantId, async (c) => {
    const d = await c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM datos_extra WHERE activo ORDER BY orden, lower(nombre)');
    const out: DatoExtraConValores[] = [];
    for (const x of d.rows) {
      const v = await c.query<{ valor: string }>(`SELECT DISTINCT datos_extra ->> $1 AS valor FROM productos WHERE coalesce(datos_extra ->> $1, '') <> '' ORDER BY 1`, [x.id]);
      out.push({ id: x.id, nombre: x.nombre, valores: v.rows.map((f) => f.valor) });
    }
    return out;
  });
}

/** Proveedores activos para elegir en la ficha del producto o en los filtros. */
export async function proveedoresParaProducto(s: SesionActiva): Promise<{ id: string; nombre: string }[]> {
  exigir(s, 'productos');
  const r = await conTenant(s.tenantId, (c) => c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM proveedores WHERE activo ORDER BY lower(nombre)'));
  return r.rows;
}
