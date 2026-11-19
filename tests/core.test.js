/* Core module tests: scheduling, -1 min, cancel, firing and reboot restore.
   Run: npm test  (or: node tests/run.js tests/core.test.js -v --grep=name) */
const { test, assert } = require("./harness");

const MIN = 60000, DUR = 60 * MIN, TURN = 30 * MIN;
const BT = 'require("bangturn")';
const ALL = ["turn", "left15", "left8", "left4", "left1", "end"];
const AT = { turn: 30, left15: 45, left8: 52, left4: 56, left1: 59, end: 60 };

/* our sched entries as {id: absolute fire time} (emulator runs in UTC) */
function entries(h) {
  const out = {};
  const tz = -h.eval("new Date().getTimezoneOffset()") / 60; // hours east of UTC
  for (const a of h.eval(`${BT}.getSched()`)) {
    assert(a.id.startsWith("bangturn."), "id prefix " + a.id);
    assert.eq(a.js, `require("bangturn").fire("${a.id.slice(9)}")`, "js for " + a.id);
    assert(a.on && a.hidden && a.appid == "bangturn", "flags for " + a.id);
    out[a.id.slice(9)] = Date.parse(a.date) + a.t - tz * 3600000; // local -> UTC
  }
  return out;
}
function expectEntries(h, start, ids) {
  const e = entries(h);
  assert.eq(Object.keys(e).sort(), ids.slice().sort(), "sched entry ids");
  for (const id of ids) assert.near(e[id], start + AT[id] * MIN, 2, "time of " + id);
}
function listen(h) {
  h.tx(`global.EV=[];Bangle.on("bangturn",function(t){EV.push(t)})`);
}
/* the pending sched wake-up: {delay ms, js} */
function nextSched(h) {
  return h.eval(`(function(){var t=global["\\xff"].timers[Bangle.SCHED];return t&&{delay:t.time/1000,js:t.cb}})()`);
}
function gpsOn(h) {
  return h.eval(`!!(global.GPS_USERS && GPS_USERS.bangturn)`); // see harness
}

test("idle status and h:mm:ss formatting", async h => {
  const st = h.eval(`${BT}.status()`);
  assert.eq([st.active, st.phase, st.remaining], [false, "idle", DUR]);
  assert.eq(h.eval(`${BT}.fmt(${BT}.DURATION)`), "60:00");
  assert.eq(h.eval(`${BT}.fmt(${BT}.TURN)`), "30:00");
  assert.eq(h.eval(`${BT}.fmt(61500)`), "1:02");
  assert.eq(h.eval(`${BT}.fmt(-5)`), "0:00");
  assert.eq(h.eval(`${BT}.getSched()`), []);
});

test("start writes state and six sched entries", async h => {
  listen(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now})`);
  const s = h.eval(`${BT}.read()`);
  assert.eq(s, { start: now, offset: 0, turned: false }, "bangturn.json");
  expectEntries(h, now, ALL);
  assert.eq(h.eval("EV"), ["start"]);
  const st = h.eval(`${BT}.status(${now + 10 * MIN})`);
  assert.eq([st.active, st.phase, st.remaining, st.toTurn], [true, "out", 50 * MIN, 20 * MIN]);
  // sched is armed for the turnaround
  const n = nextSched(h);
  assert.eq(n.js, 'require("bangturn").fire("turn")');
  assert.near(n.delay, TURN - (h.eval("Date.now()") - now), 1500, "turnaround delay");
});

test("start keeps other apps' alarms", async h => {
  h.tx(`require("sched").setAlarm("other",{t:3600000,msg:"keep me"})`);
  h.tx(`${BT}.start()`);
  h.tx(`${BT}.cancel()`);
  const ids = h.eval(`require("sched").getAlarms().map(a=>a.id)`);
  assert.eq(ids, ["other"]);
});

test("start in the past skips past events", async h => {
  const now = h.eval("Date.now()");
  const start = now - 53 * MIN;
  h.tx(`${BT}.start(${start})`);
  expectEntries(h, start, ["left4", "left1", "end"]);
});

test("entries crossing midnight get tomorrow's date", async h => {
  const now = h.eval("Date.now()");
  const midnight = (Math.floor(now / 86400000) + 1) * 86400000; // UTC = local here
  const start = midnight - 40 * MIN; // walk out before midnight, back after
  h.tx(`${BT}.start(${start})`);
  expectEntries(h, start, ALL);
  const dates = h.eval(`${BT}.getSched().map(a=>a.date)`);
  assert.eq(new Set(dates).size, 2, "two dates");
});

test("entries use local time in other time zones", async h => {
  h.tx("E.setTimeZone(5.5)");
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now})`);
  expectEntries(h, now, ALL);
  const n = nextSched(h);
  assert.eq(n.js, 'require("bangturn").fire("turn")');
  assert.near(n.delay, TURN - (h.eval("Date.now()") - now), 1500, "turnaround delay");
});

test("-1 min moves the start and every entry a minute earlier", async h => {
  listen(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now})`);
  const st = h.eval(`${BT}.minusOne(${now})`);
  assert.eq([st.offset, st.remaining, st.phase], [1, 59 * MIN, "out"]);
  expectEntries(h, now - MIN, ALL);
  h.tx(`${BT}.minusOne(${now})`); h.tx(`${BT}.minusOne(${now})`);
  assert.eq(h.eval(`${BT}.read().offset`), 3);
  expectEntries(h, now - 3 * MIN, ALL);
  assert.eq(h.eval("EV"), ["start", "offset", "offset", "offset"]);
});

test("-1 min past the turnaround skips the alarm and shows heading home", async h => {
  listen(h);
  const now = h.eval("Date.now()");
  const start = now - 29.5 * MIN;
  h.tx(`${BT}.start(${start})`);
  const st = h.eval(`${BT}.minusOne(${now})`);
  assert.eq([st.phase, st.turned], ["back", true]);
  assert.eq(h.eval(`${BT}.read().turned`), true);
  expectEntries(h, start - MIN, ["left15", "left8", "left4", "left1", "end"]);
  assert.eq(h.eval("EV"), ["start", "offset"]);
});

test("-1 min past a countdown buzz skips that buzz", async h => {
  const now = h.eval("Date.now()");
  const start = now - 44.5 * MIN;
  h.tx(`${BT}.start(${start})`);
  h.tx(`${BT}.minusOne(${now})`);
  expectEntries(h, start - MIN, ["left8", "left4", "left1", "end"]);
});

test("-1 min past the end finishes the walk", async h => {
  listen(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 59.5 * MIN})`);
  const st = h.eval(`${BT}.minusOne(${now})`);
  assert.eq([st.active, st.phase], [false, "idle"]);
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval(`${BT}.getSched()`), []);
  assert.eq(h.eval("EV"), ["start", "end"]);
});

test("-1 min does nothing when idle", async h => {
  listen(h);
  const st = h.eval(`${BT}.minusOne()`);
  assert.eq(st.active, false);
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval("EV"), []);
});

test("cancel clears state, entries and GPS", async h => {
  h.tx(`${BT}.start()`);
  assert(gpsOn(h), "GPS on after start");
  listen(h);
  h.tx(`${BT}.cancel()`);
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval(`${BT}.getSched()`), []);
  assert.eq(h.eval("EV"), ["cancel"]);
  assert(!gpsOn(h), "GPS off after cancel");
  const n = nextSched(h);
  assert(!n || n.js.indexOf("bangturn") < 0, "sched not armed for BangTurn");
});

test("fire(left8): removes that entry and buzzes twice in place", async h => {
  const now = h.eval("Date.now()");
  const start = now - 52 * MIN;
  h.tx(`${BT}.start(${start})`);
  // pretend sched still had the left8 entry
  listen(h);
  h.tx(`global.BUZZ=[];Bangle.buzz=function(ms){BUZZ.push(ms);return Promise.resolve()}`);
  h.tx(`${BT}.fire("left8")`);
  await h.wait(1500);
  assert.eq(h.eval("BUZZ"), [200, 200], "two short buzzes");
  assert.eq(h.eval("EV"), ["buzz"]);
  expectEntries(h, start, ["left4", "left1", "end"]);
});

test("fire(turn): marks turned, flags the alert and loads the app", async h => {
  const now = h.eval("Date.now()");
  const start = now - 30 * MIN;
  h.tx(`${BT}.start(${start})`);
  listen(h);
  h.tx(`global.LOADED=[];global.load=function(f){LOADED.push(f)}`);
  h.tx(`${BT}.fire("turn")`);
  assert.eq(h.eval("LOADED"), ["bangturn.app.js"]);
  assert.eq(h.eval("EV"), ["turn"]);
  const s = h.eval(`${BT}.read()`);
  assert.eq([s.turned, s.alert], [true, "turn"]);
  expectEntries(h, start, ["left15", "left8", "left4", "left1", "end"]);
  assert.eq(h.eval(`${BT}.takeAlert()`), "turn");
  assert.eq(h.eval(`${BT}.takeAlert()===undefined`), true);
  assert.eq(h.eval(`${BT}.read().alert===undefined`), true);
});

test("fire(end): finishes silently", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - DUR})`);
  listen(h);
  h.tx(`global.BUZZ=[];Bangle.buzz=function(ms){BUZZ.push(ms);return Promise.resolve()}`);
  h.tx(`${BT}.fire("end")`);
  await h.wait(300);
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval(`${BT}.getSched()`), []);
  assert.eq(h.eval("EV"), ["end"]);
  assert.eq(h.eval("BUZZ"), [], "no buzz at the end");
  assert(!gpsOn(h), "GPS off");
});

test("fire after cancel is ignored", async h => {
  listen(h);
  h.tx(`global.LOADED=[];global.load=function(f){LOADED.push(f)}`);
  h.tx(`${BT}.fire("turn")`);
  assert.eq(h.eval("LOADED"), []);
  assert.eq(h.eval("EV"), []);
  assert.eq(h.eval(`${BT}.read()`), {});
});

test("reboot restores the walk: state, sched wake-up and GPS", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 10 * MIN})`);
  h.tx(`${BT}.minusOne()`);
  await h.load(); // reruns all boot code with a fresh JS state
  assert(h.eval(`global.__FILE__!="bangturn.app.js"`), "back on the clock");
  const s = h.eval(`${BT}.read()`);
  assert.eq([s.start, s.offset], [now - 10 * MIN, 1]);
  expectEntries(h, now - 11 * MIN, ALL);
  const n = nextSched(h);
  assert.eq(n.js, 'require("bangturn").fire("turn")');
  assert.near(n.delay, 19 * MIN - (h.eval("Date.now()") - now), 1500, "turnaround delay after reboot");
  assert(gpsOn(h), "GPS back on after reboot");
});

/* End-to-end through the real sched wake-up, in real time (a few seconds). */

test("sched fires the turnaround: app loads and shows the alert", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - TURN + 1500})`);
  await h.load(); // like leaving the app for the clock
  for (let i = 0; i < 40 && h.eval("global.__FILE__") != "bangturn.app.js"; i++) await h.wait(100);
  await h.wait(300);
  assert.eq(h.eval("global.__FILE__"), "bangturn.app.js", "app loaded");
  const s = h.eval(`${BT}.read()`);
  assert.eq([s.turned, s.alert], [true, undefined], "turned, alert taken by the app");
  expectEntries(h, now - TURN + 1500, ["left15", "left8", "left4", "left1", "end"]);
  assert.eq(nextSched(h).js, 'require("bangturn").fire("left15")');
});

test("sched fires a countdown buzz without leaving the current app", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 45 * MIN + 1500})`);
  await h.load();
  h.tx(`global.BUZZ=[];Bangle.buzz=function(ms){BUZZ.push(ms);return Promise.resolve()}`);
  await h.wait(3500);
  assert.eq(h.eval("BUZZ"), [200], "one buzz at 15 min left");
  assert(h.eval(`global.__FILE__!="bangturn.app.js"`), "still on the clock");
  assert.eq(nextSched(h).js, 'require("bangturn").fire("left8")');
});

test("sched fires the end: walk finishes and GPS turns off", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - DUR + 1500})`);
  await h.load();
  assert(gpsOn(h), "GPS on during the walk");
  await h.wait(3500);
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval(`${BT}.getSched()`), []);
  assert(!gpsOn(h), "GPS off after the end");
});

test("app starts a walk from the idle screen", async h => {
  await h.load("bangturn.app.js");
  h.tx(`global.BUZZ=[];Bangle.buzz=function(ms){BUZZ.push(ms);return Promise.resolve()}`);
  h.tx(`Bangle.emit("touch",1,{x:88,y:88})`);
  await h.wait(100);
  assert(h.eval(`${BT}.isActive()`), "walk started");
  assert.eq(h.eval("BUZZ"), [100], "start confirmation buzz");
  assert.eq(Object.keys(entries(h)).length, 6);
});

