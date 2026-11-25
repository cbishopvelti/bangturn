/* Watch GPS setting tests: "Use watch GPS: no" keeps the watch's own GPS
   chip off for the whole walk, using only the phone's GPS (Android
   Integration's "Overwrite GPS"); switching it during a walk applies at once;
   the menu items and Info.
   Run: node tests/run.js tests/watchgps.test.js -v */
const { test, assert } = require("./harness");
const walker = require("./walker");
const { phoneGPS, phoneFix, hw, lastAsk } = require("./phone");

const BT = 'require("bangturn")';
const SP = 'require("bangturn.speed")';
const gpsUsers = h => h.eval("Object.keys(global.GPS_USERS||{})");
function spyMenu(h) {
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
}
const menuItems = h => h.eval(`MENU&&Object.keys(MENU).filter(function(k){return k!==""})`);

test("the setting: allowed by default, saved beside the others", async h => {
  assert.eq(h.eval(`${BT}.getWatchGps()`), true);
  h.tx(`${BT}.setUnits("mph")`);
  assert.eq(h.eval(`${BT}.setWatchGps(false)`), false);
  assert.eq(h.eval(`require("Storage").readJSON("bangturn.settings.json")`), { units: "mph", wgps: false });
  assert.eq(h.eval(`${BT}.getWatchGps()`), false);
  assert.eq(h.eval(`${BT}.setWatchGps(true)`), true);
  assert.eq(h.eval(`require("Storage").readJSON("bangturn.settings.json")`), { units: "mph" });
});

test("not allowed, no phone GPS: a walk asks for no GPS at all, and still runs", async h => {
  h.tx(`${BT}.setWatchGps(false)`);
  h.tx(`${BT}.start()`);
  await h.wait(100);
  assert.eq(gpsUsers(h), [], "no GPS asked for");
  assert.eq(h.eval(`${BT}.isActive()`), true);
  assert.eq(h.eval(`${SP}.stats().tracking`), true, "still listening, in case GPS comes");
  assert.eq(h.eval(`${SP}.source().allow`), false);
});

test("not allowed, phone GPS: the chip stays off from the start, the phone is asked", async h => {
  await phoneGPS(h);
  h.tx(`${BT}.setWatchGps(false)`);
  h.tx(`${BT}.start()`);
  await h.wait(100);
  assert.eq(hw(h), false, "watch GPS off before the phone's first fix");
  assert.eq(lastAsk(h), true, "phone asked for GPS");
  assert.eq(h.eval("Bangle._PWR.GPS"), ["bangturn"], "GPS asked for");
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(3000); // the android app gives up on the phone after 2 s
  assert.eq(hw(h), false, "watch GPS still off when the phone stops");
  assert.eq(h.eval(`${SP}.source().from`), "phone");
  await h.load("bangturn.app.js");
  assert.eq(hw(h), false, "and after an app load");
  h.tx(`${BT}.cancel()`);
  await h.wait(100);
  assert.eq([hw(h), lastAsk(h)], [false, false], "all off at the end");
});

test("not allowed, Bluetooth connected: no wait, the chip never comes on", async h => {
  await phoneGPS(h, { bt: true });
  h.tx(`${BT}.setWatchGps(false)`);
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(5000); // past the android app's 2 s and BangTurn's 1.5 s
  assert.eq(hw(h), false);
  assert.eq(h.eval(`${SP}.source().wait`), false, "not waiting: nothing to wait for");
  h.tx(`global.BT_DOWN=true;NRF.emit("disconnect")`);
  await h.wait(200);
  assert.eq(hw(h), false, "still off when Bluetooth drops");
});

test("switched during a walk: off turns the chip off at once, on lets it back", async h => {
  await phoneGPS(h, { bt: true });
  const w = walker(h);
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(4500); // phone stopped: the chip takes over after the wait
  assert.eq(hw(h), true, "watch GPS on (allowed)");
  w.walk(5, 30);
  const before = h.eval(`${SP}.stats().outKm`);
  h.tx(`${BT}.setWatchGps(false)`);
  await h.wait(100);
  assert.eq(hw(h), false, "off at once");
  assert.eq(h.eval(`${SP}.stats().tracking`), true, "still tracking");
  assert(Math.abs(h.eval(`${SP}.stats().outKm`) - before) < 1e-6, "the distance carries on");
  await h.wait(2500);
  assert.eq(hw(h), false, "and stays off");
  h.tx(`${BT}.setWatchGps(true)`);
  await h.wait(2000); // the phone was sending a moment ago: wait 1.5 s for it first
  assert.eq(hw(h), true, "watch GPS back on");
});

test("switched back on with no recent phone fix: the chip comes on at once", async h => {
  await phoneGPS(h);
  h.tx(`${BT}.setWatchGps(false)`);
  h.tx(`${BT}.start()`);
  phoneFix(h);
  await h.wait(1000);
  phoneFix(h);
  await h.wait(3000);
  assert.eq(hw(h), false);
  h.tx(`${BT}.setWatchGps(true)`);
  await h.wait(100);
  assert.eq(hw(h), true, "no Bluetooth wait: on at once");
});

test("menus: Use watch GPS in the idle and walk menus and Settings; Info says not used", async h => {
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showIdleMenu()");
  h.tx('MENU["Use watch GPS: yes"]()');
  assert.eq(h.eval(`${BT}.getWatchGps()`), false);
  assert.eq(menuItems(h), ["Length: 60 min", "Info", "Units: kph", "GPS log: off", "Use watch GPS: no"]);
  assert.eq(h.eval('MENU[""].selected'), 4, "stays on the item");
  h.tx('MENU["Info"]()');
  assert.eq(h.eval('MENU["Watch GPS"].value'), "not used");
  h.tx(`${BT}.start()`);
  h.tx("showWalkMenu()");
  assert.eq(menuItems(h), ["Resume", "-1 min", "Cancel walk", "Info", "Units: kph", "Use watch GPS: no"]);
  h.tx('MENU["Use watch GPS: no"]()');
  assert.eq(h.eval(`${BT}.getWatchGps()`), true);
  assert.eq(h.eval('MENU[""].selected'), 5);
  h.tx('MENU["Info"]()');
  assert(["ON", "off"].includes(h.eval('MENU["Watch GPS"].value')), "allowed again");
  h.tx(`eval(require("Storage").read("bangturn.settings.js"))(function(){})`);
  assert.eq(menuItems(h), ["Length: 60 min", "Units: kph", "GPS log: off", "Use watch GPS: yes"]);
  h.tx('MENU["Use watch GPS: yes"]()');
  assert.eq(menuItems(h), ["Length: 60 min", "Units: kph", "GPS log: off", "Use watch GPS: no"]);
});
