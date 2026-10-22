import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashear, verificar, validarContrasena, validarPin } from '../src/contrasenas.ts';
import { nuevoToken, hashDeToken, estaVigente } from '../src/sesiones.ts';
import { puede, puedeVerCaja, requierePassword, type UsuarioAutorizable } from '../src/permisos.ts';

test('contraseña: hash correcto verifica y uno incorrecto no', async () => {
  const h = await hashear('R3M1S3R0-prueba');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verificar('R3M1S3R0-prueba', h), true);
  assert.equal(await verificar('otra-contraseña', h), false);
});

test('contraseña: dos hashes de la misma clave son distintos (sal aleatoria)', async () => {
  assert.notEqual(await hashear('misma-clave-123'), await hashear('misma-clave-123'));
});

test('contraseña: hashes ausentes o corruptos se rechazan sin romper', async () => {
  assert.equal(await verificar('x', null), false);
  assert.equal(await verificar('x', ''), false);
  assert.equal(await verificar('x', 'basura'), false);
  assert.equal(await verificar('x', 'scrypt$2$8$1$AAAA$AAAA'), false); // costo demasiado bajo
});

test('contraseña: la normalización unicode no cambia el resultado', async () => {
  const h = await hashear('café-largo-123'); // é compuesta
  assert.equal(await verificar('café-largo-123', h), true); // e + acento combinado
});

test('validaciones de contraseña y PIN', () => {
  assert.notEqual(validarContrasena('corta'), null);
  assert.notEqual(validarContrasena('1234567'), null); // 7 caracteres: rechazada
  assert.equal(validarContrasena('12345678'), null);   // 8 caracteres: mínimo aceptado
  assert.equal(validarContrasena('suficientemente-larga'), null);
  assert.equal(validarPin('1234'), null);
  assert.notEqual(validarPin('12'), null);
  assert.notEqual(validarPin('12ab'), null);
});

test('sesión: el token no se guarda, solo su hash; vence a las 12 h', () => {
  const ahora = new Date('2026-01-01T10:00:00Z');
  const t = nuevoToken(ahora);
  assert.notEqual(t.token, t.tokenHash);
  assert.equal(hashDeToken(t.token), t.tokenHash);
  assert.equal(t.expiraEn.toISOString(), '2026-01-01T22:00:00.000Z');
  assert.equal(estaVigente(t.expiraEn, new Date('2026-01-01T21:59:59Z')), true);
  assert.equal(estaVigente(t.expiraEn, new Date('2026-01-01T22:00:00Z')), false);
  assert.notEqual(nuevoToken().token, nuevoToken().token);
});

const base: UsuarioAutorizable = { rol: 'atencion', permisos: [], activo: true, cajasVisibles: null };

test('permisos: secciones base para todos, extras solo si se otorgan', () => {
  for (const s of ['ventas', 'clientes', 'proveedores', 'compras', 'cajas', 'productos'] as const) assert.equal(puede(base, s), true, s);
  for (const s of ['ajustes', 'informes', 'descargar', 'permisos'] as const) assert.equal(puede(base, s), false, s);
  assert.equal(puede({ ...base, permisos: ['informes'] }, 'informes'), true);
  assert.equal(puede({ ...base, permisos: ['informes'] }, 'ajustes'), false);
});

test('permisos: el administrador accede a todo y un usuario inactivo a nada', () => {
  assert.equal(puede({ ...base, rol: 'administrador' }, 'permisos'), true);
  assert.equal(puede({ ...base, activo: false }, 'ventas'), false);
  assert.equal(puede({ ...base, rol: 'administrador', activo: false }, 'ventas'), false);
});

test('cajas visibles: null = todas; lista = solo esas; el administrador ve todas', () => {
  assert.equal(puedeVerCaja(base, 'c1'), true);
  assert.equal(puedeVerCaja({ ...base, cajasVisibles: ['c1'] }, 'c1'), true);
  assert.equal(puedeVerCaja({ ...base, cajasVisibles: ['c1'] }, 'c2'), false);
  assert.equal(puedeVerCaja({ ...base, rol: 'administrador', cajasVisibles: ['c1'] }, 'c2'), true);
});

test('solo el administrador requiere contraseña', () => {
  assert.equal(requierePassword('administrador'), true);
  for (const r of ['encargada', 'atencion', 'cocina', 'marketing'] as const) assert.equal(requierePassword(r), false);
});
