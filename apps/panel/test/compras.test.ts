// Compras: cierre atómico (compra + renglones + caja/impuesto o cuenta corriente + stock + costos y precios), anulación y edición.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { anularCompra, cerrarCompra, datosParaEditarCompra, listarCompras, obtenerCompra } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarProveedor, obtenerProveedor } from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '';
let efectivo = '', conImpuesto = '', cerrada = '';
let prov = '';
let cafe = '';   // costo 100, precio 200

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const producto = (nombre: string, costo = '100', precio = '200') =>
  guardarProducto(A, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo, iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: precio }, stockMinimo: '', stockIdeal: '' });
const renglon = (productoId: string | null, cantidad: string, costo: string, extra: object = {}) =>
  ({ productoId, descripcion: productoId ? '' : 'Ítem libre', cantidad, costo, descuentoPct: 0, iva: 21, ...extra });
const compra = (over: Record<string, unknown> = {}, S: SesionActiva = A) =>
  cerrarCompra(S, { clave: randomUUID(), proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [renglon(cafe, '10', '100')], pago: { tipo: 'caja', cajaId: efectivo }, ...over });
const saldoCaja = async (id: string) => Number((await obtenerCaja(A, id))?.saldo);
const saldoProv = async () => Number((await obtenerProveedor(A, prov))?.saldo);
const stockDe = async (id: string) => Number((await obtenerProducto(A, id))?.stock);

before(async () => {
  A = await sesionDe(`com-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`com-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  conImpuesto = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 1.2 });
  cerrada = await guardarCaja(A, null, { nombre: 'Sin abrir', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '100000' });
  await abrirCaja(A, conImpuesto, { contado: '100000' });
  prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  cafe = await producto('Café');
});
after(async () => {
  await cerrarPool();
});

test('compra en caja: sale la plata, entra el stock y el proveedor no queda debiendo', async () => {
  const caja0 = await saldoCaja(efectivo), stock0 = await stockDe(cafe), prov0 = await saldoProv();
  const r = await compra();
  assert.equal(Number(r.total), 1000);
  assert.equal(await saldoCaja(efectivo), caja0 - 1000);
  assert.equal(await stockDe(cafe), stock0 + 10);
  assert.equal(await saldoProv(), prov0);
  const d = await obtenerCompra(A, r.id);
  assert.equal(d?.estado, 'cerrada');
  assert.equal(d?.renglones.length, 1);
  assert.ok((await listarCompras(A, {})).some((f) => f.id === r.id));
});

test('el impuesto por transacción de la caja se descuenta además del total', async () => {
  const caja0 = await saldoCaja(conImpuesto);
  const r = await compra({ pago: { tipo: 'caja', cajaId: conImpuesto } });
  assert.equal(Number(r.impuesto), 12);                       // 1,2 % de 1.000
  assert.equal(await saldoCaja(conImpuesto), caja0 - 1012);
});

test('compra en cuenta corriente: aumenta lo que se le debe al proveedor y no toca la caja', async () => {
  const caja0 = await saldoCaja(efectivo), prov0 = await saldoProv();
  const r = await compra({ pago: { tipo: 'cuenta_corriente' } });
  assert.equal(await saldoCaja(efectivo), caja0);
  assert.equal(await saldoProv(), prov0 + 1000);
  assert.equal((await obtenerCompra(A, r.id))?.pago, 'Cuenta corriente');
});

test('factura A suma IVA al neto; remito no; el descuento total baja el neto', async () => {
  const fa = await compra({ comprobante: 'factura_a', nroComprobante: '0001-00000123' });
  assert.equal(Number(fa.total), 1210);
  const rem = await compra({ comprobante: 'remito' });
  assert.equal(Number(rem.total), 1000);
  const desc = await compra({ comprobante: 'factura_b', descuentoTotalPct: 10 });
  assert.equal(Number(desc.total), 1089);                     // 900 × 1,21
});

test('actualización de costos: ninguno, solo costo, o costo y precio manteniendo la utilidad', async () => {
  const p = await producto('Yerba', '100', '200');
  await compra({ modoCostos: 'ninguno', renglones: [renglon(p, '1', '120')] });
  let d = await obtenerProducto(A, p);
  assert.equal(Number(d?.costo), 100);
  await compra({ modoCostos: 'costo', renglones: [renglon(p, '1', '120')] });
  d = await obtenerProducto(A, p);
  assert.equal(Number(d?.costo), 120);
  assert.equal(Number(d?.precios[lista]), 200);
  await compra({ modoCostos: 'costo_y_precio', renglones: [renglon(p, '1', '150')] });
  d = await obtenerProducto(A, p);
  assert.equal(Number(d?.costo), 150);
  assert.equal(Number(d?.precios[lista]), 250);               // 200 × 150 ÷ 120
});

test('el nuevo costo contempla el descuento del renglón', async () => {
  const p = await producto('Mate', '100', '200');
  await compra({ modoCostos: 'costo', renglones: [renglon(p, '2', '200', { descuentoPct: 10 })] });
  assert.equal(Number((await obtenerProducto(A, p))?.costo), 180);
});

test('un ítem libre no mueve stock ni costos', async () => {
  const stock0 = await stockDe(cafe);
  const r = await compra({ categoria: 'Insumos', renglones: [renglon(null, '1', '500')] });
  assert.equal(Number(r.total), 500);
  assert.equal(await stockDe(cafe), stock0);
});

test('la misma clave no duplica la compra (doble clic)', async () => {
  const clave = randomUUID();
  const caja0 = await saldoCaja(efectivo);
  const a = await compra({ clave });
  const b = await compra({ clave });
  assert.equal(b.repetida, true);
  assert.equal(b.id, a.id);
  assert.equal(await saldoCaja(efectivo), caja0 - 1000);
});

test('rechaza caja cerrada, proveedor inexistente y datos inválidos sin dejar nada', async () => {
  const stock0 = await stockDe(cafe);
  await assert.rejects(compra({ pago: { tipo: 'caja', cajaId: cerrada } }), ErrorDeUsuario);
  await assert.rejects(compra({ proveedorId: randomUUID() }), ErrorDeUsuario);
  await assert.rejects(compra({ renglones: [] }), ErrorDeUsuario);
  await assert.rejects(compra({ renglones: [renglon(cafe, '0', '100')] }), ErrorDeUsuario);
  await assert.rejects(compra({ renglones: [renglon(randomUUID(), '1', '100')] }), ErrorDeUsuario);
  assert.equal(await stockDe(cafe), stock0);
});

test('anular revierte caja, impuesto, stock y cuenta corriente; no restaura costos; no se anula dos veces', async () => {
  const p = await producto('Cacao', '100', '200');
  const caja0 = await saldoCaja(conImpuesto), stock0 = await stockDe(p);
  const r = await compra({ pago: { tipo: 'caja', cajaId: conImpuesto }, modoCostos: 'costo', renglones: [renglon(p, '5', '130')] });
  assert.equal(await stockDe(p), stock0 + 5);
  await assert.rejects(anularCompra(A, r.id, 'x'), ErrorDeUsuario);          // el motivo es obligatorio
  await anularCompra(A, r.id, 'cargada por error');
  assert.equal(await saldoCaja(conImpuesto), caja0);
  assert.equal(await stockDe(p), stock0);
  assert.equal(Number((await obtenerProducto(A, p))?.costo), 130);
  assert.equal((await obtenerCompra(A, r.id))?.estado, 'anulada');
  await assert.rejects(anularCompra(A, r.id, 'otra vez'), ErrorDeUsuario);

  const prov0 = await saldoProv();
  const cc = await compra({ pago: { tipo: 'cuenta_corriente' } });
  await anularCompra(A, cc.id, 'cargada por error');
  assert.equal(await saldoProv(), prov0);
});

test('editar una compra cerrada la anula y la reemplaza en una sola operación', async () => {
  const caja0 = await saldoCaja(efectivo), stock0 = await stockDe(cafe);
  const original = await compra();
  const datos = await datosParaEditarCompra(A, original.id);
  assert.ok(datos);
  const nueva = await compra({ reemplazaCompraId: original.id, renglones: [renglon(cafe, '4', '100')] });
  assert.equal((await obtenerCompra(A, original.id))?.estado, 'anulada');
  assert.equal((await obtenerCompra(A, nueva.id))?.estado, 'cerrada');
  assert.equal(await saldoCaja(efectivo), caja0 - 400);
  assert.equal(await stockDe(cafe), stock0 + 4);
});

test('una compra anulada no se puede editar', async () => {
  const r = await compra();
  await anularCompra(A, r.id, 'por error');
  await assert.rejects(compra({ reemplazaCompraId: r.id }), ErrorDeUsuario);
});

test('los libros no se pueden tocar a mano: compras y renglones son de solo agregado', async () => {
  const r = await compra();
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('DELETE FROM compras WHERE id = $1', [r.id])));
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('UPDATE compras SET total = 1 WHERE id = $1', [r.id])));
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('UPDATE compra_renglones SET cantidad = 99 WHERE compra_id = $1', [r.id])));
});

test('un comercio no ve ni toca las compras de otro', async () => {
  const r = await compra();
  assert.equal(await obtenerCompra(B, r.id), null);
  assert.equal((await listarCompras(B, {})).length, 0);
  await assert.rejects(anularCompra(B, r.id, 'intento'), ErrorDeUsuario);
  await assert.rejects(compra({}, B), ErrorDeUsuario);        // proveedor y caja de A no existen para B
});
