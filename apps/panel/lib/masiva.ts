// Modificación masiva de costos y precios: a todos los productos activos de un proveedor y/o rubro (con sus subrubros).
// Se cambia el costo por porcentaje o importe y se elige qué pasa con el precio:
//   mantener_utilidad → el precio sube o baja en la misma proporción que el costo (solo en las listas elegidas)
//   mantener_precio   → el precio no se toca (cambia la utilidad)
// Todo en una transacción; con "simular" solo se calcula. Cada producto deja su auditoría con el antes y el después.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { listasEn } from './catalogo.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';
import { aCentavos, ajustarCosto, deCentavos, normalizarImporte, precioMantenerUtilidad } from '../../../packages/dominio/src/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MASIVA = 5000;

export interface EntradaMasiva {
  proveedorId: string | null;
  rubroId: string | null;
  listaIds: string[] | null;          // null = todas las listas
  modo: 'mantener_utilidad' | 'mantener_precio';
  tipo: 'pct' | 'imp';
  valor: string;                       // puede ser negativo para bajar
}

export interface ResultadoMasiva {
  coinciden: number;                   // productos que cumplen el filtro
  cambian: number;                     // productos cuyo costo realmente cambia
  aplicado: boolean;
  muestra: { id: string; nombre: string; costoAntes: string; costoDespues: string; precios: { lista: string; antes: string; despues: string }[] }[];
}

function interpretarValor(txt: string, tipo: 'pct' | 'imp'): number {
  const t = String(txt ?? '').trim().replace(/^\+/, '');
  const negativo = t.startsWith('-');
  const n = normalizarImporte(negativo ? t.slice(1) : t);
  if (n === null) throw new ErrorDeUsuario('Ingresá un valor válido (por ejemplo 10 o -5,5)');
  const abs = tipo === 'imp' ? aCentavos(n) : Number(n);
  if (abs === 0) throw new ErrorDeUsuario('El valor no puede ser cero');
  if (tipo === 'pct' && abs > 1000) throw new ErrorDeUsuario('El porcentaje es demasiado grande (máximo 1.000 %)');
  return negativo ? -abs : abs;
}

export async function modificacionMasiva(s: SesionActiva, entrada: EntradaMasiva, opciones: { simular: boolean }): Promise<ResultadoMasiva> {
  exigir(s, 'productos');
  if (entrada.modo !== 'mantener_utilidad' && entrada.modo !== 'mantener_precio') throw new ErrorDeUsuario('Elegí qué pasa con el precio');
  if (entrada.tipo !== 'pct' && entrada.tipo !== 'imp') throw new ErrorDeUsuario('Elegí si es porcentaje o importe');
  for (const id of [entrada.proveedorId, entrada.rubroId, ...(entrada.listaIds ?? [])]) if (id && !UUID.test(id)) throw new ErrorDeUsuario('Un dato del filtro no es válido');
  if (!entrada.proveedorId && !entrada.rubroId) throw new ErrorDeUsuario('Elegí un proveedor o un rubro: la modificación masiva no se aplica a todo el catálogo de una vez');
  const valor = interpretarValor(entrada.valor, entrada.tipo);

  return conTenant(s.tenantId, async (c) => {
    const listas = await listasEn(c);
    const nombreLista = new Map(listas.map((l) => [l.id, l.nombre]));
    const elegidas = entrada.listaIds ? listas.filter((l) => entrada.listaIds!.includes(l.id)).map((l) => l.id) : listas.map((l) => l.id);
    if (entrada.modo === 'mantener_utilidad' && elegidas.length === 0) throw new ErrorDeUsuario('Elegí al menos una lista de precios');

    const params: unknown[] = [];
    const cond = ['p.activo'];
    if (entrada.proveedorId) { params.push(entrada.proveedorId); cond.push(`p.proveedor_id = $${params.length}`); }
    if (entrada.rubroId) {
      params.push(entrada.rubroId);
      cond.push(`p.rubro_id IN (WITH RECURSIVE d AS (SELECT id FROM rubros WHERE id = $${params.length}::uuid UNION ALL SELECT x.id FROM rubros x JOIN d ON x.padre_id = d.id) SELECT id FROM d)`);
    }
    const r = await c.query<{ id: string; nombre: string; costo: string; precios: Record<string, string> }>(
      `SELECT p.id, p.nombre, p.costo::text AS costo,
              COALESCE((SELECT jsonb_object_agg(pp.lista_id, pp.precio::text) FROM producto_precios pp WHERE pp.producto_id = p.id), '{}'::jsonb) AS precios
         FROM productos p WHERE ${cond.join(' AND ')} ORDER BY lower(p.nombre), p.id LIMIT ${MAX_MASIVA + 1}`, params);
    if (r.rows.length > MAX_MASIVA) throw new ErrorDeUsuario(`Son más de ${MAX_MASIVA} productos: acotá el filtro`);

    const resultado: ResultadoMasiva = { coinciden: r.rows.length, cambian: 0, aplicado: false, muestra: [] };
    const cambios: { id: string; costoAntes: string; costoDespues: string; precios: { lista: string; antes: string; despues: string }[] }[] = [];
    for (const f of r.rows) {
      const k0 = aCentavos(f.costo);
      const k1 = ajustarCosto(k0, entrada.tipo, valor);
      if (k1 === k0) continue;
      const precios: { lista: string; antes: string; despues: string }[] = [];
      if (entrada.modo === 'mantener_utilidad') {
        for (const lid of elegidas) {
          const antes = f.precios[lid];
          if (antes === undefined) continue;
          const despues = deCentavos(precioMantenerUtilidad(aCentavos(antes), k0, k1));
          if (despues !== antes) precios.push({ lista: lid, antes, despues });
        }
      }
      cambios.push({ id: f.id, costoAntes: f.costo, costoDespues: deCentavos(k1), precios });
      if (resultado.muestra.length < 10) {
        resultado.muestra.push({ id: f.id, nombre: f.nombre, costoAntes: f.costo, costoDespues: deCentavos(k1), precios: precios.map((x) => ({ ...x, lista: nombreLista.get(x.lista) ?? x.lista })) });
      }
    }
    resultado.cambian = cambios.length;
    if (opciones.simular || cambios.length === 0) return resultado;

    for (const k of cambios) {
      await c.query('UPDATE productos SET costo = $2 WHERE id = $1', [k.id, k.costoDespues]);
      for (const p of k.precios) await c.query('UPDATE producto_precios SET precio = $3 WHERE producto_id = $1 AND lista_id = $2', [k.id, p.lista, p.despues]);
      await auditar(c, s.usuarioId, 'modificar', 'producto',
        { masiva: true, costo: k.costoDespues, precios: Object.fromEntries(k.precios.map((p) => [p.lista, p.despues])) },
        { entidadId: k.id, antes: { costo: k.costoAntes, precios: Object.fromEntries(k.precios.map((p) => [p.lista, p.antes])) } });
    }
    await auditar(c, s.usuarioId, 'modificar', 'productos', { masiva: true, ...entrada, productos: cambios.length });
    resultado.aplicado = true;
    return resultado;
  });
}
