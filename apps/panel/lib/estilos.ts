import type { CSSProperties } from 'react';

export const pagina: CSSProperties = { maxWidth: 520, margin: '0 auto', padding: 24 };
export const tarjeta: CSSProperties = { background: '#fff', border: '1px solid #d3e6de', borderRadius: 12, padding: 16, marginBottom: 14 };
export const campo: CSSProperties = { width: '100%', boxSizing: 'border-box', font: 'inherit', padding: 9, border: '1px solid #d3e6de', borderRadius: 8, background: '#f0f8f5', marginTop: 4 };
export const etiqueta: CSSProperties = { display: 'block', fontSize: 12, color: '#5c6d66', marginBottom: 10 };
export const boton: CSSProperties = { background: '#1c9764', color: '#fff', border: 0, borderRadius: 8, padding: '9px 14px', font: '600 14px inherit', cursor: 'pointer' };
export const botonSecundario: CSSProperties = { ...boton, background: 'none', color: '#1c9764', border: '1px solid #d3e6de', fontWeight: 500 };
export const aviso: CSSProperties = { background: '#d9f1f2', color: '#1b5f63', borderRadius: 8, padding: '8px 12px', marginBottom: 12 };
export const error: CSSProperties = { background: '#fbeae0', color: '#b4571a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 };
