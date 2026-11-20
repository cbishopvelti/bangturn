/* BangTurn speed module, installed to Storage as "bangturn.speed".
   OWNED BY: GPS speed task (together with boot.js and bangturn.gps.json).

   Tracks the distance walked with GPS in the background and gives the
   average speed of each half of the walk. bangturn.boot.js loads this
   module only while a walk is running, so it costs nothing when idle.
   The app reads the speeds with require("bangturn.speed").get().

   How distance and time are measured (docs/spec.md, "Speed"):
   - Only fixes with a position and an HDOP of HDOP_MAX or better count.
   - A fix that implies more than MAX_KPH since the last good fix is a GPS
     jump and is ignored. After MAX_REJECT jumps in a row the new position
     is taken as a fresh starting point, and the gap (its distance and its
     time) is left out.
   - Distance is added in straight steps of at least MIN_MOVE from the last
     counted position, so GPS jitter adds next to nothing, walking or
     standing. The part of a step walked so far is included in the speeds.
   - Time is the time between good fixes, taken from the GPS clock. So the
     wait for the first fix isn't counted, and neither are the minutes that
     "-1 min" adds to the walk.
   - The Out numbers stop changing at the turnaround, at the last place GPS
     saw before it. Back starts from zero there.

   The same good fixes feed two more things (docs/spec.md, "Way home"):
   - The speed right now: the distance counted over the last NOW_MS.
   - The trail home: a line of points CRUMB metres or so apart from where GPS first
     saw you (the origin) to where you are, by the shortest way along the
     path you have walked. Whenever you come within SNAP of an earlier part
     of the trail, and going straight there is at least SAVED shorter than
     the trail, the trail is cut back to that point. That one rule drops
     loops and there-and-back detours on the way out, shortens the trail as
     you retrace it on the way back (whenever you turn around), and handles
     leaving the trail on the way back: a detour adds its own points, and
     they are dropped when you rejoin the trail anywhere. The distance home
     is the length of the trail plus the straight bit from its last point to
     you.

   State is kept in RAM and saved to bangturn.gps.json when the app changes
   (the "kill" event) and at most once a minute, so a crash or hard reboot
   loses nothing but the shape of the path since the last save. */

var FILE = "bangturn.gps.json";
var HDOP_MAX = 5;     // fixes with a higher HDOP are ignored (about 25 m)
var MAX_KPH = 15;     // faster than this between two fixes is a GPS jump
var MIN_MOVE = 0.01;  // km: distance is counted in steps of at least 10 m
var MAX_REJECT = 5;   // jumps in a row before restarting from the new position
var MIN_MS = 10000;   // tracked time a half needs before it has an average
var SAVE_MS = 60000;  // save to Storage at most this often
var END_MARGIN = 1500; // after the walk's end, GPS goes off by this (ms)
var KM_PER_DEG = 111.195;
var NOW_MS = 20000;   // the speed "now" is measured over the last 20 s of fixes
var NOW_MIN = 5000;   // ...and needs at least 5 s of them
var NOW_STALE = 15000; // ...and a good fix this recently (the watch's clock)
var CRUMB = 10;       // m between the points of the trail home
var SNAP = 25;        // m: this near an earlier point of the trail is back on it
var SAVED = 12;       // m a cut must save, so a right-angle corner isn't one
var SCAN = 5;         // m to move before the trail is looked through again
var MAXC = 400;       // points kept: a longer trail is thinned to every other one

/* Saved as bangturn.gps.json:
   { start,          the walk this belongs to (bangturn.json's start)
     outKm, outMs,   counted distance and tracked time, start to turnaround
     backKm, backMs, the same since the turnaround
     bk,             true once a fix has been counted on the walk back
     lat, lon,       last position that distance was counted to
     pk,             km from there to the last good fix (the step in progress)
     la, lo, lt,     position and time (ms) of the last good fix
     gt,             true if lt is GPS time, false if it is the watch's clock
     rej,            jumps in a row so far
     oa, oo,         the origin: where the trail home starts (lat, lon)
     cd,             m between the trail's points now (CRUMB, doubled per thinning)
     tr }            the trail (only in the file): base64 of XY's bytes */
var S;
var T0;             // effective start of the walk (ms, the watch's clock)
var DUR;            // the walk's length (ms)
var tracking = false;
var dirty = false;  // S has changed since it was saved
var saved;          // fix time of the last save
var endTimer;       // fires just after the walk's end (see armEnd)
var src, srcAt;     // where the last GPS event came from ("phone"/"watch"), and when
var fixAt;          // when the last GPS event with a position came (any HDOP)
var H = [];         // recent good fixes, oldest first: fix time, km counted so far, ...
var hAt;            // when the last of them came (the watch's clock)
/* The trail home, in RAM (saved as S.tr). Points are whole metres east and
   north of the origin, so the search is integer maths on flat arrays. */
var XY;             // Int16Array: x0, y0, x1, y1, ...
var C;              // Float32Array: m along the trail from the origin to each point
var N = 0;          // points on the trail
var KX;             // m per degree of longitude at the origin
var px, py;         // where you are (the last good fix), in the trail's metres
var sx, sy;         // where the trail was last looked through from

function save() {
  if (!dirty || !S) return;
  if (N) S.tr = btoa(E.toString(new Uint8Array(XY.buffer, 0, N * 4)));
  require("Storage").writeJSON(FILE, S);
  delete S.tr;
  dirty = false;
}

function listen() {
  armEnd();
  if (tracking) return;
  tracking = true;
  Bangle.setGPSPower(1, "bangturn");
  Bangle.on("GPS", onGPS);
  E.on("kill", save);
}

/* GPS is the biggest drain on the battery, so it must go off when the walk's
   time is up even if nothing else notices: the core's "end" wake-up can be
   lost (sched missing it) and, with phone GPS or no signal, there may be no
   GPS event to notice it in onGPS. So a timer just after the end turns GPS
   off and ends the walk, unless the core already has. Re-armed when "-1 min"
   moves the end. */
function armEnd() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = setTimeout(function () {
    endTimer = undefined;
    stop();
    var bt = require("bangturn");
    if (bt.isActive() && bt.status().remaining <= 0) bt.finish();
  }, Math.max(0, T0 + DUR - Date.now()) + END_MARGIN);
}

/* Stop tracking and turn GPS off, keeping the numbers. */
function stop() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = undefined;
  if (tracking) {
    tracking = false;
    Bangle.removeListener("GPS", onGPS);
    E.removeListener("kill", save);
  }
  Bangle.setGPSPower(0, "bangturn");
  save();
}

/* km between two positions (flat-earth: exact enough over a few metres) */
function dist(lat1, lon1, lat2, lon2) {
  var dy = lat2 - lat1;
  var dx = (lon2 - lon1) * Math.cos(lat2 * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
}

/* Count the step in progress as it stands, and measure from (lat, lon). */
function closeStep(lat, lon) {
  if (S.bk) S.backKm += S.pk; else S.outKm += S.pk;
  S.pk = 0;
  S.lat = lat;
  S.lon = lon;
}

/* Take this fix as the place and time to measure from. */
function restart(f, t, gt) {
  closeStep(f.lat, f.lon);
  S.la = f.lat;
  S.lo = f.lon;
  S.lt = t;
  S.gt = gt;
  S.rej = 0;
  dirty = true;
  H = []; // the speed now starts again too
  mark(t);
  trail(f.lat, f.lon);
}

/* Note the distance counted so far at fix time t, for the speed now. Keeps
   NOW_MS of fixes (and one older, so the span is at least NOW_MS). */
function mark(t) {
  H.push(t, S.outKm + S.backKm + S.pk);
  hAt = Date.now();
  while (H.length > 4 && (t - H[2] >= NOW_MS || H.length > 80)) H.splice(0, 2);
}

/* Set the trail's points' distances along it, from point `from` on. */
function lengths(from) {
  if (!from) C[from++] = 0;
  for (var i = from, j = 2 * from; i < N; i++, j += 2) {
    var dx = XY[j] - XY[j - 2], dy = XY[j + 1] - XY[j - 1];
    C[i] = C[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
}

/* Add a point to the end of the trail. A full trail is thinned first: every
   other point goes, and from then on points are twice as far apart. */
function push(x, y) {
  if (!XY) {
    XY = new Int16Array(MAXC * 2);
    C = new Float32Array(MAXC);
  }
  if (N >= MAXC) {
    var n = 0;
    for (var i = 0; i < N; i += 2, n++) {
      XY[2 * n] = XY[2 * i];
      XY[2 * n + 1] = XY[2 * i + 1];
    }
    N = n;
    S.cd *= 2;
    lengths(0);
  }
  XY[2 * N] = x;
  XY[2 * N + 1] = y;
  N++;
  lengths(N - 1);
}

/* A good fix at (lat, lon): keep the trail home up to date (see the top of
   the file). The first one is the origin. Looking through the trail is the
   only work here that grows with the walk, so it's done once per SCAN
   metres moved, not per fix: never while standing still. */
function trail(lat, lon) {
  if (S.oa === undefined) {
    S.oa = lat;
    S.oo = lon;
    S.cd = CRUMB;
    N = 0;
    KX = undefined;
  }
  if (!KX) KX = 1000 * KM_PER_DEG * Math.cos(S.oa * Math.PI / 180);
  var x = E.clip(Math.round((lon - S.oo) * KX), -32767, 32767);
  var y = E.clip(Math.round((lat - S.oa) * 1000 * KM_PER_DEG), -32767, 32767);
  px = x;
  py = y;
  if (!N) {
    sx = x;
    sy = y;
    return push(x, y);
  }
  var dx = x - sx, dy = y - sy;
  if (dx * dx + dy * dy < SCAN * SCAN) return;
  sx = x;
  sy = y;
  dx = x - XY[2 * N - 2];
  dy = y - XY[2 * N - 1];
  var live = Math.sqrt(dx * dx + dy * dy); // from the trail's last point to here
  var end = C[N - 1] + live;               // and from the origin, along the trail
  var r = Math.max(SNAP, 0.75 * S.cd), r2 = r * r, d2;
  // the earliest point that is near, and a shorter way than the trail
  for (var i = 0, j = 0; i < N - 1; i++, j += 2) {
    dx = x - XY[j];
    dy = y - XY[j + 1];
    d2 = dx * dx + dy * dy;
    if (d2 < r2 && end - C[i] - Math.sqrt(d2) > SAVED) {
      N = i + 1;
      live = Math.sqrt(d2);
      break;
    }
  }
  if (live >= S.cd) push(x, y);
}

function onGPS(f) {
  var bt = require("bangturn");
  var el = Date.now() - T0;
  // Gadgetbridge's fixes (Android Integration, "Overwrite GPS") are marked
  // externalSource; the watch's own GPS sends an event a second, fix or not
  src = f.externalSource ? "phone" : "watch";
  srcAt = Date.now();
  if (f.fix && !isNaN(f.lat) && !isNaN(f.lon)) fixAt = srcAt;
  // The walk is over. The core's "end" follows, but never leave GPS on.
  if (el >= DUR) return stop();
  if (!f.fix || isNaN(f.lat) || isNaN(f.lon) || f.hdop > HDOP_MAX) return;
  var t = f.time ? f.time.getTime() : NaN;
  var gt = !isNaN(t);
  if (!gt) t = Date.now();
  if (saved === undefined) saved = t;
  // first fix (or the time source changed): nothing to measure from yet
  if (S.lt === undefined || S.gt != gt) return restart(f, t, gt);
  var dt = t - S.lt;
  if (dt <= 0) return;
  if (dist(S.la, S.lo, f.lat, f.lon) * 3600000 > MAX_KPH * dt) {
    // a jump: ignore it, unless GPS really has moved for good
    if (++S.rej >= MAX_REJECT) restart(f, t, gt);
    return;
  }
  if (!S.bk && el >= DUR / 2) {
    // first fix of the walk back: Out ends at the last place seen
    closeStep(S.la, S.lo);
    S.bk = true;
  }
  var km = dist(S.lat, S.lon, f.lat, f.lon);
  S.pk = km;
  if (km >= MIN_MOVE) closeStep(f.lat, f.lon);
  if (S.bk) S.backMs += dt; else S.outMs += dt;
  S.la = f.lat;
  S.lo = f.lon;
  S.lt = t;
  S.rej = 0;
  dirty = true;
  mark(t);
  trail(f.lat, f.lon);
  if (t - saved >= SAVE_MS || t < saved) {
    saved = t;
    save();
  }
}

/* Start (fresh) or pick up (after an app change or reboot) tracking for the
   walk with state `s` (bangturn.json). */
function begin(s, fresh) {
  var bt = require("bangturn");
  var f = fresh ? undefined : require("Storage").readJSON(FILE, 1);
  S = f && f.start === s.start ? f :
    { start: s.start, outKm: 0, outMs: 0, backKm: 0, backMs: 0, bk: false, pk: 0, rej: 0 };
  T0 = bt.startTime(s);
  DUR = bt.duration(s);
  dirty = false;
  saved = undefined;
  // the trail home, as it was saved; where you are is the last good fix
  H = [];
  N = 0;
  XY = C = KX = undefined;
  if (S.tr) {
    var b = atob(S.tr);
    delete S.tr;
    XY = new Int16Array(MAXC * 2);
    C = new Float32Array(MAXC);
    new Uint8Array(XY.buffer).set(E.toUint8Array(b));
    N = b.length >> 2;
    lengths(0);
    KX = 1000 * KM_PER_DEG * Math.cos(S.oa * Math.PI / 180);
    px = sx = Math.round((S.lo - S.oo) * KX);
    py = sy = Math.round((S.la - S.oa) * 1000 * KM_PER_DEG);
  } else delete S.oa; // no trail saved: it starts at the next fix
  if (Date.now() - T0 < DUR) listen();
  else stop();
}

/* Called by bangturn.boot.js when it finds a walk running. */
exports.resume = function (s) {
  begin(s || require("bangturn").read());
};

/* Called by bangturn.boot.js for each Bangle "bangturn" event. */
exports.event = function (type) {
  if (type == "end" || type == "cancel") {
    dirty = false; // nothing to keep
    stop();
    S = undefined;
    H = [];
    N = 0;
    XY = C = undefined;
    require("Storage").erase(FILE);
    return;
  }
  var s = require("bangturn").read();
  if (s.start === undefined) return;
  if (type == "start") {
    stop();
    begin(s, true);
  } else if (!S || S.start !== s.start) begin(s);
  else {
    T0 = require("bangturn").startTime(s); // "-1 min" moves the turnaround
    if (tracking) armEnd(); // and the end
  }
};

/* Distance (counted steps plus the step in progress) and tracked time of
   each half, for get() and for tests:
   { outKm, outMs, backKm, backMs, tracking }. */
exports.stats = function () {
  var r = { outKm: 0, outMs: 0, backKm: 0, backMs: 0, tracking: tracking };
  if (!S) return r;
  r.outKm = S.outKm + (S.bk ? 0 : S.pk);
  r.outMs = S.outMs;
  r.backKm = S.backKm + (S.bk ? S.pk : 0);
  r.backMs = S.backMs;
  return r;
};

/* The speed right now in kph: the distance counted between the fixes of
   the last NOW_MS (the same 10 m steps as the averages, so jitter adds next
   to nothing). null until there are NOW_MIN of fixes, and when the last good
   fix is older than NOW_STALE. */
function nowKph() {
  var n = H.length;
  if (n < 4 || Date.now() - hAt > NOW_STALE) return null;
  var dt = H[n - 2] - H[0];
  if (dt < NOW_MIN) return null;
  return Math.max(0, (H[n - 1] - H[1]) * 3600000 / dt);
}

/* km back to the origin along the trail: its length, plus the straight bit
   from its last point to the last good fix. null before the first good fix.
   The trail is only cut every SCAN metres and once a cut saves SAVED, so
   when you have just turned back and are beside its last stretch, it is the
   length to the place on that stretch nearest you, plus the step across. */
function homeKm() {
  if (!N) return null;
  var l = 2 * N - 2, dx = px - XY[l], dy = py - XY[l + 1];
  var m = C[N - 1] + Math.sqrt(dx * dx + dy * dy);
  if (N > 1) {
    var ex = XY[l] - XY[l - 2], ey = XY[l + 1] - XY[l - 1], len = C[N - 1] - C[N - 2];
    var ax = px - XY[l - 2], ay = py - XY[l - 1];
    var t = len ? (ax * ex + ay * ey) / (len * len) : 0;
    if (t < 1) {
      t = Math.max(0, t);
      ax -= t * ex;
      ay -= t * ey;
      m = Math.min(m, C[N - 2] + t * len + Math.sqrt(ax * ax + ay * ay));
    }
  }
  return m / 1000;
}

/* Speeds for the UI, in kph (numbers), or null before there is a value,
   and the way home: { out, back, now: kph|null, home: km|null }.
   out: average from the start to the turnaround (frozen after it).
   back: average since the turnaround (null while still walking out).
   A half has no value until GPS has tracked it for MIN_MS.
   now: the speed over the last NOW_MS (see nowKph).
   home: km to the origin by the trail (see homeKm). */
exports.get = function () {
  var s = exports.stats();
  return {
    out: s.outMs >= MIN_MS ? s.outKm * 3600000 / s.outMs : null,
    back: s.backMs >= MIN_MS ? s.backKm * 3600000 / s.backMs : null,
    now: nowKph(),
    home: homeKm()
  };
};

/* The trail home for tests and debugging: { n: points, m: its length in
   metres (without the bit to where you are), cd: m between points }. */
exports.trail = function () {
  return { n: N, m: N ? C[N - 1] : 0, cd: S ? S.cd : CRUMB };
};

/* A speed from get() as text: "5.2 kph", or "-- kph" when it is null.
   (Not toFixed(1): Espruino's doesn't carry, so 4.96 would give "4.9".) */
exports.fmt = function (kph) {
  if (typeof kph != "number" || isNaN(kph)) return "-- kph";
  var n = Math.round(kph * 10);
  return Math.floor(n / 10) + "." + (n % 10) + " kph";
};

/* Where GPS is coming from, for the walk menu's Info, so you can check on
   the watch that the phone is supplying it:
   { from: "phone"|"watch"|null (no GPS event in the last SRC_MS),
     chip: true while the watch's own GPS chip is powered,
     fixAge: ms since the last GPS event with a position, or null if none
       this walk (since the app loaded) }.
   chip asks the firmware (Bangle.getGPSFix() is undefined when the chip is
   off), not Bangle.isGPSOn(), which Android Integration replaces with
   "has any app asked for GPS" when it overwrites GPS. */
var SRC_MS = 30000;
exports.source = function () {
  var fresh = srcAt !== undefined && Date.now() - srcAt < SRC_MS;
  return { from: fresh ? src : null, chip: Bangle.getGPSFix() !== undefined,
    fixAge: fixAt === undefined ? null : Date.now() - fixAt };
};
