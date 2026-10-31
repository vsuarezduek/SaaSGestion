import { notFound } from 'next/navigation';
import { listarCajas } from '../../../../lib/cajas.ts';
import { listarCategorias, movimientosDe, obtenerCliente } from '../../../../lib/personas.ts';
import { listarMediosDePago } from '../../../../lib/ventas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import Link from 'next/link';
import { listarAbiertasDeCliente, listarPedidos } from '../../../../lib/ventasAbiertas.ts';
import { boton, tarjeta } from '../../../../lib/estilos.ts';
import ListaPedidos from '../../ventas/ListaPedidos.tsx';
import CuentaCorriente from '../../CuentaCorriente.tsx';
import FormularioPersona from '../../FormularioPersona.tsx';

export const dynamic = 'force-dynamic';

export default async function FichaCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await sesionObligatoria();
  const [c, cats, movs, mediosTodos, cajas, pedidos, ventasAbiertas] = await Promise.all([obtenerCliente(s, id), listarCategorias(s), movimientosDe(s, { cliente: id }), listarMediosDePago(s), listarCajas(s), listarPedidos(s, id), listarAbiertasDeCliente(s, id)]);
  if (!c) notFound();
  // Solo medios activos con al menos una caja abierta que esta persona pueda ver.
  const abiertas = new Map(cajas.filter((k) => k.abierta).map((k) => [k.id, k.nombre]));
  const medios = mediosTodos.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, cajas: m.cajaIds.filter((k) => abiertas.has(k)).map((k) => ({ id: k, nombre: abiertas.get(k)! })) })).filter((m) => m.cajas.length > 0);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>{c.nombre}</h1>
      <ListaPedidos pedidos={pedidos} sinCliente />
      {ventasAbiertas.length > 0 && (
        <div style={{ ...tarjeta, borderColor: '#f0c36b', background: '#fffaf0' }}>
          <b>Ventas abiertas ({ventasAbiertas.length})</b>
          {ventasAbiertas.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
              <span>{a.renglones} ítem{a.renglones === 1 ? '' : 's'} · {formatearPesos(aCentavos(a.total))}</span>
              <Link href={`/ventas/nueva?abierta=${a.id}`} style={{ ...boton, textDecoration: 'none' }}>Continuar</Link>
            </div>
          ))}
        </div>
      )}
      <CuentaCorriente
        tipo="cliente" id={c.id} saldo={formatearPesos(aCentavos(c.saldo))} saldoAFavor={c.saldo.startsWith('-') ? c.saldo.slice(1) : null} puedeOperar={!c.esConsumidorFinal} medios={medios}
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, importe: formatearPesos(aCentavos(m.importe)), importeCrudo: m.importe.replace('-', ''), concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '', saldo: formatearPesos(aCentavos(m.saldo)), ventaId: m.ventaId, reciboId: m.reciboId, devolucionId: m.devolucionId }))}
      />
      <FormularioPersona
        tipo="cliente" categorias={cats.filter((x) => x.activa || x.id === c.categoriaId)}
        inicial={{ id: c.id, nombre: c.nombre, telefono: c.telefono ?? '', email: c.email ?? '', domicilio: c.domicilio ?? '', localidad: c.localidad ?? '', cuit: c.cuit ?? '', condicionIva: c.condicionIva, categoriaId: c.categoriaId ?? '', contacto: '', categoria: '', activo: c.activo, esConsumidorFinal: c.esConsumidorFinal }}
      />
    </main>
  );
}
