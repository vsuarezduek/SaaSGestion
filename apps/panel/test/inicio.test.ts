// Inicio: frase del día, actividad legible, resumen de hoy y mercadería a pedir por proveedor.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, type SesionActiva } from '../lib/auth.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { faltantesParaComprar } from '../lib/compras.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { actividadReciente, describirActividad, FRASES, fraseDelDia, resumenDeHoy } from '../lib/inicio.ts';
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
  assert.equal((await resumenDeHoy(cocina)).ventas, 0);
});
