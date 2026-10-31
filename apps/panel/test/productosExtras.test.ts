// Productos: proveedor, datos extras, historial, modificación masiva, exportación y listas de precios.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja } from '../lib/cajas.ts';
import { crearRubro, guardarProducto, listarProductos, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarCompra } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import {
  asignarValorExtra, buscarProductosParaExtra, crearDatoExtra, datosExtraConValores, detalleDatoExtra, listarDatosExtra, quitarDatoExtra, quitarValorExtra,
  renombrarDatoExtra, renombrarValorExtra,
} from '../lib/extras.ts';
import { historialDeProducto } from '../lib/historialProducto.ts';
import { importarLista } from '../lib/importar.ts';
import { modificacionMasiva, type EntradaMasiva } from '../lib/masiva.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { exportarProductosCsv, listaDePrecios, listaDePreciosCsv } from '../lib/productosArchivos.ts';
import { guardarProveedor } from '../lib/personas.ts';
import { buscarClientesParaVenta, cerrarVenta, guardarMedioDePago } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let minorista = '', mayorista = '';
let provX = '', provY = '';
let rubroTe = '', rubroInfusiones = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const prov = (nombre: string) => guardarProveedor(A, null, { nombre, contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
const producto = (nombre: string, costo: string, min: string, may: string, extra: object = {}) =>
  guardarProducto(A, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo, iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [minorista]: min, [mayorista]: may }, stockMinimo: '', stockIdeal: '', ...extra });
const masiva = (over: Partial<EntradaMasiva>, simular = false) =>
  modificacionMasiva(A, { proveedorId: provX, rubroId: null, listaIds: null, modo: 'mantener_utilidad', tipo: 'pct', valor: '10', ...over }, { simular });

before(async () => {
  A = await sesionDe(`pro-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`pro-b-${sufijo}`, 'b@ejemplo.test');
  const listas = await listasDePrecios(A);
  minorista = listas[0]!.id; mayorista = listas[1]!.id;
  provX = await prov('Proveedor X');
  provY = await prov('Proveedor Y');
  rubroInfusiones = await crearRubro(A, { nombre: 'Infusiones', padreId: null });
  rubroTe = await crearRubro(A, { nombre: 'Tés', padreId: rubroInfusiones });
});
after(async () => {
  await cerrarPool();
});

test('el producto guarda su proveedor y se filtra por él; el proveedor debe existir', async () => {
  const p = await producto('Té verde', '100', '200', '150', { proveedorId: provX });
  assert.equal((await obtenerProducto(A, p))?.proveedorId, provX);
  assert.equal((await listarProductos(A, { proveedorId: provX })).total, 1);
  assert.equal((await listarProductos(A, { proveedorId: provY })).total, 0);
  await assert.rejects(producto('Con proveedor inexistente', '1', '2', '2', { proveedorId: randomUUID() }), ErrorDeUsuario);
  // Si no se manda el proveedor al modificar, se conserva.
  await guardarProducto(A, p, { codigo: '', nombre: 'Té verde', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [minorista]: '200' }, stockMinimo: '', stockIdeal: '' });
  assert.equal((await obtenerProducto(A, p))?.proveedorId, provX);
  await guardarProducto(A, p, { codigo: '', nombre: 'Té verde', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [minorista]: '200' }, stockMinimo: '', stockIdeal: '', proveedorId: null });
  assert.equal((await obtenerProducto(A, p))?.proveedorId, null);
});

test('datos extras: se crean, renombran y quitan; no se repiten nombres; requieren permiso de ajustes', async () => {
  const feria = await crearDatoExtra(A, 'Ferias');
  await assert.rejects(crearDatoExtra(A, 'ferias'), ErrorDeUsuario);
  await assert.rejects(crearDatoExtra(A, '  '), ErrorDeUsuario);
  await renombrarDatoExtra(A, feria, 'Ferias y eventos');
  assert.ok((await listarDatosExtra(A)).some((d) => d.nombre === 'Ferias y eventos'));
  await quitarDatoExtra(A, feria);
  assert.ok(!(await listarDatosExtra(A)).some((d) => d.id === feria));
  await assert.rejects(quitarDatoExtra(A, feria), ErrorDeUsuario);
  const sin: SesionActiva = { ...A, rol: 'cocina', permisos: [] };
  await assert.rejects(crearDatoExtra(sin, 'No debería'), ErrorDePermiso);
});

test('valores de un dato extra: en la ficha, por lote, renombrar, quitar, y filtros', async () => {
  const lm = await crearDatoExtra(A, 'Lista mayorista');
  const a = await producto('Mate', '10', '20', '15', { extras: { [lm]: 'Sí' } });
  const b = await producto('Bombilla', '10', '20', '15');
  const c = await producto('Yerba', '10', '20', '15');
  assert.deepEqual((await obtenerProducto(A, a))?.extras, { [lm]: 'Sí' });
  await assert.rejects(producto('Dato inexistente', '1', '2', '2', { extras: { [randomUUID()]: 'x' } }), ErrorDeUsuario);

  assert.equal(await asignarValorExtra(A, lm, 'Sí', [b, c]), 2);
  let d = await detalleDatoExtra(A, lm);
  assert.equal(d?.valores.length, 1);
  assert.equal(d?.valores[0]?.productos.length, 3);

  assert.equal(await renombrarValorExtra(A, lm, 'Sí', 'Mayorista'), 3);
  assert.equal((await listarProductos(A, { extraId: lm, extraValor: 'Mayorista' })).total, 3);
  assert.equal((await listarProductos(A, { extraId: lm, extraValor: 'Sí' })).total, 0);

  await asignarValorExtra(A, lm, '', [c]);                                 // valor vacío = quitarlo
  assert.equal((await listarProductos(A, { extraId: lm })).total, 2);       // con algún valor
  assert.ok((await listarProductos(A, { extraId: lm, extraValor: '' })).filas.some((f) => f.id === c));   // sin valor
  assert.deepEqual((await datosExtraConValores(A)).find((x) => x.id === lm)?.valores, ['Mayorista']);

  assert.equal(await quitarValorExtra(A, lm, 'Mayorista'), 2);
  d = await detalleDatoExtra(A, lm);
  assert.equal(d?.valores.length, 0);
  assert.ok((await buscarProductosParaExtra(A, 'bombi')).some((x) => x.id === b));
  await assert.rejects(asignarValorExtra(A, lm, 'X', []), ErrorDeUsuario);
  await assert.rejects(asignarValorExtra(A, randomUUID(), 'X', [a]), ErrorDeUsuario);
});

test('los datos extras de un comercio no se ven ni se tocan desde otro', async () => {
  const lm = (await listarDatosExtra(A))[0]!.id;
  assert.equal((await listarDatosExtra(B)).length, 0);
  assert.equal(await detalleDatoExtra(B, lm), null);
  await assert.rejects(asignarValorExtra(B, lm, 'X', [randomUUID()]), ErrorDeUsuario);
});

test('modificación masiva: mantener utilidad cambia costo y precios en la misma proporción', async () => {
  const p = await producto('Masiva 1', '100', '200', '150', { proveedorId: provX });
  const q = await producto('Masiva 2', '50', '100', '80', { proveedorId: provX });
  const otro = await producto('De otro proveedor', '100', '200', '150', { proveedorId: provY });
  const sim = await masiva({}, true);
  assert.equal(sim.aplicado, false);
  assert.ok(sim.cambian >= 2);
  assert.equal(Number((await obtenerProducto(A, p))?.costo), 100);          // la vista previa no guarda nada
  const r = await masiva({});
  assert.equal(r.aplicado, true);
  const dp = await obtenerProducto(A, p);
  assert.equal(Number(dp?.costo), 110);
  assert.equal(Number(dp?.precios[minorista]), 220);
  assert.equal(Number(dp?.precios[mayorista]), 165);
  assert.equal(Number((await obtenerProducto(A, q))?.costo), 55);
  assert.equal(Number((await obtenerProducto(A, otro))?.costo), 100);        // otro proveedor: intacto
  const aud = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad = 'producto' AND entidad_id = $1 ORDER BY id DESC LIMIT 1", [p]));
  assert.equal(aud.rows[0].accion, 'modificar');
});

test('modificación masiva: solo costo, solo ciertas listas, importe, piso en cero y filtro obligatorio', async () => {
  const p = await producto('Masiva 3', '100', '200', '150', { proveedorId: provY });
  await masiva({ proveedorId: provY, modo: 'mantener_precio', tipo: 'pct', valor: '-10' });
  let d = await obtenerProducto(A, p);
  assert.equal(Number(d?.costo), 90);
  assert.equal(Number(d?.precios[minorista]), 200);                          // el precio no se toca
  await masiva({ proveedorId: provY, listaIds: [minorista], tipo: 'imp', valor: '10' });
  d = await obtenerProducto(A, p);
  assert.equal(Number(d?.costo), 100);
  assert.equal(Number(d?.precios[minorista]), 222.22);                       // 200 × 100 ÷ 90
  assert.equal(Number(d?.precios[mayorista]), 150);                          // lista no elegida
  await masiva({ proveedorId: provY, tipo: 'imp', valor: '-99999', modo: 'mantener_precio' });
  assert.equal(Number((await obtenerProducto(A, p))?.costo), 0);
  await assert.rejects(masiva({ proveedorId: null, rubroId: null }), ErrorDeUsuario);
  await assert.rejects(masiva({ valor: '0' }), ErrorDeUsuario);
  await assert.rejects(masiva({ valor: 'abc' }), ErrorDeUsuario);
  await assert.rejects(masiva({ listaIds: [] }), ErrorDeUsuario);
});

test('modificación masiva por rubro incluye los subrubros y no toca archivados', async () => {
  const p = await producto('Té en hebras', '100', '200', '150', { rubroId: rubroTe });
  const arch = await producto('Té archivado', '100', '200', '150', { rubroId: rubroTe });
  await conTenant(A.tenantId, (c) => c.query('UPDATE productos SET activo = false WHERE id = $1', [arch]));
  await masiva({ proveedorId: null, rubroId: rubroInfusiones, modo: 'mantener_precio', valor: '20' });
  assert.equal(Number((await obtenerProducto(A, p))?.costo), 120);
  assert.equal(Number((await obtenerProducto(A, arch))?.costo), 100);
});

test('modificación masiva: otro comercio no ve productos ni proveedores de este', async () => {
  const r = await modificacionMasiva(B, { proveedorId: provX, rubroId: null, listaIds: null, modo: 'mantener_precio', tipo: 'pct', valor: '50' }, { simular: false });
  assert.equal(r.coinciden, 0);
});

test('historial del producto: ventas y compras con sus totales', async () => {
  const caja = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, caja, { contado: '10000' });
  const medio = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [caja] });
  const consumidor = (await buscarClientesParaVenta(A, 'consumidor'))[0]!.id;
  const p = await producto('Con historial', '100', '200', '150', { proveedorId: provX });
  await cerrarCompra(A, { clave: randomUUID(), proveedorId: provX, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: p, descripcion: '', cantidad: '10', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'caja', cajaId: caja } });
  await cerrarVenta(A, { clave: randomUUID(), clienteId: consumidor, comprobante: 'remito', nroComprobante: '', listaId: minorista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [{ productoId: p, descripcion: '', cantidad: '3', precio: '200', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: caja } });
  const h = await historialDeProducto(A, p);
  assert.equal(h.ventas.length, 1);
  assert.equal(h.compras.length, 1);
  assert.equal(Number(h.totalVendido), 3);
  assert.equal(Number(h.totalComprado), 10);
  assert.equal(Number(h.ventas[0]!.importe), 600);
  assert.equal((await historialDeProducto(B, p)).ventas.length, 0);
});

test('exportar: columnas elegidas, rubro con ruta, proveedor, precios y extras; requiere permiso de descarga', async () => {
  await producto('Exportable', '100', '200', '150', { codigo: 'EXP1', rubroId: rubroTe, proveedorId: provX });
  const csv = await exportarProductosCsv(A, ['rubro', 'proveedor', 'costo', 'precios', 'extras']);
  const [enc, ...filas] = csv.replace('﻿', '').trim().split('\r\n');
  assert.deepEqual(enc!.split(';').slice(0, 7), ['Código', 'Nombre', 'Rubro', 'Proveedor', 'Costo', 'Minorista', 'Mayorista']);
  const f = filas.find((x) => x.startsWith('EXP1;'))!.split(';');
  assert.deepEqual(f.slice(0, 7), ['EXP1', 'Exportable', 'Infusiones > Tés', 'Proveedor X', '100.00', '200.00', '150.00']);
  const solo = await exportarProductosCsv(A, []);
  assert.equal(solo.replace('﻿', '').split('\r\n')[0], 'Código;Nombre');
  await assert.rejects(exportarProductosCsv({ ...A, rol: 'cocina', permisos: [] }, ['costo']), ErrorDePermiso);
});

test('lo exportado se puede volver a importar: proveedor y datos extras incluidos', async () => {
  const lm = (await listarDatosExtra(A))[0]!;
  const e = await producto('Ida y vuelta', '10', '20', '15', { codigo: 'IV1', proveedorId: provX, extras: { [lm.id]: 'Mayorista' } });
  const csv = await exportarProductosCsv(A, ['proveedor', 'costo', 'precios', 'extras']);
  const r = await importarLista(B, 'productos', csv, { actualizar: false, simular: true });
  assert.ok(r.erroresTotales >= 1, JSON.stringify(r.errores));                 // en el otro comercio el proveedor X no existe: se informa, no se inventa
  const r2 = await importarLista(A, 'productos', csv, { actualizar: true, simular: false });
  assert.equal(r2.erroresTotales, 0, JSON.stringify(r2.errores));
  assert.equal((await obtenerProducto(A, e))?.proveedorId, provX);
  assert.deepEqual((await obtenerProducto(A, e))?.extras, { [lm.id]: 'Mayorista' });
});

test('importar productos nuevos con proveedor y datos extras', async () => {
  const dato = await crearDatoExtra(A, 'Categoría de fracción');
  const csv = `Código;Nombre;Proveedor;Categoría de fracción;Costo\nIMP1;Importado uno;Proveedor Y;Fraccionable;40\nIMP2;Importado dos;No existe;;40`;
  const r = await importarLista(A, 'productos', csv, { actualizar: false, simular: false });
  assert.deepEqual([r.creados, r.erroresTotales], [1, 1]);
  const p = (await conTenant(A.tenantId, (c) => c.query("SELECT proveedor_id, datos_extra FROM productos WHERE codigo = 'IMP1'"))).rows[0];
  assert.equal(p.proveedor_id, provY);
  assert.deepEqual(p.datos_extra, { [dato]: 'Fraccionable' });
  assert.equal(r.errores[0]!.fila, 3);
});

test('lista de precios: solo vendibles, filtros, solo con stock y CSV', async () => {
  const lm = (await listarDatosExtra(A)).find((d) => d.nombre === 'Lista mayorista')!;
  const v = await producto('Lista visible', '10', '20', '15', { codigo: 'LV1', proveedorId: provY, extras: { [lm.id]: 'Mayorista' } });
  await producto('Lista oculta', '10', '20', '15', { codigo: 'LO1', vendible: false, proveedorId: provY, extras: { [lm.id]: 'Mayorista' } });
  const base = { listaIds: [minorista], soloConStock: false, mostrarStock: true };
  const l = await listaDePrecios(A, { ...base, proveedorId: provY, extraId: lm.id, extraValor: 'Mayorista' });
  assert.ok(l.filas.some((f) => f.codigo === 'LV1'));
  assert.ok(!l.filas.some((f) => f.codigo === 'LO1'));                       // no vendible
  assert.deepEqual(l.listas, ['Minorista']);
  const conStock = await listaDePrecios(A, { ...base, soloConStock: true, proveedorId: provY });
  assert.ok(!conStock.filas.some((f) => f.codigo === 'LV1'));                // sin stock
  const csv = listaDePreciosCsv(l).replace('﻿', '').split('\r\n');
  assert.equal(csv[0], 'Código;Producto;Rubro;Unidad;Minorista;Stock');
  assert.ok(csv.some((x) => x.startsWith('LV1;Lista visible;')));
  assert.equal((await listaDePrecios(B, base)).filas.length, 0);
  void v;
});
