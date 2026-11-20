/* Widget tests. Run: node tests/run.js tests/widget.test.js -v */
const { test, assert } = require("./harness");
const MIN = 60000;
const BT = 'require("bangturn")';

function setup(h) {
  h.tx('Bangle.loadWidgets();Bangle.drawWidgets()');
}
const width = h => h.eval("WIDGETS.bangturn.width");
const timers = h => h.eval('Object.keys(global["\\xff"].timers||{}).length');

test("idle: width 0, no timer added", async h => {
  const before = timers(h);
  setup(h);
  assert(h.eval("!!WIDGETS.bangturn"), "widget loaded");
  assert.eq(width(h), 0);
  assert.eq(timers(h) - before, 0, "no new timers when idle");
});

test("appears on start, shows minutes left, hides on cancel", async h => {
  setup(h);
  h.tx(`${BT}.start(Date.now()-10*${MIN}-1000)`);
  assert.eq(width(h), 28);
  h.tx(`global.DR=[];var _d=g.drawString;g.drawString=function(s){DR.push(s);return _d.apply(g,arguments)};WIDGETS.bangturn.draw()`);
  assert.eq(h.eval("DR[DR.length-1]"), 49, "49:59 left: rounded down like the countdown");
  h.tx(`${BT}.cancel()`);
  assert.eq(width(h), 0);
});

test("shows on load when a walk is already running, hides at end", async h => {
  h.tx(`${BT}.start(Date.now()-59*${MIN}-58500)`);
  setup(h);
  assert.eq(width(h), 28);
  await h.wait(3000); // end event fires
  assert.eq(h.eval(`${BT}.isActive()`), false);
  assert.eq(width(h), 0);
});

test("minute tick redraws when the number changes", async h => {
  h.tx(`${BT}.start(Date.now()-20*${MIN}-59800)`); // 39:00.2 left: 39 -> 38 in ~1.2 s
  setup(h);
  h.tx(`global.DR=[];var _d=g.drawString;g.drawString=function(s){DR.push(s);return _d.apply(g,arguments)}`);
  h.tx("WIDGETS.bangturn.draw()");
  assert.eq(h.eval("DR[DR.length-1]"), 39);
  await h.wait(1800);
  assert.eq(h.eval("DR[DR.length-1]"), 38, "changes with the countdown's 39:00 -> 38:59");
});

test("-1 min updates the number", async h => {
  setup(h);
  h.tx(`${BT}.start(Date.now()-5*${MIN}-1000)`);
  h.tx(`global.DR=[];var _d=g.drawString;g.drawString=function(s){DR.push(s);return _d.apply(g,arguments)}`);
  h.tx(`${BT}.minusOne()`);
  assert.eq(h.eval("DR[DR.length-1]"), 53, "53:59 left");
});

test("sits to the left of the battery", async h => {
  h.tx(`${BT}.start(Date.now()-5*${MIN})`);
  setup(h);
  const x = h.eval("[WIDGETS.bangturn.x,WIDGETS.bat&&WIDGETS.bat.x]");
  assert(x[1] !== null, "battery widget present");
  assert(x[0] < x[1], "bangturn x " + x[0] + " < battery x " + x[1]);
});

/* tap on the number opens BangTurn (clock face only) */
const centre = h => h.eval("[WIDGETS.bangturn.x+14,WIDGETS.bangturn.y+12]");
const tap = (h, x, y) => h.tx(`global.LOADING=1;Bangle.emit("touch",1,{x:${x},y:${y},type:0})`);
async function settle(h) {
  for (let i = 0; i < 30; i++) {
    await h.wait(100);
    if (h.eval("global.LOADING===undefined && global.__FILE__!==undefined")) return;
  }
}

test("tap on the number on the clock opens BangTurn", async h => {
  h.tx(`${BT}.start(Date.now()-5*${MIN})`);
  await h.load();
  const clock = h.eval("global.__FILE__");
  assert(clock != "bangturn.app.js", "on the clock: " + clock);
  const [x, y] = centre(h);
  tap(h, x, y);
  await settle(h);
  assert.eq(h.eval("global.__FILE__"), "bangturn.app.js");
});

test("tap just outside the box (edge of target) still opens, further away doesn't", async h => {
  h.tx(`${BT}.start(Date.now()-5*${MIN})`);
  await h.load();
  const clock = h.eval("global.__FILE__");
  const [x0, y0] = h.eval("[WIDGETS.bangturn.x,WIDGETS.bangturn.y]");
  tap(h, x0 - 10, y0 + 12); // over the neighbour on the left
  await h.wait(600);
  tap(h, x0 + 14, y0 + 60); // in the clock
  await h.wait(600);
  assert.eq(h.eval("global.__FILE__"), clock, "taps away from the number ignored");
  tap(h, x0 - 3, y0 + 33);
  await settle(h);
  assert.eq(h.eval("global.__FILE__"), "bangturn.app.js");
});

test("tap does nothing when idle", async h => {
  await h.load();
  const clock = h.eval("global.__FILE__");
  h.tx(`global.LOADING=1;Bangle.emit("touch",1,{x:${176 - 40},y:12,type:0})`);
  await h.wait(800);
  assert.eq(h.eval("global.__FILE__"), clock);
});

test("tap at the widget's spot inside BangTurn doesn't reload it", async h => {
  h.tx(`${BT}.start(Date.now()-5*${MIN})`);
  await h.load("bangturn.app.js");
  assert.eq(width(h), 0, "hidden in the app");
  h.tx("global.MARK=1");
  h.tx(`Bangle.emit("touch",1,{x:${176 - 40},y:12,type:0})`);
  await h.wait(800);
  assert.eq(h.eval("global.MARK"), 1, "no reload");
});
