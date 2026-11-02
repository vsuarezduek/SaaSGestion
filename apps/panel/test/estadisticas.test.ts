// Estadísticas: períodos, totales sobre ventas cerradas (las anuladas no cuentan), rankings, permiso y aislamiento entre comercios.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { estadisticasDe, hoyArgentina, periodoDe } from '../lib/estadisticas.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { registrarStock } from '../lib/stock.ts';
import { anularVenta, cerrarVenta, guardarMedioDePago } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '', caja = '', medio = '', cafe = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const vender = (cantidad: string) =>
  cerrarVenta(A, { clave: randomUUID(), clienteId: undefined, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad, precio: '1000', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: caja } });

before(async () => {
  A = await sesionDe(`est-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`est-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
  caja = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, caja, { contado: '0' });
  medio = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [caja] });
  cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: 'Bebidas', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
  await registrarStock(A, cafe, { tipo: 'saldo_inicial', cantidad: '50', concepto: '' });
});
after(async () => {
  await cerrarPool();
});

test('períodos rápidos y fechas elegidas', () => {
  assert.deepEqual(periodoDe('hoy', undefined, undefined, '2026-11-02'), { desde: '2026-11-02', hasta: '2026-11-02', nombre: 'Hoy' });
  assert.equal(periodoDe('7d', undefined, undefined, '2026-11-02').desde, '2026-10-27');
  assert.equal(periodoDe(undefined, undefined, undefined, '2026-11-02').desde, '2026-11-01');
  const ant = periodoDe('mes_anterior', undefined, undefined, '2026-01-15');
  assert.equal(ant.desde, '2025-12-01');
  assert.equal(ant.hasta, '2025-12-31');
  assert.throws(() => periodoDe(undefined, '2026-02-10', '2026-02-01'), ErrorDeUsuario);
  assert.throws(() => periodoDe(undefined, 'mañana', '2026-02-01'), ErrorDeUsuario);
});

test('totales del período: las ventas anuladas no cuentan', async () => {
  await vender('2');
  const b = await vender('1');
  const hoy = hoyArgentina();
  const per = periodoDe(undefined, hoy, hoy);
  let e = await estadisticasDe(A, per);
  assert.equal(e.operaciones, 2);
  assert.equal(e.ventas, 300000);
  assert.equal(e.ticketPromedio, 150000);
  assert.ok(e.rentabilidad > 0);
  await anularVenta(A, b.id, 'Error de carga');
  e = await estadisticasDe(A, per);
  assert.equal(e.operaciones, 1);
  assert.equal(e.ventas, 200000);
  const top = e.series.find((s) => s.clave === 'productos')!;
  assert.equal(top.puntos[0]?.etiqueta, 'Café');
  assert.equal(e.series.find((s) => s.clave === 'tiempo')!.puntos.at(-1)?.valor, 200000);
  assert.equal(e.series.find((s) => s.clave === 'cajas')!.puntos[0]?.etiqueta, 'Efectivo');
});

test('un período sin ventas da ceros y otro comercio no ve nada', async () => {
  const vacio = await estadisticasDe(A, periodoDe(undefined, '2020-01-01', '2020-01-31'));
  assert.equal(vacio.ventas, 0);
  assert.equal(vacio.operaciones, 0);
  assert.equal(vacio.ticketPromedio, 0);
  const hoy = hoyArgentina();
  const deB = await estadisticasDe(B, periodoDe(undefined, hoy, hoy));
  assert.equal(deB.ventas, 0);
  assert.equal(deB.operaciones, 0);
});

test('exige el permiso de informes y limita el largo del período', async () => {
  await assert.rejects(estadisticasDe({ ...A, rol: 'cocina', permisos: [] }, periodoDe('hoy', undefined, undefined)), ErrorDePermiso);
  await assert.rejects(estadisticasDe(A, periodoDe(undefined, '2000-01-01', '2026-01-01')), ErrorDeUsuario);
});
