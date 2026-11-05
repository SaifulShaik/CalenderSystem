// Tasks: to-dos with an estimate and priority, plus your repeating daily goals.
(function () {
  const App = window.App;
  const { esc } = App;
  const view = { filter: "open" };

  function taskForm(t) {
    return App.form({
      title: t ? "Edit task" : "Add task",
      submitLabel: t ? "Save" : "Add",
      fields: [
        { name: "title", label: "Task", value: t ? t.title : "", required: true },
        { name: "notes", label: "Notes (optional)", type: "textarea", value: t ? t.notes || "" : "" },
        { name: "est", label: "Estimated time (minutes)", type: "number", value: t ? t.est_minutes : 30, min: 5, max: 600, required: true },
        {
          name: "priority", label: "Priority", type: "select", value: t ? t.priority : 2,
          options: [{ value: 3, label: "High" }, { value: 2, label: "Medium" }, { value: 1, label: "Low" }]
        },
        { name: "deadline", label: "Deadline (optional)", type: "datetime-local", value: t ? App.toInput(t.deadline) : "" },
        {
          name: "status", label: "Status", type: "select", value: t ? t.status : "todo",
          options: [{ value: "todo", label: "To do" }, { value: "doing", label: "In progress" }, { value: "done", label: "Done" }]
        }
      ],
      onSubmit: async (v) => {
        const title = v.title.trim();
        if (!title) throw new Error("Give it a title.");
        const row = {
          title,
          notes: v.notes.trim() || null,
          est_minutes: Math.max(5, Math.round(v.est || 30)),
          priority: Number(v.priority),
          deadline: App.fromInput(v.deadline),
          status: v.status
        };
        if (t) {
          const changed = (row.deadline || null) !== (t.deadline ? new Date(t.deadline).toISOString() : null);
          const { error } = await App.sb.from("tasks").update(changed ? { ...row, notified: false } : row).eq("id", t.id);
          if (error) throw error;
        } else {
          const { error } = await App.sb.from("tasks").insert({ ...row, user_id: App.user.id });
          if (error) throw error;
        }
      },
      onDelete: t
        ? async () => {
            const { error } = await App.sb.from("tasks").delete().eq("id", t.id);
            if (error) throw error;
          }
        : null
    });
  }

  App.screens.tasks = {
    async render(el) {
      const [tr, gr] = await Promise.all([
        App.sb.from("tasks").select("*"),
        App.sb.from("goals").select("*").neq("recurring", "none").is("goal_date", null).order("created_at")
      ]);
      if (tr.error) throw tr.error;
      if (gr.error) throw gr.error;
      const all = tr.data || [];
      const now = Date.now();

      el.innerHTML = `
        <div class="screen-head">
          <h1>Tasks</h1>
          <button id="add-t">+ Add</button>
        </div>
        <div class="tabs">
          ${["open", "done", "all"].map((f) => `<button class="tab ${view.filter === f ? "active" : ""}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
        </div>
        <div id="t-list"></div>

        <div class="card">
          <div class="card-head">
            <h2>Repeating goals</h2>
            <button class="small secondary" id="add-rg">+ Add</button>
          </div>
          <p class="muted small" style="margin:0">These show up on your Today screen automatically.</p>
          ${(gr.data || []).length
            ? (gr.data || []).map((g) => `
              <div class="goal" data-id="${g.id}">
                <span class="grow">${esc(g.title)} <span class="badge">${g.recurring === "daily" ? "Every day" : "Weekdays"}</span></span>
                <button class="icon" data-del aria-label="Remove">✕</button>
              </div>`).join("")
            : '<div class="empty">No repeating goals.</div>'}
        </div>`;

      const rows = all
        .filter((t) => (view.filter === "open" ? t.status !== "done" : view.filter === "done" ? t.status === "done" : true))
        .sort((a, b) => {
          if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
          if (b.priority !== a.priority) return b.priority - a.priority;
          const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          return da - db;
        });

      const list = App.$("#t-list", el);
      if (!rows.length) {
        list.innerHTML = '<div class="empty">No tasks here. Tap + Add to create one.</div>';
      } else {
        for (const t of rows) {
          const div = document.createElement("div");
          const overdue = t.status !== "done" && t.deadline && new Date(t.deadline).getTime() < now;
          div.className = "item clickable" + (t.status === "done" ? " done" : overdue ? " overdue" : "");
          const pr = App.PRIORITY[t.priority] || "Medium";
          div.innerHTML = `
            <input type="checkbox" ${t.status === "done" ? "checked" : ""} aria-label="Mark done">
            <div class="item-body">
              <div class="item-title">${esc(t.title)}</div>
              <div class="item-meta">
                <span class="badge ${t.priority === 3 ? "high" : t.priority === 1 ? "low" : ""}">${pr}</span>
                ${t.est_minutes} min${t.deadline ? " · due " + App.fmtDateTime(t.deadline) : ""}${t.status === "doing" ? " · in progress" : ""}
              </div>
            </div>
            ${t.status !== "done" ? '<button class="small secondary" data-sched>Schedule</button>' : ""}`;
          const box = div.querySelector("input");
          box.addEventListener("click", (e) => e.stopPropagation());
          box.addEventListener("change", async (e) => {
            await App.sb.from("tasks").update({ status: e.target.checked ? "done" : "todo" }).eq("id", t.id);
            App.refresh();
          });
          const sched = div.querySelector("[data-sched]");
          if (sched) {
            sched.addEventListener("click", async (e) => {
              e.stopPropagation();
              const saved = await App.blockForm({ title: t.title, task_id: t.id, kind: "task", minutes: t.est_minutes });
              if (saved) App.toast("Added to your schedule.");
            });
          }
          div.addEventListener("click", async () => { if (await taskForm(t)) App.refresh(); });
          list.appendChild(div);
        }
      }

      App.$$(".tab", el).forEach((b) => (b.onclick = () => { view.filter = b.dataset.f; App.refresh(); }));
      App.$("#add-t", el).onclick = async () => { if (await taskForm(null)) App.refresh(); };
      App.$("#add-rg", el).onclick = async () => { if (await App.goalForm()) App.refresh(); };
      App.$$(".goal [data-del]", el).forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.closest(".goal").dataset.id;
          if (!confirm("Remove this repeating goal? Today's copy stays.")) return;
          await App.sb.from("goals").delete().eq("id", id);
          App.refresh();
        };
      });
    }
  };
})();
