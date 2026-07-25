import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not defined.');
}

let pool: Pool;

// ponytail: reuse pg connection pool across hot reloads in development
if (process.env.NODE_ENV === 'production') {
  pool = new Pool({ connectionString });
} else {
  const globalWithPg = global as typeof globalThis & {
    pgPool?: Pool;
  };
  if (!globalWithPg.pgPool) {
    globalWithPg.pgPool = new Pool({ connectionString });
  }
  pool = globalWithPg.pgPool;
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client:', err);
});

export async function query(text: string, params?: unknown[]) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error(`Database query execution failed. Query: ${text}`, err);
    throw err;
  }
}
