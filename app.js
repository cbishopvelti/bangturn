/* BangTurn app, installed as "bangturn.app.js".
   OWNED BY: UI task. Screens and menu from docs/spec.md "UI":
   - idle:    1:00:00, "Turn around at 30:00", "Press to start"
   - running: big h:mm:ss countdown of the whole walk, "Turn around at 30:00"
              then "Heading home", average speed rows, progress bar
   - menu:    Resume, -1 min (offset shown), Cancel walk; back to the
              countdown after 10 s with no input
   Keep the startup alert hook at the bottom (see docs/ARCHITECTURE.md). */
var bt = require("bangturn");
var alerts = require("bangturn.alerts");
var speed = require("bangturn.speed");

var MENU_TIMEOUT = 10000;
var screen;      // "main" or "menu"
var drawTimer;   // pending redraw of the main screen
var menuTimer;   // pending return from the menu to the main screen

Bangle.loadWidgets();

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

/* What the main screen shows, as plain data (also used by the tests) */
function lines(st) {
  var L = { time: bt.fmt(st.remaining), rows: [] };
  L.sub = st.phase == "back" ? "Heading home" : "Turn around at " + bt.fmt(bt.TURN).substr(2);
  if (!st.active) L.rows.push("Press to start");
  else {
    var sp = speed.get() || {};
    L.rows.push("Out " + kph(sp.out));
    if (st.phase == "back") L.rows.push("Back " + kph(sp.back));
  }
  return L;
}

/* Draws the main screen; returns the status it drew */
function draw() {
  var st = bt.status();
  var L = lines(st);
  var R = Bangle.appRect, x = R.x + R.w / 2, w = R.w - 4, y = R.y;
  g.reset().clearRect(R).setFontAlign(0, 0);
  fit(L.time, 46, w);
  g.drawString(L.time, x, y + 26);
  fit(L.sub, 20, w);
  g.drawString(L.sub, x, y + 62);
  L.rows.forEach(function (r, i) {
    fit(r, 22, w);
    g.drawString(r, x, y + 88 + i * 24);
  });
  if (!st.active) return st;
  // progress bar of the whole walk, with a notch at the turnaround
  var bx = R.x + 6, bw = R.w - 12, by = R.y2 - 16, bh = 12;
  g.drawRect(bx, by, bx + bw - 1, by + bh - 1);
  var fill = Math.round((bw - 4) * Math.min(1, st.elapsed / bt.DURATION));
  if (fill > 0) g.fillRect(bx + 2, by + 2, bx + 1 + fill, by + bh - 3);
  var tx = bx + Math.round(bw * bt.TURN / bt.DURATION);
  g.setColor(st.elapsed >= bt.TURN ? g.theme.bg : g.theme.fg)
    .drawLine(tx, by - 3, tx, by + bh + 2);
  g.setColor(g.theme.fg).drawLine(tx, by - 3, tx, by - 1).drawLine(tx, by + bh, tx, by + bh + 2);
  return st;
}

/* Redraw now, then every second while unlocked, every minute while locked.
   Timed to when the countdown's seconds (or minutes) change, like the
   widget, so no number is skipped or shown twice. Idle: nothing changes,
   so no timer (a "bangturn" event redraws on start). */
function tick() {
  if (drawTimer) clearTimeout(drawTimer);
  drawTimer = undefined;
  if (screen != "main") return;
  var st = draw();
  if (!st.active) return;
  var period = Bangle.isLocked() ? 60000 : 1000;
  drawTimer = setTimeout(tick, (st.remaining % period || period) + 20);
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
    btn: function () { if (bt.isActive()) showWalkMenu(); else start(); },
    touch: function () { if (!bt.isActive()) start(); }
  });
  tick();
}

function start() {
  bt.start();
  alerts.started();
  tick();
}

function showWalkMenu(selected) {
  if (drawTimer) clearTimeout(drawTimer);
  drawTimer = undefined;
  screen = "menu";
  var off = bt.read().offset || 0;
  var menu = { "": { title: "BangTurn", back: showMain, selected: selected || 0 } };
  menu["Resume"] = showMain;
  menu["-1 min" + (off ? " (-" + off + ")" : "")] = function () {
    bt.minusOne();
    if (bt.isActive()) showWalkMenu(1); else showMain();
  };
  menu["Cancel walk"] = function () { bt.cancel(); showMain(); };
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
