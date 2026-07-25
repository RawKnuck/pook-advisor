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

async function embedQuery(text, apiKey) {
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

  if (!response.ok) {
    throw new Error(`Failed to generate query embedding: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

function buildSystemInstruction(relevantEssays) {
  const essaysContent = relevantEssays
    .map((e) => `Title: ${e.title}\nSource: ${e.url}\n\n${e.content}`)
    .join('\n\n---\n\n');
  return `You are a personal strategic advisor and mentor. You speak with the authority, realism, prudence, and pragmatism of Machiavelli (author of The Prince) and Robert Greene (author of The 48 Laws of Power). Help the user navigate workplace dynamics.

Provide advice that is realistic, direct, and free from naive idealism. Always prioritize prudence, self-preservation, and calculated strategy.

Refer to this background material of corporate politics essays:
=========================================
${essaysContent}
=========================================

Instructions:
1. Always base your advice on the principles described in the essays above.
2. Maintain a highly professional, serious, and classic tone.
3. Be concise, structured and to-the-point.`;
}

async function testPipeline() {
  const queryText = "My boss is micromanaging every single task I do. How do I handle this strategically?";
  console.log(`Asking chatbot: "${queryText}"\n`);

  try {
    console.log("1. Generating query embedding...");
    const queryVector = await embedQuery(queryText, apiKey);
    const vectorStr = '[' + queryVector.join(',') + ']';

    console.log("2. Querying Supabase PostgreSQL (pgvector) for relevant chunks...");
    const chunksRes = await pool.query(
      `SELECT essay_title AS title, essay_url AS url, content
       FROM essay_chunks ORDER BY embedding <=> $1::vector LIMIT 8`,
      [vectorStr]
    );

    const seen = new Map();
    const relevantEssays = chunksRes.rows.filter((row) => {
      const count = seen.get(row.title) ?? 0;
      if (count >= 2) return false;
      seen.set(row.title, count + 1);
      return true;
    });

    console.log("Found matches:");
    relevantEssays.forEach(e => console.log(` - ${e.title}`));

    console.log("\n3. Formulating System Instructions...");
    const systemInstruction = buildSystemInstruction(relevantEssays);

    console.log("4. Invoking Gemini API...");
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: queryText }] }],
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini Response Error:", errText);
    } else {
      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      console.log("\n=========================================");
      console.log("Sovereign Advisor Reply:");
      console.log("=========================================");
      console.log(text);
      console.log("=========================================");
    }
  } catch (err) {
    console.error("Pipeline test failed:", err);
  } finally {
    await pool.end();
  }
}

testPipeline();
