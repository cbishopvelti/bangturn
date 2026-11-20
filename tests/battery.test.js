/* Battery tests: what BangTurn leaves running when no walk is on, how often
   it wakes the watch during a walk, and that GPS (the big drain) always goes
   off at the end, including with the phone's GPS (Android Integration's
   "Overwrite GPS"). The emulator can't measure power: these check timers and
   GPS requests, the things that cost power on a real watch.
   Run: npm test  (or: node tests/run.js tests/battery.test.js -v) */
const fs = require("fs");
const path = require("path");
const { test, assert } = require("./harness");
const walker = require("./walker");

const MIN = 60000;
const BT = 'require("bangturn")';
const APPS = path.join(process.env.BANGLE_DIR || "/opt/bangle", "BangleApps");

/* Pending timers whose code is BangTurn's (the core, widget, app or speed) */
const ourTimers = h => h.eval(`global["\\xff"].timers.filter(function(x){
  return x && /bangturn|\\bbt\\.|drawClock|armEnd|endTimer|clockTimer/.test(""+x.cb)}).map(function(x){
  return {cb:(""+x.cb).substr(0,60), every:x.intr}})`);
const gpsUsers = h => h.eval("Object.keys(global.GPS_USERS||{})");

/* Count calls of WIDGETS.bangturn.draw from now on, in global.WD */
const countWidgetDraws = h => h.tx(`global.WD=0;var _wd=WIDGETS.bangturn.draw;
  WIDGETS.bangturn.draw=function(){WD++;return _wd.apply(this,arguments)}`);

test("no walk: BangTurn leaves no timers and no GPS, in the clock or the app", async h => {
  assert.eq(ourTimers(h), [], "clock: no BangTurn timers");
  assert.eq(gpsUsers(h), [], "clock: no GPS");
  assert.eq(h.eval(`require("bangturn").getSched()`), [], "no wake-ups left in sched");
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(true)");
  await h.wait(300);
  // just the time of day, once a minute while locked
  const t = ourTimers(h);
  assert.eq(t.length, 1, "app: one timer: " + JSON.stringify(t));
  assert(/clockTimer/.test(t[0].cb) && !t[0].every, "the clock row's one-shot timer");
  assert.eq(gpsUsers(h), [], "app: no GPS");
});

test("during a walk the clock's widget redraws at most once a minute", async h => {
  h.tx(`${BT}.start()`);
  await h.load(); // the clock, with the widget
  h.tx("Bangle.setLocked(true)");
  countWidgetDraws(h);
  await h.wait(3000);
  assert(h.eval("WD") <= 1, "widget draws in 3 s: " + h.eval("WD"));
  assert.eq(ourTimers(h).filter(t => t.every).length, 0, "no repeating timers");
});

test("a lost end wake-up: GPS goes off and the walk ends without any GPS fix", async h => {
  const w = walker(h);
  h.tx(`${BT}.start(Date.now()-${60 * MIN - 1200})`); // 1.2 s left
  h.tx(`${BT}.clearSched()`); // as if sched missed the "end" wake-up
  w.walk(5, 30);
  assert.eq(gpsUsers(h), ["bangturn"]);
  await h.wait(3500); // no GPS events at all (phone GPS, or no signal)
  assert.eq(gpsUsers(h), [], "GPS off");
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  assert.eq(ourTimers(h), [], "nothing left running");
});

test("-1 min moves the GPS cut-off with the end", async h => {
  h.tx(`${BT}.start(Date.now()-${59 * MIN - 2000})`); // 62 s left
  h.tx(`${BT}.minusOne()`); // 2 s left
  h.tx(`${BT}.clearSched()`);
  await h.wait(4000);
  assert.eq(gpsUsers(h), [], "GPS off");
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
});

test("a walk whose time ran out unnoticed: the widget ends it, no redraw every second", async h => {
  await h.load();
  // the state alone, as if the watch missed the end with GPS already off
  h.tx(`${BT}.clearSched();${BT}.write({start:Date.now()-${61 * MIN},dur:60,offset:0,turned:true});Bangle.emit("bangturn","offset")`);
  countWidgetDraws(h);
  await h.wait(3000);
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  assert(h.eval("WD") <= 1, "widget draws in 3 s: " + h.eval("WD"));
  assert.eq(h.eval("WIDGETS.bangturn.width"), 0, "widget hidden");
  assert.eq(ourTimers(h), []);
});

test("the same in the app: it ends the walk and shows the idle screen", async h => {
  await h.load("bangturn.app.js");
  h.tx(`${BT}.clearSched();${BT}.write({start:Date.now()-${61 * MIN},dur:60,offset:0,turned:true});Bangle.emit("bangturn","offset")`);
  await h.wait(2500);
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  h.tx("Bangle.setLocked(true)");
  await h.wait(300);
  assert.eq(ourTimers(h).filter(t => !/clockTimer/.test(t.cb)), [], "only the idle clock row's timer");
});

/* ---------- phone GPS: Android Integration with "Overwrite GPS" ----------
   Gadgetbridge sends the phone's fixes over Bluetooth and the android app
   turns the watch's own GPS off while they arrive. The emulator has no GPS,
   so 0hw.boot.js (run before android.boot.js) stands in for the firmware's
   Bangle.setGPSPower: the same per-app list in Bangle._PWR.GPS, with the
   hardware state in global.GPS_HW. Messages to the phone go to GBOUT. */
async function phoneGPS(h) {
  assert(fs.existsSync(path.join(APPS, "apps/android/lib.js")),
    "BangleApps/apps/android missing: run tests/setup-emulator.sh");
  const file = f => fs.readFileSync(path.join(APPS, "apps/android", f), "utf8");
  const put = (name, content) => h.tx(`require("Storage").write(${JSON.stringify(name)},${JSON.stringify(content)})`);
  put("0hw.boot.js", "Bangle.setGPSPower=function(on,id){if(!Bangle._PWR)Bangle._PWR={};" +
    "var l=Bangle._PWR.GPS||(Bangle._PWR.GPS=[]);id=id===undefined?'?':''+id;var i=l.indexOf(id);" +
    "if(on){if(i<0)l.push(id)}else if(i>=0)l.splice(i,1);if(!l.length)delete Bangle._PWR.GPS;" +
    "return global.GPS_HW=l.length>0};Bangle.isGPSOn=function(){return !!global.GPS_HW};\n");
  put("android", file("lib.js"));
  put("android.boot.js", file("boot.js"));
  h.tx(`require("Storage").writeJSON("android.settings.json",{overwriteGps:true})`);
  await h.load();
  assert(h.eval("!!Bangle.moveGPSPower"), "Overwrite GPS is installed");
  h.tx(`global.GBOUT=[];require("android").gbSend=function(m){if(m.t=="gps_power")GBOUT.push(m.status)}`);
}
const phoneFix = h => h.tx(`GB({t:"gps",lat:51.5,lon:-0.12,alt:0,speed:0,course:0,time:Date.now(),satellites:8,hdop:1,externalSource:true})`);
const hw = h => h.eval("!!global.GPS_HW");
const lastAsk = h => h.eval("GBOUT[GBOUT.length-1]"); // last gps_power sent to the phone

test("phone GPS: the watch's GPS is off while the phone sends fixes; cancel turns both off", async h => {
  await phoneGPS(h);
  h.tx(`${BT}.start()`);
  await h.wait(100);
  assert.eq(lastAsk(h), true, "phone asked for GPS");
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(100);
  assert.eq(hw(h), false, "watch GPS off while the phone sends fixes");
  assert.eq(h.eval(`require("bangturn.speed").stats().tracking`), true);
  h.tx(`${BT}.cancel()`);
  await h.wait(100);
  assert.eq(hw(h), false, "watch GPS off");
  assert.eq(lastAsk(h), false, "phone told to stop GPS");
  assert.eq(h.eval("Bangle.isGPSOn()"), false);
});

test("phone GPS: the end of the walk tells the phone to stop", async h => {
  await phoneGPS(h);
  h.tx(`${BT}.start(Date.now()-${60 * MIN - 2500})`); // 2.5 s left
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(3000); // sched fires the end
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  assert.eq(hw(h), false, "watch GPS off");
  assert.eq(lastAsk(h), false, "phone told to stop GPS");
});

test("phone GPS: if the phone stops sending, the watch's GPS takes over and still goes off at the end", async h => {
  await phoneGPS(h);
  h.tx(`${BT}.start(Date.now()-${60 * MIN - 5000})`); // 5 s left
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(2500); // fixes 1 s apart, so the android app gives up after 2 s
  assert.eq(hw(h), true, "watch GPS back on (the android app's fallback)");
  await h.wait(3000);
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  assert.eq(hw(h), false, "watch GPS off at the end");
  assert.eq(lastAsk(h), false, "phone told to stop GPS");
});
