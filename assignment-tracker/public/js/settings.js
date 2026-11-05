// Settings: scheduling rules for the AI, reminder timing, this device's alerts, export and sign-out.
(function () {
  const App = window.App;
  const { esc } = App;
  const hm = (t) => String(t || "").slice(0, 5);
  const toMin = (t) => { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };

  App.screens.settings = {
    async render(el) {
      const p = App.prefs;
      const st = await App.push.status();

      el.innerHTML = `
        <div class="screen-head"><h1>Settings</h1></div>

        <form class="card" id="prefs-form">
          <h2>Your day</h2>
          <div class="settings-grid">
            <label>Wake up <input type="time" name="wake_time" value="${hm(p.wake_time)}" required></label>
            <label>Bedtime <input type="time" name="bed_time" value="${hm(p.bed_time)}" required></label>
            <label>Work starts <input type="time" name="work_start" value="${hm(p.work_start)}" required></label>
            <label>Work ends <input type="time" name="work_end" value="${hm(p.work_end)}" required></label>
            <label>Best focus from <input type="time" name="focus_start" value="${hm(p.focus_start)}" required></label>
            <label>Best focus until <input type="time" name="focus_end" value="${hm(p.focus_end)}" required></label>
            <label>Break length (min) <input type="number" name="break_minutes" min="0" max="60" value="${p.break_minutes}" required></label>
            <label>Break every (min) <input type="number" name="break_every_minutes" min="20" max="300" value="${p.break_every_minutes}" required></label>
            <label class="full">Time zone <input type="text" name="timezone" value="${esc(p.timezone)}" required></label>
          </div>

          <h2 style="margin-top:8px">AI assistant</h2>
          <label class="full" style="display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:var(--muted)">When the AI suggests changes
            <select name="ai_mode">
              <option value="ask" ${p.ai_mode === "ask" ? "selected" : ""}>Always show me first, then I tap Apply</option>
              <option value="auto_small" ${p.ai_mode === "auto_small" ? "selected" : ""}>Apply small changes automatically (30 minutes or less)</option>
            </select>
          </label>

          <h2 style="margin-top:8px">Reminders</h2>
          <div class="settings-grid">
            <label>First reminder (hours before) <input type="number" name="remind_long_hours" min="1" max="72" value="${p.remind_long_hours}" required></label>
            <label>Second reminder (hours before) <input type="number" name="remind_short_hours" min="1" max="72" value="${p.remind_short_hours}" required></label>
          </div>
          <label class="toggle"><input type="checkbox" name="alerts_blocks" ${p.alerts_blocks ? "checked" : ""}> Alert 10 minutes before a schedule block</label>
          <label class="toggle"><input type="checkbox" name="alerts_morning" ${p.alerts_morning ? "checked" : ""}> Morning summary after I wake up</label>

          <p class="error" id="prefs-err"></p>
          <button type="submit" class="block">Save settings</button>
        </form>

        <div class="card">
          <h2>Alerts on this device</h2>
          <p class="muted small" style="margin:0" id="push-msg">${esc(st.message)}</p>
          <div class="row">
            ${st.state === "off" ? '<button id="push-on">Turn on alerts</button>' : ""}
            ${st.state === "on" ? '<button class="secondary" id="push-off">Turn off alerts</button>' : ""}
          </div>
        </div>

        <div class="card">
          <h2>Account</h2>
          <p class="muted small" style="margin:0">${esc(App.user.email || "")}</p>
          <div class="row wrap">
            <button class="secondary" id="export">Download all my data</button>
            <button class="danger" id="signout">Sign out</button>
          </div>
        </div>`;

      // ---- save preferences ----
      App.$("#prefs-form", el).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const err = App.$("#prefs-err", el);
        err.textContent = "";
        const v = (n) => f.elements[n].value;
        const num = (n) => Number(f.elements[n].value);
        try {
          Intl.DateTimeFormat("en-CA", { timeZone: v("timezone").trim() });
        } catch (x) { err.textContent = "That time zone is not valid. Example: America/Toronto"; return; }
        if (toMin(v("work_start")) >= toMin(v("work_end"))) { err.textContent = "Work must end after it starts."; return; }
        if (toMin(v("focus_start")) >= toMin(v("focus_end"))) { err.textContent = "Focus time must end after it starts."; return; }
        if (num("remind_short_hours") > num("remind_long_hours")) { err.textContent = "The second reminder must be closer to the deadline than the first."; return; }

        const row = {
          user_id: App.user.id,
          wake_time: v("wake_time"), bed_time: v("bed_time"),
          work_start: v("work_start"), work_end: v("work_end"),
          focus_start: v("focus_start"), focus_end: v("focus_end"),
          break_minutes: num("break_minutes"), break_every_minutes: num("break_every_minutes"),
          timezone: v("timezone").trim(), ai_mode: v("ai_mode"),
          remind_long_hours: num("remind_long_hours"), remind_short_hours: num("remind_short_hours"),
          alerts_blocks: f.elements.alerts_blocks.checked, alerts_morning: f.elements.alerts_morning.checked
        };
        const { error } = await App.sb.from("preferences").upsert(row, { onConflict: "user_id" });
        if (error) { err.textContent = error.message; return; }
        App.prefs = { ...App.prefs, ...row };
        App.toast("Settings saved.");
      };

      // ---- this device's alerts ----
      const on = App.$("#push-on", el);
      if (on) on.onclick = async () => {
        try { await App.push.enable(); App.toast("Alerts turned on."); App.refresh(); } catch (x) { App.toast(x.message); }
      };
      const off = App.$("#push-off", el);
      if (off) off.onclick = async () => {
        try { await App.push.disable(); App.toast("Alerts turned off."); App.refresh(); } catch (x) { App.toast(x.message); }
      };

      // ---- export ----
      App.$("#export", el).onclick = async () => {
        const tables = ["assignments", "tasks", "goals", "schedule_blocks", "preferences", "ai_changes", "ai_messages"];
        const out = { exported_at: new Date().toISOString() };
        for (const t of tables) {
          const { data, error } = await App.sb.from(t).select("*");
          if (error) { App.toast(`Could not export ${t}: ${error.message}`); return; }
          out[t] = data;
        }
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `planner-backup-${App.dateStr()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };

      App.$("#signout", el).onclick = () => App.sb.auth.signOut();
    }
  };
})();
