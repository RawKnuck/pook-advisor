import pg from 'pg';

const { Pool } = pg;

/**
 * ponytail: simple db truncation for E2E tests to reset state
 * Cleans users, chats, and messages tables.
 */
export async function cleanDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('TRUNCATE TABLE users, chats, messages CASCADE');
  } finally {
    client.release();
    await pool.end();
  }
}
