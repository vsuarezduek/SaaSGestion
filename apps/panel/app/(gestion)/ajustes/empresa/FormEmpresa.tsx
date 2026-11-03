'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { boton, botonSecundario, campo, error as estiloError, etiqueta, tarjeta } from '../../../../lib/estilos.ts';
import { guardarEmpresaAccion, quitarLogoAccion, subirLogoAccion } from './acciones.ts';

export interface DatosForm { nombre: string; razonSocial: string; cuit: string; condicionIva: string; domicilio: string; localidad: string; telefono: string; email: string; web: string; color: string }

export default function FormEmpresa({ inicial, tieneLogo }: { inicial: DatosForm; tieneLogo: boolean }) {
  const router = useRouter();
  const [d, setD] = useState(inicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pend, iniciar] = useTransition();
  const campoTexto = (k: keyof DatosForm, titulo: string, max = 120) => (
    <label style={etiqueta}>{titulo}<input style={campo} value={d[k]} maxLength={max} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></label>
  );
  const guardar = () => iniciar(async () => { setMsg(null); setOk(false); const r = await guardarEmpresaAccion(d); if (r.error) setMsg(r.error); else { setOk(true); router.refresh(); } });
  const subir = (f: FormData) => iniciar(async () => { setMsg(null); const r = await subirLogoAccion(f); if (r.error) setMsg(r.error); else router.refresh(); });
  const quitar = () => iniciar(async () => { setMsg(null); const r = await quitarLogoAccion(); if (r.error) setMsg(r.error); else router.refresh(); });
  return (
    <>
      {msg && <div style={estiloError}>{msg}</div>}
      <div style={tarjeta}>
        <b>Logo</b>
        <div style={{ margin: '8px 0' }}>{tieneLogo ? <img src={`/empresa/logo?${Date.now()}`} alt="Logo" style={{ maxHeight: 90, maxWidth: '100%' }} /> : <span style={{ color: '#5c6d66' }}>Sin logo</span>}</div>
        <form action={subir} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" name="logo" accept="image/png,image/jpeg" />
          <button style={botonSecundario} disabled={pend}>Subir (PNG o JPG, hasta 300 KB)</button>
          {tieneLogo && <button type="button" style={botonSecundario} disabled={pend} onClick={quitar}>Quitar</button>}
        </form>
      </div>
      <div style={tarjeta}>
        {ok && <div style={{ background: '#d9f1f2', color: '#1b5f63', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>Guardado.</div>}
        {campoTexto('nombre', 'Nombre del comercio')}
        {campoTexto('razonSocial', 'Razón social')}
        {campoTexto('cuit', 'CUIT', 13)}
        {campoTexto('condicionIva', 'Condición frente al IVA', 40)}
        {campoTexto('domicilio', 'Domicilio', 160)}
        {campoTexto('localidad', 'Localidad', 80)}
        {campoTexto('telefono', 'Teléfono', 40)}
        {campoTexto('email', 'Mail')}
        {campoTexto('web', 'Sitio web')}
        <label style={etiqueta}>Color de la marca <input type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} style={{ verticalAlign: 'middle' }} /> {d.color}</label>
        <button type="button" style={boton} disabled={pend} onClick={guardar}>Guardar</button>
      </div>
    </>
  );
}
