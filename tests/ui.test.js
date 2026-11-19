/* UI tests: idle, running and menu screens in app.js.
   Run: npm test  (or: node tests/run.js tests/ui.test.js -v --grep=name)
   The emulator clock can't advance, so walks start in the past. */
const { test, assert } = require("./harness");

const MIN = 60000;
const BT = 'require("bangturn")';

/* Replace the speed module with one that returns global.SP */
function fakeSpeed(h) {
  h.tx('require("Storage").write("bangturn.speed","exports.get=function(){return global.SP||{out:null,back:null}}")');
}
/* What the main screen shows right now */
function screenText(h) {
  return h.eval(`lines(${BT}.status())`);
}
/* Record strings drawn to the screen in global.DRAWN */
function spyDraw(h) {
  h.tx(`global.DRAWN=[];(function(o){g.drawString=function(s){DRAWN.push(""+s);return o.apply(g,arguments)}})(g.drawString)`);
}
/* Record E.showMenu calls; the last menu object is MENU (null when closed) */
function spyMenu(h) {
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
}
function menuItems(h) {
  return h.eval(`MENU&&Object.keys(MENU).filter(function(k){return k!==""})`);
}
/* Capture setWatch callbacks so the test can "press" the button, then
   rebuild the main screen's UI so its button watch is captured. */
function captureButton(h) {
  h.tx(`global.WATCHES=[];(function(o){global.setWatch=function(cb,pin,opt){WATCHES.push(cb);return o.apply(this,arguments)}})(setWatch)`);
  h.tx("showMain()");
}
function press(h) {
  h.tx(`WATCHES[WATCHES.length-1]({state:false,time:getTime(),lastTime:getTime()-0.1})`);
}

test("idle screen: 1:00:00, turnaround time, press to start", async h => {
  await h.load("bangturn.app.js");
  assert.eq(screenText(h), { time: "1:00:00", rows: ["Press to start"], sub: "Turn around at 30:00" });
  assert.eq(h.eval("screen"), "main");
  spyDraw(h);
  h.tx('Bangle.emit("lock",false)');
  const drawn = h.eval("DRAWN");
  for (const s of ["1:00:00", "Turn around at 30:00", "Press to start"])
    assert(drawn.includes(s), `drew "${s}": ${JSON.stringify(drawn)}`);
});

test("running out: countdown, turnaround line and Out row", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 12 * MIN})`);
  await h.load("bangturn.app.js");
  const t = screenText(h);
  assert(t.time == "0:48:00" || t.time == "0:47:59" || t.time == "0:47:58", "time " + t.time);
  assert.eq(t.sub, "Turn around at 30:00");
  assert.eq(t.rows, ["Out -- kph"], "no fix yet");
});

test("running back: Heading home with Out and Back speed rows", async h => {
  fakeSpeed(h);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 41 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.23,back:4.87}");
  const t = screenText(h);
  assert.eq(t.sub, "Heading home");
  assert.eq(t.rows, ["Out 5.2 kph", "Back 4.9 kph"]);
  h.tx("global.SP={out:5.2,back:null}");
  assert.eq(screenText(h).rows, ["Out 5.2 kph", "Back -- kph"]);
  spyDraw(h);
  h.tx('Bangle.emit("bangturn","offset")');
  const drawn = h.eval("DRAWN");
  assert(drawn.includes("Heading home") && drawn.includes("Back -- kph"), JSON.stringify(drawn));
});

test("speed hook returning nothing still draws", async h => {
  h.tx('require("Storage").write("bangturn.speed","exports.get=function(){}")');
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  assert.eq(screenText(h).rows, ["Out -- kph"]);
});

test("redraws every second when unlocked, every minute when locked", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx('Bangle.setLocked(false);Bangle.emit("lock",false)');
  spyDraw(h);
  await h.wait(2600);
  const unlocked = h.eval('DRAWN.filter(function(s){return s.indexOf("0:")==0}).length');
  assert(unlocked >= 2 && unlocked <= 4, "unlocked redraws in 2.6 s: " + unlocked);
  h.tx('Bangle.setLocked(true);Bangle.emit("lock",true)');
  await h.wait(300); // the lock change itself redraws once
  assert(h.eval("Bangle.isLocked()"), "locked");
  h.tx("DRAWN=[]");
  await h.wait(2600);
  assert.eq(h.eval('DRAWN.filter(function(s){return s.indexOf("0:")==0}).length'), 0, "no redraw while locked");
  const next = h.eval("drawTimer&&global['\\xff'].timers[drawTimer].time/1000");
  assert(next > 1000 && next <= 60000, "next redraw on the minute: " + next);
});

test("tap on idle screen starts the walk; tap while running does nothing", async h => {
  await h.load("bangturn.app.js");
  h.tx(`Bangle.emit("touch",1,{x:88,y:88})`);
  await h.wait(100);
  const s1 = h.eval(`${BT}.read().start`);
  assert(s1, "walk started");
  h.tx(`Bangle.emit("touch",1,{x:88,y:88})`);
  await h.wait(100);
  assert.eq(h.eval(`${BT}.read().start`), s1, "same walk");
  assert.eq(h.eval("screen"), "main");
});

test("button on idle screen starts the walk", async h => {
  await h.load("bangturn.app.js");
  captureButton(h);
  press(h);
  await h.wait(100);
  assert(h.eval(`${BT}.isActive()`), "walk started");
  assert.eq(h.eval("screen"), "main");
});

test("button while running opens the menu: Resume, -1 min, Cancel walk", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  captureButton(h);
  press(h);
  await h.wait(100);
  assert.eq(h.eval("screen"), "menu");
  assert.eq(menuItems(h), ["Resume", "-1 min", "Cancel walk"]);
  h.tx('MENU["Resume"]()');
  assert.eq(h.eval("screen"), "main");
  assert.eq(h.eval("MENU"), null, "menu closed");
  assert(h.eval(`${BT}.isActive()`), "walk still running");
});

test("-1 min shows the offset and stays in the menu", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["-1 min"]()');
  assert.eq(h.eval("screen"), "menu");
  assert.eq(menuItems(h), ["Resume", "-1 min (-1)", "Cancel walk"]);
  assert.eq(h.eval('MENU[""].selected'), 1, "keeps -1 min selected");
  h.tx('MENU["-1 min (-1)"]()');
  h.tx('MENU["-1 min (-2)"]()');
  assert.eq(menuItems(h), ["Resume", "-1 min (-3)", "Cancel walk"]);
  assert.eq(h.eval(`${BT}.read().offset`), 3);
  h.tx('MENU["Resume"]()');
  const t = screenText(h);
  assert(t.time == "0:52:00" || t.time == "0:51:59" || t.time == "0:51:58", "time " + t.time);
});

test("-1 min past the turnaround switches to Heading home", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 29.5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["-1 min"]()');
  h.tx('MENU["Resume"]()');
  const t = screenText(h);
  assert.eq(t.sub, "Heading home");
  assert.eq(t.rows.length, 2);
});

test("-1 min past the end returns to the idle screen", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 59.5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["-1 min"]()');
  assert.eq(h.eval("screen"), "main");
  assert.eq(screenText(h).rows, ["Press to start"]);
});

test("Cancel walk clears the walk and shows the idle screen", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  spyMenu(h);
  h.tx("showWalkMenu()");
  h.tx('MENU["Cancel walk"]()');
  assert.eq(h.eval("screen"), "main");
  assert.eq(h.eval(`${BT}.read()`), {});
  assert.eq(h.eval(`${BT}.getSched()`), []);
  assert.eq(screenText(h), { time: "1:00:00", rows: ["Press to start"], sub: "Turn around at 30:00" });
});

test("menu returns to the countdown after 10 s without input", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 5 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("MENU_TIMEOUT=1500"); // same code path, shorter wait
  h.tx("showWalkMenu()");
  await h.wait(1000);
  h.tx('Bangle.emit("drag",{x:80,y:80,dx:0,dy:5,b:1})'); // input restarts the timeout
  await h.wait(1000);
  assert.eq(h.eval("screen"), "menu", "still in menu after input");
  await h.wait(1000);
  assert.eq(h.eval("screen"), "main", "back to countdown");
  assert(h.eval(`${BT}.isActive()`), "walk still running");
});

test("menu timeout defaults to 10 s", async h => {
  await h.load("bangturn.app.js");
  assert.eq(h.eval("MENU_TIMEOUT"), 10000);
});

test("walk ending while the menu is open returns to idle", async h => {
  h.tx(`${BT}.start(${h.eval("Date.now()") - 30 * MIN})`);
  await h.load("bangturn.app.js");
  h.tx("showWalkMenu()");
  h.tx(`${BT}.fire("end")`);
  assert.eq(h.eval("screen"), "main");
  assert.eq(screenText(h).rows, ["Press to start"]);
});

test("turnaround alert then the countdown", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 30 * MIN})`);
  h.tx(`require("Storage").writeJSON("bangturn.json",Object.assign(${BT}.read(),{turned:true,alert:"turn"}))`);
  await h.load("bangturn.app.js");
  assert.eq(h.eval(`${BT}.read().alert===undefined`), true, "alert taken");
  await h.wait(7000); // the alarm stops after at most 6 s
  assert.eq(h.eval("screen"), "main");
  assert.eq(screenText(h).sub, "Heading home");
});
