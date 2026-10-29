// Catálogo: aislamiento entre comercios, búsqueda, rubros, validaciones y auditoría. Requiere base real.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { archivarProducto, archivarRubro, crearRubro, guardarProducto, listarProductos, listasDePrecios, obtenerProducto } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let listasA: { id: string; nombre: string }[] = [];

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}

const base = { codigo: '', nombre: 'Producto', rubroId: null as string | null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: {} as Record<string, string>, stockMinimo: '', stockIdeal: '' };

before(async () => {
  A = await sesionDe(`cat-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`cat-b-${sufijo}`, 'b@ejemplo.test');
  listasA = await listasDePrecios(A);
});
after(async () => {
  await cerrarPool();
});

test('cada comercio tiene sus listas Minorista y Mayorista', () => {
  assert.deepEqual(listasA.map((l) => l.nombre), ['Minorista', 'Mayorista']);
});

test('crea un producto con precios y deja auditoría', async () => {
  const id = await guardarProducto(A, null, { ...base, nombre: 'Té de manzanilla', codigo: 'T1', precios: { [listasA[0]!.id]: '1.234,50' } });
  const p = await obtenerProducto(A, id);
  assert.equal(p?.precios[listasA[0]!.id], '1234.50');
  const a = await conTenant(A.tenantId, (c) => c.query("SELECT accion FROM auditoria WHERE entidad='producto' AND entidad_id=$1", [id]));
  assert.equal(a.rows[0].accion, 'crear');
});

test('la modificación audita antes y después', async () => {
  const id = await guardarProducto(A, null, { ...base, nombre: 'Antes' });
  await guardarProducto(A, id, { ...base, nombre: 'Después' });
  const a = await conTenant(A.tenantId, (c) => c.query("SELECT antes, despues FROM auditoria WHERE entidad_id=$1 AND accion='modificar'", [id]));
  assert.equal(a.rows[0].antes.nombre, 'Antes');
  assert.equal(a.rows[0].despues.nombre, 'Después');
});

test('el código se repite entre comercios pero no dentro del mismo', async () => {
  await guardarProducto(A, null, { ...base, nombre: 'Uno', codigo: 'DUP' });
  await guardarProducto(B, null, { ...base, nombre: 'Uno', codigo: 'DUP' });
  await assert.rejects(guardarProducto(A, null, { ...base, nombre: 'Dos', codigo: 'dup' }), ErrorDeUsuario);
});

test('un comercio no ve ni modifica productos de otro', async () => {
  const id = await guardarProducto(A, null, { ...base, nombre: 'Secreto de A' });
  assert.equal(await obtenerProducto(B, id), null);
  assert.equal((await listarProductos(B, { q: 'secreto' })).total, 0);
  await assert.rejects(guardarProducto(B, id, { ...base, nombre: 'Robado' }), ErrorDeUsuario);
  await assert.rejects(archivarProducto(B, id, false), ErrorDeUsuario);
});

test('la búsqueda ignora tildes, mayúsculas, plurales y orden', async () => {
  await guardarProducto(A, null, { ...base, nombre: 'Aceite esencial de lavanda' });
  for (const q of ['LAVANDA aceite', 'aceites lavándas', 'esencial']) {
    assert.equal((await listarProductos(A, { q })).filas.some((f) => f.nombre === 'Aceite esencial de lavanda'), true, q);
  }
});

test('el filtro por rubro incluye los subrubros', async () => {
  const padre = await crearRubro(A, { nombre: 'Infusiones', padreId: null });
  const hijo = await crearRubro(A, { nombre: 'Tés', padreId: padre });
  await guardarProducto(A, null, { ...base, nombre: 'Earl Grey rubro', rubroId: hijo });
  assert.equal((await listarProductos(A, { rubroId: padre, q: 'earl grey' })).total, 1);
  await assert.rejects(crearRubro(A, { nombre: 'infusiones', padreId: null }), ErrorDeUsuario);
  await assert.rejects(archivarRubro(A, hijo, false), ErrorDeUsuario); // tiene productos
});

test('archivar oculta de la lista activa sin borrar', async () => {
  const id = await guardarProducto(A, null, { ...base, nombre: 'Para archivar' });
  await archivarProducto(A, id, false);
  assert.equal((await listarProductos(A, { q: 'para archivar' })).total, 0);
  assert.equal((await listarProductos(A, { q: 'para archivar', estado: 'archivados' })).total, 1);
});

test('rechaza IVA inválido, importes negativos y enlaces raros', async () => {
  await assert.rejects(guardarProducto(A, null, { ...base, iva: 5 }), ErrorDeUsuario);
  await assert.rejects(guardarProducto(A, null, { ...base, costo: '-10' }), ErrorDeUsuario);
  await assert.rejects(guardarProducto(A, null, { ...base, urlWeb: 'javascript:alert(1)' }), ErrorDeUsuario);
  await assert.rejects(guardarProducto(A, null, { ...base, nombre: '  ' }), ErrorDeUsuario);
  await assert.rejects(guardarProducto(A, null, { ...base, precios: { [listasA[0]!.id]: '-5' } }), ErrorDeUsuario);
});

test('no acepta una lista de precios de otro comercio', async () => {
  const listasB = await listasDePrecios(B);
  await assert.rejects(guardarProducto(A, null, { ...base, precios: { [listasB[0]!.id]: '10' } }), ErrorDeUsuario);
});
