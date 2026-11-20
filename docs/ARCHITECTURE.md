# BangTurn architecture

How the app is split up, and the interfaces between the parts, so the UI,
alerts, GPS speed and widget work can go ahead in parallel without
colliding. The behaviour itself is in [spec.md](spec.md).

## Files and owners

| Repo file | Installed as | What it is | Owner |
|---|---|---|---|
| `lib.js` | `bangturn` (module) | Core: walk state, timing, `sched` entries | core |
| `app.js` | `bangturn.app.js` | Screens and menu | UI |
| `app-icon.js`, `app.png` | `bangturn.img` | Icon | UI |
| `alerts.js` | `bangturn.alerts` (module) | Start buzz, turnaround alarm, countdown buzzes | alerts |
| `boot.js` | `bangturn.boot.js` | Starts the speed module when a walk is running; ends a walk whose hour ran out while the watch was off | GPS speed |
| `speed.js` | `bangturn.speed` (module) | GPS power, distance tracking in the background, average speeds for the UI | GPS speed |
| `widget.js` | `bangturn.wid.js` | Minutes-left widget | widget |
| `picker.js` | `bangturn.picker` (module) | Hours/minutes scroll wheel picker for the walk length: `show(mins, done)` | UI |
| `settings.js` | `bangturn.settings.js` | Settings > Apps > BangTurn: "Length: N min" opens the picker | UI |
| `metadata.json`, `tests/harness.js`, `tests/run.js`, `tools/install.js` | | App loader metadata, test harness, Web IDE installer | core (add your storage entries and tests freely) |

Each task owns its files. Stubs are in place and already work end to end
(a plain countdown, simple buzzes, GPS on/off, a minutes widget), so every
task can replace its own file without waiting for the others. If you need
something from another part, add it to this document in your PR rather
than editing that part's file.

Data files:

| File | Contents | Written by |
|---|---|---|
| `bangturn.json` | Walk state (below) | `lib.js` only |
| `bangturn.gps.json` | `{start, outKm, outMs, backKm, backMs, ...}`: distance and GPS time for each half, plus where tracking had got to, and the trail home (`oa`, `oo`, `cd`, `tr`) | `speed.js` only |
| `sched.json` | Six entries with ids `bangturn.*` | `lib.js` only, through the `sched` module |

## Walk state: `bangturn.json`

`{}` when idle. During a walk:

```js
{
  start: 1763580000000, // ms epoch when Start was pressed
  offset: 0,            // number of "-1 min" taps
  turned: false,        // turnaround has passed (alarm fired, or skipped by -1 min)
  alert: "turn"         // only while a turnaround alert waits for the app to show it
}
```

The **effective start** is `start - offset * 60000`. Every time is measured
from it. Read state through the module, not the file.

## Core module: `require("bangturn")`

Walk length: `getMins()` / `setMins(m)` read and save the setting
(`bangturn.settings.json`, `{mins}`, default 60, 1 to 599; `setMins` emits
`"settings"`). `start()` copies it into the walk as `dur` (minutes), so a
change only affects the next walk. `duration(s)` is the walk's length in ms
(the setting's when idle; 60 min for a walk saved without `dur`), and
`events(dur)` its `[id, ms after start]` pairs: the countdown buzzes only
when they come after the turnaround. Use `status().duration` and
`status().turn`, not the constants, which are only the default hour:
`DURATION` (3600000), `TURN`, `EVENTS` (the hour's), `BUZZES`
(`{left15:1, left8:2, left4:3, left1:4}`).

| Function | Does |
|---|---|
| `status(now?)` | `{active, phase, duration, turn, elapsed, remaining, toTurn, offset, turned, start}`. `phase` is `"idle"`, `"out"` or `"back"`. Times are ms, never negative. Use this for all drawing. |
| `fmt(ms)` | `"60:00"` (m:ss, no hours, rounds up to the second) |
| `mins(ms)` / `untilMins(ms)` | The minutes of `fmt(ms)` (`47` for `47:30`, rounded down), used by the widget and the locked app; and ms until they change |
| `isActive()` | A walk is running |
| `read()` | The raw state object |
| `start()` | Starts a walk now, writes the six `sched` entries. Doesn't buzz: the app calls `alerts.started()`. |
| `minusOne()` | Moves the start 1 minute earlier and reschedules, skipping past events. Past the turnaround: no alarm, `turned` set, phase becomes `"back"`. Past the end: the walk finishes. Returns the new `status()`. |
| `cancel()` | Clears all BangTurn `sched` entries and the state |
| `finish()` | Ends the walk silently (used at the end, and by `minusOne`) |
| `catchUp(now?)` | Boot code calls it during a walk. `sched` only fires entries dated today, so entries missed while the watch was off across midnight (dated yesterday) are moved to now, a second apart in walk order, and `fire()` handles them as late |
| `takeAlert()` | Returns the pending alert (`"turn"`) and clears it, or `undefined` |
| `fire(id)` | Called by `sched`; see below. Not for other parts to call. |
| `schedule()`, `clearSched()`, `getSched()` | Rewrite, clear and list our `sched` entries (used internally and by tests) |

`status`, `minusOne` and `start` take an optional time argument for tests.

### Events

The module emits `Bangle.emit("bangturn", type)` after each change, so
anything loaded at the time (the app, the widget, the boot code) can react:

| type | When |
|---|---|
| `"start"` | Walk started |
| `"offset"` | `-1 min` applied (the walk is still running) |
| `"turn"` | Turnaround reached (right before the app is loaded) |
| `"buzz"` | A countdown buzz fired |
| `"end"` | Walk reached zero, or `-1 min` pushed it past zero |
| `"cancel"` | Walk cancelled |

Listen with `Bangle.on("bangturn", function(type) {...})`. On `"end"` and
`"cancel"` the state is already `{}`.

## Background timing: `sched` entries

On start (and after every `-1 min`) the core writes one plain `sched` alarm
per future event, at an absolute local time and date:

Times below are for the default hour; for other lengths they are half the walk and 15/8/4/1 min before the end.

| id | When (after the effective start) | `fire()` does |
|---|---|---|
| `bangturn.turn` | 30 min | Sets `turned` and `alert:"turn"`, emits `"turn"`, then `load("bangturn.app.js")` |
| `bangturn.left15` | 45 min | Emits `"buzz"`, calls `alerts.countdown(1)` in whatever app is open |
| `bangturn.left8` | 52 min | `alerts.countdown(2)` |
| `bangturn.left4` | 56 min | `alerts.countdown(3)` |
| `bangturn.left1` | 59 min | `alerts.countdown(4)` |
| `bangturn.end` | 60 min | `finish()`: clears everything, emits `"end"`, no buzz |

Entries have `appid:"bangturn"`, `hidden:true` (not shown in the Alarms
app) and `js:'require("bangturn").fire("<id>")'`. `fire()` removes the
entry that fired and re-arms `sched`. Because the state and entries are in
Storage, a reboot or leaving the app loses nothing: `sched`'s boot code
re-arms the next entry. Other apps' alarms are never touched.

If the watch was off (or flat) when entries were due, `sched` fires the
earliest overdue one about a second after boot, and `fire()` reschedules,
dropping the rest that have passed. So after a reboot:

- a missed turnaround still shows its alarm, late;
- a countdown buzz more than a minute late is skipped (its count of
  minutes left would be wrong);
- once the walk's hour is up, any entry (or `bangturn.boot.js`, if no
  entry is left for today) finishes the walk silently, rather than leaving
  it at `0:00:00`.

## Startup alert hook (UI and alerts)

The turnaround alarm opens the app. The app **must** start like this (it
already does in the stub):

```js
if (bt.takeAlert() == "turn") alerts.turnaround(showMain); // alarm, then the countdown
else showMain();
```

## Alerts module: `require("bangturn.alerts")`

| Function | Called by | Must |
|---|---|---|
| `started()` | app, after `bt.start()` | One short buzz (~100 ms) |
| `turnaround(done)` | app at startup (hook above) | Full-screen "TURN AROUND" (inverted), screen lit, 600 ms on / 200 ms off full-strength buzzes. Stops on a tap, a button press or after 6 s (not on unlock, which the buzz itself can cause), then clears the screen, redraws widgets and calls `done()` once. Returns a function that stops it early. |
| `countdown(n)` | core `fire()` | `n` short buzzes (200 ms on, 300 ms off). Runs inside any app: no drawing, no `load()` |

All alerts buzz at full strength and in Quiet Mode: they call `Bangle.buzz`
directly and never read the `quiet` setting. While the turnaround alarm
shows, it owns the UI (`Bangle.setUI` custom, plus a one-shot `BTN1`
watch); the app sets its own UI again in `done()`.
Buzzing can read as a twist or tap on the accelerometer, which unlocks a
Bangle.js 2. The user's wake-up settings are left alone, so instead a
countdown re-locks a watch that was locked if it unlocks while buzzing (or
within 500 ms after), and the turnaround alarm doesn't stop on an unlock:
only a button press, a tap or the 6 s timeout stop it. Timings are in
`require("bangturn.alerts").T`.

## Speed: `bangturn.boot.js` and `require("bangturn.speed")`

`boot.js` runs on every app load, so it is tiny. When no walk is running it
reads `bangturn.json` and does nothing else (no module is loaded). During a
walk it calls `require("bangturn.speed").resume(state)` (or, if the walk's
hour ran out while the watch was off, `require("bangturn").finish()`), and it passes every
`"bangturn"` event to `require("bangturn.speed").event(type)`. Everything
else is in the speed module, which the app shares, so the app always sees
the live numbers.

For the UI:

| Function | Does |
|---|---|
| `get()` | `{out, back, now, home}`. `out`, `back`: average kph (numbers), or `null` where there's no value yet. `out` freezes at the turnaround; `back` is `null` until then. A half has no value until GPS has tracked it for 10 s. `now`: kph over the last 20 s of fixes, `null` with under 5 s of them or no good fix for 15 s. `home`: km to the origin along the trail, `null` before the first good fix. |
| `fmt(kph)` | `"5.2 kph"`, or `"-- kph"` for `null`. Use this rather than `toFixed(1)`, which doesn't carry in Espruino (`4.96` gives `"4.9"`). |
| `stats()` | `{outKm, outMs, backKm, backMs, tracking}`: the distance and tracked time behind the speeds (for tests and debugging) |
| `trail()` | `{n, m, cd}`: points on the trail home, its length in metres, and the metres between points (for tests and debugging) |

The app's `lines()` turns `v = speed.get()` into the rows: Out and (on the
walk back) Back, each with its average and the time to the origin at that
speed (`v.home / speed`), and a bottom row with `v.now` and the speed needed
(`v.home / status().remaining`). `drawRows()` draws them in columns.
Calling `get()` every second is fine: it only reads RAM.

How it tracks:

- GPS power is `Bangle.setGPSPower(1, "bangturn")` from the `"start"` event
  (or from boot, if a walk is running) until `"end"` or `"cancel"`. As a
  safety net it also turns GPS off by itself once the walk's time is up: at
  the next GPS event, and in any case 1.5 s after the end by its own timer,
  which also ends the walk if the core's `"end"` wake-up never came (with
  phone GPS or no signal there may be no GPS events at all). Boot doesn't
  turn it on for a walk whose time has passed. The widget and the app also
  end such a walk instead of redrawing a 0 every second.
- A fix counts if it has a position and an HDOP of 5 or better. A fix that
  implies more than 15 kph since the last good one is a jump and is ignored;
  after 5 jumps in a row tracking restarts from the new position, leaving
  out the gap.
- Distance is added in straight steps of at least 10 m, so jitter adds next
  to nothing. Time is the time between good fixes by the GPS clock
  (`fix.time`), so neither the wait for the first fix nor `-1 min` changes
  the average. A gap with no fixes is bridged in a straight line.
- The speed now is the distance counted (the same 10 m steps, plus the step
  in progress) between the good fixes of the last 20 s, kept in a short list
  in RAM. It starts again after an app change.
- The trail home is a line of points about 10 m apart, from the origin (the
  first good fix) to where you are, kept as whole metres east and north of
  the origin in an `Int16Array` (400 points; a longer trail is thinned to
  every other point, and points are then twice as far apart). Every 5 m
  moved, the trail is looked through for the earliest point within 25 m
  that is at least 12 m shorter to go straight to than to follow the trail
  to: the trail is cut back to it. That one rule drops loops and detours on
  the way out, shortens the trail as it is retraced, and forgets a detour on
  the way back when it rejoins the trail. 12 m is more than any right-angle
  corner saves within 25 m, so corners stay. `get().home` is the trail's
  length plus the straight bit from its last point to the last good fix
  (or, just after turning back, the length to the nearest place on the
  trail's last stretch). The trail is saved with the rest of the state, as
  base64 in `tr`.
- Which half a fix belongs to follows the core's clock: `back` once
  `Date.now()` is `TURN` past the effective start. `-1 min` can move that,
  and the `"offset"` event tells the module.
- The state lives in RAM. It is saved to `bangturn.gps.json` on the `"kill"`
  event (every app change) and at most once a minute, and read back by
  `resume()`. A crash or hard reboot carries on from the last save. The file
  is tagged with the walk's `start` and erased on `"end"` and `"cancel"`.

## Widget: `bangturn.wid.js`

`WIDGETS.bangturn`, width 0 when idle. Reads `require("bangturn").status()`
and redraws on `"bangturn"` events and once a minute. Use the core module
rather than reading files directly where you can, but keep the widget light
since it loads in every app. The BangTurn app calls `WIDGETS.bangturn.hide()`
after loading widgets: width 0 and no timer for the rest of that app, since
the app shows the countdown itself.

## Tests

`npm test` runs every `tests/*.test.js` in a headless Bangle.js 2 emulator
(set up with `tests/setup-emulator.sh`, see [tests/README.md](../tests/README.md)).
Each test gets a fresh emulator with the app installed and boot code run.
Add your own `tests/<area>.test.js` rather than editing `core.test.js`.
`tests/walk.test.js` runs whole walks through every part together (start,
alarm, buzzes, end, -1 min, cancel, reboots), and `tests/install.test.js`
checks `metadata.json` and the Web IDE installer.

`tools/install.js` turns `metadata.json` into the code that writes the files
to Storage (plus the `bangturn.info` launcher entry the App Loader would
write). The harness installs the app with it, and `npm run bundle` saves it
as `dist/bangturn-install.js` for the Web IDE.
Keep all source ASCII (the harness rejects anything else), so write `-1 min`
with a plain hyphen.
