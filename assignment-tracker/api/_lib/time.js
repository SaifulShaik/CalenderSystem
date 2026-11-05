// Time zone helpers. The database stores UTC; the AI and reminders speak in the
// user's local time ("YYYY-MM-DDTHH:mm" strings in their time zone).

function partsInZone(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// Date or ISO string -> "YYYY-MM-DDTHH:mm" in tz
function toLocal(value, tz) {
  const p = partsInZone(new Date(value), tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "YYYY-MM-DD" in tz
function localDate(value, tz) {
  return toLocal(value, tz).slice(0, 10);
}

// Minutes since local midnight in tz
function localMinutes(value, tz) {
  const p = partsInZone(new Date(value), tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

function weekdayName(value, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "long" }).format(new Date(value));
}

// "YYYY-MM-DDTHH:mm" (wall-clock time in tz) -> Date (a real UTC instant)
function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(local || ""));
  if (!m) throw new Error(`Bad date/time "${local}". Use YYYY-MM-DDTHH:mm`);
  const wanted = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = partsInZone(new Date(guess), tz);
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

// "YYYY-MM-DD" -> Date at local midnight in tz
function startOfLocalDay(dateStr, tz) {
  return zonedToUtc(`${dateStr}T00:00`, tz);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function timeToMinutes(t) {
  const [h, m] = String(t || "00:00").split(":");
  return Number(h) * 60 + Number(m);
}

function validZone(tz) {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch (e) { return false; }
}

module.exports = {
  toLocal, localDate, localMinutes, weekdayName, zonedToUtc,
  startOfLocalDay, addDays, timeToMinutes, validZone
};
