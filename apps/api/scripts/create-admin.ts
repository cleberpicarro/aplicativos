/**
 * Cria o primeiro administrador e imprime o link para definir a senha.
 * Uso: npm run admin:create -- "Nome Completo" email@empresa.com.br
 */
import { config } from '../src/config.js';
import { createPool, tx } from '../src/lib/db.js';
import { migrate } from '../src/lib/migrate.js';
import { createUser } from '../src/services/admin.js';

const [name, email] = process.argv.slice(2);
if (!name || !email) {
  console.error('Uso: npm run admin:create -- "Nome Completo" email@empresa.com.br');
  process.exit(1);
}
const pool = createPool(config.databaseUrl);
await migrate(pool);
const { token } = await tx(pool, (db) => createUser(db, { name, email, level: null, isAdmin: true }));
console.log(`Administrador criado. Defina a senha em:\n${config.appUrl}/#/definir-senha?token=${token}`);
await pool.end();
