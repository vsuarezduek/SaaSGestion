import { formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import type { Serie } from '../../../lib/estadisticas.ts';

// Gráfico en SVG dibujado en el servidor: una sola serie, sin ejes dobles; cada marca lleva su valor al pasar el mouse (<title>).
const VERDE = '#1c9764';

export const valorTexto = (v: number, formato: Serie['formato']): string =>
  formato === 'pesos' ? formatearPesos(v) : (v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 });

export default function Grafico({ serie }: { serie: Serie }) {
  const { puntos, formato } = serie;
  if (puntos.length === 0 || puntos.every((p) => p.valor === 0)) return <p style={{ color: '#5c6d66', margin: 0 }}>Sin datos en el período.</p>;
  const max = Math.max(...puntos.map((p) => p.valor), 1);

  if (serie.forma === 'barras') {
    const alto = 22, ancho = 480, izq = 150;
    return (
      <svg viewBox={`0 0 ${ancho} ${puntos.length * alto + 4}`} width="100%" role="img" aria-label={serie.titulo}>
        {puntos.map((p, i) => {
          const w = Math.max(2, ((ancho - izq - 90) * Math.max(p.valor, 0)) / max);
          return (
            <g key={p.etiqueta + i}>
              <title>{`${p.etiqueta}: ${valorTexto(p.valor, formato)}`}</title>
              <text x={izq - 6} y={i * alto + 15} textAnchor="end" fontSize="11" fill="#33443d">{p.etiqueta.length > 22 ? p.etiqueta.slice(0, 21) + '…' : p.etiqueta}</text>
              <rect x={izq} y={i * alto + 3} width={w} height={alto - 6} rx="3" fill={VERDE} />
              <text x={izq + w + 5} y={i * alto + 15} fontSize="11" fill="#5c6d66">{valorTexto(p.valor, formato)}</text>
            </g>
          );
        })}
      </svg>
    );
  }
  const ancho = 480, alto = 150, base = alto - 22, paso = ancho / puntos.length, cadaN = Math.ceil(puntos.length / 12);
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} width="100%" role="img" aria-label={serie.titulo}>
      <line x1="0" x2={ancho} y1={base} y2={base} stroke="#d3e6de" />
      {puntos.map((p, i) => {
        const h = (Math.max(p.valor, 0) / max) * (base - 14);
        return (
          <g key={p.etiqueta + i}>
            <title>{`${p.etiqueta}: ${valorTexto(p.valor, formato)}`}</title>
            <rect x={i * paso + paso * 0.15} y={base - h} width={paso * 0.7} height={h} rx="2" fill={VERDE} />
            {i % cadaN === 0 && <text x={i * paso + paso / 2} y={alto - 6} textAnchor="middle" fontSize="9" fill="#5c6d66">{p.etiqueta}</text>}
          </g>
        );
      })}
    </svg>
  );
}
