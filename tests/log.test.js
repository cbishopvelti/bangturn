/* GPS log tests: the "GPS log" setting, what bangturn.log records (every
   fix with a position, as it came), a new log per walk, -1 min, app changes,
   the size limit, the menu items and Info.
   Run: node tests/run.js tests/log.test.js -v */
const { test, assert } = require("./harness");
const walker = require("./walker");

const MIN = 60000;
const BT = 'require("bangturn")';
const SP = 'require("bangturn.speed")';
const LOG = "bangturn.log";

/* the log as lines (a StorageFile: Storage.read can't see it) */
const log = h => h.eval(`(function(f){var s="",c;while((c=f.read(4096))!==undefined)s+=c;return s})(require("Storage").open("${LOG}","r"))`)
  .split("\n").filter(l => l);
const fixes = h => log(h).filter(l => /^\d/.test(l)).map(l => l.split(","));
const start = (h, ago) => h.tx(`${BT}.start(Date.now()-${ago || 0})`);
function spyMenu(h) {
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
}
const menuItems = h => h.eval(`MENU&&Object.keys(MENU).filter(function(k){return k!==""})`);

test("off by default: a walk writes no log", async h => {
  assert.eq(h.eval(`${BT}.getLog()`), false);
  const w = walker(h);
  start(h);
  w.walk(5, 30);
  assert.eq(h.eval(`${SP}.logSize()`), 0);
  assert.eq(log(h), []);
});

test("the setting is saved beside the others", async h => {
  h.tx(`${BT}.setUnits("mph")`);
  assert.eq(h.eval(`${BT}.setLog(true)`), true);
  assert.eq(h.eval(`require("Storage").readJSON("bangturn.settings.json")`), { units: "mph", log: true });
  assert.eq(h.eval(`${BT}.getLog()`), true);
  assert.eq(h.eval(`${BT}.setLog(false)`), false);
  assert.eq(h.eval(`${BT}.getUnits()`), "mph", "units untouched");
});

test("on: every fix with a position, as it came, even the ones the speeds ignore", async h => {
  h.tx(`${BT}.setLog(true)`);
  const w = walker(h);
  const now = h.eval("Date.now()");
  start(h);
  const s = h.eval(`${BT}.read().start`);
  w.noFix(); // no position: not logged
  w.walk(5, 3);
  w.fix({ hdop: 9 }); // too poor for the speeds, still logged
  w.fixAt(1, 0); // a 1 km jump, still logged
  w.fix({ externalSource: true, time: null, satellites: undefined }); // as Gadgetbridge sends it
  const l = log(h);
  assert.eq(l[0], `# bangturn GPS log 1 start=${s} t0=${s} dur=${60 * MIN}`);
  assert.eq(l[1], "now,time,lat,lon,hdop,speed,sats,src");
  assert(/^# w \{.*"lat":/.test(l[2]), "the watch's first fix in full: " + l[2]);
  const f = fixes(h);
  assert.eq(f.length, 6, "3 walking, 1 poor, 1 jump, 1 phone");
  assert.eq(f.map(c => c[7]), ["w", "w", "w", "w", "w", "p"]);
  assert(+f[0][0] >= now && +f[0][0] < now + 5000, "now is the watch's clock");
  assert.eq(f[1][1] - f[0][1], 1000, "a second apart on the GPS clock");
  assert.near(+f[2][2], w.lat, 1e-9, "lat as sent");
  assert.near(+f[2][3], w.lon, 1e-9, "lon as sent");
  assert.eq(f[3][4], "9", "hdop");
  assert.eq(f[0][6], "8", "satellites");
  assert.near(+f[4][2] - w.lat, 1 / 111.195, 1e-6, "the jump as it came");
  assert.eq(f[5][1], "", "no time: empty");
  assert.eq(f[5][6], "", "no satellites: empty");
  assert(l.some(x => /^# p \{.*"externalSource":true/.test(x)), "the phone's first fix in full");
  assert.eq(l.filter(x => /^# [pw] /.test(x)).length, 2, "one full fix per source");
  assert(h.eval(`${SP}.logSize()`) > 200);
});

test("-1 min is noted; the log stays after the walk, and the next walk starts a new one", async h => {
  h.tx(`${BT}.setLog(true)`);
  const w = walker(h);
  start(h);
  w.walk(5, 5);
  h.tx(`${BT}.minusOne()`);
  const t0 = h.eval(`${BT}.startTime()`);
  w.walk(5, 5);
  assert(log(h).includes(`# t0=${t0}`), "the new effective start");
  assert.eq(fixes(h).length, 10);
  h.tx(`${BT}.cancel()`);
  assert.eq(fixes(h).length, 10, "kept after the walk");
  w.walk(5, 5);
  assert.eq(fixes(h).length, 10, "nothing logged without a walk");
  start(h);
  w.walk(5, 3);
  assert.eq(fixes(h).length, 3, "a new walk, a new log");
  assert.eq(log(h).filter(l => l.startsWith("# bangturn")).length, 1);
});

test("app changes carry on the same log", async h => {
  h.tx(`${BT}.setLog(true)`);
  const w = walker(h);
  await h.load("bangturn.app.js");
  start(h);
  w.walk(5, 20);
  await h.load(); // back to the clock
  w.walk(5, 20);
  await h.load("bangturn.app.js");
  w.walk(5, 20);
  assert.eq(fixes(h).length, 60);
  assert.eq(log(h).filter(l => l.startsWith("# bangturn")).length, 1, "one header");
});

test("the log stops at its size limit", async h => {
  h.tx(`${BT}.setLog(true)`);
  const w = walker(h);
  start(h);
  h.tx(`${SP}.LOG_MAX=400`);
  w.walk(5, 10);
  const l = log(h);
  assert.eq(l[l.length - 1], "# full", "stopped, and says so");
  const n = fixes(h).length;
  assert(n > 0 && n < 10, n + " fixes before the limit");
  w.walk(5, 10);
  assert.eq(fixes(h).length, n, "no more after it");
  assert.eq(h.eval(`${SP}.stats().outMs`), 19000, "the speeds carry on");
});

test("idle menu and Settings: GPS log switches with a tap; Info shows the size", async h => {
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showIdleMenu()");
  h.tx('MENU["GPS log: off"]()');
  assert.eq(menuItems(h), ["Length: 60 min", "Info", "Units: kph", "GPS log: on"]);
  assert.eq(h.eval('MENU[""].selected'), 3, "stays on GPS log");
  assert.eq(h.eval(`${BT}.getLog()`), true);
  h.tx('MENU["Info"]()');
  assert.eq(h.eval('MENU["GPS log"].value'), "0 KB");
  h.tx(`eval(require("Storage").read("bangturn.settings.js"))(function(){})`);
  assert.eq(menuItems(h), ["Length: 60 min", "Units: kph", "GPS log: on"]);
  h.tx('MENU["GPS log: on"]()');
  assert.eq(h.eval(`${BT}.getLog()`), false);
  assert.eq(menuItems(h), ["Length: 60 min", "Units: kph", "GPS log: off"]);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showInfo()");
  assert.eq(h.eval('MENU["GPS log"].value'), "off");
});
