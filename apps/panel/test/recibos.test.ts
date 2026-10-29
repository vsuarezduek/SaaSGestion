// Recibos de cuenta corriente: el cliente paga su deuda (total o parcial) en una caja; baja el saldo; se anula con movimientos inversos.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, cerrarCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarCategoria, guardarCliente, movimientosDe, obtenerCliente, revertirMovimiento } from '../lib/personas.ts';
import { anularRecibo, obtenerRecibo, registrarRecibo } from '../lib/recibos.ts';
import { buscarClientesParaVenta, cerrarVenta, guardarMedioDePago } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let efectivo = '';
let banco = '';
let medioEfectivo = '';
let medioTarjeta = ''; // 3 % + 21 % de IVA, en la caja banco
let cliente = '';
let otroCliente = '';
let consumidor = '';
let lista = '';
let cafe = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const recibo = (over: Record<string, unknown> = {}) =>
  registrarRecibo(A, { clave: randomUUID(), clienteId: cliente, ventaId: null, importe: '400', medioPagoId: medioEfectivo, cajaId: efectivo, fecha: '', nota: '', ...over });
const saldoCaja = async (id: string) => (await obtenerCaja(A, id))?.saldo;
const saldoCliente = async (id = cliente) => Number((await obtenerCliente(A, id))?.saldo);

before(async () => {
  A = await sesionDe(`rec-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`rec-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  banco = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '0' });
  await abrirCaja(A, banco, { contado: '0' });
  medioEfectivo = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [efectivo] });
  medioTarjeta = await guardarMedioDePago(A, null, { nombre: 'Tarjeta', comisionPct: 3, ivaComision: 21, cajaIds: [banco] });
  const cat = await guardarCategoria(A, null, { nombre: 'Con cuenta', listaId: null, cuentaCorriente: true, descuento: 0, ventaACosto: false });
  const base = { telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: cat };
  cliente = await guardarCliente(A, null, { ...base, nombre: 'Cliente deudor' });
  otroCliente = await guardarCliente(A, null, { ...base, nombre: 'Otro cliente' });
  consumidor = (await buscarClientesParaVenta(A, 'consumidor'))[0]!.id;
  cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
});
after(async () => {
  await cerrarPool();
});

const ventaCC = (clienteId: string) =>
  cerrarVenta(A, { clave: randomUUID(), clienteId, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '1', precio: '1000', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'cuenta_corriente' } });

test('un recibo parcial baja el saldo del cliente y suma a la caja', async () => {
  const v = await ventaCC(cliente);
  assert.equal(await saldoCliente(), 1000);
  const cajaAntes = Number(await saldoCaja(efectivo));
  const r = await recibo({ importe: '400', ventaId: v.id, nota: 'Pagó una parte' });
  assert.equal(r.importe, '400.00');
  assert.equal(r.numero, 1);
  assert.equal(await saldoCliente(), 600);
  assert.equal(Number(await saldoCaja(efectivo)) - cajaAntes, 400);
  const d = await obtenerRecibo(A, r.id);
  assert.equal(d?.ventaNumero, v.numero);
  assert.equal(d?.cobro, 'Efectivo · Efectivo');
  assert.equal(d?.estado, 'cerrado');
});

test('pagar más de lo que se debe deja saldo a favor', async () => {
  await recibo({ importe: '1000' });
  assert.equal(await saldoCliente(), -400);
});

test('el medio con comisión deja el cobro y la comisión como movimientos aparte', async () => {
  const antes = Number(await saldoCaja(banco));
  const r = await recibo({ importe: '1000', medioPagoId: medioTarjeta, cajaId: banco });
  assert.equal(r.comision, '36.30'); // 1000 × 3 % × 1,21
  assert.equal(Number((Number(await saldoCaja(banco)) - antes).toFixed(2)), 963.7);
  const m = await conTenant(A.tenantId, (c) => c.query('SELECT tipo, importe::text FROM caja_movimientos WHERE recibo_id = $1 ORDER BY id', [r.id]));
  assert.deepEqual(m.rows.map((x) => [x.tipo, x.importe]), [['cobro_recibo', '1000.00'], ['comision_recibo', '-36.30']]);
});

test('registrar dos veces con la misma clave no duplica el recibo ni el cobro', async () => {
  const clave = randomUUID();
  const antes = Number(await saldoCaja(efectivo));
  const r1 = await recibo({ clave, importe: '50' });
  const r2 = await recibo({ clave, importe: '50' });
  assert.equal(r1.id, r2.id);
  assert.equal(r2.repetido, true);
  assert.equal(Number(await saldoCaja(efectivo)) - antes, 50);
});

test('el número de recibo es correlativo', async () => {
  const a = await recibo({ importe: '1' });
  const b = await recibo({ importe: '1' });
  assert.equal(b.numero, a.numero + 1);
});

test('rechaza datos inválidos', async () => {
  await assert.rejects(recibo({ importe: '0' }), ErrorDeUsuario);
  await assert.rejects(recibo({ importe: '-5' }), ErrorDeUsuario);
  await assert.rejects(recibo({ importe: 'abc' }), ErrorDeUsuario);
  await assert.rejects(recibo({ clienteId: consumidor }), ErrorDeUsuario);                // el Consumidor Final no tiene cuenta corriente
  await assert.rejects(recibo({ clienteId: randomUUID() }), ErrorDeUsuario);
  await assert.rejects(recibo({ cajaId: banco }), ErrorDeUsuario);                       // el medio efectivo no está habilitado en el banco
  await assert.rejects(recibo({ medioPagoId: randomUUID() }), ErrorDeUsuario);
  const v = await ventaCC(otroCliente);
  await assert.rejects(recibo({ ventaId: v.id }), ErrorDeUsuario);                       // la venta es de otro cliente
});

test('una caja cerrada no recibe cobros', async () => {
  const c = await guardarCaja(A, null, { nombre: 'Cerrada', tipo: 'efectivo', impuestoTransaccion: 0 });
  const m = await guardarMedioDePago(A, null, { nombre: 'Efectivo 2', comisionPct: 0, ivaComision: 21, cajaIds: [c] });
  await assert.rejects(recibo({ medioPagoId: m, cajaId: c }), ErrorDeUsuario);
  await abrirCaja(A, c, { contado: '0' });
  await recibo({ medioPagoId: m, cajaId: c });
  await cerrarCaja(A, c, { contado: '400', cambioDejado: '400', destinoId: null });
  await assert.rejects(recibo({ medioPagoId: m, cajaId: c }), ErrorDeUsuario);
});

test('anular un recibo devuelve la deuda y saca el cobro de la caja, sin borrar nada', async () => {
  await ventaCC(otroCliente);
  const saldoAntes = await saldoCliente(otroCliente);
  const cajaAntes = Number(await saldoCaja(banco));
  const r = await recibo({ clienteId: otroCliente, importe: '500', medioPagoId: medioTarjeta, cajaId: banco });
  assert.equal(await saldoCliente(otroCliente), saldoAntes - 500);
  await assert.rejects(anularRecibo(A, r.id, ''), ErrorDeUsuario); // exige motivo
  await anularRecibo(A, r.id, 'Importe mal cargado');
  assert.equal(await saldoCliente(otroCliente), saldoAntes);
  assert.equal(Number((Number(await saldoCaja(banco)) - cajaAntes).toFixed(2)), 0);
  const d = await obtenerRecibo(A, r.id);
  assert.equal(d?.estado, 'anulado');
  assert.equal(d?.motivoAnulacion, 'Importe mal cargado');
  const caja = await conTenant(A.tenantId, (c) => c.query('SELECT tipo, revierte_id IS NOT NULL AS rev FROM caja_movimientos WHERE recibo_id = $1 ORDER BY id', [r.id]));
  assert.deepEqual(caja.rows.map((x) => [x.tipo, x.rev]), [['cobro_recibo', false], ['comision_recibo', false], ['reversion', true], ['reversion', true]]);
  const a = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad = 'recibo' AND entidad_id = $1 ORDER BY id", [r.id]));
  assert.deepEqual(a.rows.map((x) => x.accion), ['registrar', 'anular']);
});

test('no se puede anular dos veces ni lo que no existe', async () => {
  const r = await recibo({ importe: '10' });
  await anularRecibo(A, r.id, 'Duplicado');
  await assert.rejects(anularRecibo(A, r.id, 'Otra vez'), ErrorDeUsuario);
  await assert.rejects(anularRecibo(A, randomUUID(), 'No existe'), ErrorDeUsuario);
  await assert.rejects(anularRecibo(A, 'no-es-uuid', 'Mal'), ErrorDeUsuario);
  const n = await conTenant(A.tenantId, (c) => c.query('SELECT count(*)::int AS n FROM caja_movimientos WHERE recibo_id = $1', [r.id]));
  assert.equal(n.rows[0].n, 2); // cobro + una sola reversión
});

test('se puede anular un recibo aunque la caja ya esté cerrada', async () => {
  const c = await guardarCaja(A, null, { nombre: 'Cierra luego', tipo: 'efectivo', impuestoTransaccion: 0 });
  const m = await guardarMedioDePago(A, null, { nombre: 'Efectivo 3', comisionPct: 0, ivaComision: 21, cajaIds: [c] });
  await abrirCaja(A, c, { contado: '0' });
  const r = await recibo({ medioPagoId: m, cajaId: c });
  await cerrarCaja(A, c, { contado: '400', cambioDejado: '400', destinoId: null });
  await anularRecibo(A, r.id, 'Se cargó en otro cliente');
  assert.equal((await obtenerRecibo(A, r.id))?.estado, 'anulado');
  assert.equal(await saldoCaja(c), '0.00');
});

test('el historial muestra el saldo que quedó después de cada movimiento', async () => {
  const nuevo = (await buscarClientesParaVenta(A, 'otro cliente'))[0]!.id;
  const movs = await movimientosDe(A, { cliente: nuevo });
  // Del más nuevo al más viejo; el último saldo es el saldo actual y cada fila = saldo anterior + su importe.
  assert.equal(Number(movs[0]!.saldo), await saldoCliente(nuevo));
  for (let i = 0; i < movs.length - 1; i++) {
    assert.equal(Number((Number(movs[i + 1]!.saldo) + Number(movs[i]!.importe)).toFixed(2)), Number(movs[i]!.saldo));
  }
  assert.ok(movs.some((m) => m.tipo === 'recibo' && m.reciboId));
  assert.ok(movs.some((m) => m.tipo === 'venta' && m.ventaId));
});

test('los movimientos de un recibo o una venta no se revierten a mano en la cuenta corriente', async () => {
  const movs = await movimientosDe(A, { cliente: cliente });
  const delRecibo = movs.find((m) => m.tipo === 'recibo' && !m.revertido)!;
  await assert.rejects(revertirMovimiento(A, { cliente }, delRecibo.id), ErrorDeUsuario);
  const deVenta = movs.find((m) => m.tipo === 'venta')!;
  await assert.rejects(revertirMovimiento(A, { cliente }, deVenta.id), ErrorDeUsuario);
});

test('un comercio no ve ni anula recibos de otro', async () => {
  const r = await recibo({ importe: '5' });
  assert.equal(await obtenerRecibo(B, r.id), null);
  await assert.rejects(anularRecibo(B, r.id, 'Intento ajeno'), ErrorDeUsuario);
  assert.equal((await obtenerRecibo(A, r.id))?.estado, 'cerrado');
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('UPDATE recibos SET importe = 1 WHERE id = $1', [r.id])));
});
