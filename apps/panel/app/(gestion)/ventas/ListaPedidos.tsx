import Link from 'next/link';
import { boton, tarjeta } from '../../../lib/estilos.ts';
import type { FilaPedido } from '../../../lib/ventasAbiertas.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import DescartarAbierta from './DescartarAbierta.tsx';

const fechaEntrega = (iso: string) => iso.split('-').reverse().join('/');

/** Pedidos de clientes pendientes de entrega. Con `sinCliente` se oculta el nombre (ficha del cliente). */
export default function ListaPedidos({ pedidos, sinCliente = false }: { pedidos: FilaPedido[]; sinCliente?: boolean }) {
  if (pedidos.length === 0) return null;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return (
    <div style={{ ...tarjeta, borderColor: '#9fd0f0', background: '#f3f9fe' }}>
      <b>Pedidos pendientes de entrega ({pedidos.length})</b>
      <div style={{ fontSize: 12, color: '#5c6d66', marginBottom: 6 }}>No mueven stock ni caja hasta que los pasás a venta.</div>
      {pedidos.map((p) => {
        const vencido = p.entrega !== null && p.entrega < hoy;
        return (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #d6e8f6' }}>
            <span style={{ flex: '1 1 240px' }}>
              {!sinCliente && <><Link href={`/clientes/${p.clienteId}`} style={{ color: '#1c9764' }}><b>{p.cliente}</b></Link> · </>}
              {p.renglones} ítem{p.renglones === 1 ? '' : 's'} · {formatearPesos(aCentavos(p.total))}
              <div style={{ fontSize: 12, color: vencido ? '#b4571a' : '#5c6d66' }}>
                {p.entrega ? `Entrega ${fechaEntrega(p.entrega)}${vencido ? ' (vencida)' : ''}` : 'Sin fecha de entrega'}{p.nota ? ` · ${p.nota}` : ''}
              </div>
              <details style={{ fontSize: 12, color: '#5c6d66' }}><summary style={{ cursor: 'pointer' }}>Ver productos</summary>{p.items.map((i, n) => <div key={n}>{i}</div>)}</details>
            </span>
            <Link href={`/ventas/nueva?abierta=${p.id}`} style={{ ...boton, textDecoration: 'none' }}>Pasar a venta / editar</Link>
            <DescartarAbierta id={p.id} pedido />
          </div>
        );
      })}
    </div>
  );
}
