'use client';
import { botonSecundario, boton } from '../../../lib/estilos.ts';

const graficos = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('details[data-grafico]'));

/**
 * Botones de arriba de Estadísticas, como el prototipo: «Descargar todo en PDF» (despliega todos los gráficos y abre
 * la impresión del navegador para guardarlo como PDF, sin librerías), «Desplegar todo» y «Plegar todo».
 */
export default function Controles({ csv }: { csv: string }) {
  const todos = (abierto: boolean) => graficos().forEach((d) => { d.open = abierto; });
  const pdf = () => {
    const antes = graficos().map((d) => d.open);
    todos(true);
    const volver = () => { graficos().forEach((d, i) => { d.open = antes[i] ?? false; }); window.removeEventListener('afterprint', volver); };
    window.addEventListener('afterprint', volver);
    setTimeout(() => window.print(), 50);
  };
  const chico = { ...botonSecundario, padding: '7px 12px', textDecoration: 'none', fontSize: 14, fontFamily: 'inherit' };
  return (
    <div className="no-imprimir" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <style>{'@media print { nav, .no-imprimir { display: none !important; } body { background: #fff !important; } details[data-grafico] { break-inside: avoid; } }'}</style>
      <button type="button" style={{ ...boton, padding: '7px 12px', fontSize: 14, fontFamily: 'inherit' }} onClick={pdf}>Descargar todo en PDF</button>
      <a href={csv} style={chico}>Descargar todo en CSV</a>
      <button type="button" style={chico} onClick={() => todos(true)}>Desplegar todo</button>
      <button type="button" style={chico} onClick={() => todos(false)}>Plegar todo</button>
    </div>
  );
}
