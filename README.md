# FitFore

Fitness built for golfers: calorie counting, workout plans and golf training in one app.

## How it fits together

| Piece | What it does |
| --- | --- |
| `index.html` | The whole app (Food, Workout, Golf, Week, Goals) plus sign-in |
| `api/ai.js` | Server function that runs Claude for Estimate calories, Coach me, Build my plan and form tips. Signed-in users only, with a daily limit per user |
| `api/config.js` | Gives the browser the public Supabase settings |
| `supabase/schema.sql` | Database tables and privacy rules. Run once in Supabase |
| `privacy.html`, `terms.html` | Legal pages |

No build step and no packages: Vercel serves the files and runs the `api` folder.

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers**: make sure Email is on.
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.

### 2. Anthropic
1. console.anthropic.com → add billing → **set a monthly spend limit**.
2. Create an API key. Never put it in the code or share it.

### 3. Vercel
1. Sign up with GitHub → **Add New → Project** → import `fitfore`.
2. Framework preset: **Other**. Leave build settings empty.
3. **Environment Variables**:
   - `ANTHROPIC_API_KEY` — your Anthropic key
   - `SUPABASE_URL` — Project URL
   - `SUPABASE_ANON_KEY` — anon / publishable key
   - optional `AI_DAILY_LIMIT` — AI requests per user per day (default 30)
4. **Deploy**.

### 4. Connect them
In Supabase → **Authentication → URL Configuration**, set **Site URL** to your Vercel address (for example `https://fitfore.vercel.app`, later your own domain). This makes the confirmation and password-reset emails link back to the app.

## Tests

`npm test` checks the AI server function (sign-in check, daily limit, task list) with fake network calls.
