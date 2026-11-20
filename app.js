/* BangTurn app, installed as "bangturn.app.js".
   OWNED BY: UI task. Screens and menu from docs/spec.md "UI":
   - idle:    60:00 (the walk length), time of day, "Tap to start";
              swipe left opens the walk length picker (bangturn.picker).
              The button never starts a walk (it's pressed just to get
              around): it opens the idle menu (Length); a tap starts
   - running: small row with the time of day and the walk's start time,
              big m:ss countdown of the whole walk (just the minutes,
              in the same place, while locked), average speed rows,
              progress bar
   Swipe right goes back to the clock. The minutes-left widget is hidden.
   - menu:    (idle: Length; the button goes back)
              during a walk: Resume, -1 min (offset shown), Cancel walk,
              Info (GPS via phone/watch, Watch GPS chip on/off, Phone GPS
              setup check, the apps holding GPS, last fix, battery); back to the countdown
              after 10 s with no input
   Keep the startup alert hook at the bottom (see docs/ARCHITECTURE.md). */
var bt = require("bangturn");
var alerts = require("bangturn.alerts");
var speed = require("bangturn.speed");

var MENU_TIMEOUT = 10000;
var screen;      // "main" or "menu"
var drawTimer;   // pending redraw of the main screen
var clockTimer;  // pending redraw of just the time of day
var menuTimer;   // pending return from the menu to the main screen

Bangle.loadWidgets();
// the countdown is on screen, so the minutes-left widget is redundant here
if (WIDGETS.bangturn && WIDGETS.bangturn.hide) WIDGETS.bangturn.hide();

/* Largest Vector font size (<= max) at which `txt` fits in width w */
function fit(txt, max, w) {
  var s = max;
  g.setFont("Vector", s);
  while (s > 10 && g.stringWidth(txt) > w) g.setFont("Vector", --s);
  return s;
}

/* "5.2 kph", or "-- kph" before there is a speed. Not toFixed(1):
   Espruino's doesn't carry, so 4.96 would show as 4.9. */
function kph(v) {
  if (typeof v != "number" || !isFinite(v)) return "-- kph";
  var n = Math.round(v * 10);
  return Math.floor(n / 10) + "." + (n % 10) + " kph";
}

function pad(n) { return ("0" + n).substr(-2); }
/* "21:14:05" (or "21:14" without seconds) for a Date or ms timestamp */
function hms(t, secs) {
  var d = new Date(t);
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + (secs ? ":" + pad(d.getSeconds()) : "");
}

/* What the main screen shows, as plain data (also used by the tests).
   now: time of day, with seconds only while unlocked (locked redraws once
   a minute, so seconds would be stale). start: the walk's start time,
   moved earlier by any -1 min taps, always with seconds (it's fixed, so
   they never go stale). */
function lines(st, now) {
  if (now === undefined) now = Date.now();
  var locked = Bangle.isLocked();
  // locked redraws once a minute, so drop the seconds that would freeze:
  // full is the whole m:ss (for layout), time what is drawn ("47" of "47:30")
  var full = bt.fmt(st.remaining);
  var L = { full: full, time: st.active && locked ? "" + bt.mins(st.remaining) : full, rows: [] };
  L.now = hms(now, !locked);
  if (st.active) L.start = "Start " + hms(bt.startTime(), true);
  if (!st.active) L.rows.push("Tap to start", "< Swipe: length");
  else {
    var sp = speed.get() || {};
    L.rows.push("Out " + kph(sp.out));
    if (st.phase == "back") L.rows.push("Back " + kph(sp.back));
  }
  return L;
}

/* The small row above the countdown: time of day, plus the start time
   on the right during a walk */
function drawClock(L) {
  var R = Bangle.appRect, y = R.y + 12;
  g.reset().clearRect(R.x, y - 11, R.x2, y + 11);
  if (L.start) {
    var hw = R.w / 2 - 4;
    g.setFont("Vector", Math.min(fit(L.now, 18, hw), fit(L.start, 18, hw)));
    g.setFontAlign(-1, 0).drawString(L.now, R.x + 3, y);
    g.setFontAlign(1, 0).drawString(L.start, R.x2 - 3, y);
  } else {
    fit(L.now, 20, R.w - 4);
    g.setFontAlign(0, 0).drawString(L.now, R.x + R.w / 2, y);
  }
  g.setFontAlign(0, 0);
}

/* Draws the main screen; returns the status it drew */
function draw(st) {
  st = st || bt.status();
  var L = lines(st);
  var R = Bangle.appRect, x = R.x + R.w / 2, w = R.w - 4, y = R.y;
  g.reset().clearRect(R).setFontAlign(0, 0);
  // sized and placed as the full m:ss, so the minutes don't move when the
  // seconds are left off
  fit(L.full, 46, w);
  g.setFontAlign(-1, 0).drawString(L.time, x - g.stringWidth(L.full) / 2, y + 48);
  g.setFontAlign(0, 0);
  drawClock(L);
  L.rows.forEach(function (r, i) {
    fit(r, 22, w);
    g.drawString(r, x, y + 88 + i * 24);
  });
  if (!st.active) return st;
  // progress bar of the whole walk, with a notch at the turnaround
  var bx = R.x + 6, bw = R.w - 12, by = R.y2 - 16, bh = 12;
  g.drawRect(bx, by, bx + bw - 1, by + bh - 1);
  var fill = Math.round((bw - 4) * Math.min(1, st.elapsed / st.duration));
  if (fill > 0) g.fillRect(bx + 2, by + 2, bx + 1 + fill, by + bh - 3);
  var tx = bx + Math.round(bw * st.turn / st.duration);
  g.setColor(st.elapsed >= st.turn ? g.theme.bg : g.theme.fg)
    .drawLine(tx, by - 3, tx, by + bh + 2);
  g.setColor(g.theme.fg).drawLine(tx, by - 3, tx, by - 1).drawLine(tx, by + bh, tx, by + bh + 2);
  return st;
}

/* Redraw now, then every second while unlocked, every minute while locked.
   Timed to when the countdown's seconds (or minutes) change, like the
   widget, so no number is skipped or shown twice. Idle: nothing changes,
   so no timer (a "bangturn" event redraws on start).
   The time of day has its own timer on the wall clock's seconds (minutes
   while locked), which only redraws that row. */
function tick() {
  stopTimers();
  if (screen != "main") return;
  // time's up but the "end" wake-up hasn't come (sched missed it): end the
  // walk (its "end" event redraws the idle screen) rather than redrawing
  // 0 every second
  var st = bt.status();
  if (st.active && st.remaining <= 0) return bt.finish();
  draw(st);
  var period = Bangle.isLocked() ? 60000 : 1000;
  clockTimer = setTimeout(clockTick, period - (Date.now() % period) + 20);
  if (!st.active) return;
  drawTimer = setTimeout(tick, (period == 1000 ? st.remaining % 1000 || 1000 : bt.untilMins(st.remaining)) + 20);
}
function clockTick() {
  clockTimer = undefined;
  if (screen != "main") return;
  drawClock(lines(bt.status()));
  var period = Bangle.isLocked() ? 60000 : 1000;
  clockTimer = setTimeout(clockTick, period - (Date.now() % period) + 20);
}
function stopTimers() {
  if (drawTimer) clearTimeout(drawTimer);
  if (clockTimer) clearTimeout(clockTimer);
  drawTimer = clockTimer = undefined;
}

function stopMenuTimer() {
  if (menuTimer) clearTimeout(menuTimer);
  menuTimer = undefined;
}
function startMenuTimer() {
  stopMenuTimer();
  menuTimer = setTimeout(function () { menuTimer = undefined; showMain(); }, MENU_TIMEOUT);
}
/* any touch or swipe in the menu restarts the 10 s timeout */
function onMenuInput() { if (screen == "menu") startMenuTimer(); }

function showMain() {
  stopMenuTimer();
  screen = "main";
  E.showMenu();
  g.reset().clear();
  Bangle.drawWidgets();
  Bangle.setUI({
    mode: "custom",
    // the button never starts a walk (a tap does): it opens a menu, and
    // in the menu it comes back here
    btn: function () { if (bt.isActive()) showWalkMenu(); else showIdleMenu(); },
    touch: function () { if (!bt.isActive()) start(); },
    // swipe right: back to the clock (the walk keeps running);
    // swipe left before a walk: set the walk length
    swipe: function (lr) {
      if (lr > 0) load();
      else if (lr < 0 && !bt.isActive()) showPicker();
    }
  });
  tick();
}

/* The hours/minutes wheels; the length is saved for the next walk */
function showPicker() {
  stopTimers();
  screen = "picker";
  E.showMenu(); // close the idle menu, if it's open
  require("bangturn.picker").show(bt.getMins(), function (mins) {
    bt.setMins(mins);
    showMain();
  });
}

function start() {
  bt.start();
  alerts.started();
  tick();
}

/* Before a walk: set the length (a tap on the idle screen starts it). Back (or the button) returns
   to the idle screen without starting anything. */
function showIdleMenu() {
  stopTimers();
  screen = "menu";
  var menu = { "": { title: "BangTurn", back: showMain } };
  menu["Length: " + bt.getMins() + " min"] = function () { stopMenuTimer(); showPicker(); };
  E.showMenu(menu);
  startMenuTimer();
}

function showWalkMenu(selected) {
  stopTimers();
  screen = "menu";
  var off = bt.read().offset || 0;
  var menu = { "": { title: "BangTurn", back: showMain, selected: selected || 0 } };
  menu["Resume"] = showMain;
  menu["-1 min" + (off ? " (-" + off + ")" : "")] = function () {
    bt.minusOne();
    if (bt.isActive()) showWalkMenu(1); else showMain();
  };
  menu["Cancel walk"] = function () { bt.cancel(); showMain(); };
  menu["Info"] = function () { showInfo(); };
  E.showMenu(menu);
  startMenuTimer();
}

/* "34s ago" / "5m ago" for an age in ms */
function ago(ms) {
  var s = Math.round(ms / 1000);
  return s < 60 ? s + "s ago" : Math.floor(s / 60) + "m ago";
}

/* The apps holding GPS on, from the firmware's own list:
   Bangle.setGPSPower(1, "app") adds "app" to Bangle._PWR.GPS, and GPS stays
   powered while that list isn't empty ("?" is code that didn't give its
   name). Android Integration's Overwrite GPS keeps the same list. */
function gpsApps() {
  var l = Bangle._PWR && Bangle._PWR.GPS;
  return l && l.length ? l.join(", ") : "none";
}

/* Why the phone isn't (or is) supplying GPS, for Info. The phone's GPS
   needs three links, and this names the first one missing:
   - Android Integration's "Overwrite GPS" on: it then defines
     Bangle.moveGPSPower and passes GPS requests to the phone.
   - Bluetooth connected to Gadgetbridge.
   - Gadgetbridge sending fixes: its Bangle.js device setting "Use phone gps
     data" (off by default), and location permission plus "Keep location
     updated" (Gadgetbridge Settings > Location > Acquire location). The
     watch can't read those, so if fixes don't come it says "no fixes". */
function phoneGPS(src) {
  if (typeof Bangle.moveGPSPower != "function") return "setting off";
  if (!NRF.getSecurityStatus().connected) return "no Bluetooth";
  return src.from == "phone" ? "working" : "no fixes";
}

/* Info (from the walk menu): where the speeds' GPS comes from, whether the
   watch's own GPS chip (the big battery drain) is on, which apps have asked
   for GPS, how old the last fix is, and the battery. Tap a row to refresh;
   back returns to the walk menu. */
function showInfo(selected) {
  stopTimers();
  screen = "menu"; // same 10 s timeout, and closes if the walk ends
  var src = speed.source();
  var menu = { "": { title: "Info", back: function () { showWalkMenu(3); }, selected: selected || 0 } };
  var n = 0;
  function row(name, value) {
    var i = n++;
    menu[name] = { value: value, onchange: function () { showInfo(i); } };
  }
  row("GPS via", src.from || "none yet");
  row("Watch GPS", src.chip ? "ON" : "off");
  row("Phone GPS", phoneGPS(src));
  row("GPS apps", gpsApps());
  row("Last fix", src.fixAge === null ? "none" : ago(src.fixAge));
  row("Battery", E.getBattery() + "%");
  E.showMenu(menu);
  startMenuTimer();
}

function onEvent(type) {
  if (screen == "main") tick();
  else if (screen == "menu" && (type == "end" || type == "cancel")) showMain();
}
function onLock() { if (screen == "main") tick(); }

Bangle.on("bangturn", onEvent);
Bangle.on("lock", onLock);
Bangle.on("touch", onMenuInput);
Bangle.on("drag", onMenuInput);
Bangle.drawWidgets();

// Startup alert hook: a sched entry loads this app to show the turnaround.
if (bt.takeAlert() == "turn") alerts.turnaround(showMain);
else showMain();
