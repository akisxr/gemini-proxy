// Robust Gemini proxy handler for Vercel/Next.js (pages API)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Accept either {prompt} or full {contents} and optional {model}
    const { prompt, contents, model } = (req.body || {});

    if (!contents && (!prompt || typeof prompt !== 'string')) {
      return res.status(400).json({ error: 'Provide either "prompt" (string) or "contents" (array).' });
    }

    const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'Missing GOOGLE_API_KEY (or GEMINI_API_KEY)' });
    }

    // --- API version & model normalization ---
    const API_VERSION = process.env.GEMINI_API_VERSION || 'v1'; // v1 is current stable
    const rawModel = (model && String(model)) || process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    const normalizeModel = (m) => {
      const map = {
        'gemini-pro': 'gemini-1.5-pro',
        'gemini-pro-latest': 'gemini-1.5-pro-latest',
        'gemini-1.5-pro': 'gemini-1.5-pro',
        'gemini-1.5-flash': 'gemini-1.5-flash',
        'gemini-1.5-pro-001': 'gemini-1.5-pro',
        'gemini-1.5-flash-001': 'gemini-1.5-flash',
        'gemini-1': 'gemini-1.5-pro',
      };
      let out = map[m] || m;
      if (!/-\d+$/.test(out) && !/-latest$/.test(out)) out = `${out}-latest`; // prefer -latest
      return out;
    };

    const MODEL = normalizeModel(rawModel);
    const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL}:generateContent?key=${API_KEY}`;

    const payload = contents && Array.isArray(contents)
      ? { contents }
      : { contents: [{ role: 'user', parts: [{ text: String(prompt) }] }] };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const status = data?.error?.code || r.status;
      return res.status(status).json({ error: data?.error || data || { message: 'Unknown error' } });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.output ?? '';

    return res.status(200).json({ model: MODEL, text, raw: data });
  } catch (err) {
    console.error('[gemini] Handler error:', err);
    return res.status(500).json({ error: String(err) });
  }
}