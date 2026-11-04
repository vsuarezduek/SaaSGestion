// Cuerpo (HTML y texto) del mail con el comprobante. Todo dato que viene de la base se escapa; solo estilos en línea (los clientes de mail no cargan CSS ni imágenes).
import type { Empresa } from './empresa.ts';

export const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ComprobanteParaMail {
  titulo: string; subtitulo: string; contraparte: { etiqueta: string; nombre: string };
  renglones: { descripcion: string; cantidad: string; importe: string }[];
  totales: { etiqueta: string; valor: string }[]; nota?: string | null; saludo: string; cierre: string;
}

export function cuerpoDeComprobante(c: ComprobanteParaMail, e: Pick<Empresa, 'nombre' | 'color' | 'telefono' | 'email' | 'web' | 'domicilio'>): { texto: string; html: string } {
  const color = /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : '#1c9764';
  const td = 'padding:6px 8px;border-bottom:1px solid #dddddd;font-size:14px;';
  const filas = c.renglones.map((r) => `<tr><td style="${td}">${esc(r.descripcion)}</td><td style="${td}text-align:right;">${esc(r.cantidad)}</td><td style="${td}text-align:right;">${esc(r.importe)}</td></tr>`).join('');
  const totales = c.totales.map((t, i) => `<div style="text-align:right;${i === c.totales.length - 1 ? 'font-size:18px;font-weight:bold;margin-top:6px;' : 'font-size:14px;'}">${esc(t.etiqueta)} ${esc(t.valor)}</div>`).join('');
  const contacto = [e.domicilio, e.telefono, e.email, e.web].filter(Boolean).map((x) => esc(x!)).join(' · ');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;max-width:640px;margin:0 auto;">
<div style="background:${color};color:#ffffff;padding:14px 18px;font-size:20px;font-weight:bold;">${esc(e.nombre)}</div>
<p style="font-size:14px;">${esc(c.saludo)}</p>
<h2 style="font-size:17px;margin:12px 0 2px;">${esc(c.titulo)}</h2>
<div style="font-size:13px;color:#555555;margin-bottom:8px;">${esc(c.subtitulo)} · <b>${esc(c.contraparte.etiqueta)}:</b> ${esc(c.contraparte.nombre)}</div>
<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="${td}text-align:left;">Detalle</th><th style="${td}text-align:right;">Cant.</th><th style="${td}text-align:right;">Importe</th></tr></thead><tbody>${filas}</tbody></table>
<div style="margin-top:10px;">${totales}</div>
${c.nota ? `<p style="font-size:13px;"><b>Nota:</b> ${esc(c.nota)}</p>` : ''}
<p style="font-size:14px;margin-top:16px;">${esc(c.cierre)}</p>
<div style="font-size:12px;color:#777777;">${contacto}</div></div>`;
  const texto = [
    c.saludo, '', `${c.titulo} — ${c.subtitulo}`, `${c.contraparte.etiqueta}: ${c.contraparte.nombre}`, '',
    ...c.renglones.map((r) => `- ${r.cantidad} x ${r.descripcion}: ${r.importe}`), '',
    ...c.totales.map((t) => `${t.etiqueta} ${t.valor}`), ...(c.nota ? ['', `Nota: ${c.nota}`] : []), '', c.cierre, e.nombre,
  ].join('\n');
  return { texto, html };
}
