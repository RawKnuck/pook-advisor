// ponytail: Tier 2 E2E tests covering boundary and corner cases
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TestClient } from '../helpers/test-client.mjs';
import { cleanDatabase } from '../fixtures/db-cleaner.mjs';

const baseUrl = 'http://localhost:3001';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Tier 2: Boundary & Corner Cases (12 Cases)', () => {
  before(async () => {
    await cleanDatabase();
  });

  after(async () => {
    await pool.end();
  });

  test('TC-T2-BND-01: Login with missing email field', async () => {
    const c = new TestClient(baseUrl);
    const csrfRes = await c.request('/api/auth/csrf');
    const { csrfToken } = await csrfRes.json();
    const loginRes = await c.request('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, name: 'Missing Email User', json: 'true' }).toString()
    });
    assert.strictEqual(loginRes.status, 401);
  });

  test('TC-T2-BND-02: Login with missing name field', async () => {
    const c = new TestClient(baseUrl);
    const csrfRes = await c.request('/api/auth/csrf');
    const { csrfToken } = await csrfRes.json();
    const loginRes = await c.request('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email: 'missing-name@sovereign.advisor', json: 'true' }).toString()
    });
    assert.strictEqual(loginRes.status, 401);
  });

  test('TC-T2-BND-03: Submit chat creation with completely malformed JSON body', async () => {
    const c = new TestClient(baseUrl);
    await c.login('malformed-json-chat@sovereign.advisor', 'Malformed Chat');
    const res = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid_json'
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.chat.title, 'Strategic Consultation');
  });

  test('TC-T2-BND-04: Submit message send with malformed JSON body', async () => {
    const c = new TestClient(baseUrl);
    await c.login('malformed-json-msg@sovereign.advisor', 'Malformed Message');
    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid_json'
    });
    assert.ok(res.status === 400 || res.status === 500);
  });

  test('TC-T2-BND-05: Retrieve messages with invalid UUID syntax for ID', async () => {
    const c = new TestClient(baseUrl);
    await c.login('invalid-uuid-syntax@sovereign.advisor', 'Invalid UUID Syntax');
    const res = await c.request('/api/chats/not-a-valid-uuid-syntax/messages');
    assert.strictEqual(res.status, 500);
  });

  test('TC-T2-BND-06: Send empty string message to advisor', async () => {
    const c = new TestClient(baseUrl);
    await c.login('empty-msg-user@sovereign.advisor', 'Empty Message');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: '' })
    });
    assert.strictEqual(res.status, 400);
  });

  test('TC-T2-BND-07: Send massive content body (50KB text)', async () => {
    const c = new TestClient(baseUrl);
    await c.login('massive-msg-user@sovereign.advisor', 'Massive Msg');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    const massiveContent = 'A'.repeat(50000);
    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: massiveContent })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(body.text, /Mocked strategic advice/);
  });

  test('TC-T2-BND-08: Gemini API returns HTTP 500 server error', async () => {
    const c = new TestClient(baseUrl);
    await c.login('gemini-fail-user@sovereign.advisor', 'Gemini Fail User');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'trigger-gemini-fail' })
    });
    assert.strictEqual(res.status, 500);

    // Verify user message is saved but assistant is not
    const dbRes = await pool.query('SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat.id]);
    assert.strictEqual(dbRes.rows.length, 1);
    assert.strictEqual(dbRes.rows[0].role, 'user');
    assert.strictEqual(dbRes.rows[0].content, 'trigger-gemini-fail');
  });

  test('TC-T2-BND-09: Gemini API returns empty content array or null candidate', async () => {
    const c = new TestClient(baseUrl);
    await c.login('gemini-empty-user@sovereign.advisor', 'Gemini Empty User');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'trigger-empty' })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.text, 'No response generated.');

    // Verify DB contains fallback message content
    const dbRes = await pool.query('SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat.id]);
    assert.strictEqual(dbRes.rows.length, 2);
    assert.strictEqual(dbRes.rows[1].role, 'assistant');
    assert.strictEqual(dbRes.rows[1].content, 'No response generated.');
  });

  test('TC-T2-BND-10: SQL Injection string in chat title payload', async () => {
    const c = new TestClient(baseUrl);
    await c.login('sqli-chat@sovereign.advisor', 'SQLi Chat');
    const sqlInjectTitle = "x'; DROP TABLE chats; --";
    const res = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: sqlInjectTitle })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.chat.title, sqlInjectTitle);

    // Verify DB query can run successfully and chats table still exists
    const dbRes = await pool.query('SELECT * FROM chats WHERE id = $1', [body.chat.id]);
    assert.strictEqual(dbRes.rows.length, 1);
  });

  test('TC-T2-BND-11: SQL Injection string in email field', async () => {
    const c = new TestClient(baseUrl);
    const sqlInjectEmail = "x' OR '1'='1";
    const res = await c.login(sqlInjectEmail, 'SQLi Email User');
    assert.strictEqual(res.status, 200);

    // Verify DB contains exact email record without parsing SQL injection
    const dbRes = await pool.query('SELECT * FROM users WHERE email = $1', [sqlInjectEmail]);
    assert.strictEqual(dbRes.rows.length, 1);
    assert.strictEqual(dbRes.rows[0].email, sqlInjectEmail);
  });

  test('TC-T2-BND-12: Chat session message context limit boundary (50 messages)', async () => {
    const c = new TestClient(baseUrl);
    await c.login('limit-boundary@sovereign.advisor', 'Limit Boundary');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    // Populating 49 messages directly to database
    for (let i = 0; i < 49; i++) {
      await pool.query(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES ($1, $2, $3, NOW() - (50 - $4) * INTERVAL '1 second')",
        [chat.id, i % 2 === 0 ? 'user' : 'assistant', `Message context ${i}`, i]
      );
    }

    // Send the 50th message through API
    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'Final Limit Msg' })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(body.text, /Mocked strategic advice/);
  });
});
