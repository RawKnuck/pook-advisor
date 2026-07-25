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
const apiKey = process.env.GEMINI_API_KEY;

if (!connectionString || !apiKey) {
  console.error("DATABASE_URL or GEMINI_API_KEY is not defined in .env");
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function getEmbeddingWithRetry(text, retries = 5, delay = 2000) {
  while (retries > 0) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: {
              parts: [{ text }]
            }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.embedding?.values;
      }

      if (response.status === 429) {
        console.warn(`Rate limit hit (429). Retrying in ${delay}ms...`);
      } else {
        const errText = await response.text();
        console.warn(`API Error ${response.status}: ${errText}. Retrying...`);
      }
    } catch (err) {
      console.warn(`Fetch failure: ${err.message}. Retrying...`);
    }

    retries--;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error("Failed to retrieve embedding after all retries.");
}

const qaPrompts = [
  "My boss is taking credit for my code. How do I handle this?",
  "disagreement with my superior at work",
  "salary negotiation strategies for an offer",
  "how to get promoted fast inside a big company",
  "dealing with coworkers who are talking behind my back",
  "what is the surrender tactic in conflict?",
  "never outshine the master in a business meeting",
  "how do I charm a client to close a deal?",
  "how do I behave in a politically correct office?",
  "my boss is micromanaging every single task I do"
];

async function runQA() {
  console.log("Checking if essays table is seeded...");
  const countRes = await pool.query("SELECT COUNT(*) FROM essays");
  console.log(`Currently seeded essays in database: ${countRes.rows[0].count}`);

  console.log("\nStarting 10-prompt semantic RAG verification...");
  for (let i = 0; i < qaPrompts.length; i++) {
    const prompt = qaPrompts[i];
    console.log(`\n=========================================`);
    console.log(`QA Query [${i + 1}/10]: "${prompt}"`);
    console.log(`=========================================`);

    try {
      const vector = await getEmbeddingWithRetry(prompt);
      const vectorStr = '[' + vector.join(',') + ']';

      // Perform cosine similarity calculation using pgvector operator <=>
      const res = await pool.query(
        'SELECT title, url, 1 - (embedding <=> $1::vector) AS similarity FROM essays ORDER BY embedding <=> $1::vector LIMIT 3',
        [vectorStr]
      );

      res.rows.forEach((row, idx) => {
        console.log(`  Match [${idx + 1}]: ${row.title} (Similarity: ${(row.similarity * 100).toFixed(2)}%)`);
      });
    } catch (err) {
      console.error(`QA Query ${i + 1} failed:`, err.message || err);
    }

    // Delay between queries to protect rate limits
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  await pool.end();
}

runQA().catch(console.error);
