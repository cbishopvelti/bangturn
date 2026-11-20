/* Install tests: metadata.json for the App Loader, and the Web IDE
   installer (npm run bundle). Run: node tests/run.js tests/install.test.js */
const fs = require("fs");
const path = require("path");
const { test, assert } = require("./harness");
const installer = require("../tools/install");

const ROOT = path.join(__dirname, "..");
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "metadata.json")));

test("metadata.json: fields the App Loader needs, files, version", async () => {
  for (const k of ["id", "name", "shortName", "version", "description", "icon", "type", "tags", "supports", "readme", "author", "storage"])
    assert(meta[k] !== undefined, `metadata.json has ${k}`);
  assert.eq(meta.supports, ["BANGLEJS2"]);
  assert.eq(meta.dependencies, { scheduler: "type" }, "needs a Scheduler app");
  // every file is there, named after the app, and the app's sources are all listed
  for (const s of meta.storage) {
    assert(fs.existsSync(path.join(ROOT, s.url)), `${s.url} exists`);
    assert(s.name == meta.id || s.name.startsWith(meta.id + "."), `${s.name} starts with the app id`);
  }
  const listed = meta.storage.map(s => s.url);
  for (const f of ["app.js", "app-icon.js", "lib.js", "alerts.js", "speed.js", "boot.js", "widget.js", "picker.js", "settings.js"])
    assert(listed.includes(f), `${f} is installed`);
  assert(fs.existsSync(path.join(ROOT, meta.readme)), "README exists");
  // the data files are the ones the code writes
  assert.eq(meta.data.map(d => d.name).sort(), ["bangturn.gps.json", "bangturn.json", "bangturn.settings.json"]);
  assert(/"bangturn\.json"/.test(fs.readFileSync(path.join(ROOT, "lib.js"), "utf8")));
  assert(/"bangturn\.gps\.json"/.test(fs.readFileSync(path.join(ROOT, "speed.js"), "utf8")));
  // the App Loader shows the last ChangeLog entry as the version's notes
  const log = fs.readFileSync(path.join(ROOT, "ChangeLog"), "utf8").trim().split("\n");
  assert(log[log.length - 1].startsWith(meta.version + ":"), "ChangeLog ends with " + meta.version);
  // a 48x48 PNG icon
  const png = fs.readFileSync(path.join(ROOT, meta.icon));
  assert.eq(png.toString("latin1", 1, 4), "PNG");
  assert.eq([png.readUInt32BE(16), png.readUInt32BE(20)], [48, 48], "icon size");
});

test("installed like the App Loader: launcher entry, icon, files", async h => {
  // the harness installs with tools/install.js, so this is the Web IDE path too
  const info = h.eval('require("Storage").readJSON("bangturn.info",1)');
  assert.eq([info.id, info.name, info.src, info.icon], ["bangturn", "BangTurn", "bangturn.app.js", "bangturn.img"]);
  for (const f of info.files.split(","))
    assert(h.eval(`require("Storage").read(${JSON.stringify(f)})!==undefined`), `${f} on the watch`);
  assert.eq(h.eval('g.imageMetrics(require("Storage").read("bangturn.img"))').width, 48, "icon is a 48 px image");
  // the launcher lists it
  const apps = h.eval('require("Storage").list(/\\.info$/).map(function(f){return require("Storage").readJSON(f,1)}).filter(function(a){return a&&a.type!="clock"}).map(function(a){return a.id})');
  assert(apps.includes("bangturn"), "launcher sees BangTurn: " + apps);
});

test("the Web IDE installer replaces an old install and opens cleanly", async h => {
  // an older copy on the watch, as if from a previous upload
  h.tx('require("Storage").write("bangturn.app.js","OLD");require("Storage").erase("bangturn.info")');
  const code = installer.bundle();
  assert(!/[^\x00-\x7f]/.test(code), "ASCII only");
  assert(code.split("\n").every(l => l.length < 1200), "short lines for the Web IDE");
  for (const l of code.split("\n")) if (l && !l.startsWith("//")) h.tx(l);
  await h.wait(1500); // it reloads after 500 ms
  const f = installer.appFiles().find(f => f.name == "bangturn.app.js");
  assert.eq(h.eval('require("Storage").read("bangturn.app.js")'), f.content, "new app.js");
  assert(h.eval('require("Storage").readJSON("bangturn.info",1).version') == meta.version, "launcher entry");
  await h.load("bangturn.app.js");
  assert.eq(h.eval('lines(require("bangturn").status()).time'), "60:00", "app runs");
});
