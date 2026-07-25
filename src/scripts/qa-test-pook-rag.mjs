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

const connectionString = process.env.DATABASE_URL;
const apiKey = process.env.GEMINI_API_KEY;

if (!connectionString || !apiKey) {
  console.error('DATABASE_URL or GEMINI_API_KEY missing.');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function embedQuery(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } })
    }
  );
  if (!response.ok) throw new Error(`Embedding failed: ${response.status}`);
  const data = await response.json();
  return data.embedding.values;
}

const testPrompts = [
  "What is Womanese and how do I understand what women actually mean?",
  "How do I deal with feeling shy or nervous around attractive women?",
  "Why is pedestaling women a disaster for a man?",
  "What is the secret of the jerk according to Pook?",
  "How do I stop being desperate and become the Great Catch?",
  "What is Pook's advice for skinny guys?",
  "Why should a man judge by actions and not by words?",
  "What does Pook say about patience and confidence?"
];

async function testRAG() {
  const client = await pool.connect();
  console.log("=== Testing Pook Advisor Vector RAG Search ===");

  try {
    for (let i = 0; i < testPrompts.length; i++) {
      const prompt = testPrompts[i];
      console.log(`\nQuery ${i + 1}: "${prompt}"`);
      const vec = await embedQuery(prompt);
      const vecStr = '[' + vec.join(',') + ']';

      const res = await client.query(
        `SELECT essay_title AS title, essay_url AS url, content
         FROM pook_essay_chunks ORDER BY embedding <=> $1::vector LIMIT 3`,
        [vecStr]
      );

      res.rows.forEach((r, idx) => {
        console.log(`  [Match ${idx + 1}] "${r.title}" (Snippet: ${r.content.substring(0, 100)}...)`);
      });
    }
    console.log("\n✅ RAG Vector retrieval test passed cleanly!");
  } catch (err) {
    console.error("RAG Test Failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

testRAG();
