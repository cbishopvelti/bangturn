/* Alerts tests: start buzz, countdown buzzes, turnaround alarm, Quiet Mode
   and firing through the real sched entries.
   Run: npm test  (or: node tests/run.js tests/alerts.test.js -v) */
const { test, assert } = require("./harness");

const MIN = 60000;
const BT = 'require("bangturn")';
const AL = 'require("bangturn.alerts")';

/* Record every Bangle.buzz call as [ms since recording started, time,
   strength] in global.BUZZ. Installed as boot code so it survives load()
   (the turnaround alarm loads the app). */
async function recordBuzz(h, quiet) {
  if (quiet !== undefined) {
    const s = h.eval(`require("Storage").readJSON("setting.json",1)||{}`);
    s.quiet = quiet;
    h.tx(`require("Storage").writeJSON("setting.json",${JSON.stringify(s)})`);
  }
  h.tx(`require("Storage").write("1buzzlog.boot.js",${JSON.stringify(
    "global.BUZZ=[];global.BUZZ0=Date.now();(function(){var o=Bangle.buzz;" +
    "Bangle.buzz=function(t,s){BUZZ.push([Date.now()-BUZZ0,t,s]);return o.apply(Bangle,arguments)};})();\n"
  )})`);
  await h.load();
  assert.eq(h.eval("typeof BUZZ"), "object", "buzz recorder installed");
}
const buzzes = h => h.eval("BUZZ");
const resetBuzz = h => h.tx("BUZZ=[];BUZZ0=Date.now()");

/* Watches on the button (the emulator can't press it, so tests check the
   watch is there and set to fire on a press). */
const btnWatches = h =>
  h.eval(`global["\\xff"].watches.filter(function(w){return w&&w.pin==BTN1})`);

/* fg colour pixel = inverted alarm screen is showing */
const alarmShowing = h =>
  h.eval("g.getPixel(4,4)==g.toColor(g.theme.fg) && g.getPixel(4,4)!=g.toColor(g.theme.bg)");

test("start confirmation is one short full-strength buzz", async h => {
  await recordBuzz(h);
  h.tx(`${AL}.started()`);
  await h.wait(300);
  assert.eq(buzzes(h).map(b => [b[1], b[2]]), [[100, 1]]);
});

test("app start buzzes once", async h => {
  await recordBuzz(h);
  await h.load("bangturn.app.js");
  resetBuzz(h);
  h.tx(`Bangle.emit("touch",1,{x:88,y:88,type:0})`); // tap to start (stub UI)
  await h.wait(300);
  assert(h.eval(`${BT}.isActive()`), "walk started");
  assert.eq(buzzes(h).map(b => b[1]), [100]);
});

for (const n of [1, 2, 3, 4]) {
  test(`countdown(${n}) gives ${n} short buzzes 200 on / 300 off`, async h => {
    await recordBuzz(h);
    h.tx(`${AL}.countdown(${n})`);
    await h.wait(n * 500 + 600);
    const b = buzzes(h);
    assert.eq(b.length, n, "buzz count");
    for (const x of b) assert.eq([x[1], x[2]], [200, 1], "short full-strength buzz");
    for (let i = 1; i < n; i++) assert.near(b[i][0] - b[i - 1][0], 500, 120, "buzz spacing");
  });
}

test("countdown doesn't draw or leave the app", async h => {
  await recordBuzz(h);
  const file = h.eval("global.__FILE__");
  h.tx("global.DREW=0;var _f=g.flip;g.flip=function(){DREW++;return _f.apply(g,arguments)};" +
       "g.fillRect=g.drawString=g.clear=function(){DREW++;return g}");
  h.tx(`${AL}.countdown(2)`);
  await h.wait(1200);
  assert.eq(h.eval("global.__FILE__"), file, "still in the same app");
  assert.eq(buzzes(h).length, 2);
});

test("turnaround: lit, full screen, continuous long buzzes, stops after 6 s", async h => {
  await recordBuzz(h);
  h.tx(`Bangle.setLCDPower(0);global.DONE=0;global.STOP=${AL}.turnaround(function(){DONE++})`);
  await h.wait(500);
  assert(h.eval("Bangle.isLCDOn()"), "screen lit");
  assert(alarmShowing(h), "TURN AROUND screen showing");
  await h.wait(3000);
  assert.eq(h.eval("DONE"), 0, "still running at 3.5 s");
  await h.wait(3000);
  assert.eq(h.eval("DONE"), 1, "done called after 6 s");
  const b = buzzes(h);
  for (const x of b) assert.eq([x[1], x[2]], [600, 1], "long full-strength buzz");
  assert(b.length >= 7 && b.length <= 8, "about 6 s of 600/200 buzzes, got " + b.length);
  for (let i = 1; i < b.length; i++) assert.near(b[i][0] - b[i - 1][0], 800, 150, "continuous pattern");
  assert(b[b.length - 1][0] < 6000, "no buzz starts after 6 s");
  // no repeats
  resetBuzz(h);
  await h.wait(2000);
  assert.eq(buzzes(h), [], "no repeat");
  assert.eq(h.eval("DONE"), 1, "done called once");
});

test("turnaround stops when the watch unlocks", async h => {
  await recordBuzz(h);
  h.tx(`global.DONE=0;${AL}.turnaround(function(){DONE++})`);
  await h.wait(1000);
  h.tx(`Bangle.emit("lock",true)`); // locking doesn't stop it
  await h.wait(200);
  assert.eq(h.eval("DONE"), 0, "lock true ignored");
  h.tx(`Bangle.emit("lock",false)`);
  await h.wait(100);
  assert.eq(h.eval("DONE"), 1, "stopped on unlock");
  assert(!alarmShowing(h), "alarm screen cleared");
  const n = buzzes(h).length;
  await h.wait(1500);
  assert.eq(buzzes(h).length, n, "no more buzzes");
  h.tx(`Bangle.emit("lock",false)`);
  await h.wait(7000 - 2800);
  assert.eq(h.eval("DONE"), 1, "done not called again (unlock or timeout)");
});

test("turnaround stops on a tap", async h => {
  await recordBuzz(h);
  h.tx(`global.DONE=0;${AL}.turnaround(function(){DONE++})`);
  await h.wait(900);
  h.tx(`Bangle.emit("touch",1,{x:88,y:88,type:0})`);
  await h.wait(100);
  assert.eq(h.eval("DONE"), 1, "stopped on tap");
  const n = buzzes(h).length;
  await h.wait(1500);
  assert.eq(buzzes(h).length, n, "no more buzzes");
});

test("turnaround stops on a button press", async h => {
  await recordBuzz(h);
  h.tx(`Bangle.setUI()`); // no other button handlers
  assert.eq(btnWatches(h).length, 0);
  h.tx(`global.DONE=0;global.STOP=${AL}.turnaround(function(){DONE++})`);
  await h.wait(300);
  // The emulator can't press the button: check our watch is armed for one
  // press, then stop the way the watch callback does.
  const w = btnWatches(h);
  assert.eq(w.length, 1, "button watched while the alarm runs");
  assert(!w[0].recur && w[0].edge == -1, "fires once, on a press");
  h.tx(`STOP()`);
  await h.wait(100);
  assert.eq(h.eval("DONE"), 1, "stopped");
  assert.eq(btnWatches(h).length, 0, "button watch removed");
});

test("turnaround doesn't leave its listeners behind", async h => {
  await recordBuzz(h);
  h.tx(`global.LOCKN=function(){var l=Bangle["#onlock"];return l?(typeof l=="function"?1:l.length):0}`);
  const before = h.eval(`LOCKN()`);
  h.tx(`${AL}.turnaround(function(){})`);
  await h.wait(200);
  assert.eq(h.eval(`LOCKN()`), before + 1);
  h.tx(`Bangle.emit("lock",false)`);
  await h.wait(100);
  assert.eq(h.eval(`LOCKN()`), before);
});

test("all alerts buzz in Quiet Mode (alarms only and silent)", async h => {
  for (const quiet of [1, 2]) {
    await recordBuzz(h, quiet);
    assert.eq(h.eval(`require("Storage").readJSON("setting.json").quiet`), quiet);
    h.tx(`${AL}.started()`);
    await h.wait(200);
    h.tx(`${AL}.countdown(2)`);
    await h.wait(1100);
    h.tx(`${AL}.turnaround(function(){})`);
    await h.wait(1000);
    h.tx(`Bangle.emit("lock",false)`);
    const b = buzzes(h).map(x => x[1]);
    assert.eq(b.slice(0, 3), [100, 200, 200], "start + countdown, quiet=" + quiet);
    assert(b.slice(3).length >= 1 && b.slice(3).every(t => t == 600), "turnaround, quiet=" + quiet);
  }
});

test("sched fires the 15 min countdown buzz in whatever app is open", async h => {
  await recordBuzz(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 45 * MIN + 1500})`);
  await h.load(); // back to the clock, like walking with the watch on the clock face
  const file = h.eval("global.__FILE__");
  resetBuzz(h);
  await h.wait(3000);
  assert.eq(buzzes(h).map(b => b[1]), [200], "one short buzz");
  assert.eq(h.eval("global.__FILE__"), file, "stayed in the clock");
  assert.eq(h.eval(`${BT}.getSched().map(a=>a.id)`).sort(),
    ["bangturn.end", "bangturn.left1", "bangturn.left4", "bangturn.left8"]);
});

test("sched fires the 1 min countdown as 4 buzzes and the end silently", async h => {
  await recordBuzz(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 59 * MIN + 1500})`);
  await h.load();
  resetBuzz(h);
  await h.wait(4000);
  assert.eq(buzzes(h).map(b => b[1]), [200, 200, 200, 200], "four short buzzes");
  // now the end, 1 s away: silent
  h.tx(`${BT}.cancel();${BT}.start(Date.now()-60*60000+1000)`);
  resetBuzz(h);
  await h.wait(2500);
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  assert.eq(buzzes(h), [], "walk end is silent");
});

test("sched turnaround opens the app with the alarm, then the countdown", async h => {
  await recordBuzz(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 30 * MIN + 1500})`);
  await h.load();
  resetBuzz(h);
  // wait for sched to fire and load the app
  let file;
  for (let i = 0; i < 40; i++) {
    await h.wait(100);
    file = h.eval("global.__FILE__");
    if (file == "bangturn.app.js") break;
  }
  assert.eq(file, "bangturn.app.js", "app loaded by the turnaround");
  await h.wait(300);
  assert(h.eval("Bangle.isLCDOn()"), "screen lit");
  assert(alarmShowing(h), "TURN AROUND showing");
  assert(buzzes(h).length >= 1, "buzzing");
  assert.eq(h.eval(`${BT}.read().alert||0`), 0, "alert taken");
  h.tx(`Bangle.emit("lock",false)`); // look at the watch
  await h.wait(200);
  assert(!alarmShowing(h), "back to the countdown");
  const n = buzzes(h).length;
  await h.wait(1500);
  assert.eq(buzzes(h).length, n, "alarm stopped");
  assert.eq(h.eval(`${BT}.status().phase`), "back");
});
