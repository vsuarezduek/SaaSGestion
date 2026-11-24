import Link from 'next/link';
import { notFound } from 'next/navigation';
import { boton, botonSecundario, tarjeta } from '../../../../lib/estilos.ts';
import { listarProductos } from '../../../../lib/catalogo.ts';
import { listarCajas } from '../../../../lib/cajas.ts';
import { perfilDe } from '../../../../lib/informes.ts';
import { categoriasDeProveedor, movimientosDe, obtenerProveedor } from '../../../../lib/personas.ts';
import { sesionObligatoria } from '../../../../lib/sesion.ts';
import { aCentavos, formatearCantidad, formatearPesos } from '../../../../../../packages/dominio/src/index.ts';
import { fechaCorta, TarjetasPerfil, TopProductos } from '../../PerfilPersona.tsx';
import CuentaCorriente from '../../CuentaCorriente.tsx';
import FichaPersona from '../../FichaPersona.tsx';
import { Seccion } from '../../Orden.tsx';

export const dynamic = 'force-dynamic';

const CONDICION: Record<string, string> = { consumidor_final: 'Consumidor final', responsable_inscripto: 'Responsable inscripto', monotributo: 'Monotributo', exento: 'Exento' };
const igual = { fontSize: 14, fontFamily: 'inherit', textDecoration: 'none' } as const;
const enlace = { ...botonSecundario, ...igual };
const gris = { fontSize: 12, color: '#5c6d66' } as const;

/**
 * Ficha del proveedor en el orden del perfil del prototipo: datos (lectura, «Editar» en el lugar) con los botones,
 * tarjetas de totales, «Productos del proveedor» desplegable, historial de la cuenta corriente y top 5 productos.
 */
export default async function FichaProveedor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ abrir?: string }> }) {
  const { id } = await params;
  const { abrir } = await searchParams;
  const s = await sesionObligatoria();
  const [p, cats, movs, cajas, prods, perfil] = await Promise.all([obtenerProveedor(s, id), categoriasDeProveedor(s), movimientosDe(s, { proveedor: id }), listarCajas(s), listarProductos(s, { proveedorId: id, limite: 200 }), perfilDe(s, 'proveedor', id)]);
  if (!p || !perfil) notFound();
  const saldo = aCentavos(p.saldo);
  const saldoTexto = formatearPesos(saldo) + (Math.abs(saldo) < 100 ? '' : saldo > 0 ? ' (le debemos)' : ' (a nuestro favor)');
  const cajasPago = cajas.filter((k) => k.abierta).map((k) => ({ id: k.id, nombre: k.nombre }));
  const grupos = [
    { titulo: 'Datos del proveedor', filas: [['Contacto', p.contacto ?? ''], ['Teléfono', p.telefono ?? ''], ['Mail', p.email ?? ''], ['Domicilio', p.domicilio ?? ''], ['Localidad', p.localidad ?? ''], ['CUIT', p.cuit ?? ''], ['Condición de IVA', p.condicionIva ? CONDICION[p.condicionIva] ?? p.condicionIva : '']] as [string, string][] },
    { titulo: 'Clasificación', filas: [['Categoría', p.categoria ?? '']] as [string, string][] },
    { titulo: 'Actividad', filas: [['Proveedor desde', fechaCorta(perfil.desde)], ['Última compra nuestra', fechaCorta(perfil.ultima)], ['Compras realizadas', String(perfil.operaciones)], ['Saldo con el proveedor', saldoTexto]] as [string, string][] },
  ];
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Link href="/proveedores" style={{ color: '#1c9764', fontSize: 13 }}>← Proveedores</Link>
      <div style={{ marginTop: 10 }} />
      <FichaPersona
        tipo="proveedor" categoriasProveedor={cats} grupos={grupos}
        persona={{ id: p.id, nombre: p.nombre, telefono: p.telefono ?? '', email: p.email ?? '', domicilio: p.domicilio ?? '', localidad: p.localidad ?? '', cuit: p.cuit ?? '', condicionIva: p.condicionIva ?? '', categoriaId: '', contacto: p.contacto ?? '', categoria: p.categoria ?? '', activo: p.activo, esConsumidorFinal: false }}
      >
        {p.activo && <Link href={`/compras/nueva?proveedor=${p.id}`} style={{ ...boton, ...igual }}>+ Compra</Link>}
        {p.activo && <Link href={`/compras/nota-de-credito/nueva?proveedor=${p.id}`} style={enlace}>+ Nota de crédito</Link>}
        {cajasPago.length > 0 && <Link href={`/proveedores/${p.id}?abrir=orden#cc`} style={enlace}>+ Orden de pago</Link>}
        {p.activo && <Link href={`/compras/nueva?proveedor=${p.id}&faltantes=proveedor`} style={enlace}>Cargar compra de faltantes</Link>}
      </FichaPersona>
      <TarjetasPerfil tipo="proveedor" p={perfil} saldo={formatearPesos(saldo)} debe={saldo > 0} />
      <Seccion titulo={`Productos del proveedor (${prods.total})`} estilo={tarjeta}>
        {prods.filas.map((f) => (
          <Link key={f.id} href={`/productos/${f.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 4px', borderBottom: '1px solid #d3e6de', fontSize: 14, color: 'inherit', textDecoration: 'none' }}>
            <span style={{ flex: 1 }}><span style={{ color: '#1c9764' }}>{f.nombre}</span><div style={gris}>stock {formatearCantidad(f.stock)} · mín. {formatearCantidad(f.stockMinimo)}</div></span>
            <b>{formatearPesos(aCentavos(f.costo))}</b>
          </Link>
        ))}
        {prods.filas.length === 0 && <div style={gris}>Ningún producto tiene a este proveedor. Elegilo en la ficha de cada producto.</div>}
        <div style={{ marginTop: 8, fontSize: 13 }}><Link href={`/productos?proveedor=${p.id}&listado=1`} style={{ color: '#1c9764' }}>Ver en Productos</Link> · <Link href="/ajustes/masiva" style={{ color: '#1c9764' }}>Modificar costos masivamente</Link></div>
      </Seccion>
      <CuentaCorriente
        key={abrir ?? ''}
        tipo="proveedor" id={p.id} saldo={formatearPesos(saldo)} puedeOperar abrir={abrir === 'orden' ? 'orden' : null}
        filas={movs.map((m) => ({ id: m.id, fecha: m.creadoEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), tipo: m.tipo, importe: formatearPesos(aCentavos(m.importe)), importeCrudo: m.importe.replace('-', ''), concepto: m.concepto ?? '', revertido: m.revertido, usuario: m.usuario ?? '', saldo: formatearPesos(aCentavos(m.saldo)), ventaId: m.ventaId, reciboId: m.reciboId, devolucionId: m.devolucionId, compraId: m.compraId, ordenPagoId: m.ordenPagoId, notaCreditoCompraId: m.notaCreditoCompraId }))}
        cajasPago={cajasPago}
      />
      <TopProductos tipo="proveedor" p={perfil} />
    </main>
  );
}
