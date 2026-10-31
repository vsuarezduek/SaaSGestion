import type { FiltroLista } from '../../../lib/productosArchivos.ts';

export type ParamsLista = { listas?: string | string[]; rubro?: string; proveedor?: string; extra?: string; valor?: string; stock?: string; mstock?: string };

/** Pasa los parámetros de la dirección a un filtro; si no se eligió ninguna lista, usa todas. */
export function filtroDe(p: ParamsLista, todas: { id: string }[]): FiltroLista {
  const elegidas = (Array.isArray(p.listas) ? p.listas : [p.listas ?? '']).flatMap((x) => x.split(',')).filter(Boolean);
  return {
    listaIds: elegidas.length ? elegidas : todas.map((l) => l.id),
    rubroId: p.rubro || undefined,
    proveedorId: p.proveedor || undefined,
    extraId: p.extra || undefined,
    extraValor: p.extra && p.valor ? p.valor : undefined,
    soloConStock: p.stock === '1',
    mostrarStock: p.mstock === '1',
  };
}
