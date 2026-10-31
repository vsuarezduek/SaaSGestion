// Importación de listas por CSV: clientes, proveedores y productos. Vista previa sin tocar nada, errores por fila, actualización y aislamiento.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { listasDePrecios } from '../lib/catalogo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { importarLista, parsearCsv, plantilla } from '../lib/importar.ts';
import { guardarCategoria } from '../lib/personas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let nombreLista = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const contar = async (S: SesionActiva, tabla: 'clientes' | 'proveedores' | 'productos') =>
  Number((await conTenant(S.tenantId, (c) => c.query<{ n: string }>(`SELECT count(*) AS n FROM ${tabla}`))).rows[0]!.n);
const saldoDe = async (S: SesionActiva, tabla: 'cliente_id' | 'proveedor_id', nombre: string) =>
  Number((await conTenant(S.tenantId, (c) => c.query<{ s: string }>(
    `SELECT COALESCE(sum(m.importe), 0) AS s FROM cuenta_corriente_movimientos m JOIN ${tabla === 'cliente_id' ? 'clientes' : 'proveedores'} x ON x.id = m.${tabla} WHERE x.nombre = $1`, [nombre]))).rows[0]!.s);
const opc = { actualizar: false, simular: false };

before(async () => {
  A = await sesionDe(`imp-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`imp-b-${sufijo}`, 'b@ejemplo.test');
  nombreLista = (await listasDePrecios(A))[0]!.nombre;
});
after(async () => {
  await cerrarPool();
});

test('el CSV acepta coma, punto y coma y tabulación, comillas, saltos de línea y BOM', () => {
  assert.deepEqual(parsearCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parsearCsv('a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parsearCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parsearCsv('﻿a,b\n"x, y","línea 1\nlínea 2"'), [['a', 'b'], ['x, y', 'línea 1\nlínea 2']]);
  assert.deepEqual(parsearCsv('a,b\n"di ""hola""",2'), [['a', 'b'], ['di "hola"', '2']]);
});

test('importa clientes con saldo inicial; una segunda pasada los omite si no se pide actualizar', async () => {
  await guardarCategoria(A, null, { nombre: 'Mayoristas', listaId: null, cuentaCorriente: true, descuento: 0, ventaACosto: false });
  const csv = 'Nombre;Categoría;Teléfono;Email;CUIT;Condición IVA;Saldo\nJuana Pérez;Mayoristas;2615550000;JUANA@correo.com;20-12345678-9;Monotributo;1.500,50\nPedro Gómez;;;;;;';
  const r = await importarLista(A, 'clientes', csv, opc);
  assert.deepEqual([r.total, r.creados, r.actualizados, r.omitidos, r.erroresTotales], [2, 2, 0, 0, 0]);
  assert.equal(await saldoDe(A, 'cliente_id', 'Juana Pérez'), 1500.5);
  const j = await conTenant(A.tenantId, (c) => c.query('SELECT email, cuit, condicion_iva FROM clientes WHERE nombre = $1', ['Juana Pérez']));
  assert.equal(j.rows[0].email, 'juana@correo.com');
  assert.equal(j.rows[0].condicion_iva, 'monotributo');
  const otra = await importarLista(A, 'clientes', csv, opc);
  assert.deepEqual([otra.creados, otra.omitidos], [0, 2]);
  assert.equal(await saldoDe(A, 'cliente_id', 'Juana Pérez'), 1500.5);   // el saldo inicial no se duplica
});

test('la vista previa cuenta lo que pasaría pero no guarda nada', async () => {
  const antes = await contar(A, 'proveedores');
  const r = await importarLista(A, 'proveedores', 'Nombre,Saldo\nDistribuidora Sur,200\nMayorista Norte,0', { actualizar: false, simular: true });
  assert.equal(r.simulacion, true);
  assert.equal(r.creados, 2);
  assert.equal(await contar(A, 'proveedores'), antes);
  const real = await importarLista(A, 'proveedores', 'Nombre,Saldo\nDistribuidora Sur,200\nMayorista Norte,0', opc);
  assert.equal(real.creados, 2);
  assert.equal(await saldoDe(A, 'proveedor_id', 'Distribuidora Sur'), 200);
});

test('con "actualizar" solo cambia lo que el archivo trae con dato y no toca el saldo', async () => {
  await importarLista(A, 'clientes', 'Nombre,Teléfono,Localidad\nLaura Díaz,111,Maipú', opc);
  const r = await importarLista(A, 'clientes', 'Nombre,Teléfono,Localidad,Saldo\nlaura díaz,222,,999', { actualizar: true, simular: false });
  assert.deepEqual([r.creados, r.actualizados], [0, 1]);
  const f = (await conTenant(A.tenantId, (c) => c.query('SELECT telefono, localidad FROM clientes WHERE lower(nombre) = lower($1)', ['Laura Díaz']))).rows[0];
  assert.equal(f.telefono, '222');
  assert.equal(f.localidad, 'Maipú');                                     // la celda vacía no borra
  assert.equal(await saldoDe(A, 'cliente_id', 'laura díaz'), 0);          // el saldo solo se carga en registros nuevos
});

test('los errores se informan por fila y no frenan al resto', async () => {
  const antes = await contar(A, 'clientes');
  const csv = 'Nombre,Categoría,Condición IVA,Saldo\nOk Uno,,,\n,Mayoristas,,\nCategoría rara,No existe,,\nIVA raro,,Marciano,\nSaldo malo,,,abc\nOk Dos,,,';
  const r = await importarLista(A, 'clientes', csv, opc);
  assert.equal(r.creados, 2);
  assert.equal(r.erroresTotales, 4);
  assert.deepEqual(r.errores.map((e) => e.fila), [3, 4, 5, 6]);
  assert.equal(await contar(A, 'clientes'), antes + 2);
});

test('sin columna de nombre o sin filas se rechaza', async () => {
  await assert.rejects(importarLista(A, 'clientes', 'Teléfono\n123', opc), ErrorDeUsuario);
  await assert.rejects(importarLista(A, 'clientes', 'Nombre', opc), ErrorDeUsuario);
  await assert.rejects(importarLista(A, 'otra' as never, 'Nombre\nx', opc), ErrorDeUsuario);
});

test('importa productos: rubros anidados, costo, IVA, precio por lista y stock inicial', async () => {
  const csv = `Código;Nombre;Rubro;Costo;IVA;${nombreLista};Stock\nC1;Té verde;Infusiones > Tés;100;10,5;350;12\nC2;Yerba;Infusiones;80;21;250;`;
  const r = await importarLista(A, 'productos', csv, opc);
  assert.deepEqual([r.creados, r.erroresTotales], [2, 0]);
  const p = (await conTenant(A.tenantId, (c) => c.query(
    `SELECT p.costo::text, p.iva::text, r.nombre AS rubro, pa.nombre AS padre,
            (SELECT precio::text FROM producto_precios WHERE producto_id = p.id LIMIT 1) AS precio,
            (SELECT COALESCE(sum(cantidad), 0)::text FROM stock_movimientos WHERE producto_id = p.id) AS stock
       FROM productos p JOIN rubros r ON r.id = p.rubro_id LEFT JOIN rubros pa ON pa.id = r.padre_id WHERE p.codigo = 'C1'`))).rows[0];
  assert.deepEqual([p.costo, p.iva, p.rubro, p.padre, p.precio, p.stock], ['100.00', '10.5', 'Tés', 'Infusiones', '350.00', '12.000']);
  const otra = await importarLista(A, 'productos', csv, { actualizar: true, simular: false });
  assert.deepEqual([otra.creados, otra.actualizados], [0, 2]);
  const rubros = await conTenant(A.tenantId, (c) => c.query("SELECT count(*) AS n FROM rubros WHERE lower(nombre) = 'infusiones'"));
  assert.equal(Number(rubros.rows[0].n), 1);                              // no duplica rubros
  const stock = await conTenant(A.tenantId, (c) => c.query("SELECT COALESCE(sum(cantidad),0)::text AS s FROM stock_movimientos sm JOIN productos p ON p.id = sm.producto_id WHERE p.codigo = 'C1'"));
  assert.equal(stock.rows[0].s, '12.000');                                // el stock inicial no se repite al actualizar
});

test('productos con datos inválidos fallan solo esa fila', async () => {
  const r = await importarLista(A, 'productos', 'Nombre,Costo,IVA\nBueno,10,21\nIVA malo,10,13\nCosto malo,xx,21', opc);
  assert.deepEqual([r.creados, r.erroresTotales], [1, 2]);
});

test('lo importado en un comercio no aparece en otro', async () => {
  assert.equal(await contar(B, 'proveedores'), 0);
  assert.equal(await contar(B, 'productos'), 0);
  assert.ok((await contar(B, 'clientes')) <= 1);                          // a lo sumo su Consumidor Final
  await importarLista(B, 'proveedores', 'Nombre\nDistribuidora Sur', opc);   // mismo nombre que en A: no choca
  assert.equal(await contar(B, 'proveedores'), 1);
});

test('la plantilla trae encabezados que la propia importación entiende', async () => {
  for (const tipo of ['clientes', 'proveedores', 'productos'] as const) {
    const csv = plantilla(tipo, [nombreLista]);
    const r = await importarLista(B, tipo, csv, { actualizar: false, simular: true });
    assert.equal(r.erroresTotales, 0, `${tipo}: ${JSON.stringify(r.errores)}`);
  }
});
