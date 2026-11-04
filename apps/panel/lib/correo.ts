// Correo del comercio: conexión de su casilla (Gmail u Outlook) y envío de comprobantes de venta y de compra.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { obtenerCompra } from './compras.ts';
import { cuerpoDeComprobante, type ComprobanteParaMail } from './comprobanteMail.ts';
import { descifrar, cifrar } from './correoCifrado.ts';
import { ErrorDeCorreo, enviarMensaje, revocar, tokenDeAcceso, type Fetch, type ProveedorCorreo } from './correoOauth.ts';
import { conTenant } from './db.ts';
import { obtenerEmpresa } from './empresa.ts';
import { ETIQUETAS_COMPROBANTE } from './etiquetas.ts';
import { esMailValido } from './mime.ts';
import { exigir } from './permisos.ts';
import { obtenerCliente, obtenerProveedor } from './personas.ts';
import { obtenerVenta } from './ventas.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../packages/dominio/src/index.ts';

export const MAX_ENVIOS_POR_HORA = 60;
const fechaAr = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export interface Conexion { proveedor: ProveedorCorreo; cuenta: string; conectadoEn: Date }

/** Cualquier usuario puede saber si hay casilla conectada (para mostrar el botón de enviar); el token nunca sale de acá. */
export async function obtenerConexion(s: SesionActiva): Promise<Conexion | null> {
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ proveedor: ProveedorCorreo; cuenta: string; conectado_en: Date }>('SELECT proveedor, cuenta, conectado_en FROM correo_conexion');
    const f = r.rows[0];
    return f ? { proveedor: f.proveedor, cuenta: f.cuenta, conectadoEn: f.conectado_en } : null;
  });
}

export async function guardarConexion(s: SesionActiva, proveedor: ProveedorCorreo, cuenta: string, refresco: string): Promise<void> {
  exigir(s, 'ajustes');
  const token = cifrar(refresco, s.tenantId);
  await conTenant(s.tenantId, async (c) => {
    await c.query(
      `INSERT INTO correo_conexion (tenant_id, proveedor, cuenta, token_cifrado, conectado_por) VALUES (app.tenant_id(), $1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE SET proveedor = $1, cuenta = $2, token_cifrado = $3, conectado_por = $4, conectado_en = now()`,
      [proveedor, cuenta, token, s.usuarioId]);
    await auditar(c, s.usuarioId, 'conectar', 'correo_conexion', { proveedor, cuenta });
  });
}

export async function desconectar(s: SesionActiva, f: Fetch = fetch): Promise<void> {
  exigir(s, 'ajustes');
  const previo = await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ proveedor: ProveedorCorreo; cuenta: string; token_cifrado: string }>('DELETE FROM correo_conexion RETURNING proveedor, cuenta, token_cifrado');
    if (r.rows[0]) await auditar(c, s.usuarioId, 'desconectar', 'correo_conexion', { proveedor: r.rows[0].proveedor, cuenta: r.rows[0].cuenta });
    return r.rows[0] ?? null;
  });
  if (previo) await revocar(previo.proveedor, descifrar(previo.token_cifrado, s.tenantId), f).catch(() => undefined);
}

export interface EnvioReciente { tipo: string; para: string; asunto: string; resultado: string; detalle: string | null; creadoEn: Date; usuario: string | null }

export async function enviosRecientes(s: SesionActiva, limite = 15): Promise<EnvioReciente[]> {
  exigir(s, 'ajustes');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query(
      `SELECT e.tipo, e.para, e.asunto, e.resultado, e.detalle, e.creado_en, u.nombre AS usuario
         FROM correo_envios e LEFT JOIN usuarios u ON u.id = e.usuario_id ORDER BY e.creado_en DESC LIMIT $1`, [limite]);
    return r.rows.map((f) => ({ tipo: f.tipo, para: f.para, asunto: f.asunto, resultado: f.resultado, detalle: f.detalle, creadoEn: f.creado_en, usuario: f.usuario }));
  });
}

interface Armado { asunto: string; contenido: ComprobanteParaMail; destinoSugerido: string | null }

async function armarVenta(s: SesionActiva, id: string): Promise<Armado> {
  const v = await obtenerVenta(s, id);
  if (!v) throw new ErrorDeUsuario('No se encontró la venta');
  const cliente = v.clienteId ? await obtenerCliente(s, v.clienteId).catch(() => null) : null;
  const esNota = v.comprobante === 'nota_credito';
  const titulo = `${esNota ? 'Nota de crédito' : 'Venta'} N° ${v.numero}`;
  const $ = (n: string) => formatearPesos(aCentavos(n));
  return {
    asunto: titulo, destinoSugerido: cliente?.email ?? null,
    contenido: {
      titulo, subtitulo: `${ETIQUETAS_COMPROBANTE[v.comprobante] ?? v.comprobante} · ${fechaAr(v.fecha)}${v.estado === 'anulada' ? ' · ANULADA' : ''}`,
      contraparte: { etiqueta: 'Cliente', nombre: v.cliente },
      renglones: v.renglones.map((r) => ({ descripcion: r.descripcion, cantidad: formatearCantidad(r.cantidad), importe: $(r.total) })),
      totales: [...(aCentavos(v.descuentoTotal) > 0 ? [{ etiqueta: 'Descuento:', valor: `−${$(v.descuentoTotal)}` }] : []), { etiqueta: esNota ? 'Total devuelto' : 'Total', valor: $(v.total) }],
      nota: v.nota, saludo: `Hola${v.cliente ? ' ' + v.cliente : ''}, te mandamos el detalle de tu ${titulo.toLowerCase()}:`, cierre: 'Gracias por tu compra.',
    },
  };
}

async function armarCompra(s: SesionActiva, id: string): Promise<Armado> {
  const c = await obtenerCompra(s, id);
  if (!c) throw new ErrorDeUsuario('No se encontró la compra');
  const prov = await obtenerProveedor(s, c.proveedorId).catch(() => null);
  const titulo = `Compra N° ${c.numero}`;
  const $ = (n: string) => formatearPesos(aCentavos(n));
  return {
    asunto: titulo, destinoSugerido: prov?.email ?? null,
    contenido: {
      titulo, subtitulo: `${ETIQUETAS_COMPROBANTE[c.comprobante] ?? c.comprobante}${c.nroComprobante ? ' N° ' + c.nroComprobante : ''} · ${fechaAr(c.fecha)}${c.estado === 'anulada' ? ' · ANULADA' : ''}`,
      contraparte: { etiqueta: 'Proveedor', nombre: c.proveedor },
      renglones: c.renglones.map((r) => ({ descripcion: r.descripcion, cantidad: formatearCantidad(r.cantidad), importe: $(r.neto) })),
      totales: [{ etiqueta: 'Total', valor: $(c.total) }], nota: c.nota,
      saludo: `Hola${c.proveedor ? ' ' + c.proveedor : ''}, te enviamos el detalle de nuestra compra:`, cierre: 'Muchas gracias.',
    },
  };
}

/** Mail al que conviene mandar el comprobante (el del cliente o proveedor, si lo tiene cargado). */
export async function destinoSugerido(s: SesionActiva, tipo: 'venta' | 'compra', id: string): Promise<string | null> {
  return (tipo === 'venta' ? await armarVenta(s, id) : await armarCompra(s, id)).destinoSugerido;
}

export interface EntradaEnvio { tipo: 'venta' | 'compra'; id: string; para: string }

/** Manda el comprobante desde la casilla conectada. Queda registrado (también si falla) y hay un tope por hora. */
export async function enviarComprobante(s: SesionActiva, e: EntradaEnvio, f: Fetch = fetch): Promise<void> {
  exigir(s, e.tipo === 'venta' ? 'ventas' : 'compras');
  const para = e.para.trim().toLowerCase();
  if (!esMailValido(para)) throw new ErrorDeUsuario('El mail de destino no es válido');
  const [armado, empresa, previo] = await Promise.all([
    e.tipo === 'venta' ? armarVenta(s, e.id) : armarCompra(s, e.id),
    obtenerEmpresa(s),
    conTenant(s.tenantId, async (c) => {
      const cx = await c.query<{ proveedor: ProveedorCorreo; cuenta: string; token_cifrado: string }>('SELECT proveedor, cuenta, token_cifrado FROM correo_conexion');
      const n = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM correo_envios WHERE creado_en > now() - interval '1 hour'");
      return { conexion: cx.rows[0] ?? null, enviados: Number(n.rows[0]!.n) };
    }),
  ]);
  if (!previo.conexion) throw new ErrorDeUsuario('Todavía no conectaste tu casilla. Hacelo en Ajustes → Correo.');
  if (previo.enviados >= MAX_ENVIOS_POR_HORA) throw new ErrorDeUsuario('Se alcanzó el máximo de mails por hora. Probá más tarde.');
  const asunto = `${armado.asunto} - ${empresa.nombre}`;
  const cuerpo = cuerpoDeComprobante(armado.contenido, empresa);
  let resultado: 'enviado' | 'error' = 'enviado';
  let detalle: string | null = null;
  let falla: unknown = null;
  try {
    const acceso = await tokenDeAcceso(previo.conexion.proveedor, descifrar(previo.conexion.token_cifrado, s.tenantId), f);
    await enviarMensaje(previo.conexion.proveedor, acceso, {
      de: previo.conexion.cuenta, nombreDe: empresa.nombre, para, responderA: empresa.email && esMailValido(empresa.email) ? empresa.email : null, asunto, texto: cuerpo.texto, html: cuerpo.html,
    }, f);
  } catch (err) {
    resultado = 'error';
    falla = err;
    detalle = err instanceof ErrorDeCorreo ? err.message.slice(0, 480) : 'Error inesperado al enviar';
  }
  await conTenant(s.tenantId, (c) =>
    c.query('INSERT INTO correo_envios (tenant_id, usuario_id, tipo, entidad_id, para, asunto, resultado, detalle) VALUES (app.tenant_id(), $1, $2, $3, $4, $5, $6, $7)',
      [s.usuarioId, e.tipo, e.id, para, asunto, resultado, detalle]));
  if (falla) {
    if (falla instanceof ErrorDeCorreo) throw new ErrorDeUsuario(falla.message);
    throw falla;
  }
}
