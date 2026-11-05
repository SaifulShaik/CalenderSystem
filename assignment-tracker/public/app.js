// Starts the app: login, navigation between screens, refresh when you come back.
(function () {
  const App = window.App;
  const $ = App.$;
  const ORDER = ["today", "schedule", "assignments", "tasks", "ai", "settings"];
  let current = null;

  async function init() {
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("/sw.js"); } catch (e) { console.warn("sw", e); }
    }
    const { data } = await App.sb.auth.getSession();
    await showView(data.session);
    App.sb.auth.onAuthStateChange((event, session) => {
      // Only react to real sign-in / sign-out, not silent token refreshes.
      if (event === "SIGNED_IN" && App.user && session && session.user.id === App.user.id) return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") showView(session);
    });
  }

  async function showView(session) {
    const loggedIn = !!session;
    $("#login-view").classList.toggle("hidden", loggedIn);
    $("#app-view").classList.toggle("hidden", !loggedIn);
    if (!loggedIn) { App.user = null; App.prefs = null; return; }
    App.user = session.user;
    try { await App.loadPrefs(); } catch (e) { App.toast("Could not load settings: " + e.message); App.prefs = App.defaultPrefs(); }
    route();
  }

  function screenFromHash() {
    const h = (location.hash || "").replace("#", "");
    return ORDER.includes(h) ? h : "today";
  }

  App.go = (name) => {
    if (location.hash === "#" + name) route();
    else location.hash = "#" + name;
  };

  async function route() {
    if (!App.user) return;
    const name = screenFromHash();
    current = name;
    for (const a of App.$$("#nav a")) a.classList.toggle("active", a.dataset.screen === name);
    const el = $("#screen");
    // Let the previous screen clean up (calendars, timers).
    if (App.state.leave) { try { App.state.leave(); } catch (e) { /* ignore */ } App.state.leave = null; }
    el.innerHTML = '<p class="muted" style="padding:24px 0">Loading...</p>';
    try {
      await App.screens[name].render(el);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="card"><strong>Something went wrong</strong><span class="muted">${App.esc(e.message || e)}</span><button class="secondary" id="retry">Try again</button></div>`;
      $("#retry").onclick = route;
    }
    window.scrollTo(0, 0);
  }
  App.refresh = route;

  window.addEventListener("hashchange", route);

  // Come back to the app (or switch between phone and computer): show fresh data.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    // Do not rebuild while a dialog is open or the AI is mid-conversation.
    if (!App.user || document.getElementById("form-dialog").open) return;
    if (current === "ai" || current === "settings") return;
    if (Date.now() - hiddenAt > 30000) route();
  });

  // ---------- login ----------
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#login-error").textContent = "";
    const { error } = await App.sb.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value
    });
    if (error) $("#login-error").textContent = error.message;
  });

  init();
})();
