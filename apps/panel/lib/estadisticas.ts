// Estadísticas de ventas y compras de un período (hora de Argentina). Todo se calcula en la base sobre los libros:
// ventas cerradas (las notas de crédito restan) y compras cerradas; las anuladas no cuentan.
// Importes en centavos enteros y cantidades en milésimas enteras: nunca coma flotante.
import { ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';

const TZ = 'America/Argentina/Buenos_Aires';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface Periodo { desde: string; hasta: string; nombre: string }   // fechas AAAA-MM-DD, ambas incluidas

export type OrdenProductos = 'unidades' | 'monto' | 'rentabilidad';
export interface Punto { etiqueta: string; valor: number }
export interface Serie {
  clave: string; titulo: string; formato: 'pesos' | 'unidades';
  forma: 'columnas' | 'barras'; puntos: Punto[]; nota?: string;
}
export interface Estadisticas {
  periodo: Periodo;
  ventas: number; operaciones: number; ticketPromedio: number; rentabilidad: number; compras: number;   // centavos
  series: Serie[];
}

export function hoyArgentina(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: TZ });
}

const sumarDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Período a partir de una opción rápida (hoy, 7d, 30d, mes, mes_anterior, anio) o de fechas elegidas. */
export function periodoDe(opcion: string | undefined, desde: string | undefined, hasta: string | undefined, hoy: string = hoyArgentina()): Periodo {
  if (desde && hasta) {
    if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new ErrorDeUsuario('Las fechas no son válidas');
    if (desde > hasta) throw new ErrorDeUsuario('La fecha «desde» no puede ser posterior a «hasta»');
    return { desde, hasta, nombre: 'Período elegido' };
  }
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  switch (opcion) {
    case 'hoy': return { desde: hoy, hasta: hoy, nombre: 'Hoy' };
    case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy, nombre: 'Últimos 7 días' };
    case 'mes_anterior': {
      const ant = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
      return { desde: ant, hasta: sumarDias(`${a}-${String(m).padStart(2, '0')}-01`, -1), nombre: 'Mes anterior' };
    }
    case 'anio': return { desde: `${a}-01-01`, hasta: hoy, nombre: 'Este año' };
    case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy, nombre: 'Últimos 30 días' };
    default: return { desde: `${a}-${String(m).padStart(2, '0')}-01`, hasta: hoy, nombre: 'Este mes' };
  }
}

const centavos = (n: string | number | null): number => Math.round(Number(n ?? 0));

export async function estadisticasDe(s: SesionActiva, periodo: Periodo, orden: OrdenProductos = 'monto'): Promise<Estadisticas> {
  exigir(s, 'informes');
  if (!FECHA.test(periodo.desde) || !FECHA.test(periodo.hasta)) throw new ErrorDeUsuario('Las fechas no son válidas');
  const dias = Math.round((Date.parse(periodo.hasta) - Date.parse(periodo.desde)) / 86400000) + 1;
  if (dias > 3660) throw new ErrorDeUsuario('El período es demasiado largo (máximo 10 años)');
  const porDia = dias <= 62;
  // Ventas cerradas del período con su signo (la nota de crédito resta). Fechas en hora de Argentina, «hasta» incluido.
  const base = `FROM ventas v WHERE v.estado = 'cerrada'
      AND v.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND v.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
  const signo = `(CASE WHEN v.comprobante = 'nota_credito' THEN -1 ELSE 1 END)`;
  const p = [periodo.desde, periodo.hasta];

  return conTenant(s.tenantId, async (c) => {
    const q = async <T extends object>(sql: string, extra: unknown[] = []): Promise<T[]> => (await c.query<T>(sql, [...p, ...extra])).rows;
    const k = (await q<{ ventas: string; ops: string }>(`SELECT COALESCE(sum(v.total * ${signo}), 0) * 100 AS ventas, count(*) FILTER (WHERE v.comprobante <> 'nota_credito') AS ops ${base}`))[0]!;
    const rent = (await q<{ r: string }>(
      `SELECT COALESCE(sum(${signo} * (r.total / (1 + r.iva / 100) - r.cantidad * pr.costo)), 0) * 100 AS r
         FROM ventas v JOIN venta_renglones r ON r.tenant_id = v.tenant_id AND r.venta_id = v.id JOIN productos pr ON pr.id = r.producto_id
        WHERE v.estado = 'cerrada' AND v.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND v.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`))[0]!;
    const comp = (await q<{ t: string }>(
      `SELECT COALESCE(sum(k.total), 0) * 100 AS t FROM compras k WHERE k.estado = 'cerrada'
          AND k.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND k.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`))[0]!;

    const grupo = async (expr: string, join = '', top = 10): Promise<Punto[]> =>
      (await q<{ g: string; t: string }>(`SELECT COALESCE(${expr}, '–') AS g, sum(v.total * ${signo}) * 100 AS t FROM ventas v ${join} WHERE v.estado = 'cerrada'
          AND v.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND v.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY 1 HAVING sum(v.total * ${signo}) <> 0 ORDER BY 2 DESC LIMIT ${top}`)).map((f) => ({ etiqueta: f.g, valor: centavos(f.t) }));

    // Ventas por día (o por mes si el período es largo), con los días sin ventas en cero.
    const serieTiempo = await q<{ d: string; t: string }>(
      porDia
        ? `SELECT to_char(v.fecha AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS d, sum(v.total * ${signo}) * 100 AS t ${base} GROUP BY 1`
        : `SELECT to_char(v.fecha AT TIME ZONE '${TZ}', 'YYYY-MM') AS d, sum(v.total * ${signo}) * 100 AS t ${base} GROUP BY 1`);
    const mapa = new Map(serieTiempo.map((f) => [f.d, centavos(f.t)]));
    const tiempo: Punto[] = [];
    if (porDia) {
      for (let i = 0; i < dias; i++) { const d = sumarDias(periodo.desde, i); tiempo.push({ etiqueta: `${d.slice(8)}/${d.slice(5, 7)}`, valor: mapa.get(d) ?? 0 }); }
    } else {
      let [a, m] = periodo.desde.split('-').map(Number) as [number, number];
      const [ah, mh] = periodo.hasta.split('-').map(Number) as [number, number];
      while (a < ah || (a === ah && m <= mh)) {
        tiempo.push({ etiqueta: `${String(m).padStart(2, '0')}/${String(a).slice(2)}`, valor: mapa.get(`${a}-${String(m).padStart(2, '0')}`) ?? 0 });
        m++; if (m > 12) { m = 1; a++; }
      }
    }

    const semana = await q<{ d: number; t: string }>(`SELECT extract(isodow FROM v.fecha AT TIME ZONE '${TZ}')::int AS d, sum(v.total * ${signo}) * 100 AS t ${base} GROUP BY 1`);
    const nombresDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const porSemana: Punto[] = nombresDia.map((n, i) => ({ etiqueta: n, valor: centavos(semana.find((f) => f.d === i + 1)?.t ?? 0) }));
    const horas = await q<{ h: number; t: string }>(`SELECT extract(hour FROM v.fecha AT TIME ZONE '${TZ}')::int AS h, sum(v.total * ${signo}) * 100 AS t ${base} GROUP BY 1`);
    const porHora: Punto[] = [];
    if (horas.length) {
      const hs = horas.map((f) => f.h);
      for (let h = Math.min(...hs); h <= Math.max(...hs); h++) porHora.push({ etiqueta: `${h}h`, valor: centavos(horas.find((f) => f.h === h)?.t ?? 0) });
    }

    const exprOrden = { unidades: 'sum(r.cantidad * ' + signo + ') * 1000', monto: 'sum(r.total * ' + signo + ') * 100', rentabilidad: 'sum(' + signo + ' * (r.total / (1 + r.iva / 100) - r.cantidad * pr.costo)) * 100' }[orden];
    const topProd = (await q<{ g: string; t: string }>(
      `SELECT pr.nombre AS g, ${exprOrden} AS t FROM ventas v JOIN venta_renglones r ON r.tenant_id = v.tenant_id AND r.venta_id = v.id JOIN productos pr ON pr.id = r.producto_id
        WHERE v.estado = 'cerrada' AND v.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND v.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY pr.id, pr.nombre HAVING ${exprOrden} > 0 ORDER BY 2 DESC LIMIT 10`)).map((f) => ({ etiqueta: f.g, valor: centavos(f.t) }));
    const porTipo = (await q<{ g: string; t: string }>(
      `SELECT COALESCE(pr.tipo, 'Sin tipo') AS g, sum(r.total * ${signo}) * 100 AS t FROM ventas v JOIN venta_renglones r ON r.tenant_id = v.tenant_id AND r.venta_id = v.id LEFT JOIN productos pr ON pr.id = r.producto_id
        WHERE v.estado = 'cerrada' AND v.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND v.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY 1 HAVING sum(r.total * ${signo}) > 0 ORDER BY 2 DESC LIMIT 10`)).map((f) => ({ etiqueta: f.g, valor: centavos(f.t) }));
    const comprasProv = (await q<{ g: string; t: string }>(
      `SELECT pv.nombre AS g, sum(k.total) * 100 AS t FROM compras k JOIN proveedores pv ON pv.tenant_id = k.tenant_id AND pv.id = k.proveedor_id
        WHERE k.estado = 'cerrada' AND k.fecha >= ($1::date::timestamp AT TIME ZONE '${TZ}') AND k.fecha < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')
        GROUP BY pv.id, pv.nombre HAVING sum(k.total) > 0 ORDER BY 2 DESC LIMIT 10`)).map((f) => ({ etiqueta: f.g, valor: centavos(f.t) }));
    // Al día de hoy, sin importar el período.
    const cajas = (await c.query<{ g: string; t: string }>(
      `SELECT k.nombre AS g, COALESCE(sum(m.importe), 0) * 100 AS t FROM cajas k LEFT JOIN caja_movimientos m ON m.caja_id = k.id WHERE k.activa GROUP BY k.id, k.nombre ORDER BY 2 DESC`)).rows
      .map((f) => ({ etiqueta: f.g, valor: centavos(f.t) }));
    const deudores = (await c.query<{ g: string; t: string }>(
      `SELECT cl.nombre AS g, sum(m.importe) * 100 AS t FROM cuenta_corriente_movimientos m JOIN clientes cl ON cl.id = m.cliente_id
        GROUP BY cl.id, cl.nombre HAVING sum(m.importe) >= 100 ORDER BY 2 DESC LIMIT 10`)).rows.map((f) => ({ etiqueta: f.g, valor: centavos(f.t) }));

    const ventas = centavos(k.ventas), ops = Number(k.ops);
    const nombreOrden = { unidades: 'unidades', monto: 'monto cobrado', rentabilidad: 'rentabilidad' }[orden];
    return {
      periodo, ventas, operaciones: ops, ticketPromedio: ops ? Math.round(ventas / ops) : 0, rentabilidad: centavos(rent.r), compras: centavos(comp.t),
      series: [
        { clave: 'tiempo', titulo: porDia ? 'Ventas por día' : 'Ventas por mes', formato: 'pesos', forma: 'columnas', puntos: tiempo },
        { clave: 'medio', titulo: 'Ventas por medio de pago', formato: 'pesos', forma: 'barras', puntos: await grupo(`CASE WHEN v.en_cuenta_corriente THEN 'Cuenta corriente' ELSE mp.nombre END`, 'LEFT JOIN medios_pago mp ON mp.id = v.medio_pago_id') },
        { clave: 'usuario', titulo: 'Ventas por usuario', formato: 'pesos', forma: 'barras', puntos: await grupo('u.nombre', 'LEFT JOIN usuarios u ON u.id = v.usuario_id') },
        { clave: 'semana', titulo: 'Ventas por día de la semana', formato: 'pesos', forma: 'columnas', puntos: porSemana },
        { clave: 'hora', titulo: 'Ventas por hora', formato: 'pesos', forma: 'columnas', puntos: porHora },
        { clave: 'productos', titulo: `Top 10 productos · ${nombreOrden}`, formato: orden === 'unidades' ? 'unidades' : 'pesos', forma: 'barras', puntos: topProd, nota: orden === 'rentabilidad' ? 'Precio sin IVA menos el costo actual del producto.' : undefined },
        { clave: 'clientes', titulo: 'Top 10 clientes', formato: 'pesos', forma: 'barras', puntos: await grupo('cl.nombre', 'LEFT JOIN clientes cl ON cl.id = v.cliente_id') },
        { clave: 'tipos', titulo: 'Ventas por tipo de producto', formato: 'pesos', forma: 'barras', puntos: porTipo },
        { clave: 'proveedores', titulo: 'Compras por proveedor', formato: 'pesos', forma: 'barras', puntos: comprasProv },
        { clave: 'cajas', titulo: 'Saldo actual por caja', formato: 'pesos', forma: 'barras', puntos: cajas, nota: 'Al día de hoy, sin importar el período.' },
        { clave: 'deudores', titulo: 'Clientes con mayor deuda', formato: 'pesos', forma: 'barras', puntos: deudores, nota: 'Saldo de cuenta corriente al día de hoy.' },
      ],
    };
  });
}
