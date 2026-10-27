// Prueba de integración contra una base real (DATABASE_URL_LOCAL o DATABASE_URL_STAGING).
// Verifica ingreso, sesiones, límite de intentos, auditoría y aislamiento entre comercios.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cerrarSesion,
  comercioPorSlug,
  crearComercio,
  ErrorDeUsuario,
  ingresar,
  MAX_FALLOS_POR_EMAIL,
  sesionDesdeCookie,
} from '../lib/auth.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';

const sufijo = Date.now().toString(36);
const slugA = `prueba-a-${sufijo}`;
const slugB = `prueba-b-${sufijo}`;
const slugC = `prueba-c-${sufijo}`;
const EMAIL = 'ana@ejemplo.test'; // el mismo en los dos comercios: está permitido
const CLAVE_A = 'clave-de-a-123';
const CLAVE_B = 'clave-de-b-456';
let idA = '';
let idB = '';
let idC = '';

before(async () => {
  idA = await crearComercio({ slug: slugA, nombre: 'Comercio A', email: EMAIL, nombreAdmin: 'Ana A', contrasena: CLAVE_A });
  idB = await crearComercio({ slug: slugB, nombre: 'Comercio B', email: EMAIL, nombreAdmin: 'Ana B', contrasena: CLAVE_B });
  idC = await crearComercio({ slug: slugC, nombre: 'Comercio C', email: EMAIL, nombreAdmin: 'Ana C', contrasena: CLAVE_B });
});

after(async () => {
  await cerrarPool();
});

test('los comercios se resuelven por identificador y no se puede repetir', async () => {
  assert.equal((await comercioPorSlug(slugA))?.id, idA);
  assert.equal(await comercioPorSlug('no-existe-xyz'), null);
  await assert.rejects(
    crearComercio({ slug: slugA, nombre: 'Repetido', email: 'x@x.test', nombreAdmin: 'X', contrasena: 'una-clave-larga' }),
    ErrorDeUsuario,
  );
});

test('rechaza contraseñas cortas y datos inválidos al crear un comercio', async () => {
  await assert.rejects(
    crearComercio({ slug: `corta-${sufijo}`, nombre: 'X', email: 'x@x.test', nombreAdmin: 'X', contrasena: 'corta' }),
    ErrorDeUsuario,
  );
  await assert.rejects(
    crearComercio({ slug: 'Mal Slug!', nombre: 'X', email: 'x@x.test', nombreAdmin: 'X', contrasena: 'una-clave-larga' }),
    ErrorDeUsuario,
  );
});

test('ingreso correcto crea una sesión válida del comercio correcto', async () => {
  const r = await ingresar({ slug: slugA, email: EMAIL, contrasena: CLAVE_A, ip: '10.0.0.1' });
  assert.ok(r.ok);
  const s = await sesionDesdeCookie(r.cookie);
  assert.equal(s?.comercio, 'Comercio A');
  assert.equal(s?.tenantId, idA);
  assert.equal(s?.rol, 'administrador');
});

test('la misma clave no sirve en otro comercio y el token de A no abre sesión en B', async () => {
  assert.deepEqual(await ingresar({ slug: slugB, email: EMAIL, contrasena: CLAVE_A, ip: '10.0.0.2' }), { ok: false, motivo: 'credenciales' });
  const r = await ingresar({ slug: slugA, email: EMAIL, contrasena: CLAVE_A, ip: '10.0.0.1' });
  assert.ok(r.ok);
  const token = r.cookie.slice(r.cookie.indexOf('.') + 1);
  assert.equal(await sesionDesdeCookie(`${idB}.${token}`), null);
});

test('credenciales inválidas no revelan si el usuario o el comercio existen', async () => {
  const ip = '10.0.0.3';
  assert.deepEqual(await ingresar({ slug: slugA, email: 'nadie@ejemplo.test', contrasena: 'cualquiera-123', ip }), { ok: false, motivo: 'credenciales' });
  assert.deepEqual(await ingresar({ slug: 'no-existe-xyz', email: EMAIL, contrasena: 'cualquiera-123', ip }), { ok: false, motivo: 'credenciales' });
  assert.deepEqual(await ingresar({ slug: slugA, email: EMAIL, contrasena: 'x'.repeat(500), ip }), { ok: false, motivo: 'credenciales' });
});

test('tras varios intentos fallidos el correo se bloquea, incluso con la clave correcta, y no afecta a otro comercio', async () => {
  // Comercio C: nadie más lo usa, así los fallos se cuentan desde cero.
  assert.ok(idC);
  for (let i = 0; i < MAX_FALLOS_POR_EMAIL; i++) {
    const r = await ingresar({ slug: slugC, email: EMAIL, contrasena: 'incorrecta-123', ip: `10.1.0.${i}` });
    assert.deepEqual(r, { ok: false, motivo: 'credenciales' });
  }
  assert.deepEqual(await ingresar({ slug: slugC, email: EMAIL, contrasena: CLAVE_B, ip: '10.1.0.99' }), { ok: false, motivo: 'bloqueado' });
  // El mismo correo en el comercio A sigue entrando.
  assert.ok((await ingresar({ slug: slugA, email: EMAIL, contrasena: CLAVE_A, ip: '10.1.0.99' })).ok);
});

test('un ingreso correcto borra los fallos anteriores de ese correo', async () => {
  const ip = '10.3.0.1';
  for (let i = 0; i < MAX_FALLOS_POR_EMAIL - 1; i++) {
    await ingresar({ slug: slugB, email: EMAIL, contrasena: 'incorrecta-123', ip: `10.3.1.${i}` });
  }
  assert.ok((await ingresar({ slug: slugB, email: EMAIL, contrasena: CLAVE_B, ip })).ok);
  // Quedó en cero: se pueden volver a cometer errores sin bloqueo inmediato.
  assert.deepEqual(await ingresar({ slug: slugB, email: EMAIL, contrasena: 'incorrecta-123', ip }), { ok: false, motivo: 'credenciales' });
});

test('la auditoría registra ingresos y fallos, y cada comercio ve solo la suya', async () => {
  const propias = await conTenant(idA, (c) => c.query<{ accion: string }>('SELECT accion FROM auditoria'));
  const acciones = new Set(propias.rows.map((f) => f.accion));
  assert.ok(acciones.has('ingresar'));
  assert.ok(acciones.has('ingreso_fallido'));
  const ajenas = await conTenant(idA, (c) => c.query('SELECT 1 FROM auditoria WHERE tenant_id <> app.tenant_id()'));
  assert.equal(ajenas.rowCount, 0);
  const comercios = await conTenant(idA, (c) => c.query('SELECT 1 FROM tenants'));
  assert.equal(comercios.rowCount, 1);
});

test('salir invalida la sesión', async () => {
  const r = await ingresar({ slug: slugA, email: EMAIL, contrasena: CLAVE_A, ip: '10.2.0.1' });
  assert.ok(r.ok);
  assert.ok(await sesionDesdeCookie(r.cookie));
  await cerrarSesion(r.cookie);
  assert.equal(await sesionDesdeCookie(r.cookie), null);
});

test('una cookie mal formada se ignora', async () => {
  assert.equal(await sesionDesdeCookie(undefined), null);
  assert.equal(await sesionDesdeCookie('basura'), null);
  assert.equal(await sesionDesdeCookie(`${idA}.corto`), null);
  assert.equal(await sesionDesdeCookie(`${idA}.${'a'.repeat(43)}`), null);
});
