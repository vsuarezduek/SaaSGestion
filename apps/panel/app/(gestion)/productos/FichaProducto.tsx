'use client';
import { useState, useTransition, type ComponentProps, type ReactNode } from 'react';
import { botonSecundario as base, error as estiloError } from '../../../lib/estilos.ts';
import FormularioProducto from './FormularioProducto.tsx';
import { archivarProductoAccion, eliminarProductoAccion, marcarParaPedirAccion } from './acciones.ts';

const botonSecundario = { ...base, fontSize: 14, fontFamily: 'inherit' } as const;

interface Props {
  /** Datos del producto en modo lectura (nombre, código, proveedor, rubro, etiquetas), armados en el servidor. */
  cabecera: ReactNode;
  /** Tarjetas de stock, costo, precios y unidades vendidas. */
  numeros: ReactNode;
  formulario: Omit<ComponentProps<typeof FormularioProducto>, 'onTerminar'>;
  /** null si el producto no se compra (no se puede marcar para pedir). */
  marcado: boolean | null;
}

/**
 * La parte de arriba de la ficha del producto como el prototipo: el resumen con «Marcar para pedir», «Modificar»
 * y «Eliminar». «Modificar» cambia el resumen y las tarjetas por el formulario, con la barra fija Guardar / Cancelar.
 */
export default function FichaProducto({ cabecera, numeros, formulario, marcado }: Props) {
  const [editando, setEditando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pend, iniciar] = useTransition();
  const { id, nombre, activo } = formulario.inicial;
  if (editando) return <FormularioProducto {...formulario} onTerminar={() => setEditando(false)} />;
  return (
    <>
      <div style={{ background: '#fff', border: '1px solid #d3e6de', borderRadius: 12, padding: 16, marginBottom: 14 }}>
        {cabecera}
        {msg && <div style={{ ...estiloError, marginTop: 8 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {marcado !== null && activo && (
            <button type="button" style={botonSecundario} disabled={pend} onClick={() => iniciar(async () => { setMsg(null); const r = await marcarParaPedirAccion(id!, !marcado); if (r.error) setMsg(r.error); })}>
              {marcado ? 'Quitar de pedidos' : 'Marcar para pedir'}
            </button>
          )}
          <button type="button" style={botonSecundario} disabled={pend} onClick={() => setEditando(true)}>Modificar</button>
          {!activo && (
            <button type="button" style={botonSecundario} disabled={pend} onClick={() => iniciar(async () => { await archivarProductoAccion(id!, true); })}>Restaurar</button>
          )}
          <button type="button" style={{ ...botonSecundario, color: '#b4571a' }} disabled={pend}
            onClick={() => {
              if (!window.confirm(`¿Eliminar «${nombre}»? No se puede deshacer.`)) return;
              iniciar(async () => { setMsg(null); const r = await eliminarProductoAccion(id!); if (r?.error) setMsg(r.error); });
            }}>
            Eliminar
          </button>
        </div>
      </div>
      {numeros}
    </>
  );
}
