// Datos de la pantalla de Inicio: resumen del día, sesión anterior, actividad legible (solo administración) y frase del día.
import type { SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { hoyArgentina } from './estadisticas.ts';
import { exigir } from './permisos.ts';
import { puede, type Rol } from '../../../packages/seguridad/src/index.ts';

const TZ = 'America/Argentina/Buenos_Aires';

export interface ResumenDeHoy { ventas: number; operaciones: number; ticketPromedio: number; sesionAnterior: Date | null }

export async function resumenDeHoy(s: SesionActiva): Promise<ResumenDeHoy> {
  exigir(s, 'inicio');
  const veMontos = puede({ rol: s.rol as Rol, permisos: s.permisos, activo: true, cajasVisibles: null }, 'informes');
  const hoy = hoyArgentina();
  return conTenant(s.tenantId, async (c) => {
    let ventas = 0, operaciones = 0;
    if (veMontos) {
      const r = await c.query<{ t: string; n: string }>(
        `SELECT COALESCE(sum(v.total * (CASE WHEN v.comprobante = 'nota_credito' THEN -1 ELSE 1 END)), 0) * 100 AS t,
                count(*) FILTER (WHERE v.comprobante <> 'nota_credito') AS n
           FROM ventas v WHERE v.estado = 'cerrada' AND v.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND v.fecha < (($1::date + 1)::timestamp AT TIME ZONE '${TZ}')`, [hoy]);
      ventas = Math.round(Number(r.rows[0]!.t)); operaciones = Number(r.rows[0]!.n);
    }
    // El último ingreso es el actual; el anterior es el que sigue.
    const a = await c.query<{ creado_en: Date }>(
      `SELECT creado_en FROM auditoria WHERE usuario_id = $1 AND accion = 'ingresar' AND entidad = 'sesion' ORDER BY id DESC OFFSET 1 LIMIT 1`, [s.usuarioId]);
    return { ventas, operaciones, ticketPromedio: operaciones ? Math.round(ventas / operaciones) : 0, sesionAnterior: a.rows[0]?.creado_en ?? null };
  });
}

const ENTIDADES: Record<string, [string, string | null]> = {
  correo_conexion: ['la casilla de correo', '/ajustes/correo'],
  venta: ['una venta', '/ventas'], compra: ['una compra', '/compras'], producto: ['un producto', '/productos'], cliente: ['un cliente', '/clientes'],
  proveedor: ['un proveedor', '/proveedores'], caja: ['una caja', '/cajas'], recibo: ['un recibo', '/recibos'], orden_pago: ['una orden de pago', '/ordenes-pago'], nota_credito_compra: ['una nota de crédito de proveedor', '/compras/nota-de-credito'],
  rubro: ['un rubro', '/ajustes/rubros'], nota_credito: ['una nota de crédito', '/ventas'], elaboracion: ['una elaboración', null], receta: ['una receta', null],
  costos_fijos: ['los costos fijos', '/ajustes/costos-fijos'], medio_pago: ['un medio de pago', null], venta_abierta: ['una venta abierta', '/ventas'], compra_abierta: ['una compra abierta', '/compras'],
  dato_extra: ['un dato extra', null], categoria_cliente: ['una categoría de clientes', null], categoria_compra: ['una categoría de compras', null],
  devolucion_pago: ['una devolución de pago', '/devoluciones'], productos: ['varios productos', '/productos'],
  usuario: ['un usuario', '/ajustes/usuarios'], empresa: ['los datos de la empresa', '/ajustes/empresa'],
};
const VERBOS: Record<string, string> = {
  crear: 'creó', modificar: 'modificó', anular: 'anuló', archivar: 'archivó', eliminar: 'eliminó', cerrar: 'cerró', abrir: 'abrió', registrar: 'registró', emitir: 'emitió',
  descartar: 'descartó', desactivar: 'desactivó', conectar: 'conectó', desconectar: 'desconectó', marcar_pedir: 'marcó para pedir', desmarcar_pedir: 'quitó de los pedidos', reactivar: 'reactivó', transferir: 'transfirió', revertir: 'revirtió', movimiento: 'registró un movimiento en',
};

/** «Ana creó un producto», sin datos técnicos. */
export function describirActividad(usuario: string | null, accion: string, entidad: string): { texto: string; enlace: string | null } {
  const quien = usuario ?? 'Alguien';
  if (entidad === 'sesion') return { texto: accion === 'ingresar' ? `${quien} ingresó` : accion === 'salir' ? `${quien} salió` : `Intento de ingreso fallido de ${quien}`, enlace: null };
  const [que, enlace] = ENTIDADES[entidad] ?? [entidad.replace(/_/g, ' '), null];
  return { texto: `${quien} ${VERBOS[accion] ?? accion} ${que}`, enlace };
}

export interface Actividad { cuando: Date; texto: string; enlace: string | null }

/** Solo para quien tiene el permiso de ajustes (administración). */
export async function actividadReciente(s: SesionActiva, limite = 15): Promise<Actividad[]> {
  exigir(s, 'ajustes');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ creado_en: Date; accion: string; entidad: string; usuario: string | null }>(
      `SELECT a.creado_en, a.accion, a.entidad, u.nombre AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE NOT (a.entidad = 'sesion' AND a.accion = 'salir') ORDER BY a.id DESC LIMIT $1`, [limite]);
    return r.rows.map((f) => ({ cuando: f.creado_en, ...describirActividad(f.usuario, f.accion, f.entidad) }));
  });
}

/** Cuántas entradas tiene el historial de actividad (las salidas de sesión no se cuentan). Solo administración. */
export async function totalActividad(s: SesionActiva): Promise<number> {
  exigir(s, 'ajustes');
  return conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM auditoria a WHERE NOT (a.entidad = 'sesion' AND a.accion = 'salir')`);
    return Number(r.rows[0]!.n);
  });
}

export const FRASES: readonly { texto: string; autor: string }[] = [
  { texto: 'No es que tengamos poco tiempo, sino que perdemos mucho.', autor: 'Séneca' },
  { texto: 'Sufrimos más a menudo en la imaginación que en la realidad.', autor: 'Séneca' },
  { texto: 'Ningún viento es favorable para quien no sabe a qué puerto se dirige.', autor: 'Séneca' },
  { texto: 'Mientras aplazamos la vida, ella se pasa.', autor: 'Séneca' },
  { texto: 'Lo que se interpone en el camino se convierte en el camino.', autor: 'Marco Aurelio' },
  { texto: 'La mejor venganza es no ser como quien te hizo daño.', autor: 'Marco Aurelio' },
  { texto: 'Si algo no es correcto, no lo hagas; si no es verdad, no lo digas.', autor: 'Marco Aurelio' },
  { texto: 'Lo que no beneficia al enjambre, tampoco beneficia a la abeja.', autor: 'Marco Aurelio' },
  { texto: 'Muy poco hace falta para tener una vida feliz.', autor: 'Marco Aurelio' },
  { texto: 'No son las cosas las que nos perturban, sino la opinión que tenemos de ellas.', autor: 'Epicteto' },
  { texto: 'Hay cosas que dependen de nosotros y cosas que no dependen de nosotros.', autor: 'Epicteto' },
  { texto: 'Primero dite a vos mismo lo que querés ser; después hacé lo que tengas que hacer.', autor: 'Epicteto' },
  { texto: 'Tenemos dos orejas y una sola boca para escuchar el doble de lo que hablamos.', autor: 'Zenón de Citio (atribuida)' },
];

/** Una frase por día, igual para todos y estable durante el día. */
export function fraseDelDia(hoy: string = hoyArgentina()): { texto: string; autor: string } {
  const dias = Math.floor(Date.parse(`${hoy}T00:00:00Z`) / 86400000);
  return FRASES[((dias % FRASES.length) + FRASES.length) % FRASES.length]!;
}
