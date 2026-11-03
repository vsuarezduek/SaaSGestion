// Usuarios: alta y edición con límites de privilegios, último administrador, baja que cierra sesiones, PIN de mostrador con bloqueo y aislamiento.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cambiarOperador, crearComercio, ErrorDeUsuario, ingresar, operadoresDisponibles, sesionDesdeCookie, MAX_FALLOS_POR_EMAIL, type SesionActiva } from '../lib/auth.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { actividadDeUsuario, cambiarEstadoUsuario, cambiarMiContrasena, cambiarMiPin, guardarUsuario, listarUsuarios, obtenerUsuario } from '../lib/usuarios.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
const nuevo = (nombre: string, over: Record<string, unknown> = {}, S: SesionActiva = A) =>
  guardarUsuario(S, null, { nombre, email: '', rol: 'atencion', permisos: [], cajasVisibles: null, ...over });
const sesionDeUsuario = (id: string, rol: string, permisos: string[] = []): SesionActiva => ({ ...A, usuarioId: id, nombre: 'X', email: null, rol, permisos });

async function comercio(slug: string): Promise<SesionActiva> {
  const email = `${slug}@ejemplo.test`;
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}

before(async () => {
  A = await comercio(`usu-a-${sufijo}`);
  B = await comercio(`usu-b-${sufijo}`);
});
after(async () => {
  await cerrarPool();
});

test('alta y edición: mail único, contraseña y PIN hasheados, administrador con contraseña', async () => {
  const id = await nuevo('Ana', { email: 'ana@ejemplo.test', pin: '1234', contrasena: 'una-clave-larga' });
  const u = (await obtenerUsuario(A, id))!;
  assert.equal(u.rol, 'atencion');
  assert.equal(u.tienePin, true);
  assert.equal(u.tieneContrasena, true);
  const crudo = await conTenant(A.tenantId, (c) => c.query<{ pin_hash: string }>('SELECT pin_hash FROM usuarios WHERE id = $1', [id]));
  assert.ok(crudo.rows[0]!.pin_hash.startsWith('scrypt$'));
  await assert.rejects(nuevo('Otra Ana', { email: 'ana@ejemplo.test' }), ErrorDeUsuario);          // mail repetido
  await assert.rejects(nuevo('Sin clave', { rol: 'administrador', email: 'adm@ejemplo.test' }), ErrorDeUsuario);
  await assert.rejects(nuevo('Pin malo', { pin: '12' }), ErrorDeUsuario);
  await assert.rejects(nuevo('Clave sin mail', { contrasena: 'una-clave-larga' }), ErrorDeUsuario);
  await assert.rejects(nuevo('Caja ajena', { cajasVisibles: ['00000000-0000-4000-8000-000000000000'] }), ErrorDeUsuario);
  await guardarUsuario(A, id, { nombre: 'Ana María', email: 'ana@ejemplo.test', rol: 'encargada', permisos: ['informes'], cajasVisibles: null });
  const e = (await obtenerUsuario(A, id))!;
  assert.equal(e.nombre, 'Ana María');
  assert.deepEqual(e.permisos, ['informes']);
  assert.equal(e.tienePin, true);   // vacío = no cambiar
});

test('quien no es administrador no escala privilegios', async () => {
  const gestor = await nuevo('Gestora', { rol: 'encargada', permisos: ['permisos', 'informes'] });
  const G = sesionDeUsuario(gestor, 'encargada', ['permisos', 'informes']);
  await assert.rejects(nuevo('Jefe', { rol: 'administrador', contrasena: 'una-clave-larga', email: 'jefe@ejemplo.test' }, G), ErrorDeUsuario);
  await assert.rejects(nuevo('Con ajustes', { permisos: ['ajustes'] }, G), ErrorDeUsuario);          // no los tiene
  await nuevo('Con informes', { permisos: ['informes'] }, G);                                          // sí los tiene
  await assert.rejects(guardarUsuario(G, A.usuarioId, { nombre: 'Admin', email: A.email, rol: 'atencion', permisos: [], cajasVisibles: null }), ErrorDeUsuario);
  await assert.rejects(cambiarEstadoUsuario(G, A.usuarioId, false), ErrorDeUsuario);
  await assert.rejects(guardarUsuario(G, gestor, { nombre: 'Gestora', email: '', rol: 'encargada', permisos: ['permisos', 'informes', 'ajustes'], cajasVisibles: null }), ErrorDeUsuario); // ni a sí misma
  const sin = sesionDeUsuario(gestor, 'cocina', []);
  await assert.rejects(listarUsuarios(sin), ErrorDePermiso);
});

test('siempre queda un administrador activo y nadie se desactiva a sí mismo', async () => {
  await assert.rejects(cambiarEstadoUsuario(A, A.usuarioId, false), ErrorDeUsuario);
  const segundo = await nuevo('Segundo admin', { rol: 'administrador', email: 'seg@ejemplo.test', contrasena: 'otra-clave-larga' });
  await guardarUsuario(A, segundo, { nombre: 'Segundo admin', email: 'seg@ejemplo.test', rol: 'encargada', permisos: [], cajasVisibles: null });   // hay otro admin: se puede bajar
  await guardarUsuario(A, segundo, { nombre: 'Segundo admin', email: 'seg@ejemplo.test', rol: 'administrador', permisos: [], cajasVisibles: null });
  const S2 = sesionDeUsuario(segundo, 'administrador');
  await cambiarEstadoUsuario(S2, A.usuarioId, false);    // el segundo desactiva al primero…
  await assert.rejects(cambiarEstadoUsuario(S2, segundo, false), ErrorDeUsuario);
  await assert.rejects(guardarUsuario(A, segundo, { nombre: 'x', email: 'seg@ejemplo.test', rol: 'atencion', permisos: [], cajasVisibles: null }), ErrorDeUsuario); // A ya no está activo pero el guard cuenta a otros: el segundo es el último
  await cambiarEstadoUsuario(S2, A.usuarioId, true);
});

test('desactivar cierra las sesiones y el usuario deja de poder entrar', async () => {
  const id = await nuevo('Luis', { email: 'luis@ejemplo.test', contrasena: 'clave-de-luis-1' });
  const ing = await ingresar({ slug: A.comercio, email: 'luis@ejemplo.test', contrasena: 'clave-de-luis-1', ip: '1.1.1.1' });
  assert.equal(ing.ok, true);
  const cookie = ing.ok ? ing.cookie : '';
  assert.ok(await sesionDesdeCookie(cookie));
  await cambiarEstadoUsuario(A, id, false);
  assert.equal(await sesionDesdeCookie(cookie), null);
  assert.equal((await ingresar({ slug: A.comercio, email: 'luis@ejemplo.test', contrasena: 'clave-de-luis-1', ip: '1.1.1.1' })).ok, false);
  await cambiarEstadoUsuario(A, id, true);
  assert.equal((await ingresar({ slug: A.comercio, email: 'luis@ejemplo.test', contrasena: 'clave-de-luis-1', ip: '1.1.1.1' })).ok, true);
});

test('PIN de mostrador: cambia de operador, rechaza PIN malo y bloquea tras varios fallos', async () => {
  const id = await nuevo('Marta', { pin: '4321' });
  await nuevo('Sin PIN');
  const lista = await operadoresDisponibles(A);
  assert.ok(lista.some((o) => o.id === id));
  assert.ok(!lista.some((o) => o.nombre === 'Sin PIN'));
  assert.ok(!lista.some((o) => o.id === A.usuarioId));          // el administrador entra con contraseña
  const mal = await cambiarOperador(A, id, '0000', '2.2.2.2');
  assert.deepEqual(mal, { ok: false, motivo: 'credenciales' });
  const bien = await cambiarOperador(A, id, '4321', '2.2.2.2');
  assert.equal(bien.ok, true);
  const s = await sesionDesdeCookie(bien.ok ? bien.cookie : '');
  assert.equal(s?.usuarioId, id);
  assert.deepEqual(await cambiarOperador(A, A.usuarioId, '1234', '2.2.2.2'), { ok: false, motivo: 'credenciales' });   // un administrador no entra por PIN
  const otro = await nuevo('Pablo', { pin: '8765' });
  for (let i = 0; i < MAX_FALLOS_POR_EMAIL; i++) await cambiarOperador(A, otro, '1111', `3.3.3.${i}`);
  assert.deepEqual(await cambiarOperador(A, otro, '8765', '3.3.3.99'), { ok: false, motivo: 'bloqueado' });              // bloqueado aunque el PIN sea bueno
});

test('contraseña y PIN propios piden la clave actual', async () => {
  const id = await nuevo('Rosa', { email: 'rosa@ejemplo.test', contrasena: 'clave-de-rosa-1', pin: '1357' });
  const R = sesionDeUsuario(id, 'atencion');
  await assert.rejects(cambiarMiContrasena(R, 'incorrecta', 'nueva-clave-larga'), ErrorDeUsuario);
  await assert.rejects(cambiarMiContrasena(R, 'clave-de-rosa-1', 'corta'), ErrorDeUsuario);
  await cambiarMiContrasena(R, 'clave-de-rosa-1', 'nueva-clave-larga');
  assert.equal((await ingresar({ slug: A.comercio, email: 'rosa@ejemplo.test', contrasena: 'nueva-clave-larga', ip: '4.4.4.4' })).ok, true);
  await assert.rejects(cambiarMiPin(R, '0000', '2468'), ErrorDeUsuario);
  await cambiarMiPin(R, '1357', '2468');
  assert.equal((await cambiarOperador(A, id, '2468', '4.4.4.4')).ok, true);
  await assert.rejects(cambiarMiPin(A, 'mala', '1234'), ErrorDeUsuario);      // el administrador pone su contraseña
  await cambiarMiPin(A, 'clave-larga-123', '1234');
});

test('actividad por usuario y aislamiento entre comercios', async () => {
  const act = (await actividadDeUsuario(A, A.usuarioId))!;
  assert.equal(act.ventasHoy.operaciones, 0);
  assert.ok(act.ultimas.length > 0);
  assert.equal(await actividadDeUsuario(A, 'no-es-uuid'), null);
  const idA = (await listarUsuarios(A))[0]!.id;
  assert.equal(await obtenerUsuario(B, idA), null);
  assert.equal(await actividadDeUsuario(B, idA), null);
  await assert.rejects(guardarUsuario(B, idA, { nombre: 'Hackeado', email: '', rol: 'atencion', permisos: [], cajasVisibles: null }), ErrorDeUsuario);
  await assert.rejects(cambiarEstadoUsuario(B, idA, false), ErrorDeUsuario);
  assert.equal((await listarUsuarios(B)).length, 1);
});
