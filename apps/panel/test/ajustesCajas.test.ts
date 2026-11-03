// Cajas en Ajustes: archivar solo si están cerradas y sin saldo, ordenar, y la caja preferida de cada medio de pago.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, cambiarEstadoCaja, cerrarCaja, guardarCaja, listarCajas, listarCajasParaAjustes, moverCaja, movimientoManual } from '../lib/cajas.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { guardarMedioDePago, listarMediosDePago } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let caja1 = '', caja2 = '', caja3 = '';

async function comercio(slug: string): Promise<SesionActiva> {
  const email = `${slug}@ejemplo.test`;
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const nombres = async () => (await listarCajas(A)).map((c) => c.nombre);

before(async () => {
  A = await comercio(`ajc-a-${sufijo}`);
  B = await comercio(`ajc-b-${sufijo}`);
  caja1 = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  caja2 = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 1.2 });
  caja3 = await guardarCaja(A, null, { nombre: 'Billetera', tipo: 'digital', impuestoTransaccion: 0 });
});
after(async () => {
  await cerrarPool();
});

test('editar una caja cambia nombre, tipo e impuesto', async () => {
  await guardarCaja(A, caja3, { nombre: 'Billetera virtual', tipo: 'digital', impuestoTransaccion: 0.6 });
  const k = (await listarCajas(A)).find((c) => c.id === caja3)!;
  assert.equal(k.nombre, 'Billetera virtual');
  assert.equal(k.impuestoTransaccion, 0.6);
  await assert.rejects(guardarCaja(A, caja3, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 0 }), ErrorDeUsuario);   // nombre repetido
});

test('ordenar: subir y bajar cajas', async () => {
  assert.deepEqual(await nombres(), ['Efectivo', 'Banco', 'Billetera virtual']);
  await moverCaja(A, caja3, 'arriba');
  assert.deepEqual(await nombres(), ['Efectivo', 'Billetera virtual', 'Banco']);
  await moverCaja(A, caja3, 'arriba');
  await moverCaja(A, caja3, 'arriba');          // ya está primera: no pasa nada
  assert.deepEqual(await nombres(), ['Billetera virtual', 'Efectivo', 'Banco']);
  await moverCaja(A, caja3, 'abajo');
  assert.deepEqual(await nombres(), ['Efectivo', 'Billetera virtual', 'Banco']);
});

test('archivar: solo cerrada y sin saldo; se puede reactivar y el libro queda', async () => {
  await abrirCaja(A, caja2, { contado: '0' });
  await assert.rejects(cambiarEstadoCaja(A, caja2, false), ErrorDeUsuario);               // abierta
  await movimientoManual(A, caja2, { tipo: 'ingreso', importe: '100', concepto: 'x' });
  await cerrarCaja(A, caja2, { contado: '100', cambioDejado: '100', destinoId: null });
  await assert.rejects(cambiarEstadoCaja(A, caja2, false), ErrorDeUsuario);               // con saldo
  await abrirCaja(A, caja2, { contado: '100' });
  await movimientoManual(A, caja2, { tipo: 'egreso', importe: '100', concepto: 'x' });
  await cerrarCaja(A, caja2, { contado: '0', cambioDejado: '0', destinoId: null });
  await cambiarEstadoCaja(A, caja2, false);
  assert.ok(!(await nombres()).includes('Banco'));
  const todas = await listarCajasParaAjustes(A);
  assert.equal(todas.find((c) => c.id === caja2)?.activa, false);
  assert.equal(todas.at(-1)?.id, caja2);                                                   // las archivadas van al final
  await cambiarEstadoCaja(A, caja2, true);
  assert.ok((await nombres()).includes('Banco'));
});

test('cada medio de pago propone primero su caja preferida', async () => {
  const id = await guardarMedioDePago(A, null, { nombre: 'Transferencia', comisionPct: 0, ivaComision: 21, cajaIds: [caja3, caja1, caja2] });
  assert.deepEqual((await listarMediosDePago(A)).find((m) => m.id === id)?.cajaIds, [caja3, caja1, caja2]);
  await guardarMedioDePago(A, id, { nombre: 'Transferencia', comisionPct: 0, ivaComision: 21, cajaIds: [caja2, caja3] });
  assert.deepEqual((await listarMediosDePago(A)).find((m) => m.id === id)?.cajaIds, [caja2, caja3]);
});

test('permisos y aislamiento', async () => {
  const sin: SesionActiva = { ...A, rol: 'cocina', permisos: [] };
  await assert.rejects(listarCajasParaAjustes(sin), ErrorDePermiso);
  await assert.rejects(cambiarEstadoCaja(sin, caja1, false), ErrorDePermiso);
  await assert.rejects(moverCaja(sin, caja1, 'arriba'), ErrorDePermiso);
  await assert.rejects(cambiarEstadoCaja(B, caja1, false), ErrorDeUsuario);
  await assert.rejects(moverCaja(B, caja1, 'arriba'), ErrorDeUsuario);
  assert.equal((await listarCajasParaAjustes(B)).length, 0);
});
