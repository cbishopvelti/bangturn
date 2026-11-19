/* UI tests: idle, running and menu screens in app.js.
   Run: npm test  (or: node tests/run.js tests/ui.test.js -v --grep=name)
   The emulator clock can't advance, so walks start in the past. */
const { test, assert } = require("./harness");

const MIN = 60000;
const BT = 'require("bangturn")';

/* Replace the speed module with one that returns global.SP from get().
   resume() and event() are what bangturn.boot.js calls during a walk. */
var FAKE_SPEED = "exports.resume=exports.event=function(){};exports.get=function(){GET}";
function fakeSpeed(h, get) {
  var src = FAKE_SPEED.replace("GET", get === undefined ? "return global.SP||{out:null,back:null}" : get);
  h.tx(`require("Storage").write("bangturn.speed",${JSON.stringify(src)})`);
}
/* What the main screen shows right now, without the time of day (checked
   on its own below, since it changes as the test runs) */
function screenText(h) {
  const L = h.eval(`lines(${BT}.status())`);
  delete L.now;
  delete L.full;
  return L;
}
/* "HH:MM:SS" of a watch timestamp, as the watch formats it */
function hms(h, t) {
  return h.eval(`(function(d){function p(n){return ("0"+n).substr(-2)}return p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())})(new Date(${t}))`);
}
/* Record strings drawn to the screen in global.DRAWN */
function spyDraw(h) {
  h.tx(`global.DRAWN=[];(function(o){g.drawString=function(s){DRAWN.push(""+s);return o.apply(g,arguments)}})(g.drawString)`);
}
/* Record E.showMenu calls; the last menu object is MENU (null when closed) */
function spyMenu(h) {
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
}
function menuItems(h) {
  return h.eval(`MENU&&Object.keys(MENU).filter(function(k){return k!==""})`);
}
/* Capture setWatch callbacks so the test can "press" the button, then
   rebuild the main screen's UI so its button watch is captured. */
function captureButton(h) {
  h.tx(`global.WATCHES=[];(function(o){global.setWatch=function(cb,pin,opt){WATCHES.push(cb);return o.apply(this,arguments)}})(setWatch)`);
  h.tx("showMain()");
}
function press(h) {
  h.tx(`WATCHES[WATCHES.length-1]({state:false,time:getTime(),lastTime:getTime()-0.1})`);
}

test("idle screen: 60:00, time of day, press to start", async h => {
  await h.load("bangturn.app.js");
  assert.eq(screenText(h), { time: "60:00", rows: ["Press to start"] });
  assert.eq(h.eval("screen"), "main");
  h.tx('Bangle.setLocked(false)');
  spyDraw(h);
  h.tx('Bangle.emit("lock",false)');
  const drawn = h.eval("DRAWN");
  for (const s of ["60:00", "Press to start"])
    assert(drawn.includes(s), `drew "${s}": ${JSON.stringify(drawn)}`);
  assert(drawn.some(s => /^\d\d:\d\d:\d\d$/.test(s)), "drew the time with seconds: " + JSON.stringify(drawn));
  assert(!drawn.some(s => s.indexOf("Turn around") >= 0), "no turnaround line");
});

test("time of day has seconds while unlocked, not while locked", async h => {
  await h.load("bangturn.app.js");
  const t = h.eval("new Date(2026,10,19,9,5,7).getTime()");
  h.tx("Bangle.setLocked(false)");
  assert.eq(h.eval(`lines(${BT}.status(),${t}).now`), "09:05:07");
  h.tx("Bangle.setLocked(true)");
  assert.eq(h.eval(`lines(${BT}.status(),${t}).now`), "09:05");
});

test("time of day ticks on its own: seconds unlocked, minutes locked, also when idle", async h => {
  await h.load("bangturn.app.js");
  h.tx('Bangle.setLocked(false);Bangle.emit("lock",false)');
  spyDraw(h);
  await h.wait(2600);
  const secs = h.eval('DRAWN.filter(function(s){return /^\\d\\d:\\d\\d:\\d\\d$/.test(s)})');
  assert(secs.length >= 2 && secs.length <= 4, "clock redraws in 2.6 s: " + JSON.stringify(secs));
  assert(new Set(secs).size == secs.length, "a new second each time: " + JSON.stringify(secs));
  assert.eq(h.eval("drawTimer===undefined"), true, "idle: no countdown timer");
  h.tx('Bangle.setLocked(true);Bangle.emit("lock",true)');
  await h.wait(300);
  const next = h.eval("clockTimer&&global['\\xff'].timers[clockTimer].time/1000");
  assert(next > 1000 && next <= 60100, "next clock redraw on the minute: " + next);
  h.tx("showWalkMenu()");
  assert.eq(h.eval("clockTimer===undefined"), true, "no clock timer in the menu");
});

test("running out: countdown, time of day and start time, Out row", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 12 * MIN})`);
  await h.load("bangturn.app.js");
  const t = screenText(h);
  assert(t.time == "48:00" || t.time == "47:59" || t.time == "47:58", "time " + t.time);
  assert.eq(t.start, "Start " + hms(h, now - 12 * MIN));
  assert.eq(t.rows, ["Out -- kph"], "no fix yet");
  h.tx('Bangle.setLocked(false)');
  spyDraw(h);
  h.tx('Bangle.emit("lock",false)');
  const drawn = h.eval("DRAWN");
  assert(drawn.includes(t.start), "drew the start time: " + JSON.stringify(drawn));
  assert(drawn.some(s => /^\d\d:\d\d:\d\d$/.test(s)), "drew the time with seconds: " + JSON.stringify(drawn));
  assert(!drawn.some(s => s.indexOf("Turn around") >= 0), "no turnaround line");
});

test("locked: countdown drops the seconds, minutes stay in place", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 12 * MIN - 20000})`);
  await h.load("bangturn.app.js");
  // record [string, x, font size] for each drawString
  h.tx(`global.AT=[];(function(o){g.drawString=function(s,x){AT.push([""+s,Math.round(x),g.getFont()]);return o.apply(g,arguments)}})(g.drawString)`);
  h.tx('Bangle.setLocked(false);Bangle.emit("lock",false)');
  const open = h.eval("AT").find(a => /^47:[34]\d$/.test(a[0]));
  assert(open, "unlocked: m:ss " + JSON.stringify(h.eval("AT")));
  h.tx('AT=[];Bangle.setLocked(true);Bangle.emit("lock",true)');
  assert.eq(screenText(h).time, "47", "just the minutes");
  assert(/^Start \d\d:\d\d:\d\d$/.test(screenText(h).start), "start keeps its seconds: " + screenText(h).start);
  const shut = h.eval("AT").find(a => a[0] == "47");
  assert(shut, "drew 47: " + JSON.stringify(h.eval("AT")));
  assert.eq([shut[1], shut[2]], [open[1], open[2]], "same x and font as in m:ss");
});

test("swipe right goes back to the clock, the walk keeps running", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx('Bangle.emit("swipe",-1,0)');
  await h.wait(300);
  assert.eq(h.eval("global.__FILE__"), "bangturn.app.js", "swipe left does nothing");
  h.tx('global.LOADING=1;Bangle.emit("swipe",1,0)');
  for (let i = 0; i < 100 && h.eval("global.LOADING!==undefined"); i++) await h.wait(20);
  await h.wait(100);
  assert(h.eval("global.__FILE__") != "bangturn.app.js", "left the app: " + h.eval("global.__FILE__"));
  assert(h.eval(`${BT}.isActive()`), "walk still running");
});

test("minutes-left widget is hidden inside the app", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load();
  assert.eq(h.eval("WIDGETS.bangturn.width"), 28, "shown on the clock");
  await h.load("bangturn.app.js");
  assert.eq(h.eval("WIDGETS.bangturn.width"), 0, "hidden in the app");
  h.tx('Bangle.emit("bangturn","offset")');
  assert.eq(h.eval("WIDGETS.bangturn.width"), 0, "stays hidden after an event");
});

test("running back: Out and Back speed rows", async h => {
  fakeSpeed(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 41 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.23,back:4.87}");
  const t = screenText(h);
  assert.eq(t.rows, ["Out 5.2 kph", "Back 4.9 kph"]);
  h.tx("global.SP={out:5.2,back:null}");
  assert.eq(screenText(h).rows, ["Out 5.2 kph", "Back -- kph"]);
  spyDraw(h);
  h.tx('Bangle.emit("bangturn","offset")');
  const drawn = h.eval("DRAWN");
  assert(drawn.includes("Back -- kph"), JSON.stringify(drawn));
});

test("speed hook returning nothing still draws", async h => {
  fakeSpeed(h, "");
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  assert.eq(screenText(h).rows, ["Out -- kph"]);
});

test("redraws every second when unlocked, every minute when locked", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx('Bangle.setLocked(false);Bangle.emit("lock",false)');
  spyDraw(h);
  await h.wait(2600);
  const unlocked = h.eval('DRAWN.filter(function(s){return /^\\d+:\\d\\d$/.test(s)}).length');
  assert(unlocked >= 2 && unlocked <= 4, "unlocked redraws in 2.6 s: " + unlocked);
  h.tx('Bangle.setLocked(true);Bangle.emit("lock",true)');
  await h.wait(300); // the lock change itself redraws once
  assert(h.eval("Bangle.isLocked()"), "locked");
  h.tx("DRAWN=[]");
  await h.wait(2600);
  assert.eq(h.eval('DRAWN.filter(function(s){return /^\\d+$/.test(s)}).length'), 0, "no redraw while locked");
  const next = h.eval("drawTimer&&global['\\xff'].timers[drawTimer].time/1000");
  assert(next > 1000 && next <= 60000, "next redraw on the minute: " + next);
});

test("tap on idle screen starts the walk; tap while running does nothing", async h => {
  await h.load("bangturn.app.js");
  h.tx(`Bangle.emit("touch",1,{x:88,y:88})`);
  await h.wait(100);
  const s1 = h.eval(`${BT}.read().start`);
  assert(s1, "walk started");
  h.tx(`Bangle.emit("touch",1,{x:88,y:88})`);
  await h.wait(100);
  assert.eq(h.eval(`${BT}.read().start`), s1, "same walk");
  assert.eq(h.eval("screen"), "main");
});

test("button on idle screen starts the walk", async h => {
  await h.load("bangturn.app.js");
  captureButton(h);
  press(h);
  await h.wait(100);
  assert(h.eval(`${BT}.isActive()`), "walk started");
  assert.eq(h.eval("screen"), "main");
});

test("button while running opens the menu: Resume, -1 min, Cancel walk", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  captureButton(h);
  press(h);
  await h.wait(100);
  assert.eq(h.eval("screen"), "menu");
  assert.eq(menuItems(h), ["Resume", "-1 min", "Cancel walk"]);
  h.tx('MENU["Resume"]()');
  assert.eq(h.eval("screen"), "main");
  assert.eq(h.eval("MENU"), null, "menu closed");
  assert(h.eval(`${BT}.isActive()`), "walk still running");
});

test("-1 min shows the offset and stays in the menu", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["-1 min"]()');
  assert.eq(h.eval("screen"), "menu");
  assert.eq(menuItems(h), ["Resume", "-1 min (-1)", "Cancel walk"]);
  assert.eq(h.eval('MENU[""].selected'), 1, "keeps -1 min selected");
  h.tx('MENU["-1 min (-1)"]()');
  h.tx('MENU["-1 min (-2)"]()');
  assert.eq(menuItems(h), ["Resume", "-1 min (-3)", "Cancel walk"]);
  assert.eq(h.eval(`${BT}.read().offset`), 3);
  h.tx('MENU["Resume"]()');
  const t = screenText(h);
  assert(t.time == "52:00" || t.time == "51:59" || t.time == "51:58", "time " + t.time);
  assert.eq(t.start, "Start " + hms(h, now - 8 * MIN), "start time moved 3 min earlier");
});

test("-1 min past the turnaround switches to the way back", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 29.5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["-1 min"]()');
  h.tx('MENU["Resume"]()');
  const t = screenText(h);
  assert.eq(h.eval(`${BT}.status().phase`), "back");
  assert.eq(t.rows.length, 2);
});

test("-1 min past the end returns to the idle screen", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 59.5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["-1 min"]()');
  assert.eq(h.eval("screen"), "main");
  assert.eq(screenText(h).rows, ["Press to start"]);
});

test("Cancel walk clears the walk and shows the idle screen", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["Cancel walk"]()');
  assert.eq(h.eval("screen"), "main");
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval(`${BT}.getSched()`), []);
  assert.eq(screenText(h), { time: "60:00", rows: ["Press to start"] });
});

test("menu returns to the countdown after 10 s without input", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("MENU_TIMEOUT=1500"); // same code path, shorter wait
  h.tx("showWalkMenu()");
  await h.wait(1000);
  h.tx('Bangle.emit("drag",{x:80,y:80,dx:0,dy:5,b:1})'); // input restarts the timeout
  await h.wait(1000);
  assert.eq(h.eval("screen"), "menu", "still in menu after input");
  await h.wait(1000);
  assert.eq(h.eval("screen"), "main", "back to countdown");
  assert(h.eval(`${BT}.isActive()`), "walk still running");
});

test("menu timeout defaults to 10 s", async h => {
  await h.load("bangturn.app.js");
  assert.eq(h.eval("MENU_TIMEOUT"), 10000);
});

test("walk ending while the menu is open returns to idle", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 30 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("showWalkMenu()");
  h.tx(`${BT}.fire("end")`);
  assert.eq(h.eval("screen"), "main");
  assert.eq(screenText(h).rows, ["Press to start"]);
});

test("turnaround alert then the countdown", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 30 * MIN})`);
  h.tx(`require("Storage").writeJSON("bangturn.json",Object.assign(${BT}.read(),{turned:true,alert:"turn"}))`);
  await h.load("bangturn.app.js");
  assert.eq(h.eval(`${BT}.read().alert===undefined`), true, "alert taken");
  await h.wait(7000); // the alarm stops after at most 6 s
  assert.eq(h.eval("screen"), "main");
  assert.eq(screenText(h).rows.length, 2, "Out and Back rows");
});
