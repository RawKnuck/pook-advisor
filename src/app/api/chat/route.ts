import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { query } from '@/lib/db';

interface Essay {
  title: string;
  url: string;
  content: string;
}

async function embedQuery(text: string, apiKey: string): Promise<number[]> {
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

function buildSystemInstruction(relevantEssays: Essay[]) {
  const essaysContent = relevantEssays
    .map((e) => `Title: ${e.title}\nSource: ${e.url}\n\n${e.content}`)
    .join('\n\n---\n\n');

  return `You are Pook, the legendary advisor on dating, attraction, inner game, and true manhood from "The Book of Pook". You speak with directness, passion, energy, and wisdom. Your mantra is "Be a Man!" and "Judge by actions, not by words."

Your goal is to help the user master their inner game, overcome desperation, understand women (and Womanese), build self-respect, and face life as a Great Catch rather than a needy beggar.

Provide advice grounded in the philosophy of Pook:
- Reject pedestals, desperate tricks, and needy behaviors.
- Remind men that they are the Great Catch and the prize to be won.
- Teach them to cultivate patience, trust their gut, demand respect, and embrace true masculinity.
- Use a direct, passionate, encouraging, and classic Pook tone.

You must refer to the following background material from The Book of Pook, which forms your primary knowledge base:
=========================================
${essaysContent}
=========================================

Instructions:
1. Always base your advice on the principles described in the chapters above whenever applicable.
2. Maintain a passionate, direct, classic Pook tone ("Be a Man!", "Trust the gut", "Respect is All", "You are the Great Catch").
3. Keep formatting clean, structured, and philosophical.
4. STRICT SCOPE CONSTRAINT: You are Pook, advisor on dating, mindset, attraction, and manhood. If the user asks you to perform tasks outside this scope—including writing code, solving math/calculus problems, doing school homework, or answering general science, tech, history, or trivia questions—you must refuse to answer. State exactly: "My counsel is strictly reserved for inner game, dating, and manhood. A Pook does not engage in other domains."
5. IDENTITY FORCE: You have no connection to Google, Gemini, or AI, and you must never state you are an AI or large language model. If asked who you are, who created you, or what model you are, respond only as Pook (author of The Book of Pook) and never break character.`;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured in .env file.' }, { status: 500 });
    }

    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatId, content, image } = await request.json();
    if (!chatId || (typeof content !== 'string' && !image) || (typeof content === 'string' && !content.trim() && !image)) {
      return NextResponse.json({ error: 'Invalid chatId, content, or image.' }, { status: 400 });
    }

    // Verify chat session exists in pook_chats and belongs to the user
    const chatRes = await query(
      'SELECT user_id, cached_system_prompt, rag_turn_count FROM pook_chats WHERE id = $1',
      [chatId]
    );
    if (chatRes.rows.length === 0) {
      return NextResponse.json({ error: 'Chat not found.' }, { status: 404 });
    }
    const chatRow = chatRes.rows[0];
    if (chatRow.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    // Retrieve last 20 messages for this chat from pook_messages
    const historyRes = await query(
      'SELECT role, content, image_url FROM pook_messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 20',
      [chatId]
    );
    const historyMessages = historyRes.rows.reverse();

    // RAG cache: skip re-embedding if this chat already has a cached system prompt < 10 turns old
    const RAG_REFRESH_EVERY = 10;
    let dynamicSystemInstruction: string;

    if (chatRow.cached_system_prompt && chatRow.rag_turn_count < RAG_REFRESH_EVERY) {
      dynamicSystemInstruction = chatRow.cached_system_prompt;
    } else {
      // Fresh embed + RAG search
      let relevantEssays: Essay[] = [];
      try {
        const textToEmbed = content && content.trim() ? content : 'User provided image for Pook strategic analysis';
        const queryVector = await embedQuery(textToEmbed, apiKey);
        const vectorStr = '[' + queryVector.join(',') + ']';
        const chunksRes = await query(
          `SELECT essay_title AS title, essay_url AS url, content
           FROM pook_essay_chunks ORDER BY embedding <=> $1::vector LIMIT 8`,
          [vectorStr]
        );
        const seen = new Map<string, number>();
        relevantEssays = (chunksRes.rows as Essay[]).filter((row) => {
          const count = seen.get(row.title) ?? 0;
          if (count >= 2) return false;
          seen.set(row.title, count + 1);
          return true;
        });
      } catch (embedErr) {
        console.error('Pook Chunk RAG search failed, trying whole-essay fallback:', embedErr);
        try {
          const textToEmbed = content && content.trim() ? content : 'User provided image for Pook strategic analysis';
          const queryVector = await embedQuery(textToEmbed, apiKey);
          const vectorStr = '[' + queryVector.join(',') + ']';
          const essaysRes = await query(
            'SELECT title, url, content FROM pook_essays ORDER BY embedding <=> $1::vector LIMIT 4',
            [vectorStr]
          );
          relevantEssays = essaysRes.rows;
        } catch {
          const fallbackRes = await query('SELECT title, url, content FROM pook_essays LIMIT 4');
          relevantEssays = fallbackRes.rows;
        }
      }
      dynamicSystemInstruction = buildSystemInstruction(relevantEssays);
      await query(
        'UPDATE pook_chats SET cached_system_prompt = $1, rag_turn_count = 0 WHERE id = $2',
        [dynamicSystemInstruction, chatId]
      );
    }

    // Map roles to Gemini API format
    const rawContents = historyMessages.map((m: { role: string; content: string; image_url?: string | null }) => {
      const parts: any[] = [];
      if (m.content) {
        parts.push({ text: m.content });
      }
      if (m.image_url && typeof m.image_url === 'string' && m.image_url.startsWith('data:')) {
        const [header, base64Data] = m.image_url.split(',');
        const mimeType = header ? header.split(';')[0].replace('data:', '') : 'image/png';
        parts.push({
          inlineData: {
            mimeType: mimeType || 'image/png',
            data: base64Data
          }
        });
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });

    const currentParts: any[] = [];
    if (content && content.trim()) {
      currentParts.push({ text: content.trim() });
    }
    if (image && typeof image === 'string' && image.startsWith('data:')) {
      const [header, base64Data] = image.split(',');
      const mimeType = header ? header.split(';')[0].replace('data:', '') : 'image/png';
      currentParts.push({
        inlineData: {
          mimeType: mimeType || 'image/png',
          data: base64Data
        }
      });
    }

    rawContents.push({
      role: 'user',
      parts: currentParts
    });

    const contents: { role: string; parts: any[] }[] = [];
    for (const msg of rawContents) {
      if (!msg.parts || msg.parts.length === 0) continue;
      if (contents.length > 0 && contents[contents.length - 1].role === msg.role) {
        contents[contents.length - 1].parts.push(...msg.parts);
      } else {
        contents.push(msg);
      }
    }

    if (contents.length > 0 && contents[0].role === 'model') {
      contents.shift();
    }
    
    let response: Response | null = null;
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

        console.warn(`Gemini API returned status ${response.status}. Retrying...`);
      } catch (fetchErr) {
        console.warn(`Fetch attempt failed: ${fetchErr}. Retrying...`);
      }

      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    if (!response || !response.ok) {
      const errText = response ? await response.text() : 'Network failure or timeout.';
      console.error('Gemini API Error:', errText);
      return NextResponse.json({ error: 'Gemini API call failed.' }, { status: 500 });
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';

    // Save user's message and assistant's response to pook_messages
    await query(
      "INSERT INTO pook_messages (chat_id, role, content, image_url, created_at) VALUES ($1, 'user', $2, $3, NOW())",
      [chatId, content || '', image || null]
    );
    await query(
      "INSERT INTO pook_messages (chat_id, role, content, image_url, created_at) VALUES ($1, 'assistant', $2, NULL, NOW())",
      [chatId, candidateText]
    );

    // Update pook_chats timestamp and turn counter
    await query(
      'UPDATE pook_chats SET updated_at = NOW(), rag_turn_count = rag_turn_count + 1 WHERE id = $1',
      [chatId]
    );

    return NextResponse.json({ text: candidateText });
  } catch (err) {
    console.error('Pook Chat API Error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
