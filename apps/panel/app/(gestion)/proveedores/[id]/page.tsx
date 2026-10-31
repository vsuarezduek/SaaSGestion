import Link from 'next/link';
import { notFound } from 'next/navigation';
import { boton } from '../../../../lib/estilos.ts';
import { listarCajas } from '../../../../lib/cajas.ts';
import { categoriasDeProveedor, movimientosDe, obtenerProveedor } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import CuentaCorriente from '../../CuentaCorriente.tsx';
import FormularioPersona from '../../FormularioPersona.tsx';

export const dynamic = 'force-dynamic';

export default async function FichaProveedor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [p, cats, movs, cajas] = await Promise.all([obtenerProveedor(s, id), categoriasDeProveedor(s), movimientosDe(s, { proveedor: id }), listarCajas(s)]);
  if (!p) notFound();
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: 'Georgia, serif' }}>{p.nombre}</h1>
        <Link href={`/compras/nueva?proveedor=${p.id}`} style={{ ...boton, textDecoration: 'none' }}>+ Compra</Link>
      </div>
      <CuentaCorriente
        tipo="proveedor" id={p.id} saldo={formatearPesos(aCentavos(p.saldo))} puedeOperar
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, importe: formatearPesos(aCentavos(m.importe)), importeCrudo: m.importe.replace('-', ''), concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '', saldo: formatearPesos(aCentavos(m.saldo)), ventaId: m.ventaId, reciboId: m.reciboId, devolucionId: m.devolucionId, compraId: m.compraId, ordenPagoId: m.ordenPagoId }))}
        cajasPago={cajas.filter((k) => k.abierta).map((k) => ({ id: k.id, nombre: k.nombre }))}
      />
      <FormularioPersona
        tipo="proveedor" categoriasProveedor={cats}
        inicial={{ id: p.id, nombre: p.nombre, telefono: p.telefono ?? '', email: p.email ?? '', domicilio: p.domicilio ?? '', localidad: p.localidad ?? '', cuit: p.cuit ?? '', condicionIva: p.condicionIva ?? '', categoriaId: '', contacto: p.contacto ?? '', categoria: p.categoria ?? '', activo: p.activo, esConsumidorFinal: false }}
      />
    </main>
  );
}
