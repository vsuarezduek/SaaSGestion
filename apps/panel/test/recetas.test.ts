// Recetas, elaboración y costos fijos: costo por unidad, elaboración atómica sobre el libro de stock, anulación y reparto del costo fijo.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { agregarCostoFijo, fijarCantidadCostoFijo, guardarConfigCostosFijos, obtenerCostosFijos, quitarCostoFijo } from '../lib/costosFijos.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import {
  agregarIngrediente, anularElaboracion, aplicarCostoReceta, buscarIngredientes, fijarCantidadIngrediente, guardarInstrucciones, guardarRinde,
  obtenerReceta, previsualizarElaboracion, quitarIngrediente, registrarElaboracion,
} from '../lib/recetas.ts';
import { registrarStock, revertirStock } from '../lib/stock.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '';
let harina = '', manteca = '', torta = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const producto = (nombre: string, costo: string, precio: string) =>
  guardarProducto(A, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo, iva: 21, vendible: true, comprable: true, integrable: true, publicadoWeb: false, urlWeb: '', precios: { [lista]: precio }, stockMinimo: '', stockIdeal: '' });
const stockDe = async (id: string) => Number((await obtenerProducto(A, id))?.stock);
const elaborar = (cantidad: string, over: Record<string, unknown> = {}, S: SesionActiva = A, productoId = torta) =>
  registrarElaboracion(S, { clave: randomUUID(), productoId, cantidad, fecha: '', nota: '', ...over });

before(async () => {
  A = await sesionDe(`rec-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`rec-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  harina = await producto('Harina', '100', '150');
  manteca = await producto('Manteca', '400', '600');
  torta = await producto('Torta', '20', '1000');
  await registrarStock(A, harina, { tipo: 'saldo_inicial', cantidad: '100', concepto: '' });
  await registrarStock(A, manteca, { tipo: 'saldo_inicial', cantidad: '10', concepto: '' });
});
after(async () => {
  await cerrarPool();
});

test('receta: ingredientes, rendimiento y costo por unidad', async () => {
  await agregarIngrediente(A, torta, harina);
  await agregarIngrediente(A, torta, manteca);
  await fijarCantidadIngrediente(A, torta, harina, '2');
  await fijarCantidadIngrediente(A, torta, manteca, '0,5');
  await guardarRinde(A, torta, '10');
  const r = (await obtenerReceta(A, torta))!;
  assert.equal(r.ingredientes.length, 2);
  assert.equal(Number(r.costoIngredientes), 40);              // (2×100 + 0,5×400) ÷ 10
  assert.equal(Number(r.costoReceta), 40);
  assert.equal(Number(r.costoActual), 20);
  await agregarIngrediente(A, torta, harina);                  // agregar uno existente suma 1
  assert.equal(Number((await obtenerReceta(A, torta))!.ingredientes.find((i) => i.id === harina)!.cantidad), 3);
  await fijarCantidadIngrediente(A, torta, harina, '2');
  await guardarInstrucciones(A, torta, 'Mezclar y hornear');
  assert.equal((await obtenerReceta(A, torta))!.instrucciones, 'Mezclar y hornear');
});

test('receta: validaciones (rinde, cantidades, sí mismo, circular, inexistentes)', async () => {
  await assert.rejects(guardarRinde(A, torta, '0'), ErrorDeUsuario);
  await assert.rejects(guardarRinde(A, torta, 'abc'), ErrorDeUsuario);
  await assert.rejects(fijarCantidadIngrediente(A, torta, harina, '0'), ErrorDeUsuario);
  await assert.rejects(fijarCantidadIngrediente(A, torta, randomUUID(), '1'), ErrorDeUsuario);
  await assert.rejects(agregarIngrediente(A, torta, torta), ErrorDeUsuario);
  await assert.rejects(agregarIngrediente(A, torta, randomUUID()), ErrorDeUsuario);
  await assert.rejects(agregarIngrediente(A, harina, torta), ErrorDeUsuario);          // torta ya usa harina: circular
  const alfajor = await producto('Alfajor', '5', '100');
  await agregarIngrediente(A, alfajor, torta);                                         // un elaborado puede ser ingrediente de otro
  await assert.rejects(agregarIngrediente(A, torta, alfajor), ErrorDeUsuario);         // pero no en círculo
  await assert.rejects(quitarIngrediente(A, torta, alfajor), ErrorDeUsuario);
});

test('aplicar el costo de la receta: mantener utilidad o solo costo', async () => {
  const antes = await obtenerProducto(A, torta);
  assert.equal(Number(antes?.costo), 20);
  const solo = await producto('Solo costo', '20', '1000');
  await agregarIngrediente(A, solo, harina);
  await fijarCantidadIngrediente(A, solo, harina, '1');
  assert.equal(await aplicarCostoReceta(A, solo, false), '100.00');
  assert.equal(Number((await obtenerProducto(A, solo))?.precios[lista]), 1000);
  assert.equal(await aplicarCostoReceta(A, torta, true), '40.00');
  const d = await obtenerProducto(A, torta);
  assert.equal(Number(d?.costo), 40);
  assert.equal(Number(d?.precios[lista]), 2000);                                       // 1000 × 40 ÷ 20
  const sin = await producto('Sin receta', '10', '20');
  await assert.rejects(aplicarCostoReceta(A, sin, true), ErrorDeUsuario);
});

test('elaborar: suma el producto, resta los ingredientes proporcionalmente y es idempotente', async () => {
  const h0 = await stockDe(harina), m0 = await stockDe(manteca), t0 = await stockDe(torta);
  const prev = await previsualizarElaboracion(A, torta, '20');
  assert.deepEqual(prev.map((p) => [p.nombre, Number(p.usa)]), [['Harina', 4], ['Manteca', 1]]);
  const clave = randomUUID();
  const r = await elaborar('20', { clave });
  assert.equal(r.repetida, false);
  assert.deepEqual(r.faltantes, []);
  assert.equal(await stockDe(torta), t0 + 20);
  assert.equal(await stockDe(harina), h0 - 4);
  assert.equal(await stockDe(manteca), m0 - 1);
  const otra = await elaborar('20', { clave });
  assert.equal(otra.repetida, true);
  assert.equal(otra.id, r.id);
  assert.equal(await stockDe(torta), t0 + 20);
  const rec = (await obtenerReceta(A, torta))!;
  assert.equal(rec.elaboraciones[0]!.numero, r.numero);
  assert.deepEqual(rec.elaboraciones[0]!.insumos.map((i) => i.nombre), ['Harina', 'Manteca']);
});

test('anular una elaboración devuelve los ingredientes y descuenta lo elaborado, sin borrar nada', async () => {
  const h0 = await stockDe(harina), m0 = await stockDe(manteca), t0 = await stockDe(torta);
  const r = await elaborar('10');
  await assert.rejects(anularElaboracion(A, r.id, 'x'), ErrorDeUsuario);               // motivo obligatorio
  await anularElaboracion(A, r.id, 'cargada por error');
  assert.equal(await stockDe(torta), t0);
  assert.equal(await stockDe(harina), h0);
  assert.equal(await stockDe(manteca), m0);
  await assert.rejects(anularElaboracion(A, r.id, 'otra vez'), ErrorDeUsuario);
  const mov = await conTenant(A.tenantId, (c) => c.query("SELECT tipo, revierte_id IS NOT NULL AS rev FROM stock_movimientos WHERE elaboracion_id = $1 ORDER BY id", [r.id]));
  assert.equal(mov.rows.length, 6);                                                    // 3 originales + 3 reversiones
  assert.equal(mov.rows.filter((x) => x.rev).length, 3);
});

test('elaborar sin stock suficiente se permite pero avisa; sin receta o con datos inválidos se rechaza', async () => {
  const poco = await producto('Poco stock', '10', '20');
  const dulce = await producto('Dulce', '1', '5');
  await agregarIngrediente(A, dulce, poco);
  const r = await elaborar('5', {}, A, dulce);
  assert.equal(r.faltantes.length, 1);
  assert.equal(r.faltantes[0]!.nombre, 'Poco stock');
  const sin = await producto('Sin ingredientes', '1', '2');
  await assert.rejects(elaborar('1', {}, A, sin), ErrorDeUsuario);
  await assert.rejects(elaborar('0'), ErrorDeUsuario);
  await assert.rejects(elaborar('-3'), ErrorDeUsuario);
  await assert.rejects(elaborar('1', {}, A, randomUUID()), ErrorDeUsuario);
});

test('los movimientos de una elaboración no se revierten a mano desde el producto', async () => {
  const r = await elaborar('2');
  const mov = await conTenant(A.tenantId, (c) => c.query<{ id: string }>("SELECT id::text FROM stock_movimientos WHERE elaboracion_id = $1 AND producto_id = $2", [r.id, torta]));
  await assert.rejects(revertirStock(A, torta, mov.rows[0]!.id), ErrorDeUsuario);
});

test('las elaboraciones y sus insumos no se borran ni se editan a mano', async () => {
  const r = await elaborar('1');
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('DELETE FROM elaboraciones WHERE id = $1', [r.id])));
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('UPDATE elaboraciones SET cantidad = 99 WHERE id = $1', [r.id])));
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('UPDATE elaboracion_insumos SET cantidad = 99 WHERE elaboracion_id = $1', [r.id])));
});

test('costos fijos: sin elaboraciones es cero; con elaboraciones se reparte por unidades o por costo de ingredientes', async () => {
  const sesionSin: SesionActiva = { ...A, rol: 'cocina', permisos: [] };
  await assert.rejects(guardarConfigCostosFijos(sesionSin, { activo: true, dias: 30, base: 'unidades' }), ErrorDePermiso);
  await assert.rejects(guardarConfigCostosFijos(A, { activo: true, dias: 0, base: 'unidades' }), ErrorDeUsuario);
  await assert.rejects(guardarConfigCostosFijos(A, { activo: true, dias: 30, base: 'raro' }), ErrorDeUsuario);

  const alquiler = await producto('Alquiler', '15000', '0');
  await agregarCostoFijo(A, alquiler);
  await fijarCantidadCostoFijo(A, alquiler, '1');
  await assert.rejects(fijarCantidadCostoFijo(A, alquiler, '0'), ErrorDeUsuario);
  await guardarConfigCostosFijos(A, { activo: true, dias: 30, base: 'unidades' });

  let cf = await obtenerCostosFijos(A);
  assert.equal(Number(cf.totalMensual), 15000);

  // Total elaborado en el período (torta y dulce, de los tests anteriores) y reparto parejo por unidad.
  cf = await obtenerCostosFijos(A);
  const unidades = cf.produccion.reduce((a, p) => a + Number(p.unidades), 0);
  assert.ok(unidades > 0);
  const esperado = Math.round((15000 / unidades) * 100) / 100;
  const t = cf.produccion.find((p) => p.productoId === torta)!;
  assert.ok(Math.abs(Number(t.costoFijoPorUnidad) - esperado) <= 0.01, `${t.costoFijoPorUnidad} vs ${esperado}`);
  const rec = (await obtenerReceta(A, torta))!;
  assert.equal(rec.costoFijoActivo, true);
  assert.equal(Number(rec.costoReceta), Number((Number(rec.costoIngredientes) + Number(rec.costoFijo)).toFixed(2)));

  await guardarConfigCostosFijos(A, { activo: true, dias: 30, base: 'costo_ingredientes' });
  const cf2 = await obtenerCostosFijos(A);
  const suma = cf2.produccion.reduce((a, p) => a + Number(p.costoFijoPorUnidad) * Number(p.unidades), 0);
  assert.ok(Math.abs(suma - 15000) < 0.01 * cf2.produccion.length * 1000, `se reparte todo el costo fijo: ${suma}`);

  await guardarConfigCostosFijos(A, { activo: false, dias: 30, base: 'unidades' });
  assert.equal((await obtenerReceta(A, torta))!.costoFijoActivo, false);
  assert.equal(Number((await obtenerReceta(A, torta))!.costoFijo), 0);
  await quitarCostoFijo(A, alquiler);
  await assert.rejects(quitarCostoFijo(A, alquiler), ErrorDeUsuario);
});

test('un comercio no ve ni toca recetas, elaboraciones ni costos fijos de otro', async () => {
  assert.equal(await obtenerReceta(B, torta), null);
  await assert.rejects(agregarIngrediente(B, torta, harina), ErrorDeUsuario);
  await assert.rejects(elaborar('1', {}, B), ErrorDeUsuario);
  const r = await elaborar('1');
  await assert.rejects(anularElaboracion(B, r.id, 'intento'), ErrorDeUsuario);
  assert.equal((await obtenerCostosFijos(B)).items.length, 0);
  assert.deepEqual(await buscarIngredientes(B, 'harina', ''), []);
  assert.ok((await buscarIngredientes(A, 'harina', torta)).some((x) => x.id === harina));
});

test('con el costo fijo activado pero sin elaboraciones en el período, el costo fijo es cero', async () => {
  const mk = (nombre: string, costo: string) =>
    guardarProducto(B, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo, iva: 21, vendible: true, comprable: true, integrable: true, publicadoWeb: false, urlWeb: '', precios: {}, stockMinimo: '', stockIdeal: '' });
  const luz = await mk('Luz', '5000');
  const harinaB = await mk('Harina B', '100');
  const pan = await mk('Pan B', '1');
  await agregarCostoFijo(B, luz);
  await guardarConfigCostosFijos(B, { activo: true, dias: 30, base: 'unidades' });
  await agregarIngrediente(B, pan, harinaB);
  const r = (await obtenerReceta(B, pan))!;
  assert.equal(r.costoFijoActivo, true);
  assert.equal(Number(r.costoFijo), 0);
  assert.equal(Number(r.costoReceta), Number(r.costoIngredientes));
});
