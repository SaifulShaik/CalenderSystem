// Tools the AI can call. Read tools fetch data; "propose" tools only RECORD a
// suggested change. Nothing touches the schedule until the user taps Apply.
const { zonedToUtc, addDays } = require("./time");
const { loadBlocks, blockForAi } = require("./context");

const KINDS = ["assignment", "task", "goal", "break", "other"];
const LOCAL_FORMAT = "Local date and time as YYYY-MM-DDTHH:mm (24-hour, user's time zone)";

const TOOL_DEFS = [
  {
    name: "get_schedule",
    description:
      "Read schedule blocks between two local dates. The next 7 days are already in the context, so use this only for other ranges.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "First day, YYYY-MM-DD (inclusive)" },
        date_to: { type: "string", description: "Last day, YYYY-MM-DD (exclusive)" }
      },
      required: ["date_from", "date_to"]
    }
  },
  {
    name: "propose_add_block",
    description:
      "Propose a new schedule block. Link it to an assignment or task by id when it is work on one of them.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: LOCAL_FORMAT },
        end: { type: "string", description: LOCAL_FORMAT },
        kind: { type: "string", enum: KINDS },
        assignment_id: { type: "string" },
        task_id: { type: "string" }
      },
      required: ["title", "start", "end", "kind"]
    }
  },
  {
    name: "propose_move_block",
    description: "Propose moving an existing block to a new time. Locked blocks cannot be moved.",
    input_schema: {
      type: "object",
      properties: {
        block_id: { type: "string" },
        new_start: { type: "string", description: LOCAL_FORMAT },
        new_end: { type: "string", description: LOCAL_FORMAT }
      },
      required: ["block_id", "new_start", "new_end"]
    }
  },
  {
    name: "propose_remove_block",
    description: "Propose deleting an existing block. Locked blocks cannot be removed.",
    input_schema: {
      type: "object",
      properties: { block_id: { type: "string" } },
      required: ["block_id"]
    }
  },
  {
    name: "propose_add_task",
    description: "Propose a new to-do task (for something the user mentioned that is not tracked yet).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        est_minutes: { type: "integer", description: "Estimated minutes, 5 to 600" },
        priority: { type: "integer", description: "1 low, 2 medium, 3 high" },
        deadline: { type: "string", description: LOCAL_FORMAT + ". Optional." }
      },
      required: ["title"]
    }
  },
  {
    name: "flag_problem",
    description:
      "Warn the user about a conflict or something that cannot fit (for example an overbooked day). One short sentence.",
    input_schema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"]
    }
  }
];

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};

const overlaps = (a, b) => a.start < b.end && a.end > b.start;

// ---- the "virtual schedule": existing blocks with all proposals applied ----
function virtualSchedule(state) {
  const view = new Map();
  for (const b of state.blocks.values()) {
    view.set(b.id, { id: b.id, title: b.title, start: +new Date(b.start_at), end: +new Date(b.end_at) });
  }
  for (const p of state.proposals) {
    if (p.op === "add_block") {
      view.set(p.id, { id: p.id, title: p.title, start: +new Date(p.start_at), end: +new Date(p.end_at) });
    } else if (p.op === "move_block" && view.has(p.block_id)) {
      const v = view.get(p.block_id);
      v.start = +new Date(p.start_at);
      v.end = +new Date(p.end_at);
    } else if (p.op === "remove_block") {
      view.delete(p.block_id);
    }
  }
  return view;
}

function conflictsFor(state, selfId, startMs, endMs) {
  const out = [];
  for (const v of virtualSchedule(state).values()) {
    if (v.id === selfId) continue;
    if (overlaps({ start: startMs, end: endMs }, v)) out.push(v.title);
  }
  return out;
}

function parseRange(startLocal, endLocal, tz) {
  const start = zonedToUtc(startLocal, tz);
  const end = zonedToUtc(endLocal, tz);
  if (!(end > start)) throw new Error("end must be after start");
  if (end - start > 12 * 3600 * 1000) throw new Error("a block cannot be longer than 12 hours");
  return { start, end };
}

// ---- state + runner ----
function createToolState(ctx) {
  const blocks = new Map();
  for (const b of ctx.blocks) blocks.set(b.id, b);
  return {
    tz: ctx.prefs.timezone,
    blocks,
    assignmentIds: ctx.assignmentIds,
    taskIds: ctx.taskIds,
    proposals: [],
    warnings: [],
    counter: 0
  };
}

async function runTool(name, input, state, sb) {
  const tz = state.tz;
  const nextId = () => `p${++state.counter}`;
  input = input || {};

  try {
    if (name === "get_schedule") {
      const from = String(input.date_from || "");
      const to = String(input.date_to || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return { ok: false, error: "dates must be YYYY-MM-DD" };
      }
      const safeTo = to > addDays(from, 31) ? addDays(from, 31) : to;
      const rows = await loadBlocks(sb, tz, from, safeTo);
      for (const b of rows) state.blocks.set(b.id, b);
      return { ok: true, blocks: rows.map((b) => blockForAi(b, tz)) };
    }

    if (name === "propose_add_block") {
      const title = String(input.title || "").trim().slice(0, 120);
      if (!title) return { ok: false, error: "title is required" };
      const { start, end } = parseRange(input.start, input.end, tz);
      const kind = KINDS.includes(input.kind) ? input.kind : "other";
      let assignment_id = input.assignment_id || null;
      let task_id = input.task_id || null;
      if (assignment_id && !state.assignmentIds.has(assignment_id)) {
        return { ok: false, error: "unknown assignment_id; use an id from the context or omit it" };
      }
      if (task_id && !state.taskIds.has(task_id)) {
        return { ok: false, error: "unknown task_id; use an id from the context or omit it" };
      }
      const p = {
        id: nextId(), op: "add_block", title,
        start_at: start.toISOString(), end_at: end.toISOString(),
        kind, assignment_id, task_id
      };
      const conflicts = conflictsFor(state, p.id, +start, +end);
      state.proposals.push(p);
      return { ok: true, proposal_id: p.id, overlaps_with: conflicts };
    }

    if (name === "propose_move_block") {
      const b = state.blocks.get(input.block_id);
      if (!b) return { ok: false, error: "no such block_id" };
      if (b.locked) return { ok: false, error: `"${b.title}" is locked and must not be moved` };
      const { start, end } = parseRange(input.new_start, input.new_end, tz);
      const p = {
        id: nextId(), op: "move_block", block_id: b.id, title: b.title,
        start_at: start.toISOString(), end_at: end.toISOString(),
        from: { start_at: b.start_at, end_at: b.end_at }
      };
      const conflicts = conflictsFor(state, b.id, +start, +end);
      state.proposals.push(p);
      return { ok: true, proposal_id: p.id, overlaps_with: conflicts };
    }

    if (name === "propose_remove_block") {
      const b = state.blocks.get(input.block_id);
      if (!b) return { ok: false, error: "no such block_id" };
      if (b.locked) return { ok: false, error: `"${b.title}" is locked and must not be removed` };
      const p = {
        id: nextId(), op: "remove_block", block_id: b.id, title: b.title,
        from: { start_at: b.start_at, end_at: b.end_at }
      };
      state.proposals.push(p);
      return { ok: true, proposal_id: p.id };
    }

    if (name === "propose_add_task") {
      const title = String(input.title || "").trim().slice(0, 120);
      if (!title) return { ok: false, error: "title is required" };
      let deadline = null;
      if (input.deadline) deadline = zonedToUtc(input.deadline, tz).toISOString();
      const p = {
        id: nextId(), op: "add_task", title,
        est_minutes: clamp(input.est_minutes, 5, 600, 30),
        priority: clamp(input.priority, 1, 3, 2),
        deadline
      };
      state.proposals.push(p);
      return { ok: true, proposal_id: p.id };
    }

    if (name === "flag_problem") {
      const msg = String(input.message || "").trim().slice(0, 300);
      if (msg) state.warnings.push(msg);
      return { ok: true };
    }

    return { ok: false, error: `unknown tool ${name}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// "Small" changes may be applied without asking when the user turned on auto-apply:
// shifts of 30 minutes or less, short new blocks, new tasks. Never removals.
function isAutoApplicable(proposals) {
  if (!proposals.length) return false;
  const MIN30 = 30 * 60 * 1000;
  return proposals.every((p) => {
    if (p.op === "add_task") return true;
    if (p.op === "add_block") return new Date(p.end_at) - new Date(p.start_at) <= MIN30;
    if (p.op === "move_block") {
      return (
        Math.abs(new Date(p.start_at) - new Date(p.from.start_at)) <= MIN30 &&
        Math.abs(new Date(p.end_at) - new Date(p.from.end_at)) <= MIN30
      );
    }
    return false;
  });
}

module.exports = { TOOL_DEFS, createToolState, runTool, isAutoApplicable, virtualSchedule, KINDS };
