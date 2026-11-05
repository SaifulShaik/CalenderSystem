// POST /api/undo-change  { change_id }  ->  { ok: true }
// Puts the schedule back exactly as it was before an AI change was applied.
const { authenticate, requirePost } = require("./_lib/auth");

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  const auth = await authenticate(req, res);
  if (!auth) return;
  const { sb, user } = auth;

  const id = req.body && req.body.change_id;
  if (!id) return res.status(400).json({ error: "Missing change_id." });

  const { data: change, error } = await sb.from("ai_changes").select("*").eq("id", id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!change) return res.status(404).json({ error: "Change not found." });
  if (change.undone) return res.status(409).json({ error: "That change was already undone." });

  const before = change.before_json || {};
  const after = change.after_json || {};
  const problems = [];

  // 1. remove what was added
  if ((after.added_blocks || []).length) {
    const { error: e } = await sb.from("schedule_blocks").delete().in("id", after.added_blocks);
    if (e) problems.push(e.message);
  }
  if ((after.added_tasks || []).length) {
    const { error: e } = await sb.from("tasks").delete().in("id", after.added_tasks);
    if (e) problems.push(e.message);
  }

  // 2. put moved blocks back
  for (const m of before.moved || []) {
    const { error: e } = await sb
      .from("schedule_blocks")
      .update({ start_at: m.start_at, end_at: m.end_at, notified: m.notified ?? false })
      .eq("id", m.id);
    if (e) problems.push(e.message);
  }

  // 3. bring back removed blocks (same ids, so links keep working)
  for (const row of before.removed || []) {
    const { error: e } = await sb.from("schedule_blocks").insert({ ...row, user_id: user.id });
    if (e && !/duplicate key/i.test(e.message)) problems.push(e.message);
  }

  await sb.from("ai_changes").update({ undone: true }).eq("id", change.id);

  if (problems.length) {
    return res.status(200).json({ ok: true, warning: "Undone, with some problems: " + problems.join("; ") });
  }
  res.status(200).json({ ok: true });
};
