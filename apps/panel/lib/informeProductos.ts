// Informe de productos filtrados: por proveedor, rubro, dato extra (con o sin un valor) y si se venden. Requiere el permiso de informes.
import type { SesionActiva } from './auth.ts';
import { listarProductos, type FilaProducto, type FiltroProductos } from './catalogo.ts';
import { exigir } from './permisos.ts';

export const SIN_VALOR = '__sin__';

export interface ParamsInformeProductos { q?: string; rubro?: string; proveedor?: string; extra?: string; valor?: string; venta?: string; estado?: string; alerta?: string }

/** Convierte los parámetros del formulario (todo texto) en el filtro del catálogo. */
export function filtroDeInforme(p: ParamsInformeProductos): FiltroProductos {
  const f: FiltroProductos = { limite: 500, estado: p.estado === 'archivados' || p.estado === 'todos' ? p.estado : 'activos' };
  if (p.q?.trim()) f.q = p.q.trim();
  if (p.rubro) f.rubroId = p.rubro;
  if (p.proveedor) f.proveedorId = p.proveedor;
  if (p.extra) {
    f.extraId = p.extra;
    if (p.valor === SIN_VALOR) f.extraValor = '';
    else if (p.valor) f.extraValor = p.valor;
  }
  if (p.venta === 'si') f.vendible = true;
  if (p.venta === 'no') f.vendible = false;
  if (p.alerta === 'negativo' || p.alerta === 'bajo_minimo') f.alerta = p.alerta;
  return f;
}

export async function informeDeProductos(s: SesionActiva, p: ParamsInformeProductos): Promise<{ filas: FilaProducto[]; total: number }> {
  exigir(s, 'informes');
  return listarProductos(s, filtroDeInforme(p));
}
