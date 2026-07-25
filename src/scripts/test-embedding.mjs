import fs from 'fs';
import path from 'path';

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

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not defined in .env");
  process.exit(1);
}

async function testEmbedding() {
  const text = "Never outshine the master.";
  console.log(`Generating embedding for: "${text}"`);
  
  // Test gemini-embedding-001
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

    console.log("Status Code:", response.status);
    if (!response.ok) {
      const errText = await response.text();
      console.error("Embedding API Error:", errText);
    } else {
      const data = await response.json();
      console.log("Vector dimensions:", data.embedding?.values?.length);
      console.log("Sample values (first 5):", data.embedding?.values?.slice(0, 5));
    }
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

testEmbedding();
