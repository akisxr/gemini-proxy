export const config = { runtime: 'edge' };

/** Normalize/validate model name */
function toModelName(input) {
  const s = (typeof input === 'string' ? input.trim() : '');
  // Δούλεψε με κάτι σίγουρα διαθέσιμο
  return s || 'gemini-1.5-flash';
}

/** Accept either {prompt} or raw Gemini payload ({contents: [...]}) */
function buildPayload(body) {
  if (body && typeof body === 'object') {
    if (body.contents) return body;
    if (typeof body.prompt === 'string') {
      return { contents: [{ role: 'user', parts: [{ text: body.prompt }] }] };
    }
  }
  return { contents: [{ parts: [{ text: 'Hello' }] }] };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      // CORS (χρήσιμο αν καλέσεις από web· σε native iOS δεν απαιτείται, αλλά δεν βλάπτει)
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST,GET,OPTIONS',
      ...extraHeaders,
    }
  });
}

export default async function handler(req) {
  // preflight
  if (req.method === 'OPTIONS') return json({ ok: true });

  if (req.method === 'GET') {
    return new Response('OK', {
      status: 200,
      headers: { 'access-control-allow-origin': '*' }
    });
  }

  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return json({ error: { code: 500, status: 'MISSING_API_KEY', message: 'Missing GEMINI_API_KEY in environment.' } }, 500);
    }

    // parse body
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const model = toModelName(body.model);
    const payload = buildPayload(body);

    // Hard timeout για να αποφύγεις 504 που σέρνονται
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s

    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).catch((e) => {
      // abort/δίκτυο
      throw e;
    });

    clearTimeout(timeout);

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* αφήνω raw */ }

    if (!r.ok) {
      // Βοηθητικό μήνυμα αν είναι μοντέλο-λάθος/404
      const friendly =
        data?.error?.message?.includes('not found') || r.status === 404
          ? 'Το μοντέλο δεν βρέθηκε στο API v1. Δοκίμασε π.χ. "gemini-1.5-flash".'
          : undefined;

      return json(
        { error: { code: r.status, status: data?.error?.status || 'UPSTREAM_ERROR', message: data?.error?.message || text, hint: friendly } },
        r.status
      );
    }

    // επιτυχία — γύρνα ό,τι πήραμε (και το raw σώμα)
    if (data) return json(data, 200);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return json(
      { error: { code: isAbort ? 504 : 500, status: isAbort ? 'UPSTREAM_TIMEOUT' : 'UNHANDLED', message: String(err?.message || err) } },
      isAbort ? 504 : 500
    );
  }
}