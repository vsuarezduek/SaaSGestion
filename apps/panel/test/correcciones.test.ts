// Correcciones de uso: mensajes claros al cerrar una venta sin medio de pago o caja, y cliente directo para una venta nueva.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crearComercio, ErrorDeUsuario, type SesionActiva } from '../lib/auth.ts';
import { cerrarPool, conTenant } from '../lib/db.ts';
import { guardarCliente } from '../lib/personas.ts';
import { clienteParaVenta, cerrarVenta } from '../lib/ventas.ts';

const sufijo = Date.now().toString(36);
let A: SesionActiva;
let B: SesionActiva;

async function sesionDe(slug: string, email: string): Promise<SesionActiva> {
  const tenantId = await crearComercio({ slug, nombre: slug, email, nombreAdmin: 'Admin', contrasena: 'clave-larga-123' });
  const u = await conTenant(tenantId, (c) => c.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1'));
  return { usuarioId: u.rows[0]!.id, tenantId, comercio: slug, nombre: 'Admin', email, rol: 'administrador', permisos: [] };
}
before(async () => {
  A = await sesionDe(`cor-a-${sufijo}`, 'a@ejemplo.test');
  B = await sesionDe(`cor-b-${sufijo}`, 'b@ejemplo.test');
});
after(async () => { await cerrarPool(); });

const venta = (cobro: unknown, clienteId: string) => ({
  clave: randomUUID(), clienteId, comprobante: 'remito', nroComprobante: '', listaId: null, fecha: '', descuentoTotalPct: 0, nota: '',
  renglones: [{ productoId: null, descripcion: 'Ítem libre', cantidad: '1', precio: '100', descuentoPct: 0, iva: 21 }], cobro,
});

test('cerrar una venta sin elegir medio de pago o caja explica qué falta (no «Invalid uuid»)', async () => {
  const cliente = await guardarCliente(A, null, { nombre: 'Laura', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: null });
  await assert.rejects(() => cerrarVenta(A, venta({ tipo: 'caja', medioPagoId: '', cajaId: '' }, cliente)), (e: unknown) => e instanceof ErrorDeUsuario && e.message === 'Elegí el medio de pago');
  await assert.rejects(() => cerrarVenta(A, venta({ tipo: 'caja', medioPagoId: randomUUID(), cajaId: '' }, cliente)), (e: unknown) => e instanceof ErrorDeUsuario && e.message === 'Elegí la caja');
  await assert.rejects(() => cerrarVenta(A, venta({ tipo: 'cuenta_corriente' }, '')), (e: unknown) => e instanceof ErrorDeUsuario && e.message === 'Elegí el cliente');
});

test('clienteParaVenta devuelve al cliente elegido y no cruza comercios', async () => {
  const id = await guardarCliente(A, null, { nombre: 'Marta', telefono: '', email: '', domicilio: '', localidad: '', cuit: '', condicionIva: 'consumidor_final', categoriaId: null });
  const c = await clienteParaVenta(A, id);
  assert.equal(c?.nombre, 'Marta');
  assert.equal(c?.esConsumidorFinal, false);
  assert.equal(await clienteParaVenta(B, id), null);
  assert.equal(await clienteParaVenta(A, 'no-es-un-id'), null);
});
