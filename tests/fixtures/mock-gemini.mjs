const originalFetch = globalThis.fetch;

/**
 * ponytail: mock-gemini intercepts global fetch calls to avoid hitting external Google Gemini APIs.
 * Supports simulation of success, failure, and empty results based on request body keywords.
 */
globalThis.fetch = async function (input, init) {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else if (input && typeof input === 'object' && 'url' in input) {
    url = input.url;
  }

  if (url.includes('generativelanguage.googleapis.com')) {
    let bodyText = '';
    if (init && init.body) {
      bodyText = typeof init.body === 'string' ? init.body : String(init.body);
    } else if (input && typeof input === 'object' && 'body' in input && input.body) {
      if (typeof input.text === 'function') {
        try {
          bodyText = await input.clone().text();
        } catch {
          // ignore fallback
        }
      }
    }

    if (bodyText.includes('trigger-gemini-fail')) {
      return new Response(
        JSON.stringify({ error: { message: "Mocked Gemini failure" } }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (bodyText.includes('trigger-empty')) {
      return new Response(
        JSON.stringify({ candidates: [] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Mocked strategic advice: Remain prudent, preserve your resources, and evaluate the power dynamic before taking action.",
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return originalFetch.call(this, input, init);
};
