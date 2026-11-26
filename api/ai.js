// FitFore AI endpoint: runs Claude for signed-in users, on the app owner's API key.
// Only fixed tasks are allowed (no free-form prompts), and each user gets a daily limit.

const MODELS = {
  quick: process.env.AI_MODEL_QUICK || 'claude-haiku-5-5',
  default: process.env.AI_MODEL_DEFAULT || 'claude-sonnet-5-5',
};
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 30);

const str = (v, max) => String(v ?? '').slice(0, max);
const clamp = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export const TASKS = {
  estimate: {
    tier: 'quick',
    maxTokens: 800,
    prompt: (i) =>
      'Estimate nutrition for this food log entry from a person tracking calories. Split it into separate foods. Use typical US portion sizes when the amount is not given, and include cooking fats or condiments that are mentioned. Reply with only JSON like {"items":[{"name":"2 large eggs, scrambled","cal":180,"p":12}]} where cal is calories and p is grams of protein, both whole numbers.\n\nEntry: ' +
      str(i.text, 1500),
  },
  tips: {
    tier: 'quick',
    maxTokens: 500,
    prompt: (i) =>
      'Give concise coaching for the strength exercise "' +
      str(i.name, 80) +
      '". Reply with only JSON like {"steps":["3 to 4 short how-to steps"],"mistakes":["2 common mistakes to avoid"]}. Each item under 15 words, plain language for someone training in a gym.',
  },
  coach: {
    tier: 'default',
    maxTokens: 1500,
    prompt: (i) => {
      const min = clamp(i.minutes, 10, 180, 45);
      return (
        'You are a golf coach building one practice session for an amateur golfer. Session length: ' + min +
        ' minutes. Their description of their game:\n"' + str(i.text, 2000) +
        '"\n\nBuild 2 to 5 drills that target the cause of their problem, with the minutes for each adding up to about ' + min +
        '. You may use drills from this library by exact name or give your own well-known drills: ' + str(i.library, 3000) +
        '. Write "how" as 1–3 plain sentences a golfer can follow alone at a range, and "goal" as a short measurable target. cat is one of putt, short, iron, driver, fit, mental. summary is one sentence on the likely cause and what the session fixes. Reply with only JSON like {"summary":"...","items":[{"name":"...","cat":"iron","min":15,"how":"...","goal":"..."}]}'
      );
    },
  },
  plan: {
    tier: 'default',
    maxTokens: 4000,
    prompt: (i) =>
      'Turn this workout plan into structured training days. Keep the person\'s own exercise names, sets, reps and notes; do not add exercises they did not list. weekday is 0=Sunday through 6=Saturday, or null if no day is given. Reply with only JSON like {"days":[{"name":"Push","focus":"chest, shoulders, triceps","weekday":1,"exercises":[{"name":"Bench press","sets":"4","reps":"8","note":"last set to failure"}]}]}\n\nPlan:\n' +
      str(i.text, 12000),
  },
};

export function parseJson(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

const fail = (res, status, code, error) => res.status(status).json({ code, error });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Use POST.');

  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY)
    return fail(res, 500, 'config', 'The server is missing its settings.');

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'auth', 'Sign in first.');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const task = TASKS[body && body.task];
  if (!task) return fail(res, 400, 'task', 'Unknown request.');
  const input = body.input && typeof body.input === 'object' ? body.input : {};

  // Check the user's sign-in and count this request against their daily limit.
  let used;
  try {
    const r = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/use_ai_credit', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (r.status === 401 || r.status === 403) return fail(res, 401, 'auth', 'Your sign-in expired.');
    if (!r.ok) return fail(res, 500, 'failed', 'Could not check your account.');
    used = Number(await r.json());
  } catch {
    return fail(res, 500, 'failed', 'Could not check your account.');
  }
  if (!(used <= DAILY_LIMIT)) return fail(res, 429, 'limit', 'Daily AI limit reached.');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELS[task.tier],
        max_tokens: task.maxTokens,
        messages: [{ role: 'user', content: task.prompt(input) }],
      }),
    });
    if (r.status === 429 || r.status === 529) return fail(res, 429, 'rate_limited', 'Busy right now.');
    if (!r.ok) {
      console.error('Anthropic error', r.status, (await r.text()).slice(0, 500));
      return fail(res, 502, 'failed', 'The AI request failed.');
    }
    const data = await r.json();
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const result = parseJson(text);
    if (!result) return fail(res, 502, 'failed', 'The AI reply could not be read.');
    return res.status(200).json({ result });
  } catch (e) {
    console.error('AI call failed', e);
    return fail(res, 502, 'failed', 'The AI request failed.');
  }
}
