// Marcar para pedir, informe de productos filtrados y enlaces de origen en los movimientos de caja.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, movimientosDeCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { cerrarCompra, faltantesParaComprar } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { estaMarcadoParaPedir, marcarParaPedir } from '../lib/aPedir.ts';
import { filtroDeInforme, informeDeProductos, SIN_VALOR } from '../lib/informeProductos.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { guardarProveedor } from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '', caja = '', prov = '', cafe = '', te = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const producto = (S: SesionActiva, nombre: string, extra: Record<string, unknown> = {}) =>
  guardarProducto(S, null, { codigo: '', nombre, rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '', ...extra });

before(async () => {
  A = await sesionDe(`pc-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`pc-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  caja = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, caja, { contado: '100000' });
  prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  cafe = await producto(A, 'Café', { proveedorId: prov });
  te = await producto(A, 'Té', { vendible: false });
});
after(async () => { await cerrarPool(); });

test('marcar para pedir: aparece en faltantes aunque no haya mínimo, y se limpia al comprarlo', async () => {
  assert.equal(await estaMarcadoParaPedir(A, cafe), false);
  assert.equal((await faltantesParaComprar(A)).some((f) => f.id === cafe), false);
  await marcarParaPedir(A, cafe, true);
  assert.equal(await estaMarcadoParaPedir(A, cafe), true);
  const f = (await faltantesParaComprar(A)).find((x) => x.id === cafe);
  assert.ok(f);
  assert.equal(f.marcado, true);
  assert.ok(Number(f.cantidad) >= 1);
  await cerrarCompra(A, { clave: randomUUID(), proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '3', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'caja', cajaId: caja } });
  assert.equal(await estaMarcadoParaPedir(A, cafe), false);
});

test('marcar para pedir: se puede desmarcar y no cruza comercios', async () => {
  await marcarParaPedir(A, te, true);
  await marcarParaPedir(A, te, false);
  assert.equal(await estaMarcadoParaPedir(A, te), false);
  await assert.rejects(() => marcarParaPedir(B, te, true));
  assert.equal(await estaMarcadoParaPedir(A, te), false);
});

test('informe de productos: filtros, permiso y aislamiento', async () => {
  const f = filtroDeInforme({ proveedor: 'x', venta: 'no', valor: SIN_VALOR, extra: 'e', estado: 'raro' });
  assert.equal(f.estado, 'activos');
  assert.equal(f.vendible, false);
  assert.equal(f.extraValor, '');
  const r = await informeDeProductos(A, { venta: 'no' });
  assert.deepEqual(r.filas.map((x) => x.nombre), ['Té']);
  const todos = await informeDeProductos(A, {});
  assert.equal(todos.total, 2);
  assert.equal((await informeDeProductos(B, {})).total, 0);
  await assert.rejects(() => informeDeProductos({ ...A, rol: 'atencion' }, {}), ErrorDePermiso);
});

test('movimientos de caja: la compra enlaza a su detalle', async () => {
  const movs = await movimientosDeCaja(A, caja, 10);
  const deCompra = movs.find((m) => m.origen);
  assert.ok(deCompra);
  assert.match(deCompra.origen!, /^\/compras\/[0-9a-f-]{36}$/);
});
