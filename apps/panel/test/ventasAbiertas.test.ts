// Ventas abiertas: borradores compartidos entre usuarios, con control de versión; al cerrar nace la venta real y el borrador queda cerrado.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { cerrarVenta, buscarClientesParaVenta, guardarMedioDePago, listarVentas } from '../lib/ventas.ts';
import { ConflictoDeVersion, descartarAbierta, guardarAbierta, listarAbiertas, obtenerAbierta } from '../lib/ventasAbiertas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;   // un usuario
let A2: SesionActiva;  // otro usuario del mismo comercio
let B: SesionActiva;   // otro comercio
let lista = '', efectivo = '', medio = '', consumidor = '', cafe = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const borrador = (over: Record<string, unknown> = {}) => ({
  clienteId: consumidor, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', modoDesc: 'pct', descTotal: '0', totalFinal: '', cobroTipo: 'caja',
  medioId: medio, cajaId: efectivo, nota: '', total: '2000.00',
  renglones: [{ productoId: cafe, descripcion: 'Café', cantidad: '2', precio: '1000', descuentoPct: '0', iva: 21, stock: '10.000' }], ...over,
});
const cierre = (abiertaId: string | null, over: Record<string, unknown> = {}) => ({
  clave: randomUUID(), abiertaId, clienteId: consumidor, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
  renglones: [{ productoId: cafe, descripcion: '', cantidad: '2', precio: '1000', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: efectivo }, ...over,
});

before(async () => {
  A = await sesionDe(`abi-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`abi-b-${sufijo}`, 'b@ejemplo.test');
  // Segundo usuario del mismo comercio (otro turno).
  const u2 = await conTenant(A.tenantId, (c) => c.query<{ id: string }>(
    "INSERT INTO usuarios (tenant_id, nombre, email, rol, activo) VALUES (app.tenant_id(), 'Turno tarde', 'tarde@ejemplo.test', 'atencion', true) RETURNING id"));
  A2 = { ...A, usuarioId: u2.rows[0]!.id, nombre: 'Turno tarde', rol: 'atencion' };
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

test('una venta abierta se guarda y no mueve caja ni stock', async () => {
  const cajaAntes = (await obtenerCaja(A, efectivo))?.saldo;
  const a = await guardarAbierta(A, null, 0, borrador());
  assert.equal(a.version, 1);
  assert.equal((await obtenerCaja(A, efectivo))?.saldo, cajaAntes);
  assert.equal((await obtenerProducto(A, cafe))?.stock, '0.000');
  const fila = (await listarAbiertas(A)).find((x) => x.id === a.id)!;
  assert.equal(fila.renglones, 1);
  assert.equal(fila.total, '2000.00');
  assert.equal(fila.creadaPor, 'Admin');
});

test('otro usuario del comercio ve la venta abierta y la puede continuar', async () => {
  const a = await guardarAbierta(A, null, 0, borrador({ nota: 'del turno mañana' }));
  const vista = await obtenerAbierta(A2, a.id);
  assert.equal(vista?.datos.nota, 'del turno mañana');
  assert.equal(vista?.cliente.id, consumidor);
  const b = await guardarAbierta(A2, a.id, a.version, borrador({ nota: 'seguida por el turno tarde' }));
  assert.equal(b.version, a.version + 1);
  const fila = (await listarAbiertas(A)).find((x) => x.id === a.id)!;
  assert.equal(fila.creadaPor, 'Admin');
  assert.equal(fila.modificadaPor, 'Turno tarde');
});

test('dos personas editando la misma: la segunda se entera en vez de pisar a la primera', async () => {
  const a = await guardarAbierta(A, null, 0, borrador());
  await guardarAbierta(A, a.id, a.version, borrador({ nota: 'cambio de A' }));
  await assert.rejects(guardarAbierta(A2, a.id, a.version, borrador({ nota: 'cambio viejo de A2' })), ConflictoDeVersion);
  assert.equal((await obtenerAbierta(A, a.id))?.datos.nota, 'cambio de A');
});

test('cerrar la venta abierta crea la venta real, mueve caja y stock una sola vez y cierra el borrador', async () => {
  const a = await guardarAbierta(A, null, 0, borrador());
  const cajaAntes = Number((await obtenerCaja(A, efectivo))?.saldo);
  const r = await cerrarVenta(A2, cierre(a.id));        // la cierra otro usuario
  assert.equal(r.total, '2000.00');
  assert.equal(Number((await obtenerCaja(A, efectivo))?.saldo) - cajaAntes, 2000);
  assert.equal(await obtenerAbierta(A, a.id), null);    // ya no figura como abierta
  assert.ok(!(await listarAbiertas(A)).some((x) => x.id === a.id));
  const f = await conTenant(A.tenantId, (c) => c.query('SELECT estado, venta_id FROM ventas_abiertas WHERE id = $1', [a.id]));
  assert.equal(f.rows[0].estado, 'cerrada');
  assert.equal(f.rows[0].venta_id, r.id);
  // No se puede cerrar de nuevo ni seguir editando.
  await assert.rejects(cerrarVenta(A, cierre(a.id)), ErrorDeUsuario);
  await assert.rejects(guardarAbierta(A, a.id, a.version, borrador()), ErrorDeUsuario);
});

test('cerrar la misma venta abierta dos veces a la vez crea una sola venta', async () => {
  const a = await guardarAbierta(A, null, 0, borrador());
  const antes = (await listarVentas(A, { limite: 200 })).length;
  const res = await Promise.allSettled([cerrarVenta(A, cierre(a.id)), cerrarVenta(A2, cierre(a.id))]);
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await listarVentas(A, { limite: 200 })).length, antes + 1);
});

test('descartar una venta abierta la saca de la lista y no se puede volver a usar', async () => {
  const a = await guardarAbierta(A, null, 0, borrador());
  await descartarAbierta(A2, a.id);
  assert.equal(await obtenerAbierta(A, a.id), null);
  await assert.rejects(descartarAbierta(A, a.id), ErrorDeUsuario);
  await assert.rejects(cerrarVenta(A, cierre(a.id)), ErrorDeUsuario);
  const r = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad = 'venta_abierta' AND entidad_id = $1 ORDER BY id", [a.id]));
  assert.deepEqual(r.rows.map((x) => x.accion), ['abrir', 'descartar']);
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('DELETE FROM ventas_abiertas WHERE id = $1', [a.id])));
});

test('rechaza borradores inválidos', async () => {
  await assert.rejects(guardarAbierta(A, null, 0, borrador({ renglones: [] })), ErrorDeUsuario);
  await assert.rejects(guardarAbierta(A, null, 0, borrador({ clienteId: randomUUID() })), ErrorDeUsuario);
  await assert.rejects(guardarAbierta(A, null, 0, borrador({ clienteId: 'no-es-uuid' })), ErrorDeUsuario);
  await assert.rejects(guardarAbierta(A, null, 0, borrador({ nota: 'x'.repeat(501) })), ErrorDeUsuario);
  await assert.rejects(guardarAbierta(A, randomUUID(), 1, borrador()), ErrorDeUsuario);
});

test('un comercio no ve ni toca las ventas abiertas de otro', async () => {
  const a = await guardarAbierta(A, null, 0, borrador());
  assert.equal(await obtenerAbierta(B, a.id), null);
  assert.equal((await listarAbiertas(B)).length, 0);
  await assert.rejects(descartarAbierta(B, a.id), ErrorDeUsuario);
  await assert.rejects(guardarAbierta(B, a.id, a.version, borrador()), ErrorDeUsuario);
  assert.ok(await obtenerAbierta(A, a.id));
});
