// Importación de listas (clientes, proveedores y productos) desde un archivo CSV (Excel: "Guardar como CSV").
// Todo corre en UNA transacción, con un SAVEPOINT por fila: una fila con error se informa y se salta, sin frenar a las demás.
// "Simular" hace todo el trabajo y deshace al final, para mostrar qué pasaría antes de importar de verdad.
import type { PoolClient } from 'pg';
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { listasEn } from './catalogo.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { esquemaCliente, esquemaProducto, esquemaProveedor, primerError } from './validacion.ts';
import { normalizarCantidad, normalizarImporte } from '../../../packages/dominio/src/index.ts';

export type TipoImportacion = 'clientes' | 'proveedores' | 'productos';
export const MAX_FILAS = 3000;

export interface ResultadoImportacion {
  total: number; creados: number; actualizados: number; omitidos: number; simulacion: boolean;
  errores: { fila: number; mensaje: string }[]; // fila = número de fila en el archivo (la 1 es el encabezado)
  erroresTotales: number;
}

// ───────── CSV ─────────
/** Lee un CSV de Excel o de cualquier planilla: separador coma, punto y coma o tabulación (se detecta solo), comillas y saltos de línea dentro de las comillas. */
export function parsearCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] ?? '';
  const candidatos = [';', '\t', ','].map((d) => ({ d, n: primera.split(d).length }));
  const delim = candidatos.reduce((a, b) => (b.n > a.n ? b : a)).d;
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entre = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (entre) {
      if (ch === '"') {
        if (t[i + 1] === '"') { celda += '"'; i++; } else entre = false;
      } else celda += ch;
    } else if (ch === '"') entre = true;
    else if (ch === delim) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      filas.push(fila); fila = [];
    } else celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

const plano = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIAS: Record<string, string[]> = {
  nombre: ['nombre', 'cliente', 'proveedor', 'razonsocial', 'producto', 'descripcion', 'nombreyapellido'],
  codigo: ['codigo', 'cod', 'sku', 'codigodebarras', 'codigobarra'],
  categoria: ['categoria', 'categoriadecliente', 'categoriadeproveedor', 'rubroproveedor'],
  contacto: ['contacto', 'persona'],
  telefono: ['telefono', 'tel', 'celular', 'whatsapp', 'movil'],
  email: ['email', 'mail', 'correo', 'correoelectronico'],
  domicilio: ['domicilio', 'direccion', 'calle'],
  localidad: ['localidad', 'ciudad', 'zona'],
  cuit: ['cuit', 'cuil', 'dni', 'documento', 'cuitdni'],
  condicioniva: ['condicioniva', 'condicion', 'condicionfrentealiva', 'situacioniva'],
  saldo: ['saldo', 'saldoinicial', 'deuda', 'saldocuentacorriente'],
  rubro: ['rubro', 'familia', 'grupo', 'linea'],
  tipo: ['tipo', 'tipodeproducto'],
  unidad: ['unidad', 'unidaddemedida', 'um'],
  costo: ['costo', 'preciocosto', 'costosiniva', 'costounitario'],
  iva: ['iva', 'alicuota', 'alicuotaiva', 'porcentajeiva'],
  stock: ['stock', 'stockactual', 'existencia', 'cantidad'],
  stockminimo: ['stockminimo', 'minimo', 'stockmin'],
  stockideal: ['stockideal', 'ideal', 'stockmax', 'stockmaximo'],
};

interface Tabla { columnas: Map<string, number>; encabezados: string[]; filas: { n: number; celdas: string[] }[] }

function tabla(texto: string): Tabla {
  const todo = parsearCsv(texto);
  if (todo.length < 2) throw new ErrorDeUsuario('El archivo está vacío o solo tiene el encabezado');
  if (todo.length - 1 > MAX_FILAS) throw new ErrorDeUsuario(`El archivo tiene ${todo.length - 1} filas: el máximo por importación es ${MAX_FILAS}. Dividilo en partes`);
  const encabezados = todo[0]!.map((h) => h.trim());
  const columnas = new Map<string, number>();
  encabezados.forEach((h, i) => {
    const p = plano(h);
    if (!p) return;
    for (const [clave, alias] of Object.entries(ALIAS)) {
      if (alias.includes(p) && !columnas.has(clave)) { columnas.set(clave, i); return; }
    }
    if (!columnas.has('raw:' + p)) columnas.set('raw:' + p, i);
  });
  return { columnas, encabezados, filas: todo.slice(1).map((celdas, i) => ({ n: i + 2, celdas })) };
}

const celda = (t: Tabla, f: { celdas: string[] }, clave: string): string => {
  const i = t.columnas.get(clave);
  return i === undefined ? '' : (f.celdas[i] ?? '').trim();
};
const tiene = (t: Tabla, clave: string): boolean => t.columnas.has(clave);

function condicionIva(txt: string): 'consumidor_final' | 'responsable_inscripto' | 'monotributo' | 'exento' | null {
  const p = plano(txt);
  if (!p) return null;
  if (p.startsWith('responsable') || p === 'ri' || p === 'inscripto') return 'responsable_inscripto';
  if (p.startsWith('monotribut') || p === 'mono') return 'monotributo';
  if (p.startsWith('exent')) return 'exento';
  if (p.startsWith('consumidor') || p === 'cf') return 'consumidor_final';
  throw new ErrorDeUsuario(`Condición frente al IVA desconocida: "${txt}" (usá Consumidor Final, Responsable Inscripto, Monotributo o Exento)`);
}

function importeConSigno(txt: string, campo: string): string | null {
  if (!txt) return null;
  const n = normalizarImporte(txt);
  if (n === null) throw new ErrorDeUsuario(`${campo}: "${txt}" no es un importe válido`);
  return n;
}

class Simulacion extends Error {
  constructor(readonly resultado: ResultadoImportacion) { super('simulacion'); }
}

// ───────── Personas (clientes y proveedores) ─────────
async function importarPersonas(c: PoolClient, s: SesionActiva, tipo: 'clientes' | 'proveedores', t: Tabla, actualizar: boolean, res: ResultadoImportacion): Promise<void> {
  const esCliente = tipo === 'clientes';
  const tablaSql = esCliente ? 'clientes' : 'proveedores';
  const categorias = new Map<string, string>();
  if (esCliente) {
    for (const f of (await c.query<{ id: string; nombre: string }>('SELECT id, nombre FROM categorias_cliente WHERE activa')).rows) categorias.set(plano(f.nombre), f.id);
  }
  for (const f of t.filas) {
    await c.query('SAVEPOINT fila');
    try {
      const nombre = celda(t, f, 'nombre');
      if (!nombre) throw new ErrorDeUsuario('Falta el nombre');
      const cond = condicionIva(celda(t, f, 'condicioniva'));
      let categoriaId: string | null = null;
      const catTxt = celda(t, f, 'categoria');
      if (esCliente && catTxt) {
        categoriaId = categorias.get(plano(catTxt)) ?? null;
        if (!categoriaId) throw new ErrorDeUsuario(`La categoría de cliente "${catTxt}" no existe: creala antes en Clientes → Categorías`);
      }
      const base = { nombre, telefono: celda(t, f, 'telefono'), email: celda(t, f, 'email'), domicilio: celda(t, f, 'domicilio'), localidad: celda(t, f, 'localidad'), cuit: celda(t, f, 'cuit') };
      const v = esCliente
        ? esquemaCliente.safeParse({ ...base, categoriaId, condicionIva: cond ?? 'consumidor_final' })
        : esquemaProveedor.safeParse({ ...base, contacto: celda(t, f, 'contacto'), categoria: catTxt, condicionIva: cond });
      if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
      const d = v.data as unknown as Record<string, string | null>;
      const saldo = importeConSigno(celda(t, f, 'saldo'), 'Saldo');

      const previo = await c.query<{ id: string }>(
        `SELECT id FROM ${tablaSql} WHERE ${esCliente ? 'NOT es_consumidor_final AND ' : ''}((cuit IS NOT NULL AND cuit = $1) OR lower(nombre) = lower($2)) ORDER BY activo DESC LIMIT 1`,
        [d.cuit, d.nombre]);
      if (previo.rows[0]) {
        if (!actualizar) { res.omitidos++; await c.query('RELEASE SAVEPOINT fila'); continue; }
        // Se actualiza solo lo que el archivo trae con dato: una celda vacía no borra lo que ya estaba cargado.
        const cambios: [string, unknown][] = [];
        const poner = (col: string, clave: string, valor: unknown) => { if (tiene(t, clave) && celda(t, f, clave) !== '') cambios.push([col, valor]); };
        poner('nombre', 'nombre', d.nombre); poner('telefono', 'telefono', d.telefono); poner('email', 'email', d.email); poner('domicilio', 'domicilio', d.domicilio);
        poner('localidad', 'localidad', d.localidad); poner('cuit', 'cuit', d.cuit); poner('condicion_iva', 'condicioniva', d.condicionIva);
        if (esCliente) poner('categoria_id', 'categoria', (d as unknown as { categoriaId: string | null }).categoriaId);
        else { poner('contacto', 'contacto', d.contacto); poner('categoria', 'categoria', d.categoria); }
        if (cambios.length) {
          await c.query(`UPDATE ${tablaSql} SET ${cambios.map(([col], i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`, [previo.rows[0].id, ...cambios.map(([, val]) => val)]);
          await auditar(c, s.usuarioId, 'modificar', esCliente ? 'cliente' : 'proveedor', { importado: true, ...Object.fromEntries(cambios) }, { entidadId: previo.rows[0].id });
        }
        res.actualizados++;
      } else {
        const valores = esCliente
          ? [d.nombre, (d as unknown as { categoriaId: string | null }).categoriaId, d.telefono, d.email, d.domicilio, d.localidad, d.cuit, d.condicionIva]
          : [d.nombre, d.contacto, d.categoria, d.telefono, d.email, d.domicilio, d.localidad, d.cuit, d.condicionIva];
        const r = await c.query<{ id: string }>(
          esCliente
            ? 'INSERT INTO clientes (tenant_id, nombre, categoria_id, telefono, email, domicilio, localidad, cuit, condicion_iva) VALUES (app.tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id'
            : 'INSERT INTO proveedores (tenant_id, nombre, contacto, categoria, telefono, email, domicilio, localidad, cuit, condicion_iva) VALUES (app.tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          valores);
        const id = r.rows[0]!.id;
        await auditar(c, s.usuarioId, 'crear', esCliente ? 'cliente' : 'proveedor', { importado: true, ...d }, { entidadId: id });
        if (saldo && Number(saldo) !== 0) {
          await c.query(
            `INSERT INTO cuenta_corriente_movimientos (tenant_id, ${esCliente ? 'cliente_id' : 'proveedor_id'}, tipo, importe, concepto, usuario_id)
             VALUES (app.tenant_id(), $1, 'saldo_inicial', $2, 'Saldo inicial (importación)', $3)`, [id, saldo, s.usuarioId]);
        }
        res.creados++;
      }
      await c.query('RELEASE SAVEPOINT fila');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT fila');
      anotarError(res, f.n, e);
    }
  }
}

function anotarError(res: ResultadoImportacion, fila: number, e: unknown): void {
  const codigo = (e as { code?: string }).code;
  const mensaje = e instanceof ErrorDeUsuario ? e.message
    : codigo === '23505' ? 'Ya existe otro registro con ese código o nombre'
    : codigo === '23514' ? 'Algún dato no cumple las reglas (largo o formato)'
    : null;
  if (mensaje === null) throw e; // un error inesperado no se esconde
  res.erroresTotales++;
  if (res.errores.length < 100) res.errores.push({ fila, mensaje });
}

// ───────── Productos ─────────
async function rubroPorRuta(c: PoolClient, s: SesionActiva, ruta: string, cache: Map<string, string>): Promise<string> {
  let padre: string | null = null;
  let acumulado = '';
  for (const parte of ruta.split(/[>/]/).map((x) => x.trim()).filter(Boolean)) {
    acumulado += '>' + plano(parte);
    const enCache = cache.get(acumulado);
    if (enCache) { padre = enCache; continue; }
    const r: { rows: { id: string }[] } = await c.query('SELECT id FROM rubros WHERE lower(nombre) = lower($1) AND padre_id IS NOT DISTINCT FROM $2 LIMIT 1', [parte, padre]);
    let id = r.rows[0]?.id;
    if (!id) {
      id = (await c.query<{ id: string }>('INSERT INTO rubros (tenant_id, nombre, padre_id) VALUES (app.tenant_id(), $1, $2) RETURNING id', [parte, padre])).rows[0]!.id;
      await auditar(c, s.usuarioId, 'crear', 'rubro', { nombre: parte, padreId: padre, importado: true }, { entidadId: id });
    }
    cache.set(acumulado, id);
    padre = id;
  }
  if (!padre) throw new ErrorDeUsuario('Rubro vacío');
  return padre;
}

function alicuotaDe(txt: string): number {
  if (!txt) return 21;
  const n = Number(txt.replace('%', '').replace(',', '.').trim());
  if (![0, 10.5, 21, 27].includes(n)) throw new ErrorDeUsuario(`IVA "${txt}" no válido (usá 0, 10,5, 21 o 27)`);
  return n;
}

async function importarProductos(c: PoolClient, s: SesionActiva, t: Tabla, actualizar: boolean, res: ResultadoImportacion): Promise<void> {
  const listas = await listasEn(c);
  const columnaLista = new Map<string, number>(); // id de lista → columna del archivo
  for (const l of listas) {
    const p = plano(l.nombre);
    for (const clave of [`raw:${p}`, `raw:precio${p}`, `raw:precios${p}`, `raw:pv${p}`]) {
      const i = t.columnas.get(clave);
      if (i !== undefined) { columnaLista.set(l.id, i); break; }
    }
  }
  const cacheRubros = new Map<string, string>();
  for (const f of t.filas) {
    await c.query('SAVEPOINT fila');
    try {
      const nombre = celda(t, f, 'nombre');
      if (!nombre) throw new ErrorDeUsuario('Falta el nombre');
      const rubroTxt = celda(t, f, 'rubro') || celda(t, f, 'categoria');
      const rubroId = rubroTxt ? await rubroPorRuta(c, s, rubroTxt, cacheRubros) : null;
      const precios: Record<string, string> = {};
      for (const [listaId, i] of columnaLista) {
        const txt = (f.celdas[i] ?? '').trim();
        if (txt) {
          const n = normalizarImporte(txt);
          if (n === null || n.startsWith('-')) throw new ErrorDeUsuario(`Precio "${txt}" no válido`);
          precios[listaId] = n;
        }
      }
      const cant = (clave: string, nombreCampo: string): string => {
        const txt = celda(t, f, clave);
        if (!txt) return '';
        const n = normalizarCantidad(txt);
        if (n === null) throw new ErrorDeUsuario(`${nombreCampo}: "${txt}" no es una cantidad válida`);
        return n;
      };
      const stockInicial = cant('stock', 'Stock');
      const v = esquemaProducto.safeParse({
        codigo: celda(t, f, 'codigo'), nombre, rubroId, tipo: celda(t, f, 'tipo'), unidad: celda(t, f, 'unidad') || 'unidad', costo: celda(t, f, 'costo'),
        stockMinimo: cant('stockminimo', 'Stock mínimo'), stockIdeal: cant('stockideal', 'Stock ideal'), iva: alicuotaDe(celda(t, f, 'iva')),
        vendible: true, comprable: true, integrable: true, publicadoWeb: false, urlWeb: '', precios,
      });
      if (!v.success) throw new ErrorDeUsuario(primerError(v.error));
      const d = v.data;

      const previo = await c.query<{ id: string }>(
        d.codigo
          ? 'SELECT id FROM productos WHERE lower(codigo) = lower($1) OR (codigo IS NULL AND lower(nombre) = lower($2)) ORDER BY activo DESC LIMIT 1'
          : 'SELECT id FROM productos WHERE lower(nombre) = lower($2) AND $1::text IS NULL ORDER BY activo DESC LIMIT 1',
        [d.codigo, d.nombre]);
      let id: string;
      if (previo.rows[0]) {
        if (!actualizar) { res.omitidos++; await c.query('RELEASE SAVEPOINT fila'); continue; }
        id = previo.rows[0].id;
        // Solo se actualiza lo que el archivo trae con dato: una celda vacía no borra lo que ya estaba cargado.
        const cambios: [string, unknown][] = [];
        const poner = (col: string, clave: string, valor: unknown) => { if (tiene(t, clave) && celda(t, f, clave) !== '') cambios.push([col, valor]); };
        poner('nombre', 'nombre', d.nombre); poner('codigo', 'codigo', d.codigo); poner('tipo', 'tipo', d.tipo); poner('unidad', 'unidad', d.unidad); poner('costo', 'costo', d.costo);
        poner('iva', 'iva', d.iva); poner('stock_minimo', 'stockminimo', d.stockMinimo); poner('stock_ideal', 'stockideal', d.stockIdeal);
        if (rubroId) cambios.push(['rubro_id', rubroId]);
        if (cambios.length) await c.query(`UPDATE productos SET ${cambios.map(([col], i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cambios.map(([, val]) => val)]);
        await auditar(c, s.usuarioId, 'modificar', 'producto', { importado: true, ...Object.fromEntries(cambios), precios }, { entidadId: id });
        res.actualizados++;
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO productos (tenant_id, codigo, nombre, rubro_id, tipo, unidad, costo, iva, vendible, comprable, integrable, publicado_web, url_web, stock_minimo, stock_ideal)
           VALUES (app.tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [d.codigo, d.nombre, d.rubroId, d.tipo, d.unidad, d.costo, d.iva, d.vendible, d.comprable, d.integrable, d.publicadoWeb, d.urlWeb, d.stockMinimo, d.stockIdeal]);
        id = r.rows[0]!.id;
        await auditar(c, s.usuarioId, 'crear', 'producto', { importado: true, ...d }, { entidadId: id });
        if (stockInicial && Number(stockInicial) !== 0) {
          await c.query(
            `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, concepto, usuario_id)
             VALUES (app.tenant_id(), $1, 'saldo_inicial', $2, 'Stock inicial (importación)', $3)`, [id, stockInicial, s.usuarioId]);
        }
        res.creados++;
      }
      for (const [listaId, precio] of Object.entries(d.precios)) {
        await c.query(
          `INSERT INTO producto_precios (tenant_id, producto_id, lista_id, precio) VALUES (app.tenant_id(), $1, $2, $3)
           ON CONFLICT (producto_id, lista_id) DO UPDATE SET precio = EXCLUDED.precio`, [id, listaId, precio]);
      }
      await c.query('RELEASE SAVEPOINT fila');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT fila');
      anotarError(res, f.n, e);
    }
  }
}

// ───────── Punto de entrada ─────────
export async function importarLista(s: SesionActiva, tipo: TipoImportacion, texto: string, opciones: { actualizar: boolean; simular: boolean }): Promise<ResultadoImportacion> {
  if (tipo !== 'clientes' && tipo !== 'proveedores' && tipo !== 'productos') throw new ErrorDeUsuario('Tipo de importación desconocido');
  exigir(s, tipo);
  const t = tabla(String(texto ?? ''));
  if (!tiene(t, 'nombre')) throw new ErrorDeUsuario('No encuentro la columna del nombre: el encabezado tiene que tener una columna "Nombre"');
  const res: ResultadoImportacion = { total: t.filas.length, creados: 0, actualizados: 0, omitidos: 0, simulacion: opciones.simular, errores: [], erroresTotales: 0 };
  try {
    return await conTenant(s.tenantId, async (c) => {
      if (tipo === 'productos') await importarProductos(c, s, t, opciones.actualizar, res);
      else await importarPersonas(c, s, tipo, t, opciones.actualizar, res);
      if (!opciones.simular) await auditar(c, s.usuarioId, 'importar', tipo, { filas: res.total, creados: res.creados, actualizados: res.actualizados, omitidos: res.omitidos, errores: res.erroresTotales });
      if (opciones.simular) throw new Simulacion(res); // se deshace todo: solo era una vista previa
      return res;
    });
  } catch (e) {
    if (e instanceof Simulacion) return e.resultado;
    throw e;
  }
}

/** Encabezados de la plantilla descargable. */
export function plantilla(tipo: TipoImportacion, listas: string[]): string {
  const filas: Record<TipoImportacion, string[][]> = {
    clientes: [
      ['Nombre', 'Categoría', 'Teléfono', 'Email', 'Domicilio', 'Localidad', 'CUIT', 'Condición IVA', 'Saldo'],
      ['Juana Pérez', '', '2615550000', 'juana@correo.com', 'San Martín 123', 'Mendoza', '', 'Consumidor Final', '0'],
    ],
    proveedores: [
      ['Nombre', 'Contacto', 'Categoría', 'Teléfono', 'Email', 'Domicilio', 'Localidad', 'CUIT', 'Condición IVA', 'Saldo'],
      ['Distribuidora Andes', 'Carlos', 'Mercadería', '2615551111', 'ventas@andes.com', 'Belgrano 45', 'Godoy Cruz', '30712345678', 'Responsable Inscripto', '0'],
    ],
    productos: [
      ['Código', 'Nombre', 'Rubro', 'Tipo', 'Unidad', 'Costo', 'IVA', 'Stock', 'Stock mínimo', 'Stock ideal', ...listas],
      ['A001', 'Miel 500g', 'Almacén > Dulces', 'Miel', 'unidad', '2500', '21', '12', '4', '20', ...listas.map(() => '4500')],
    ],
  };
  return filas[tipo].map((f) => f.map((x) => (/[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(';')).join('\r\n') + '\r\n';
}
