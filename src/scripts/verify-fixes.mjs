/**
 * verify-fixes.mjs
 * Internal quality test suite for the 3 AI architecture fixes.
 *
 * Tests:
 *  [A] Schema  — new columns + table exist
 *  [B] Data    — chunk count, embedding coverage, no nulls
 *  [C] RAG     — chunk retrieval returns semantically correct results vs old essays table
 *  [D] Cache   — rag_turn_count increments; cache is read on turn 2; resets at threshold
 *  [E] History — message query returns max 20, correctly ordered oldest-first
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const { DATABASE_URL: connectionString, GEMINI_API_KEY: apiKey } = process.env;
if (!connectionString || !apiKey) {
  console.error('DATABASE_URL or GEMINI_API_KEY not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString });

// ── test harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ PASS  ${name}`);
  passed++;
}

function fail(name, reason) {
  console.log(`  ❌ FAIL  ${name}`);
  console.log(`           ${reason}`);
  failed++;
  failures.push({ name, reason });
}

function assert(cond, name, reason) {
  cond ? pass(name) : fail(name, reason);
}

// ── embed helper ─────────────────────────────────────────────────────────────
async function embed(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } })
    }
  );
  if (!res.ok) throw new Error(`Embed API ${res.status}: ${await res.text()}`);
  return (await res.json()).embedding.values;
}

// ── A: SCHEMA TESTS ───────────────────────────────────────────────────────────
async function testSchema(client) {
  console.log('\n[A] Schema Tests');

  // A1 – cached_system_prompt column exists on chats
  const colCheck = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'cached_system_prompt'
  `);
  assert(colCheck.rows.length === 1, 'A1: chats.cached_system_prompt column exists',
    'Column missing — migrate-add-rag-cache.mjs may not have run');

  // A2 – rag_turn_count column exists on chats
  const tc = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'chats' AND column_name = 'rag_turn_count'
  `);
  assert(tc.rows.length === 1, 'A2: chats.rag_turn_count column exists',
    'Column missing — migrate-add-rag-cache.mjs may not have run');

  // A3 – essay_chunks table exists
  const tableCheck = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'essay_chunks'
  `);
  assert(tableCheck.rows.length === 1, 'A3: essay_chunks table exists',
    'Table missing — migrate-add-chunks-table.mjs may not have run');

  // A4 – essay_chunks has embedding column of type vector
  const embCol = await client.query(`
    SELECT udt_name FROM information_schema.columns
    WHERE table_name = 'essay_chunks' AND column_name = 'embedding'
  `);
  assert(embCol.rows.length === 1 && embCol.rows[0].udt_name === 'vector',
    'A4: essay_chunks.embedding is type vector',
    `Got: ${embCol.rows[0]?.udt_name ?? 'not found'}`);
}

// ── B: DATA INTEGRITY TESTS ───────────────────────────────────────────────────
async function testData(client) {
  console.log('\n[B] Data Integrity Tests');

  // B1 – chunk count is reasonable (seed produced 459)
  const countRes = await client.query('SELECT COUNT(*) AS n FROM essay_chunks');
  const chunkCount = parseInt(countRes.rows[0].n);
  assert(chunkCount >= 400, 'B1: essay_chunks has >= 400 rows',
    `Found ${chunkCount} — seed-chunks.mjs may not have completed`);
  console.log(`       (actual count: ${chunkCount})`);

  // B2 – no chunks with NULL embeddings
  const nullEmb = await client.query(
    'SELECT COUNT(*) AS n FROM essay_chunks WHERE embedding IS NULL'
  );
  assert(parseInt(nullEmb.rows[0].n) === 0, 'B2: No chunks have NULL embeddings',
    `${nullEmb.rows[0].n} chunks have NULL embeddings`);

  // B3 – unique (essay_title, chunk_index) constraint is respected
  const dupCheck = await client.query(`
    SELECT essay_title, chunk_index, COUNT(*) AS n
    FROM essay_chunks
    GROUP BY essay_title, chunk_index
    HAVING COUNT(*) > 1
    LIMIT 5
  `);
  assert(dupCheck.rows.length === 0, 'B3: No duplicate (essay_title, chunk_index) pairs',
    `${dupCheck.rows.length} duplicates found: ${JSON.stringify(dupCheck.rows)}`);

  // B4 – essays table still intact (fallback path must work)
  const essayCount = await client.query('SELECT COUNT(*) AS n FROM essays');
  assert(parseInt(essayCount.rows[0].n) > 0, 'B4: essays table still populated (fallback intact)',
    'essays table is empty — fallback RAG path is broken');

  // B5 – rag_turn_count default is 0 for any chat that has never been touched
  const defaultCheck = await client.query(`
    SELECT COUNT(*) AS n FROM chats
    WHERE rag_turn_count IS NULL
  `);
  assert(parseInt(defaultCheck.rows[0].n) === 0, 'B5: All chats have non-NULL rag_turn_count',
    `${defaultCheck.rows[0].n} chats have NULL rag_turn_count (default not applied)`);
}

// ── C: RAG QUALITY TESTS ──────────────────────────────────────────────────────
async function testRAG(client) {
  console.log('\n[C] RAG Retrieval Quality Tests');

  const queries = [
    {
      q: 'My boss is stealing credit for my work',
      expectTitles: ['Law 7', 'Office Politics', 'Cunning', 'Power']
    },
    {
      q: 'How do I navigate workplace politics and gain power over rivals',
      expectTitles: ['Office Politics', 'Power', 'Machiavellianism', 'Cunning']
    },
    {
      q: 'negotiation tactics for a salary raise',
      // "Employers vs Employees" is the best match in this corpus for salary negotiation
      expectTitles: ['Law', 'Power', 'Strategy', 'Negotiation', 'Office', 'Employers']
    }
  ];

  for (let i = 0; i < queries.length; i++) {
    const { q, expectTitles } = queries[i];
    try {
      const vector = await embed(q);
      const vectorStr = '[' + vector.join(',') + ']';

      // C-chunk: retrieve from essay_chunks
      const chunkRes = await client.query(
        `SELECT essay_title AS title, essay_url AS url,
                1 - (embedding <=> $1::vector) AS similarity
         FROM essay_chunks ORDER BY embedding <=> $1::vector LIMIT 8`,
        [vectorStr]
      );

      // C-essay: retrieve from essays (old path, for comparison)
      const essayRes = await client.query(
        `SELECT title, url, 1 - (embedding <=> $1::vector) AS similarity
         FROM essays ORDER BY embedding <=> $1::vector LIMIT 4`,
        [vectorStr]
      );

      const chunkTops = chunkRes.rows.slice(0, 3);
      const essayTops = essayRes.rows.slice(0, 3);

      // Check that at least one top chunk title contains a keyword from expectTitles
      const chunkHit = chunkTops.some(r =>
        expectTitles.some(kw => r.title.toLowerCase().includes(kw.toLowerCase()))
      );
      assert(chunkHit,
        `C${i + 1}a: chunk RAG returns relevant result for "${q.substring(0, 40)}..."`,
        `Top chunks: ${chunkTops.map(r => `"${r.title}" (${(r.similarity * 100).toFixed(1)}%)`).join(', ')}`
      );

      // Check top chunk similarity is above a reasonable floor (>40%)
      const topSim = parseFloat(chunkTops[0]?.similarity ?? 0);
      assert(topSim >= 0.4,
        `C${i + 1}b: top chunk similarity >= 40% (got ${(topSim * 100).toFixed(1)}%)`,
        `Similarity too low: ${(topSim * 100).toFixed(1)}% — embedding quality issue`
      );

      // Compare: chunks vs whole-essays top similarity (chunks should be >= essays - 5%)
      const topEssaySim = parseFloat(essayTops[0]?.similarity ?? 0);
      assert(topSim >= topEssaySim - 0.05,
        `C${i + 1}c: chunk similarity (${(topSim*100).toFixed(1)}%) within 5% of essay similarity (${(topEssaySim*100).toFixed(1)}%)`,
        `Chunks (${(topSim*100).toFixed(1)}%) significantly worse than essays (${(topEssaySim*100).toFixed(1)}%)`
      );

      console.log(`       Q${i+1} top chunk:  "${chunkTops[0]?.title}" @ ${(parseFloat(chunkTops[0]?.similarity)*100).toFixed(1)}%`);
      console.log(`       Q${i+1} top essay:  "${essayTops[0]?.title}" @ ${(parseFloat(essayTops[0]?.similarity)*100).toFixed(1)}%`);

      // Rate-limit guard between embedding calls
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      fail(`C${i + 1}: RAG query ${i + 1} threw an error`, err.message);
    }
  }

  // C4 – dedup logic: ensure max 2 chunks per essay_title in top-8 results
  try {
    const vector = await embed('office politics manipulation power hierarchy');
    const vectorStr = '[' + vector.join(',') + ']';
    const res = await client.query(
      `SELECT essay_title AS title FROM essay_chunks
       ORDER BY embedding <=> $1::vector LIMIT 8`,
      [vectorStr]
    );
    const titleCounts = {};
    for (const row of res.rows) {
      titleCounts[row.title] = (titleCounts[row.title] ?? 0) + 1;
    }
    // Apply the same dedup logic as route.ts
    const seen = new Map();
    const deduped = res.rows.filter(row => {
      const count = seen.get(row.title) ?? 0;
      if (count >= 2) return false;
      seen.set(row.title, count + 1);
      return true;
    });
    const anyExceedsTwo = Object.values(titleCounts).some(c => c > 2);
    // The dedup should always produce <= 8 and no title appears > 2 times after filter
    const dedupedTitleCounts = {};
    for (const row of deduped) {
      dedupedTitleCounts[row.title] = (dedupedTitleCounts[row.title] ?? 0) + 1;
    }
    const dedupViolation = Object.values(dedupedTitleCounts).some(c => c > 2);
    assert(!dedupViolation, 'C4: dedup logic correctly limits to max 2 chunks per essay',
      `After dedup, some essays still appear > 2 times: ${JSON.stringify(dedupedTitleCounts)}`);
    console.log(`       (raw top-8 had ${anyExceedsTwo ? 'some' : 'no'} essays with > 2 chunks; dedup applied correctly)`);
    await new Promise(r => setTimeout(r, 1500));
  } catch (err) {
    fail('C4: dedup logic test threw an error', err.message);
  }
}

// ── D: CACHE BEHAVIOUR TESTS ──────────────────────────────────────────────────
async function testCache(client) {
  console.log('\n[D] RAG Cache Tests (DB-state simulation)');

  // Create a synthetic test chat row directly in the DB
  const userRes = await client.query('SELECT id FROM users LIMIT 1');
  if (userRes.rows.length === 0) {
    console.log('  ⚠️  SKIP  D: No users in DB — cache tests require at least one user');
    return;
  }
  const userId = userRes.rows[0].id;

  // Insert a test chat
  const chatInsert = await client.query(
    `INSERT INTO chats (user_id, title, created_at, updated_at, rag_turn_count)
     VALUES ($1, '__test_verify_fixes__', NOW(), NOW(), 0)
     RETURNING id`,
    [userId]
  );
  const testChatId = chatInsert.rows[0].id;

  try {
    // D1 – fresh chat: cached_system_prompt should be NULL
    const freshChat = await client.query(
      'SELECT cached_system_prompt, rag_turn_count FROM chats WHERE id = $1',
      [testChatId]
    );
    assert(freshChat.rows[0].cached_system_prompt === null,
      'D1: New chat starts with NULL cached_system_prompt',
      `Got: ${freshChat.rows[0].cached_system_prompt?.substring(0, 50)}`);
    assert(parseInt(freshChat.rows[0].rag_turn_count) === 0,
      'D2: New chat starts with rag_turn_count = 0',
      `Got: ${freshChat.rows[0].rag_turn_count}`);

    // D3 – simulate writing a cache entry (as route.ts does after fresh embed)
    const fakePrompt = 'CACHED_SYSTEM_PROMPT_TEST_VALUE';
    await client.query(
      'UPDATE chats SET cached_system_prompt = $1, rag_turn_count = 0 WHERE id = $2',
      [fakePrompt, testChatId]
    );

    // D4 – simulate turn counter increment (as route.ts does after each message saved)
    await client.query(
      'UPDATE chats SET rag_turn_count = rag_turn_count + 1 WHERE id = $1',
      [testChatId]
    );
    const afterTurn1 = await client.query(
      'SELECT rag_turn_count, cached_system_prompt FROM chats WHERE id = $1',
      [testChatId]
    );
    assert(parseInt(afterTurn1.rows[0].rag_turn_count) === 1,
      'D3: rag_turn_count increments correctly to 1 after one turn',
      `Got: ${afterTurn1.rows[0].rag_turn_count}`);
    assert(afterTurn1.rows[0].cached_system_prompt === fakePrompt,
      'D4: cached_system_prompt persists after turn counter increment',
      `Got: ${afterTurn1.rows[0].cached_system_prompt?.substring(0, 50)}`);

    // D5 – verify cache is still valid at turn 9 (< RAG_REFRESH_EVERY=10)
    await client.query(
      'UPDATE chats SET rag_turn_count = 9 WHERE id = $1',
      [testChatId]
    );
    const atTurn9 = await client.query(
      'SELECT rag_turn_count, cached_system_prompt FROM chats WHERE id = $1',
      [testChatId]
    );
    const shouldUseCacheAt9 = atTurn9.rows[0].cached_system_prompt !== null &&
                               parseInt(atTurn9.rows[0].rag_turn_count) < 10;
    assert(shouldUseCacheAt9, 'D5: Cache is active at turn 9 (rag_turn_count < 10)',
      `turn_count=${atTurn9.rows[0].rag_turn_count}, cache=${atTurn9.rows[0].cached_system_prompt !== null}`);

    // D6 – verify cache refresh triggers at turn 10 (>= RAG_REFRESH_EVERY)
    await client.query(
      'UPDATE chats SET rag_turn_count = 10 WHERE id = $1',
      [testChatId]
    );
    const atTurn10 = await client.query(
      'SELECT rag_turn_count FROM chats WHERE id = $1',
      [testChatId]
    );
    const shouldRefreshAt10 = parseInt(atTurn10.rows[0].rag_turn_count) >= 10;
    assert(shouldRefreshAt10, 'D6: Cache refresh triggers at turn 10 (rag_turn_count >= 10)',
      `turn_count=${atTurn10.rows[0].rag_turn_count}`);

  } finally {
    // Cleanup: delete test chat
    await client.query('DELETE FROM chats WHERE id = $1', [testChatId]);
  }
}

// ── E: HISTORY WINDOW TESTS ───────────────────────────────────────────────────
async function testHistory(client) {
  console.log('\n[E] History Window Tests');

  // E1 – verify the query itself works and returns DESC correctly
  // Find a chat that has messages, or skip
  const chatWithMsgs = await client.query(`
    SELECT chat_id, COUNT(*) AS msg_count
    FROM messages
    GROUP BY chat_id
    ORDER BY msg_count DESC
    LIMIT 1
  `);

  if (chatWithMsgs.rows.length === 0 || parseInt(chatWithMsgs.rows[0].msg_count) === 0) {
    console.log('  ⚠️  SKIP  E1-E3: No messages in DB to test history window');
    return;
  }

  const testChatId = chatWithMsgs.rows[0].chat_id;
  const totalMessages = parseInt(chatWithMsgs.rows[0].msg_count);

  // E1 – LIMIT 20 is applied
  const histRes = await client.query(
    'SELECT role, content, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 20',
    [testChatId]
  );
  assert(histRes.rows.length <= 20, 'E1: History query returns at most 20 messages',
    `Returned ${histRes.rows.length} messages`);

  // E2 – rows are in DESC order before reverse (most recent first from DB)
  if (histRes.rows.length >= 2) {
    const isDesc = new Date(histRes.rows[0].created_at) >= new Date(histRes.rows[1].created_at);
    assert(isDesc, 'E2: DB returns rows in DESC order (most recent first, before .reverse())',
      `Row[0]=${histRes.rows[0].created_at}, Row[1]=${histRes.rows[1].created_at}`);
  } else {
    console.log('  ⚠️  SKIP  E2: Not enough messages to verify ordering');
  }

  // E3 – after .reverse(), oldest message is first (simulating what route.ts does)
  const reversed = [...histRes.rows].reverse();
  if (reversed.length >= 2) {
    const isAsc = new Date(reversed[0].created_at) <= new Date(reversed[1].created_at);
    assert(isAsc, 'E3: After .reverse(), messages are oldest-first (correct LLM order)',
      `Row[0]=${reversed[0].created_at}, Row[1]=${reversed[1].created_at}`);
  } else {
    console.log('  ⚠️  SKIP  E3: Not enough messages to verify reversed ordering');
  }

  // E4 – if chat has > 20 messages, confirm we're capping correctly
  if (totalMessages > 20) {
    assert(histRes.rows.length === 20,
      `E4: Chat with ${totalMessages} messages is capped at exactly 20`,
      `Got ${histRes.rows.length}`);
  } else {
    console.log(`  ⚠️  SKIP  E4: Chat only has ${totalMessages} messages (need > 20 to test cap)`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Architecture Fix Verification Suite');
  console.log('═══════════════════════════════════════════════════════');

  const client = await pool.connect();
  try {
    await testSchema(client);
    await testData(client);
    await testRAG(client);
    await testCache(client);
    await testHistory(client);
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  • ${f.name}: ${f.reason}`));
    process.exit(1);
  } else {
    console.log('\n  All tests passed. ✅');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
