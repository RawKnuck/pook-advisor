# E2E Test Infrastructure

This document outlines the design, architecture, philosophy, and features of the E2E test suite built for the Sovereign Advisor Chatbot (Second Brain) project.

---

## 1. Test Philosophy

The testing strategy is designed around the following core tenets:
- **Opaque-Box Testing**: The E2E tests target the public HTTP interface of the Next.js application, treating the server as a black box that accepts requests and returns responses.
- **Requirement-Driven**: Test cases verify specific user requirements, boundary rules, cross-feature state updates, and real-world operational scenarios.
- **Custom Runner under Ponytail Rules**: Rather than introducing heavy external testing frameworks like Jest, Cypress, or Playwright, the suite relies entirely on Node.js's native test runner (`node:test`) and assertion module (`node:assert`). This aligns with the Ponytail principles of avoiding unnecessary dependencies, leveraging native platform features, and maximizing execution speed.

---

## 2. Feature Inventory

The test suite covers five primary functional features:
1. **Authentication (Auth)**: Custom Credentials auth flow validation including CSRF token acquisition, session establishment, session retrieval, database sync/creation, and clean sign-out.
2. **Chats Retrieval**: Fetching the list of user chat sessions (verifying descending chronological sort order by `updated_at`) and retrieving historical chat messages in ascending chronological order.
3. **Chat Creation**: Initializing a chat session with default titles, custom titles, fallback on whitespace, HTML escaping, and length limits.
4. **Chat Deletion**: Removing chat sessions, validating user-level ownership isolation, cascade deletion of associated message records, and error handling for invalid identifiers.
5. **Message History / Gemini Interaction**: Posting user queries to individual chats, fetching contextual message histories, invoking Gemini mock responses, and verifying database storage of responses.

---

## 3. Test Architecture

The testing framework is built using three lightweight components:

```
                  ┌──────────────────────────────┐
                  │      tests/runner.mjs        │
                  │   (Next.js lifecycle, dev)   │
                  └──────────────┬───────────────┘
                                 │ spawns
                  ┌──────────────▼───────────────┐
                  │        node --test           │
                  │    (native test runner)      │
                  └──────────────┬───────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│    TestClient    │   │  cleanDatabase   │   │   mock-gemini    │
│  (Cookie Jar)    │   │   (DB Cleaner)   │   │  (Interception)  │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

- **TestClient (`tests/helpers/test-client.mjs`)**: A wrapper around Node's global `fetch` that implements a cookie jar. It intercepts and stores cookies like `next-auth.csrf-token` and `next-auth.session-token`, applying them automatically to successive requests to simulate user sessions.
- **DB Cleaner (`tests/fixtures/db-cleaner.mjs`)**: Connects directly to the PostgreSQL instance via `DATABASE_URL` and executes `TRUNCATE TABLE users, chats, messages CASCADE` to guarantee tests run with isolated, predictable data states.
- **Gemini Mock Interceptor (`tests/fixtures/mock-gemini.mjs`)**: Loaded in the server process using Node's `--import` flag. It intercepts global `fetch` calls going to `generativelanguage.googleapis.com` to return mock responses (or mock errors when requesting `trigger-gemini-fail`/`trigger-empty`), preventing external API calls and network dependency.
- **Runner Lifecycle**: Managed by `tests/runner.mjs`. It reads environmental variables, boots the Next.js server in development mode on port `3001` with the Gemini mock pre-imported, awaits server health, spawns the test files, and kills the server child process on exit.

---

## 4. Real-World Application Scenarios (Tier 4)

Tier 4 tests verify complex multi-step sequences replicating real-world user behaviors:
- **`TC-T4-RWS-01` (Standard New User Session)**: An end-to-end user path including registration, session verification, chat creation, message exchange, chat deletion, and logout.
- **`TC-T4-RWS-02` (Multi-turn Strategic Consultation)**: Verifies multi-turn chats remain synchronized and chronological (user message -> advisor response -> follow-up -> advisor response).
- **`TC-T4-RWS-03` (Session Resumption & Reordering)**: Confirms that interacting with older chat sessions updates their `updated_at` timestamps and correctly bubbles them to the top of the retrieval list.
- **`TC-T4-RWS-04` (Clean Slate Scenario)**: Simulates bulk deletion of all existing sessions followed by the successful creation of a new session.
- **`TC-T4-RWS-05` (Parallel Session Management)**: Validates concurrent interactions in multiple distinct chats without session or message leakage.
- **`TC-T4-RWS-06` (Multi-user Isolation Flow)**: Verifies authorization isolation: User B cannot retrieve, modify, or delete User A's chats or messages.
- **`TC-T4-RWS-07` (Database Connection Recovery Handler)**: Temporarily alters database state (via table renaming) to verify the API returns HTTP 500 cleanly without crashing the Node.js server, and fully recovers when the database connection is restored.
- **`TC-T4-RWS-08` (Session Expiry & Re-authentication)**: Simulates cookies being cleared/invalidated mid-session to verify the dynamic redirect/blocking to 401 and subsequent re-authentication flow.

---

## 5. Coverage Thresholds

| Test Tier | Target Count | Actual Implemented | Description |
|---|---|---|---|
| **Tier 1** (Feature Coverage) | 30 | 30 | Standard feature coverage for all 5 core features (6 cases each) |
| **Tier 2** (Boundary/Corner) | 12 | 12 | Edge cases, malformed payloads, SQL Injection, API errors, and context limits |
| **Tier 3** (Combinations) | 10 | 10 | Cross-feature execution chains and permission boundary constraints |
| **Tier 4** (Real-World Scenarios) | 8 | 8 | Realistic multi-step end-to-end user workflows and resilience tests |
| **Total Suite** | **60** | **60** | **Comprehensive E2E coverage** |
