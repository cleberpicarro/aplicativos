import pg from 'pg';

// DATE chega como texto 'AAAA-MM-DD' (sem conversão de fuso); BIGINT como número.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export type Pool = pg.Pool;
export type Db = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export async function tx<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await db.query(sql, params);
  return r.rows[0] as T | undefined;
}

export async function many<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
