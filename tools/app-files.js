/* The files that make up the app in a BangleApps checkout (apps/bangturn/):
   metadata.json, ChangeLog, the icon, README, the App Loader page (interface),
   screenshots and every storage
   file. Tests, tools and docs stay in this repository.

     node tools/app-files.js <dest dir> [src dir]   copies them into dest
     require("./app-files").list(src)                the relative paths */
const fs = require("fs");
const path = require("path");

function list(src) {
  const m = JSON.parse(fs.readFileSync(path.join(src, "metadata.json"), "utf8"));
  const files = new Set(["metadata.json", "ChangeLog", m.icon, m.readme, m.interface]);
  for (const s of m.screenshots || []) files.add(s.url);
  for (const s of m.storage) if (s.url) files.add(s.url);
  return [...files].filter(f => f && fs.existsSync(path.join(src, f)));
}

function copy(src, dst) {
  for (const f of list(src)) {
    fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true });
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

module.exports = { list, copy };

if (require.main === module) {
  const [dst, src] = process.argv.slice(2);
  if (!dst) { console.error("usage: node tools/app-files.js <dest dir> [src dir]"); process.exit(2); }
  copy(path.resolve(src || path.join(__dirname, "..")), path.resolve(dst));
}
