// POST /api/apply-changes  { proposals: [...], summary }  ->  { change_id, applied, skipped }
// Applies changes the user approved and records exactly what happened, so Undo works.
const { authenticate, requirePost } = require("./_lib/auth");
const { KINDS } = require("./_lib/tools");

const validDate = (v) => v && !Number.isNaN(new Date(v).getTime());

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  const auth = await authenticate(req, res);
  if (!auth) return;
  const { sb, user } = auth;

  const proposals = Array.isArray(req.body && req.body.proposals) ? req.body.proposals : [];
  if (!proposals.length) return res.status(400).json({ error: "Nothing to apply." });
  if (proposals.length > 40) return res.status(400).json({ error: "Too many changes at once." });

  const before = { moved: [], removed: [] };
  const after = { added_blocks: [], added_tasks: [] };
  const skipped = [];
  let applied = 0;

  for (const p of proposals) {
    try {
      if (p.op === "add_block") {
        if (!validDate(p.start_at) || !validDate(p.end_at) || !(new Date(p.end_at) > new Date(p.start_at))) {
          throw new Error("invalid times");
        }
        const row = {
          user_id: user.id,
          title: String(p.title || "").trim().slice(0, 120),
          start_at: new Date(p.start_at).toISOString(),
          end_at: new Date(p.end_at).toISOString(),
          kind: KINDS.includes(p.kind) ? p.kind : "other",
          assignment_id: p.assignment_id || null,
          task_id: p.task_id || null,
          created_by: "ai"
        };
        if (!row.title) throw new Error("missing title");
        const { data, error } = await sb.from("schedule_blocks").insert(row).select("id").single();
        if (error) throw new Error(error.message);
        after.added_blocks.push(data.id);
        applied++;
      } else if (p.op === "move_block") {
        if (!validDate(p.start_at) || !validDate(p.end_at) || !(new Date(p.end_at) > new Date(p.start_at))) {
          throw new Error("invalid times");
        }
        const { data: cur, error: e1 } = await sb.from("schedule_blocks").select("*").eq("id", p.block_id).maybeSingle();
        if (e1) throw new Error(e1.message);
        if (!cur) throw new Error("block no longer exists");
        if (cur.locked) throw new Error("block is locked");
        const old = { id: cur.id, start_at: cur.start_at, end_at: cur.end_at, notified: cur.notified };
        const { error } = await sb.from("schedule_blocks")
          .update({
            start_at: new Date(p.start_at).toISOString(),
            end_at: new Date(p.end_at).toISOString(),
            notified: false
          })
          .eq("id", cur.id);
        if (error) throw new Error(error.message);
        before.moved.push(old);
        applied++;
      } else if (p.op === "remove_block") {
        const { data: cur, error: e1 } = await sb.from("schedule_blocks").select("*").eq("id", p.block_id).maybeSingle();
        if (e1) throw new Error(e1.message);
        if (!cur) throw new Error("block no longer exists");
        if (cur.locked) throw new Error("block is locked");
        const { error } = await sb.from("schedule_blocks").delete().eq("id", cur.id);
        if (error) throw new Error(error.message);
        before.removed.push(cur);
        applied++;
      } else if (p.op === "add_task") {
        const row = {
          user_id: user.id,
          title: String(p.title || "").trim().slice(0, 120),
          est_minutes: Math.min(600, Math.max(5, Math.round(Number(p.est_minutes) || 30))),
          priority: Math.min(3, Math.max(1, Math.round(Number(p.priority) || 2))),
          deadline: validDate(p.deadline) ? new Date(p.deadline).toISOString() : null
        };
        if (!row.title) throw new Error("missing title");
        const { data, error } = await sb.from("tasks").insert(row).select("id").single();
        if (error) throw new Error(error.message);
        after.added_tasks.push(data.id);
        applied++;
      } else {
        throw new Error("unknown change type");
      }
    } catch (err) {
      skipped.push({ id: p.id, title: p.title, reason: err.message });
    }
  }

  let change_id = null;
  if (applied > 0) {
    const summary = String((req.body && req.body.summary) || `${applied} change${applied === 1 ? "" : "s"}`).slice(0, 300);
    const { data, error } = await sb
      .from("ai_changes")
      .insert({ user_id: user.id, summary, before_json: before, after_json: after })
      .select("id")
      .single();
    if (error) {
      // The changes DID happen; tell the user Undo is unavailable instead of failing.
      return res.status(200).json({ change_id: null, applied, skipped, warning: "Applied, but Undo could not be saved." });
    }
    change_id = data.id;
  }

  res.status(200).json({ change_id, applied, skipped });
};
