// Stock: libro de solo agregar, saldo calculado, negativo permitido con alerta y aislamiento entre comercios.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { guardarProducto, listarProductos, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { alertasDeStock, movimientosDeStock, registrarStock, revertirStock } from '../lib/stock.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const base = { codigo: '', nombre: 'Producto', rubroId: null as string | null, tipo: '', unidad: 'kg', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: {} as Record<string, string>, stockMinimo: '', stockIdeal: '' };
const producto = (S: SesionActiva, nombre: string, extra: object = {}) => guardarProducto(S, null, { ...base, nombre, ...extra });
const ajuste = { tipo: 'ajuste', concepto: '' };

before(async () => {
  A = await sesionDe(`stk-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`stk-b-${sufijo}`, 'b@ejemplo.test');
});
after(async () => {
  await cerrarPool();
});

test('el stock es la suma de movimientos, con decimales', async () => {
  const id = await producto(A, 'Té suelto');
  assert.equal((await obtenerProducto(A, id))?.stock, '0.000');
  await registrarStock(A, id, { tipo: 'saldo_inicial', cantidad: '10,5', concepto: 'Conteo' });
  await registrarStock(A, id, { ...ajuste, cantidad: '-2,25' });
  assert.equal((await obtenerProducto(A, id))?.stock, '8.250');
});

test('el stock puede quedar negativo y se alerta', async () => {
  const id = await producto(A, 'Se acaba');
  await registrarStock(A, id, { ...ajuste, cantidad: '-3' });
  assert.equal((await obtenerProducto(A, id))?.stock, '-3.000');
  const alertas = await alertasDeStock(A);
  assert.equal(alertas.negativos.some((a) => a.id === id), true);
  assert.equal((await listarProductos(A, { alerta: 'negativo' })).filas.some((f) => f.id === id), true);
});

test('avisa cuando el stock baja del mínimo y deja de avisar al reponer', async () => {
  const id = await producto(A, 'Con mínimo', { stockMinimo: '5', stockIdeal: '20' });
  await registrarStock(A, id, { tipo: 'saldo_inicial', cantidad: '3', concepto: '' });
  assert.equal(((await alertasDeStock(A)).bajoMinimo).some((a) => a.id === id), true);
  assert.equal((await listarProductos(A, { alerta: 'bajo_minimo' })).filas.some((f) => f.id === id), true);
  await registrarStock(A, id, { ...ajuste, cantidad: '10' });
  assert.equal(((await alertasDeStock(A)).bajoMinimo).some((a) => a.id === id), false);
  assert.equal((await obtenerProducto(A, id))?.stockIdeal, '20.000');
});

test('revertir genera el movimiento inverso, una sola vez, y no se revierte una reversión', async () => {
  const id = await producto(A, 'Reversible');
  const m = await registrarStock(A, id, { ...ajuste, cantidad: '7' });
  const r = await revertirStock(A, id, m);
  assert.equal((await obtenerProducto(A, id))?.stock, '0.000');
  await assert.rejects(revertirStock(A, id, m), ErrorDeUsuario);
  await assert.rejects(revertirStock(A, id, r), ErrorDeUsuario);
  const movs = await movimientosDeStock(A, id);
  assert.equal(movs.find((x) => x.id === m)?.revertido, true);
});

test('no acepta cantidad cero, inválida ni con más de 3 decimales', async () => {
  const id = await producto(A, 'Validaciones');
  for (const cantidad of ['0', 'abc', '', '1,2345']) {
    await assert.rejects(registrarStock(A, id, { ...ajuste, cantidad }), ErrorDeUsuario, cantidad);
  }
  await assert.rejects(guardarProducto(A, null, { ...base, nombre: 'Mín negativo', stockMinimo: '-1' }), ErrorDeUsuario);
});

test('el libro no admite modificar ni borrar', async () => {
  const id = await producto(A, 'Libro');
  await registrarStock(A, id, { ...ajuste, cantidad: '1' });
  await assert.rejects(conTenant(A.tenantId, (x) => x.query('UPDATE stock_movimientos SET cantidad = 99')));
  await assert.rejects(conTenant(A.tenantId, (x) => x.query('DELETE FROM stock_movimientos')));
});

test('un comercio no ve ni mueve el stock de otro', async () => {
  const id = await producto(A, 'Solo de A');
  const m = await registrarStock(A, id, { ...ajuste, cantidad: '4' });
  assert.deepEqual(await movimientosDeStock(B, id), []);
  await assert.rejects(registrarStock(B, id, { ...ajuste, cantidad: '1' }), ErrorDeUsuario);
  await assert.rejects(revertirStock(B, id, m), ErrorDeUsuario);
  assert.equal((await alertasDeStock(B)).negativos.length, 0);
});

test('los movimientos de stock quedan en la auditoría', async () => {
  const id = await producto(A, 'Auditado');
  const m = await registrarStock(A, id, { ...ajuste, cantidad: '2' });
  const a = await conTenant(A.tenantId, (x) => x.query("SELECT accion FROM auditoria WHERE entidad='stock' AND entidad_id=$1", [m]));
  assert.equal(a.rows[0].accion, 'movimiento');
});
