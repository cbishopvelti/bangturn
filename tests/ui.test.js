/* UI tests: idle, running and menu screens in app.js.
   Run: npm test  (or: node tests/run.js tests/ui.test.js -v --grep=name)
   The emulator clock can't advance, so walks start in the past. */
const { test, assert, speedRows } = require("./harness");

const MIN = 60000;
const BT = 'require("bangturn")';

/* Replace the speed module with one that returns global.SP from get().
   resume() and event() are what bangturn.boot.js calls during a walk. */
var FAKE_SPEED = "exports.resume=exports.event=function(){};exports.get=function(){GET};" +
  "exports.source=function(){return {from:null,chip:false,fixAge:null}};";
function fakeSpeed(h, get) {
  var src = FAKE_SPEED.replace("GET", get === undefined ? "return global.SP||{out:null,back:null}" : get);
  h.tx(`require("Storage").write("bangturn.speed",${JSON.stringify(src)})`);
}
/* What the main screen shows right now, without the time of day (checked
   on its own below, since it changes as the test runs) */
function screenText(h) {
  const L = h.eval(`lines(${BT}.status())`);
  delete L.now; delete L.nowFull;
  delete L.full;
  L.rows = speedRows(L.rows); // "Out 5.2 kph": the whole rows are in rawRows()
  return L;
}
/* The rows as lines() gives them: with the times to the origin and Now/Need */
const rawRows = h => h.eval(`lines(${BT}.status()).rows`);
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

test("idle screen: 60:00, time of day, tap to start", async h => {
  await h.load("bangturn.app.js");
  assert.eq(screenText(h), { time: "60:00", rows: ["Tap to start", "Button: length"] });
  assert.eq(h.eval("screen"), "main");
  h.tx('Bangle.setLocked(false)');
  spyDraw(h);
  h.tx('Bangle.emit("lock",false)');
  const drawn = h.eval("DRAWN");
  for (const s of ["60:00", "Tap to start"])
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
  // due at the next whole minute: anywhere up to 60 s away, and under 1 s
  // when the lock lands in a minute's last second
  const toMinute = 60000 - h.eval("Date.now()") % 60000;
  assert(next > 0 && next <= 60100 && (Math.abs(next - toMinute) % 60000 < 400 || Math.abs(next - toMinute) > 59600), "next clock redraw on the minute: " + next + ", minute in " + toMinute);
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
  assert(drawn.includes("Start") && drawn.includes(t.start.substr(6)), "drew the start time: " + JSON.stringify(drawn));
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
  assert(drawn.includes("Back") && drawn.includes("--"), JSON.stringify(drawn));
});

test("time to the origin beside each speed, and the Now and Need row", async h => {
  fakeSpeed(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 12 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(false)");
  // 1 km from the origin by the trail, 48 min left: 1.25 kph gets you there at 0
  h.tx("global.SP={out:5,back:null,now:5.64,home:1}");
  assert.eq(rawRows(h), [
    { a: "Out", v: "5.0", tf: "12:00", t: "12:00" },
    { a: "Now", v: "5.6", b: "Need", w: "1.3", c: 1 }], "walking out: no Back row");
  h.tx(`for(var i=0;i<24;i++)${BT}.minusOne()`); // 36 min in: 24 min left
  h.tx("global.SP={out:5.2,back:4.8,now:4.96,home:2}");
  const r = rawRows(h);
  assert.eq(r[0], { a: "Out", v: "5.2", tf: "23:05", t: "23:05" }, "2 km at 5.2 kph");
  assert.eq(r[1], { a: "Back", v: "4.8", tf: "25:00", t: "25:00" }, "2 km at 4.8 kph");
  assert.eq([r[2].a, r[2].v, r[2].b], ["Now", "5.0", "Need"]);
  assert(r[2].w == "5.0" || r[2].w == "5.1", "2 km in just under 24 min: " + r[2].w);
  assert.eq(r.length, 3);
});

test("nothing to show yet is --, never a made-up number", async h => {
  fakeSpeed(h);
  h.tx(`${BT}.start(${h.eval("Date.now()") - 40 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(false)");
  const none = { a: "Now", v: "--", b: "Need", w: "--" };
  assert.eq(rawRows(h), [{ a: "Out", v: "--", tf: "--", t: "--" }, { a: "Back", v: "--", tf: "--", t: "--" }, none],
    "no GPS yet");
  h.tx("global.SP={out:5,back:null,now:null,home:1.5}");
  assert.eq(rawRows(h)[1], { a: "Back", v: "--", tf: "--", t: "--" }, "no Back speed yet");
  assert.eq(rawRows(h)[0].tf, "18:00");
  assert.eq(rawRows(h)[2].v, "--", "no speed now");
  assert(rawRows(h)[2].w != "--", "the speed needed only takes the way home and the countdown");
  h.tx("global.SP={out:5,back:0,now:0,home:1.5}");
  assert.eq(rawRows(h)[1], { a: "Back", v: "0.0", tf: "--", t: "--" }, "standing still since the turnaround: never");
  assert.eq(rawRows(h)[2].v, "0.0");
  h.tx("global.SP={out:5,back:4,now:4,home:0}");
  assert.eq(rawRows(h)[1].tf, "0:00", "at the origin");
  assert.eq(rawRows(h)[2].w, "0.0");
  h.tx("global.SP={out:5,back:0.01,now:4,home:3}");
  assert.eq(rawRows(h)[1].tf, "--", "over 999 minutes");
  h.tx(`for(var i=0;i<19;i++)${BT}.minusOne()`); // under a minute left, 3 km to go
  assert.eq(rawRows(h)[2].w, "99+", "more than 100 kph needed");
  assert.eq(h.eval("kph(99.94)"), "99.9");
  assert.eq(h.eval("kph(99.96)"), "99+");
  assert.eq(h.eval("kph(4.96)"), "5.0"); // toFixed(1) gives 4.9 here
});

test("locked: times to the origin drop their seconds and stay in place; rows don't move", async h => {
  fakeSpeed(h);
  h.tx(`${BT}.start(${h.eval("Date.now()") - 40 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.2,back:4.8,now:5.1,home:1.4}");
  // record [string, x, y, font, x alignment is left] for each drawString
  h.tx(`global.AT=[];(function(o){g.drawString=function(s,x,y){AT.push([""+s,Math.round(x),Math.round(y),g.getFont()]);return o.apply(g,arguments)}})(g.drawString)`);
  h.tx('Bangle.setLocked(false);Bangle.emit("lock",false)');
  const open = h.eval("AT");
  const at = (list, s) => list.find(a => a[0] == s) || assert(false, `drew "${s}": ${JSON.stringify(list)}`);
  assert.eq(rawRows(h)[0].t, "16:10");
  assert.eq(rawRows(h)[1].t, "17:30");
  h.tx('AT=[];Bangle.setLocked(true);Bangle.emit("lock",true)');
  const shut = h.eval("AT");
  assert.eq(rawRows(h).map(r => r.t || ""), ["16", "17", ""], "just the minutes");
  assert.eq(rawRows(h)[0].tf, "16:10", "still placed as the whole m:ss");
  assert.eq(at(shut, "16").slice(1), at(open, "16:10").slice(1), "same place and font as in m:ss");
  assert.eq(at(shut, "17").slice(1), at(open, "17:30").slice(1));
  // columns: labels share an x, speeds end at the same x, rows are evenly spaced
  for (const l of [open, shut]) {
    const y = ["Out", "Back", "Now"].map(s => at(l, s));
    assert.eq([y[1][1], y[2][1]], [y[0][1], y[0][1]], "labels line up");
    assert.eq(y[2][2] - y[1][2], y[1][2] - y[0][2], "evenly spaced");
    assert.eq([at(l, "4.8")[1], at(l, "5.1")[1]], [at(l, "5.2")[1], at(l, "5.2")[1]], "speeds line up");
    assert(y[2][2] + 9 < h.eval("Bangle.appRect.y2") - 3, "clear of the bottom of the screen");
    assert(y[0][2] - 9 > h.eval("Bangle.appRect.y") + 82, "clear of the countdown");
  }
  // on the way out the Now row is already in the bottom place
  h.tx(`${BT}.start(Date.now()-5*${MIN})`);
  h.tx('AT=[];Bangle.emit("lock",true)');
  const out = h.eval("AT");
  assert.eq(at(out, "Now").slice(1), at(shut, "Now").slice(1), "Now doesn't move at the turnaround");
  assert.eq(at(out, "Out").slice(1), at(shut, "Out").slice(1));
  assert(!out.some(a => a[0] == "Back"), "no Back row yet");
});

test("the Now number is green on the speed needed, towards red when slower, towards the text colour when faster", async h => {
  fakeSpeed(h);
  h.tx(`${BT}.start(${h.eval("Date.now()") - 40 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(false)");
  // 20 min left (less the seconds the test takes): 1.5 km needs 4.5 kph
  const c = now => { h.tx(`global.SP={out:5,back:5,now:${now},home:1.5}`); return rawRows(h)[2].c; };
  assert.near(c(4.5), 0, 0.03, "on the speed needed");
  assert.near(c(4.0), -0.5, 0.03, "half a kph slow: halfway to red");
  assert.eq(c(3.4), -1, "a kph or more slow");
  assert.near(c(4.75), 0.25, 0.03, "a little fast");
  assert.eq(c(6), 1, "a kph or more fast");
  h.tx("global.SP={out:5,back:5,now:null,home:1.5}");
  assert.eq(rawRows(h)[2].c === undefined, true, "no speed now: no colour");
  h.tx("global.SP={out:5,back:5,now:5,home:null}");
  assert.eq(rawRows(h)[2].c === undefined, true, "no speed needed: no colour");
  const col = s => h.eval(`g.toColor(${JSON.stringify(s)})`), fg = h.eval("g.theme.fg");
  assert.eq(h.eval("nowColour(0)"), col("#0f0"), "green");
  assert.eq(h.eval("nowColour(-1)"), col("#f00"), "red");
  assert.eq(h.eval("nowColour(1)"), fg, "the text colour");
  assert.eq(h.eval("nowColour(undefined)"), fg);
  assert.eq(h.eval("nowColour(-0.5)"), h.eval("g.toColor(0.5,0.5,0)"), "halfway between green and red");
  assert.eq(h.eval("nowColour(0.5)"), h.eval("g.toColor(0,0.5,0)"), "halfway between green and black");
  // on screen: only the Now number is coloured
  const R = h.eval("Bangle.appRect");
  const colours = (x1, x2) => h.eval(`(function(){var c={};for(var y=${R.y2 - 22};y<=${R.y2 - 2};y++)for(var x=${x1};x<=${x2};x++){var p=g.getPixel(x,y);if(p!=g.theme.bg)c[p]=1}return Object.keys(c).map(function(k){return +k})})()`);
  h.tx("global.SP={out:5,back:5,now:3,home:1.5};tick()");
  assert.eq(colours(R.x + 40, R.x + 76), [col("#f00")], "the number is red when far too slow");
  assert.eq(colours(R.x, R.x + 34), [fg], "the label keeps the text colour");
  assert.eq(colours(R.x + 78, R.x2), [fg], "kph, Need and its number keep the text colour");
  h.tx("global.SP={out:5,back:5,now:9,home:1.5};tick()");
  assert.eq(colours(R.x + 40, R.x + 76), [fg], "the text colour when well ahead");
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

test("button on idle screen opens the idle menu and never starts a walk", async h => {
  await h.load("bangturn.app.js");
  spyMenu(h);
  captureButton(h);
  press(h);
  await h.wait(100);
  assert(!h.eval(`${BT}.isActive()`), "no walk started");
  assert.eq(h.eval("screen"), "menu");
  assert.eq(menuItems(h), ["Length: 60 min", "Info"]);
  // the menu's back (what the button does in a menu) returns to idle
  h.tx('MENU[""].back()');
  assert.eq(h.eval("screen"), "main");
  assert(!h.eval(`${BT}.isActive()`), "still no walk");
  assert.eq(screenText(h).rows, ["Tap to start", "Button: length"]);
});

test("idle menu: Length opens the picker", async h => {
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showIdleMenu()");
  h.tx('MENU["Length: 60 min"]()');
  assert.eq(h.eval("screen"), "picker");
  assert(!h.eval(`${BT}.isActive()`), "no walk started");
});

test("idle menu returns to the idle screen after 10 s without input", async h => {
  await h.load("bangturn.app.js");
  h.tx("MENU_TIMEOUT=500");
  h.tx("showIdleMenu()");
  await h.wait(800);
  assert.eq(h.eval("screen"), "main");
  assert(!h.eval(`${BT}.isActive()`), "no walk started");
});

test("button while running opens the menu: Resume, -1 min, Cancel walk, Info", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  captureButton(h);
  press(h);
  await h.wait(100);
  assert.eq(h.eval("screen"), "menu");
  assert.eq(menuItems(h), ["Resume", "-1 min", "Cancel walk", "Info"]);
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
  assert.eq(menuItems(h), ["Resume", "-1 min (-1)", "Cancel walk", "Info"]);
  assert.eq(h.eval('MENU[""].selected'), 1, "keeps -1 min selected");
  h.tx('MENU["-1 min (-1)"]()');
  h.tx('MENU["-1 min (-2)"]()');
  assert.eq(menuItems(h), ["Resume", "-1 min (-3)", "Cancel walk", "Info"]);
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
  assert.eq(screenText(h).rows, ["Tap to start", "Button: length"]);
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
  assert.eq(screenText(h), { time: "60:00", rows: ["Tap to start", "Button: length"] });
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
  assert.eq(screenText(h).rows, ["Tap to start", "Button: length"]);
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

test("Info: where GPS comes from, whether the watch's chip is on, last fix, battery", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["Info"]()');
  assert.eq(menuItems(h), ["GPS via", "Watch GPS", "Phone GPS", "GPS apps", "Last fix", "Battery"]);
  assert.eq(h.eval("screen"), "menu", "the menu's timeout applies");
  assert.eq(h.eval('MENU["GPS via"].value'), "none yet");
  assert.eq(h.eval('MENU["Watch GPS"].value'), "off");
  assert.eq(h.eval('MENU["Last fix"].value'), "none");
  assert.eq(h.eval('MENU["Battery"].value'), h.eval("E.getBattery()") + "%");
  // a fix from the phone (Gadgetbridge marks them externalSource), with the
  // chip still on (as just after an app loads); tapping a row refreshes
  h.tx('Bangle.getGPSFix=function(){return {fix:0}};Bangle.emit("GPS",{fix:1,lat:51.5,lon:-0.12,hdop:1,satellites:8,time:new Date(),externalSource:true})');
  await h.wait(1100);
  h.tx('MENU["Watch GPS"].onchange()');
  assert.eq(h.eval('MENU["GPS via"].value'), "phone");
  assert.eq(h.eval('MENU["Watch GPS"].value'), "ON");
  assert.eq(h.eval('MENU["Last fix"].value'), "1s ago");
  assert.eq(h.eval('MENU[""].selected'), 1, "stays on the row tapped");
  h.tx('MENU["Last fix"].onchange()');
  assert.eq(h.eval('MENU[""].selected'), 4);
  // the watch's own GPS, searching (no position: Last fix unchanged)
  h.tx('Bangle.emit("GPS",{fix:0,lat:NaN,lon:NaN,satellites:0,time:new Date()})');
  await h.wait(50);
  h.tx('MENU["GPS via"].onchange()');
  assert.eq(h.eval('MENU["GPS via"].value'), "watch");
  assert.eq(h.eval('MENU["Last fix"].value'), "1s ago");
  assert.eq(h.eval('MENU[""].selected'), 0);
  // back: the walk menu, on Info
  h.tx('MENU[""].back()');
  assert.eq(menuItems(h), ["Resume", "-1 min", "Cancel walk", "Info"]);
  assert.eq(h.eval('MENU[""].selected'), 3);
});

test("Info closes when the walk ends", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["Info"]()');
  h.tx(`${BT}.cancel()`);
  await h.wait(100);
  assert.eq(h.eval("screen"), "main");
});

test("Info lists the apps holding GPS", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  // the firmware's list (the emulator has no GPS, so set it here)
  h.tx('Bangle._PWR={GPS:["bangturn","gpsrec"],HRM:["health"]}');
  h.tx("showInfo()");
  assert.eq(h.eval('MENU["GPS apps"].value'), "bangturn, gpsrec");
  h.tx('Bangle._PWR={HRM:["health"]}');
  h.tx('MENU["GPS apps"].onchange()');
  assert.eq(h.eval('MENU["GPS apps"].value'), "none");
  assert.eq(h.eval('MENU[""].selected'), 3, "stays on the row tapped");
  h.tx('delete Bangle._PWR');
  h.tx('MENU["GPS apps"].onchange()');
  assert.eq(h.eval('MENU["GPS apps"].value'), "none");
});

test("Info's Phone GPS names the first missing link", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  const phone = () => { h.tx("showInfo()"); return h.eval('MENU["Phone GPS"].value'); };
  assert.eq(phone(), "setting off", "no Android Integration Overwrite GPS");
  h.tx("Bangle.moveGPSPower=function(){}"); // what Overwrite GPS defines
  h.tx("NRF.getSecurityStatus=function(){return {connected:false}}");
  assert.eq(phone(), "no Bluetooth");
  h.tx("NRF.getSecurityStatus=function(){return {connected:true}}");
  assert.eq(phone(), "no fixes", "connected, but Gadgetbridge sends nothing");
  h.tx('Bangle.emit("GPS",{fix:1,lat:51.5,lon:-0.12,hdop:1,satellites:8,time:new Date(),externalSource:true})');
  await h.wait(50);
  assert.eq(phone(), "working");
  // the phone's fixes have stopped and BangTurn is holding the watch's GPS off
  h.tx('(function(sp){var f=sp.source;sp.source=function(){var s=f();s.wait=true;return s}})(require("bangturn.speed"))');
  assert.eq(phone(), "waiting");
});

test("Info from the start screen's menu, and back to that menu", async h => {
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showIdleMenu()");
  h.tx('MENU["Info"]()');
  assert.eq(menuItems(h), ["GPS via", "Watch GPS", "Phone GPS", "GPS apps", "Last fix", "Battery"]);
  assert.eq(h.eval('MENU["GPS via"].value'), "none yet");
  h.tx("Bangle.moveGPSPower=function(){};NRF.getSecurityStatus=function(){return {connected:true}}");
  h.tx('MENU["Phone GPS"].onchange()');
  assert.eq(h.eval('MENU["Phone GPS"].value'), "no walk", "nothing asks for GPS without a walk");
  h.tx('MENU[""].back()');
  assert.eq(menuItems(h), ["Length: 60 min", "Info"]);
  assert.eq(h.eval('MENU[""].selected'), 1, "back on Info");
  assert.eq(h.eval(`${BT}.isActive()`), false, "no walk started");
});

/* The colours used in the Out row and the Now row, other than the background */
const rowColours = (h, R) => h.eval(`(function(){var c={};
  [[${R.y + 86},${R.y + 102}],[${R.y2 - 20},${R.y2 - 4}]].forEach(function(b){
  for(var y=b[0];y<=b[1];y++)for(var x=${R.x};x<=${R.x2};x++){var p=g.getPixel(x,y);if(p!=g.theme.bg)c[p]=1}});
  return Object.keys(c).map(function(k){return +k})})()`);

test("walk screen: GPS symbol shows phone or watch, and follows GPS events", async h => {
  await h.load("bangturn.app.js");
  assert.eq(h.eval("drawnIcon===undefined"), true, "no symbol on the start screen");
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.wait(200);
  assert.eq(h.eval("drawnIcon"), "", "no GPS yet: blank");
  // phone fixes with the chip off: phone
  h.tx('Bangle.emit("GPS",{fix:1,lat:51.5,lon:-0.12,hdop:1,satellites:8,time:new Date(),externalSource:true})');
  await h.wait(100);
  assert.eq(h.eval("drawnIcon"), "phone");
  const R = h.eval("Bangle.appRect");
  assert.eq(h.eval(`g.getPixel(${R.x + 8},${R.y + 7})`), h.eval('g.toColor("#0f0")'), "green location pin on the phone");
  // the watch's chip on (its events come every second): watch, in red
  h.tx('Bangle.getGPSFix=function(){return {fix:0}};Bangle.emit("GPS",{fix:0,lat:NaN,lon:NaN,satellites:0,time:new Date()})');
  await h.wait(100);
  assert.eq(h.eval("drawnIcon"), "watch");
  assert.eq(h.eval(`g.getPixel(${R.x + 8},${R.y + 12})`), h.eval('g.toColor("#f00")'), "red crosshair centre, left of the time");
  // the symbol survives a full redraw, and the rest of the screen keeps the
  // theme's colours (the speed row and bar once came out red, or invisible)
  h.tx("tick()");
  assert.eq(h.eval("drawnIcon"), "watch");
  assert.eq(rowColours(h, R), [h.eval("g.theme.fg")], "Out row in the normal colour after the red symbol");
  h.tx('Bangle.getGPSFix=function(){return undefined};Bangle.emit("GPS",{fix:1,lat:51.5,lon:-0.12,hdop:1,satellites:8,time:new Date(),externalSource:true})');
  await h.wait(100);
  h.tx("tick()");
  assert.eq(h.eval("drawnIcon"), "phone");
  assert.eq(rowColours(h, R), [h.eval("g.theme.fg")], "Out row visible after the green symbol");
  h.tx(`${BT}.cancel()`);
  await h.wait(200);
  assert.eq(h.eval("drawnIcon===undefined"), true, "gone when the walk ends");
});
