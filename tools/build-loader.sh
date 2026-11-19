#!/usr/bin/env bash
# Builds a small Bangle.js App Loader that lists BangTurn and the Scheduler
# app it needs. The GitHub Pages workflow publishes the result, so the page
# always installs the latest main.
#
#   sh tools/build-loader.sh [outdir]     (default: _site)
#
# Needs git and Node 18+. Upstream BangleApps is cloned shallow and sparse,
# with only the apps listed in KEEP_APPS.
set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-_site}
case "$OUT" in /*) ;; *) OUT="$REPO_DIR/$OUT" ;; esac
UPSTREAM=${BANGLEAPPS_URL:-https://github.com/espruino/BangleApps.git}
KEEP_APPS="sched"

rm -rf "$OUT"
git clone -q --depth 1 --filter=blob:none --sparse "$UPSTREAM" "$OUT"
cd "$OUT"
sparse="/* !/apps/"
for app in $KEEP_APPS; do sparse="$sparse /apps/$app/"; done
set -f  # keep /* from being expanded by the shell
# shellcheck disable=SC2086
git sparse-checkout set --no-cone $sparse
set +f
git submodule update -q --init --depth 1

# Copy BangTurn in as apps/bangturn, with only the files its metadata uses.
mkdir -p apps/bangturn
node -e '
const fs = require("fs"), path = require("path");
const [src, dst] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(path.join(src, "metadata.json"), "utf8"));
const files = new Set(["metadata.json", "ChangeLog", m.icon, m.readme]);
for (const s of m.storage) if (s.url) files.add(s.url);
for (const f of files) {
  if (!f || !fs.existsSync(path.join(src, f))) continue;
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
' "$REPO_DIR" apps/bangturn

# apps.json is normally made by Jekyll on GitHub Pages; build it directly.
node -e '
const fs = require("fs");
const apps = fs.readdirSync("apps").sort()
  .filter(d => !d.startsWith("_example") && fs.existsSync("apps/" + d + "/metadata.json"))
  .map(d => JSON.parse(fs.readFileSync("apps/" + d + "/metadata.json", "utf8")));
fs.writeFileSync("apps.json", JSON.stringify(apps));
fs.copyFileSync("apps.json", "apps.local.json");
console.log("apps.json: " + apps.map(a => a.id + " " + a.version).join(", "));
'
: > appdates.csv

# Open straight onto BangTurn.
node -e '
const fs = require("fs");
let html = fs.readFileSync("index.html", "utf8");
html = html.replace("<title>", "<title>BangTurn - ");
html = html.replace("</head>", "<script>if(!location.search&&!location.hash)history.replaceState(null,\"\",\"?id=bangturn\");</script>\n</head>");
fs.writeFileSync("index.html", html);
'

rm -rf .git core/.git webtools/.git
touch .nojekyll
echo "Loader built in $OUT"
