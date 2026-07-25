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

function chunkText(text, maxWords = 300, overlapWords = 40) {
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
    i += maxWords - overlapWords;
    if (i + overlapWords >= words.length) break;
  }
  const lastStart = Math.max(0, words.length - maxWords);
  if (chunks.length === 0 || lastStart > (chunks.length - 1) * (maxWords - overlapWords)) {
    chunks.push(words.slice(lastStart).join(' '));
  }
  return chunks.filter(c => c.trim().length > 0);
}

async function getEmbeddingWithRetry(text, retries = 5, delay = 1500) {
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

async function seedPook() {
  const chaptersPath = `C:\\Users\\91620\\.gemini\\antigravity\\brain\\74fbce68-797b-4e03-b28a-a37027e66e8b\\scratch\\pook_chapters.json`;
  if (!fs.existsSync(chaptersPath)) {
    console.error('pook_chapters.json missing.');
    process.exit(1);
  }

  const chapters = JSON.parse(fs.readFileSync(chaptersPath, 'utf8'));
  console.log(`Loaded ${chapters.length} chapters. Starting embedding generation & database insertion...`);

  const client = await pool.connect();
  let totalEssays = 0;
  let totalChunks = 0;

  try {
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      console.log(`[${i + 1}/${chapters.length}] Processing "${chapter.title}"...`);

      // Generate essay-level embedding
      const essayVector = await getEmbeddingWithRetry(`${chapter.title}\n\n${chapter.content.slice(0, 1500)}`);
      const essayVectorStr = '[' + essayVector.join(',') + ']';

      // Insert or update into pook_essays
      const essayRes = await client.query(
        `INSERT INTO pook_essays (title, url, content, embedding)
         VALUES ($1, $2, $3, $4::vector)
         RETURNING id`,
        [chapter.title, chapter.url, chapter.content, essayVectorStr]
      );
      const essayId = essayRes.rows[0].id;
      totalEssays++;

      // Chunk and insert into pook_essay_chunks
      const chunks = chunkText(`${chapter.title}\n\n${chapter.content}`);
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunkVector = await getEmbeddingWithRetry(chunks[ci]);
        const chunkVectorStr = '[' + chunkVector.join(',') + ']';
        await client.query(
          `INSERT INTO pook_essay_chunks (essay_id, essay_title, essay_url, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [essayId, chapter.title, chapter.url, ci, chunks[ci], chunkVectorStr]
        );
        totalChunks++;
        // 500ms delay to keep within Gemini API rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`Successfully seeded ${totalEssays} essays and ${totalChunks} chunks into Supabase!`);
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedPook();
