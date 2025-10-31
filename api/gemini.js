export const config = { runtime: 'edge' };

function toModelName(input) {
  if (input && typeof input === 'string' && input.trim()) return input.trim();
  return 'gemini-2.5-flash'; // default σε μοντέλο που το κλειδί σου όντως βλέπει
}

function buildPayload(body) {
  if (body && typeof body === 'object') {
    if (body.contents) return body; // ωμή Gemini payload
    if (typeof body.prompt === 'string') {
      return {
        contents: [{ role: 'user', parts: [{ text: body.prompt }] }],
      };
    }
  }
  return { contents: [{ parts: [{ text: 'Hello' }] }] };
}

export default async function handler(req) {
  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return new Response(
        JSON.stringify({ error: { code: 500, status: 'MISSING_API_KEY', message: 'Missing GEMINI_API_KEY in environment.' } }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const model = toModelName(body.model);
    const payload = buildPayload(body);

    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: data.error || { code: r.status, status: 'UPSTREAM_ERROR', message: 'Upstream request failed.' } }),
        { status: r.status, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { code: 500, status: 'UNHANDLED', message: err?.message || 'Unexpected error' } }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}