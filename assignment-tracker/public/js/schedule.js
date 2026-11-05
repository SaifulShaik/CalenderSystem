// Schedule: a day / week / month calendar of your blocks. Drag to move, drag the edge to resize,
// tap to edit, tap an empty slot to add.
(function () {
  const App = window.App;

  App.screens.schedule = {
    async render(el) {
      el.innerHTML = `
        <div class="screen-head">
          <h1>Schedule</h1>
          <button id="add-block">+ Add block</button>
        </div>
        <div id="sched-cal"></div>
        <p class="muted small">Tap a block to edit it. Drag to move it. Locked blocks (🔒) are never moved by the AI.</p>`;

      const wake = parseInt(String(App.prefs.wake_time || "07:00").slice(0, 2), 10) || 7;
      const narrow = window.innerWidth < 700;
      const lockIcon = (b) => (b.locked ? "🔒 " : "");

      const cal = new FullCalendar.Calendar(App.$("#sched-cal", el), {
        initialView: narrow ? "timeGridDay" : "timeGridWeek",
        height: "auto",
        nowIndicator: true,
        editable: true,
        eventStartEditable: true,
        eventDurationEditable: true,
        longPressDelay: 350,
        eventLongPressDelay: 350,
        slotDuration: "00:30:00",
        snapDuration: "00:15:00",
        slotMinTime: `${String(Math.max(0, wake - 1)).padStart(2, "0")}:00:00`,
        slotMaxTime: "24:00:00",
        scrollTime: new Date(Date.now() - 3600 * 1000).toTimeString().slice(0, 8),
        headerToolbar: { left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth" },
        buttonText: { today: "Today", day: "Day", week: "Week", month: "Month" },

        events: async (info, ok, fail) => {
          const { data, error } = await App.sb.from("schedule_blocks").select("*")
            .lt("start_at", info.endStr).gt("end_at", info.startStr).limit(500);
          if (error) return fail(error);
          ok((data || []).map((b) => ({
            id: b.id,
            title: lockIcon(b) + b.title,
            start: b.start_at,
            end: b.end_at,
            backgroundColor: App.KIND_COLOR[b.kind] || App.KIND_COLOR.other,
            borderColor: App.KIND_COLOR[b.kind] || App.KIND_COLOR.other,
            extendedProps: { block: b }
          })));
        },

        dateClick: (info) => {
          if (info.view.type === "dayGridMonth") {
            cal.changeView("timeGridDay", info.dateStr);
            return;
          }
          App.blockForm({ start: info.date.toISOString(), minutes: 60 }).then((saved) => saved && cal.refetchEvents());
        },
        eventClick: (info) => {
          App.blockForm({ block: info.event.extendedProps.block }).then((saved) => saved && cal.refetchEvents());
        },
        eventDrop: async (info) => save(info),
        eventResize: async (info) => save(info)
      });

      async function save(info) {
        const { error } = await App.sb.from("schedule_blocks")
          .update({ start_at: info.event.start.toISOString(), end_at: info.event.end.toISOString(), notified: false })
          .eq("id", info.event.id);
        if (error) { info.revert(); App.toast("Could not move it: " + error.message); }
        else cal.refetchEvents();
      }

      cal.render();
      App.state.leave = () => cal.destroy();

      App.$("#add-block", el).onclick = async () => {
        if (await App.blockForm({})) cal.refetchEvents();
      };
    }
  };
})();
