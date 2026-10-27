// Aplica packages/db/migraciones en orden, una vez cada una (mismo criterio que scripts/db-migrar.sh).
// Una migración ya aplicada NO se edita: si su contenido cambió, falla.
// En producción NO corre solo: se aplica a mano y con cuidado.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vercel = process.env.VERCEL_ENV;
if (vercel === 'production') {
  console.log('Producción: las migraciones no se aplican automáticamente. Se omite.');
  process.exit(0);
}
const nombre = vercel ? 'DATABASE_URL_STAGING' : process.env.DATABASE_URL_LOCAL ? 'DATABASE_URL_LOCAL' : 'DATABASE_URL_STAGING';
const url = process.env[nombre];
if (!url) {
  if (vercel) {
    console.error(`ERROR: falta la variable ${nombre} en este entorno de Vercel.`);
    process.exit(1);
  }
  console.log(`Sin ${nombre}: no se aplican migraciones.`);
  process.exit(0);
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db/migraciones');
const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const cliente = new pg.Client({ connectionString: url });
await cliente.connect();
try {
  await cliente.query(`CREATE TABLE IF NOT EXISTS _migraciones (
    nombre text PRIMARY KEY, sha256 text NOT NULL, aplicada_en timestamptz NOT NULL DEFAULT now())`);
  for (const f of archivos) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const previo = await cliente.query('SELECT sha256 FROM _migraciones WHERE nombre = $1', [f]);
    if (previo.rowCount) {
      if (previo.rows[0].sha256 !== hash) {
        throw new Error(`La migración ${f} ya fue aplicada y su contenido cambió. Crear una migración nueva en vez de editarla.`);
      }
      console.log(`= ${f} (ya aplicada)`);
      continue;
    }
    console.log(`+ ${f}`);
    try {
      await cliente.query(`BEGIN;\n${sql}\nINSERT INTO _migraciones (nombre, sha256) VALUES ('${f}', '${hash}');\nCOMMIT;`);
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  }
  console.log('Migraciones al día.');
} finally {
  await cliente.end();
}
