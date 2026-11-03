// Enlace de mail: destinatario válido, texto codificado y nada que rompa el enlace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enlaceDeMail } from '../lib/mail.ts';

test('arma un mailto con asunto y cuerpo codificados', () => {
  const e = enlaceDeMail({ para: 'ana@ejemplo.com', asunto: 'Venta N° 5 & más', cuerpo: 'Hola\nTotal: $ 1.000,00' });
  assert.ok(e.startsWith('mailto:ana@ejemplo.com?'));
  assert.ok(e.includes('subject=Venta%20N%C2%B0%205%20%26%20m%C3%A1s'));
  assert.ok(e.includes('body=Hola%0ATotal%3A%20%24%201.000%2C00'));
});

test('un destinatario que no parece mail se ignora y el cc es opcional', () => {
  assert.ok(enlaceDeMail({ para: 'no es un mail', asunto: 'a', cuerpo: 'b' }).startsWith('mailto:?'));
  assert.ok(enlaceDeMail({ para: 'a@b.com,otro@c.com', asunto: 'a', cuerpo: 'b' }).startsWith('mailto:?'));   // una sola persona por enlace
  assert.ok(enlaceDeMail({ para: null, asunto: 'a', cuerpo: 'b', cc: 'empresa@ejemplo.com' }).includes('cc=empresa%40ejemplo.com'));
  assert.ok(!enlaceDeMail({ asunto: 'a', cuerpo: 'b', cc: 'x' }).includes('cc='));
});
