// Checks the signed-in user's token and returns a database client that acts AS that
// user, so row-level security still applies to everything the functions do.
const { createClient } = require("@supabase/supabase-js");

function requirePost(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Use POST" });
    return false;
  }
  return true;
}

async function authenticate(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    res.status(500).json({ error: "Server is missing SUPABASE_URL or SUPABASE_ANON_KEY" });
    return null;
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data || !data.user) {
    res.status(401).json({ error: "Session expired. Sign in again." });
    return null;
  }
  return { sb, user: data.user };
}

module.exports = { authenticate, requirePost };
