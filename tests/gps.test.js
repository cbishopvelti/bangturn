/* GPS speed tests: fix filtering, the Out and Back averages, -1 min,
   background tracking, saving, reboot recovery and GPS power.
   Run: npm test  (or: node tests/run.js tests/gps.test.js -v --grep=name)

   The emulator has no GPS, so fixes are fed in with Bangle.emit("GPS", fix).
   Their `time` is the GPS clock, which the tracker measures with, so a test
   can "walk" for half an hour in a moment. Which half of the walk a fix
   belongs to follows the watch's real clock, which can't be moved: tests
   get to the walk back with -1 min, or by starting the walk in the past. */
const { test, assert } = require("./harness");

const MIN = 60000;
const BT = 'require("bangturn")';
const SP = 'require("bangturn.speed")';
const FILE = "bangturn.gps.json";

const speeds = h => h.eval(`${SP}.get()`);
const stats = h => h.eval(`${SP}.stats()`);
const saved = h => h.eval(`require("Storage").readJSON("${FILE}",1)||false`); // false: no file
const gpsOn = h => h.eval(`!!(global.GPS_USERS && GPS_USERS.bangturn)`); // see harness
/* stats equal, allowing for the rounding of numbers saved as JSON */
function same(a, b, msg) {
  for (const k of ["outKm", "outMs", "backKm", "backMs"]) assert.near(a[k], b[k], 1e-6, `${msg}: ${k}`);
}
const start = (h, ago) => h.tx(`${BT}.start(Date.now()-${ago || 0})`);

const walker = require("./walker");

test("idle: boot loads nothing and GPS is off", async h => {
  assert.eq(h.eval(`Modules.getCached().filter(function(m){return m.indexOf("bangturn")==0})`), [],
    "no BangTurn module is loaded by boot code when idle");
  assert.eq(gpsOn(h), false);
  assert.eq(speeds(h), { out: null, back: null });
  assert.eq(saved(h), false);
});

test("speeds as text: one decimal, or -- kph", async h => {
  assert.eq(h.eval(`${SP}.fmt(5.249)`), "5.2 kph");
  assert.eq(h.eval(`${SP}.fmt(4.96)`), "5.0 kph"); // toFixed(1) gives 4.9 here
  assert.eq(h.eval(`${SP}.fmt(4.94)`), "4.9 kph");
  assert.eq(h.eval(`${SP}.fmt(9.99)`), "10.0 kph");
  assert.eq(h.eval(`${SP}.fmt(12)`), "12.0 kph");
  assert.eq(h.eval(`${SP}.fmt(0)`), "0.0 kph");
  assert.eq(h.eval(`${SP}.fmt(null)`), "-- kph");
  assert.eq(h.eval(`${SP}.fmt(undefined)`), "-- kph");
});

test("-- kph before the first fix; GPS on from the start", async h => {
  const w = walker(h);
  start(h);
  assert.eq(gpsOn(h), true, "GPS on at walk start");
  assert.eq(stats(h).tracking, true);
  assert.eq(speeds(h), { out: null, back: null });
  for (let i = 0; i < 5; i++) { w.noFix(); w.skip(1); }
  assert.eq(speeds(h), { out: null, back: null }, "no fix yet");
  w.fix();
  assert.eq(speeds(h), { out: null, back: null }, "one fix is no speed yet");
  assert.eq(h.eval(`${SP}.fmt(${SP}.get().out)`), "-- kph");
  w.walk(5, 9);
  assert.eq(speeds(h).out, null, "under 10 s of tracking");
  w.walk(5, 21);
  assert.near(speeds(h).out, 5, 0.001, "a speed half a minute after the first fix");
});

test("steady walk out: average speed, Back empty", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 600);
  const s = stats(h);
  assert.eq(s.outMs, 599000, "tracked time runs from the first fix");
  assert.near(s.outKm, 5 * 599 / 3600, 1e-6, "distance");
  const v = speeds(h);
  assert.near(v.out, 5, 0.001);
  assert.eq(v.back, null);
  assert.eq(h.eval(`${SP}.fmt(${SP}.get().out)`), "5.0 kph");
  assert.eq([s.backKm, s.backMs], [0, 0]);
});

test("the wait for the first fix isn't counted", async h => {
  const w = walker(h);
  start(h);
  for (let i = 0; i < 6; i++) { w.noFix(); w.skip(30); } // 3 minutes to get a fix
  w.walk(4, 300);
  assert.eq(stats(h).outMs, 299000);
  assert.near(speeds(h).out, 4, 0.001);
});

test("walking east uses the right scale for longitude", async h => {
  const w = walker(h, { lat: 60, lon: 10 });
  start(h);
  w.walk(6, 600, { east: true });
  assert.near(speeds(h).out, 6, 0.01);
});

test("slow GPS (a fix every 10 s) gives the same speed", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 900, { step: 10 });
  assert.eq(stats(h).outMs, 890000);
  assert.near(speeds(h).out, 5, 0.001);
});

test("poor HDOP fixes are ignored", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 120);
  const before = stats(h);
  // 20 s of bad fixes drifting 25 m away: slow enough (4.5 kph) to pass as
  // walking, so only the HDOP can rule them out
  for (let i = 1; i <= 20; i++) { w.skip(1); w.fixAt(0, 0.00125 * i, { hdop: 5.1 }); }
  assert.eq(stats(h), before, "nothing counted from HDOP 5.1 fixes");
  w.fix({ hdop: 5 }); // good again, still at the same place
  const after = stats(h);
  assert.near(after.outKm, before.outKm, 1e-6, "no distance from the bad fixes");
  assert.eq(after.outMs, before.outMs + 20000, "the time still counts");
  // with a good HDOP the same drift would have counted
  for (let i = 1; i <= 20; i++) { w.skip(1); w.fixAt(0, 0.00125 * i, { hdop: 2 }); }
  assert.near(stats(h).outKm, before.outKm + 0.025, 0.005);
});

test("a jump implying more than 15 kph is ignored", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 120);
  const before = stats(h);
  w.skip(1); w.fixAt(0.2, 0);    // 200 m away one second later
  w.skip(1); w.fixAt(0, -0.05);  // and 50 m the other way
  assert.eq(stats(h), before, "jumps add nothing");
  w.walk(5, 120);
  const s = stats(h);
  assert.eq(s.outMs, 241000, "no time is lost around the jumps");
  assert.near(s.outKm, 5 * 239 / 3600, 1e-6, "distance as if the jumps never happened");
});

test("just under 15 kph counts, just over doesn't", async h => {
  const w = walker(h);
  start(h);
  w.walk(14.5, 120);
  assert.near(speeds(h).out, 14.5, 0.001, "14.5 kph is tracked");
  h.tx(`${BT}.cancel()`);
  start(h);
  w.walk(16, 120);
  assert.eq([stats(h).outKm, stats(h).outMs], [0, 0], "16 kph is never counted");
});

test("after repeated jumps tracking restarts from the new place", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 300);
  const before = stats(h);
  w.move(1);                      // GPS now reports a place 1 km away
  for (let i = 0; i < 4; i++) { w.skip(1); w.fix(); }
  assert.eq(stats(h), before, "four jumps in a row: still ignored");
  w.skip(1); w.fix();             // the fifth: carry on from here
  assert.eq(stats(h), before, "restarting adds no distance or time");
  w.walk(5, 300);
  const s = stats(h);
  assert.eq(s.outMs, before.outMs + 300000, "the gap's time is left out");
  assert.near(s.outKm, before.outKm + 5 * 300 / 3600, 1e-6, "the 1 km is left out");
  assert.near(speeds(h).out, 5, 0.001);
});

test("standing still: wandering fixes add next to nothing, time still counts", async h => {
  const w = walker(h);
  start(h);
  w.walk(6, 300);
  const km = stats(h).outKm;
  w.stand(300, 0.004); // the fixes wander up to 8 m away: 300 m of "movement"
  const s = stats(h);
  assert.near(s.outKm, km, 0.02, "at most a step or two while standing");
  assert.eq(s.outMs, 599000);
  assert.near(speeds(h).out, 3, 0.1, "half the time walking at 6 kph");
});

test("GPS jitter while walking barely changes the speed", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 600, { jitter: 0.0015 }); // every fix 1.5 m off, left then right
  // adding up every fix-to-fix hop would give about 12 kph
  const v = speeds(h).out;
  assert(v >= 5 && v < 5.3, "about 5 kph, got " + v);
});

test("a lost signal is bridged in a straight line", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 300);
  const before = stats(h);
  w.skip(120); w.move(0.15);     // two minutes with no fix, 150 m further on
  w.fix();
  const s = stats(h);
  assert.eq(s.outMs, before.outMs + 120000);
  assert.near(s.outKm, before.outKm + 0.15, 1e-6);
});

test("the app shows the tracked speeds, rounded to one decimal", async h => {
  const rows = () => h.eval(`lines(${BT}.status()).rows`);
  const w = walker(h);
  await h.load("bangturn.app.js");
  start(h);
  assert.eq(rows(), ["Out -- kph"], "before the first fix");
  w.walk(4.96, 600);
  assert.eq(rows(), ["Out 5.0 kph"]);
  h.tx(`for(var i=0;i<30;i++)${BT}.minusOne()`); // straight to the turnaround
  assert.eq(rows(), ["Out 5.0 kph", "Back -- kph"]);
  w.walk(4.33, 300, { south: true });
  assert.eq(rows(), ["Out 5.0 kph", "Back 4.3 kph"]);
});

test("-1 min doesn't change the speed", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 300);
  const before = stats(h);
  h.tx(`for(var i=0;i<3;i++)${BT}.minusOne()`);
  assert.eq(h.eval(`${BT}.status().offset`), 3);
  assert.eq(stats(h), before, "three taps: same distance and time");
  w.walk(5, 300);
  assert.eq(stats(h).outMs, 599000, "10 minutes of GPS, not 13");
  assert.near(speeds(h).out, 5, 0.001);
});

test("Out freezes at the turnaround (reached with -1 min); Back starts from zero", async h => {
  const w = walker(h);
  start(h, 20 * MIN);
  w.walk(5.4, 1200);
  const out = stats(h);
  assert.near(speeds(h).out, 5.4, 0.001);
  assert.eq(speeds(h).back, null);
  h.tx(`for(var i=0;i<10;i++)${BT}.minusOne()`); // 30 min in: heading home
  assert.eq(h.eval(`${BT}.status().phase`), "back");
  assert.eq(speeds(h).back, null, "no Back speed until there is tracking for it");
  w.walk(4, 600, { south: true });
  const s = stats(h), v = speeds(h);
  assert.eq([s.outKm, s.outMs], [out.outKm, out.outMs], "Out is frozen");
  assert.near(v.out, 5.4, 0.001);
  assert.eq(s.backMs, 600000);
  assert.near(v.back, 4, 0.001);
  assert.eq(h.eval(`${SP}.fmt(${SP}.get().out)+" / "+${SP}.fmt(${SP}.get().back)`), "5.4 kph / 4.0 kph");
});

test("the real turnaround: sched fires, the app loads, Out freezes", async h => {
  const w = walker(h);
  start(h, 30 * MIN - 2000); // turnaround in 2 s
  w.walk(5, 1500, { step: 10 });
  const out = stats(h);
  assert.eq(h.eval(`${BT}.status().phase`), "out");
  assert.eq(out.backMs, 0);
  await h.wait(3000);
  assert.eq(h.eval("global.__FILE__"), "bangturn.app.js", "the alarm opened the app");
  assert.eq(h.eval(`${BT}.status().turned`), true);
  assert.eq(gpsOn(h), true, "GPS stays on for the walk back");
  same(stats(h), out, "nothing lost when the app loaded");
  w.walk(4.5, 900, { south: true });
  const s = stats(h), v = speeds(h);
  assert.near(s.outKm, out.outKm, 1e-6, "Out is frozen");
  assert.eq(s.outMs, out.outMs, "Out is frozen");
  assert.near(v.out, 5, 0.001);
  assert.eq(s.backMs, 900000);
  assert.near(v.back, 4.5, 0.001);
});

test("tracking carries on in the background when you leave the app", async h => {
  const w = walker(h);
  await h.load("bangturn.app.js");
  start(h);
  w.walk(5, 180);
  const before = stats(h);
  await h.load(); // back to the clock
  assert.eq(gpsOn(h), true, "GPS still on");
  same(stats(h), before, "same numbers after the switch");
  assert.eq(saved(h).start, h.eval(`${BT}.read().start`), "saved for this walk");
  w.walk(5, 180);
  await h.load("bangturn.app.js");
  w.walk(5, 180);
  const s = stats(h);
  assert.eq(s.outMs, 539000, "no time lost over two app changes");
  assert.near(s.outKm, 5 * 539 / 3600, 1e-6, "no distance lost either");
});

test("saves about once a minute, not on every fix", async h => {
  const w = walker(h);
  start(h);
  h.tx(`global.WR=0;(function(){var st=require("Storage"),o=st.writeJSON;st.writeJSON=function(n){if(n=="${FILE}")WR++;return o.apply(st,arguments)}})()`);
  w.walk(5, 60);
  assert.eq(h.eval("WR"), 0, "no write in the first minute of fixes");
  w.walk(5, 541);
  assert.eq(h.eval("WR"), 10, "10 writes in 10 minutes");
  w.stand(59, 0);
  w.noFix();
  assert.eq(h.eval("WR"), 10);
  w.stand(1, 0);
  assert.eq(h.eval("WR"), 11, "also while standing still");
});

test("a crash or hard reboot picks up from the last save", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 150);
  const file = saved(h);
  assert.eq(file.outMs, 120000, "last save was at two minutes");
  h.tx(`E.removeAllListeners("kill")`); // a crash: no chance to save
  await h.load();
  assert.eq(gpsOn(h), true, "GPS back on after the reboot");
  assert.eq(stats(h).outMs, 120000, "restored from the save");
  w.skip(20); w.move(5 * 20 / 3600); // 20 s to boot and get a fix, still walking
  w.walk(5, 130);
  const s = stats(h);
  assert.eq(s.outMs, 299000, "the gap is bridged from the saved position");
  assert.near(s.outKm, 5 * 299 / 3600, 1e-6);
  assert.near(speeds(h).out, 5, 0.001);
});

test("a reboot on the walk back keeps the frozen Out speed", async h => {
  const w = walker(h);
  start(h, 25 * MIN);
  w.walk(5.5, 600);
  h.tx(`for(var i=0;i<5;i++)${BT}.minusOne()`);
  w.walk(4, 300, { south: true });
  const before = speeds(h);
  await h.load();
  const v = speeds(h);
  assert.near(v.out, before.out, 1e-6);
  assert.near(v.back, before.back, 1e-6);
  assert.near(v.out, 5.5, 0.001);
  assert.near(v.back, 4, 0.001);
});

test("cancel turns GPS off and clears the speeds", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 120);
  await h.load(); // so there is a saved file
  assert(saved(h), "file saved");
  h.tx(`${BT}.cancel()`);
  assert.eq(gpsOn(h), false, "GPS off");
  assert.eq(saved(h), false, "file removed");
  assert.eq(speeds(h), { out: null, back: null });
  w.walk(5, 60);
  assert.eq(stats(h), { outKm: 0, outMs: 0, backKm: 0, backMs: 0, tracking: false }, "fixes after cancel are ignored");
  await h.load();
  assert.eq(gpsOn(h), false, "still off after a reboot");
  assert.eq(saved(h), false);
});

test("the end of the walk turns GPS off and clears the speeds", async h => {
  const w = walker(h);
  start(h, 59 * MIN);
  w.walk(5, 120);
  h.tx(`${BT}.fire("end")`);
  assert.eq(gpsOn(h), false);
  assert.eq(stats(h).tracking, false);
  assert.eq(saved(h), false);
  assert.eq(speeds(h), { out: null, back: null });
});

test("a new walk starts from zero", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 300);
  h.tx(`${BT}.cancel()`);
  start(h);
  assert.eq(speeds(h), { out: null, back: null });
  w.walk(3, 300);
  assert.eq(stats(h).outMs, 299000);
  assert.near(speeds(h).out, 3, 0.001);
});

test("a save left over from another walk is ignored", async h => {
  h.tx(`require("Storage").writeJSON("${FILE}",{start:123,outKm:9,outMs:3600000,backKm:9,backMs:3600000,rej:0})`);
  h.tx(`${BT}.write({start:Date.now()-60000,offset:0,turned:false})`);
  await h.load(); // boot finds a walk running
  assert.eq(gpsOn(h), true);
  assert.eq(stats(h), { outKm: 0, outMs: 0, backKm: 0, backMs: 0, tracking: true });
});

test("GPS never stays on once the walk's time is up", async h => {
  const w = walker(h);
  start(h, 60 * MIN - 1200); // 1.2 s left
  h.tx(`${BT}.clearSched()`);  // as if the "end" wake-up was lost
  w.walk(5, 30);
  assert.eq(gpsOn(h), true);
  const before = stats(h);
  await h.wait(1500);
  assert.eq(h.eval(`${BT}.isActive()`), true, "the core hasn't ended the walk");
  w.walk(5, 5);
  assert.eq(gpsOn(h), false, "GPS off at the next GPS event");
  assert.eq(stats(h), Object.assign({}, before, { tracking: false }), "nothing counted after the end");
  await h.load();
  assert.eq(gpsOn(h), false, "and it isn't turned back on by a reboot");
});

test("fixes without a GPS time use the watch's clock", async h => {
  const w = walker(h);
  start(h);
  w.fix({ time: null });
  await h.wait(1200);
  w.move(0.003);
  w.fix({ time: null });
  const s = stats(h);
  assert.near(s.outMs, 1300, 400, "about a second by the watch's clock");
  // a fix with a GPS time (a different clock) must not be measured against it
  w.fix();
  assert.eq(stats(h), s, "switching clocks adds no time");
  w.walk(5, 60);
  assert.eq(stats(h).outMs, s.outMs + 60000);
});
