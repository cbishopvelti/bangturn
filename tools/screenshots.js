/* Takes the app store screenshots in the headless emulator (see
   tests/README.md for its setup) and writes them to screenshots/.

     node tools/screenshots.js          (or: npm run screenshots)

   The emulator has no GPS, so the walk screens use a stand-in speed module
   with fixed speeds, from the phone. */
const fs = require("fs");
const path = require("path");
const { create } = require("../tests/harness");
const png = require("./png");

const OUT = path.join(__dirname, "..", "screenshots");
const MIN = 60000;
const BT = 'require("bangturn")';

const FAKE_SPEED = "exports.resume=exports.event=function(){};" +
  "exports.get=function(){return global.SP||{out:null,back:null}};" +
  "exports.source=function(){return {from:'phone',chip:false,fixAge:2000}};";

async function main() {
  const h = await create();
  const shot = name => {
    const px = h.emu.getScreenshot();
    for (let i = 0; i < px.length; i++) px[i] |= 0xff000000; // opaque
    fs.writeFileSync(path.join(OUT, name), png(new Uint8Array(px.buffer), 176, 176));
    console.log("screenshots/" + name);
  };
  const fresh = async () => {
    await h.reset();
    h.tx(`require("Storage").write("bangturn.speed",${JSON.stringify(FAKE_SPEED)})`);
  };
  const unlock = () => h.tx('Bangle.setLocked(false);Bangle.emit("lock",false)');
  fs.mkdirSync(OUT, { recursive: true });

  // The start screen
  await fresh();
  await h.load("bangturn.app.js");
  unlock();
  await h.wait(1200);
  shot("1-start.png");

  // Walking out, 12 minutes in
  await fresh();
  h.tx(`${BT}.start(${h.eval("Date.now()") - 12 * MIN - 20000})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.3,back:null,now:5.5,home:1.0}");
  unlock();
  await h.wait(1200);
  shot("2-walking-out.png");

  // The turnaround alarm
  await fresh();
  h.tx(`${BT}.start(${h.eval("Date.now()") - 30 * MIN + 1500})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.3,back:null,now:5.2,home:2.6}");
  await h.wait(3000);
  shot("3-turn-around.png");
  h.tx("Bangle.buzz=function(){return Promise.resolve()}");
  await h.wait(8000);

  // Walking back, 42 minutes in
  await fresh();
  h.tx(`${BT}.start(${h.eval("Date.now()") - 42 * MIN - 25000})`);
  await h.load("bangturn.app.js");
  h.tx("global.SP={out:5.3,back:5.0,now:5.1,home:1.5}");
  unlock();
  await h.wait(1200);
  shot("4-walking-back.png");

  // The button menu during a walk
  h.tx(`global.WATCHES=[];(function(o){global.setWatch=function(cb,pin,opt){WATCHES.push(cb);return o.apply(this,arguments)}})(setWatch)`);
  h.tx("showMain()");
  h.tx("WATCHES[WATCHES.length-1]({state:false,time:getTime(),lastTime:getTime()-0.1})");
  await h.wait(600);
  shot("5-walk-menu.png");

  if (h.errors.length) throw new Error(h.errors.join(" | "));
  h.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
