'use client';

/** Abre el diálogo de impresión del navegador: desde ahí se imprime o se elige "Guardar como PDF". */
export default function BotonImprimir() {
  return (
    <button type="button" className="no-imprimir" onClick={() => window.print()}
      style={{ background: '#1c9764', color: '#fff', border: 0, borderRadius: 8, padding: '10px 16px', font: '600 14px inherit', cursor: 'pointer' }}>
      Imprimir / Guardar como PDF
    </button>
  );
}
