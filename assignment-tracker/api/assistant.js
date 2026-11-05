// POST /api/assistant  { message }  ->  { reply, proposals, warnings, autoApplicable }
const { authenticate, requirePost } = require("./_lib/auth");
const { runAssistant } = require("./_lib/ai");

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  const auth = await authenticate(req, res);
  if (!auth) return;

  const message = String((req.body && req.body.message) || "").trim();
  if (!message) return res.status(400).json({ error: "Type a message first." });
  if (message.length > 2000) return res.status(400).json({ error: "Message is too long (2000 characters max)." });

  try {
    const result = await runAssistant({ sb: auth.sb, user: auth.user, message });
    res.status(200).json(result);
  } catch (err) {
    console.error("assistant error:", err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
};
