/**
 * ponytail: TestClient is a lightweight fetch wrapper with an in-memory cookie jar.
 * Avoids any dependency on heavy libraries like axios, playwrite, or cypress.
 */
export class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = {};
  }

  getCookieHeader() {
    return Object.entries(this.cookies)
      .map(([name, val]) => `${name}=${val}`)
      .join('; ');
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    const headers = { ...options.headers };
    
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const response = await fetch(url, { ...options, headers });

    // Update cookie jar from response headers
    let setCookieHeaders = [];
    if (typeof response.headers.getSetCookie === 'function') {
      setCookieHeaders = response.headers.getSetCookie();
    } else {
      const rawCookie = response.headers.get('set-cookie');
      if (rawCookie) {
        setCookieHeaders = [rawCookie];
      }
    }

    for (const header of setCookieHeaders) {
      const parts = header.split(';');
      const cookiePart = parts[0].trim();
      if (cookiePart) {
        const eqIdx = cookiePart.indexOf('=');
        if (eqIdx !== -1) {
          const name = cookiePart.substring(0, eqIdx).trim();
          const value = cookiePart.substring(eqIdx + 1).trim();
          this.cookies[name] = value;
        }
      }
    }

    return response;
  }

  async login(email, name) {
    // 1. GET /api/auth/csrf to extract the CSRF token and next-auth.csrf-token cookie
    const csrfRes = await this.request('/api/auth/csrf');
    if (!csrfRes.ok) {
      throw new Error(`Failed to GET CSRF token during login, status: ${csrfRes.status}`);
    }
    const { csrfToken } = await csrfRes.json();
    if (!csrfToken) {
      throw new Error('CSRF token not found in GET /api/auth/csrf response');
    }

    // 2. POST /api/auth/callback/credentials with form-encoded body
    const body = new URLSearchParams({
      csrfToken,
      email,
      name,
      json: 'true',
      callbackUrl: '/'
    });

    const loginRes = await this.request('/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    // 3. Verify status is 200, confirming session token cookie is obtained
    if (loginRes.status !== 200) {
      throw new Error(`Login POST callback failed with status ${loginRes.status}: ${await loginRes.text()}`);
    }

    return loginRes;
  }

  async logout() {
    let csrfToken = '';
    try {
      const csrfRes = await this.request('/api/auth/csrf');
      if (csrfRes.ok) {
        const data = await csrfRes.json();
        csrfToken = data.csrfToken;
      }
    } catch {
      // ignore token fetch error on logout
    }

    let logoutRes;
    try {
      logoutRes = await this.request('/api/auth/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ csrfToken, callbackUrl: '/', json: 'true' }).toString()
      });
    } catch {
      // ignore request failure on logout
    }

    this.cookies = {};
    return logoutRes;
  }
}
