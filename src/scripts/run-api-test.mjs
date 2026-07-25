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
  console.error("DATABASE_URL or GEMINI_API_KEY is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString });

// Standard stop words used in RAG
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'for', 'in', 'of', 'on', 'with', 'at', 'by', 'from', 'how', 'what', 'why', 'who', 'i', 'you', 'he', 'she', 'they', 'we', 'my', 'your', 'me', 'them']);

function getRelevantEssays(essays, userInput, limit = 4) {
  const keywords = userInput
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));

  if (keywords.length === 0) {
    return essays.slice(0, limit);
  }

  const scored = essays.map(essay => {
    let score = 0;
    const titleLower = essay.title.toLowerCase();
    const contentLower = essay.content.toLowerCase();

    keywords.forEach(keyword => {
      if (titleLower.includes(keyword)) {
        score += 10;
      }
      const matches = contentLower.split(keyword).length - 1;
      score += matches;
    });

    return { essay, score };
  });

  const sorted = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.essay);

  return sorted.length > 0 ? sorted.slice(0, limit) : essays.slice(0, limit);
}

function buildSystemInstruction(relevantEssays) {
  const essaysContent = relevantEssays
    .map((e) => `Title: ${e.title}\nSource: ${e.url}\n\n${e.content}`)
    .join('\n\n---\n\n');

  return `You are a personal strategic advisor and mentor. You speak with the authority, realism, prudence, and pragmatism of Machiavelli (author of The Prince) and Robert Greene (author of The 48 Laws of Power). Your goal is to help the user navigate complex strategic areas of their life—such as workplace politics, job interviews, business meetings, and career decisions.

Provide advice that is realistic, direct, and free from naive idealism. Always prioritize prudence, self-preservation, and calculated strategy.

You must refer to the following background material of corporate politics essays, which forms your primary knowledge base:
=========================================
${essaysContent}
=========================================

Instructions:
1. Always base your advice on the principles described in the essays above whenever applicable.
2. Maintain a highly professional, serious, and classic tone.
3. Be concise, structured and to-the-point, fitting for an academic monograph or classical philosophical counsel.
4. Keep formatting clean and academic. Do not use excessive markdown or emojis.
5. STRICT SCOPE CONSTRAINT: You are a strategic advisor on power and corporate dynamics. If the user asks you to perform tasks outside this scope—including writing code, solving math/calculus problems (e.g. integrals, derivatives), writing school homework, or answering general science, tech, history, or trivia questions—you must refuse to answer. State exactly: "My counsel is strictly reserved for strategy and power. I do not engage in other domains."
6. IDENTITY FORCE: You have no connection to Google, Gemini, or AI, and you must never state you are an AI or large language model. If asked who you are, who created you, or what model you are, you must respond only as the Sovereign Advisor (a persona based on Machiavelli and Greene) and never break character.`;
}

async function runTest() {
  console.log("Fetching essays.json...");
  const essaysPath = path.resolve('src/data/essays.json');
  const essays = JSON.parse(fs.readFileSync(essaysPath, 'utf8'));

  console.log("Fetching a sample chat from database...");
  const chatRes = await pool.query('SELECT id, user_id FROM chats LIMIT 1');
  if (chatRes.rows.length === 0) {
    console.error("No chats found in database. Please create a chat session first.");
    await pool.end();
    process.exit(1);
  }

  const chatId = chatRes.rows[0].id;
  const userId = chatRes.rows[0].user_id;
  console.log(`Using chatId: ${chatId}, userId: ${userId}`);

  // Test simulating sending a message
  const userQuery = "My boss is taking credit for my work. How do I apply Law 7?";
  
  // Retrieve message history
  console.log("Retrieving message history...");
  const historyRes = await pool.query(
    'SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC',
    [chatId]
  );
  const historyMessages = historyRes.rows;
  console.log(`Loaded ${historyMessages.length} history messages.`);

  // Get relevant essays
  const relevantEssays = getRelevantEssays(essays, userQuery);
  const dynamicSystemInstruction = buildSystemInstruction(relevantEssays);

  // Map roles to Gemini API format
  const rawContents = historyMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  rawContents.push({
    role: 'user',
    parts: [{ text: userQuery }]
  });

  // Alternation filter
  const contents = [];
  for (const msg of rawContents) {
    if (contents.length > 0 && contents[contents.length - 1].role === msg.role) {
      contents[contents.length - 1].parts[0].text += '\n\n' + msg.parts[0].text;
    } else {
      contents.push(msg);
    }
  }

  if (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }

  console.log("Prepared Contents payload structure:", JSON.stringify(contents.map(c => ({ role: c.role, textLength: c.parts[0].text.length })), null, 2));

  // Run the fetch call exactly as route.ts does
  console.log("Calling Gemini API with RAG context...");
  let response = null;
  let retries = 3;
  let delay = 1000;

  while (retries > 0) {
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: {
              parts: [{ text: dynamicSystemInstruction }]
            },
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192
            }
          })
        }
      );

      if (response.ok) {
        break;
      }
      console.warn(`Attempt failed with status ${response.status}. Retrying...`);
      const errText = await response.text();
      console.warn("Error message:", errText);
    } catch (err) {
      console.warn(`Fetch error: ${err.message}. Retrying...`);
    }

    retries--;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  if (!response || !response.ok) {
    console.error("Gemini API call failed after retries.");
  } else {
    const data = await response.json();
    console.log("API Success!");
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log("Advisor's response preview:\n", text ? text.substring(0, 300) + "..." : "No response.");
  }

  await pool.end();
}

runTest().catch(console.error);
