/* BangTurn core module, installed to Storage as "bangturn".
   Usage: var bt = require("bangturn");

   Owns: bangturn.json (walk state) and the "bangturn.*" entries in sched.json.
   Everything else (UI, alerts, GPS, widget) talks to the walk through this
   module and listens for Bangle "bangturn" events. See docs/ARCHITECTURE.md.

   All times are ms since epoch (Date.now()). Functions that take `now` use
   Date.now() when it is left out; the parameter exists for tests. */

var FILE = "bangturn.json";
var APPID = "bangturn";
var MIN = 60000;

/* Walk length. The only place the duration lives: everything else derives
   from it, so making the walk adjustable later means changing this. */
var DURATION = 60 * MIN;
var TURN = DURATION / 2;

/* The six sched entries, as [id, ms after the (effective) start].
   left15..left1 are the walk-back countdown buzzes; `n` buzzes each. */
var EVENTS = [
  ["turn", TURN],
  ["left15", DURATION - 15 * MIN],
  ["left8", DURATION - 8 * MIN],
  ["left4", DURATION - 4 * MIN],
  ["left1", DURATION - 1 * MIN],
  ["end", DURATION]
];
var BUZZES = { left15: 1, left8: 2, left4: 3, left1: 4 };

exports.DURATION = DURATION;
exports.TURN = TURN;
exports.EVENTS = EVENTS;
exports.BUZZES = BUZZES;
exports.FILE = FILE;

function emit(type) {
  Bangle.emit("bangturn", type);
}

/* ---------- state (bangturn.json) ----------
   {} when idle, otherwise:
   { start: ms the walk was started (button press),
     offset: number of "-1 min" taps (minutes the start was moved earlier),
     turned: true once the turnaround has passed (alarm fired or skipped),
     alert: "turn" while a turnaround alert is waiting to be shown (transient) } */

exports.read = function () {
  return require("Storage").readJSON(FILE, 1) || {};
};

exports.write = function (s) {
  require("Storage").writeJSON(FILE, s);
};

exports.isActive = function (s) {
  s = s || exports.read();
  return s.start !== undefined;
};

/* Effective start: the press time moved earlier by the -1 min taps. */
exports.startTime = function (s) {
  s = s || exports.read();
  return s.start - (s.offset || 0) * MIN;
};

/* Snapshot of the walk for drawing.
   { active, phase: "idle"|"out"|"back", elapsed, remaining, toTurn, offset, turned, start }
   elapsed/remaining/toTurn are ms, clamped to >= 0. */
exports.status = function (now, s) {
  if (now === undefined) now = Date.now();
  s = s || exports.read();
  if (!exports.isActive(s))
    return { active: false, phase: "idle", elapsed: 0, remaining: DURATION, toTurn: TURN, offset: 0, turned: false };
  var start = exports.startTime(s);
  var elapsed = Math.max(0, now - start);
  return {
    active: true,
    phase: elapsed < TURN ? "out" : "back",
    start: start,
    elapsed: elapsed,
    remaining: Math.max(0, DURATION - elapsed),
    toTurn: Math.max(0, TURN - elapsed),
    offset: s.offset || 0,
    turned: !!s.turned
  };
};

/* "60:00" style m:ss (whole minutes, no hours) for a duration in ms,
   rounded up to the second, so a countdown shows 60:00 at the start and
   0:00 only at the end. */
exports.fmt = function (ms) {
  var t = Math.ceil(Math.max(0, ms) / 1000);
  return Math.floor(t / 60) + ":" + ("0" + t % 60).substr(-2);
};

/* ---------- sched entries ---------- */

function isOurs(a) {
  return a.appid == APPID || (typeof a.id == "string" && a.id.substr(0, APPID.length + 1) == APPID + ".");
}

/* Our entries currently in sched.json (for tests and debugging). */
exports.getSched = function () {
  return require("sched").getAlarms().filter(isOurs);
};

function writeSched(entries) {
  var sched = require("sched");
  var alarms = sched.getAlarms().filter(function (a) { return !isOurs(a); });
  sched.setAlarms(alarms.concat(entries));
  sched.reload();
}

exports.clearSched = function () {
  writeSched([]);
};

/* Build a sched alarm entry that fires at absolute time `at`. We use plain
   alarms with an explicit date rather than sched timers, so the time is
   absolute and survives reboots and -1 min rescheduling. */
function entry(id, at) {
  var d = new Date(at);
  return {
    id: APPID + "." + id,
    appid: APPID,
    on: true,
    hidden: true, // keep out of the Alarms app list
    del: true,
    t: d.getHours() * 3600000 + d.getMinutes() * 60000 + d.getSeconds() * 1000 + d.getMilliseconds(),
    date: d.toLocalISOString().substr(0, 10),
    dow: 127,
    last: 0,
    js: 'require("bangturn").fire("' + id + '")'
  };
}

/* (Re)write all sched entries from the saved state, skipping any whose time
   has already passed (and the turnaround once it has happened). */
exports.schedule = function (now, s) {
  if (now === undefined) now = Date.now();
  s = s || exports.read();
  if (!exports.isActive(s)) return exports.clearSched();
  var start = exports.startTime(s);
  var list = [];
  EVENTS.forEach(function (e) {
    var at = start + e[1];
    if (at <= now) return;
    if (e[0] == "turn" && s.turned) return;
    list.push(entry(e[0], at));
  });
  writeSched(list);
};

/* ---------- actions ---------- */

/* Start a walk now (or at time `at`, for tests). Returns the new state.
   Emits "start". */
exports.start = function (at) {
  var now = Date.now();
  if (at === undefined) at = now;
  var s = { start: at, offset: 0, turned: false };
  exports.write(s);
  exports.schedule(now, s);
  emit("start");
  return s;
};

/* Cancel the walk: clears all BangTurn sched entries and the state.
   Emits "cancel". */
exports.cancel = function () {
  exports.write({});
  exports.clearSched();
  emit("cancel");
};

/* The walk reached its end (or -1 min pushed the end into the past).
   Silent: clears entries and state, emits "end". */
exports.finish = function () {
  exports.write({});
  exports.clearSched();
  emit("end");
};

/* "-1 min": move the start one minute earlier and reschedule, skipping
   past events. If that puts the turnaround in the past, no alarm fires and
   the walk is marked turned. If it puts the end in the past, the walk
   finishes. Returns the new status. Emits "offset" (or "end"). */
exports.minusOne = function (now) {
  if (now === undefined) now = Date.now();
  var s = exports.read();
  if (!exports.isActive(s)) return exports.status(now, s);
  s.offset = (s.offset || 0) + 1;
  var st = exports.status(now, s);
  if (st.remaining <= 0) {
    exports.finish();
    return exports.status(now, {});
  }
  if (st.phase == "back" && !s.turned) {
    s.turned = true;
    delete s.alert;
  }
  exports.write(s);
  exports.schedule(now, s);
  emit("offset");
  return exports.status(now, s);
};

/* Called by sched (the entries' `js`) when an event is due. Removes the
   fired entry, then:
   - "turn": marks the walk turned, flags the alert and loads the app, which
     shows it via require("bangturn.alerts").turnaround(). Emits "turn".
   - "left15".."left1": require("bangturn.alerts").countdown(n) in place,
     whatever app is open. Emits "buzz". Skipped if over a minute late.
   - "end": finish() (silent). Emits "end". So does any entry that fires
     after the walk's hour is up. */
exports.fire = function (id) {
  var s = exports.read();
  // drop this entry (and any other already-past ones) and re-arm sched
  if (!exports.isActive(s)) return exports.clearSched();
  // "end", or any entry that fires once the walk's hour is up (the watch
  // was off or busy past the end): finish silently, no late alarm or buzz
  if (id == "end" || exports.status(undefined, s).remaining <= 0) return exports.finish();
  if (id == "turn") s.turned = true;
  exports.schedule(Date.now() + 1000, s);
  if (id == "turn") {
    s.alert = "turn";
    exports.write(s);
    emit("turn");
    load("bangturn.app.js");
    return;
  }
  if (BUZZES[id] && !late(id, s)) {
    emit("buzz");
    require("bangturn.alerts").countdown(BUZZES[id]);
  }
};

/* A countdown buzz more than LATE after its time (sched catching up after
   the watch was off) would give the wrong count of minutes left, so it is
   skipped. The turnaround alarm still shows when late. */
var LATE = MIN;
function late(id, s) {
  var e = EVENTS.filter(function (e) { return e[0] == id; })[0];
  return Date.now() - (exports.startTime(s) + e[1]) > LATE;
}

/* For the app at startup: returns the pending alert ("turn") and clears it,
   or undefined if there is none. */
exports.takeAlert = function () {
  var s = exports.read();
  var a = s.alert;
  if (a) {
    delete s.alert;
    exports.write(s);
  }
  return a;
};
