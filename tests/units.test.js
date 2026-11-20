/* Speed units tests: the kph/mph setting, the Units item of both button
   menus and of Settings > Apps > BangTurn, and the speeds shown in it.
   Run: node tests/run.js tests/units.test.js -v */
const { test, assert } = require("./harness");

const MIN = 60000;
const BT = 'require("bangturn")';

function fakeSpeed(h) {
  h.tx(`require("Storage").write("bangturn.speed",${JSON.stringify(
    "exports.resume=exports.event=function(){};exports.get=function(){return global.SP||{out:null,back:null}};" +
    "exports.source=function(){return {from:null,chip:false,fixAge:null}};")})`);
}
function spyMenu(h) {
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
}
function menuItems(h) {
  return h.eval(`MENU&&Object.keys(MENU).filter(function(k){return k!==""})`);
}
const rows = h => h.eval(`lines(${BT}.status()).rows`);

test("the units setting: kph by default, saved, anything else is kph", async h => {
  assert.eq(h.eval(`${BT}.getUnits()`), "kph");
  h.tx(`${BT}.setMins(90)`);
  assert.eq(h.eval(`${BT}.setUnits("mph")`), "mph");
  assert.eq(h.eval(`require("Storage").readJSON("bangturn.settings.json")`), { mins: 90, units: "mph" },
    "kept beside the walk length");
  assert.eq(h.eval(`${BT}.getUnits()`), "mph");
  assert.eq(h.eval(`${BT}.getMins()`), 90, "length untouched");
  assert.eq(h.eval(`${BT}.setUnits("furlongs")`), "kph");
  assert.eq(h.eval(`${BT}.toUnits(8.04672,"mph")`), 5);
  assert.eq(h.eval(`${BT}.toUnits(5,"kph")`), 5);
  assert.eq(h.eval(`${BT}.toUnits(null,"mph")`), null);
});

test("walk menu: Units switches the speed rows to mph and back", async h => {
  fakeSpeed(h);
  h.tx(`${BT}.start(${h.eval("Date.now()") - 41 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.23,back:4.87}");
  assert.eq(rows(h), ["Out 5.2 kph", "Back 4.9 kph"]);
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["Units: kph"]()');
  assert.eq(menuItems(h), ["Resume", "-1 min", "Cancel walk", "Info", "Units: mph"]);
  assert.eq(h.eval('MENU[""].selected'), 4, "stays on Units");
  assert.eq(h.eval(`${BT}.getUnits()`), "mph", "saved");
  assert.eq(rows(h), ["Out 3.2 mph", "Back 3.0 mph"]);
  h.tx("global.SP={out:5.2,back:null}");
  assert.eq(rows(h), ["Out 3.2 mph", "Back -- mph"]);
  h.tx('MENU["Units: mph"]()');
  assert.eq(rows(h), ["Out 5.2 kph", "Back -- kph"]);
});

test("idle menu: Units, and the choice is kept for the next start", async h => {
  fakeSpeed(h);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showIdleMenu()");
  h.tx('MENU["Units: kph"]()');
  assert.eq(menuItems(h), ["Length: 60 min", "Info", "Units: mph"]);
  assert.eq(h.eval('MENU[""].selected'), 2, "stays on Units");
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  assert.eq(rows(h), ["Out -- mph"]);
});

test("Settings > Apps > BangTurn: Units switches with a tap", async h => {
  spyMenu(h);
  h.tx(`eval(require("Storage").read("bangturn.settings.js"))(function(){global.BACK=1})`);
  h.tx('MENU["Units: kph"]()');
  assert.eq(menuItems(h), ["Length: 60 min", "Units: mph"]);
  assert.eq(h.eval(`${BT}.getUnits()`), "mph");
});
