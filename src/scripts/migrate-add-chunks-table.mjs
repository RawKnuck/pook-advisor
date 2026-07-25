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
  console.log('Enabling pgvector extension (if not already enabled)...');
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');

  console.log('Creating essay_chunks table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS essay_chunks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      essay_title TEXT NOT NULL,
      essay_url   TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content     TEXT NOT NULL,
      embedding   vector(3072),
      UNIQUE (essay_title, chunk_index)
    )
  `);

  // ponytail: skipping explicit vector index — Supabase pgvector 0.8.2 caps both IVFFlat and HNSW
  // at 2000 dims; gemini-embedding-2 is 3072. Sequential scan is fine for ~500 chunks.
  // Upgrade path: use halfvec(3072) type + hnsw once Supabase upgrades to pgvector >= 0.8.0 with
  // higher-dim support, or reduce to 768-dim embeddings via text-embedding-004 model.
  console.log('Skipping vector index (Supabase dim cap). Sequential scan used for now.');


  console.log('Migration complete.');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
