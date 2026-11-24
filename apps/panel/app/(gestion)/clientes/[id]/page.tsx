import { notFound } from 'next/navigation';
import { listarCajas } from '../../../../lib/cajas.ts';
import { listasDePrecios } from '../../../../lib/catalogo.ts';
import { perfilDe } from '../../../../lib/informes.ts';
import { listarCategorias, movimientosDe, obtenerCliente } from '../../../../lib/personas.ts';
import { listarMediosDePago } from '../../../../lib/ventas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import Link from 'next/link';
import { listarAbiertasDeCliente, listarPedidos } from '../../../../lib/ventasAbiertas.ts';
import { boton, botonSecundario, tarjeta } from '../../../../lib/estilos.ts';
import { fechaCorta, TarjetasPerfil, TopProductos } from '../../PerfilPersona.tsx';
import ListaPedidos from '../../ventas/ListaPedidos.tsx';
import CuentaCorriente from '../../CuentaCorriente.tsx';
import FichaPersona from '../../FichaPersona.tsx';

export const dynamic = 'force-dynamic';

const CONDICION: Record<string, string> = { consumidor_final: 'Consumidor final', responsable_inscripto: 'Responsable inscripto', monotributo: 'Monotributo', exento: 'Exento' };
const igual = { fontSize: 14, fontFamily: 'inherit', textDecoration: 'none' } as const;
const enlace = { ...botonSecundario, ...igual };

/**
 * Ficha del cliente en el orden del perfil del prototipo: datos (lectura, «Editar» en el lugar) con los botones,
 * pedidos, ventas abiertas, tarjetas de totales, historial de la cuenta corriente y top 5 productos.
 */
export default async function FichaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ abrir?: string }> }) {
  const { id } = await params;
  const { abrir } = await searchParams;
  const s = await sesionObligatoria();
  const [c, cats, movs, mediosTodos, cajas, pedidos, ventasAbiertas, perfil, listas] = await Promise.all([obtenerCliente(s, id), listarCategorias(s), movimientosDe(s, { cliente: id }), listarMediosDePago(s), listarCajas(s), listarPedidos(s, id), listarAbiertasDeCliente(s, id), perfilDe(s, 'cliente', id), listasDePrecios(s)]);
  if (!c || !perfil) notFound();
  // Solo medios activos con al menos una caja abierta que esta persona pueda ver.
  const abiertas = new Map(cajas.filter((k) => k.abierta).map((k) => [k.id, k.nombre]));
  const medios = mediosTodos.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, cajas: m.cajaIds.filter((k) => abiertas.has(k)).map((k) => ({ id: k, nombre: abiertas.get(k)! })) })).filter((m) => m.cajas.length > 0);
  const cat = cats.find((x) => x.id === c.categoriaId);
  const saldo = aCentavos(c.saldo);
  const saldoTexto = formatearPesos(saldo) + (Math.abs(saldo) < 100 ? '' : saldo > 0 ? ' (nos debe)' : ' (a su favor)');
  const saldoAFavor = c.saldo.startsWith('-') ? c.saldo.slice(1) : null;
  const grupos = [
    { titulo: 'Datos del cliente', filas: [['Teléfono', c.telefono ?? ''], ['Mail', c.email ?? ''], ['Domicilio', c.domicilio ?? ''], ['Localidad', c.localidad ?? ''], ['CUIT', c.cuit ?? ''], ['Condición de IVA', CONDICION[c.condicionIva] ?? c.condicionIva]] as [string, string][] },
    {
      titulo: 'Condiciones comerciales',
      filas: [
        ['Categoría', cat?.nombre ?? 'Sin categoría'],
        ['Lista de precios', (cat?.listaId && listas.find((l) => l.id === cat.listaId)?.nombre) || listas[0]?.nombre || ''],
        ['Descuento automático', cat?.descuento ? `${cat.descuento}% sobre cada venta` : 'Sin descuento'],
        ['Cuenta corriente', cat?.cuentaCorriente ? 'Habilitada' : 'No habilitada'],
        ['Vende a costo', cat?.ventaACosto ? 'Sí' : 'No'],
      ] as [string, string][],
    },
    { titulo: 'Actividad', filas: [['Cliente desde', fechaCorta(perfil.desde)], ['Última compra', fechaCorta(perfil.ultima)], ['Compras realizadas', String(perfil.operaciones)], ['Saldo de cuenta corriente', saldoTexto]] as [string, string][] },
  ];
  const puedeOperar = !c.esConsumidorFinal;
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Link href="/clientes" style={{ color: '#1c9764', fontSize: 13 }}>← Clientes</Link>
      <div style={{ marginTop: 10 }} />
      <FichaPersona
        tipo="cliente" categorias={cats.filter((x) => x.activa || x.id === c.categoriaId)} grupos={grupos}
        persona={{ id: c.id, nombre: c.nombre, telefono: c.telefono ?? '', email: c.email ?? '', domicilio: c.domicilio ?? '', localidad: c.localidad ?? '', cuit: c.cuit ?? '', condicionIva: c.condicionIva, categoriaId: c.categoriaId ?? '', contacto: '', categoria: '', activo: c.activo, esConsumidorFinal: c.esConsumidorFinal }}
      >
        {c.activo && <Link href={`/ventas/nueva?cliente=${c.id}`} style={{ ...boton, ...igual }}>+ Venta</Link>}
        {c.activo && <Link href={`/ventas/nota-de-credito/nueva?cliente=${c.id}`} style={enlace}>+ Nota de crédito</Link>}
        {puedeOperar && medios.length > 0 && <Link href={`/clientes/${c.id}?abrir=recibo#cc`} style={enlace}>+ Recibo de pago</Link>}
        {puedeOperar && medios.length > 0 && saldoAFavor && <Link href={`/clientes/${c.id}?abrir=devolucion#cc`} style={enlace}>+ Devolución de pago</Link>}
      </FichaPersona>
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
      <TarjetasPerfil tipo="cliente" p={perfil} saldo={formatearPesos(saldo)} debe={saldo > 0} />
      <CuentaCorriente
        key={abrir ?? ''}
        tipo="cliente" id={c.id} saldo={formatearPesos(saldo)} saldoAFavor={saldoAFavor} puedeOperar={puedeOperar} medios={medios}
        abrir={abrir === 'recibo' || abrir === 'devolucion' ? abrir : null}
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, importe: formatearPesos(aCentavos(m.importe)), importeCrudo: m.importe.replace('-', ''), concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '', saldo: formatearPesos(aCentavos(m.saldo)), ventaId: m.ventaId, reciboId: m.reciboId, devolucionId: m.devolucionId, compraId: null, ordenPagoId: null }))}
      />
      <TopProductos tipo="cliente" p={perfil} />
    </main>
  );
}
