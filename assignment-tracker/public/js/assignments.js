// Assignments: list and month calendar, with filters. Add / edit with the estimated time
// the AI uses when it plans your days.
(function () {
  const App = window.App;
  const { esc } = App;
  const view = { tab: "list", status: "open", course: "" };

  function assignmentForm(a) {
    return App.form({
      title: a ? "Edit assignment" : "Add assignment",
      submitLabel: a ? "Save" : "Add",
      fields: [
        { name: "title", label: "Title", value: a ? a.title : "", required: true },
        { name: "course", label: "Course (optional)", value: a ? a.course || "" : "" },
        { name: "due", label: "Due", type: "datetime-local", value: a ? App.toInput(a.due_at) : "", required: true },
        { name: "est", label: "Estimated time (minutes)", type: "number", value: a ? a.est_minutes : 60, min: 5, max: 1200, required: true }
      ],
      onSubmit: async (v) => {
        const title = v.title.trim();
        if (!title) throw new Error("Give it a title.");
        const row = {
          title,
          course: v.course.trim() || null,
          due_at: App.fromInput(v.due),
          est_minutes: Math.max(5, Math.round(v.est || 60))
        };
        if (a) {
          // a changed due date means the reminders should fire again
          const changed = row.due_at !== new Date(a.due_at).toISOString();
          const patch = changed ? { ...row, notified_day: false, notified_hours: false, notified_overdue: false } : row;
          const { error } = await App.sb.from("assignments").update(patch).eq("id", a.id);
          if (error) throw error;
        } else {
          const { error } = await App.sb.from("assignments").insert({ ...row, user_id: App.user.id });
          if (error) throw error;
        }
      },
      onDelete: a
        ? async () => {
            const { error } = await App.sb.from("assignments").delete().eq("id", a.id);
            if (error) throw error;
          }
        : null
    });
  }

  App.screens.assignments = {
    async render(el) {
      const { data, error } = await App.sb.from("assignments").select("*").order("due_at", { ascending: true });
      if (error) throw error;
      const all = data || [];
      const now = Date.now();
      const courses = Array.from(new Set(all.map((a) => a.course).filter(Boolean))).sort();

      el.innerHTML = `
        <div class="screen-head">
          <h1>Assignments</h1>
          <button id="add-a">+ Add</button>
        </div>
        <div class="tabs">
          <button class="tab ${view.tab === "list" ? "active" : ""}" data-tab="list">List</button>
          <button class="tab ${view.tab === "cal" ? "active" : ""}" data-tab="cal">Month</button>
        </div>
        <div class="filters">
          <select id="f-status">
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
          <select id="f-course">
            <option value="">All courses</option>
            ${courses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>
        </div>
        <div id="a-list"></div>
        <div id="calendar" class="hidden"></div>`;

      App.$("#f-status", el).value = view.status;
      App.$("#f-course", el).value = courses.includes(view.course) ? view.course : "";

      const filtered = () =>
        all.filter((a) => {
          if (view.course && a.course !== view.course) return false;
          const overdue = !a.done && new Date(a.due_at) < now;
          if (view.status === "open") return !a.done;
          if (view.status === "done") return a.done;
          if (view.status === "overdue") return overdue;
          return true;
        });

      const list = App.$("#a-list", el);
      const renderList = () => {
        const rows = filtered();
        if (!rows.length) { list.innerHTML = '<div class="empty">Nothing here. Tap + Add to create one.</div>'; return; }
        list.innerHTML = "";
        for (const a of rows) {
          const due = new Date(a.due_at).getTime();
          let cls = "item clickable";
          if (a.done) cls += " done";
          else if (due < now) cls += " overdue";
          else if (due - now < 48 * 3600 * 1000) cls += " soon";
          const div = document.createElement("div");
          div.className = cls;
          div.innerHTML = `
            <input type="checkbox" ${a.done ? "checked" : ""} aria-label="Mark done">
            <div class="item-body">
              <div class="item-title">${esc(a.title)}</div>
              <div class="item-meta">${a.course ? esc(a.course) + " · " : ""}${App.fmtDateTime(a.due_at)} · ${a.est_minutes} min</div>
            </div>`;
          const box = div.querySelector("input");
          box.addEventListener("click", (e) => e.stopPropagation());
          box.addEventListener("change", async (e) => {
            await App.sb.from("assignments").update({ done: e.target.checked }).eq("id", a.id);
            App.refresh();
          });
          div.addEventListener("click", async () => { if (await assignmentForm(a)) App.refresh(); });
          list.appendChild(div);
        }
      };

      let calendar = null;
      const showTab = () => {
        const isCal = view.tab === "cal";
        list.classList.toggle("hidden", isCal);
        App.$("#calendar", el).classList.toggle("hidden", !isCal);
        App.$(".filters", el).classList.toggle("hidden", isCal);
        App.$$(".tab", el).forEach((b) => b.classList.toggle("active", b.dataset.tab === view.tab));
        if (isCal) {
          if (!calendar) {
            calendar = new FullCalendar.Calendar(App.$("#calendar", el), {
              initialView: "dayGridMonth",
              height: "auto",
              headerToolbar: { left: "prev,next", center: "title", right: "today" },
              eventClick: (info) => {
                const a = all.find((x) => x.id === info.event.id);
                if (a) assignmentForm(a).then((saved) => saved && App.refresh());
              },
              events: all.map((a) => ({
                id: a.id,
                title: a.title + (a.course ? ` (${a.course})` : ""),
                start: a.due_at,
                color: a.done ? "#9ca3af" : new Date(a.due_at) < now ? "#dc2626" : "#4f46e5"
              }))
            });
          }
          calendar.render();
        }
      };
      App.state.leave = () => { if (calendar) calendar.destroy(); };

      App.$$(".tab", el).forEach((b) => (b.onclick = () => { view.tab = b.dataset.tab; showTab(); }));
      App.$("#f-status", el).onchange = (e) => { view.status = e.target.value; renderList(); };
      App.$("#f-course", el).onchange = (e) => { view.course = e.target.value; renderList(); };
      App.$("#add-a", el).onclick = async () => { if (await assignmentForm(null)) App.refresh(); };

      renderList();
      showTab();
    }
  };
})();
