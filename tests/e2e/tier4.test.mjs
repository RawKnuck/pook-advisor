// ponytail: Tier 4 E2E tests covering real-world application scenarios
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TestClient } from '../helpers/test-client.mjs';
import { cleanDatabase } from '../fixtures/db-cleaner.mjs';

const baseUrl = 'http://localhost:3001';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Tier 4: Real-World Application Scenarios (8 Cases)', () => {
  before(async () => {
    await cleanDatabase();
  });

  after(async () => {
    await pool.end();
  });

  test('TC-T4-RWS-01: Standard New User Session', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);

    // 1. Retrieve CSRF token
    const csrfRes = await c.request('/api/auth/csrf');
    assert.strictEqual(csrfRes.status, 200);

    // 2. Authenticate
    const loginRes = await c.login('newuser@sovereign.advisor', 'New User');
    assert.strictEqual(loginRes.status, 200);

    // 3. Verify session
    const sessionRes = await c.request('/api/auth/session');
    const session = await sessionRes.json();
    assert.strictEqual(session.user.email, 'newuser@sovereign.advisor');

    // 4. Create chat
    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;
    assert.strictEqual(chat.title, 'Strategic Consultation');

    // 5. Send message
    const chatMsgRes = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'How to handle an aggressive colleague?' })
    });
    assert.strictEqual(chatMsgRes.status, 200);

    // 6. Retrieve messages history
    const historyRes = await c.request(`/api/chats/${chat.id}/messages`);
    const history = await historyRes.json();
    assert.strictEqual(history.messages.length, 2);

    // 7. Retrieve all chats
    const chatsListRes = await c.request('/api/chats');
    const chatsList = await chatsListRes.json();
    assert.ok(chatsList.chats.some(ch => ch.id === chat.id));

    // 8. Delete chat
    const deleteRes = await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
    assert.strictEqual(deleteRes.status, 200);

    // 9. Sign out
    await c.logout();
    const finalSession = await c.request('/api/auth/session');
    assert.deepStrictEqual(await finalSession.json(), {});
  });

  test('TC-T4-RWS-02: Multi-turn Strategic Consultation', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('multiturn@sovereign.advisor', 'Multi Turn');

    const chatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const chat = (await chatRes.json()).chat;

    // Verify empty history
    const initialHist = await c.request(`/api/chats/${chat.id}/messages`);
    assert.deepStrictEqual((await initialHist.json()).messages, []);

    // Turn 1
    const t1Res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'My boss is taking credit for my code.' })
    });
    assert.strictEqual(t1Res.status, 200);

    // Turn 2
    const t2Res = await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, content: 'Should I confront him directly or go to HR?' })
    });
    assert.strictEqual(t2Res.status, 200);

    // Fetch history
    const historyRes = await c.request(`/api/chats/${chat.id}/messages`);
    const history = await historyRes.json();
    assert.strictEqual(history.messages.length, 4);
    assert.strictEqual(history.messages[0].role, 'user');
    assert.strictEqual(history.messages[1].role, 'assistant');
    assert.strictEqual(history.messages[2].role, 'user');
    assert.strictEqual(history.messages[3].role, 'assistant');
  });

  test('TC-T4-RWS-03: Session Resumption & Reordering', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('reordering@sovereign.advisor', 'Reordering');

    const chatARes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat A' })
    });
    const chatA = (await chatARes.json()).chat;

    await new Promise(r => setTimeout(r, 10));
    const chatBRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat B' })
    });
    const chatB = (await chatBRes.json()).chat;

    // Verify Chat B is first, Chat A is second
    let listRes = await c.request('/api/chats');
    let body = await listRes.json();
    assert.strictEqual(body.chats[0].id, chatB.id);
    assert.strictEqual(body.chats[1].id, chatA.id);

    // Resume Chat A by sending message
    await new Promise(r => setTimeout(r, 10));
    await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatA.id, content: 'Continuing my thoughts on negotiation.' })
    });

    // Verify Chat A is now first
    listRes = await c.request('/api/chats');
    body = await listRes.json();
    assert.strictEqual(body.chats[0].id, chatA.id);
    assert.strictEqual(body.chats[1].id, chatB.id);
  });

  test('TC-T4-RWS-04: Clean Slate Scenario', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('cleanslate@sovereign.advisor', 'Clean Slate');

    // Create 3 chats
    for (let i = 0; i < 3; i++) {
      await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Chat ${i}` })
      });
    }

    // List and delete all
    const listRes = await c.request('/api/chats');
    const { chats } = await listRes.json();
    assert.strictEqual(chats.length, 3);

    for (const chat of chats) {
      const delRes = await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
      assert.strictEqual(delRes.status, 200);
    }

    // Verify empty
    const listEmptyRes = await c.request('/api/chats');
    assert.deepStrictEqual((await listEmptyRes.json()).chats, []);

    // Create 1 new chat
    const finalChatRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New chat' })
    });
    assert.strictEqual(finalChatRes.status, 200);

    const listFinalRes = await c.request('/api/chats');
    assert.strictEqual((await listFinalRes.json()).chats.length, 1);
  });

  test('TC-T4-RWS-05: Parallel Session Management', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('parallel@sovereign.advisor', 'Parallel');

    const chatARes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Salary Negotiation' })
    });
    const chatA = (await chatARes.json()).chat;

    const chatBRes = await c.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Board Presentation' })
    });
    const chatB = (await chatBRes.json()).chat;

    // Send to Chat A
    await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatA.id, content: 'I need a 20% bump.' })
    });

    // Send to Chat B
    await c.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatB.id, content: 'Slide 3 is weak.' })
    });

    // Fetch Chat A
    const historyARes = await c.request(`/api/chats/${chatA.id}/messages`);
    const historyA = await historyARes.json();
    assert.strictEqual(historyA.messages.length, 2);
    assert.strictEqual(historyA.messages[0].content, 'I need a 20% bump.');

    // Fetch Chat B
    const historyBRes = await c.request(`/api/chats/${chatB.id}/messages`);
    const historyB = await historyBRes.json();
    assert.strictEqual(historyB.messages.length, 2);
    assert.strictEqual(historyB.messages[0].content, 'Slide 3 is weak.');
  });

  test('TC-T4-RWS-06: Multi-user Isolation Flow', async () => {
    await cleanDatabase();
    
    // User A
    const cA = new TestClient(baseUrl);
    await cA.login('userA@sovereign.advisor', 'User A');
    const chatARes = await cA.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat A' })
    });
    const chatA = (await chatARes.json()).chat;
    await cA.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatA.id, content: 'User A Msg' })
    });
    await cA.logout();

    // User B
    const cB = new TestClient(baseUrl);
    await cB.login('userB@sovereign.advisor', 'User B');
    const chatBRes = await cB.request('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat B' })
    });
    const chatB = (await chatBRes.json()).chat;
    await cB.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatB.id, content: 'User B Msg' })
    });

    // Verify User B only sees Chat B
    const listB = await cB.request('/api/chats');
    const { chats: chatsB } = await listB.json();
    assert.strictEqual(chatsB.length, 1);
    assert.strictEqual(chatsB[0].id, chatB.id);

    // Verify User B cannot access Chat A
    const crossRes = await cB.request(`/api/chats/${chatA.id}/messages`);
    assert.strictEqual(crossRes.status, 403);

    await cB.logout();

    // Login User A again
    await cA.login('userA@sovereign.advisor', 'User A');
    const listA = await cA.request('/api/chats');
    const { chats: chatsA } = await listA.json();
    assert.strictEqual(chatsA.length, 1);
    assert.strictEqual(chatsA[0].id, chatA.id);
  });

  test('TC-T4-RWS-07: Database Connection Recovery Handler', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('db-recovery@sovereign.advisor', 'DB Recovery');

    // 1. Verify works initially
    let listRes = await c.request('/api/chats');
    assert.strictEqual(listRes.status, 200);

    // 2. Temporarily rename table chats to trigger query error (500)
    await pool.query('ALTER TABLE chats RENAME TO chats_temp');

    try {
      listRes = await c.request('/api/chats');
      assert.strictEqual(listRes.status, 500);
    } finally {
      // 3. Restore table
      await pool.query('ALTER TABLE chats_temp RENAME TO chats');
    }

    // 4. Verify works again after recovery
    listRes = await c.request('/api/chats');
    assert.strictEqual(listRes.status, 200);
  });

  test('TC-T4-RWS-08: Session Expiry & Re-authentication', async () => {
    await cleanDatabase();
    const c = new TestClient(baseUrl);
    await c.login('expiry-user@sovereign.advisor', 'Expiry User');

    // Works initially
    let res = await c.request('/api/chats');
    assert.strictEqual(res.status, 200);

    // Expire session by removing session cookie
    delete c.cookies['next-auth.session-token'];

    // Blocked
    res = await c.request('/api/chats');
    assert.strictEqual(res.status, 401);

    // Re-authenticate
    await c.login('expiry-user@sovereign.advisor', 'Expiry User');
    res = await c.request('/api/chats');
    assert.strictEqual(res.status, 200);
  });
});
