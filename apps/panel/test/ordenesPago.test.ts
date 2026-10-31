// Órdenes de pago a proveedores: salen de una caja, bajan la deuda y se anulan con movimientos inversos.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { cerrarCompra } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { anularOrdenPago, obtenerOrdenPago, registrarOrdenPago } from '../lib/ordenesPago.ts';
import { guardarProveedor, movimientosDe, obtenerProveedor, revertirMovimiento } from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let efectivo = '', banco = '', cerrada = '', prov = '', compraId = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const pagar = (importe: string, over: Record<string, unknown> = {}, S: SesionActiva = A) =>
  registrarOrdenPago(S, { clave: randomUUID(), proveedorId: prov, compraId: null, importe, cajaId: efectivo, fecha: '', nota: '', ...over });
const saldoCaja = async (id: string) => Number((await obtenerCaja(A, id))?.saldo);
const saldoProv = async () => Number((await obtenerProveedor(A, prov))?.saldo);

before(async () => {
  A = await sesionDe(`op-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`op-b-${sufijo}`, 'b@ejemplo.test');
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  banco = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 1.2 });
  cerrada = await guardarCaja(A, null, { nombre: 'Sin abrir', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '10000' });
  await abrirCaja(A, banco, { contado: '10000' });
  prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  const c = await cerrarCompra(A, { clave: randomUUID(), proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: null, descripcion: 'Mercadería varia', cantidad: '1', costo: '1000', descuentoPct: 0, iva: 21 }], pago: { tipo: 'cuenta_corriente' } });
  compraId = c.id;
});
after(async () => {
  await cerrarPool();
});

test('pagar parte de la deuda: sale de la caja y baja el saldo del proveedor', async () => {
  assert.equal(await saldoProv(), 1000);
  const caja0 = await saldoCaja(efectivo);
  const o = await pagar('400', { compraId });
  assert.equal(await saldoCaja(efectivo), caja0 - 400);
  assert.equal(await saldoProv(), 600);
  const m = (await movimientosDe(A, { proveedor: prov })).find((x) => x.ordenPagoId === o.id)!;
  assert.equal(m.tipo, 'orden_pago');
  assert.equal(Number(m.importe), -400);
  await assert.rejects(revertirMovimiento(A, { proveedor: prov }, m.id, 'x'), ErrorDeUsuario);   // se anula desde la orden
  assert.equal((await obtenerOrdenPago(A, o.id))?.compraNumero, 1);
});

test('el impuesto por transacción de la caja también sale de la caja', async () => {
  const caja0 = await saldoCaja(banco);
  const o = await pagar('500', { cajaId: banco });
  assert.equal(Number(o.impuesto), 6);
  assert.equal(await saldoCaja(banco), caja0 - 506);
  await anularOrdenPago(A, o.id, 'error de carga');
  assert.equal(await saldoCaja(banco), caja0);
});

test('anular devuelve la plata a la caja y la deuda al proveedor, y no se anula dos veces', async () => {
  const caja0 = await saldoCaja(efectivo), prov0 = await saldoProv();
  const o = await pagar('100');
  await assert.rejects(anularOrdenPago(A, o.id, ''), ErrorDeUsuario);
  await anularOrdenPago(A, o.id, 'pagada por error');
  assert.equal(await saldoCaja(efectivo), caja0);
  assert.equal(await saldoProv(), prov0);
  assert.equal((await obtenerOrdenPago(A, o.id))?.estado, 'anulada');
  await assert.rejects(anularOrdenPago(A, o.id, 'otra vez'), ErrorDeUsuario);
});

test('la misma clave no duplica la orden', async () => {
  const clave = randomUUID();
  const caja0 = await saldoCaja(efectivo);
  const a = await pagar('50', { clave });
  const b = await pagar('50', { clave });
  assert.equal(b.repetida, true);
  assert.equal(b.id, a.id);
  assert.equal(await saldoCaja(efectivo), caja0 - 50);
});

test('rechaza caja cerrada, importe inválido, proveedor ajeno y compra de otro proveedor', async () => {
  const caja0 = await saldoCaja(efectivo);
  await assert.rejects(pagar('10', { cajaId: cerrada }), ErrorDeUsuario);
  await assert.rejects(pagar('0'), ErrorDeUsuario);
  await assert.rejects(pagar('-5'), ErrorDeUsuario);
  await assert.rejects(pagar('10', { proveedorId: randomUUID() }), ErrorDeUsuario);
  const otro = await guardarProveedor(A, null, { nombre: 'Otro proveedor', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  await assert.rejects(pagar('10', { proveedorId: otro, compraId }), ErrorDeUsuario);
  assert.equal(await saldoCaja(efectivo), caja0);
});

test('las órdenes no se borran ni se editan a mano', async () => {
  const o = await pagar('20');
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('DELETE FROM ordenes_pago WHERE id = $1', [o.id])));
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('UPDATE ordenes_pago SET importe = 1 WHERE id = $1', [o.id])));
});

test('un comercio no ve ni toca las órdenes de otro', async () => {
  const o = await pagar('30');
  assert.equal(await obtenerOrdenPago(B, o.id), null);
  await assert.rejects(anularOrdenPago(B, o.id, 'intento'), ErrorDeUsuario);
  await assert.rejects(pagar('30', {}, B), ErrorDeUsuario);
});
