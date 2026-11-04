// Correo del comercio: la conexión se guarda cifrada y aislada, se exige permiso y los envíos de venta y de compra quedan registrados.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { abrirCaja, guardarCaja } from '../lib/cajas.ts';
import { guardarProducto, listasDePrecios } from '../lib/catalogo.ts';
import { cerrarCompra } from '../lib/compras.ts';
import { desconectar, destinoSugerido, enviarComprobante, enviosRecientes, guardarConexion, obtenerConexion } from '../lib/correo.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarEmpresa } from '../lib/empresa.ts';
import { ErrorDePermiso } from '../lib/permisos.ts';
import { guardarCliente, guardarProveedor } from '../lib/personas.ts';
import { cerrarVenta, guardarMedioDePago } from '../lib/ventas.ts';

process.env.CORREO_CLAVE = randomBytes(32).toString('base64');
process.env.GOOGLE_CLIENT_ID = 'gid';
process.env.GOOGLE_CLIENT_SECRET = 'gsec';
process.env.CORREO_URL_BASE = 'https://app.ejemplo.test';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;
let ventaId = '', compraId = '';

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
interface Llamada { url: string; cuerpo: string }
function servidorFalso(llamadas: Llamada[], envio = 200): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, cuerpo: String(init?.body ?? '') });
    if (url.includes('oauth2.googleapis.com/token')) return respuesta({ access_token: 'ACCESO' });
    if (url.includes('oauth2.googleapis.com/revoke')) return respuesta({});
    return respuesta({}, envio);
  }) as unknown as typeof fetch;
}

before(async () => {
  A = await sesionDe(`cor-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`cor-b-${sufijo}`, 'b@ejemplo.test');
  const lista = (await listasDePrecios(A))[0]!.id;
  const caja = await guardarCaja(A, null, { nombre: 'Efectivo', tipo: 'efectivo', impuestoTransaccion: 0 });
  await abrirCaja(A, caja, { contado: '100000' });
  const medio = await guardarMedioDePago(A, null, { nombre: 'Efectivo', comisionPct: 0, ivaComision: 21, cajaIds: [caja] });
  const cliente = await guardarCliente(A, null, { nombre: 'Laura', telefono: '', email: 'laura@cliente.test', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: null });
  const prov = await guardarProveedor(A, null, { nombre: 'Distribuidora', contacto: '', categoria: '', telefono: '', email: 'ventas@dist.test', domicilio: '', localidad: '', cuit: '', condicionIva: null });
  const cafe = await guardarProducto(A, null, { codigo: '', nombre: 'Café', rubroId: null, tipo: '', unidad: 'unidad', costo: '100', iva: 21, vendible: true, comprable: true, integrable: false, publicadoWeb: false, urlWeb: '', precios: { [lista]: '1000' }, stockMinimo: '', stockIdeal: '' });
  const v = await cerrarVenta(A, { clave: randomUUID(), clienteId: cliente, comprobante: 'remito', nroComprobante: '', listaId: lista, fecha: '', descuentoTotalPct: 0, nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '2', precio: '1000', descuentoPct: 0, iva: 21 }], cobro: { tipo: 'caja', medioPagoId: medio, cajaId: caja } });
  ventaId = (v as { id: string }).id;
  const c = await cerrarCompra(A, { clave: randomUUID(), proveedorId: prov, categoria: 'Mercadería', comprobante: 'remito', nroComprobante: '', fecha: '', descuentoTotalPct: 0, modoCostos: 'ninguno', nota: '',
    renglones: [{ productoId: cafe, descripcion: '', cantidad: '10', costo: '100', descuentoPct: 0, iva: 21 }], pago: { tipo: 'caja', cajaId: caja } });
  compraId = (c as { id: string }).id;
  await guardarEmpresa(A, { nombre: 'Comercio A', razonSocial: '', cuit: '', condicionIva: '', domicilio: '', localidad: '', telefono: '', email: 'info@comercio-a.test', web: '', color: '#1c9764' });
});
after(async () => { await cerrarPool(); });

test('sin casilla conectada no se puede enviar', async () => {
  assert.equal(await obtenerConexion(A), null);
  await assert.rejects(() => enviarComprobante(A, { tipo: 'venta', id: ventaId, para: 'laura@cliente.test' }, servidorFalso([])), ErrorDeUsuario);
});

test('la conexión se guarda cifrada, aislada por comercio y solo con permiso de ajustes', async () => {
  await assert.rejects(() => guardarConexion({ ...A, rol: 'atencion' }, 'google', 'yo@gmail.com', 'REFRESCO-SECRETO'), ErrorDePermiso);
  await guardarConexion(A, 'google', 'yo@gmail.com', 'REFRESCO-SECRETO');
  const c = await obtenerConexion(A);
  assert.equal(c?.cuenta, 'yo@gmail.com');
  assert.equal(c?.proveedor, 'google');
  const crudo = await conTenant(A.tenantId, (cl) => cl.query<{ token_cifrado: string }>('SELECT token_cifrado FROM correo_conexion'));
  assert.ok(!crudo.rows[0]!.token_cifrado.includes('REFRESCO-SECRETO'));
  assert.equal(await obtenerConexion(B), null);
  assert.equal((await conTenant(B.tenantId, (cl) => cl.query('SELECT 1 FROM correo_conexion'))).rowCount, 0);
});

test('un token copiado a otro comercio no sirve', async () => {
  await conTenant(B.tenantId, async (cl) => {
    const robado = await conTenant(A.tenantId, (ca) => ca.query<{ token_cifrado: string }>('SELECT token_cifrado FROM correo_conexion'));
    await cl.query("INSERT INTO correo_conexion (tenant_id, proveedor, cuenta, token_cifrado) VALUES (app.tenant_id(), 'google', 'otro@gmail.com', $1)", [robado.rows[0]!.token_cifrado]);
  });
  await assert.rejects(() => enviarComprobante(B, { tipo: 'venta', id: ventaId, para: 'x@y.com' }, servidorFalso([])));
  await conTenant(B.tenantId, (cl) => cl.query('DELETE FROM correo_conexion'));
});

test('envía una venta y una compra desde la casilla conectada y lo registra', async () => {
  assert.equal(await destinoSugerido(A, 'venta', ventaId), 'laura@cliente.test');
  assert.equal(await destinoSugerido(A, 'compra', compraId), 'ventas@dist.test');
  const llamadas: Llamada[] = [];
  const f = servidorFalso(llamadas);
  await enviarComprobante(A, { tipo: 'venta', id: ventaId, para: ' Laura@Cliente.test ' }, f);
  await enviarComprobante(A, { tipo: 'compra', id: compraId, para: 'ventas@dist.test' }, f);
  const envios = llamadas.filter((l) => l.url.includes('gmail.googleapis.com'));
  assert.equal(envios.length, 2);
  const crudo = Buffer.from((JSON.parse(envios[0]!.cuerpo) as { raw: string }).raw, 'base64url').toString('utf8');
  assert.match(crudo, /From: .*<yo@gmail\.com>/);
  assert.match(crudo, /To: laura@cliente\.test/);
  assert.match(crudo, /Reply-To: info@comercio-a\.test/);
  const registro = await enviosRecientes(A);
  assert.deepEqual(registro.map((r) => [r.tipo, r.resultado]).sort(), [['compra', 'enviado'], ['venta', 'enviado']]);
});

test('destinatario inválido, permiso por sección y comprobante de otro comercio', async () => {
  const f = servidorFalso([]);
  await assert.rejects(() => enviarComprobante(A, { tipo: 'venta', id: ventaId, para: 'no-es-mail' }, f), ErrorDeUsuario);
  await assert.rejects(() => enviarComprobante(A, { tipo: 'venta', id: ventaId, para: 'x@y.com\r\nBcc: z@w.com' }, f), ErrorDeUsuario);
  await guardarConexion(B, 'google', 'b@gmail.com', 'OTRO');
  await assert.rejects(() => enviarComprobante(B, { tipo: 'venta', id: ventaId, para: 'x@y.com' }, f), ErrorDeUsuario, 'la venta de A no existe para B');
});

test('si el proveedor falla, el error queda registrado y se avisa', async () => {
  const llamadas: Llamada[] = [];
  await assert.rejects(() => enviarComprobante(A, { tipo: 'venta', id: ventaId, para: 'laura@cliente.test' }, servidorFalso(llamadas, 500)), ErrorDeUsuario);
  const r = (await enviosRecientes(A))[0]!;
  assert.equal(r.resultado, 'error');
  assert.ok(r.detalle);
});

test('el registro de envíos solo se agrega', async () => {
  await assert.rejects(() => conTenant(A.tenantId, (c) => c.query("UPDATE correo_envios SET resultado = 'enviado'")));
  await assert.rejects(() => conTenant(A.tenantId, (c) => c.query('DELETE FROM correo_envios')));
});

test('desconectar borra la conexión y revoca el permiso', async () => {
  const llamadas: Llamada[] = [];
  await desconectar(A, servidorFalso(llamadas));
  assert.equal(await obtenerConexion(A), null);
  assert.ok(llamadas.some((l) => l.url.includes('/revoke')));
  await assert.rejects(() => desconectar({ ...A, rol: 'atencion' }), ErrorDePermiso);
});
