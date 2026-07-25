import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

// Read .env file manually to get database path
const envPath = path.resolve(process.cwd(), '.env');
let dbPathStr = 'src/data/database.db';
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
      if (key === 'DATABASE_URL') {
        dbPathStr = value;
      }
    }
  });
}

const dbPath = path.resolve(process.cwd(), dbPathStr);

if (!fs.existsSync(dbPath)) {
  console.error(`Database file does not exist at: ${dbPath}. Run setup first.`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const queryText = process.argv.slice(2).join(' ').trim();

if (!queryText) {
  console.log(`
=========================================
Sovereign Advisor - SQLite Query Console
=========================================

To query the database, run:
  node src/scripts/query-db.mjs "YOUR SQL QUERY HERE"

Example Queries:
  node src/scripts/query-db.mjs "SELECT * FROM users;"
  node src/scripts/query-db.mjs "SELECT id, title, updated_at FROM chats;"
  node src/scripts/query-db.mjs "SELECT role, content FROM messages;"

Current Database Tables:
  - users
  - chats
  - messages
=========================================
  `);
  process.exit(0);
}

try {
  const stmt = db.prepare(queryText);
  // Determine if it is a SELECT query
  const isSelect = queryText.toLowerCase().startsWith('select') || queryText.toLowerCase().startsWith('pragma');

  if (isSelect) {
    const rows = stmt.all();
    if (rows.length === 0) {
      console.log('Query returned 0 rows.');
    } else {
      console.table(rows);
    }
  } else {
    const result = stmt.run();
    console.log(`Query executed successfully. Affected rows: ${result.changes}`);
  }
} catch (err) {
  console.error('SQL Error:', err.message);
}
