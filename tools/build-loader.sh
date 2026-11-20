#!/usr/bin/env bash
# Builds a small Bangle.js App Loader that lists BangTurn and the Scheduler
# app it needs. The GitHub Pages workflow publishes the result, so the page
# always installs the latest main.
#
#   sh tools/build-loader.sh [outdir]     (default: _site)
#
# Needs git and Node 18+. Upstream BangleApps is cloned shallow and sparse,
# with only the apps listed in KEEP_APPS.
#
# tools/build-previews.sh also uses it to build one loader per open pull
# request, with these optional settings:
#   BANGTURN_SRC      folder to take BangTurn's files from (default: this repo)
#   BANGTURN_VERSION  full version to publish (default: 0.01.<commit count>)
#   BANGTURN_PR       PR number: adds a "preview of PR #N" banner and label
#   BANGTURN_PR_URL, BANGTURN_PR_BRANCH  shown in that banner
#   LOADER_FROM       an already built loader to copy instead of cloning
set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-_site}
case "$OUT" in /*) ;; *) OUT="$REPO_DIR/$OUT" ;; esac
UPSTREAM=${BANGLEAPPS_URL:-https://github.com/espruino/BangleApps.git}
KEEP_APPS="sched"

SRC=${BANGTURN_SRC:-$REPO_DIR}
case "$SRC" in /*) ;; *) SRC="$(pwd)/$SRC" ;; esac

rm -rf "$OUT"
if [ -n "${LOADER_FROM:-}" ]; then
  # Reuse a loader built earlier (main's), leaving out its BangTurn and any
  # previews nested inside it.
  mkdir -p "$OUT"
  (cd "$LOADER_FROM" && tar -cf - --exclude=./apps/bangturn --exclude='./pr-*' .) | (cd "$OUT" && tar -xf -)
  cd "$OUT"
else
  git clone -q --depth 1 --filter=blob:none --sparse "$UPSTREAM" "$OUT"
  cd "$OUT"
  sparse="/* !/apps/"
  for app in $KEEP_APPS; do sparse="$sparse /apps/$app/"; done
  set -f  # keep /* from being expanded by the shell
  # shellcheck disable=SC2086
  git sparse-checkout set --no-cone $sparse
  set +f
  git submodule update -q --init --depth 1
  cp index.html index.upstream.html
fi

# Build number: commits on the checked-out branch, so it goes up every time
# main changes. It becomes the third part of the version (0.01 -> 0.01.42),
# which the App Loader compares numerically and offers as an update. Needs
# full history (fetch-depth: 0 in the workflow); without git it's left off.
BUILD=${BANGTURN_BUILD:-$(git -C "$REPO_DIR" rev-list --count HEAD 2>/dev/null || true)}

# Copy BangTurn in as apps/bangturn, with only the files its metadata uses.
mkdir -p apps/bangturn
node -e '
const fs = require("fs"), path = require("path");
const [src, dst, build] = process.argv.slice(1);
const env = process.env;
const m = JSON.parse(fs.readFileSync(path.join(src, "metadata.json"), "utf8"));
const files = new Set(["metadata.json", "ChangeLog", m.icon, m.readme]);
for (const s of m.storage) if (s.url) files.add(s.url);
for (const f of files) {
  if (!f || !fs.existsSync(path.join(src, f))) continue;
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
if (env.BANGTURN_VERSION) m.version = env.BANGTURN_VERSION;
else if (/^[0-9]+$/.test(build || "")) m.version = m.version + "." + build;
if (env.BANGTURN_PR) m.description = "Preview of PR #" + env.BANGTURN_PR + ", not merged yet. " + m.description;
fs.writeFileSync(path.join(dst, "metadata.json"), JSON.stringify(m, null, 2) + "\n");
console.log("bangturn version " + m.version);
' "$SRC" apps/bangturn "$BUILD"

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

# Name the page after BangTurn. It lists both apps (BangTurn and the
# Scheduler it needs), so the Library count matches what's shown. A PR
# preview also gets a banner saying which PR and version it installs.
# index.upstream.html is kept so preview builds start from the untouched page.
node -e '
const fs = require("fs"), env = process.env;
const esc = s => String(s).replace(/[&<>"\x27]/g, c => "&#" + c.charCodeAt(0) + ";");
let html = fs.readFileSync("index.upstream.html", "utf8");
const version = JSON.parse(fs.readFileSync("apps/bangturn/metadata.json", "utf8")).version;
if (env.BANGTURN_PR) {
  const pr = esc(env.BANGTURN_PR);
  html = html.replace("<title>", "<title>BangTurn PR #" + pr + " - ");
  const link = env.BANGTURN_PR_URL ? "<a href=\"" + esc(env.BANGTURN_PR_URL) + "\">PR #" + pr + "</a>" : "PR #" + pr;
  const branch = env.BANGTURN_PR_BRANCH ? " (branch " + esc(env.BANGTURN_PR_BRANCH) + ")" : "";
  const banner = "<div id=\"bangturn-preview\" style=\"background:#ffd54f;color:#000;padding:8px 12px;" +
    "font:15px sans-serif;text-align:center\">Preview of " + link + branch + ", not merged yet. " +
    "BangTurn version " + esc(version) + ". <a href=\"../\">Main install page</a></div>";
  html = html.replace(/<body[^>]*>/, m => m + "\n" + banner);
} else {
  html = html.replace("<title>", "<title>BangTurn - ");
}
fs.writeFileSync("index.html", html);
'

rm -rf .git core/.git webtools/.git
touch .nojekyll
echo "Loader built in $OUT"
