import { Pool, type PoolClient } from 'pg';
const globalForPg = globalThis as unknown as { clinicPool?: Pool };
export const pool = globalForPg.clinicPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== 'production') globalForPg.clinicPool = pool;
export type DbClient = PoolClient;
export async function transaction<T>(fn: (client: PoolClient)=>Promise<T>):Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value=await fn(client); await client.query('COMMIT'); return value; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
