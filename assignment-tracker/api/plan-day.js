// POST /api/plan-day  ->  same response as /api/assistant, using a ready-made request
const { authenticate, requirePost } = require("./_lib/auth");
const { runAssistant } = require("./_lib/ai");

const PLAN_MESSAGE =
  "Plan the rest of my day today. Fit my open assignments and tasks (most urgent first) into the free time between now and bedtime, " +
  "keep my existing blocks as they are unless they clearly conflict, add breaks, and tell me if anything will not fit.";

module.exports = async (req, res) => {
  if (!requirePost(req, res)) return;
  const auth = await authenticate(req, res);
  if (!auth) return;

  try {
    const result = await runAssistant({ sb: auth.sb, user: auth.user, message: PLAN_MESSAGE });
    res.status(200).json(result);
  } catch (err) {
    console.error("plan-day error:", err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
};
