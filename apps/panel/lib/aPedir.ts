// «Marcar para pedir»: un producto marcado a mano aparece en la mercadería a pedir aunque no esté bajo el mínimo.
// La marca se quita sola cuando se carga una compra que lo incluye.
import { auditar, ErrorDeUsuario, type SesionActiva } from './auth.ts';
import { conTenant } from './db.ts';
import { exigir } from './permisos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function estaMarcadoParaPedir(s: SesionActiva, productoId: string): Promise<boolean> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) return false;
  return conTenant(s.tenantId, async (c) => (await c.query<{ a_pedir: boolean }>('SELECT a_pedir FROM productos WHERE id = $1', [productoId])).rows[0]?.a_pedir ?? false);
}

export async function marcarParaPedir(s: SesionActiva, productoId: string, marcado: boolean): Promise<void> {
  exigir(s, 'productos');
  if (!UUID.test(productoId)) throw new ErrorDeUsuario('El producto no existe');
  await conTenant(s.tenantId, async (c) => {
    const r = await c.query<{ a_pedir: boolean; comprable: boolean }>('SELECT a_pedir, comprable FROM productos WHERE id = $1 AND activo FOR UPDATE', [productoId]);
    const p = r.rows[0];
    if (!p) throw new ErrorDeUsuario('El producto no existe o está archivado');
    if (marcado && !p.comprable) throw new ErrorDeUsuario('Este producto no se compra');
    if (p.a_pedir === marcado) return;
    await c.query('UPDATE productos SET a_pedir = $2 WHERE id = $1', [productoId, marcado]);
    await auditar(c, s.usuarioId, marcado ? 'marcar_pedir' : 'desmarcar_pedir', 'producto', undefined, { entidadId: productoId });
  });
}
