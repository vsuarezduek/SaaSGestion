'use client';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, error as estiloError, etiqueta, aviso, tarjeta } from '../../../lib/estilos.ts';
import type { ResultadoImportacion, TipoImportacion } from '../../../lib/importar.ts';
import { importarAccion } from './acciones.ts';

const TITULOS: Record<TipoImportacion, string> = { clientes: 'Clientes', proveedores: 'Proveedores', productos: 'Productos' };
const AYUDA: Record<TipoImportacion, string> = {
  clientes: 'Columnas: Nombre (obligatoria), Categoría, Teléfono, Email, Domicilio, Localidad, CUIT, Condición IVA y Saldo (deuda inicial del cliente; negativo = saldo a favor).',
  proveedores: 'Columnas: Nombre (obligatoria), Contacto, Categoría, Teléfono, Email, Domicilio, Localidad, CUIT, Condición IVA y Saldo (lo que se le debe al proveedor).',
  productos: 'Columnas: Nombre (obligatoria), Código, Rubro (podés usar "Rubro > Subrubro"; si no existe se crea), Tipo, Unidad, Costo (sin IVA), IVA, Stock (inicial), Stock mínimo, Stock ideal y una columna por cada lista de precios (con el nombre de la lista).',
};

export default function Importador({ plantillas }: { plantillas: Record<TipoImportacion, string> }) {
  const [tipo, setTipo] = useState<TipoImportacion>('clientes');
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string } | null>(null);
  const [actualizar, setActualizar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [res, setRes] = useState<ResultadoImportacion | null>(null);
  const [pend, iniciar] = useTransition();

  const leer = async (f: File | undefined) => {
    setRes(null); setMsg(null);
    if (!f) { setArchivo(null); return; }
    if (f.size > 900_000) { setMsg('El archivo pesa demasiado (máximo 900 KB). Dividilo en partes.'); setArchivo(null); return; }
    // Los CSV de Excel en Argentina suelen venir en Windows-1252; si hay caracteres de reemplazo, se vuelve a leer así.
    const buf = await f.arrayBuffer();
    let texto = new TextDecoder('utf-8').decode(buf);
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
    setArchivo({ nombre: f.name, texto });
  };
  const correr = (simular: boolean) => iniciar(async () => {
    if (!archivo) return;
    setMsg(null);
    const r = await importarAccion(tipo, archivo.texto, actualizar, simular);
    if (r.error) { setMsg(r.error); setRes(null); return; }
    setRes(r.resultado!);
  });
  const descargarPlantilla = () => {
    const blob = new Blob(['﻿' + plantillas[tipo]], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plantilla-${tipo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const celda = { padding: '4px 8px', borderBottom: '1px solid #d3e6de', fontSize: 14, textAlign: 'left' as const };

  return (
    <>
      <div style={tarjeta}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {(Object.keys(TITULOS) as TipoImportacion[]).map((t) => (
            <button key={t} type="button" style={t === tipo ? boton : botonSecundario} onClick={() => { setTipo(t); setRes(null); setMsg(null); }}>{TITULOS[t]}</button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: '#5c6d66' }}>{AYUDA[tipo]}</p>
        <p style={{ fontSize: 13, color: '#5c6d66' }}>Sirve un archivo CSV (en Excel: Archivo → Guardar como → CSV). El separador (coma o punto y coma) se detecta solo. Máximo 3000 filas.</p>
        <button type="button" style={botonSecundario} onClick={descargarPlantilla}>Descargar plantilla de {TITULOS[tipo].toLowerCase()}</button>
      </div>
      <div style={tarjeta}>
        {msg && <div style={estiloError}>{msg}</div>}
        <label style={etiqueta}>Archivo CSV
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => leer(e.target.files?.[0])} style={{ display: 'block', marginTop: 6 }} />
        </label>
        <label style={{ fontSize: 14, display: 'block', margin: '8px 0' }}>
          <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} /> Si ya existe (mismo {tipo === 'productos' ? 'código o nombre' : 'CUIT o nombre'}), actualizar sus datos. Si no, se omite.
        </label>
        <p style={{ fontSize: 12, color: '#5c6d66' }}>Al actualizar solo se cambian las columnas que traen dato: una celda vacía no borra lo que ya estaba cargado. El saldo y el stock inicial solo se cargan en los registros nuevos.</p>
        <button type="button" style={botonSecundario} disabled={!archivo || pend} onClick={() => correr(true)}>{pend ? 'Revisando…' : 'Revisar sin importar'}</button>{' '}
        <button type="button" style={boton} disabled={!archivo || pend} onClick={() => correr(false)}>{pend ? 'Importando…' : 'Importar'}</button>
        {archivo && <span style={{ marginLeft: 10, fontSize: 13, color: '#5c6d66' }}>{archivo.nombre}</span>}
      </div>
      {res && (
        <div style={tarjeta}>
          <div style={res.simulacion ? { ...aviso, background: '#fff4cc', color: '#8a6d00' } : aviso}>
            {res.simulacion ? 'Vista previa: todavía no se guardó nada. ' : 'Importación terminada. '}
            {res.total} filas · {res.creados} {res.simulacion ? 'se crearían' : 'creados'} · {res.actualizados} {res.simulacion ? 'se actualizarían' : 'actualizados'} · {res.omitidos} omitidos (ya existían) · {res.erroresTotales} con error
          </div>
          {res.errores.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={celda}>Fila</th><th style={celda}>Problema</th></tr></thead>
              <tbody>{res.errores.map((e, i) => (<tr key={i}><td style={celda}>{e.fila}</td><td style={celda}>{e.mensaje}</td></tr>))}</tbody>
            </table>
          )}
          {res.erroresTotales > res.errores.length && <p style={{ fontSize: 13, color: '#5c6d66' }}>Se muestran los primeros {res.errores.length} errores de {res.erroresTotales}.</p>}
          {res.simulacion && res.erroresTotales > 0 && <p style={{ fontSize: 13 }}>Las filas con error se saltan al importar; las demás se cargan igual. Podés corregir el archivo y volver a revisarlo.</p>}
        </div>
      )}
    </>
  );
}
