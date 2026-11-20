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
var KM_PER_DEG = 111.195;

/* Saved as bangturn.gps.json:
   { start,          the walk this belongs to (bangturn.json's start)
     outKm, outMs,   counted distance and tracked time, start to turnaround
     backKm, backMs, the same since the turnaround
     bk,             true once a fix has been counted on the walk back
     lat, lon,       last position that distance was counted to
     pk,             km from there to the last good fix (the step in progress)
     la, lo, lt,     position and time (ms) of the last good fix
     gt,             true if lt is GPS time, false if it is the watch's clock
     rej }           jumps in a row so far */
var S;
var T0;             // effective start of the walk (ms, the watch's clock)
var DUR;            // the walk's length (ms)
var tracking = false;
var dirty = false;  // S has changed since it was saved
var saved;          // fix time of the last save

function save() {
  if (!dirty || !S) return;
  require("Storage").writeJSON(FILE, S);
  dirty = false;
}

function listen() {
  if (tracking) return;
  tracking = true;
  Bangle.setGPSPower(1, "bangturn");
  Bangle.on("GPS", onGPS);
  E.on("kill", save);
}

/* Stop tracking and turn GPS off, keeping the numbers. */
function stop() {
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
}

function onGPS(f) {
  var bt = require("bangturn");
  var el = Date.now() - T0;
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
    require("Storage").erase(FILE);
    return;
  }
  var s = require("bangturn").read();
  if (s.start === undefined) return;
  if (type == "start") {
    stop();
    begin(s, true);
  } else if (!S || S.start !== s.start) begin(s);
  else T0 = require("bangturn").startTime(s); // "-1 min" moves the turnaround
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

/* Average speeds for the UI, in kph (numbers), or null before there is a
   value: { out: kph|null, back: kph|null }.
   out: average from the start to the turnaround (frozen after it).
   back: average since the turnaround (null while still walking out).
   A half has no value until GPS has tracked it for MIN_MS. */
exports.get = function () {
  var s = exports.stats();
  return {
    out: s.outMs >= MIN_MS ? s.outKm * 3600000 / s.outMs : null,
    back: s.backMs >= MIN_MS ? s.backKm * 3600000 / s.backMs : null
  };
};

/* A speed from get() as text: "5.2 kph", or "-- kph" when it is null.
   (Not toFixed(1): Espruino's doesn't carry, so 4.96 would give "4.9".) */
exports.fmt = function (kph) {
  if (typeof kph != "number" || isNaN(kph)) return "-- kph";
  var n = Math.round(kph * 10);
  return Math.floor(n / 10) + "." + (n % 10) + " kph";
};
