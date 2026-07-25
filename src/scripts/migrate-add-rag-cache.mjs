import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// Read .env file manually
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  console.log('Adding RAG cache columns to chats table...');
  await client.query(`
    ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS cached_system_prompt TEXT,
      ADD COLUMN IF NOT EXISTS rag_turn_count INTEGER DEFAULT 0
  `);
  console.log('Done. Columns added (or already existed).');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
