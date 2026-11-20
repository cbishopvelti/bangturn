/* BangTurn alerts module, installed to Storage as "bangturn.alerts".
   Spec: docs/spec.md, "Alerts". Interface: docs/ARCHITECTURE.md.

   Every alert calls Bangle.buzz directly and never checks the Quiet Mode
   setting, so they all buzz in Quiet Mode (the Quiet Mode check lives in
   apps and the "buzz" module, not in Bangle.buzz). Strength is always 1
   (full). */

/* Timings in ms, exported so tests can read them */
var T = exports.T = {
  start: 100,      // start confirmation
  short: 200,      // countdown buzz on
  gap: 300,        // countdown buzz off
  long: 600,       // turnaround buzz on
  longGap: 200,    // turnaround buzz off
  turnMax: 6000,   // turnaround alarm stops after this
  settle: 500      // after the last buzz, before twist/tap wake-ups return
};

/* One short confirmation buzz when a walk starts. Called by the app. */
exports.started = function () {
  Bangle.buzz(T.start, 1);
};

/* Buzzing shakes the accelerometer, and on a real Bangle.js 2 that can
   read as a twist or a tap, which unlocks the watch and lights it (Chris
   saw this on the countdown buzzes). While we buzz, hold() turns those
   wake-ups off; release() puts the user's settings back a moment after the
   last buzz stops. A load() also restores them, as boot code re-applies
   the settings. Calls nest. */
var WAKES = ["wakeOnTwist", "wakeOnDoubleTap", "wakeOnFaceUp"];
var saved, holds = 0, restoreTimer;
function hold() {
  if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = undefined; }
  if (holds++ || saved) return;
  var o = Bangle.getOptions(), off = {};
  saved = {};
  WAKES.forEach(function (k) { saved[k] = o[k]; off[k] = false; });
  Bangle.setOptions(off);
}
function release() {
  if (holds <= 0 || --holds) return;
  restoreTimer = setTimeout(function () {
    restoreTimer = undefined;
    if (saved && !holds) { Bangle.setOptions(saved); saved = undefined; }
  }, T.settle);
}
exports.hold = hold;       // for tests
exports.release = release;

/* Walk-back countdown: n short buzzes (1 at 15 min left, 2 at 8, 3 at 4,
   4 at 1). Runs inside whatever app is open: no drawing, no load(). Must
   not unlock the watch or light the screen: if the watch was locked and
   unlocks while we buzz anyway, it is locked again. */
exports.countdown = function (n) {
  var i = 0, wasLocked = Bangle.isLocked();
  var wasLit = Bangle.isBacklightOn ? Bangle.isBacklightOn() : Bangle.isLCDOn();
  function onLock(locked) {
    if (locked || !wasLocked) return;
    Bangle.setLocked(true);
    if (!wasLit) Bangle.setLCDPower(0);
  }
  hold();
  Bangle.on("lock", onLock);
  (function next() {
    if (i++ >= n) { // last buzz done (wake-ups return T.settle later)
      Bangle.removeListener("lock", onLock);
      release();
      return;
    }
    Bangle.buzz(T.short, 1);
    setTimeout(next, T.short + T.gap);
  })();
};

/* The turnaround alarm currently running, if any (so a second call while
   one is running doesn't stack two alarms). */
var active;

/* Turnaround alarm. Called by the app at startup when
   require("bangturn").takeAlert() returns "turn". Lights the screen, shows
   "TURN AROUND" full screen and repeats long full-strength buzzes until the
   watch unlocks (lock event with false), a button press or tap, or 6 s,
   whichever comes first. No repeats after that. Twist, tap and face-up
   wake-ups are off while it runs, so the buzzing can't unlock it. Then calls done() once.
   Returns a function that stops the alarm early. */
exports.turnaround = function (done) {
  if (active) active(); // stop (and complete) any alarm already running
  // Each buzz is timed with setTimeout rather than Bangle.buzz's promise, so
  // the pattern is the same everywhere (the emulator resolves it at once).
  var stopped = false, timer, gapTimer, btnWatch;

  function draw() {
    var w = g.getWidth(), h = g.getHeight();
    g.reset().setBgColor(g.theme.bg).clear();
    g.setColor(g.theme.fg).fillRect(0, 0, w - 1, h - 1);
    g.setColor(g.theme.bg).setFontAlign(0, 0).setFont("Vector", 40)
      .drawString("TURN", w / 2, h / 2 - 24)
      .drawString("AROUND", w / 2, h / 2 + 24);
    g.reset();
  }

  function onLock(locked) { if (!locked) stop(); }

  function buzz() {
    if (stopped) return;
    Bangle.setLCDPower(1); // keep the screen lit for the whole alarm
    Bangle.buzz(T.long, 1);
    gapTimer = setTimeout(buzz, T.long + T.longGap);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (active === stop) active = undefined;
    if (timer) clearTimeout(timer);
    if (gapTimer) clearTimeout(gapTimer);
    Bangle.removeListener("lock", onLock);
    if (btnWatch) clearWatch(btnWatch);
    try { digitalWrite(VIBRATE, 0); } catch (e) {} // cut a buzz mid-way
    release();
    Bangle.setUI();
    g.reset().clear();
    if (global.WIDGETS) Bangle.drawWidgets();
    if (done) done();
  }

  active = stop;
  // Only a real look stops it: the buzzing mustn't fake a twist or tap that
  // unlocks the watch (which would end the alarm after one buzz).
  hold();
  // setUI drops the app's own handlers while the alarm shows; the button is
  // our own watch (one press, then cleared in stop()).
  Bangle.setUI({ mode: "custom", touch: stop });
  btnWatch = setWatch(stop, BTN1, { edge: "falling", repeat: false });
  Bangle.on("lock", onLock);
  Bangle.setLCDPower(1);
  draw();
  timer = setTimeout(stop, T.turnMax);
  buzz();
  return stop;
};
