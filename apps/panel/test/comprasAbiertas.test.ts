// Compras abiertas: borradores compartidos entre usuarios, con control de versión; al cerrar nace la compra real y el borrador queda cerrado.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja, obtenerCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarCompra, listarCompras } from '../lib/compras.ts';
import { ConflictoDeVersionCompra, descartarCompraAbierta, guardarCompraAbierta, listarComprasAbiertas, obtenerCompraAbierta } from '../lib/comprasAbiertas.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarProveedor } from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let A2: SesionActiva;
let B: SesionActiva;
let caja = '', prov = '', cafe = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const borrador = (over: Record<string, unknown> = {}) => ({
  proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descTotal: '0', modoCostos: 'ninguno', pagoTipo: 'caja', cajaId: caja, nota: '', total: '1000.00',
  renglones: [{ productoId: cafe, descripcion: 'Café', cantidad: '10', costo: '100', descuentoPct: '0', iva: 21 }], ...over,
});
const cierre = (abiertaId: string | null, over: Record<string, unknown> = {}) => ({
  clave: randomUUID(), abiertaId, proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
  renglones: [{ productoId: cafe, descripcion: '', cantidad: '10', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'caja', cajaId: caja }, ...over,
});

before(async () => {
  A = await sesionDe(`cab-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`cab-b-${sufijo}`, 'b@ejemplo.test');
  const u2 = await conTenant(A.tenantId, (c) => c.query<{ id: string }>(
    "INSERT INTO usuarios (tenant_id, nombre, email, rol, activo) VALUES (app.tenant_id(), 'Turno tarde', 'tarde@ejemplo.test', 'atencion', true) RETURNING id"));
  A2 = { ...A, usuarioId: u2.rows[0]!.id, nombre: 'Turno tarde', rol: 'atencion' };
  const lista = (await listasDePrecios(A))[0]!.id;
  caja = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, caja, { contado: '50000' });
  prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
});
after(async () => { await cerrarPool(); });

test('una compra abierta se guarda y no mueve caja ni stock', async () => {
  const cajaAntes = (await obtenerCaja(A, caja))?.saldo;
  const a = await guardarCompraAbierta(A, null, 0, borrador());
  assert.equal(a.version, 1);
  assert.equal((await obtenerCaja(A, caja))?.saldo, cajaAntes);
  assert.equal((await obtenerProducto(A, cafe))?.stock, '0.000');
  const fila = (await listarComprasAbiertas(A)).find((x) => x.id === a.id)!;
  assert.deepEqual([fila.renglones, fila.total, fila.proveedor, fila.creadaPor], [1, '1000.00', 'Distribuidora', 'Admin']);
});

test('otro usuario la ve y la continúa; dos personas a la vez no se pisan', async () => {
  const a = await guardarCompraAbierta(A, null, 0, borrador({ nota: 'turno mañana' }));
  assert.equal((await obtenerCompraAbierta(A2, a.id))?.datos.nota, 'turno mañana');
  const b = await guardarCompraAbierta(A2, a.id, a.version, borrador({ nota: 'turno tarde' }));
  assert.equal(b.version, a.version + 1);
  assert.equal((await listarComprasAbiertas(A)).find((x) => x.id === a.id)!.modificadaPor, 'Turno tarde');
  await assert.rejects(guardarCompraAbierta(A, a.id, a.version, borrador({ nota: 'viejo' })), ConflictoDeVersionCompra);
  assert.equal((await obtenerCompraAbierta(A, a.id))?.datos.nota, 'turno tarde');
});

test('cerrar la compra abierta crea la compra real una sola vez y cierra el borrador', async () => {
  const a = await guardarCompraAbierta(A, null, 0, borrador());
  const cajaAntes = Number((await obtenerCaja(A, caja))?.saldo);
  const r = await cerrarCompra(A2, cierre(a.id));
  assert.equal(r.total, '1000.00');
  assert.equal(cajaAntes - Number((await obtenerCaja(A, caja))?.saldo), 1000);
  assert.equal(await obtenerCompraAbierta(A, a.id), null);
  const f = await conTenant(A.tenantId, (c) => c.query('SELECT estado, compra_id FROM compras_abiertas WHERE id = $1', [a.id]));
  assert.deepEqual([f.rows[0].estado, f.rows[0].compra_id], ['cerrada', r.id]);
  await assert.rejects(cerrarCompra(A, cierre(a.id)), ErrorDeUsuario);
  await assert.rejects(guardarCompraAbierta(A, a.id, a.version, borrador()), ErrorDeUsuario);
});

test('cerrar la misma abierta dos veces a la vez crea una sola compra', async () => {
  const a = await guardarCompraAbierta(A, null, 0, borrador());
  const antes = (await listarCompras(A, { limite: 200 })).length;
  const res = await Promise.allSettled([cerrarCompra(A, cierre(a.id)), cerrarCompra(A2, cierre(a.id))]);
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await listarCompras(A, { limite: 200 })).length, antes + 1);
});

test('descartar la saca de la lista, queda registrada y no se borra', async () => {
  const a = await guardarCompraAbierta(A, null, 0, borrador());
  await descartarCompraAbierta(A2, a.id);
  assert.equal(await obtenerCompraAbierta(A, a.id), null);
  await assert.rejects(descartarCompraAbierta(A, a.id), ErrorDeUsuario);
  await assert.rejects(cerrarCompra(A, cierre(a.id)), ErrorDeUsuario);
  const r = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad = 'compra_abierta' AND entidad_id = $1 ORDER BY id", [a.id]));
  assert.deepEqual(r.rows.map((x) => x.accion), ['abrir', 'descartar']);
  await assert.rejects(conTenant(A.tenantId, (c) => c.query('DELETE FROM compras_abiertas WHERE id = $1', [a.id])));
});

test('rechaza borradores inválidos y no cruza comercios', async () => {
  await assert.rejects(guardarCompraAbierta(A, null, 0, borrador({ renglones: [] })), ErrorDeUsuario);
  await assert.rejects(guardarCompraAbierta(A, null, 0, borrador({ proveedorId: randomUUID() })), ErrorDeUsuario);
  await assert.rejects(guardarCompraAbierta(A, null, 0, borrador({ proveedorId: '' })), ErrorDeUsuario);
  const a = await guardarCompraAbierta(A, null, 0, borrador());
  assert.equal(await obtenerCompraAbierta(B, a.id), null);
  assert.ok(!(await listarComprasAbiertas(B)).some((x) => x.id === a.id));
  await assert.rejects(descartarCompraAbierta(B, a.id), ErrorDeUsuario);
  await assert.rejects(cerrarCompra(B, cierre(a.id)), ErrorDeUsuario);
});
