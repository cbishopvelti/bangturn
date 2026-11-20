/* End-to-end tests: whole walks through the real app, sched wake-ups,
   alerts, GPS speed and widget together, the way they run on the watch.
   Run: npm test  (or: node tests/run.js tests/walk.test.js -v)

   The emulator clock can't be moved forward, so time passes with jump():
   it moves the walk's start earlier, like waiting would, rewrites the sched
   entries and tells everything listening (the "offset" event, as -1 min
   does). sched then fires the next event in real time, a second or two
   later. The GPS clock is the walker's own (tests/walker.js). */
const { test, assert } = require("./harness");
const walker = require("./walker");

const MIN = 60000;
const DUR = 60 * MIN;
const TURN = 30 * MIN;
const BT = 'require("bangturn")';
const SP = 'require("bangturn.speed")';
const COUNTDOWN = ["back2", "back4", "back8"];

/* Boot code that records, in every app: Bangle.buzz calls in BUZZ as
   [duration, strength] and "bangturn" events in EV. */
async function record(h) {
  h.tx(`require("Storage").write("1walklog.boot.js",${JSON.stringify(
    "global.BUZZ=[];global.EV=[];(function(){var o=Bangle.buzz;" +
    "Bangle.buzz=function(t,s){BUZZ.push([t,s]);return o.apply(Bangle,arguments)};" +
    "Bangle.on('bangturn',function(t){EV.push(t)});})();\n"
  )})`);
  await h.load();
  assert.eq(h.eval("typeof BUZZ"), "object", "recorder installed");
}
const buzzes = h => h.eval("BUZZ.map(function(b){return b[0]})");
const clearLog = h => h.tx("BUZZ=[];EV=[]");

const file = h => h.eval("global.__FILE__");
const state = h => h.eval(`${BT}.read()`);
const ids = h => h.eval(`${BT}.getSched().map(function(a){return a.id.substr(9)})`);
const gpsOn = h => h.eval("!!(global.GPS_USERS && GPS_USERS.bangturn)");
const gpsFile = h => h.eval('require("Storage").readJSON("bangturn.gps.json",1)||false');
// app.js: what the main screen shows, minus the time of day and start time
const screen = h => {
  const L = h.eval(`lines(${BT}.status())`);
  delete L.now; delete L.nowFull; delete L.dim; delete L.timeDim;
  delete L.start;
  delete L.full;
  return L;
};
const widget = h => h.eval("WIDGETS.bangturn.width");
const speeds = h => h.eval(`${SP}.get()`);
/* the inverted TURN AROUND screen is showing */
const alarmShowing = h =>
  h.eval("g.getPixel(4,4)==g.toColor(g.theme.fg) && g.getPixel(4,4)!=g.toColor(g.theme.bg)");

/* Let time pass: `elapsed` ms of the walk have gone. Moves the effective
   start through `offset` (as -1 min does, in fractions of a minute), not
   `start`, which identifies the walk (the speed file is tagged with it). */
function jump(h, elapsed) {
  h.tx(`(function(){var bt=${BT},s=bt.read();s.offset=(s.start-Date.now()+${elapsed})/60000;` +
       `bt.write(s);bt.schedule(undefined,s);Bangle.emit("bangturn","offset")})()`);
}

/* Press and release the button: runs the BTN1 watches the firmware would
   (rising edge on press, falling on release, 100 ms apart). Only works
   unlocked, as on the watch, where a press on a locked watch only unlocks. */
async function press(h) {
  const edge = e => h.tx(`(function(){var L=[];(global["\\xff"].watches||[]).forEach(function(w,i){` +
    `if(w&&w.pin==BTN1&&(w.edge==${e}||!w.edge))L.push([i,w])});L.forEach(function(x){` +
    `if(!x[1].recur)clearWatch(x[0]);x[1].cb({state:${e > 0},time:getTime(),lastTime:getTime()-0.1})})})()`);
  edge(1);
  await h.wait(100);
  edge(-1);
  await h.wait(50);
}
/* Spy on E.showMenu: the open menu is MENU (null when closed) */
const spyMenu = h =>
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
const menuItems = h => h.eval(`MENU&&Object.keys(MENU).filter(function(k){return k!==""})`);
const pick = (h, prefix) =>
  h.tx(`MENU[Object.keys(MENU).filter(function(k){return k.indexOf(${JSON.stringify(prefix)})==0})[0]]()`);

async function waitFor(h, js, ms) {
  for (let t = 0; t < ms; t += 100) {
    try { if (h.eval(js)) return true; } catch (e) {} // (rebooting)
    await h.wait(100);
  }
  return h.eval(js);
}

/* Open the app and start a walk with a tap, as on the watch */
async function startInApp(h) {
  await h.load("bangturn.app.js");
  clearLog(h);
  h.tx('Bangle.emit("touch",1,{x:88,y:100,type:0})');
  await h.wait(300);
}

test("a whole walk: start, turnaround alarm, countdown buzzes, silent end", async h => {
  await record(h);
  await h.load("bangturn.app.js");
  assert.eq(screen(h), { time: "60:00", rows: ["Tap to start", "Button: length"] }, "idle screen");
  assert.eq(widget(h), 0, "no widget when idle");
  assert(!gpsOn(h), "GPS off when idle");

  // Start: one short buzz, five entries, GPS on, widget hidden in the app
  await startInApp(h);
  assert.eq(buzzes(h), [100], "start buzz");
  assert.eq(state(h).turned, false);
  assert.eq(ids(h), ["turn"].concat(COUNTDOWN, ["end"]));
  assert(gpsOn(h), "GPS on");
  assert.eq(widget(h), 0, "widget hidden inside the app (shown on the clock, see ui tests)");
  assert.eq(screen(h).rows, ["Out -- kph"], "no speed before a fix");

  // Walk out at 5 kph for 10 min of GPS time
  const w = walker(h);
  w.walk(5, 600);
  await h.wait(200);
  assert.eq(screen(h).rows, ["Out 5.0 kph"]);

  // Leave for the clock and lock the watch, as on a walk
  await h.load();
  assert(file(h) != "bangturn.app.js", "on the clock");
  assert(gpsOn(h), "GPS still on in the clock");
  w.walk(5, 600);
  h.tx("Bangle.setLocked(true)");

  // Turnaround: sched opens the app with the alarm, lit, long buzzes
  jump(h, TURN - 1500);
  assert(await waitFor(h, `global.__FILE__=="bangturn.app.js"`, 4000), "turnaround opened the app");
  await h.wait(1200);
  assert(alarmShowing(h), "TURN AROUND screen");
  assert(h.eval("Bangle.isLCDOn()"), "screen lit");
  const long = buzzes(h);
  assert(long.length >= 2 && long.every(b => b == 600), "long alarm buzzes: " + JSON.stringify(long));
  assert.eq([state(h).turned, state(h).alert], [true, undefined], "turned, alert taken");
  // Unlocking alone doesn't stop it (the buzz itself can unlock the watch)
  h.tx("Bangle.setLocked(false)");
  await h.wait(900);
  assert(buzzes(h).length > long.length, "still buzzing after an unlock");
  // A tap does: the alarm stops, the countdown shows
  h.tx("Bangle.emit('touch',1,{x:88,y:88,type:0})");
  await h.wait(300);
  const n = buzzes(h).length;
  await h.wait(1000);
  assert.eq(buzzes(h).length, n, "no buzzes after unlocking");
  assert.eq(h.eval("screen"), "main");
  const t = screen(h);
  assert.eq(t.rows, ["Out 5.0 kph", "Back -- kph"], "way back");
  assert.eq(ids(h), COUNTDOWN.concat(["end"]));

  // Walk back at 4 kph: Out stays frozen
  w.walk(4, 600);
  await h.wait(200);
  assert.eq(screen(h).rows, ["Out 5.0 kph", "Back 4.0 kph"]);

  // Countdown buzzes in whatever app is open: 1, 2, 3 at 1/2, 1/4, 1/8 of the way back
  await h.load();
  const clock = file(h);
  for (const [m, k] of [[45, 1], [52.5, 2], [56.25, 3]]) {
    clearLog(h);
    jump(h, m * MIN - 1500);
    await h.wait(2600 + k * 500);
    assert.eq(buzzes(h), Array(k).fill(200), `${60 - m} min left: ${k} short buzzes`);
    assert.eq(file(h), clock, "stayed in the clock");
  }

  // The end: silent, GPS off, everything cleared
  clearLog(h);
  jump(h, DUR - 1500);
  await h.wait(3000);
  assert.eq(buzzes(h), [], "no buzz at the end");
  assert(h.eval("EV").includes("end"), "end event");
  assert.eq(state(h), {});
  assert.eq(ids(h), []);
  assert(!gpsOn(h), "GPS off");
  assert.eq(gpsFile(h), false, "speed file erased");
  assert.eq(file(h), clock, "the end doesn't open the app");

  // The app is back to idle
  await h.load("bangturn.app.js");
  assert.eq(screen(h).time, "60:00");
  assert.eq(widget(h), 0, "widget hidden");
});

test("-1 min from the menu across the turnaround: no alarm, way back rows", async h => {
  await record(h);
  await startInApp(h);
  const w = walker(h);
  w.walk(5, 300);
  jump(h, TURN - 40000); // 40 s before the turnaround
  spyMenu(h);
  await press(h);
  assert.eq(h.eval("screen"), "menu", "button opens the menu");
  assert.eq(menuItems(h).map(k => k.substr(0, 6)), ["Resume", "-1 min", "Cancel", "Info"]);
  pick(h, "-1 min");
  await h.wait(100);
  const st = h.eval(`${BT}.status()`);
  assert.eq([st.phase, st.turned], ["back", true], "past the turnaround");
  assert.eq(ids(h), COUNTDOWN.concat(["end"]), "no turnaround entry");
  assert.eq(h.eval("screen"), "menu", "stays in the menu");
  await h.wait(2000);
  assert(!buzzes(h).includes(600), "no alarm");
  assert.eq(file(h), "bangturn.app.js");
  pick(h, "Resume");
  const t = screen(h);
  assert.eq(t.rows, ["Out 5.0 kph", "Back -- kph"], "way back");
  // the rest of the walk carries on as normal: next is 15 min left
  w.walk(4, 300);
  await h.wait(200);
  assert.eq(screen(h).rows, ["Out 5.0 kph", "Back 4.0 kph"]);
  clearLog(h);
  jump(h, 45 * MIN - 1500);
  await h.wait(3000);
  assert.eq(buzzes(h), [200], "15 min left buzz");
});

test("button on the idle screen opens the menu, a second press goes back, no walk; a tap starts", async h => {
  await record(h);
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(false)");
  spyMenu(h);
  await press(h);
  assert.eq(h.eval("screen"), "menu", "button opens the idle menu");
  assert.eq(menuItems(h), ["Length: 60 min", "Info"]);
  await press(h);
  await h.wait(100);
  assert.eq(h.eval("screen"), "main", "button goes back to the idle screen");
  assert.eq(state(h), {}, "no walk started");
  assert.eq(buzzes(h), [], "no start buzz");
  h.tx('Bangle.emit("touch",1,{x:88,y:100,type:0})');
  await h.wait(300);
  assert(h.eval(`${BT}.isActive()`), "a tap starts it");
  assert.eq(buzzes(h), [100], "start buzz");
});

test("cancel from the menu mid-walk stops everything", async h => {
  await record(h);
  await startInApp(h);
  walker(h).walk(5, 300);
  jump(h, 45 * MIN - 4000); // the 15 min buzz is 4 s away
  spyMenu(h);
  await press(h);
  pick(h, "Cancel walk");
  await h.wait(200);
  assert.eq(state(h), {});
  assert.eq(ids(h), []);
  assert(!gpsOn(h), "GPS off");
  assert.eq(gpsFile(h), false, "speed file erased");
  assert.eq(speeds(h), { out: null, back: null });
  assert(h.eval("EV").includes("cancel"));
  assert.eq(h.eval("screen"), "main");
  assert.eq(screen(h), { time: "60:00", rows: ["Tap to start", "Button: length"] });
  assert.eq(widget(h), 0, "widget hidden");
  clearLog(h);
  await h.wait(4500);
  assert.eq(buzzes(h), [], "no buzz after cancelling");
  // and a new walk starts cleanly
  h.tx('Bangle.emit("touch",1,{x:88,y:100,type:0})');
  await h.wait(300);
  assert.eq(buzzes(h), [100]);
  assert.eq(ids(h).length, 5);
  assert.eq(speeds(h), { out: null, back: null }, "speeds start from zero");
});

test("reboot on the walk back: walk, speeds and buzzes carry on", async h => {
  await record(h);
  await startInApp(h);
  const w = walker(h);
  w.walk(5, 600);
  clearLog(h);
  jump(h, TURN - 1500);
  assert(await waitFor(h, `BUZZ.length && BUZZ[0][0]==600`, 4000), "alarm");
  assert.eq(state(h).turned, true);
  h.tx('Bangle.emit("touch",1,{x:88,y:88,type:0})'); // a tap stops the alarm
  await h.wait(300);
  assert.eq(h.eval("screen"), "main", "tap stopped the alarm");
  w.walk(4, 600);
  await h.wait(200);
  const before = speeds(h);
  await h.load(); // leave the app (saves the speeds), then the watch reboots
  h.tx("E.reboot()");
  // The emulator runs the boot code after E.reboot() but doesn't open the
  // clock, so wait for sched to be armed, check, then load the clock.
  assert(await waitFor(h, "!!(global.GPS_USERS && Bangle.SCHED)", 6000), "rebooted");
  await h.wait(300);
  assert(file(h) != "bangturn.app.js", "app not opened");
  const st = h.eval(`${BT}.status()`);
  assert.eq([st.active, st.phase, st.turned], [true, "back", true]);
  assert.eq(ids(h), COUNTDOWN.concat(["end"]));
  assert(gpsOn(h), "GPS back on");
  const after = speeds(h);
  assert.near(after.out, before.out, 1e-6, "Out kept");
  assert.near(after.back, before.back, 1e-6, "Back kept");
  await h.load();
  assert.near(speeds(h).back, before.back, 1e-6, "Back kept in the clock");
  // tracking carries on from where it was
  w.walk(4, 300);
  await h.wait(200);
  assert.near(speeds(h).back, 4, 0.05, "Back still 4 kph");
  // the next countdown buzz fires after the reboot
  h.tx("BUZZ=[]");
  jump(h, 45 * MIN - 1500);
  await h.wait(3000);
  assert.eq(buzzes(h), [200]);
});

test("watch off past the end: the walk ends quietly at the next boot", async h => {
  await record(h);
  // a walk started 75 min ago, with the entries it was given then
  h.tx(`(function(){var bt=${BT},t=Date.now()-75*60000,s={start:t,offset:0,turned:false};` +
       `bt.write(s);bt.schedule(t,s)})()`);
  assert.eq(ids(h).length, 5);
  await h.load();
  await h.wait(2500);
  assert.eq(state(h), {}, "walk finished");
  assert.eq(ids(h), []);
  assert(!gpsOn(h), "GPS off");
  assert.eq(buzzes(h), [], "no late alarm or buzz");
  assert(file(h) != "bangturn.app.js", "app not opened");
  await h.load("bangturn.app.js");
  assert.eq(screen(h).time, "60:00", "idle");
});

test("watch off across the turnaround: late alarm at boot, missed buzz skipped", async h => {
  await record(h);
  // started 46 min ago: the turnaround and the 15 min buzz were missed
  h.tx(`(function(){var bt=${BT},t=Date.now()-46*60000,s={start:t,offset:0,turned:false};` +
       `bt.write(s);bt.schedule(t,s)})()`);
  await h.load();
  assert(await waitFor(h, `global.__FILE__=="bangturn.app.js"`, 4000), "app opened");
  await h.wait(800);
  const b = buzzes(h);
  assert(b.length && b.every(x => x == 600), "turnaround alarm only: " + JSON.stringify(b));
  assert.eq(ids(h), ["back4", "back8", "end"], "missed entries dropped");
  h.tx("Bangle.setLocked(false);Bangle.emit('touch',1,{x:88,y:88,type:0})"); // tap to dismiss
  await h.wait(300);
  assert.eq(screen(h).rows.length, 2, "Out and Back rows");
});

test("a countdown buzz sched delivers late after a reboot is skipped", async h => {
  await record(h);
  // turned already; the 15 min buzz was due 3 min ago
  h.tx(`(function(){var bt=${BT},t=Date.now()-48*60000,s={start:t,offset:0,turned:true};` +
       `bt.write(s);bt.schedule(t+31*60000,s)})()`);
  assert.eq(ids(h)[0], "back2");
  await h.load();
  await h.wait(2500);
  assert.eq(buzzes(h), [], "no late buzz");
  assert.eq(ids(h), ["back4", "back8", "end"]);
  assert(h.eval(`${BT}.isActive()`), "walk carries on");
});

test("BangTurn stays small: memory in the background and in the app", async h => {
  const used = () => h.eval("process.memory().usage");
  const total = h.eval("process.memory().total");
  const clockIdle = used();
  await startInApp(h);
  const w = walker(h);
  w.walk(5, 300);
  await h.wait(200);
  const app = used();
  await h.load();
  w.walk(5, 300);
  await h.wait(200);
  const clockWalk = used();
  assert(clockWalk - clockIdle < 0.08 * total, `background cost ${clockWalk - clockIdle} of ${total} vars`);
  assert(app < 0.2 * total, `app uses ${app} of ${total} vars`);
});
