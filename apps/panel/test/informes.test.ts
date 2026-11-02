// Informes de clientes y proveedores, y perfil de cada uno: totales por período, ticket, saldo, ranking y aislamiento.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { cerrarCompra } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { hoyArgentina, periodoDe } from '../lib/estadisticas.ts';
import { informeDePersonas, perfilDe } from '../lib/informes.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { guardarCliente, guardarProveedor } from '../lib/personas.ts';
import { cerrarVenta, guardarMedioDePago } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '', caja = '', medio = '', cafe = '', cliente = '', prov = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const vender = (cantidad: string) =>
  cerrarVenta(A, { clave: randomUUID(), clienteId: cliente, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad, precio: '1000', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: caja } });

before(async () => {
  A = await sesionDe(`inf-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`inf-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  caja = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, caja, { contado: '100000' });
  medio = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [caja] });
  cliente = await guardarCliente(A, null, { nombre: 'Laura', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: null });
  prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
  await vender('2');
  await vender('1');
  await cerrarCompra(A, { clave: randomUUID(), proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '10', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'caja', cajaId: caja } });
});
after(async () => {
  await cerrarPool();
});

test('informe de clientes: total, operaciones y ticket del período', async () => {
  const hoy = hoyArgentina();
  const filas = await informeDePersonas(A, 'cliente', periodoDe(undefined, hoy, hoy));
  const laura = filas.find((f) => f.id === cliente)!;
  assert.equal(laura.total, 300000);
  assert.equal(laura.operaciones, 2);
  assert.equal(laura.ticketPromedio, 150000);
  assert.ok(laura.ultima);
  assert.equal((await informeDePersonas(A, 'cliente', periodoDe(undefined, '2020-01-01', '2020-01-31'))).find((f) => f.id === cliente), undefined);
  assert.equal((await informeDePersonas(A, 'cliente', periodoDe(undefined, hoy, hoy), true)).length, 0); // nadie debe
});

test('informe de proveedores y perfiles', async () => {
  const hoy = hoyArgentina();
  const filas = await informeDePersonas(A, 'proveedor', periodoDe(undefined, hoy, hoy));
  assert.equal(filas.find((f) => f.id === prov)?.operaciones, 1);
  const pc = (await perfilDe(A, 'cliente', cliente))!;
  assert.equal(pc.total, 300000);
  assert.equal(pc.topProductos[0]?.nombre, 'Café');
  const pp = (await perfilDe(A, 'proveedor', prov))!;
  assert.equal(pp.operaciones, 1);
  assert.equal(await perfilDe(A, 'cliente', randomUUID()), null);
  assert.equal(await perfilDe(A, 'cliente', 'no-es-uuid'), null);
});

test('otro comercio no ve estos clientes y el informe exige permiso', async () => {
  const hoy = hoyArgentina();
  assert.equal((await informeDePersonas(B, 'cliente', periodoDe(undefined, hoy, hoy))).length, 0);
  assert.equal(await perfilDe(B, 'cliente', cliente), null);
  await assert.rejects(informeDePersonas({ ...A, rol: 'cocina', permisos: [] }, 'cliente', periodoDe('hoy', undefined, undefined)), ErrorDePermiso);
});
