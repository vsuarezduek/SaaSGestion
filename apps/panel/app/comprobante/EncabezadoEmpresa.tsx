import type { Empresa } from '../../lib/empresa.ts';

/** Encabezado de los documentos para imprimir: logo, nombre y datos de la empresa, con una línea del color de la marca. */
export default function EncabezadoEmpresa({ empresa, altoLogo = 64, hijos }: { empresa: Empresa; altoLogo?: number; hijos?: React.ReactNode }) {
  const fiscal = [empresa.razonSocial, empresa.cuit && `CUIT ${empresa.cuit.replace(/^(\d{2})(\d{8})(\d)$/, '$1-$2-$3')}`, empresa.condicionIva].filter(Boolean).join(' · ');
  const contacto = [empresa.domicilio, empresa.localidad, empresa.telefono, empresa.email, empresa.web].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: `3px solid ${empresa.color}`, paddingBottom: 10, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {empresa.tieneLogo && <img src="/empresa/logo" alt="" style={{ maxHeight: altoLogo, maxWidth: 160 }} />}
        <div>
          <div style={{ fontSize: 24, fontFamily: 'Georgia, serif' }}><b>{empresa.nombre}</b></div>
          {fiscal && <div style={{ fontSize: 12 }}>{fiscal}</div>}
          {contacto && <div style={{ fontSize: 12, color: '#444' }}>{contacto}</div>}
        </div>
      </div>
      {hijos}
    </div>
  );
}
