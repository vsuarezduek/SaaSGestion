// Clientes, proveedores y cuenta corriente: aislamiento, búsqueda, validaciones y libro de solo agregar.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import {
  archivarCliente, guardarCategoria, guardarCliente, guardarProveedor, listarClientes, listarProveedores,
  movimientosDe, obtenerCliente, obtenerProveedor, registrarMovimiento, revertirMovimiento,
} from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}

const cli = { nombre: 'Cliente', categoriaId: null as string | null, telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final' };
const prov = { nombre: 'Proveedor', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null as string | null };

before(async () => {
  A = await sesionDe(`per-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`per-b-${sufijo}`, 'b@ejemplo.test');
});
after(async () => {
  await cerrarPool();
});

test('cada comercio tiene su Consumidor Final y no se puede archivar', async () => {
  const { filas } = await listarClientes(A, { q: 'consumidor final' });
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.esConsumidorFinal, true);
  await assert.rejects(archivarCliente(A, filas[0]!.id, false), ErrorDeUsuario);
});

test('crea un cliente, normaliza CUIT y mail, y audita', async () => {
  const id = await guardarCliente(A, null, { ...cli, nombre: 'María Pérez', cuit: '20-12345678-9', email: ' MARIA@Ejemplo.COM ' });
  const c = await obtenerCliente(A, id);
  assert.equal(c?.cuit, '20123456789');
  assert.equal(c?.email, 'maria@ejemplo.com');
  const a = await conTenant(A.tenantId, (x) => x.query("SELECT accion FROM auditoria WHERE entidad='cliente' AND entidad_id=$1", [id]));
  assert.equal(a.rows[0].accion, 'crear');
});

test('rechaza CUIT, mail y condición de IVA inválidos', async () => {
  await assert.rejects(guardarCliente(A, null, { ...cli, cuit: '123' }), ErrorDeUsuario);
  await assert.rejects(guardarCliente(A, null, { ...cli, email: 'no-es-mail' }), ErrorDeUsuario);
  await assert.rejects(guardarCliente(A, null, { ...cli, condicionIva: 'inventada' }), ErrorDeUsuario);
  await assert.rejects(guardarCliente(A, null, { ...cli, nombre: ' ' }), ErrorDeUsuario);
});

test('la búsqueda ignora tildes, mayúsculas y orden', async () => {
  await guardarCliente(A, null, { ...cli, nombre: 'José Luis Gómez' });
  for (const q of ['gomez jose', 'LUIS', 'jóse']) assert.equal((await listarClientes(A, { q })).filas.some((f) => f.nombre === 'José Luis Gómez'), true, q);
});

test('un comercio no ve ni toca clientes y proveedores de otro', async () => {
  const c = await guardarCliente(A, null, { ...cli, nombre: 'Solo de A' });
  const p = await guardarProveedor(A, null, { ...prov, nombre: 'Proveedor de A' });
  assert.equal(await obtenerCliente(B, c), null);
  assert.equal(await obtenerProveedor(B, p), null);
  assert.equal((await listarClientes(B, { q: 'solo de a' })).total, 0);
  assert.equal((await listarProveedores(B, { q: 'proveedor de a' })).total, 0);
  await assert.rejects(guardarCliente(B, c, { ...cli, nombre: 'Robado' }), ErrorDeUsuario);
  await assert.rejects(registrarMovimiento(B, { cliente: c }, { tipo: 'ajuste', importe: '10', concepto: '' }), ErrorDeUsuario);
});

test('una categoría no puede usar la lista de precios de otro comercio ni descuentos fuera de rango', async () => {
  await assert.rejects(guardarCategoria(A, null, { nombre: 'X', listaId: null, cuentaCorriente: false, descuento: 101, ventaACosto: false }), ErrorDeUsuario);
  await assert.rejects(guardarCategoria(A, null, { nombre: 'X', listaId: null, cuentaCorriente: false, descuento: -1, ventaACosto: false }), ErrorDeUsuario);
  const id = await guardarCategoria(A, null, { nombre: 'Mayoristas', listaId: null, cuentaCorriente: true, descuento: 5, ventaACosto: false });
  await assert.rejects(guardarCategoria(A, null, { nombre: 'mayoristas', listaId: null, cuentaCorriente: false, descuento: 0, ventaACosto: false }), ErrorDeUsuario);
  const c = await guardarCliente(A, null, { ...cli, nombre: 'Con categoría', categoriaId: id });
  assert.equal((await obtenerCliente(A, c))?.categoriaId, id);
  await assert.rejects(guardarCliente(B, null, { ...cli, categoriaId: id }), ErrorDeUsuario);
});

test('el saldo se calcula sumando movimientos y revertir genera el inverso', async () => {
  const c = await guardarCliente(A, null, { ...cli, nombre: 'Con deuda' });
  const m1 = await registrarMovimiento(A, { cliente: c }, { tipo: 'saldo_inicial', importe: '1.500,50', concepto: 'Migración' });
  await registrarMovimiento(A, { cliente: c }, { tipo: 'ajuste', importe: '-500', concepto: '' });
  assert.equal((await obtenerCliente(A, c))?.saldo, '1000.50');
  await revertirMovimiento(A, { cliente: c }, m1);
  assert.equal((await obtenerCliente(A, c))?.saldo, '-500.00');
  const movs = await movimientosDe(A, { cliente: c });
  assert.equal(movs.find((m) => m.id === m1)?.revertido, true);
  assert.equal(movs.filter((m) => m.tipo === 'reversion').length, 1);
});

test('no se puede revertir dos veces, ni revertir una reversión', async () => {
  const c = await guardarCliente(A, null, { ...cli, nombre: 'Reversiones' });
  const m = await registrarMovimiento(A, { cliente: c }, { tipo: 'ajuste', importe: '100', concepto: '' });
  const r = await revertirMovimiento(A, { cliente: c }, m);
  await assert.rejects(revertirMovimiento(A, { cliente: c }, m), ErrorDeUsuario);
  await assert.rejects(revertirMovimiento(A, { cliente: c }, r), ErrorDeUsuario);
  assert.equal((await obtenerCliente(A, c))?.saldo, '0.00');
});

test('no se revierte el movimiento de otro cliente ni de otro comercio', async () => {
  const c1 = await guardarCliente(A, null, { ...cli, nombre: 'Uno' });
  const c2 = await guardarCliente(A, null, { ...cli, nombre: 'Dos' });
  const m = await registrarMovimiento(A, { cliente: c1 }, { tipo: 'ajuste', importe: '10', concepto: '' });
  await assert.rejects(revertirMovimiento(A, { cliente: c2 }, m), ErrorDeUsuario);
  await assert.rejects(revertirMovimiento(B, { cliente: c1 }, m), ErrorDeUsuario);
});

test('el libro no admite modificar ni borrar movimientos', async () => {
  const c = await guardarCliente(A, null, { ...cli, nombre: 'Libro' });
  await registrarMovimiento(A, { cliente: c }, { tipo: 'ajuste', importe: '10', concepto: '' });
  await assert.rejects(conTenant(A.tenantId, (x) => x.query('UPDATE cuenta_corriente_movimientos SET importe = 1')));
  await assert.rejects(conTenant(A.tenantId, (x) => x.query('DELETE FROM cuenta_corriente_movimientos')));
});

test('los proveedores llevan su propia cuenta corriente y rechazan importes en cero', async () => {
  const p = await guardarProveedor(A, null, { ...prov, nombre: 'Distribuidora', categoria: 'Té' });
  await registrarMovimiento(A, { proveedor: p }, { tipo: 'saldo_inicial', importe: '2500', concepto: '' });
  assert.equal((await obtenerProveedor(A, p))?.saldo, '2500.00');
  await assert.rejects(registrarMovimiento(A, { proveedor: p }, { tipo: 'ajuste', importe: '0', concepto: '' }), ErrorDeUsuario);
  await assert.rejects(registrarMovimiento(A, { proveedor: p }, { tipo: 'ajuste', importe: 'abc', concepto: '' }), ErrorDeUsuario);
});

test('archivar oculta de la lista sin perder el historial', async () => {
  const c = await guardarCliente(A, null, { ...cli, nombre: 'Para archivar' });
  await registrarMovimiento(A, { cliente: c }, { tipo: 'ajuste', importe: '10', concepto: '' });
  await archivarCliente(A, c, false);
  assert.equal((await listarClientes(A, { q: 'para archivar' })).total, 0);
  assert.equal((await listarClientes(A, { q: 'para archivar', estado: 'archivados' })).total, 1);
  assert.equal((await movimientosDe(A, { cliente: c })).length, 1);
});
