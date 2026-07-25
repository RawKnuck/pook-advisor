// ponytail: Tier 3 E2E tests covering cross-feature combinations and multi-user interaction
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TestClient } from '../helpers/test-client.mjs';
import { cleanDatabase } from '../fixtures/db-cleaner.mjs';

const baseUrl = 'http://localhost:3001';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Tier 3: Cross-Feature Combinations (10 Cases)', () => {
  before(async () => {
    await cleanDatabase();
  });

  after(async () => {
    await pool.end();
  });

  test('TC-T3-COM-01: Create new chat session -> Verify chat appears first in list', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');

    // Create first chat
    const chat1Res = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'First Chat' })
    });
    const chat1 = (await chat1Res.json()).chat;

    // Create second chat
    await new Promise(r => setTimeout(r, 10));
    const chat2Res = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Second Chat' })
    });
    const chat2 = (await chat2Res.json()).chat;

    // Retrieve chats
    const listRes = await c.request('/api/chats');
    assert.strictEqual(listRes.status, 200);
    const body = await listRes.json();
    assert.strictEqual(body.chats[0].id, chat2.id);
    assert.strictEqual(body.chats[1].id, chat1.id);
  });

  test('TC-T3-COM-02: Create chat -> Delete chat -> Verify chat is removed from list', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');

    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Temporary Chat' })
    });
    const chat = (await chatRes.json()).chat;

    // Delete
    const deleteRes = await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
    assert.strictEqual(deleteRes.status, 200);

    // List
    const listRes = await c.request('/api/chats');
    const body = await listRes.json();
    const found = body.chats.some(ch => ch.id === chat.id);
    assert.strictEqual(found, false);
  });

  test('TC-T3-COM-03: Create chat -> Send message -> Verify message history', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');

    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    // Send msg
    const msgRes = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'Verify combination' })
    });
    assert.strictEqual(msgRes.status, 200);

    // Retrieve messages
    const historyRes = await c.request(`/api/chats/${chat.id}/messages`);
    assert.strictEqual(historyRes.status, 200);
    const body = await historyRes.json();
    assert.strictEqual(body.messages.length, 2);
    assert.strictEqual(body.messages[0].content, 'Verify combination');
    assert.strictEqual(body.messages[1].role, 'assistant');
  });

  test('TC-T3-COM-04: Create chat -> Send message -> Verify chat updated_at moves to top', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');

    // Create Chat A
    const chatARes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat A' })
    });
    const chatA = (await chatARes.json()).chat;

    // Wait and create Chat B
    await new Promise(r => setTimeout(r, 20));
    const chatBRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat B' })
    });
    const chatB = (await chatBRes.json()).chat;

    // Verify Chat B is first
    let listRes = await c.request('/api/chats');
    let body = await listRes.json();
    assert.strictEqual(body.chats[0].id, chatB.id);

    // Wait and send message to Chat A
    await new Promise(r => setTimeout(r, 20));
    await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatA.id, content: 'Update A' })
    });

    // Verify Chat A is now first
    listRes = await c.request('/api/chats');
    body = await listRes.json();
    assert.strictEqual(body.chats[0].id, chatA.id);
  });

  test('TC-T3-COM-05: Authenticate User A -> Create Chat -> Authenticate User B -> Access Chat A', async () => {
    await cleanDatabase();
    const c1 = new TestClient(baseUrl);
    await c1.login('userA@sovereign.advisor', 'User A');
    const chatRes = await c1.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'User A Secret' })
    });
    const chat = (await chatRes.json()).chat;

    const c2 = new TestClient(baseUrl);
    await c2.login('userB@sovereign.advisor', 'User B');
    const res = await c2.request(`/api/chats/${chat.id}/messages`);
    assert.strictEqual(res.status, 403);
  });

  test('TC-T3-COM-06: Authenticate User A -> Create Chat -> Authenticate User B -> Send message to Chat A', async () => {
    await cleanDatabase();
    const c1 = new TestClient(baseUrl);
    await c1.login('userA@sovereign.advisor', 'User A');
    const chatRes = await c1.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'User A Secret' })
    });
    const chat = (await chatRes.json()).chat;

    const c2 = new TestClient(baseUrl);
    await c2.login('userB@sovereign.advisor', 'User B');
    const res = await c2.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'Infiltrate' })
    });
    assert.strictEqual(res.status, 403);

    // Verify message is not saved in database
    const dbRes = await pool.query('SELECT * FROM messages WHERE chat_id = $1', [chat.id]);
    assert.strictEqual(dbRes.rows.length, 0);
  });

  test('TC-T3-COM-07: Authenticate User A -> Create Chat -> Authenticate User B -> Delete Chat A', async () => {
    await cleanDatabase();
    const c1 = new TestClient(baseUrl);
    await c1.login('userA@sovereign.advisor', 'User A');
    const chatRes = await c1.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'User A Secret' })
    });
    const chat = (await chatRes.json()).chat;

    const c2 = new TestClient(baseUrl);
    await c2.login('userB@sovereign.advisor', 'User B');
    const res = await c2.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 403);

    // Verify Chat A still exists in DB
    const dbRes = await pool.query('SELECT * FROM chats WHERE id = $1', [chat.id]);
    assert.strictEqual(dbRes.rows.length, 1);
  });

  test('TC-T3-COM-08: Send multiple messages -> Verify message chronological order', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'First message' })
    });
    await new Promise(r => setTimeout(r, 10));
    await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'Second message' })
    });

    const res = await c.request(`/api/chats/${chat.id}/messages`);
    const body = await res.json();
    assert.strictEqual(body.messages.length, 4); // 2 user, 2 assistant
    assert.strictEqual(body.messages[0].content, 'First message');
    assert.strictEqual(body.messages[2].content, 'Second message');
  });

  test('TC-T3-COM-09: Delete chat session -> Try to send message to deleted chat ID', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    // Delete chat
    await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });

    // Send msg
    const res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'Hello' })
    });
    assert.strictEqual(res.status, 404);
  });

  test('TC-T3-COM-10: Delete chat session -> Try to retrieve messages', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('combo@sovereign.advisor', 'Combo User');
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    // Delete chat
    await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });

    // Retrieve
    const res = await c.request(`/api/chats/${chat.id}/messages`);
    assert.strictEqual(res.status, 404);
  });
});
