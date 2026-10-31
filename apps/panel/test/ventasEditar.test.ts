// Editar una venta cerrada = anular la original y crear la nueva en una sola transacción (todo o nada).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { buscarClientesParaVenta, cerrarVenta, datosParaEditar, datosParaNotaCredito, emitirNotaCredito, guardarMedioDePago, nombreDelComercio, obtenerVenta } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let efectivo = '', medio = '', lista = '', cafe = '', consumidor = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const venta = (over: Record<string, unknown> = {}) => ({
  clave: randomUUID(), clienteId: consumidor, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
  renglones: [{ productoId: cafe, descripcion: '', cantidad: '2', precio: '1000', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: efectivo }, ...over,
});
const saldoCaja = async () => Number((await obtenerCaja(A, efectivo))?.saldo);
const stock = async () => Number((await obtenerProducto(A, cafe))?.stock);

before(async () => {
  A = await sesionDe(`edi-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`edi-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '0' });
  medio = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [efectivo] });
  consumidor = (await buscarClientesParaVenta(A, 'consumidor'))[0]!.id;
  cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
});
after(async () => {
  await cerrarPool();
});

test('los datos para editar traen la venta tal como se cargó', async () => {
  const v = await cerrarVenta(A, venta({ nota: 'para Ana', descuentoTotalPct: 10 }));
  const e = (await datosParaEditar(A, v.id))!;
  assert.equal(e.numero, v.numero);
  assert.equal(e.datos.nota, 'para Ana');
  assert.equal(e.datos.cobroTipo, 'caja');
  assert.equal(e.datos.medioId, medio);
  assert.equal(e.datos.cajaId, efectivo);
  assert.equal(Number(e.datos.descTotal), 10);
  assert.equal(e.datos.renglones.length, 1);
  assert.equal(Number(e.datos.renglones[0]!.cantidad), 2);
  assert.match(e.datos.fecha, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(e.cliente.id, consumidor);
});

test('editar: la original queda anulada, la nueva la reemplaza y caja y stock quedan bien', async () => {
  const v = await cerrarVenta(A, venta());                  // 2 cafés = 2.000
  const cajaAntes = await saldoCaja(), stockAntes = await stock();
  const n = await cerrarVenta(A, venta({ reemplazaVentaId: v.id, renglones: [{ productoId: cafe, descripcion: '', cantidad: '3', precio: '1000', descuentoPct: 0, iva: 21 }] }));
  assert.equal(n.total, '3000.00');
  assert.equal((await obtenerVenta(A, v.id))?.estado, 'anulada');
  assert.match((await obtenerVenta(A, v.id))?.motivoAnulacion ?? '', new RegExp(`N° ${n.numero}`));
  assert.equal((await obtenerVenta(A, n.id))?.estado, 'cerrada');
  assert.equal(await saldoCaja(), cajaAntes + 1000);        // −2.000 de la vieja +3.000 de la nueva
  assert.equal(await stock(), stockAntes - 1);              // vuelven 2 y salen 3
  assert.equal(await datosParaEditar(A, v.id), null);       // la anulada ya no se edita
});

test('si la nueva falla, la original no se toca (todo o nada)', async () => {
  const v = await cerrarVenta(A, venta());
  const cajaAntes = await saldoCaja(), stockAntes = await stock();
  await assert.rejects(cerrarVenta(A, venta({ reemplazaVentaId: v.id, renglones: [] })), ErrorDeUsuario);
  await assert.rejects(cerrarVenta(A, venta({ reemplazaVentaId: v.id, cobro: { tipo: 'caja', medioPagoId: medio, cajaId: randomUUID() } })), ErrorDeUsuario);
  assert.equal((await obtenerVenta(A, v.id))?.estado, 'cerrada');
  assert.equal(await saldoCaja(), cajaAntes);
  assert.equal(await stock(), stockAntes);
});

test('no se edita una venta con notas de crédito, ni una nota, ni la de otro comercio', async () => {
  const v = await cerrarVenta(A, venta());
  const [r] = (await datosParaNotaCredito(A, v.id))!.renglones;
  const nc = await emitirNotaCredito(A, { clave: randomUUID(), ventaOrigenId: v.id, fecha: '', nota: '', renglones: [{ renglonOrigenId: r!.id, cantidad: '1' }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: efectivo } });
  assert.equal(await datosParaEditar(A, v.id), null);
  assert.equal(await datosParaEditar(A, nc.id), null);
  await assert.rejects(cerrarVenta(A, venta({ reemplazaVentaId: v.id })), ErrorDeUsuario);
  const otra = await cerrarVenta(A, venta());
  assert.equal(await datosParaEditar(B, otra.id), null);
  await assert.rejects(cerrarVenta(B, { ...venta({ reemplazaVentaId: otra.id }), clienteId: (await buscarClientesParaVenta(B, 'consumidor'))[0]!.id, listaId: null, cobro: { tipo: 'cuenta_corriente' } }), ErrorDeUsuario);
  assert.equal((await obtenerVenta(A, otra.id))?.estado, 'cerrada');
});

test('el comprobante muestra el nombre del comercio', async () => {
  assert.equal(await nombreDelComercio(A), `edi-a-${sufijo}`);
});
