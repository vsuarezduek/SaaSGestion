// Nota de crédito de proveedor: siempre contra cuenta corriente (baja la deuda y el stock), nunca mueve caja; se anula con movimientos inversos.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarCompra } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { anularNotaCreditoCompra, emitirNotaCreditoCompra, notasDeCreditoDelProveedor, obtenerNotaCreditoCompra } from '../lib/notasCreditoCompra.ts';
import { guardarProveedor, obtenerProveedor } from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let prov = '', otroProv = '', cafe = '', efectivo = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const stock = async (id: string) => Number((await obtenerProducto(A, id))?.stock);
const saldoProv = async (id = prov) => Number((await obtenerProveedor(A, id))?.saldo);
const saldoCaja = async () => Number((await obtenerCaja(A, efectivo))?.saldo);
const nota = (over: Record<string, unknown> = {}) =>
  emitirNotaCreditoCompra(A, { clave: randomUUID(), proveedorId: prov, compraOrigenId: null, comprobante: 'sin_comprobante', nroComprobante: '', fecha: '', nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '2', costo: '100', iva: 21 }], ...over });

before(async () => {
  A = await sesionDe(`ncc-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`ncc-b-${sufijo}`, 'b@ejemplo.test');
  const lista = (await listasDePrecios(A))[0]!.id;
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '0' });
  const p = () => ({ contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', ...p() });
  otroProv = await guardarProveedor(A, null, { nombre: 'Otra', ...p() });
  cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
  await cerrarCompra(A, { clave: randomUUID(), proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '10', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'cuenta_corriente' } });
});
after(async () => {
  await cerrarPool();
});

test('devolver al proveedor baja el stock y la deuda, y no toca la caja', async () => {
  const stock0 = await stock(cafe), deuda0 = await saldoProv(), caja0 = await saldoCaja();
  const n = await nota();
  assert.equal(n.total, '200.00');                       // 2 × 100, sin comprobante: sin IVA
  assert.equal(await stock(cafe), stock0 - 2);
  assert.equal(await saldoProv(), deuda0 - 200);
  assert.equal(await saldoCaja(), caja0);
  const det = await obtenerNotaCreditoCompra(A, n.id);
  assert.equal(det?.estado, 'cerrada');
  assert.equal(det?.proveedorId, prov);
  assert.deepEqual(det?.renglones.map((r) => r.descripcion), ['Café']);
  assert.equal((await notasDeCreditoDelProveedor(A, prov)).some((x) => x.id === n.id), true);
});

test('con nota de crédito A o B el IVA se suma encima del costo', async () => {
  const n = await nota({ comprobante: 'nota_credito_a', nroComprobante: '0001-00000042' });
  assert.equal(n.total, '242.00');                       // 200 + 21%
  const det = await obtenerNotaCreditoCompra(A, n.id);
  assert.equal(det?.iva, '42.00');
  assert.equal(det?.neto, '200.00');
});

test('la misma clave no emite dos veces la nota (doble clic)', async () => {
  const clave = randomUUID();
  const deuda0 = await saldoProv(), stock0 = await stock(cafe);
  const a = await nota({ clave });
  const b = await nota({ clave });
  assert.equal(b.repetida, true);
  assert.equal(b.id, a.id);
  assert.equal(await saldoProv(), deuda0 - 200);
  assert.equal(await stock(cafe), stock0 - 2);
});

test('anular restituye stock y deuda con movimientos inversos y no se puede anular dos veces', async () => {
  const n = await nota();
  const stock1 = await stock(cafe), deuda1 = await saldoProv();
  await anularNotaCreditoCompra(A, n.id, 'Error de carga');
  assert.equal(await stock(cafe), stock1 + 2);
  assert.equal(await saldoProv(), deuda1 + 200);
  assert.equal((await obtenerNotaCreditoCompra(A, n.id))?.estado, 'anulada');
  await assert.rejects(anularNotaCreditoCompra(A, n.id, 'Otra vez'), ErrorDeUsuario);
  await assert.rejects(anularNotaCreditoCompra(A, n.id, 'x'), ErrorDeUsuario);   // el motivo es obligatorio
});

test('un ítem libre baja la deuda sin mover stock; una nota de $0 no mueve plata', async () => {
  const stock0 = await stock(cafe), deuda0 = await saldoProv();
  const n = await nota({ renglones: [{ productoId: null, descripcion: 'Bonificación por demora', cantidad: '1', costo: '50', iva: 0 }] });
  assert.equal(n.total, '50.00');
  assert.equal(await stock(cafe), stock0);
  assert.equal(await saldoProv(), deuda0 - 50);
  const cero = await nota({ renglones: [{ productoId: null, descripcion: 'Sin cargo', cantidad: '1', costo: '0', iva: 0 }] });
  assert.equal(cero.total, '0.00');
  assert.equal(await saldoProv(), deuda0 - 50);
});

test('validaciones: sin renglones, ítem libre sin descripción, compra de otro proveedor, otro comercio', async () => {
  await assert.rejects(nota({ renglones: [] }), ErrorDeUsuario);
  await assert.rejects(nota({ renglones: [{ productoId: null, descripcion: '', cantidad: '1', costo: '10', iva: 0 }] }), ErrorDeUsuario);
  const compra = await cerrarCompra(A, { clave: randomUUID(), proveedorId: otroProv, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '1', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'cuenta_corriente' } });
  await assert.rejects(nota({ compraOrigenId: compra.id }), ErrorDeUsuario);
  await assert.rejects(emitirNotaCreditoCompra(B, { clave: randomUUID(), proveedorId: prov, compraOrigenId: null, comprobante: 'sin_comprobante', nroComprobante: '', fecha: '', nota: '',
    renglones: [{ productoId: null, descripcion: 'x', cantidad: '1', costo: '10', iva: 0 }] }), ErrorDeUsuario);
  assert.equal(await obtenerNotaCreditoCompra(B, (await nota()).id), null);   // otro comercio no la ve
});
