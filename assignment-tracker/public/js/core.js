// Shared helpers used by every screen. Each screen registers itself on App.screens.
(function () {
  const cfg = window.APP_CONFIG;
  const App = (window.App = { screens: {}, state: {}, user: null, prefs: null });

  App.sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ---------- small helpers ----------
  App.$ = (sel, root) => (root || document).querySelector(sel);
  App.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  App.esc = (s) => {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  };
  const pad = (n) => String(n).padStart(2, "0");

  App.fmtDateTime = (iso) =>
    new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  App.fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  App.fmtDay = (d) => (d || new Date()).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  // Local "YYYY-MM-DD"
  App.dateStr = (d) => {
    d = d || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  // ISO -> value for <input type="datetime-local">
  App.toInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  App.fromInput = (v) => (v ? new Date(v).toISOString() : null);
  App.addMinutes = (iso, mins) => new Date(new Date(iso).getTime() + mins * 60000).toISOString();

  let toastTimer = null;
  App.toast = (msg) => {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
  };

  // ---------- calling our own server functions ----------
  App.api = async (name, body) => {
    const { data } = await App.sb.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Please sign in again.");
    const res = await fetch("/api/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body || {})
    });
    let json = {};
    try { json = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  };

  // ---------- preferences ----------
  App.defaultPrefs = () => ({
    wake_time: "07:30", bed_time: "23:00", work_start: "09:00", work_end: "21:00",
    focus_start: "09:00", focus_end: "12:00", break_minutes: 10, break_every_minutes: 90,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
    ai_mode: "ask", remind_long_hours: 24, remind_short_hours: 2,
    alerts_blocks: true, alerts_morning: true
  });

  App.loadPrefs = async () => {
    const { data, error } = await App.sb.from("preferences").select("*").eq("user_id", App.user.id).maybeSingle();
    if (error) throw error;
    if (data) {
      App.prefs = { ...App.defaultPrefs(), ...data };
    } else {
      const fresh = { user_id: App.user.id, ...App.defaultPrefs() };
      await App.sb.from("preferences").upsert(fresh, { onConflict: "user_id" });
      App.prefs = fresh;
    }
    return App.prefs;
  };

  // ---------- generic form dialog ----------
  // App.form({ title, fields, submitLabel, onSubmit(values), onDelete() })
  // field: { name, label, type: text|number|datetime-local|time|select|checkbox|textarea, value, options, required, min, max, placeholder }
  App.form = function (opts) {
    return new Promise((resolve) => {
      const dlg = document.getElementById("form-dialog");
      const form = dlg.querySelector("form");

      const fieldHtml = (f) => {
        const v = f.value == null ? "" : f.value;
        const req = f.required ? "required" : "";
        if (f.type === "checkbox") {
          return `<label class="check"><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}> ${App.esc(f.label)}</label>`;
        }
        let control;
        if (f.type === "select") {
          control = `<select name="${f.name}" ${req}>${(f.options || [])
            .map((o) => `<option value="${App.esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${App.esc(o.label)}</option>`)
            .join("")}</select>`;
        } else if (f.type === "textarea") {
          control = `<textarea name="${f.name}" ${req} placeholder="${App.esc(f.placeholder || "")}">${App.esc(v)}</textarea>`;
        } else {
          const extra = `${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}`;
          control = `<input name="${f.name}" type="${f.type || "text"}" value="${App.esc(v)}" ${req} ${extra} placeholder="${App.esc(f.placeholder || "")}">`;
        }
        return `<label>${App.esc(f.label)}${control}</label>`;
      };

      form.innerHTML =
        `<h2>${App.esc(opts.title)}</h2>` +
        opts.fields.map(fieldHtml).join("") +
        `<p class="error" data-err></p>` +
        `<div class="row">
           <button type="button" class="secondary" data-cancel>Cancel</button>
           ${opts.onDelete ? '<button type="button" class="danger" data-del>Delete</button>' : ""}
           <button type="submit" data-ok>${App.esc(opts.submitLabel || "Save")}</button>
         </div>`;

      const err = form.querySelector("[data-err]");
      const ok = form.querySelector("[data-ok]");
      let finished = false;
      const finish = (val) => {
        if (finished) return;
        finished = true;
        if (dlg.open) dlg.close();
        resolve(val);
      };

      const read = () => {
        const out = {};
        for (const f of opts.fields) {
          const el = form.elements[f.name];
          if (f.type === "checkbox") out[f.name] = el.checked;
          else if (f.type === "number") out[f.name] = el.value === "" ? null : Number(el.value);
          else out[f.name] = el.value;
        }
        return out;
      };

      form.onsubmit = async (e) => {
        e.preventDefault();
        err.textContent = "";
        ok.disabled = true;
        try {
          await opts.onSubmit(read());
          finish(true);
        } catch (ex) {
          err.textContent = ex.message || String(ex);
          ok.disabled = false;
        }
      };
      form.querySelector("[data-cancel]").onclick = () => finish(false);
      const del = form.querySelector("[data-del]");
      if (del) {
        del.onclick = async () => {
          if (!confirm("Delete this?")) return;
          try { await opts.onDelete(); finish(true); } catch (ex) { err.textContent = ex.message || String(ex); }
        };
      }
      dlg.oncancel = (e) => { e.preventDefault(); finish(false); };
      dlg.showModal();
    });
  };

  // ---------- priority / kind labels ----------
  App.PRIORITY = { 1: "Low", 2: "Medium", 3: "High" };
  App.KIND_COLOR = {
    assignment: "#4f46e5", task: "#0d9488", goal: "#16a34a", break: "#94a3b8", other: "#64748b"
  };

  // ---------- opening the "add / edit a schedule block" form from anywhere ----------
  // opts: { block, start, end, title, kind, assignment_id, task_id, minutes }
  App.blockForm = async function (opts) {
    opts = opts || {};
    const b = opts.block || null;
    const [a, t] = await Promise.all([
      App.sb.from("assignments").select("id,title,est_minutes").eq("done", false).order("due_at").limit(100),
      App.sb.from("tasks").select("id,title,est_minutes").neq("status", "done").order("created_at").limit(100)
    ]);
    const linkOptions = [{ value: "", label: "None" }]
      .concat((a.data || []).map((x) => ({ value: "a:" + x.id, label: "Assignment: " + x.title })))
      .concat((t.data || []).map((x) => ({ value: "t:" + x.id, label: "Task: " + x.title })));
    const lookup = {};
    (a.data || []).forEach((x) => (lookup["a:" + x.id] = x));
    (t.data || []).forEach((x) => (lookup["t:" + x.id] = x));

    const curLink = b
      ? b.assignment_id ? "a:" + b.assignment_id : b.task_id ? "t:" + b.task_id : ""
      : opts.assignment_id ? "a:" + opts.assignment_id : opts.task_id ? "t:" + opts.task_id : "";

    const startIso = b ? b.start_at : opts.start || new Date(Math.ceil(Date.now() / 900000) * 900000).toISOString();
    const endIso = b ? b.end_at : opts.end || App.addMinutes(startIso, opts.minutes || 60);

    return App.form({
      title: b ? "Edit block" : "Add to schedule",
      submitLabel: b ? "Save" : "Add",
      fields: [
        { name: "title", label: "Title", value: b ? b.title : opts.title || "", placeholder: "What are you doing?" },
        {
          name: "kind", label: "Type", type: "select", value: b ? b.kind : opts.kind || (curLink.startsWith("a:") ? "assignment" : curLink.startsWith("t:") ? "task" : "other"),
          options: ["assignment", "task", "goal", "break", "other"].map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))
        },
        { name: "link", label: "Linked item (optional)", type: "select", value: curLink, options: linkOptions },
        { name: "start", label: "Start", type: "datetime-local", value: App.toInput(startIso), required: true },
        { name: "end", label: "End", type: "datetime-local", value: App.toInput(endIso), required: true },
        { name: "locked", label: "Lock (the AI will never move this)", type: "checkbox", value: b ? b.locked : false }
      ],
      onSubmit: async (v) => {
        const link = lookup[v.link];
        const title = v.title.trim() || (link ? link.title : "");
        if (!title) throw new Error("Give it a title or pick a linked item.");
        const start = App.fromInput(v.start);
        const end = App.fromInput(v.end);
        if (!(new Date(end) > new Date(start))) throw new Error("End must be after the start.");
        const row = {
          title, kind: v.kind, start_at: start, end_at: end, locked: v.locked,
          assignment_id: v.link.startsWith("a:") ? v.link.slice(2) : null,
          task_id: v.link.startsWith("t:") ? v.link.slice(2) : null
        };
        if (b) {
          const { error } = await App.sb.from("schedule_blocks").update({ ...row, notified: false }).eq("id", b.id);
          if (error) throw error;
        } else {
          const { error } = await App.sb.from("schedule_blocks").insert({ ...row, user_id: App.user.id });
          if (error) throw error;
        }
      },
      onDelete: b
        ? async () => {
            const { error } = await App.sb.from("schedule_blocks").delete().eq("id", b.id);
            if (error) throw error;
          }
        : null
    });
  };
})();
