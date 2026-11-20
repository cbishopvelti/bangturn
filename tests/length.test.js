/* Walk length tests: the setting, walks of other lengths, the scroll wheel
   picker (picker.js) and Settings > Apps > BangTurn (settings.js).
   Run: node tests/run.js tests/length.test.js -v */
const { test, assert } = require("./harness");
const MIN = 60000;
const BT = 'require("bangturn")';

/* our sched entries as [id, ms after the walk's start] */
function entries(h, start) {
  return h.eval(`${BT}.getSched().map(function(a){var d=new Date(a.date+"T00:00:00");return [a.id.substr(9),d.getTime()+a.t-${start}]})`)
    .sort((a, b) => a[1] - b[1]);
}
/* Capture setWatch callbacks so a test can press the button */
function captureButton(h) {
  h.tx(`global.WATCHES=[];(function(o){global.setWatch=function(cb,pin,opt){WATCHES.push(cb);return o.apply(this,arguments)}})(setWatch)`);
}
function press(h) {
  h.tx(`WATCHES[WATCHES.length-1]({state:false,time:getTime(),lastTime:getTime()-0.1})`);
}
/* drag a wheel: n moves of dy px at x, then let go */
function drag(h, x, dy, n) {
  for (let i = 0; i < n; i++) h.tx(`Bangle.emit("drag",{x:${x},y:90,dx:0,dy:${dy},b:1})`);
  h.tx(`Bangle.emit("drag",{x:${x},y:90,dx:0,dy:0,b:0})`);
}

test("the length setting: an hour by default, saved, kept in range", async h => {
  assert.eq(h.eval(`${BT}.getMins()`), 60);
  assert.eq(h.eval(`${BT}.status().remaining`), 60 * MIN, "idle shows the next walk's length");
  assert.eq(h.eval(`${BT}.setMins(90)`), 90);
  assert.eq(h.eval(`require("Storage").readJSON("bangturn.settings.json")`), { mins: 90 });
  assert.eq(h.eval(`${BT}.getMins()`), 90);
  assert.eq(h.eval(`${BT}.fmt(${BT}.status().remaining)`), "90:00", "minutes only, no hours");
  assert.eq(h.eval(`${BT}.setMins(0)`), 1, "at least a minute");
  assert.eq(h.eval(`${BT}.setMins(5000)`), 599, "at most 9 h 59");
});

test("a 90 minute walk: turnaround at 45, buzzes at 1/2, 1/4, 1/8 of the way back, end at 90", async h => {
  h.tx(`${BT}.setMins(90)`);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now})`);
  assert.eq(h.eval(`${BT}.read().dur`), 90);
  const e = entries(h, now);
  assert.eq(e.map(x => x[0]), ["turn", "back2", "back4", "back8", "end"]);
  [45, 67.5, 78.75, 84.375, 90].forEach((m, i) => assert.near(e[i][1], m * MIN, 2, e[i][0]));
  const st = h.eval(`${BT}.status()`);
  assert.eq([st.duration, st.turn, st.phase], [90 * MIN, 45 * MIN, "out"]);
});

test("a short walk still gets all three buzzes, at 1/2, 1/4 and 1/8 of the way back", async h => {
  h.tx(`${BT}.setMins(20)`);
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now})`);
  let e = entries(h, now);
  assert.eq(e.map(x => x[0]), ["turn", "back2", "back4", "back8", "end"]);
  [10, 15, 17.5, 18.75, 20].forEach((m, i) => assert.near(e[i][1], m * MIN, 2, e[i][0]));
  h.tx(`${BT}.setMins(1)`);
  h.tx(`${BT}.start(${now})`);
  e = entries(h, now);
  assert.eq(e.map(x => x[0]), ["turn", "back2", "back4", "back8", "end"]);
  [30, 45, 52.5, 56.25, 60].forEach((sec, i) => assert.near(e[i][1], sec * 1000, 2, e[i][0]));
});

test("changing the length during a walk only changes the next walk", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.start(${now - 10 * MIN})`);
  h.tx(`${BT}.setMins(30)`);
  assert.eq(h.eval(`${BT}.status().duration`), 60 * MIN, "running walk keeps its hour");
  h.tx(`${BT}.minusOne()`);
  assert.eq(entries(h, now - 11 * MIN).pop(), ["end", 60 * MIN], "rescheduled with its own length");
  h.tx(`${BT}.cancel()`);
  assert.eq(h.eval(`${BT}.status().duration`), 30 * MIN, "next walk is 30 min");
});

test("a walk saved before lengths existed is an hour", async h => {
  const now = h.eval("Date.now()");
  h.tx(`${BT}.setMins(30)`);
  h.tx(`${BT}.write({start:${now - 40 * MIN},offset:0,turned:true})`);
  const st = h.eval(`${BT}.status()`);
  assert.eq([st.duration, st.phase], [60 * MIN, "back"]);
});

test("widget and GPS follow the walk's own length", async h => {
  h.tx(`${BT}.setMins(150)`);
  h.tx('Bangle.loadWidgets();Bangle.drawWidgets()');
  h.tx(`${BT}.start(Date.now()-10*${MIN}-1000)`);
  h.tx(`global.DR=[];var _d=g.drawString;g.drawString=function(s){DR.push(s);return _d.apply(g,arguments)};WIDGETS.bangturn.draw()`);
  assert.eq(h.eval("DR[DR.length-1]"), 139, "139 minutes left");
  // 70 minutes into the 150: past an hour, still out, GPS still on
  h.tx(`${BT}.write({start:Date.now()-70*${MIN},dur:150,offset:0,turned:false})`);
  await h.load();
  assert.eq(h.eval("GPS_USERS.bangturn||false"), 1, "GPS on after an hour");
  assert.eq(h.eval(`${BT}.isActive()`), true, "walk not ended at an hour");
});

test("idle screen: Length in the button menu opens the wheels, drag sets hours and minutes", async h => {
  await h.load("bangturn.app.js");
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
  h.tx("showIdleMenu()");
  captureButton(h);
  h.tx('MENU["Length: 60 min"]()');
  assert.eq(h.eval("screen"), "picker");
  // minutes wheel (right): drag up two rows: 60 -> 1 h 2 min
  drag(h, 130, -15, 4);
  // hours wheel (left): drag down a row: 0 h
  drag(h, 40, 16, 2);
  // tap below the band on the minutes: one more
  h.tx(`Bangle.emit("touch",2,{x:130,y:150,type:0})`);
  press(h);
  assert.eq(h.eval(`${BT}.getMins()`), 3, "0 h 3 min saved");
  assert.eq(h.eval("screen"), "main");
  assert.eq(h.eval(`lines(${BT}.status()).time`), "3:00");
  // start a walk with it
  h.tx("start()");
  assert.eq(h.eval(`${BT}.read().dur`), 3);
});

test("the wheels wrap round and show the total in minutes", async h => {
  h.tx(`${BT}.setMins(90)`);
  h.tx(`global.P=require("bangturn.picker").show(90,function(m){global.GOT=m})`);
  assert.eq(h.eval("[P.cols[0].v,P.cols[1].v]"), [1, 30]);
  h.tx(`global.DRAWN=[];(function(o){g.drawString=function(s){DRAWN.push(""+s);return o.apply(g,arguments)}})(g.drawString)`);
  drag(h, 40, 30, 2); // hours down two rows: 1 -> 0 -> 9
  assert.eq(h.eval("P.cols[0].v"), 9);
  assert(h.eval("DRAWN").includes("570 min"), "total in minutes: " + JSON.stringify(h.eval("DRAWN")));
  h.tx("P.finish()");
  assert.eq(h.eval("GOT"), 570);
});

test("swipe left does nothing, before or during a walk (another app uses swipes)", async h => {
  await h.load("bangturn.app.js");
  h.tx('Bangle.emit("swipe",-1,0)');
  await h.wait(100);
  assert.eq(h.eval("screen"), "main", "idle: no picker");
  assert.eq(h.eval("global.__FILE__"), "bangturn.app.js");
  h.tx(`${BT}.start()`);
  h.tx('Bangle.emit("swipe",-1,0)');
  await h.wait(100);
  assert.eq(h.eval("screen"), "main", "walk: nothing");
});

test("Settings > Apps > BangTurn: walk length opens the wheels and saves", async h => {
  h.tx(`global.MENU=null;(function(o){E.showMenu=function(m){MENU=m||null;return o.apply(E,arguments)}})(E.showMenu)`);
  captureButton(h);
  h.tx(`eval(require("Storage").read("bangturn.settings.js"))(function(){global.BACK=1})`);
  const items = h.eval(`Object.keys(MENU).filter(function(k){return k!==""})`);
  assert.eq(items, ["Length: 60 min"]);
  h.tx(`MENU["Length: 60 min"]()`);
  drag(h, 40, -15, 2); // hours up a row: 2 h
  press(h);
  assert.eq(h.eval(`${BT}.getMins()`), 120);
  assert.eq(h.eval(`Object.keys(MENU).filter(function(k){return k!==""})`), ["Length: 120 min"]);
});
