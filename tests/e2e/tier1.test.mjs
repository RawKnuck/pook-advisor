// ponytail: Tier 1 E2E tests covering primary features: Auth, Chats Retrieval, Chat Creation, Chat Deletion, Gemini Interaction
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TestClient } from '../helpers/test-client.mjs';
import { cleanDatabase } from '../fixtures/db-cleaner.mjs';

const baseUrl = 'http://localhost:3001';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

describe('Tier 1: Feature Coverage (30 Cases)', () => {
  let client;

  before(async () => {
    await cleanDatabase();
  });

  after(async () => {
    await pool.end();
  });

  describe('1. Authentication (6 Cases)', () => {
    test('TC-T1-AUTH-01: Get CSRF token successfully', async () => {
      const c = new TestClient(baseUrl);
      const res = await c.request('/api/auth/csrf');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.csrfToken, 'CSRF token should be returned');
      assert.ok(c.cookies['next-auth.csrf-token'], 'CSRF cookie should be set');
    });

    test('TC-T1-AUTH-02: Authenticate credentials for a new user', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      const res = await c.login('newuser@sovereign.advisor', 'New User');
      assert.strictEqual(res.status, 200);
      assert.ok(c.cookies['next-auth.session-token'], 'Session token cookie should be set');

      // Verify DB contains user record
      const dbRes = await pool.query('SELECT * FROM users WHERE email = $1', ['newuser@sovereign.advisor']);
      assert.strictEqual(dbRes.rows.length, 1);
      assert.strictEqual(dbRes.rows[0].name, 'New User');
    });

    test('TC-T1-AUTH-03: Authenticate credentials for an existing user', async () => {
      await cleanDatabase();
      // Pre-insert user
      await pool.query(
        "INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW())",
        ['user-existing-123', 'existing@sovereign.advisor', 'Old Name']
      );

      const c = new TestClient(baseUrl);
      const res = await c.login('existing@sovereign.advisor', 'New Name');
      assert.strictEqual(res.status, 200);

      // Verify DB contains updated user record (sync behavior)
      const dbRes = await pool.query('SELECT * FROM users WHERE email = $1', ['existing@sovereign.advisor']);
      assert.strictEqual(dbRes.rows.length, 1);
      assert.strictEqual(dbRes.rows[0].name, 'New Name');
    });

    test('TC-T1-AUTH-04: Retrieve active session details', async () => {
      const c = new TestClient(baseUrl);
      await c.login('sessionuser@sovereign.advisor', 'Session User');
      const res = await c.request('/api/auth/session');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.user, 'Session body should contain user info');
      assert.strictEqual(body.user.email, 'sessionuser@sovereign.advisor');
      assert.strictEqual(body.user.name, 'Session User');
    });

    test('TC-T1-AUTH-05: Access session when unauthenticated', async () => {
      const c = new TestClient(baseUrl);
      const res = await c.request('/api/auth/session');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.deepStrictEqual(body, {}, 'Unauthenticated session should return empty object');
    });

    test('TC-T1-AUTH-06: Sign out active session', async () => {
      const c = new TestClient(baseUrl);
      await c.login('signoutuser@sovereign.advisor', 'Signout User');
      const logoutRes = await c.logout();
      assert.strictEqual(logoutRes.status, 200);

      const sessionRes = await c.request('/api/auth/session');
      const body = await sessionRes.json();
      assert.deepStrictEqual(body, {});
    });
  });

  describe('2. Chats Retrieval (6 Cases)', () => {
    test('TC-T1-CHTR-01: Retrieve chats list for user with no chats', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('nochats@sovereign.advisor', 'No Chats');
      const res = await c.request('/api/chats');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.deepStrictEqual(body.chats, []);
    });

    test('TC-T1-CHTR-02: Retrieve chats list for user with multiple chats', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('multichats@sovereign.advisor', 'Multi Chats');

      // Create chats via API to have dynamic DB setup
      await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Chat A' })
      });
      await new Promise(r => setTimeout(r, 10)); // tiny delay for timestamp sorting
      await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Chat B' })
      });

      const res = await c.request('/api/chats');
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.chats.length, 2);
      // Sorted by updated_at DESC, so Chat B should be first
      assert.strictEqual(body.chats[0].title, 'Chat B');
      assert.strictEqual(body.chats[1].title, 'Chat A');
    });

    test('TC-T1-CHTR-03: Block unauthenticated retrieval of chats', async () => {
      const c = new TestClient(baseUrl);
      const res = await c.request('/api/chats');
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.error, 'Unauthorized');
    });

    test('TC-T1-CHTR-04: Retrieve messages history for active chat', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('msghistory@sovereign.advisor', 'Msg History');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Chat Hist' })
      });
      const chat = (await chatRes.json()).chat;

      // Populate some messages in DB
      await pool.query(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES ($1, 'user', 'Ping', NOW() - INTERVAL '10 seconds')",
        [chat.id]
      );
      await pool.query(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES ($1, 'assistant', 'Pong', NOW())",
        [chat.id]
      );

      const res = await c.request(`/api/chats/${chat.id}/messages`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.messages.length, 2);
      assert.strictEqual(body.messages[0].content, 'Ping');
      assert.strictEqual(body.messages[0].role, 'user');
      assert.strictEqual(body.messages[1].content, 'Pong');
      assert.strictEqual(body.messages[1].role, 'assistant');
    });

    test('TC-T1-CHTR-05: Retrieve messages for a newly created chat', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('newchatmsg@sovereign.advisor', 'New Chat Msg');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Empty Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const res = await c.request(`/api/chats/${chat.id}/messages`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.deepStrictEqual(body.messages, []);
    });

    test('TC-T1-CHTR-06: Block unauthenticated messages retrieval', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('unauthmsg@sovereign.advisor', 'Unauth Msg');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Secret Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const unauthClient = new TestClient(baseUrl);
      const res = await unauthClient.request(`/api/chats/${chat.id}/messages`);
      assert.strictEqual(res.status, 401);
    });
  });

  describe('3. Chat Creation (6 Cases)', () => {
    test('TC-T1-CHTC-01: Create chat session with default title', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('createchat@sovereign.advisor', 'Create Chat');
      const res = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.chat.id);
      assert.strictEqual(body.chat.title, 'Strategic Consultation');
    });

    test('TC-T1-CHTC-02: Create chat session with custom title', async () => {
      const c = new TestClient(baseUrl);
      await c.login('createchat@sovereign.advisor', 'Create Chat');
      const res = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Job Interview Plan' })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.chat.title, 'Job Interview Plan');
    });

    test('TC-T1-CHTC-03: Create chat with empty/whitespace title', async () => {
      const c = new TestClient(baseUrl);
      await c.login('createchat@sovereign.advisor', 'Create Chat');
      const res = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '   ' })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.chat.title, 'Strategic Consultation');
    });

    test('TC-T1-CHTC-04: Block unauthenticated chat creation', async () => {
      const c = new TestClient(baseUrl);
      const res = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Fail Title' })
      });
      assert.strictEqual(res.status, 401);
    });

    test('TC-T1-CHTC-05: Create chat with long title (255 characters)', async () => {
      const c = new TestClient(baseUrl);
      await c.login('createchat@sovereign.advisor', 'Create Chat');
      const longTitle = 'a'.repeat(255);
      const res = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: longTitle })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.chat.title, longTitle);
    });

    test('TC-T1-CHTC-06: Create chat with HTML tags in title', async () => {
      const c = new TestClient(baseUrl);
      await c.login('createchat@sovereign.advisor', 'Create Chat');
      const htmlTitle = '<b>Strategic</b>';
      const res = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: htmlTitle })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.chat.title, htmlTitle);
    });
  });

  describe('4. Chat Deletion (6 Cases)', () => {
    test('TC-T1-CHTD-01: Delete active chat session successfully', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('deletechat@sovereign.advisor', 'Delete Chat');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Delete Me' })
      });
      const chat = (await chatRes.json()).chat;

      const deleteRes = await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.strictEqual(deleteBody.success, true);

      // Verify row is gone from DB
      const dbRes = await pool.query('SELECT * FROM chats WHERE id = $1', [chat.id]);
      assert.strictEqual(dbRes.rows.length, 0);
    });

    test('TC-T1-CHTD-02: Block deletion of chat belonging to another user', async () => {
      await cleanDatabase();
      const c1 = new TestClient(baseUrl);
      await c1.login('owner@sovereign.advisor', 'Owner');
      const chatRes = await c1.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Owner Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const c2 = new TestClient(baseUrl);
      await c2.login('other@sovereign.advisor', 'Other');
      const deleteRes = await c2.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 403);

      // Verify row remains in DB
      const dbRes = await pool.query('SELECT * FROM chats WHERE id = $1', [chat.id]);
      assert.strictEqual(dbRes.rows.length, 1);
    });

    test('TC-T1-CHTD-03: Request deletion of non-existent chat UUID', async () => {
      const c = new TestClient(baseUrl);
      await c.login('deletechat@sovereign.advisor', 'Delete Chat');
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const deleteRes = await c.request(`/api/chats/${nonExistentUuid}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 404);
      const deleteBody = await deleteRes.json();
      assert.strictEqual(deleteBody.error, 'Chat not found');
    });

    test('TC-T1-CHTD-04: Block unauthenticated chat deletion', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('owner@sovereign.advisor', 'Owner');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Owner Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const unauthClient = new TestClient(baseUrl);
      const deleteRes = await unauthClient.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 401);
    });

    test('TC-T1-CHTD-05: Cascade deletion of messages on chat delete', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('cascade@sovereign.advisor', 'Cascade');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Cascade Chat' })
      });
      const chat = (await chatRes.json()).chat;

      // Insert message
      await pool.query(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES ($1, 'user', 'Hello Cascade', NOW())",
        [chat.id]
      );

      const deleteRes = await c.request(`/api/chats/${chat.id}`, { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 200);

      // Verify messages are deleted via cascade
      const msgRes = await pool.query('SELECT * FROM messages WHERE chat_id = $1', [chat.id]);
      assert.strictEqual(msgRes.rows.length, 0);
    });

    test('TC-T1-CHTD-06: Handle invalid UUID format in delete route', async () => {
      const c = new TestClient(baseUrl);
      await c.login('deletechat@sovereign.advisor', 'Delete Chat');
      const deleteRes = await c.request('/api/chats/not-a-valid-uuid', { method: 'DELETE' });
      assert.strictEqual(deleteRes.status, 500);
    });
  });

  describe('5. Message History & Gemini Interaction (6 Cases)', () => {
    test('TC-T1-GEM-01: Send message and receive advisor response', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('gemini@sovereign.advisor', 'Gemini User');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Advisory Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const chatMsgRes = await c.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id, content: 'How do I ask for a raise?' })
      });
      assert.strictEqual(chatMsgRes.status, 200);
      const chatMsgBody = await chatMsgRes.json();
      assert.ok(chatMsgBody.text, 'Should contain generated text response');
      assert.match(chatMsgBody.text, /Mocked strategic advice/);

      // Verify messages exist in DB
      const dbRes = await pool.query('SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC', [chat.id]);
      assert.strictEqual(dbRes.rows.length, 2);
      assert.strictEqual(dbRes.rows[0].role, 'user');
      assert.strictEqual(dbRes.rows[0].content, 'How do I ask for a raise?');
      assert.strictEqual(dbRes.rows[1].role, 'assistant');
      assert.match(dbRes.rows[1].content, /Mocked strategic advice/);
    });

    test('TC-T1-GEM-02: Block unauthenticated message submission', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('gemini@sovereign.advisor', 'Gemini User');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Advisory Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const unauthClient = new TestClient(baseUrl);
      const chatMsgRes = await unauthClient.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id, content: 'Hello' })
      });
      assert.strictEqual(chatMsgRes.status, 401);
    });

    test('TC-T1-GEM-03: Block message submission to another user\'s chat', async () => {
      await cleanDatabase();
      const c1 = new TestClient(baseUrl);
      await c1.login('userA@sovereign.advisor', 'User A');
      const chatRes = await c1.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'User A Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const c2 = new TestClient(baseUrl);
      await c2.login('userB@sovereign.advisor', 'User B');
      const chatMsgRes = await c2.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id, content: 'Hello' })
      });
      assert.strictEqual(chatMsgRes.status, 403);
    });

    test('TC-T1-GEM-04: Submit message to non-existent chat UUID', async () => {
      const c = new TestClient(baseUrl);
      await c.login('gemini@sovereign.advisor', 'Gemini User');
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const chatMsgRes = await c.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: nonExistentUuid, content: 'Hello' })
      });
      assert.strictEqual(chatMsgRes.status, 404);
    });

    test('TC-T1-GEM-05: Submit message with missing chatId field', async () => {
      const c = new TestClient(baseUrl);
      await c.login('gemini@sovereign.advisor', 'Gemini User');
      const chatMsgRes = await c.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' })
      });
      assert.strictEqual(chatMsgRes.status, 400);
    });

    test('TC-T1-GEM-06: Submit message with missing content field', async () => {
      await cleanDatabase();
      const c = new TestClient(baseUrl);
      await c.login('gemini@sovereign.advisor', 'Gemini User');
      const chatRes = await c.request('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Advisory Chat' })
      });
      const chat = (await chatRes.json()).chat;

      const chatMsgRes = await c.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: chat.id })
      });
      assert.strictEqual(chatMsgRes.status, 400);
    });
  });
});
