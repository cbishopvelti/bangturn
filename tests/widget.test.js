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
