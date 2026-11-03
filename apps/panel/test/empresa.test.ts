// Empresa y marca: datos, logo verificado por su contenido, permisos y aislamiento entre comercios.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarEmpresa, guardarLogo, MAX_LOGO_BYTES, obtenerEmpresa, obtenerLogo, quitarLogo, tipoDeImagen } from '../lib/empresa.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const datos = (over: Record<string, unknown> = {}) => ({ nombre: 'Mi comercio', razonSocial: 'Mi comercio SRL', cuit: '30-12345678-9', condicionIva: 'Responsable inscripto', domicilio: 'Calle 1', localidad: 'Mendoza', telefono: '261', email: 'hola@ejemplo.test', web: '', color: '#AA3300', ...over });

async function comercio(slug: string): Promise<SesionActiva> {
  const email = `${slug}@ejemplo.test`;
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
before(async () => {
  A = await comercio(`emp-a-${sufijo}`);
  B = await comercio(`emp-b-${sufijo}`);
});
after(async () => {
  await cerrarPool();
});

test('el tipo de imagen sale del contenido, no del nombre', () => {
  assert.equal(tipoDeImagen(PNG), 'image/png');
  assert.equal(tipoDeImagen(JPG), 'image/jpeg');
  assert.equal(tipoDeImagen(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(tipoDeImagen(new Uint8Array(0)), null);
});

test('datos de la empresa: se guardan, normalizan y validan', async () => {
  const antes = await obtenerEmpresa(A);
  assert.equal(antes.color, '#1c9764');
  assert.equal(antes.tieneLogo, false);
  await guardarEmpresa(A, datos());
  const e = await obtenerEmpresa(A);
  assert.equal(e.nombre, 'Mi comercio');
  assert.equal(e.cuit, '30123456789');
  assert.equal(e.color, '#aa3300');
  assert.equal(e.web, null);
  await assert.rejects(guardarEmpresa(A, datos({ cuit: '123' })), ErrorDeUsuario);
  await assert.rejects(guardarEmpresa(A, datos({ color: 'rojo' })), ErrorDeUsuario);
  await assert.rejects(guardarEmpresa(A, datos({ nombre: '  ' })), ErrorDeUsuario);
});

test('logo: solo PNG o JPG chicos, se puede quitar', async () => {
  await assert.rejects(guardarLogo(A, new TextEncoder().encode('<svg/>')), ErrorDeUsuario);
  await assert.rejects(guardarLogo(A, new Uint8Array(0)), ErrorDeUsuario);
  await assert.rejects(guardarLogo(A, new Uint8Array([...PNG, ...new Uint8Array(MAX_LOGO_BYTES)])), ErrorDeUsuario);
  await guardarLogo(A, PNG);
  assert.equal((await obtenerLogo(A))?.tipo, 'image/png');
  assert.equal((await obtenerEmpresa(A)).tieneLogo, true);
  await guardarLogo(A, JPG);
  assert.equal((await obtenerLogo(A))?.tipo, 'image/jpeg');
  await quitarLogo(A);
  assert.equal(await obtenerLogo(A), null);
  assert.equal((await obtenerEmpresa(A)).nombre, 'Mi comercio');    // quitar el logo no toca los datos
});

test('permisos y aislamiento', async () => {
  const cocina: SesionActiva = { ...A, rol: 'cocina', permisos: [] };
  await assert.rejects(guardarEmpresa(cocina, datos()), ErrorDePermiso);
  await assert.rejects(guardarLogo(cocina, PNG), ErrorDePermiso);
  assert.equal((await obtenerEmpresa(cocina)).nombre, 'Mi comercio');   // verla no requiere permiso
  await guardarLogo(A, PNG);
  assert.equal(await obtenerLogo(B), null);
  assert.equal((await obtenerEmpresa(B)).nombre, B.comercio);
});
