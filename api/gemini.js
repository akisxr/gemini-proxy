export const config = { runtime: 'edge' };

// ασφαλές default (και από ENV αν θέλεις)
const DEFAULT_MODEL = (process.env.DEFAULT_GEMINI_MODEL || 'gemini-2.5-flash').trim();

// χαρτογράφηση για λάθος/παλιά ονόματα
function normalizeModel(input) {
  let m = (typeof input === 'string' && input.trim()) ? input.trim() : DEFAULT_MODEL;
  // βγάλε οποιοδήποτε "-latest"
  m = m.replace(/-latest$/i, '');

  // αν κάποιος περάσει 1.5-flash, σπρώξ' το στο 2.5-flash που έχεις ενεργό
  if (/^gemini-1\.5-flash$/i.test(m)) return 'gemini-2.5-flash';

  return m;
}

function buildPayload(body) {
  if (body && typeof body === 'object') {
    if (body.contents) return body; // raw Gemini payload
    if (typeof body.prompt === 'string') {
      return { contents: [{ role: 'user', parts: [{ text: body.prompt }] }] };
    }
  }
  return { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] };
}

export default async function handler(req) {
  // Healthcheck & debug: GET /api/gemini?debug=1
  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (url.searchParams.get('debug') === '1') {
      return new Response(
        JSON.stringify({
          ok: true,
          defaultModel: DEFAULT_MODEL,
          commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
          project: process.env.VERCEL_PROJECT_PRODUCTION_URL || null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('OK', { status: 200 });
  }

  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return new Response(
        JSON.stringify({ error: { code: 500, status: 'MISSING_API_KEY', message: 'Missing GEMINI_API_KEY in environment.' } }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const model = normalizeModel(body.model);
    const payload = buildPayload(body);
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;

    // timeout: πιο χαλαρό για pro
    const isPro = /-pro$/i.test(model);
    const controller = new AbortController();
    const timeoutMs = isPro ? 45000 : 20000; // 45s για pro, 20s για flash
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).catch((err) => {
      throw new Error(err?.message || 'FETCH_FAILED');
    });
    clearTimeout(t);

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: data.error || {
            code: r.status,
            status: 'UPSTREAM_ERROR',
            message: 'Upstream request failed.',
          },
        }),
        { status: r.status, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    const isAbort = (err?.name === 'AbortError') || /aborted/i.test(err?.message || '');
    return new Response(
      JSON.stringify({
        error: {
          code: isAbort ? 504 : 500,
          status: isAbort ? 'UPSTREAM_TIMEOUT' : 'UNHANDLED',
          message: err?.message || 'Unexpected error',
        },
      }),
      { status: isAbort ? 504 : 500, headers: { 'content-type': 'application/json' } }
    );
  }
}