// Public settings the browser needs to talk to Supabase. The anon key is meant to be public;
// Row Level Security in supabase/schema.sql keeps each user's data private.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  });
}
