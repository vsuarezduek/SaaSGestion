'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { boton, botonSecundario, campo, tarjeta } from '../../../lib/estilos.ts';
import type { Estado, FilaProveedor } from '../../../lib/personas.ts';
import { aCentavos, formatearPesos } from '../../../../../packages/dominio/src/index.ts';
import ModalNuevoProveedor from '../ModalNuevoProveedor.tsx';
import { Desplegable, Th, useOrden } from '../Orden.tsx';
import { buscarProveedoresAccion, listadoProveedoresAccion } from '../personas.ts';

interface Ultimo { proveedorId: string; nombre: string; compraId: string; detalle: string; total: string }
interface Props {
  categorias: string[];
  ultimos: Ultimo[];
  puedeDescargar: boolean;
  puedeInformes: boolean;
}

const fila = { display: 'flex', gap: 8, alignItems: 'center', padding: '7px 4px', borderBottom: '1px solid #d3e6de', fontSize: 14 } as const;
const gris = { fontSize: 12, color: '#5c6d66' } as const;
const celda = { padding: '6px 8px', borderBottom: '1px solid #d3e6de', textAlign: 'left' as const, fontSize: 14 };
const enlace = { color: '#1c9764', textDecoration: 'none' } as const;
const igual = { fontSize: 14, fontFamily: 'inherit' } as const; // botones y enlaces del mismo tamaño
const saldoTexto = (s: string) => formatearPesos(aCentavos(s));

export default function PantallaProveedores({ categorias, ultimos, puedeDescargar, puedeInformes }: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FilaProveedor[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [modal, setModal] = useState<string | null>(null); // nombre propuesto, o null si está cerrada
  const [abrirUltimos, setAbrirUltimos] = useState(true);
  const [abrirListado, setAbrirListado] = useState(false);
  const [estado, setEstado] = useState<Estado>('activos');
  const [listado, setListado] = useState<{ filas: FilaProveedor[]; total: number } | null>(null);
  const turno = useRef(0);

  useEffect(() => {
    const mio = ++turno.current;
    if (q.trim() === '') { setRes(null); setBuscando(false); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await buscarProveedoresAccion(q);
      if (mio === turno.current) { setRes(r); setBuscando(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // El listado completo se pide recién cuando se despliega (o cambia el filtro).
  useEffect(() => {
    if (!abrirListado) return;
    let vigente = true;
    setListado(null);
    listadoProveedoresAccion(estado).then((r) => { if (vigente) setListado(r); });
    return () => { vigente = false; };
  }, [abrirListado, estado]);

  const { ordenadas, orden, alternar } = useOrden(listado?.filas ?? [], {
    nombre: (f) => f.nombre, categoria: (f) => f.categoria, contacto: (f) => f.contacto, telefono: (f) => f.telefono, saldo: (f) => Number(f.saldo),
  }, { col: 'nombre', dir: 'asc' });

  return (
    <>
      <div style={tarjeta}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, contacto, CUIT, teléfono o mail" style={{ ...campo, marginTop: 0 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 4px' }}>
          <button type="button" style={{ ...boton, ...igual }} onClick={() => setModal('')}>+ Nuevo</button>
          <button type="button" style={{ ...botonSecundario, ...igual }} onClick={() => { setAbrirListado((a) => !a); setQ(''); }}>{abrirListado ? 'Ocultar listado' : 'Ver listado completo'}</button>
          {puedeDescargar && <a href="/proveedores/csv" style={{ ...botonSecundario, ...igual, textDecoration: 'none' }}>Descargar lista</a>}
        </div>
        {q.trim() !== '' && (
          <div style={{ marginTop: 6 }}>
            {res === null || buscando ? <div style={gris}>Buscando…</div> : null}
            {res && res.length > 8 && <div style={gris}>{res.length === 40 ? 'Más de 40' : res.length} resultados</div>}
            {res?.map((c) => (
              <Link key={c.id} href={`/proveedores/${c.id}`} style={{ ...fila, ...enlace, color: 'inherit', opacity: c.activo ? 1 : 0.55 }}>
                <span style={{ flex: 1 }}><b style={{ color: '#1c9764' }}>{c.nombre}</b><div style={gris}>{[c.categoria, c.contacto, c.telefono].filter(Boolean).join(' · ') || 'Sin datos'}{c.activo ? '' : ' · archivado'}</div></span>
                {aCentavos(c.saldo) !== 0 && <span style={{ color: aCentavos(c.saldo) > 0 ? '#b4571a' : '#1b5f63', fontSize: 13 }}>{aCentavos(c.saldo) > 0 ? 'Le debemos ' : 'A favor nuestro '}{formatearPesos(Math.abs(aCentavos(c.saldo)))}</span>}
              </Link>
            ))}
            {res && res.length === 0 && !buscando && (
              <button type="button" onClick={() => setModal(q)} style={{ ...fila, width: '100%', background: '#f0f8f5', border: '1px dashed #1c9764', borderRadius: 8, cursor: 'pointer', color: '#1c9764', fontWeight: 600, marginTop: 4 }}>
                + Crear proveedor «{q.trim()}»
              </button>
            )}
          </div>
        )}
      </div>

      {q.trim() === '' && !abrirListado && (
        <Desplegable titulo="Últimos 10 con operaciones" abierto={abrirUltimos} onCambiar={setAbrirUltimos} estilo={tarjeta}>
          {ultimos.map((u) => (
            <div key={u.proveedorId} style={fila}>
              <Link href={`/proveedores/${u.proveedorId}`} style={{ ...enlace, flex: 1, fontWeight: 600 }}>{u.nombre}</Link>
              <Link href={`/compras/${u.compraId}`} style={{ ...enlace, color: '#5c6d66' }}>{u.detalle}</Link>
              <Link href={`/compras/${u.compraId}`} style={{ ...enlace, minWidth: 90, textAlign: 'right' }}>{u.total}</Link>
            </div>
          ))}
          {ultimos.length === 0 && <div style={gris}>Todavía no hay compras.</div>}
        </Desplegable>
      )}

      {abrirListado && (
        <Desplegable titulo={`Listado completo${listado ? ` (${listado.total})` : ''}`} abierto onCambiar={setAbrirListado} estilo={{ ...tarjeta, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={gris}>Mostrar</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)} style={{ ...campo, marginTop: 0, width: 'auto', padding: 6 }}>
              <option value="activos">Activos</option><option value="archivados">Archivados</option><option value="todos">Todos</option>
            </select>
            <span style={gris}>· Click en una columna para ordenar</span>
          </div>
          {listado === null ? <div style={gris}>Cargando…</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <Th col="nombre" orden={orden} alternar={alternar} estilo={celda}>Proveedor</Th>
                <Th col="categoria" orden={orden} alternar={alternar} estilo={celda}>Categoría</Th>
                <Th col="contacto" orden={orden} alternar={alternar} estilo={celda}>Contacto</Th>
                <Th col="telefono" orden={orden} alternar={alternar} estilo={celda}>Teléfono</Th>
                <Th col="saldo" orden={orden} alternar={alternar} estilo={{ ...celda, textAlign: 'right' }}>Saldo</Th>
                <th style={celda}></th>
              </tr></thead>
              <tbody>
                {ordenadas.map((f) => (
                  <tr key={f.id} style={{ opacity: f.activo ? 1 : 0.55 }}>
                    <td style={celda}><Link href={`/proveedores/${f.id}`} style={enlace}>{f.nombre}</Link></td>
                    <td style={celda}>{f.categoria ?? ''}</td><td style={celda}>{f.contacto ?? ''}</td><td style={celda}>{f.telefono ?? ''}</td>
                    <td style={{ ...celda, textAlign: 'right', color: aCentavos(f.saldo) > 0 ? '#b4571a' : undefined }}>{saldoTexto(f.saldo)}</td>
                    <td style={celda}><Link href={`/proveedores/${f.id}`} style={{ ...botonSecundario, textDecoration: 'none', padding: '4px 10px', fontSize: 13 }}>Editar</Link></td>
                  </tr>
                ))}
                {ordenadas.length === 0 && (<tr><td style={celda} colSpan={6}>No hay proveedores con ese filtro.</td></tr>)}
              </tbody>
            </table>
          )}
          {listado && listado.filas.length < listado.total && <p style={gris}>Mostrando {listado.filas.length} de {listado.total}. Usá el buscador para el resto.</p>}
        </Desplegable>
      )}

      {puedeInformes && (
        <div style={tarjeta}>
          <Link href="/estadisticas/personas?tipo=proveedor" style={{ ...enlace, fontWeight: 700 }}>Informes de proveedores →</Link>
          <div style={gris}>Lo comprado, cantidad de compras, saldo y última compra por proveedor, por período (también solo con saldo pendiente).</div>
        </div>
      )}

      {modal !== null && (
        <ModalNuevoProveedor
          nombreInicial={modal} categorias={categorias}
          onCerrar={() => setModal(null)}
          onCreado={(c) => { setModal(null); router.push(`/proveedores/${c.id}`); }}
        />
      )}
    </>
  );
}
