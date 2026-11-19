/* BangTurn app, installed as "bangturn.app.js".
   OWNED BY: UI task. This is a minimal working stub of the screens in
   docs/spec.md "UI"; replace the drawing and menu, but keep the startup
   alert hook below (see docs/ARCHITECTURE.md). */
var bt = require("bangturn");
var alerts = require("bangturn.alerts");
var drawTimer;

Bangle.loadWidgets();

function draw() {
  var st = bt.status();
  var R = Bangle.appRect, x = R.x + R.w / 2;
  g.reset().clearRect(R).setFontAlign(0, 0);
  g.setFont("Vector", 36).drawString(bt.fmt(st.remaining), x, R.y + 40);
  g.setFont("6x8", 2);
  if (!st.active) g.drawString("Press to start", x, R.y + 110);
  g.drawString(st.phase == "back" ? "Heading home" : "Turn around at " + bt.fmt(bt.TURN).substr(2), x, R.y + 80);
}

function tick() {
  if (drawTimer) clearTimeout(drawTimer);
  draw();
  var period = Bangle.isLocked() ? 60000 : 1000;
  drawTimer = setTimeout(tick, period - (Date.now() % period));
}

function showMain() {
  E.showMenu();
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

function showWalkMenu() {
  if (drawTimer) clearTimeout(drawTimer);
  drawTimer = undefined;
  Bangle.setUI();
  var off = bt.read().offset || 0;
  var menu = { "": { title: "BangTurn", back: showMain }, "Resume": showMain };
  menu["-1 min" + (off ? " (-" + off + ")" : "")] = function () {
    bt.minusOne();
    if (bt.isActive()) showWalkMenu(); else showMain();
  };
  menu["Cancel walk"] = function () { bt.cancel(); showMain(); };
  E.showMenu(menu);
}

Bangle.on("bangturn", function () { if (drawTimer) tick(); });
Bangle.on("lock", function () { if (drawTimer) tick(); });
Bangle.drawWidgets();

// Startup alert hook: a sched entry loads this app to show the turnaround.
if (bt.takeAlert() == "turn") alerts.turnaround(showMain);
else showMain();
