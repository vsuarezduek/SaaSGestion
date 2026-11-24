/**
 * Se muestra al instante apenas se hace click en otra pantalla, mientras el servidor arma la nueva.
 * Sin esto, el click parecía no hacer nada hasta que llegaba la página completa.
 */
export default function Cargando() {
  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }} aria-busy="true">
      <style>{'@keyframes sgPulso{0%,100%{opacity:.45}50%{opacity:1}}'}</style>
      <div style={{ color: '#5c6d66', fontSize: 14, marginBottom: 14 }}>Cargando…</div>
      {[64, 180, 120].map((alto, i) => (
        <div key={i} style={{ height: alto, background: '#fff', border: '1px solid #d3e6de', borderRadius: 12, marginBottom: 14, animation: 'sgPulso 1.2s ease-in-out infinite' }} />
      ))}
    </main>
  );
}
