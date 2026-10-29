import { notFound } from 'next/navigation';
import { listarCategorias, movimientosDe, obtenerCliente } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import CuentaCorriente from '../../CuentaCorriente.tsx';
import FormularioPersona from '../../FormularioPersona.tsx';

export const dynamic = 'force-dynamic';

export default async function FichaCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [c, cats, movs] = await Promise.all([obtenerCliente(s, id), listarCategorias(s), movimientosDe(s, { cliente: id })]);
  if (!c) notFound();
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{c.nombre}</h1>
      <CuentaCorriente
        tipo="cliente" id={c.id} saldo={formatearPesos(aCentavos(c.saldo))} puedeOperar={!c.esConsumidorFinal}
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, importe: formatearPesos(aCentavos(m.importe)), concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '' }))}
      />
      <FormularioPersona
        tipo="cliente" categorias={cats.filter((x) => x.activa || x.id === c.categoriaId)}
        inicial={{ id: c.id, nombre: c.nombre, telefono: c.telefono ?? '', email: c.email ?? '', domicilio: c.domicilio ?? '', localidad: c.localidad ?? '', cuit: c.cuit ?? '', condicionIva: c.condicionIva, categoriaId: c.categoriaId ?? '', contacto: '', categoria: '', activo: c.activo, esConsumidorFinal: c.esConsumidorFinal }}
      />
    </main>
  );
}
