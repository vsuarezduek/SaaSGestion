// Inicio: frase del día, actividad legible, resumen de hoy y mercadería a pedir por proveedor.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, type SesionActiva } from '../lib/auth.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { faltantesParaComprar } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { actividadReciente, describirActividad, FRASES, fraseDelDia, resumenDeHoy, totalActividad } from '../lib/inicio.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { guardarProveedor } from '../lib/personas.ts';
import { registrarStock } from '../lib/stock.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let lista = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
before(async () => {
  A = await sesionDe(`ini-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`ini-b-${sufijo}`, 'b@ejemplo.test');
  lista = (await listasDePrecios(A))[0]!.id;
});
after(async () => {
  await cerrarPool();
});

test('la frase del día es estable durante el día y cambia con los días', () => {
  assert.deepEqual(fraseDelDia('2026-11-02'), fraseDelDia('2026-11-02'));
  assert.notDeepEqual(fraseDelDia('2026-11-02'), fraseDelDia('2026-11-03'));
  assert.ok(FRASES.every((f) => f.texto && f.autor));
  assert.ok(FRASES.every((f) => /Séneca|Marco Aurelio|Epicteto|Zenón/.test(f.autor)), 'solo estoicos');
});

test('la actividad se describe en palabras y no muestra datos técnicos', () => {
  assert.equal(describirActividad('Ana', 'crear', 'producto').texto, 'Ana creó un producto');
  assert.equal(describirActividad('Ana', 'anular', 'venta').enlace, '/ventas');
  assert.equal(describirActividad(null, 'ingresar', 'sesion').texto, 'Alguien ingresó');
});

test('mercadería a pedir: se agrupa por proveedor y se puede filtrar', async () => {
  const prov = await guardarProveedor(A, null, { nombre: 'Distribuidora Norte', contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  const base = { codigo: '', rubroId: null, tipo: '', unidad: 'unidad', costo: '10', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '100' }, stockMinimo: '5', stockIdeal: '10' };
  const conProv = await guardarProducto(A, null, { ...base, nombre: 'Yerba', proveedorId: prov });
  const sinProv = await guardarProducto(A, null, { ...base, nombre: 'Azúcar' });
  await registrarStock(A, conProv, { tipo: 'saldo_inicial', cantidad: '2', concepto: '' });
  await registrarStock(A, sinProv, { tipo: 'saldo_inicial', cantidad: '1', concepto: '' });
  const todos = await faltantesParaComprar(A);
  assert.equal(todos.length, 2);
  const yerba = todos.find((f) => f.id === conProv)!;
  assert.equal(yerba.proveedorNombre, 'Distribuidora Norte');
  assert.equal(yerba.cantidad, '8');
  assert.equal(todos.find((f) => f.id === sinProv)!.proveedorId, null);
  assert.deepEqual((await faltantesParaComprar(A, { proveedorId: prov })).map((f) => f.id), [conProv]);
  assert.deepEqual((await faltantesParaComprar(A, { ids: [sinProv] })).map((f) => f.id), [sinProv]);
  assert.equal((await faltantesParaComprar(B)).length, 0);
});

test('resumen del día y actividad: sin ventas da ceros, y la actividad exige administración', async () => {
  const r = await resumenDeHoy(A);
  assert.equal(r.ventas, 0);
  assert.equal(r.ticketPromedio, 0);
  const act = await actividadReciente(A);
  assert.ok(act.some((x) => x.texto === 'Admin creó un producto'));
  const cocina: SesionActiva = { ...A, rol: 'cocina', permisos: [] };
  await assert.rejects(actividadReciente(cocina), ErrorDePermiso);
  assert.ok((await totalActividad(A)) >= act.length, 'el total cuenta todo el historial, no solo lo mostrado');
  assert.ok((await actividadReciente(A, 1)).length <= 1);
  await assert.rejects(totalActividad(cocina), ErrorDePermiso);
  assert.equal((await resumenDeHoy(cocina)).ventas, 0);
});

test('mercadería fuera del catálogo (D-041): se anota con cantidad y proveedor, se quita sin borrarse y está aislada', async () => {
  const { agregarMercaderiaManual, mercaderiaManual, quitarMercaderiaManual } = await import('../lib/aPedir.ts');
  const prov = await guardarProveedor(A, null, { nombre: `Bolsas ${sufijo}`, contacto: '', categoria: '', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  const id = await agregarMercaderiaManual(A, { descripcion: '  Bolsas kraft medianas ', cantidad: '1.000,5', proveedorId: prov });
  await agregarMercaderiaManual(A, { descripcion: 'Cinta de embalar' });
  let l = await mercaderiaManual(A);
  const bolsas = l.find((m) => m.id === id)!;
  assert.equal(bolsas.descripcion, 'Bolsas kraft medianas');
  assert.equal(bolsas.cantidad, '1000.500');
  assert.equal(bolsas.proveedorId, prov);
  assert.ok(l.some((m) => m.descripcion === 'Cinta de embalar' && m.cantidad === null && m.proveedorId === null));
  assert.deepEqual((await mercaderiaManual(A, { ids: [id] })).map((m) => m.id), [id], 'filtra por los elegidos al armar la compra');
  assert.deepEqual(await mercaderiaManual(A, { ids: [] }), []);
  await assert.rejects(agregarMercaderiaManual(A, { descripcion: '   ' }), /Escribí/);
  await assert.rejects(agregarMercaderiaManual(A, { descripcion: 'x', cantidad: '-2' }), /cantidad/);
  await assert.rejects(agregarMercaderiaManual(B, { descripcion: 'x', proveedorId: prov }), /proveedor/, 'no puede usar un proveedor de otro comercio');
  assert.deepEqual(await mercaderiaManual(B), [], 'B no ve lo de A');
  await assert.rejects(quitarMercaderiaManual(B, id), /Ya no está/, 'B no puede quitar lo de A');
  await quitarMercaderiaManual(A, id);
  l = await mercaderiaManual(A);
  assert.ok(!l.some((m) => m.id === id));
  await assert.rejects(quitarMercaderiaManual(A, id), /Ya no está/);
  const n = await conTenant(A.tenantId, (c) => c.query("SELECT estado FROM mercaderia_a_pedir WHERE id = $1", [id]));
  assert.equal(n.rows[0]!.estado, 'quitada', 'queda el rastro');
  const atencion: SesionActiva = { ...A, rol: 'atencion', permisos: [] };
  assert.ok(Array.isArray(await mercaderiaManual(atencion)), 'Compras es sección base: cualquier usuario del comercio la ve');
});
