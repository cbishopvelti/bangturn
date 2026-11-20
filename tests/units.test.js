/* Speed units tests: the kph/mph setting, the Units item of both button
   menus and of Settings > Apps > BangTurn, and the speeds shown in it.
   Run: node tests/run.js tests/units.test.js -v */
const { test, assert, speedRows } = require("./harness");

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
/* The average speed rows as text, "Out 5.2 kph", with the units as drawn */
const rows = h => speedRows(h.eval(`lines(${BT}.status()).rows`), h.eval("units"));
/* The rows as lines() gives them: with the times to the origin and the bottom row */
const rawRows = h => h.eval(`lines(${BT}.status()).rows`);

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

test("mph: every speed on the walk screen converts, the times to the origin and the colour don't change", async h => {
  fakeSpeed(h);
  h.tx(`${BT}.start(${h.eval("Date.now()") - 40 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(false)");
  // 20 min left: 1.5 km needs 4.5 kph (2.8 mph); walking at 4 kph (2.5 mph)
  h.tx("global.SP={out:5.2,back:4.8,now:4,home:1.5}");
  const k = rawRows(h);
  assert.eq([k[0].v, k[1].v, k[2].v, k[2].w, k[2].d], ["5.2", "4.8", "4.0", "4.5", "-0.5"]);
  h.tx(`${BT}.setUnits("mph")`);
  await h.load("bangturn.app.js");
  h.tx("Bangle.setLocked(false);global.SP={out:5.2,back:4.8,now:4,home:1.5}");
  const m = rawRows(h);
  assert.eq([m[0].v, m[1].v, m[2].v, m[2].w, m[2].d], ["3.2", "3.0", "2.5", "2.8", "-0.3"],
    "the averages, the speed now, the speed needed, and the difference of the two as shown");
  assert.eq([m[0].tf, m[1].tf], [k[0].tf, k[1].tf], "the same times to the origin");
  assert.near(m[2].c, k[2].c, 0.02, "the colour is a share of the speed needed: the same in any units");
  assert.near(m[2].c, -0.56, 0.03);
  // on screen: mph after each row, kph nowhere
  h.tx(`global.AT=[];(function(o){g.drawString=function(s){AT.push(""+s);return o.apply(g,arguments)}})(g.drawString);tick()`);
  const drawn = h.eval("AT");
  assert.eq(drawn.filter(t => t == "mph").length, 3, JSON.stringify(drawn));
  assert(!drawn.includes("kph"), "no kph left on screen");
  assert(drawn.includes("2.8") && drawn.includes("2.5") && drawn.includes("-0.3"));
});
