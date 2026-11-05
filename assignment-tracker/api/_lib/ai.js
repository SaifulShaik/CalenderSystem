// Runs one assistant request: loads your data, asks Claude (with tools), and
// returns a reply plus PROPOSED schedule changes. Nothing is applied here.
const Anthropic = require("@anthropic-ai/sdk");
const { loadContext } = require("./context");
const { TOOL_DEFS, createToolState, runTool, isAutoApplicable } = require("./tools");

const MAX_TOOL_ROUNDS = 8;
const HISTORY_MESSAGES = 10;      // keep each request small and cheap
const MAX_USER_MESSAGES_PER_HOUR = 40;

const SYSTEM_PROMPT = `You are the scheduling assistant inside one person's private assignment and time-management app. You help them plan their day and week and you change their schedule when they ask.

How you work:
- Each user message begins with a <context> JSON snapshot of their assignments, tasks, goals, schedule for the next 7 days, preferences and the current local time. Use it. Do not ask for information that is already in it.
- You cannot change the schedule directly. You call propose_* tools to suggest changes, and the user reviews them and taps Apply. Write your reply as if the proposals are suggestions, for example "Here is what I suggest".
- All times you read and write are the user's LOCAL time as YYYY-MM-DDTHH:mm. Never schedule anything before now_local unless the user explicitly asks.
- Never move or remove a block with locked=true. If something locked is in the way, work around it or flag it.

Scheduling rules:
1. Earliest deadline first, then higher priority (3 is high), then shorter jobs. Overdue items come first.
2. Put demanding work (assignments, hard tasks) in the user's focus hours; use gaps and the rest of the work hours for lighter tasks.
3. Stay inside work_hours (unless the user says otherwise) and never schedule past bedtime.
4. Add a short break (break_minutes) after about every break_every_minutes of continuous work. Use kind "break" for breaks.
5. Leave roughly 15 percent slack so one delay does not wreck the day. Do not stack blocks back to back all day.
6. Size blocks from est_minutes. Split a long item (over about 2 hours) into several sessions on different slots or days, ending before its deadline.
7. Link each block to its assignment or task using assignment_id or task_id, and set kind to match.
8. Avoid overlaps. If a propose tool reports overlaps_with, fix it with another proposal or choose a different time.
9. If everything cannot fit, say plainly what will not fit and use flag_problem. Suggest what to drop or move rather than squeezing it in.
10. Only schedule what the user asked for. For a vague request like "plan my day", schedule today's remaining open work, not the whole week.

Reply style: short and plain, no markdown headers, no emoji. Give one line per change at most, then any warning. If you are only answering a question, answer it directly without proposals. Never mention tool names or ids to the user.`;

function textOf(content) {
  return (content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function runAssistant({ sb, user, message }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error("The server has no ANTHROPIC_API_KEY set.");
    e.status = 500;
    throw e;
  }

  // Cost guard: cap how many requests per hour.
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await sb
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .eq("role", "user")
    .gte("created_at", since);
  if ((count || 0) >= MAX_USER_MESSAGES_PER_HOUR) {
    const e = new Error("Hourly AI message limit reached. Try again later.");
    e.status = 429;
    throw e;
  }

  const ctx = await loadContext(sb, user.id);
  const state = createToolState(ctx);

  // Recent chat (plain text only), oldest first, starting with a user turn.
  const { data: hist } = await sb
    .from("ai_messages")
    .select("role,content,created_at")
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);
  let history = (hist || []).reverse().map((m) => ({ role: m.role, content: m.content }));
  while (history.length && history[0].role !== "user") history.shift();

  const messages = [
    ...history,
    {
      role: "user",
      content: `<context>\n${JSON.stringify(ctx.snapshot)}\n</context>\n\n${message}`
    }
  ];

  const client = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFS,
      messages
    });

    if (resp.stop_reason !== "tool_use") {
      reply = textOf(resp.content);
      break;
    }

    messages.push({ role: "assistant", content: resp.content });
    const results = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      const out = await runTool(block.name, block.input, state, sb);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(out),
        ...(out.ok === false ? { is_error: true } : {})
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!reply) {
    reply = state.proposals.length
      ? "Here is what I came up with."
      : "I could not finish that. Try asking again, or break the request into smaller steps.";
  }

  // Remember the exchange (plain text, without the data snapshot).
  await sb.from("ai_messages").insert([
    { user_id: user.id, role: "user", content: message },
    { user_id: user.id, role: "assistant", content: reply }
  ]);

  return {
    reply,
    proposals: state.proposals,
    warnings: state.warnings,
    autoApplicable: isAutoApplicable(state.proposals)
  };
}

module.exports = { runAssistant };
