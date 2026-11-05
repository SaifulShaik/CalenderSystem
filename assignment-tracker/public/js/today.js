// Today: goals, what is next on your schedule, and what is due soon.
(function () {
  const App = window.App;
  const { esc } = App;
  const DAY = 24 * 3600 * 1000;

  // Create today's copy of each recurring goal (daily / weekdays) if missing.
  async function ensureRecurring(today) {
    const [tpl, have] = await Promise.all([
      App.sb.from("goals").select("*").neq("recurring", "none").is("goal_date", null),
      App.sb.from("goals").select("template_id").eq("goal_date", today).not("template_id", "is", null)
    ]);
    const haveSet = new Set((have.data || []).map((g) => g.template_id));
    const dow = new Date().getDay(); // 0 = Sunday
    const jobs = [];
    for (const t of tpl.data || []) {
      if (t.recurring === "weekdays" && (dow === 0 || dow === 6)) continue;
      if (haveSet.has(t.id)) continue;
      jobs.push(
        App.sb.from("goals").insert({ user_id: App.user.id, title: t.title, goal_date: today, template_id: t.id })
      );
    }
    await Promise.all(jobs); // a duplicate from another device is rejected by the database, which is fine
  }

  // Days in a row where every goal was completed (today counts only once finished).
  async function streak(today) {
    const since = App.dateStr(new Date(Date.now() - 60 * DAY));
    const { data } = await App.sb.from("goals").select("goal_date,done").gte("goal_date", since).lte("goal_date", today);
    const byDay = new Map();
    for (const g of data || []) {
      const d = byDay.get(g.goal_date) || { n: 0, done: 0 };
      d.n++; if (g.done) d.done++;
      byDay.set(g.goal_date, d);
    }
    let count = 0;
    for (let i = 0; i < 60; i++) {
      const day = App.dateStr(new Date(Date.now() - i * DAY));
      const d = byDay.get(day);
      const complete = d && d.n > 0 && d.done === d.n;
      if (complete) count++;
      else if (i > 0) break; // today unfinished does not break the streak yet
    }
    return count;
  }

  function goalForm() {
    return App.form({
      title: "Add a daily goal",
      fields: [
        { name: "title", label: "Goal", required: true, placeholder: "e.g. Read 20 pages" },
        {
          name: "repeat", label: "Repeat", type: "select", value: "none",
          options: [
            { value: "none", label: "Just today" },
            { value: "daily", label: "Every day" },
            { value: "weekdays", label: "Weekdays" }
          ]
        }
      ],
      onSubmit: async (v) => {
        const title = v.title.trim();
        if (!title) throw new Error("Type a goal.");
        const today = App.dateStr();
        if (v.repeat === "none") {
          const { error } = await App.sb.from("goals").insert({ user_id: App.user.id, title, goal_date: today });
          if (error) throw error;
        } else {
          const { error } = await App.sb.from("goals").insert({ user_id: App.user.id, title, recurring: v.repeat, goal_date: null });
          if (error) throw error;
          // ensureRecurring on next render creates today's copy
        }
      }
    });
  }
  App.goalForm = goalForm;

  App.screens.today = {
    async render(el) {
      const today = App.dateStr();
      await ensureRecurring(today);

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + DAY);
      const soon = new Date(now.getTime() + 2 * DAY).toISOString();

      const [goals, blocks, assignments, tasks, st, streakN] = await Promise.all([
        App.sb.from("goals").select("*").eq("goal_date", today).order("created_at"),
        App.sb.from("schedule_blocks").select("*")
          .gte("start_at", startOfDay.toISOString()).lt("start_at", endOfDay.toISOString()).order("start_at"),
        App.sb.from("assignments").select("*").eq("done", false).lt("due_at", soon).order("due_at"),
        App.sb.from("tasks").select("*").neq("status", "done").not("deadline", "is", null).lt("deadline", soon).order("deadline"),
        App.push.status(),
        streak(today)
      ]);
      for (const r of [goals, blocks, assignments, tasks]) if (r.error) throw r.error;

      const goalList = goals.data || [];
      const doneN = goalList.filter((g) => g.done).length;
      const pct = goalList.length ? Math.round((doneN / goalList.length) * 100) : 0;

      const upcoming = (blocks.data || []).filter((b) => new Date(b.end_at) > now);
      const past = (blocks.data || []).filter((b) => new Date(b.end_at) <= now);

      const due = []
        .concat((assignments.data || []).map((a) => ({ title: a.title, sub: a.course, when: a.due_at, kind: "Assignment" })))
        .concat((tasks.data || []).map((t) => ({ title: t.title, sub: null, when: t.deadline, kind: "Task" })))
        .sort((a, b) => new Date(a.when) - new Date(b.when));

      const alertsBanner =
        st.state === "off" || st.state === "needs-install" || st.state === "blocked"
          ? `<div class="notice">${esc(st.message)}${st.state === "off" ? ' <button class="small" id="enable-alerts" style="margin-left:6px">Turn on</button>' : ""}</div>`
          : "";

      el.innerHTML = `
        <div class="screen-head">
          <div>
            <h1>${esc(App.fmtDay())}</h1>
          </div>
        </div>
        ${alertsBanner}

        <div class="card">
          <div class="card-head">
            <h2>Daily goals</h2>
            <span class="muted small">${doneN} / ${goalList.length} done${streakN > 1 ? ` · ${streakN}-day streak` : ""}</span>
          </div>
          ${goalList.length ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ""}
          <div id="goal-list">
            ${goalList.length
              ? goalList.map((g) => `
                <div class="goal ${g.done ? "done" : ""}" data-id="${g.id}">
                  <input type="checkbox" ${g.done ? "checked" : ""} aria-label="Done">
                  <span class="grow">${esc(g.title)}</span>
                  <button class="icon" data-del aria-label="Remove">✕</button>
                </div>`).join("")
              : '<div class="empty">No goals for today yet.</div>'}
          </div>
          <button class="secondary" id="add-goal">+ Add goal</button>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Next up</h2>
            <button class="small" id="plan-day">Plan my day with AI</button>
          </div>
          ${upcoming.length
            ? upcoming.map((b) => `
              <div class="time-row">
                <div class="t">${App.fmtTime(b.start_at)} - ${App.fmtTime(b.end_at)}</div>
                <div class="grow"><span class="dot" style="background:${App.KIND_COLOR[b.kind] || App.KIND_COLOR.other}"></span>${esc(b.title)}${b.locked ? " 🔒" : ""}</div>
              </div>`).join("")
            : '<div class="empty">Nothing else scheduled today.</div>'}
          ${past.length ? `<div class="muted small">${past.length} earlier block${past.length === 1 ? "" : "s"} done for today</div>` : ""}
        </div>

        <div class="card">
          <h2>Due soon</h2>
          ${due.length
            ? due.map((d) => {
                const overdue = new Date(d.when) < now;
                return `<div class="time-row">
                  <div class="t" style="color:${overdue ? "var(--danger)" : "var(--muted)"}">${overdue ? "Overdue" : App.fmtDateTime(d.when)}</div>
                  <div class="grow">${esc(d.title)}${d.sub ? ` <span class="muted">(${esc(d.sub)})</span>` : ""} <span class="badge">${d.kind}</span></div>
                </div>`;
              }).join("")
            : '<div class="empty">Nothing due in the next 48 hours.</div>'}
        </div>`;

      // goal checkboxes + delete
      App.$$(".goal", el).forEach((row) => {
        const id = row.dataset.id;
        row.querySelector("input").addEventListener("change", async (e) => {
          await App.sb.from("goals").update({ done: e.target.checked }).eq("id", id);
          App.refresh();
        });
        row.querySelector("[data-del]").addEventListener("click", async () => {
          await App.sb.from("goals").delete().eq("id", id);
          App.refresh();
        });
      });
      App.$("#add-goal", el).onclick = async () => { if (await goalForm()) App.refresh(); };
      App.$("#plan-day", el).onclick = () => { App.state.autoPlan = true; App.go("ai"); };

      const en = App.$("#enable-alerts", el);
      if (en) {
        en.onclick = async () => {
          try { await App.push.enable(); App.toast("Alerts turned on."); App.refresh(); }
          catch (e) { App.toast(e.message); }
        };
      }
    }
  };
})();
