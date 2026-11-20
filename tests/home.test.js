/* Way home tests: the trail back to the origin (loops and detours cut out,
   retracing, leaving the trail) and the speed right now, in speed.js.
   Run: npm test  (or: node tests/run.js tests/home.test.js -v --grep=name)

   Fixes are fed in by tests/walker.js, as in gps.test.js. The trail doesn't
   care which half of the walk it is, so most tests never reach the
   turnaround: they just turn round and walk back. */
const { test, assert } = require("./harness");

const BT = 'require("bangturn")';
const SP = 'require("bangturn.speed")';

const walker = require("./walker");
const start = h => h.tx(`${BT}.start()`);
const get = h => h.eval(`${SP}.get()`);
const home = h => get(h).home * 1000; // m
/* walk `m` metres at 5 kph: w.go(300), w.go(100, {east:true}) */
function go(w, m, o) { w.walk(5, m * 0.72, o); }

test("idle, and before the first fix: no way home and no speed now", async h => {
  assert.eq(get(h), { out: null, back: null, now: null, home: null });
  const w = walker(h);
  start(h);
  w.noFix();
  assert.eq(get(h), { out: null, back: null, now: null, home: null });
  w.fix();
  assert.eq(get(h).home, 0, "at the origin");
});

test("straight out: the way home is the way you came", async h => {
  const w = walker(h);
  start(h);
  go(w, 1000);
  assert.near(home(h), 1000, 3);
  const t = h.eval(`${SP}.trail()`);
  assert(t.n > 70 && t.n < 101, "a point every 10 m or so: " + t.n);
});

test("turning back early: the trail shortens as you retrace it", async h => {
  const w = walker(h);
  start(h);
  go(w, 600);
  go(w, 250, { south: true });
  assert.near(home(h), 350, 4);
  go(w, 349, { south: true });
  assert.near(home(h), 1, 3, "nearly there");
  assert(h.eval(`${SP}.trail().n`) <= 2, "the trail is used up");
});

test("a loop on the way out is cut out", async h => {
  const w = walker(h);
  start(h);
  go(w, 300);
  go(w, 100, { east: true });
  assert.near(home(h), 400, 8, "into the loop: the way back is the way you came");
  go(w, 100);
  go(w, 100, { west: true });
  go(w, 100, { south: true }); // back where the loop began
  assert.near(home(h), 300, 8, "the 400 m loop doesn't count");
  go(w, 200);
  assert.near(home(h), 500, 8);
});

test("a there-and-back detour on the way out is cut out", async h => {
  const w = walker(h);
  start(h);
  go(w, 300);
  go(w, 150, { east: true });
  assert.near(home(h), 450, 8);
  go(w, 150, { west: true });
  assert.near(home(h), 300, 8);
  go(w, 200);
  assert.near(home(h), 500, 8);
});

test("walking back a few metres to one side of the path out still follows it", async h => {
  const w = walker(h);
  start(h);
  go(w, 600);
  w.move(0, 0.012); // the other side of the road, or GPS drift
  go(w, 300, { south: true });
  assert.near(home(h), 300, 15);
  go(w, 250, { south: true });
  assert.near(home(h), 50, 15);
});

test("GPS jitter doesn't make the way home longer", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 720, { jitter: 0.003 }); // 1 km, each fix 3 m to one side or the other
  assert.near(home(h), 1000, 15);
  w.walk(5, 360, { south: true, jitter: 0.003 });
  assert.near(home(h), 500, 15);
  w.stand(120, 0.005);
  assert.near(home(h), 500, 15, "standing still");
});

test("a detour on the way back counts until you rejoin the trail", async h => {
  const w = walker(h);
  start(h);
  go(w, 600);
  go(w, 200, { south: true });
  assert.near(home(h), 400, 4);
  go(w, 80, { east: true }); // off the trail to kill time
  assert.near(home(h), 480, 8, "back the way you came is the way home");
  go(w, 100, { south: true });
  assert.near(home(h), 580, 12);
  go(w, 80, { west: true }); // back on the trail, 100 m nearer home
  assert.near(home(h), 300, 8, "the detour is forgotten");
  go(w, 100, { south: true });
  assert.near(home(h), 200, 8);
});

test("a detour on the way back that returns to where it left is forgotten", async h => {
  const w = walker(h);
  start(h);
  go(w, 600);
  go(w, 200, { south: true });
  go(w, 120, { east: true });
  assert.near(home(h), 520, 8);
  go(w, 120, { west: true });
  assert.near(home(h), 400, 8);
});

test("a sharp corner isn't cut", async h => {
  const w = walker(h);
  start(h);
  go(w, 300);
  go(w, 300, { east: true });
  assert.near(home(h), 600, 8);
});

test("the trail survives leaving the app and a reboot", async h => {
  const w = walker(h);
  start(h);
  go(w, 300);
  go(w, 100, { east: true });
  go(w, 100);
  go(w, 100, { west: true });
  go(w, 100, { south: true });
  go(w, 200);
  const before = home(h), n = h.eval(`${SP}.trail().n`);
  assert.near(before, 500, 8);
  await h.load("bangturn.app.js");
  assert.near(home(h), before, 1, "after opening the app");
  assert.eq(h.eval(`${SP}.trail().n`), n);
  h.tx("E.reboot()");
  await h.load();
  assert.near(home(h), before, 1, "after a reboot");
  go(w, 200, { south: true });
  assert.near(home(h), 300, 8, "and carries on from there");
});

test("a long trail is thinned, and still leads home", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 5760, { step: 5 }); // 8 km, a fix every 7 m
  const t = h.eval(`${SP}.trail()`);
  assert.eq(t.cd, 20, "points twice as far apart");
  assert(t.n > 256 && t.n < 512, "points: " + t.n);
  assert.near(home(h), 8000, 10);
  w.walk(5, 1440, { step: 5, south: true });
  assert.near(home(h), 6000, 10);
  h.tx(`E.emit("kill")`);
  const len = f => h.eval(`(require("Storage").read("${f}")||"").length`);
  assert(len("bangturn.gps.json") < 400, "the state's file stays small: " + len("bangturn.gps.json"));
  assert.eq(len("bangturn.trail"), 4 * h.eval(`${SP}.trail().n`), "4 bytes a point");
  await h.load();
  assert.eq(h.eval(`${SP}.trail()`).cd, 20, "the spacing is kept");
  assert.near(home(h), 6000, 10);
});

test("a gap in the fixes is bridged in a straight line that can be followed back", async h => {
  const w = walker(h);
  start(h);
  go(w, 300);
  w.move(0.4); // 400 m with no GPS
  w.skip(288);
  go(w, 300);
  assert.near(home(h), 1000, 5);
  go(w, 500, { south: true }); // back, to the middle of the gap
  assert.near(home(h), 500, 5, "the trail has points along the gap");
});

test("the trail is saved with the first save, then every 5 minutes; after a crash it carries on in a straight line", async h => {
  const w = walker(h);
  const file = () => h.eval(`(require("Storage").read("bangturn.trail")||"").length`);
  start(h);
  go(w, 300); // 3 min 36 s
  const first = file();
  assert(first > 0 && first < 60, "saved once, a minute in: " + first);
  go(w, 250); // 6 min 36 s
  const n = file();
  assert(n > 120, "saved again 5 min later: " + n);
  go(w, 150); // 8 min 24 s
  assert.eq(file(), n, "not again before 11 min");
  h.tx(`E.removeAllListeners("kill")`); // a crash: no chance to save
  await h.load();
  // the trail as saved at 6 min (500 m), and the position saved at 8 min
  assert.near(home(h), 5 * 480 / 3.6, 5, "back to the last saves");
  go(w, 100);
  assert.near(home(h), 800, 5, "the first fix joins the trail to where you are");
  // the trail's file lost altogether: straight from the origin
  h.tx(`${BT}.cancel()`);
  start(h);
  go(w, 150);
  go(w, 150, { east: true });
  h.tx(`E.removeAllListeners("kill");require("Storage").erase("bangturn.trail")`);
  await h.load();
  go(w, 50, { east: true });
  assert.near(home(h), Math.sqrt(150 * 150 + 150 * 150) + 50, 5, "straight from the origin to the first fix, then on");
});

test("a new walk starts a new trail", async h => {
  const w = walker(h);
  start(h);
  go(w, 500);
  h.tx(`${BT}.cancel()`);
  assert.eq(get(h).home, null);
  start(h);
  w.skip(5);
  w.fix();
  assert.eq(get(h).home, 0, "the origin is where this walk began");
  go(w, 100);
  assert.near(home(h), 100, 3);
});

test("speed now: the last 20 s, not the average", async h => {
  const w = walker(h);
  start(h);
  w.fix();
  w.walk(5, 4);
  assert.eq(get(h).now, null, "under 5 s of fixes");
  w.walk(5, 296);
  assert.near(get(h).now, 5, 0.05);
  w.walk(6.5, 10);
  const mid = get(h).now;
  assert(mid > 5.3 && mid < 6.3, "halfway there after 10 s: " + mid);
  w.walk(6.5, 20);
  assert.near(get(h).now, 6.5, 0.05, "all of the last 20 s");
  assert(get(h).out < 5.2, "the average has hardly moved");
});

test("speed now: next to nothing standing still, same with slow GPS", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 120);
  w.stand(60, 0.005); // fixes wander round a 5 m circle
  assert(get(h).now < 0.7, "standing: " + get(h).now);
  w.walk(4, 120, { step: 10 });
  assert.near(get(h).now, 4, 0.3, "a fix every 10 s");
});

test("speed now: jitter while walking barely changes it", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 300, { jitter: 0.002 });
  assert.near(get(h).now, 5, 0.6);
});

test("speed now: gone when the fixes stop", async h => {
  const w = walker(h);
  start(h);
  w.walk(5, 60);
  assert.near(get(h).now, 5, 0.05);
  await h.wait(15500);
  assert.eq(get(h).now, null, "no good fix for 15 s");
  assert.near(home(h), 5 * 59 / 3.6, 3, "the way home is still known");
});
