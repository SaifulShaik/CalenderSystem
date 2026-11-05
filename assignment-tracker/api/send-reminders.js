// Called every ~5 minutes by a free scheduler (cron-job.org).
// Sends push alerts for: assignments due soon / overdue, task deadlines,
// schedule blocks about to start, and a morning summary.
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");
const { DEFAULT_PREFS } = require("./_lib/context");
const { localDate, localMinutes, startOfLocalDay, addDays, timeToMinutes } = require("./_lib/time");

const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const hoursLabel = (h) => (h === 1 ? "1 hour" : `${h} hours`);

module.exports = async (req, res) => {
  // Shared-secret check so nobody else can trigger this.
  if (!process.env.CRON_SECRET || req.query.key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const now = Date.now();
  const stats = { assignments: 0, overdue: 0, tasks: 0, blocks: 0, morning: 0, pushes: 0 };

  const [subsRes, prefsRes] = await Promise.all([
    sb.from("push_subscriptions").select("*"),
    sb.from("preferences").select("*")
  ]);
  if (subsRes.error) return res.status(500).json({ error: subsRes.error.message });

  const subsByUser = new Map();
  for (const s of subsRes.data || []) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id).push(s);
  }
  if (!subsByUser.size) return res.status(200).json({ ...stats, note: "no devices registered" });

  const prefsByUser = new Map((prefsRes.data || []).map((p) => [p.user_id, p]));
  const prefsOf = (uid) => ({
    ...DEFAULT_PREFS,
    remind_long_hours: 24,
    remind_short_hours: 2,
    alerts_blocks: true,
    alerts_morning: true,
    ...(prefsByUser.get(uid) || {})
  });
  const fmt = (value, tz) =>
    new Date(value).toLocaleString("en-CA", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });

  async function push(userId, payload) {
    const subs = subsByUser.get(userId) || [];
    const body = JSON.stringify(payload);
    let ok = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        ok++;
      } catch (err) {
        // Device unsubscribed or expired: clean it up.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await sb.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }
    stats.pushes += ok;
    return ok;
  }

  // ---- 1. assignments due soon ----
  {
    const { data } = await sb.from("assignments").select("*")
      .eq("done", false).gt("due_at", iso(now)).lt("due_at", iso(now + 72 * H)).limit(300);
    for (const a of data || []) {
      if (!subsByUser.has(a.user_id)) continue;
      const p = prefsOf(a.user_id);
      const ms = Date.parse(a.due_at) - now;
      let kind = null;
      if (ms <= p.remind_short_hours * H && !a.notified_hours) kind = "short";
      else if (ms <= p.remind_long_hours * H && !a.notified_day) kind = "long";
      if (!kind) continue;

      await push(a.user_id, {
        title: kind === "short" ? `Due in ${hoursLabel(p.remind_short_hours)}` : `Due within ${hoursLabel(p.remind_long_hours)}`,
        body: `${a.title}${a.course ? " (" + a.course + ")" : ""} - ${fmt(a.due_at, p.timezone)}`,
        tag: `${a.id}:${kind}`
      });
      await sb.from("assignments")
        .update(kind === "short" ? { notified_hours: true, notified_day: true } : { notified_day: true })
        .eq("id", a.id);
      stats.assignments++;
    }
  }

  // ---- 2. assignments that just became overdue ----
  {
    const { data } = await sb.from("assignments").select("*")
      .eq("done", false).eq("notified_overdue", false)
      .lte("due_at", iso(now)).gt("due_at", iso(now - 24 * H)).limit(300);
    for (const a of data || []) {
      if (!subsByUser.has(a.user_id)) continue;
      await push(a.user_id, {
        title: "Overdue",
        body: `${a.title}${a.course ? " (" + a.course + ")" : ""} was due ${fmt(a.due_at, prefsOf(a.user_id).timezone)}`,
        tag: `${a.id}:overdue`
      });
      await sb.from("assignments").update({ notified_overdue: true }).eq("id", a.id);
      stats.overdue++;
    }
  }

  // ---- 3. task deadlines ----
  {
    const { data } = await sb.from("tasks").select("*")
      .neq("status", "done").eq("notified", false)
      .not("deadline", "is", null).gt("deadline", iso(now)).lt("deadline", iso(now + 72 * H)).limit(300);
    for (const t of data || []) {
      if (!subsByUser.has(t.user_id)) continue;
      const p = prefsOf(t.user_id);
      if (Date.parse(t.deadline) - now > p.remind_long_hours * H) continue;
      await push(t.user_id, {
        title: `Task due within ${hoursLabel(p.remind_long_hours)}`,
        body: `${t.title} - ${fmt(t.deadline, p.timezone)}`,
        tag: `${t.id}:task`
      });
      await sb.from("tasks").update({ notified: true }).eq("id", t.id);
      stats.tasks++;
    }
  }

  // ---- 4. schedule blocks starting within 10 minutes ----
  {
    const { data } = await sb.from("schedule_blocks").select("*")
      .eq("notified", false)
      .gte("start_at", iso(now - 2 * 60 * 1000)).lte("start_at", iso(now + 10 * 60 * 1000)).limit(300);
    for (const b of data || []) {
      if (!subsByUser.has(b.user_id)) continue;
      const p = prefsOf(b.user_id);
      if (p.alerts_blocks) {
        const time = new Date(b.start_at).toLocaleTimeString("en-CA", {
          timeZone: p.timezone, hour: "numeric", minute: "2-digit"
        });
        await push(b.user_id, { title: "Starting soon", body: `${time}: ${b.title}`, tag: `${b.id}:block` });
        stats.blocks++;
      }
      await sb.from("schedule_blocks").update({ notified: true }).eq("id", b.id);
    }
  }

  // ---- 5. morning summary (once a day, after your wake-up time) ----
  for (const uid of subsByUser.keys()) {
    const p = prefsOf(uid);
    if (!p.alerts_morning) continue;
    const today = localDate(now, p.timezone);
    if (p.last_morning_date === today) continue;
    const mins = localMinutes(now, p.timezone);
    const wake = timeToMinutes(p.wake_time);
    if (mins < wake || mins >= wake + 90) continue;

    const dayStart = startOfLocalDay(today, p.timezone).toISOString();
    const dayEnd = startOfLocalDay(addDays(today, 1), p.timezone).toISOString();
    const soon = iso(now + 48 * H);
    const [b, g, a, t] = await Promise.all([
      sb.from("schedule_blocks").select("id", { count: "exact", head: true })
        .eq("user_id", uid).gte("start_at", dayStart).lt("start_at", dayEnd),
      sb.from("goals").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("goal_date", today),
      sb.from("assignments").select("id", { count: "exact", head: true })
        .eq("user_id", uid).eq("done", false).gt("due_at", iso(now)).lt("due_at", soon),
      sb.from("tasks").select("id", { count: "exact", head: true })
        .eq("user_id", uid).neq("status", "done").not("deadline", "is", null).gt("deadline", iso(now)).lt("deadline", soon)
    ]);
    const parts = [
      `${b.count || 0} block${b.count === 1 ? "" : "s"} planned`,
      `${g.count || 0} goal${g.count === 1 ? "" : "s"}`,
      `${(a.count || 0) + (t.count || 0)} due within 48 hours`
    ];
    await push(uid, { title: "Good morning", body: parts.join(" · ") + ". Open the app to plan your day.", tag: `morning:${today}` });
    await sb.from("preferences").upsert({ user_id: uid, last_morning_date: today }, { onConflict: "user_id" });
    stats.morning++;
  }

  res.status(200).json(stats);
};
