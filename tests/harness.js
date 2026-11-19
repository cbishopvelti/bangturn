/* Headless Bangle.js 2 emulator harness for BangTurn.

   Needs EspruinoWebIDE and BangleApps checked out side by side in
   $BANGLE_DIR (default /opt/bangle); see tests/README.md.

   const h = await require("./harness").create();
   await h.reset();            // factory reset + install BangTurn + boot
   h.eval("1+1")              // -> 2 (JSON round trip from the watch)
   h.tx("code")               // run code, ignore the result
   await h.wait(1500)          // let real time pass with the emulator running
   await h.load()              // load() the default clock (reruns boot code)
*/
const fs = require("fs");
const path = require("path");

const BANGLE_DIR = process.env.BANGLE_DIR || "/opt/bangle";
const APPS = path.join(BANGLE_DIR, "BangleApps");
const ROOT = path.join(__dirname, "..");

function check() {
  for (const d of ["EspruinoWebIDE/emu", "BangleApps/core/lib/emulator.js"])
    if (!fs.existsSync(path.join(BANGLE_DIR, d))) {
      console.error(`Missing ${path.join(BANGLE_DIR, d)}. Run the emulator setup script (tests/README.md) or set BANGLE_DIR.`);
      process.exit(2);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Code that writes `content` to Storage file `name`, in chunks so the
   console line buffer never gets too long. */
function writeFileCmds(name, content) {
  const CHUNK = 512;
  if (!content.length) return `require("Storage").write(${JSON.stringify(name)},"");\n`;
  let out = "";
  for (let i = 0; i < content.length; i += CHUNK) {
    const part = JSON.stringify(content.substr(i, CHUNK));
    out += i == 0
      ? `require("Storage").write(${JSON.stringify(name)},${part},0,${content.length});\n`
      : `require("Storage").write(${JSON.stringify(name)},${part},${i});\n`;
  }
  return out;
}

/* Files to install: BangTurn per metadata.json, plus the latest sched lib
   from BangleApps (the firmware image bundles an older copy). */
function installFiles() {
  // Test-only boot code (runs first): the emulator has no GPS, so record who
  // asked for GPS power in GPS_USERS, e.g. GPS_USERS.bangturn == 1.
  const files = [{ name: "0test.boot.js", content:
    "(function(){var o=Bangle.setGPSPower;global.GPS_USERS={};" +
    "Bangle.setGPSPower=function(on,id){if(on)GPS_USERS[id]=1;else delete GPS_USERS[id];" +
    "return o.apply(Bangle,arguments)};})();\n" }];
  const sched = JSON.parse(fs.readFileSync(path.join(APPS, "apps/sched/metadata.json")));
  for (const s of sched.storage)
    if (["sched", "sched.boot.js", "sched.js"].includes(s.name))
      files.push({ name: s.name, content: fs.readFileSync(path.join(APPS, "apps/sched", s.url), "utf8") });
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "metadata.json")));
  for (const s of meta.storage) {
    const content = fs.readFileSync(path.join(ROOT, s.url), "utf8");
    if (/[^\x00-\x7f]/.test(content)) throw new Error(`${s.url} has non-ASCII characters`);
    files.push({ name: s.name, content, evaluate: s.evaluate });
  }
  return files;
}

async function create(opts) {
  opts = opts || {};
  check();
  const emu = require(path.join(APPS, "core/lib/emulator.js"));
  const h = { emu, log: [], errors: [] };
  let rx = ""; // raw serial output from the watch
  const init = () => emu.init({
    EMULATOR: "banglejs2",
    DEVICEID: "BANGLEJS2",
    rxCallback: c => { rx += String.fromCharCode(c); },
    consoleOutputCallback: line => {
      h.log.push(line);
      if (opts.verbose) console.log("  EMU>", line);
      if (/Uncaught\b|^ERROR:\s|ASSERT FAILED/m.test(line)) h.errors.push(line);
    }
  });

  h.tx = js => emu.tx(`\x10${js}\n`);

  /* Evaluate on the watch and return the value (via JSON, between
     \x01..\x02 markers on the serial output so long values survive). */
  h.eval = js => {
    rx = "";
    emu.tx(`\x10print("\\x01"+JSON.stringify(${js})+"\\x02")\n`);
    const m = /\x01([^]*?)\x02/.exec(rx);
    if (!m) throw new Error(`eval(${js}) failed: ${rx.trim()}`);
    if (m[1] === "undefined") return undefined;
    return JSON.parse(m[1]);
  };

  h.wait = async ms => { await sleep(ms); emu.idle(); };

  /* load() an app (default: the clock) and wait until it is running */
  h.load = async file => {
    h.tx(`global.LOADING=1;` + (file ? `load(${JSON.stringify(file)})` : "load()"));
    for (let i = 0; i < 100; i++) {
      await h.wait(20);
      if (h.eval("global.LOADING===undefined && global.__FILE__!==undefined")) break;
    }
    await h.wait(100);
  };

  const files = installFiles();
  h.reset = async () => {
    // A fresh emulator per test: restoring flash under a running emulator
    // leaves Storage's file cache stale and corrupts later writes.
    emu.stopIdle();
    await init();
    h.log.length = 0;
    h.errors.length = 0;
    // skip the first-boot welcome app
    h.tx(`require("Storage").writeJSON("welcome.json",{welcomed:true})`);
    for (const f of files) {
      if (f.evaluate) h.tx(`require("Storage").write(${JSON.stringify(f.name)},${f.content.trim()})`);
      else emu.tx("\x10" + writeFileCmds(f.name, f.content));
    }
    h.tx(`require("Storage").writeJSON("sched.json",[])`);
    // load() rebuilds .boot0 (the .js hash changed) and runs boot code, like a reboot
    await h.load();
    h.errors.length = 0;
  };

  h.close = () => emu.stopIdle();
  return h;
}

/* Tiny test runner: test(name, async h => {...}); run() */
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
assert.eq = (a, b, msg) => {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg || "not equal"}: got ${ja}, expected ${jb}`);
};
assert.near = (a, b, tol, msg) => {
  if (typeof a != "number" || Math.abs(a - b) > tol)
    throw new Error(`${msg || "not near"}: got ${a}, expected ${b} +/- ${tol}`);
};

async function run() {
  const verbose = process.argv.includes("-v");
  const only = process.argv.find(a => a.startsWith("--grep="));
  const h = await create({ verbose });
  let failed = 0, ran = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only.slice(7))) continue;
    ran++;
    try {
      await h.reset();
      await t.fn(h);
      if (h.errors.length) throw new Error("uncaught error on watch: " + h.errors.join(" | "));
      console.log(`ok   - ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL - ${t.name}\n       ${e.message}`);
      if (!verbose) console.log("       last console lines:\n" + h.log.slice(-8).map(l => "         " + l).join("\n"));
    }
  }
  h.close();
  console.log(`\n${ran - failed}/${ran} passed`);
  process.exit(failed ? 1 : 0);
}

module.exports = { create, test, assert, run, sleep };
