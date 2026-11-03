// Envío por mail sin servicio de correo: se abre el programa de mail de la persona con el mensaje ya escrito.
// El PDF se adjunta a mano (Imprimir → Guardar como PDF). El envío automático con adjunto queda para cuando haya un servicio de correo.

export interface BorradorDeMail { para?: string | null; cc?: string | null; asunto: string; cuerpo: string }

const MAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

/** Enlace mailto: con asunto y cuerpo codificados. Un destinatario que no parece un mail se ignora. */
export function enlaceDeMail(b: BorradorDeMail): string {
  const para = b.para && MAIL.test(b.para.trim()) ? b.para.trim() : '';
  const partes = [`subject=${encodeURIComponent(b.asunto)}`, `body=${encodeURIComponent(b.cuerpo)}`];
  if (b.cc && MAIL.test(b.cc.trim())) partes.push(`cc=${encodeURIComponent(b.cc.trim())}`);
  return `mailto:${encodeURIComponent(para).replace(/%40/g, '@')}?${partes.join('&')}`;
}
