// Notas de crédito: devuelven stock y plata (caja o cuenta corriente) de una venta cerrada, sin pasarse de lo vendido, y se anulan con movimientos inversos.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, cerrarCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarCategoria, guardarCliente, movimientosDe, obtenerCliente, revertirMovimiento } from '../lib/personas.ts';
import { anularVenta, buscarClientesParaVenta, cerrarVenta, datosParaNotaCredito, emitirNotaCredito, guardarMedioDePago, obtenerVenta } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let efectivo = '', banco = '', medioEfectivo = '', medioTarjeta = '', lista = '', cafe = '', te = '', consumidor = '', conCuenta = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const renglon = (productoId: string, cantidad: string, precio = '1000') => ({ productoId, descripcion: '', cantidad, precio, descuentoPct: 0, iva: 21 });
/** Vende en efectivo (o con otro cobro). */
const vender = (over: Record<string, unknown> = {}) =>
  cerrarVenta(A, { clave: randomUUID(), clienteId: consumidor, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [renglon(cafe, '2'), renglon(te, '1', '500')], cobro: { tipo: 'caja', medioPagoId: medioEfectivo, cajaId: efectivo }, ...over });
const nota = (ventaOrigenId: string, renglonOrigenId: string, cantidad: string, over: Record<string, unknown> = {}) =>
  emitirNotaCredito(A, { clave: randomUUID(), ventaOrigenId, fecha: '', nota: '', renglones: [{ renglonOrigenId, cantidad }], cobro: { tipo: 'caja', medioPagoId: medioEfectivo, cajaId: efectivo }, ...over });
const renglonesDe = async (ventaId: string) => (await datosParaNotaCredito(A, ventaId))!.renglones;
const saldoCaja = async (id: string) => Number((await obtenerCaja(A, id))?.saldo);
const stock = async (id: string) => Number((await obtenerProducto(A, id))?.stock);
const saldoCliente = async (id: string) => Number((await obtenerCliente(A, id))?.saldo);

before(async () => {
  A = await sesionDe(`nc-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`nc-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  banco = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '0' });
  await abrirCaja(A, banco, { contado: '0' });
  medioEfectivo = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [efectivo] });
  medioTarjeta = await guardarMedioDePago(A, null, { nombre: 'Tarjeta', comisionPct: 3, ivaComision: 21, cajaIds: [banco] });
  const cat = await guardarCategoria(A, null, { nombre: 'Con cuenta', listaId: null, cuentaCorriente: true, descuento: 0, ventaACosto: false });
  conCuenta = await guardarCliente(A, null, { nombre: 'Cliente con cuenta', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: cat });
  consumidor = (await buscarClientesParaVenta(A, 'consumidor'))[0]!.id;
  const prod = (nombre: string, precio: string) => guardarProducto(A, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: precio }, stockMinimo: '', stockIdeal: '' });
  cafe = await prod('Café', '1000');
  te = await prod('Té', '500');
});
after(async () => {
  await cerrarPool();
});

test('devolver en efectivo: vuelve el stock, sale la plata de la caja y la venta no se toca', async () => {
  const v = await vender();                                 // 2 cafés + 1 té = 2.500
  const [rCafe] = await renglonesDe(v.id);
  const cajaAntes = await saldoCaja(efectivo), stockAntes = await stock(cafe);
  const n = await nota(v.id, rCafe!.id, '1');
  assert.equal(n.total, '1000.00');
  assert.equal(await saldoCaja(efectivo), cajaAntes - 1000);
  assert.equal(await stock(cafe), stockAntes + 1);
  const det = await obtenerVenta(A, n.id);
  assert.equal(det?.comprobante, 'nota_credito');
  assert.equal(det?.origen?.id, v.id);
  assert.equal(det?.comision, '0.00');                      // devolver no cobra comisión
  const orig = await obtenerVenta(A, v.id);
  assert.equal(orig?.total, '2500.00');
  assert.equal(orig?.estado, 'cerrada');
  assert.deepEqual(orig?.notasCredito.map((x) => x.id), [n.id]);
});

test('no se puede devolver más de lo vendido, sumando las devoluciones anteriores', async () => {
  const v = await vender();
  const [rCafe] = await renglonesDe(v.id);
  await nota(v.id, rCafe!.id, '1');
  await assert.rejects(nota(v.id, rCafe!.id, '2'), ErrorDeUsuario);            // quedaba 1
  await nota(v.id, rCafe!.id, '1');                                            // justo lo que queda
  await assert.rejects(nota(v.id, rCafe!.id, '1'), ErrorDeUsuario);
  assert.equal((await renglonesDe(v.id))[0]!.disponible, '0.000');
});

test('devolución total de una venta con descuento: devuelve exactamente lo que se cobró', async () => {
  const v = await vender({ totalFinal: '2222.22' });         // 2.500 con "total final" 2222,22
  const todos = (await renglonesDe(v.id)).map((r) => ({ renglonOrigenId: r.id, cantidad: r.cantidad }));
  const n = await emitirNotaCredito(A, { clave: randomUUID(), ventaOrigenId: v.id, fecha: '', nota: '', renglones: todos, cobro: { tipo: 'caja', medioPagoId: medioEfectivo, cajaId: efectivo } });
  assert.equal(n.total, '2222.22');
});

test('devolver a cuenta corriente baja la deuda del cliente', async () => {
  const v = await vender({ clienteId: conCuenta, cobro: { tipo: 'cuenta_corriente' } });
  assert.equal(await saldoCliente(conCuenta), 2500);
  const [rCafe] = await renglonesDe(v.id);
  const cajaAntes = await saldoCaja(efectivo);
  const n = await nota(v.id, rCafe!.id, '1', { cobro: { tipo: 'cuenta_corriente' } });
  assert.equal(await saldoCliente(conCuenta), 1500);
  assert.equal(await saldoCaja(efectivo), cajaAntes);       // no toca la caja
  const m = (await movimientosDe(A, { cliente: conCuenta })).find((x) => x.ventaId === n.id)!;
  assert.equal(m.tipo, 'nota_credito');
  await assert.rejects(revertirMovimiento(A, { cliente: conCuenta }, m.id, 'x'), ErrorDeUsuario);   // se anula desde la nota, no desde la cuenta
});

test('a cuenta corriente solo si el cliente la tiene habilitada', async () => {
  const v = await vender();
  const [rCafe] = await renglonesDe(v.id);
  await assert.rejects(nota(v.id, rCafe!.id, '1', { cobro: { tipo: 'cuenta_corriente' } }), ErrorDeUsuario);
});

test('si la caja está cerrada no se puede devolver plata de ahí', async () => {
  const v = await vender({ cobro: { tipo: 'caja', medioPagoId: medioTarjeta, cajaId: banco } });
  const [rCafe] = await renglonesDe(v.id);
  const enBanco = String(await saldoCaja(banco));
  await cerrarCaja(A, banco, { contado: enBanco, cambioDejado: enBanco, destinoId: null });
  await assert.rejects(nota(v.id, rCafe!.id, '1', { cobro: { tipo: 'caja', medioPagoId: medioTarjeta, cajaId: banco } }), ErrorDeUsuario);
});

test('anular la nota de crédito revierte stock y caja, y libera lo devuelto', async () => {
  const v = await vender();
  const [rCafe] = await renglonesDe(v.id);
  const n = await nota(v.id, rCafe!.id, '2');
  const cajaConNota = await saldoCaja(efectivo), stockConNota = await stock(cafe);
  await anularVenta(A, n.id, 'devolución cargada por error');
  assert.equal(await saldoCaja(efectivo), cajaConNota + 2000);
  assert.equal(await stock(cafe), stockConNota - 2);
  assert.equal((await obtenerVenta(A, n.id))?.estado, 'anulada');
  assert.equal((await renglonesDe(v.id))[0]!.disponible, '2.000');           // vuelve a poder devolverse
  await nota(v.id, rCafe!.id, '2');
});

test('no se anula una venta que tiene notas de crédito vigentes', async () => {
  const v = await vender();
  const [rCafe] = await renglonesDe(v.id);
  const n = await nota(v.id, rCafe!.id, '1');
  await assert.rejects(anularVenta(A, v.id, 'error de carga'), ErrorDeUsuario);
  await anularVenta(A, n.id, 'se anula la nota');
  await anularVenta(A, v.id, 'ahora sí');
  assert.equal((await obtenerVenta(A, v.id))?.estado, 'anulada');
});

test('no se hace nota de una venta anulada ni de otra nota de crédito, y la misma clave no duplica', async () => {
  const v = await vender();
  const [rCafe] = await renglonesDe(v.id);
  const clave = randomUUID();
  const n1 = await nota(v.id, rCafe!.id, '1', { clave });
  const n2 = await nota(v.id, rCafe!.id, '1', { clave });
  assert.equal(n2.id, n1.id);
  assert.equal(n2.repetida, true);
  assert.equal((await renglonesDe(v.id))[0]!.disponible, '1.000');           // se devolvió una sola vez
  await assert.rejects(nota(n1.id, rCafe!.id, '1'), ErrorDeUsuario);          // de una nota de crédito
  await anularVenta(A, n1.id, 'x1x');
  await anularVenta(A, v.id, 'anulada');
  await assert.rejects(nota(v.id, rCafe!.id, '1'), ErrorDeUsuario);
});

test('un renglón de otra venta o cantidades inválidas se rechazan; otro comercio no ve nada', async () => {
  const v1 = await vender(), v2 = await vender();
  const [r2] = await renglonesDe(v2.id);
  await assert.rejects(nota(v1.id, r2!.id, '1'), ErrorDeUsuario);
  await assert.rejects(nota(v1.id, (await renglonesDe(v1.id))[0]!.id, '0'), ErrorDeUsuario);
  await assert.rejects(nota(v1.id, 'no-es-un-numero', '1'), ErrorDeUsuario);
  assert.equal(await datosParaNotaCredito(B, v1.id), null);
  await assert.rejects(emitirNotaCredito(B, { clave: randomUUID(), ventaOrigenId: v1.id, fecha: '', nota: '', renglones: [{ renglonOrigenId: r2!.id, cantidad: '1' }], cobro: { tipo: 'cuenta_corriente' } }), ErrorDeUsuario);
});
