'use client';

/** Baja el gráfico de su tarjeta como imagen PNG (se dibuja el SVG en un canvas, sin servicios externos). */
export default function BotonPng({ nombre }: { nombre: string }) {
  const bajar = (e: React.MouseEvent<HTMLButtonElement>) => {
    const svg = e.currentTarget.closest('details')?.querySelector('svg');
    if (!svg) return;
    const caja = svg.viewBox.baseVal;
    const ancho = (caja.width || 480) * 2, alto = (caja.height || 160) * 2;
    const copia = svg.cloneNode(true) as SVGSVGElement;
    copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copia.setAttribute('width', String(ancho));
    copia.setAttribute('height', String(alto));
    const fondo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    fondo.setAttribute('width', '100%'); fondo.setAttribute('height', '100%'); fondo.setAttribute('fill', '#ffffff');
    copia.insertBefore(fondo, copia.firstChild);
    const img = new Image();
    img.onload = () => {
      const lienzo = document.createElement('canvas');
      lienzo.width = ancho; lienzo.height = alto;
      lienzo.getContext('2d')!.drawImage(img, 0, 0, ancho, alto);
      lienzo.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${nombre}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copia));
  };
  return <button type="button" onClick={bajar} style={{ background: 'none', border: 0, padding: 0, marginLeft: 12, font: 'inherit', fontSize: 12, color: '#1c9764', cursor: 'pointer', textDecoration: 'underline' }}>Bajar PNG</button>;
}
