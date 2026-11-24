// Armado del mensaje de mail (MIME) a mano, sin dependencias. Protege contra inyección de encabezados (saltos de línea en destinatario o asunto).

const MAIL = /^[^@\s,;<>"\r\n]+@[^@\s,;<>"\r\n]+\.[^@\s,;<>"\r\n]+$/;

export function esMailValido(s: string): boolean {
  return s.length <= 200 && MAIL.test(s);
}

/** Texto de encabezado en UTF-8 (RFC 2047); sin saltos de línea. */
export function encabezadoUtf8(t: string): string {
  const limpio = t.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(limpio) ? limpio : `=?UTF-8?B?${Buffer.from(limpio, 'utf8').toString('base64')}?=`;
}

function bloquesBase64(t: string): string {
  return (Buffer.from(t, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

export interface Adjunto { nombre: string; tipo: string; bytes: Uint8Array }
export interface MensajeDeMail { de: string; nombreDe?: string; para: string; responderA?: string | null; asunto: string; texto: string; html: string; adjuntos?: Adjunto[] }

/** Nombre de archivo seguro para un encabezado (sin comillas, barras ni saltos de línea). */
export function nombreDeArchivo(n: string): string {
  const limpio = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 80);
  return limpio || 'adjunto';
}

function base64Bytes(b: Uint8Array): string {
  return (Buffer.from(b).toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

export function armarMime(m: MensajeDeMail, limite = `=_sg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`): string {
  for (const d of [m.de, m.para, ...(m.responderA ? [m.responderA] : [])]) if (!esMailValido(d)) throw new Error('Dirección de mail inválida');
  const adjuntos = m.adjuntos ?? [];
  for (const a of adjuntos) if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(a.tipo)) throw new Error('Tipo de adjunto inválido');
  const mixto = `${limite}_mx`;
  const nombre = m.nombreDe ? `${encabezadoUtf8(m.nombreDe.replace(/["<>]/g, ''))} ` : '';
  const de = m.nombreDe ? `${/^[\x20-\x7e]*$/.test(m.nombreDe) ? `"${m.nombreDe.replace(/["<>\\\r\n]/g, '')}"` : nombre.trim()} <${m.de}>` : m.de;
  return [
    `From: ${de}`,
    `To: ${m.para}`,
    ...(m.responderA ? [`Reply-To: ${m.responderA}`] : []),
    `Subject: ${encabezadoUtf8(m.asunto)}`,
    'MIME-Version: 1.0',
    ...(adjuntos.length ? [`Content-Type: multipart/mixed; boundary="${mixto}"`, '', `--${mixto}`] : []),
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    bloquesBase64(m.texto),
    `--${limite}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    bloquesBase64(m.html),
    `--${limite}--`,
    ...adjuntos.flatMap((a) => [
      `--${mixto}`,
      `Content-Type: ${a.tipo}; name="${nombreDeArchivo(a.nombre)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${nombreDeArchivo(a.nombre)}"`,
      '',
      base64Bytes(a.bytes),
    ]),
    ...(adjuntos.length ? [`--${mixto}--`] : []),
    '',
  ].join('\r\n');
}
