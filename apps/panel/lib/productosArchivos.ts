// Archivos de productos: exportación completa (CSV) y listas de precios para clientes (CSV y página imprimible).
import { listarRubros, listasEn, type Lista } from './catalogo.ts';
import { aCsv } from './csv.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { type SesionActiva } from './auth.ts';

export const COLUMNAS_EXPORTABLES = ['rubro', 'tipo', 'proveedor', 'unidad', 'iva', 'stock', 'stockideal', 'stockminimo', 'costo', 'precios', 'extras'] as const;
export type ColumnaExportable = (typeof COLUMNAS_EXPORTABLES)[number];

interface FilaCruda {
  id: string; codigo: string | null; nombre: string; tipo: string | null; unidad: string; iva: string; costo: string; rubro_id: string | null;
  proveedor: string | null; stock: string; stock_minimo: string; stock_ideal: string; precios: Record<string, string>; datos_extra: Record<string, string>;
}

async function productosCrudos(s: SesionActiva, activos: boolean): Promise<{ filas: FilaCruda[]; listas: Lista[]; extras: { id: string; nombre: string }[]; rutaRubro: (id: string | null) => string }> {
  const rubros = await listarRubros(s);
  const porId = new Map(rubros.map((r) => [r.id, r]));
  const rutaRubro = (id: string | null): string => {
    const partes: string[] = [];
    for (let x = id ? porId.get(id) : undefined, n = 0; x && n < 10; x = x.padreId ? porId.get(x.padreId) : undefined, n++) partes.unshift(x.nombre);
    return partes.join(' > ');
  };
  return conTenant(s.tenantId, async (c) => {
    const listas = await listasEn(c);
    const extras = (await c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM datos_extra WHERE activo ORDER BY orden, lower(nombre)')).rows;
    const r = await c.query<FilaCruda>(
      `SELECT p.id, p.codigo, p.nombre, p.tipo, p.unidad, p.iva::text AS iva, p.costo::text AS costo, p.rubro_id, pv.nombre AS proveedor,
              (SELECT COALESCE(sum(sm.cantidad), 0)::text FROM stock_movimientos sm WHERE sm.producto_id = p.id) AS stock,
              p.stock_minimo::text AS stock_minimo, p.stock_ideal::text AS stock_ideal, p.datos_extra,
              COALESCE((SELECT jsonb_object_agg(pp.lista_id, pp.precio::text) FROM producto_precios pp WHERE pp.producto_id = p.id), '{}'::jsonb) AS precios
         FROM productos p LEFT JOIN proveedores pv ON pv.tenant_id = p.tenant_id AND pv.id = p.proveedor_id
        ${activos ? 'WHERE p.activo' : ''} ORDER BY lower(p.nombre), p.id`);
    return { filas: r.rows, listas, extras, rutaRubro };
  });
}

/** Exportación para planillas: el código y el nombre van siempre; el resto, según las columnas elegidas. Se puede volver a importar. */
export async function exportarProductosCsv(s: SesionActiva, columnas: ColumnaExportable[]): Promise<string> {
  exigir(s, 'descargar');
  const { filas, listas, extras, rutaRubro } = await productosCrudos(s, true);
  const quiere = (c: ColumnaExportable) => columnas.includes(c);
  const enc = ['Código', 'Nombre'];
  if (quiere('rubro')) enc.push('Rubro');
  if (quiere('tipo')) enc.push('Tipo');
  if (quiere('proveedor')) enc.push('Proveedor');
  if (quiere('unidad')) enc.push('Unidad');
  if (quiere('iva')) enc.push('IVA');
  if (quiere('stock')) enc.push('Stock');
  if (quiere('stockideal')) enc.push('Stock ideal');
  if (quiere('stockminimo')) enc.push('Stock mínimo');
  if (quiere('costo')) enc.push('Costo');
  if (quiere('precios')) for (const l of listas) enc.push(l.nombre);
  if (quiere('extras')) for (const x of extras) enc.push(x.nombre);
  const out: string[][] = [enc];
  for (const f of filas) {
    const fila = [f.codigo ?? '', f.nombre];
    if (quiere('rubro')) fila.push(rutaRubro(f.rubro_id));
    if (quiere('tipo')) fila.push(f.tipo ?? '');
    if (quiere('proveedor')) fila.push(f.proveedor ?? '');
    if (quiere('unidad')) fila.push(f.unidad);
    if (quiere('iva')) fila.push(f.iva);
    if (quiere('stock')) fila.push(f.stock);
    if (quiere('stockideal')) fila.push(f.stock_ideal);
    if (quiere('stockminimo')) fila.push(f.stock_minimo);
    if (quiere('costo')) fila.push(f.costo);
    if (quiere('precios')) for (const l of listas) fila.push(f.precios[l.id] ?? '');
    if (quiere('extras')) for (const x of extras) fila.push(f.datos_extra[x.id] ?? '');
    out.push(fila);
  }
  return aCsv(out);
}

export interface FiltroLista {
  listaIds: string[];             // listas de precios a mostrar (una columna por lista)
  rubroId?: string;
  proveedorId?: string;
  extraId?: string;
  extraValor?: string;
  soloConStock: boolean;
  mostrarStock: boolean;
}

export interface FilaListaPrecios { codigo: string; nombre: string; rubro: string; unidad: string; precios: string[]; stock: string }
export interface ListaPrecios { listas: string[]; filas: FilaListaPrecios[]; mostrarStock: boolean }

/** Lista de precios para entregar a clientes: solo productos activos y vendibles, con los precios de las listas elegidas. */
export async function listaDePrecios(s: SesionActiva, f: FiltroLista): Promise<ListaPrecios> {
  exigir(s, 'productos');
  const { filas, listas, rutaRubro } = await productosCrudos(s, true);
  const elegidas = listas.filter((l) => f.listaIds.includes(l.id));
  const conj = await conTenant(s.tenantId, async (c) => {
    const vend = new Set((await c.query<{ id: string }>('SELECT id FROM productos WHERE activo AND vendible')).rows.map((x) => x.id));
    let enRubro: Set<string> | null = null;
    if (f.rubroId) {
      enRubro = new Set((await c.query<{ id: string }>(
        'WITH RECURSIVE d AS (SELECT id FROM rubros WHERE id = $1::uuid UNION ALL SELECT x.id FROM rubros x JOIN d ON x.padre_id = d.id) SELECT id FROM d', [f.rubroId])).rows.map((x) => x.id));
    }
    let deProveedor: Set<string> | null = null;
    if (f.proveedorId) deProveedor = new Set((await c.query<{ id: string }>('SELECT id FROM productos WHERE proveedor_id = $1', [f.proveedorId])).rows.map((x) => x.id));
    return { vend, enRubro, deProveedor };
  });
  const sal: FilaListaPrecios[] = [];
  for (const p of filas) {
    if (!conj.vend.has(p.id)) continue;
    if (conj.enRubro && (!p.rubro_id || !conj.enRubro.has(p.rubro_id))) continue;
    if (conj.deProveedor && !conj.deProveedor.has(p.id)) continue;
    if (f.extraId) {
      const v = p.datos_extra[f.extraId] ?? '';
      if (f.extraValor === undefined ? v === '' : v !== f.extraValor) continue;
    }
    if (f.soloConStock && Number(p.stock) <= 0) continue;
    sal.push({ codigo: p.codigo ?? '', nombre: p.nombre, rubro: rutaRubro(p.rubro_id), unidad: p.unidad, precios: elegidas.map((l) => p.precios[l.id] ?? ''), stock: p.stock });
  }
  return { listas: elegidas.map((l) => l.nombre), filas: sal, mostrarStock: f.mostrarStock };
}

export function listaDePreciosCsv(l: ListaPrecios): string {
  const enc = ['Código', 'Producto', 'Rubro', 'Unidad', ...l.listas, ...(l.mostrarStock ? ['Stock'] : [])];
  return aCsv([enc, ...l.filas.map((f) => [f.codigo, f.nombre, f.rubro, f.unidad, ...f.precios, ...(l.mostrarStock ? [f.stock] : [])])]);
}
