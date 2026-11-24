// PDF del comprobante para adjuntar al mail (D-041). Se arma con pdf-lib (JavaScript puro, sin binarios), con las
// fuentes estándar del PDF: el texto se pasa a WinAnsi (español completo) y lo que no entra se reemplaza.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import type { ComprobanteParaMail } from './comprobanteMail.ts';
import type { Empresa } from './empresa.ts';

const EXTRAS_WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Deja solo caracteres que las fuentes estándar pueden dibujar (Latin-1 y los extras de WinAnsi). */
export function aWinAnsi(t: string): string {
  return t
    .replace(/[−‐‑]/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[   ]/g, ' ')
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRAS_WINANSI.includes(ch) ? ch : '?';
    })
    .join('');
}

function colorDe(hex: string) {
  const ok = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#1c9764';
  return rgb(parseInt(ok.slice(1, 3), 16) / 255, parseInt(ok.slice(3, 5), 16) / 255, parseInt(ok.slice(5, 7), 16) / 255);
}

/** Corta un texto para que entre en el ancho dado (con «…»). */
function recortar(t: string, f: PDFFont, tam: number, ancho: number): string {
  if (f.widthOfTextAtSize(t, tam) <= ancho) return t;
  let s = t;
  while (s.length > 1 && f.widthOfTextAtSize(s + '…', tam) > ancho) s = s.slice(0, -1);
  return s + '…';
}

type DatosEmpresa = Pick<Empresa, 'nombre' | 'color' | 'telefono' | 'email' | 'web' | 'domicilio'> & Partial<Pick<Empresa, 'razonSocial' | 'cuit'>>;

export async function pdfDeComprobante(c: ComprobanteParaMail, e: DatosEmpresa, logo?: { tipo: string; bytes: Uint8Array } | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(aWinAnsi(`${c.titulo} - ${e.nombre}`));
  doc.setProducer('SaaS Gestión');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const M = 40, ANCHO = A4[0] - 2 * M;
  const gris = rgb(0.33, 0.33, 0.33), linea = rgb(0.85, 0.85, 0.85), color = colorDe(e.color);
  let pag = doc.addPage(A4);
  let y = A4[1] - M;
  const texto = (t: string, x: number, yy: number, o: { f?: PDFFont; tam?: number; c?: ReturnType<typeof rgb>; der?: boolean; max?: number } = {}) => {
    const f = o.f ?? normal, tam = o.tam ?? 10;
    let s = aWinAnsi(t);
    if (o.max) s = recortar(s, f, tam, o.max);
    const w = f.widthOfTextAtSize(s, tam);
    pag.drawText(s, { x: o.der ? x - w : x, y: yy, size: tam, font: f, color: o.c ?? rgb(0.13, 0.13, 0.13) });
  };

  // Encabezado: logo (si hay) y datos del comercio; a la derecha, el comprobante.
  let img: PDFImage | null = null;
  try {
    if (logo) img = logo.tipo === 'image/png' ? await doc.embedPng(logo.bytes) : await doc.embedJpg(logo.bytes);
  } catch { img = null; }
  let xTexto = M;
  if (img) {
    const h = 48, w = Math.min(140, (img.width / img.height) * h);
    pag.drawImage(img, { x: M, y: y - h + 10, width: w, height: (w / img.width) * img.height });
    xTexto = M + w + 12;
  }
  texto(e.nombre, xTexto, y, { f: negrita, tam: 16, c: color, max: 300 });
  const datos = [e.razonSocial, e.cuit ? `CUIT ${e.cuit}` : null, e.domicilio, [e.telefono, e.email].filter(Boolean).join(' · '), e.web].filter(Boolean) as string[];
  datos.forEach((d, i) => texto(d, xTexto, y - 14 - i * 11, { tam: 8.5, c: gris, max: 300 }));
  texto(c.titulo, A4[0] - M, y, { f: negrita, tam: 14, der: true });
  texto(c.subtitulo, A4[0] - M, y - 15, { tam: 9, c: gris, der: true, max: 230 });
  y -= Math.max(60, 20 + datos.length * 11);
  pag.drawRectangle({ x: M, y, width: ANCHO, height: 2, color });
  y -= 18;
  texto(`${c.contraparte.etiqueta}: `, M, y, { f: negrita });
  texto(c.contraparte.nombre, M + negrita.widthOfTextAtSize(aWinAnsi(`${c.contraparte.etiqueta}: `), 10), y, { max: ANCHO - 80 });
  y -= 22;

  // Renglones.
  const xCant = M + ANCHO - 110, xImp = M + ANCHO;
  const encabezado = () => {
    texto('Detalle', M, y, { f: negrita, tam: 9 });
    texto('Cant.', xCant, y, { f: negrita, tam: 9, der: true });
    texto('Importe', xImp, y, { f: negrita, tam: 9, der: true });
    y -= 6;
    pag.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.8, color: linea });
    y -= 13;
  };
  encabezado();
  for (const r of c.renglones) {
    if (y < M + 90) { pag = doc.addPage(A4); y = A4[1] - M; encabezado(); }
    texto(r.descripcion, M, y, { max: ANCHO - 190 });
    texto(r.cantidad, xCant, y, { der: true });
    texto(r.importe, xImp, y, { der: true });
    y -= 6;
    pag.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.5, color: linea });
    y -= 13;
  }
  // Totales (el último, más grande).
  y -= 4;
  c.totales.forEach((t, i) => {
    const ultimo = i === c.totales.length - 1;
    if (y < M + 30) { pag = doc.addPage(A4); y = A4[1] - M; }
    if (ultimo && i > 0) y -= 6;
    texto(`${t.etiqueta} ${t.valor}`, xImp, y, { f: ultimo ? negrita : normal, tam: ultimo ? 13 : 10, der: true });
    y -= ultimo ? 20 : 14;
  });
  if (c.nota) { texto(`Nota: ${c.nota}`, M, y, { tam: 9, c: gris, max: ANCHO }); y -= 16; }
  texto(c.cierre, M, Math.max(y - 6, M), { tam: 10 });
  return doc.save();
}
