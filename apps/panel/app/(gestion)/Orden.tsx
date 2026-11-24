'use client';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

export type Dir = 'asc' | 'desc';
type Valor = string | number | Date | null | undefined;

const comparar = (a: Valor, b: Valor): number => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;   // los vacíos siempre al final
  if (b === null || b === undefined || b === '') return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
};

/**
 * Orden por columnas con un click en el encabezado (un segundo click invierte el sentido), como en el prototipo.
 * `claves` dice qué valor de la fila se compara en cada columna.
 */
export function useOrden<T, K extends string>(filas: T[], claves: Record<K, (f: T) => Valor>, inicial: { col: NoInfer<K>; dir: Dir } | null = null) {
  const [orden, setOrden] = useState(inicial);
  const ordenadas = useMemo(() => {
    if (!orden) return filas;
    const f = claves[orden.col];
    const s = orden.dir === 'asc' ? 1 : -1;
    return [...filas].sort((a, b) => {
      const va = f(a), vb = f(b);
      const vacioA = va === null || va === undefined || va === '', vacioB = vb === null || vb === undefined || vb === '';
      if (vacioA || vacioB) return comparar(va, vb); // vacíos al final en los dos sentidos
      return s * comparar(va, vb);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, orden]);
  const alternar = (col: K) => setOrden((o) => (o?.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'saldo' || col === 'total' || col === 'fecha' ? 'desc' : 'asc' }));
  return { ordenadas, orden, alternar };
}

/** Encabezado de columna que ordena al hacer click. */
export function Th<K extends string>({ col, orden, alternar, children, estilo }: { col: K; orden: { col: K; dir: Dir } | null; alternar: (c: K) => void; children: ReactNode; estilo: CSSProperties }) {
  const activo = orden?.col === col;
  return (
    <th style={{ ...estilo, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: activo ? '#1c9764' : undefined }} onClick={() => alternar(col)} title="Ordenar por esta columna"
      aria-sort={activo ? (orden!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {children} <span style={{ fontSize: 11, opacity: activo ? 1 : 0.35 }}>{activo ? (orden!.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  );
}

/** Sección que se abre y se cierra con un click en el título (▸ / ▾), como las tarjetas del prototipo. */
export function Desplegable({ titulo, abierto, onCambiar, estilo, children }: { titulo: ReactNode; abierto: boolean; onCambiar: (a: boolean) => void; estilo: CSSProperties; children: ReactNode }) {
  return (
    <div style={estilo}>
      <button type="button" onClick={() => onCambiar(!abierto)} aria-expanded={abierto}
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', fontWeight: 700, color: '#1c9764', fontSize: 16, textAlign: 'left' }}>
        {abierto ? '▾' : '▸'} {titulo}
      </button>
      {abierto && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

/** Igual que Desplegable pero lleva su propio estado: sirve para envolver contenido que arma el servidor. */
export function Seccion({ titulo, abiertoInicial = false, estilo, children }: { titulo: ReactNode; abiertoInicial?: boolean; estilo: CSSProperties; children: ReactNode }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  return <Desplegable titulo={titulo} abierto={abierto} onCambiar={setAbierto} estilo={estilo}>{children}</Desplegable>;
}
