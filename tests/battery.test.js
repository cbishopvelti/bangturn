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
  await h.wait(5000); // cut-off 3.5 s from now
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
   hardware state in global.GPS_HW (and Bangle.getGPSFix() undefined while
   it's off, like the firmware's). gps_power messages to the phone go to GBOUT. */
async function phoneGPS(h, opt) {
  opt = opt || {};
  assert(fs.existsSync(path.join(APPS, "apps/android/lib.js")),
    "BangleApps/apps/android missing: run tests/setup-emulator.sh");
  const file = f => fs.readFileSync(path.join(APPS, "apps/android", f), "utf8");
  const put = (name, content) => h.tx(`require("Storage").write(${JSON.stringify(name)},${JSON.stringify(content)})`);
  put("0hw.boot.js", "Bangle.setGPSPower=function(on,id){if(!Bangle._PWR)Bangle._PWR={};" +
    "var l=Bangle._PWR.GPS||(Bangle._PWR.GPS=[]);id=id===undefined?'?':''+id;var i=l.indexOf(id);" +
    "if(on){if(i<0)l.push(id)}else if(i>=0)l.splice(i,1);if(!l.length)delete Bangle._PWR.GPS;" +
    "return global.GPS_HW=l.length>0};Bangle.isGPSOn=function(){return !!global.GPS_HW};" +
    "Bangle.getGPSFix=function(){return global.GPS_HW?{fix:0}:undefined};" +
    // what the android app sends to the phone (the emulator has no Bluetooth.println)
    'global.GBOUT=[];Bluetooth.println=function(s){if(s){s=JSON.parse(s);if(s.t=="gps_power")GBOUT.push(s.status)}};\n' +
    // bt: Bluetooth is connected, and BangTurn waits opt.wait ms for the phone
    (opt.bt ? "NRF.getSecurityStatus=function(){return {connected:!global.BT_DOWN}};" +
      `require("bangturn.speed").PHONE_WAIT=${opt.wait || 1500};\n` : ""));
  put("android", file("lib.js"));
  put("android.boot.js", file("boot.js"));
  h.tx(`require("Storage").writeJSON("android.settings.json",{overwriteGps:true,keep:true})`);
  await h.load();
  assert(h.eval("!!Bangle.moveGPSPower"), "Overwrite GPS is installed");
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
  assert.eq(h.eval(`(function(s){return [s.from,s.chip]})(require("bangturn.speed").source())`), ["phone", false], "what Info shows");
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
  assert.eq(h.eval(`require("bangturn.speed").source().chip`), true, "the menu shows the chip on");
  await h.wait(3000);
  assert.eq(h.eval(`${BT}.isActive()`), false, "walk ended");
  assert.eq(hw(h), false, "watch GPS off at the end");
  assert.eq(lastAsk(h), false, "phone told to stop GPS");
});

/* ---------- phone GPS first: BangTurn holds the watch's GPS off ----------
   The android app turns the watch's GPS on when a phone fix is later than
   the gap between the last two plus 1 s, which a phone's irregular fixes
   trip all the time. With Bluetooth connected BangTurn waits PHONE_WAIT
   (a minute; 1.5 s in these tests) before letting the chip come on. */
const waiting = h => h.eval(`require("bangturn.speed").source().wait`);

test("phone GPS first: a late phone fix doesn't turn the watch's GPS on while Bluetooth is connected", async h => {
  await phoneGPS(h, { bt: true, wait: 4000 });
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(2500); // the android app gives up on the phone after 2 s
  assert.eq(hw(h), false, "watch GPS still off");
  assert.eq(waiting(h), true, "waiting for the phone");
  assert.eq(h.eval("Bangle.isGPSOn()"), true, "GPS still wanted");
  phoneFix(h); // the late fix
  await h.wait(100);
  assert.eq(hw(h), false, "watch GPS off");
  assert.eq(waiting(h), false, "the phone is back");
  assert.eq(h.eval(`require("bangturn.speed").source().from`), "phone");
});

test("phone GPS first: the watch's GPS takes over after the wait, and goes off again at the next phone fix", async h => {
  await phoneGPS(h, { bt: true });
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(2500); // given up on, and waiting 1.5 s
  assert.eq(hw(h), false, "watch GPS off during the wait");
  await h.wait(1500);
  assert.eq(hw(h), true, "watch GPS on after the wait");
  assert.eq(waiting(h), false);
  phoneFix(h);
  await h.wait(100);
  assert.eq(hw(h), false, "watch GPS off: the phone is back");
});

test("phone GPS first: if Bluetooth drops, the watch's GPS comes on at once", async h => {
  await phoneGPS(h, { bt: true, wait: 30000 });
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(2500);
  assert.eq([hw(h), waiting(h)], [false, true], "waiting");
  h.tx(`global.BT_DOWN=true;NRF.emit("disconnect")`);
  await h.wait(200);
  assert.eq([hw(h), waiting(h)], [true, false], "watch GPS on");
  // and with Bluetooth down there is no wait: as the android app does it
  h.tx("global.BT_DOWN=false");
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  h.tx("global.BT_DOWN=true");
  await h.wait(2500);
  assert.eq([hw(h), waiting(h)], [true, false], "no wait without Bluetooth");
});

test("phone GPS first: changing app doesn't turn the watch's GPS on if the phone was just sending", async h => {
  await phoneGPS(h, { bt: true });
  h.tx(`${BT}.start()`);
  await h.wait(100);
  assert.eq(hw(h), true, "a new walk starts on the watch's GPS until the phone's first fix");
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(100);
  assert.eq(hw(h), false);
  await h.load("bangturn.app.js");
  assert.eq(hw(h), false, "watch GPS off after the app loads");
  assert.eq(waiting(h), true, "waiting for the phone");
  assert.eq(h.eval("Bangle._PWR.GPS"), ["bangturn"], "GPS still asked for");
  await h.wait(2000);
  assert.eq(hw(h), true, "no phone fix in the wait: watch GPS on");
});

test("phone GPS first: ending the walk during the wait leaves everything off, and the android app's switch back", async h => {
  await phoneGPS(h, { bt: true, wait: 3000 });
  h.tx(`global.MOVE0=Bangle.moveGPSPower`);
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(2500);
  assert.eq(waiting(h), true);
  assert.eq(h.eval("Bangle.moveGPSPower!==MOVE0"), true, "BangTurn stepped in for the walk");
  h.tx(`${BT}.cancel()`);
  await h.wait(3500);
  assert.eq(hw(h), false, "watch GPS off, and it stays off");
  assert.eq(lastAsk(h), false, "phone told to stop GPS");
  assert.eq(h.eval("Bangle.moveGPSPower===MOVE0"), true, "the android app's own function is back");
  assert.eq(ourTimers(h), [], "nothing left running");
});
