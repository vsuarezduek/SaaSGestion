// Correo por OAuth, partes sin base de datos: cifrado atado al comercio, estado firmado, armado del mensaje y llamadas a Google/Microsoft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cifrar, descifrar, firmar, verificar } from '../lib/correoCifrado.ts';
import { canjearCodigo, configDe, enviarMensaje, ErrorDeCorreo, mailDelIdToken, proveedoresDisponibles, tokenDeAcceso, urlDeAutorizacion, urlDeRetorno } from '../lib/correoOauth.ts';
import { cuerpoDeComprobante, esc } from '../lib/comprobanteMail.ts';
import { armarMime, esMailValido } from '../lib/mime.ts';

const clave = randomBytes(32);
const ENV = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msec', CORREO_URL_BASE: 'https://app.ejemplo.test/' } as unknown as NodeJS.ProcessEnv;
const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const idToken = (c: object) => `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.y`;

test('cifrado: ida y vuelta, no deja el texto a la vista y está atado al comercio', () => {
  const t = cifrar('refresh-secreto', 'comercio-1', clave);
  assert.ok(!t.includes('refresh-secreto'));
  assert.equal(descifrar(t, 'comercio-1', clave), 'refresh-secreto');
  assert.notEqual(cifrar('refresh-secreto', 'comercio-1', clave), t, 'cada cifrado usa su propio IV');
  assert.throws(() => descifrar(t, 'comercio-2', clave), 'otro comercio no puede abrirlo');
  assert.throws(() => descifrar(t, 'comercio-1', randomBytes(32)), 'otra clave no puede abrirlo');
  const partes = t.split('.');
  partes[3] = Buffer.from('adulterado').toString('base64url');
  assert.throws(() => descifrar(partes.join('.'), 'comercio-1', clave), 'un token alterado se rechaza');
  assert.throws(() => descifrar('basura', 'comercio-1', clave));
});

test('estado firmado: se acepta el propio y se rechaza el alterado', () => {
  const e = firmar({ t: 'a', n: 'x', e: 1 }, clave);
  assert.deepEqual(verificar(e, clave), { t: 'a', n: 'x', e: 1 });
  const [cuerpo, sello] = e.split('.');
  const otro = Buffer.from(JSON.stringify({ t: 'b', n: 'x', e: 1 })).toString('base64url');
  assert.equal(verificar(`${otro}.${sello}`, clave), null);
  assert.equal(verificar(`${cuerpo}.${sello}x`, clave), null);
  assert.equal(verificar(e, randomBytes(32)), null);
  assert.equal(verificar('sin-punto', clave), null);
});

test('mime: direcciones válidas, sin inyección de encabezados y con UTF-8', () => {
  assert.ok(esMailValido('ana@ejemplo.com'));
  for (const malo of ['ana@ejemplo', 'ana@ejemplo.com\r\nBcc: x@y.com', 'a b@c.com', 'x@y.com,z@w.com', '']) assert.equal(esMailValido(malo), false, malo);
  const base = { de: 'yo@ejemplo.com', nombreDe: 'Mística Natural', para: 'ana@ejemplo.com', asunto: 'Venta N° 5 - Mística', texto: 'hola ñandú', html: '<b>hola</b>' };
  const m = armarMime(base, 'LIMITE');
  assert.match(m, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <yo@ejemplo\.com>/);
  assert.match(m, /\r\nTo: ana@ejemplo\.com\r\n/);
  assert.match(m, /Subject: =\?UTF-8\?B\?/);
  assert.match(m, /--LIMITE--\r\n$/);
  assert.ok(m.includes(Buffer.from('hola ñandú').toString('base64')));
  assert.throws(() => armarMime({ ...base, para: 'ana@ejemplo.com\r\nBcc: robo@x.com' }));
  assert.throws(() => armarMime({ ...base, responderA: 'no-es-mail' }));
  assert.ok(!armarMime({ ...base, asunto: 'uno\r\nBcc: robo@x.com' }, 'L').includes('\r\nBcc:'), 'el asunto no puede abrir otro encabezado');
});

test('oauth: configuración, direcciones y mail de la cuenta', () => {
  assert.deepEqual(proveedoresDisponibles(ENV), ['google', 'microsoft']);
  assert.deepEqual(proveedoresDisponibles({ GOOGLE_CLIENT_ID: 'solo-id' } as unknown as NodeJS.ProcessEnv), []);
  assert.equal(configDe('google', {} as NodeJS.ProcessEnv), null);
  assert.equal(urlDeRetorno('google', ENV), 'https://app.ejemplo.test/api/correo/retorno/google');
  assert.throws(() => urlDeRetorno('google', {} as NodeJS.ProcessEnv));
  const g = new URL(urlDeAutorizacion('google', 'EST', ENV));
  assert.equal(g.host, 'accounts.google.com');
  assert.equal(g.searchParams.get('state'), 'EST');
  assert.equal(g.searchParams.get('access_type'), 'offline');
  assert.match(g.searchParams.get('scope')!, /gmail\.send/);
  assert.ok(!g.searchParams.get('scope')!.includes('readonly'), 'solo permiso de enviar');
  const m = new URL(urlDeAutorizacion('microsoft', 'EST', ENV));
  assert.match(m.searchParams.get('scope')!, /Mail\.Send/);
  assert.match(m.searchParams.get('scope')!, /offline_access/);
  assert.equal(mailDelIdToken(idToken({ email: 'Ana@Ejemplo.com' })), 'ana@ejemplo.com');
  assert.equal(mailDelIdToken(idToken({ preferred_username: 'b@outlook.com' })), 'b@outlook.com');
  assert.equal(mailDelIdToken('roto'), null);
});

test('oauth: canje de código y renovación del acceso', async () => {
  let pedido: URLSearchParams | undefined;
  const f = (async (_u: unknown, init?: RequestInit) => { pedido = init!.body as URLSearchParams; return respuesta({ refresh_token: 'R1', id_token: idToken({ email: 'ana@ejemplo.com' }), access_token: 'A1' }); }) as typeof fetch;
  assert.deepEqual(await canjearCodigo('google', 'COD', f, ENV), { refresco: 'R1', cuenta: 'ana@ejemplo.com' });
  assert.equal(pedido!.get('code'), 'COD');
  assert.equal(pedido!.get('client_secret'), 'gsec');
  const sinRefresco = (async () => respuesta({ id_token: idToken({ email: 'a@b.com' }) })) as typeof fetch;
  await assert.rejects(() => canjearCodigo('google', 'COD', sinRefresco, ENV), ErrorDeCorreo);
  const acceso = (async () => respuesta({ access_token: 'A2' })) as typeof fetch;
  assert.equal(await tokenDeAcceso('microsoft', 'R1', acceso, ENV), 'A2');
  const vencido = (async () => respuesta({ error: 'invalid_grant' }, 400)) as typeof fetch;
  await assert.rejects(() => tokenDeAcceso('google', 'R1', vencido, ENV), (e: unknown) => e instanceof ErrorDeCorreo && e.reconectar);
});

test('envío: Gmail recibe el mensaje en base64url y Outlook en JSON', async () => {
  const msg = { de: 'yo@ejemplo.com', nombreDe: 'Comercio', para: 'ana@ejemplo.com', responderA: 'info@ejemplo.com', asunto: 'Venta N° 1', texto: 'hola', html: '<p>hola</p>' };
  const vistos: { url: string; auth: string | null; cuerpo: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => { vistos.push({ url, auth: new Headers(init.headers).get('authorization'), cuerpo: JSON.parse(init.body as string) }); return respuesta({}); }) as unknown as typeof fetch;
  await enviarMensaje('google', 'TOK', msg, f);
  assert.equal(vistos[0]!.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(vistos[0]!.auth, 'Bearer TOK');
  const crudo = Buffer.from(vistos[0]!.cuerpo.raw as string, 'base64url').toString('utf8');
  assert.match(crudo, /To: ana@ejemplo\.com/);
  assert.match(crudo, /Reply-To: info@ejemplo\.com/);
  await enviarMensaje('microsoft', 'TOK2', msg, f);
  assert.equal(vistos[1]!.url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  const mensaje = vistos[1]!.cuerpo.message as { toRecipients: { emailAddress: { address: string } }[]; body: { contentType: string } };
  assert.equal(mensaje.toRecipients[0]!.emailAddress.address, 'ana@ejemplo.com');
  assert.equal(mensaje.body.contentType, 'HTML');
  const rechazo = (async () => respuesta({}, 401)) as typeof fetch;
  await assert.rejects(() => enviarMensaje('google', 'T', msg, rechazo), (e: unknown) => e instanceof ErrorDeCorreo && e.reconectar);
  const caido = (async () => respuesta({}, 500)) as typeof fetch;
  await assert.rejects(() => enviarMensaje('microsoft', 'T', msg, caido), (e: unknown) => e instanceof ErrorDeCorreo && !e.reconectar);
  await assert.rejects(() => enviarMensaje('google', 'T', { ...msg, para: 'x@y.com\r\nBcc: z@w.com' }, f));
});

test('cuerpo del comprobante: escapa lo que viene de la base', () => {
  assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  const { html, texto } = cuerpoDeComprobante({
    titulo: 'Venta N° 3', subtitulo: 'Remito', contraparte: { etiqueta: 'Cliente', nombre: '<script>alert(1)</script>' },
    renglones: [{ descripcion: 'Té <b>', cantidad: '2', importe: '$ 2.000,00' }], totales: [{ etiqueta: 'Total', valor: '$ 2.000,00' }], nota: null, saludo: 'Hola', cierre: 'Gracias',
  }, { nombre: 'Mística', color: 'javascript:alert(1)', telefono: null, email: 'a@b.com', web: null, domicilio: null });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'), 'un color inválido vuelve al color por defecto');
  assert.ok(html.includes('Té &lt;b&gt;'));
  assert.match(texto, /Total \$ 2\.000,00/);
});

test('PDF del comprobante (D-041): es un PDF, con varias páginas si hace falta, y tolera caracteres fuera de WinAnsi', async () => {
  const { pdfDeComprobante, aWinAnsi } = await import('../lib/comprobantePdf.ts');
  assert.equal(aWinAnsi('−$ 1.234,50 «Año» → ok'), '-$ 1.234,50 «Año» ? ok');
  const base = { titulo: 'Venta N° 7', subtitulo: 'Factura B · 24/11/2026', contraparte: { etiqueta: 'Cliente', nombre: 'Laura Pérez' }, totales: [{ etiqueta: 'IVA 21%:', valor: '$ 21,00' }, { etiqueta: 'Total', valor: '$ 121,00' }], nota: 'Entregar → mañana', saludo: 'Hola', cierre: 'Gracias' };
  const e = { nombre: 'Comercio Ñandú', color: '#1c9764', telefono: '123', email: 'a@b.test', web: null, domicilio: 'Calle 1' };
  const corto = await pdfDeComprobante({ ...base, renglones: [{ descripcion: 'Té de manzanilla 🌼', cantidad: '1', importe: '$ 121,00' }] }, e);
  assert.equal(Buffer.from(corto.subarray(0, 5)).toString('latin1'), '%PDF-');
  const largo = await pdfDeComprobante({ ...base, renglones: Array.from({ length: 120 }, (_, i) => ({ descripcion: `Producto ${i}`, cantidad: '1', importe: '$ 1,00' })) }, e);
  const { PDFDocument } = await import('pdf-lib');
  assert.equal((await PDFDocument.load(corto)).getPageCount(), 1);
  assert.ok((await PDFDocument.load(largo)).getPageCount() >= 3);
});

test('MIME con adjunto: multipart/mixed, nombre de archivo sin caracteres peligrosos y tipo validado', () => {
  const m = { de: 'yo@gmail.com', para: 'a@b.test', asunto: 'Venta', texto: 't', html: '<b>h</b>', adjuntos: [{ nombre: 'Venta N° 1 "x"\r\nBcc: z@z.test.pdf', tipo: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }] };
  const crudo = armarMime(m, 'LIM');
  assert.match(crudo, /Content-Type: multipart\/mixed; boundary="LIM_mx"/);
  assert.match(crudo, /filename="Venta_N_1_x_Bcc_z_z\.test\.pdf"/);
  assert.doesNotMatch(crudo, /^Bcc:/m);
  assert.match(crudo, /JVBERg==/);
  assert.throws(() => armarMime({ ...m, adjuntos: [{ ...m.adjuntos[0]!, tipo: 'text/html\r\nX: y' }] }));
});
