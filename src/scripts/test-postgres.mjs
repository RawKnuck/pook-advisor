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
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      process.env[key] = value;
    }
  });
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

console.log("Testing connection string parsing...");
try {
  const pool = new Pool({ connectionString });
  console.log("Connecting to PostgreSQL...");
  const client = await pool.connect();
  console.log("Connection successful!");
  const res = await client.query('SELECT NOW()');
  console.log("Database Query result:", res.rows[0]);
  client.release();
  await pool.end();
} catch (err) {
  console.error("PostgreSQL Connection Failed:", err);
}
