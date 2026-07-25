import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

const versionRes = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
console.log('pgvector version:', versionRes.rows[0]?.extversion ?? 'not installed');

// Check what dimension the existing essays table embedding is
const colRes = await client.query(`
  SELECT atttypmod FROM pg_attribute
  JOIN pg_class ON pg_attribute.attrelid = pg_class.oid
  WHERE pg_class.relname = 'essays' AND pg_attribute.attname = 'embedding'
`);
console.log('essays.embedding atttypmod:', colRes.rows[0]?.atttypmod);

client.release();
await pool.end();
