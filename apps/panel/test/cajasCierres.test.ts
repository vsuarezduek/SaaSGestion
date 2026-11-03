// Detalle de un cierre y reapertura el mismo día: se anula lo que generó el cierre, queda el motivo y solo administración puede.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, cerrarCaja, cierreReabrible, detalleDeCierre, guardarCaja, historialDeCierres, movimientoManual, obtenerCaja, reabrirCaja } from '../lib/cajas.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let efectivo = '', banco = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const saldo = async (id: string) => Number((await obtenerCaja(A, id))?.saldo);

before(async () => {
  A = await sesionDe(`cie-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`cie-b-${sufijo}`, 'b@ejemplo.test');
  efectivo = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  banco = await guardarCaja(A, null, { nombre: 'Banco', tipo: 'digital', impuestoTransaccion: 0 });
  await abrirCaja(A, efectivo, { contado: '1000' });
  await abrirCaja(A, banco, { contado: '0' });
});
after(async () => {
  await cerrarPool();
});

test('el detalle de un cierre muestra arqueo, totales y movimientos', async () => {
  await movimientoManual(A, efectivo, { tipo: 'ingreso', importe: '500', concepto: 'Cobro' });
  await movimientoManual(A, efectivo, { tipo: 'egreso', importe: '200', concepto: 'Gasto' });
  // Esperado 1300; se cuentan 1290 (faltan 10), se dejan 100 de cambio y el resto va al banco.
  await cerrarCaja(A, efectivo, { contado: '1290', cambioDejado: '100', destinoId: banco });
  const [cierre] = await historialDeCierres(A, efectivo);
  const d = (await detalleDeCierre(A, cierre!.id))!;
  assert.equal(Number(d.cierreEsperado), 1300);
  assert.equal(Number(d.diferencia), -10);
  assert.equal(Number(d.ingresos), 500);
  assert.equal(Number(d.egresos), 200);
  assert.equal(Number(d.traspaso), 1190);
  assert.equal(await detalleDeCierre(B, cierre!.id), null);   // otro comercio
  assert.equal(await detalleDeCierre(A, 'no-es-uuid'), null);
  assert.equal(await saldo(efectivo), 100);
  assert.equal(await saldo(banco), 1190);
});

test('reabrir: exige administrador y motivo, anula diferencia y traspaso y deja la caja abierta', async () => {
  const cocina: SesionActiva = { ...A, rol: 'cocina', permisos: [] };
  await assert.rejects(reabrirCaja(cocina, efectivo, 'Me olvidé un cobro'), ErrorDePermiso);
  await assert.rejects(reabrirCaja(A, efectivo, '  '), ErrorDeUsuario);
  assert.ok(await cierreReabrible(A, efectivo));
  assert.equal(await cierreReabrible(cocina, efectivo), null);
  await reabrirCaja(A, efectivo, 'Me olvidé un cobro');
  const c = await obtenerCaja(A, efectivo);
  assert.equal(c?.abierta, true);
  assert.equal(Number(c?.saldo), 1300);   // vuelve a lo esperado: se deshizo el traspaso y la diferencia de arqueo
  assert.equal(await saldo(banco), 0);
  // El libro sigue siendo de solo agregar: todo lo anulado tiene su inverso que lo referencia.
  const rev = await conTenant(A.tenantId, (k) => k.query('SELECT count(*)::int AS n FROM caja_movimientos WHERE tipo = \'reversion\' AND concepto = \'Reapertura de caja\''));
  assert.equal(rev.rows[0].n, 3);
  assert.equal(await cierreReabrible(A, efectivo), null);          // está abierta
  await assert.rejects(reabrirCaja(A, efectivo, 'otra vez'), ErrorDeUsuario);
});

test('se puede volver a cerrar y el cierre de la continuación guarda el motivo', async () => {
  await cerrarCaja(A, efectivo, { contado: '1300', cambioDejado: '1300', destinoId: null });
  const [ultimo] = await historialDeCierres(A, efectivo);
  const d = (await detalleDeCierre(A, ultimo!.id))!;
  assert.equal(d.reaperturaMotivo, 'Me olvidé un cobro');
  assert.ok(d.reabreTurnoId);
  assert.equal(d.reabierto, false);
  const anterior = (await detalleDeCierre(A, d.reabreTurnoId!))!;
  assert.equal(anterior.reabierto, true);
  assert.equal(Number(d.aperturaEsperada), 1300);
  assert.equal(Number(d.diferencia), 0);
});
