// Push notification helpers (this device only).
(function () {
  const App = window.App;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function keyToBytes(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  // state: unsupported | needs-install | blocked | off | on
  App.push = {
    async status() {
      if (isIOS && !isStandalone()) {
        return { state: "needs-install", message: "On iPhone: tap Share, then Add to Home Screen, then open the app from your Home Screen to turn on alerts." };
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return { state: "unsupported", message: "This browser does not support push alerts." };
      }
      if (Notification.permission === "denied") {
        return { state: "blocked", message: "Alerts are blocked. Turn them on in your device's Settings > Notifications." };
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") return { state: "on", message: "Alerts are on for this device." };
      } catch (e) { /* fall through */ }
      return { state: "off", message: "Alerts are off for this device." };
    },

    async enable() {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications were not allowed.");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(window.APP_CONFIG.VAPID_PUBLIC_KEY)
        });
      }
      const json = sub.toJSON();
      const { error } = await App.sb.from("push_subscriptions").upsert(
        { user_id: App.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: "endpoint" }
      );
      if (error) throw error;
    },

    async disable() {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await App.sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
    }
  };
})();
