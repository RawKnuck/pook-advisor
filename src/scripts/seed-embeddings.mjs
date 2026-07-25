import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// Read .env file manually to get database and API config
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
        console.warn(`Rate limit hit (429). Retrying in ${delay}ms... (Attempts left: ${retries - 1})`);
      } else {
        const errText = await response.text();
        console.warn(`API Error status ${response.status}: ${errText}. Retrying in ${delay}ms...`);
      }
    } catch (err) {
      console.warn(`Fetch failure: ${err.message}. Retrying in ${delay}ms...`);
    }

    retries--;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw new Error("Failed to retrieve embedding after all retries.");
}

async function seed() {
  const essaysPath = path.resolve('src/data/essays.json');
  if (!fs.existsSync(essaysPath)) {
    console.error("essays.json does not exist.");
    process.exit(1);
  }

  const essays = JSON.parse(fs.readFileSync(essaysPath, 'utf8'));
  console.log(`Loaded ${essays.length} essays from JSON file.`);

  const client = await pool.connect();
  try {
    for (let i = 0; i < essays.length; i++) {
      const essay = essays[i];
      console.log(`[${i + 1}/${essays.length}] Embedding "${essay.title}"...`);

      // Combine title and content for a complete semantic vector
      const textToEmbed = `${essay.title}\n\n${essay.content}`;
      const vector = await getEmbeddingWithRetry(textToEmbed);

      const vectorStr = '[' + vector.join(',') + ']';
      await client.query(
        'INSERT INTO essays (title, url, content, embedding) VALUES ($1, $2, $3, $4::vector) ON CONFLICT (title) DO UPDATE SET url = $2, content = $3, embedding = $4::vector',
        [essay.title, essay.url, essay.content, vectorStr]
      );

      // Throttling delay to avoid hitting Google's rate limits
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log("Seeding completed successfully!");
  } catch (err) {
    console.error("Seeding failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
