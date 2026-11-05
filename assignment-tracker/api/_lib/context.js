// Loads the user's data and turns it into a compact snapshot for the AI.
const { toLocal, localDate, weekdayName, startOfLocalDay, addDays } = require("./time");

const DEFAULT_PREFS = {
  wake_time: "07:30", bed_time: "23:00",
  work_start: "09:00", work_end: "21:00",
  focus_start: "09:00", focus_end: "12:00",
  break_minutes: 10, break_every_minutes: 90,
  timezone: "America/Toronto", ai_mode: "ask"
};

const hm = (t) => String(t || "").slice(0, 5);

async function loadPrefs(sb, userId) {
  const { data } = await sb.from("preferences").select("*").eq("user_id", userId).maybeSingle();
  return { ...DEFAULT_PREFS, ...(data || {}) };
}

async function loadBlocks(sb, tz, fromDate, toDate) {
  // fromDate inclusive, toDate exclusive, both "YYYY-MM-DD" local dates
  const { data, error } = await sb
    .from("schedule_blocks")
    .select("*")
    .gte("start_at", startOfLocalDay(fromDate, tz).toISOString())
    .lt("start_at", startOfLocalDay(toDate, tz).toISOString())
    .order("start_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return data || [];
}

function blockForAi(b, tz) {
  return {
    id: b.id,
    title: b.title,
    start: toLocal(b.start_at, tz),
    end: toLocal(b.end_at, tz),
    kind: b.kind,
    locked: !!b.locked,
    assignment_id: b.assignment_id || null,
    task_id: b.task_id || null
  };
}

async function loadContext(sb, userId, now = new Date()) {
  const prefs = await loadPrefs(sb, userId);
  const tz = prefs.timezone;
  const today = localDate(now, tz);

  const [a, t, g, blocks] = await Promise.all([
    sb.from("assignments").select("id,title,course,due_at,est_minutes")
      .eq("done", false).order("due_at", { ascending: true }).limit(60),
    sb.from("tasks").select("id,title,est_minutes,priority,deadline,status")
      .neq("status", "done").order("created_at", { ascending: true }).limit(80),
    sb.from("goals").select("title,done").eq("goal_date", today).limit(30),
    loadBlocks(sb, tz, today, addDays(today, 7))
  ]);
  for (const r of [a, t, g]) if (r.error) throw new Error(r.error.message);

  const assignments = (a.data || []).map((x) => ({
    id: x.id,
    title: x.title,
    course: x.course || null,
    due: toLocal(x.due_at, tz),
    est_minutes: x.est_minutes,
    overdue: new Date(x.due_at) < now
  }));
  const tasks = (t.data || []).map((x) => ({
    id: x.id,
    title: x.title,
    est_minutes: x.est_minutes,
    priority: x.priority, // 3 = high, 2 = medium, 1 = low
    deadline: x.deadline ? toLocal(x.deadline, tz) : null,
    status: x.status
  }));

  const snapshot = {
    now_local: toLocal(now, tz),
    weekday: weekdayName(now, tz),
    timezone: tz,
    preferences: {
      wake: hm(prefs.wake_time), bedtime: hm(prefs.bed_time),
      work_hours: `${hm(prefs.work_start)}-${hm(prefs.work_end)}`,
      focus_hours: `${hm(prefs.focus_start)}-${hm(prefs.focus_end)}`,
      break_minutes: prefs.break_minutes,
      break_every_minutes: prefs.break_every_minutes
    },
    assignments,
    tasks,
    goals_today: g.data || [],
    schedule_next_7_days: blocks.map((b) => blockForAi(b, tz))
  };

  return {
    prefs,
    snapshot,
    today,
    blocks,
    assignmentIds: new Set(assignments.map((x) => x.id)),
    taskIds: new Set(tasks.map((x) => x.id))
  };
}

module.exports = { loadContext, loadPrefs, loadBlocks, blockForAi, DEFAULT_PREFS };
