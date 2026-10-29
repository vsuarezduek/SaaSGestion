// Cajas: apertura, movimientos, transferencias, cierre con arqueo, bloqueo, anulaciones y visibilidad.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import {
  abrirCaja, cerrarCaja, guardarCaja, historialDeCierres, listarCajas, movimientoManual, movimientosDeCaja, obtenerCaja,
  resumenDelTurno, revertirMovimientoCaja, transferir,
} from '../lib/cajas.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const nueva = (S: SesionActiva, nombre: string, tipo = 'efectivo', impuestoTransaccion = 0) => guardarCaja(S, null, { nombre, tipo, impuestoTransaccion });
const saldo = async (S: SesionActiva, id: string) => (await obtenerCaja(S, id))?.saldo;
const ingreso = (importe: string, concepto = '') => ({ tipo: 'ingreso', importe, concepto, fecha: '' });

before(async () => {
  A = await sesionDe(`caj-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`caj-b-${sufijo}`, 'b@ejemplo.test');
});
after(async () => {
  await cerrarPool();
});

test('una caja nueva está cerrada y no admite movimientos hasta abrirla', async () => {
  const id = await nueva(A, 'Efectivo');
  assert.equal((await obtenerCaja(A, id))?.abierta, false);
  await assert.rejects(movimientoManual(A, id, ingreso('100')), ErrorDeUsuario);
});

test('abrir cuenta el efectivo y registra la diferencia contra lo esperado', async () => {
  const id = await nueva(A, 'Abre con diferencia');
  await abrirCaja(A, id, { contado: '500' });
  assert.equal(await saldo(A, id), '500.00'); // esperado 0 → la diferencia deja 500
  const m = await movimientosDeCaja(A, id);
  assert.equal(m[0]!.tipo, 'apertura_diferencia');
  await assert.rejects(abrirCaja(A, id, { contado: '1' }), ErrorDeUsuario); // ya abierta
});

test('ingresos y egresos mueven el saldo; no acepta importes en cero o negativos', async () => {
  const id = await nueva(A, 'Movimientos');
  await abrirCaja(A, id, { contado: '0' });
  await movimientoManual(A, id, ingreso('1.000,50', 'Venta'));
  await movimientoManual(A, id, { tipo: 'egreso', importe: '250', concepto: 'Gasto', fecha: '' });
  assert.equal(await saldo(A, id), '750.50');
  for (const importe of ['0', '-5', 'abc']) await assert.rejects(movimientoManual(A, id, ingreso(importe)), ErrorDeUsuario, importe);
  await assert.rejects(movimientoManual(A, id, { ...ingreso('5'), fecha: 'mañana' }), ErrorDeUsuario);
});

test('la fecha elegida se respeta (hora de Argentina)', async () => {
  const id = await nueva(A, 'Con fecha');
  await abrirCaja(A, id, { contado: '0' });
  await movimientoManual(A, id, { ...ingreso('10'), fecha: '2026-10-01T09:30' });
  const m = (await movimientosDeCaja(A, id)).find((x) => x.tipo === 'ingreso')!;
  assert.equal(m.fecha.toISOString(), '2026-10-01T12:30:00.000Z');
});

test('transferir mueve plata entre cajas abiertas, "todo" vacía el origen y se anula en las dos puntas', async () => {
  const o = await nueva(A, 'Origen');
  const d = await nueva(A, 'Destino');
  await abrirCaja(A, o, { contado: '0' });
  await assert.rejects(transferir(A, { origenId: o, destinoId: d, importe: '10', concepto: '' }), ErrorDeUsuario); // destino cerrada
  await abrirCaja(A, d, { contado: '0' });
  await movimientoManual(A, o, ingreso('300'));
  const t = await transferir(A, { origenId: o, destinoId: d, importe: '100', concepto: '' });
  assert.deepEqual([await saldo(A, o), await saldo(A, d)], ['200.00', '100.00']);
  await transferir(A, { origenId: o, destinoId: d, importe: null, concepto: 'Todo' });
  assert.deepEqual([await saldo(A, o), await saldo(A, d)], ['0.00', '300.00']);
  await assert.rejects(transferir(A, { origenId: o, destinoId: o, importe: '1', concepto: '' }), ErrorDeUsuario);
  await assert.rejects(transferir(A, { origenId: o, destinoId: d, importe: null, concepto: '' }), ErrorDeUsuario); // sin saldo
  await revertirMovimientoCaja(A, d, t);
  assert.deepEqual([await saldo(A, o), await saldo(A, d)], ['100.00', '200.00']);
});

test('anular genera el inverso, una sola vez, y no se anula una anulación', async () => {
  const id = await nueva(A, 'Anulaciones');
  await abrirCaja(A, id, { contado: '0' });
  const m = await movimientoManual(A, id, ingreso('80'));
  await revertirMovimientoCaja(A, id, m);
  assert.equal(await saldo(A, id), '0.00');
  await assert.rejects(revertirMovimientoCaja(A, id, m), ErrorDeUsuario);
  const anul = (await movimientosDeCaja(A, id)).find((x) => x.tipo === 'reversion')!;
  await assert.rejects(revertirMovimientoCaja(A, id, anul.id), ErrorDeUsuario);
});

test('cierre con arqueo: faltante registrado, cambio que se deja y traspaso del resto', async () => {
  const caja = await nueva(A, 'Cierra');
  const dest = await nueva(A, 'Respaldo');
  await abrirCaja(A, caja, { contado: '0' });
  await abrirCaja(A, dest, { contado: '0' });
  await movimientoManual(A, caja, ingreso('1000'));
  const r = await resumenDelTurno(A, caja);
  assert.equal(r?.ingresos, '1000.00');
  await cerrarCaja(A, caja, { contado: '950', cambioDejado: '200', destinoId: dest });
  assert.equal(await saldo(A, caja), '200.00'); // 1000 − 50 de faltante − 750 traspasado
  assert.equal(await saldo(A, dest), '750.00');
  assert.equal((await obtenerCaja(A, caja))?.abierta, false);
  const h = (await historialDeCierres(A, caja))[0]!;
  assert.deepEqual([h.esperado, h.contado, h.diferencia, h.traspaso, h.destino], ['1000.00', '950.00', '-50.00', '750.00', 'Respaldo']);
  await assert.rejects(cerrarCaja(A, caja, { contado: '0', cambioDejado: '0', destinoId: null }), ErrorDeUsuario); // ya cerrada
});

test('caja cerrada = bloqueada (no recibe cobros ni transferencias), pero admite anulaciones', async () => {
  const c1 = await nueva(A, 'Se cierra');
  const c2 = await nueva(A, 'Otra');
  await abrirCaja(A, c1, { contado: '0' });
  await abrirCaja(A, c2, { contado: '0' });
  const m = await movimientoManual(A, c1, ingreso('60'));
  await cerrarCaja(A, c1, { contado: '60', cambioDejado: '60', destinoId: null });
  await assert.rejects(movimientoManual(A, c1, ingreso('5')), ErrorDeUsuario);
  await assert.rejects(transferir(A, { origenId: c2, destinoId: c1, importe: '1', concepto: '' }), ErrorDeUsuario);
  await revertirMovimientoCaja(A, c1, m);
  assert.equal(await saldo(A, c1), '0.00');
});

test('el cierre valida cambio, destino cerrado y diferencia de signo contrario', async () => {
  const c1 = await nueva(A, 'Valida cierre');
  const c2 = await nueva(A, 'Destino cerrado');
  await abrirCaja(A, c1, { contado: '100' });
  await assert.rejects(cerrarCaja(A, c1, { contado: '100', cambioDejado: '200', destinoId: null }), ErrorDeUsuario);
  await assert.rejects(cerrarCaja(A, c1, { contado: '100', cambioDejado: '0', destinoId: c2 }), ErrorDeUsuario);
  await assert.rejects(cerrarCaja(A, c1, { contado: '100', cambioDejado: '0', destinoId: c1 }), ErrorDeUsuario);
  await cerrarCaja(A, c1, { contado: '130', cambioDejado: '130', destinoId: null }); // sobrante de 30
  assert.equal(await saldo(A, c1), '130.00');
  await abrirCaja(A, c1, { contado: '130' }); // reabre contando lo mismo: sin diferencia
  assert.equal((await movimientosDeCaja(A, c1, 50)).filter((m) => m.tipo === 'apertura_diferencia').length, 1);
});

test('un comercio no ve ni opera las cajas de otro', async () => {
  const id = await nueva(A, 'Solo de A');
  await abrirCaja(A, id, { contado: '10' });
  assert.equal(await obtenerCaja(B, id), null);
  assert.equal((await listarCajas(B)).length, 0);
  await assert.rejects(abrirCaja(B, id, { contado: '1' }), ErrorDeUsuario);
  await assert.rejects(movimientoManual(B, id, ingreso('1')), ErrorDeUsuario);
  await assert.rejects(cerrarCaja(B, id, { contado: '0', cambioDejado: '0', destinoId: null }), ErrorDeUsuario);
});

test('cada usuario ve solo sus movimientos y solo las cajas habilitadas; configurar requiere permiso', async () => {
  const visible = await nueva(A, 'Visible');
  const oculta = await nueva(A, 'Oculta');
  const u = await conTenant(A.tenantId, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO usuarios (tenant_id, email, nombre, rol, cajas_visibles) VALUES (app.tenant_id(), 'cajera@ejemplo.test', 'Cajera', 'atencion', $1) RETURNING id", [[visible]]));
  const cajera: SesionActiva = { ...A, usuarioId: u.rows[0]!.id, nombre: 'Cajera', email: 'cajera@ejemplo.test', rol: 'atencion' };
  await abrirCaja(A, visible, { contado: '0' });
  await movimientoManual(A, visible, ingreso('10', 'del admin'));
  await movimientoManual(cajera, visible, ingreso('20', 'de la cajera'));
  assert.equal((await movimientosDeCaja(A, visible)).length, 2);
  const suyos = await movimientosDeCaja(cajera, visible);
  assert.deepEqual(suyos.map((m) => m.concepto), ['de la cajera']);
  assert.deepEqual((await listarCajas(cajera)).map((c) => c.nombre), ['Visible']);
  assert.equal(await obtenerCaja(cajera, oculta), null);
  await assert.rejects(abrirCaja(cajera, oculta, { contado: '0' }), ErrorDeUsuario);
  await assert.rejects(nueva(cajera, 'No debería'), ErrorDePermiso);
});

test('valida la configuración de la caja y no repite nombres', async () => {
  await assert.rejects(nueva(A, ' '), ErrorDeUsuario);
  await assert.rejects(nueva(A, 'Impuesto raro', 'efectivo', 150), ErrorDeUsuario);
  await assert.rejects(guardarCaja(A, null, { nombre: 'Tipo raro', tipo: 'otra', impuestoTransaccion: 0 }), ErrorDeUsuario);
  await nueva(A, 'Mercado Pago', 'digital', 0.6);
  await assert.rejects(nueva(A, 'mercado pago', 'digital'), ErrorDeUsuario);
});
