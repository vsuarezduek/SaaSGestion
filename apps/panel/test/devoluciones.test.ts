// Devolución de pago: se le devuelve plata a un cliente con saldo a favor. Sale de una caja, acerca a cero el saldo y se anula con movimientos inversos.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { anularDevolucion, obtenerDevolucion, registrarDevolucion } from '../lib/devoluciones.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarCategoria, guardarCliente, movimientosDe, obtenerCliente, registrarMovimiento, revertirMovimiento } from '../lib/personas.ts';
import { buscarClientesParaVenta, guardarMedioDePago } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let efectivo = '', medio = '', cerrada = '', medioCerrada = '', consumidor = '';
let aFavor = '';   // cliente con 1.000 a favor

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const devolver = (importe: string, over: Record<string, unknown> = {}) =>
  registrarDevolucion(A, { clave: randomUUID(), clienteId: aFavor, importe, medioPagoId: medio, cajaId: efectivo, fecha: '', nota: '', ...over });
const saldoCaja = async () => Number((await obtenerCaja(A, efectivo))?.saldo);
const saldoCliente = async (id = aFavor) => Number((await obtenerCliente(A, id))?.saldo);

before(async () => {
  A = await sesionDe(`dev-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`dev-b-${sufijo}`, 'b@ejemplo.test');
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  cerrada = await guardarCaja(A, null, { nombre: 'Caja sin abrir', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '5000' });
  medio = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [efectivo] });
  medioCerrada = await guardarMedioDePago(A, null, { nombre: 'Sin abrir', comisionPct: 0, ivaComision: 21, cajaIds: [cerrada] });
  const cat = await guardarCategoria(A, null, { nombre: 'Con cuenta', listaId: null, cuentaCorriente: true, descuento: 0, ventaACosto: false });
  aFavor = await guardarCliente(A, null, { nombre: 'Cliente con saldo a favor', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: cat });
  consumidor = (await buscarClientesParaVenta(A, 'consumidor'))[0]!.id;
  await registrarMovimiento(A, { cliente: aFavor }, { tipo: 'ajuste', importe: '-1000', concepto: 'Seña' });
});
after(async () => {
  await cerrarPool();
});

test('devolver parte del saldo a favor: sale de la caja y el saldo se acerca a cero', async () => {
  const cajaAntes = await saldoCaja();
  const d = await devolver('400');
  assert.equal(Number(d.importe), 400);
  assert.equal(await saldoCaja(), cajaAntes - 400);
  assert.equal(await saldoCliente(), -600);
  const m = (await movimientosDe(A, { cliente: aFavor })).find((x) => x.devolucionId === d.id)!;
  assert.equal(m.tipo, 'devolucion_pago');
  assert.equal(Number(m.importe), 400);
  assert.equal(Number(m.saldo), -600);
  await assert.rejects(revertirMovimiento(A, { cliente: aFavor }, m.id, 'x'), ErrorDeUsuario);   // se anula desde la devolución
  assert.equal((await obtenerDevolucion(A, d.id))?.estado, 'cerrada');
});

test('no se puede devolver más que el saldo a favor', async () => {
  const antes = await saldoCliente();
  await assert.rejects(devolver(String(-antes + 1)), ErrorDeUsuario);
  assert.equal(await saldoCliente(), antes);
  await devolver(String(-antes));                       // justo todo lo que hay
  assert.equal(await saldoCliente(), 0);
  await assert.rejects(devolver('1'), ErrorDeUsuario);  // ya no tiene saldo a favor
});

test('anular la devolución devuelve la plata a la caja y el saldo a favor al cliente', async () => {
  await registrarMovimiento(A, { cliente: aFavor }, { tipo: 'ajuste', importe: '-300', concepto: 'Otra seña' });
  const d = await devolver('300');
  const cajaConDev = await saldoCaja();
  await anularDevolucion(A, d.id, 'devuelta por error');
  assert.equal(await saldoCaja(), cajaConDev + 300);
  assert.equal(await saldoCliente(), -300);
  assert.equal((await obtenerDevolucion(A, d.id))?.estado, 'anulada');
  await assert.rejects(anularDevolucion(A, d.id, 'otra vez'), ErrorDeUsuario);
  await assert.rejects(anularDevolucion(A, randomUUID(), 'no existe'), ErrorDeUsuario);
  await assert.rejects(anularDevolucion(A, d.id, 'x'), ErrorDeUsuario);      // motivo muy corto / ya anulada
});

test('el saldo a deber no se devuelve, ni el Consumidor Final; la caja tiene que estar abierta', async () => {
  const debe = await guardarCliente(A, null, { nombre: 'Cliente deudor', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: null });
  await registrarMovimiento(A, { cliente: debe }, { tipo: 'ajuste', importe: '500', concepto: 'Deuda' }).catch(() => null);
  await assert.rejects(devolver('100', { clienteId: debe }), ErrorDeUsuario);
  await assert.rejects(devolver('100', { clienteId: consumidor }), ErrorDeUsuario);
  await assert.rejects(devolver('100', { medioPagoId: medioCerrada, cajaId: cerrada }), ErrorDeUsuario);   // caja cerrada
  await assert.rejects(devolver('100', { medioPagoId: medio, cajaId: cerrada }), ErrorDeUsuario);          // medio no habilitado para esa caja
  await assert.rejects(devolver('0'), ErrorDeUsuario);
  await assert.rejects(devolver('-5'), ErrorDeUsuario);
});

test('la misma clave no duplica la devolución, y otro comercio no ve nada', async () => {
  const clave = randomUUID();
  const antes = await saldoCliente();
  const d1 = await devolver('100', { clave });
  const d2 = await devolver('100', { clave });
  assert.equal(d2.id, d1.id);
  assert.equal(d2.repetida, true);
  assert.equal(await saldoCliente(), antes + 100);        // una sola vez
  assert.equal(await obtenerDevolucion(B, d1.id), null);
  await assert.rejects(registrarDevolucion(B, { clave: randomUUID(), clienteId: aFavor, importe: '10', medioPagoId: medio, cajaId: efectivo, fecha: '', nota: '' }), ErrorDeUsuario);
  await assert.rejects(anularDevolucion(B, d1.id, 'ajena'), ErrorDeUsuario);
});
