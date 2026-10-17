import { config } from '../src/config.js';
import { createPool } from '../src/lib/db.js';
import { migrate } from '../src/lib/migrate.js';

const pool = createPool(config.databaseUrl);
await migrate(pool, console.log);
console.log('Banco atualizado.');
await pool.end();
