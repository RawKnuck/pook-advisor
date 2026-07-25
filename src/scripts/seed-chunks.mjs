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
const apiKey = process.env.GEMINI_API_KEY;

if (!connectionString || !apiKey) {
  console.error('DATABASE_URL or GEMINI_API_KEY is not defined in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString });

// Split text into overlapping word-based chunks
// ponytail: word-count chunking, no tokenizer needed — ceiling: ~10% boundary error vs token split
function chunkText(text, maxWords = 300, overlapWords = 40) {
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
    i += maxWords - overlapWords;
    if (i + overlapWords >= words.length) break; // last chunk already included
  }
  // Always include a final chunk for the tail if not already captured
  const lastStart = Math.max(0, words.length - maxWords);
  if (chunks.length === 0 || lastStart > (chunks.length - 1) * (maxWords - overlapWords)) {
    chunks.push(words.slice(lastStart).join(' '));
  }
  return chunks.filter(c => c.trim().length > 0);
}

async function getEmbeddingWithRetry(text, retries = 5, delay = 2000) {
  while (retries > 0) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { parts: [{ text }] } })
        }
      );
      if (response.ok) {
        const data = await response.json();
        return data.embedding?.values;
      }
      if (response.status === 429) {
        console.warn(`Rate limit hit (429). Retrying in ${delay}ms... (${retries - 1} left)`);
      } else {
        const errText = await response.text();
        console.warn(`API Error ${response.status}: ${errText}. Retrying in ${delay}ms...`);
      }
    } catch (err) {
      console.warn(`Fetch failure: ${err.message}. Retrying in ${delay}ms...`);
    }
    retries--;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error('Failed to retrieve embedding after all retries.');
}

async function seed() {
  const essaysPath = path.resolve('src/data/essays.json');
  if (!fs.existsSync(essaysPath)) {
    console.error('essays.json does not exist. Run scrape.mjs first.');
    process.exit(1);
  }

  const essays = JSON.parse(fs.readFileSync(essaysPath, 'utf8'));
  console.log(`Loaded ${essays.length} essays. Chunking and embedding...`);

  const client = await pool.connect();
  let totalChunks = 0;
  let skipped = 0;

  try {
    for (let i = 0; i < essays.length; i++) {
      const essay = essays[i];
      const chunks = chunkText(`${essay.title}\n\n${essay.content}`);
      console.log(`[${i + 1}/${essays.length}] "${essay.title}" → ${chunks.length} chunks`);

      for (let ci = 0; ci < chunks.length; ci++) {
        try {
          const vector = await getEmbeddingWithRetry(chunks[ci]);
          const vectorStr = '[' + vector.join(',') + ']';
          await client.query(
            `INSERT INTO essay_chunks (essay_title, essay_url, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5::vector)
             ON CONFLICT (essay_title, chunk_index) DO UPDATE
               SET content = $4, embedding = $5::vector`,
            [essay.title, essay.url, ci, chunks[ci], vectorStr]
          );
          totalChunks++;
          // Throttle to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1200));
        } catch (err) {
          console.error(`  Chunk ${ci} of "${essay.title}" failed, skipping:`, err.message);
          skipped++;
        }
      }
    }
    console.log(`\nSeeding complete. ${totalChunks} chunks inserted, ${skipped} skipped.`);
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
