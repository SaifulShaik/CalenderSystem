// AI assistant: you type what you want, it proposes schedule changes, you tap Apply (or Undo later).
(function () {
  const App = window.App;
  const { esc } = App;

  function describe(p) {
    if (p.op === "add_block")
      return `<b>Add</b> ${esc(p.title)} · ${App.fmtDateTime(p.start_at)} to ${App.fmtTime(p.end_at)}`;
    if (p.op === "move_block")
      return `<b>Move</b> ${esc(p.title)} from ${App.fmtDateTime(p.from.start_at)} to ${App.fmtDateTime(p.start_at)}`;
    if (p.op === "remove_block")
      return `<b>Remove</b> ${esc(p.title)} (${App.fmtDateTime(p.from.start_at)})`;
    if (p.op === "add_task")
      return `<b>New task</b> ${esc(p.title)} · ${p.est_minutes} min · ${App.PRIORITY[p.priority] || "Medium"} priority`;
    return esc(p.title || "Change");
  }

  App.screens.ai = {
    async render(el) {
      el.innerHTML = `
        <div class="screen-head"><h1>AI assistant</h1></div>
        <div class="chips">
          <button class="chip" data-plan>Plan my day</button>
          <button class="chip" data-say="What is the most urgent thing I should do next?">What's most urgent?</button>
          <button class="chip" data-say="I am running behind. Reshuffle the rest of today so the most important things still get done.">I'm behind today</button>
          <button class="chip" data-say="Plan tomorrow for me.">Plan tomorrow</button>
        </div>
        <div class="chat" id="chat"></div>
        <form class="composer" id="composer">
          <input id="msg" placeholder="Tell me what to change, e.g. move my essay to tomorrow morning" autocomplete="off" maxlength="2000">
          <button type="submit" id="send">Send</button>
        </form>
        <div class="card" id="recent-card">
          <h2>Recent AI changes</h2>
          <div id="recent"></div>
        </div>`;

      const chat = App.$("#chat", el);
      const input = App.$("#msg", el);
      const sendBtn = App.$("#send", el);
      let busy = false;

      const scrollDown = () => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      const bubble = (role, text, extra) => {
        const d = document.createElement("div");
        d.className = "bubble " + role + (extra ? " " + extra : "");
        d.textContent = text;
        chat.appendChild(d);
        return d;
      };

      // ---- history ----
      const { data: hist } = await App.sb.from("ai_messages").select("role,content,created_at")
        .order("created_at", { ascending: false }).limit(30);
      (hist || []).reverse().forEach((m) => bubble(m.role, m.content));
      if (!(hist || []).length) {
        bubble("assistant", "Hi! Tell me what you need. I can plan your day, move things around, or tell you what to do first. I will show you my suggestions and nothing changes until you tap Apply.");
      }

      // ---- recent changes with Undo ----
      async function loadRecent() {
        const box = App.$("#recent", el);
        const { data } = await App.sb.from("ai_changes").select("*").order("created_at", { ascending: false }).limit(5);
        if (!(data || []).length) { box.innerHTML = '<div class="empty">Nothing yet.</div>'; return; }
        box.innerHTML = "";
        for (const c of data) {
          const row = document.createElement("div");
          row.className = "time-row";
          row.innerHTML = `<div class="t">${App.fmtDateTime(c.created_at)}</div>
            <div class="grow">${esc(c.summary || "AI change")}</div>
            ${c.undone ? '<span class="muted small">Undone</span>' : '<button class="small secondary">Undo</button>'}`;
          const btn = row.querySelector("button");
          if (btn) {
            btn.onclick = async () => {
              btn.disabled = true;
              try {
                const r = await App.api("undo-change", { change_id: c.id });
                App.toast(r.warning || "Undone.");
              } catch (e) { App.toast(e.message); }
              loadRecent();
            };
          }
          box.appendChild(row);
        }
      }

      // ---- proposal card ----
      function proposalCard(res) {
        const card = document.createElement("div");
        card.className = "proposal";
        const list = res.proposals.map((p) => `<li>${describe(p)}</li>`).join("");
        const warns = (res.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
        card.innerHTML = `<ul>${list}</ul>${warns}
          <div class="row" data-actions>
            <button data-apply>Apply</button>
            <button class="secondary" data-dismiss>Dismiss</button>
          </div>`;
        chat.appendChild(card);

        const actions = card.querySelector("[data-actions]");
        const applyBtn = card.querySelector("[data-apply]");
        card.querySelector("[data-dismiss]").onclick = () => card.remove();

        const doApply = async (auto) => {
          applyBtn.disabled = true;
          try {
            const r = await App.api("apply-changes", { proposals: res.proposals, summary: res.reply.slice(0, 200) });
            let msg = `${auto ? "Applied automatically" : "Applied"}: ${r.applied} change${r.applied === 1 ? "" : "s"}.`;
            if (r.skipped && r.skipped.length) {
              msg += ` Skipped ${r.skipped.length} (${r.skipped.map((s) => s.reason).join("; ")}).`;
            }
            actions.innerHTML = `<span class="applied grow">${esc(msg)}</span>${r.change_id ? '<button class="secondary small" data-undo>Undo</button>' : ""}`;
            const undo = actions.querySelector("[data-undo]");
            if (undo) {
              undo.onclick = async () => {
                undo.disabled = true;
                try {
                  await App.api("undo-change", { change_id: r.change_id });
                  actions.innerHTML = '<span class="muted">Undone.</span>';
                } catch (e) { App.toast(e.message); undo.disabled = false; }
                loadRecent();
              };
            }
            loadRecent();
          } catch (e) {
            applyBtn.disabled = false;
            App.toast(e.message);
          }
        };
        applyBtn.onclick = () => doApply(false);

        if (App.prefs.ai_mode === "auto_small" && res.autoApplicable) doApply(true);
      }

      // ---- sending ----
      async function send(text, endpoint) {
        if (busy) return;
        busy = true;
        sendBtn.disabled = true;
        bubble("user", text);
        const thinking = bubble("assistant", "Thinking...", "thinking");
        scrollDown();
        try {
          const res = await App.api(endpoint || "assistant", endpoint === "plan-day" ? {} : { message: text });
          thinking.remove();
          bubble("assistant", res.reply);
          if (res.proposals && res.proposals.length) proposalCard(res);
          else if (res.warnings && res.warnings.length) bubble("assistant", "⚠ " + res.warnings.join("\n⚠ "));
        } catch (e) {
          thinking.remove();
          bubble("assistant", "Sorry, that did not work: " + e.message);
        }
        busy = false;
        sendBtn.disabled = false;
        scrollDown();
      }

      App.$("#composer", el).onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        send(text);
      };
      App.$$("[data-say]", el).forEach((b) => (b.onclick = () => send(b.dataset.say)));
      App.$("[data-plan]", el).onclick = () => send("Plan my day", "plan-day");

      loadRecent();
      if (App.state.autoPlan) {
        App.state.autoPlan = false;
        send("Plan my day", "plan-day");
      } else if ((hist || []).length) {
        setTimeout(scrollDown, 50);
      }
    }
  };
})();
