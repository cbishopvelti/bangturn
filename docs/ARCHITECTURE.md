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
| `bangturn.gps.json` | `{start, outKm, outMs, backKm, backMs, ...}`: distance and GPS time for each half, plus where tracking had got to | `speed.js` only |
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

Constants: `DURATION` (3600000, the only place the walk length lives),
`TURN` (`DURATION/2`), `EVENTS` (`[id, ms after start]` pairs), `BUZZES`
(`{left15:1, left8:2, left4:3, left1:4}`).

| Function | Does |
|---|---|
| `status(now?)` | `{active, phase, elapsed, remaining, toTurn, offset, turned, start}`. `phase` is `"idle"`, `"out"` or `"back"`. Times are ms, never negative. Use this for all drawing. |
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
| `turnaround(done)` | app at startup (hook above) | Full-screen "TURN AROUND" (inverted), screen lit, 600 ms on / 200 ms off full-strength buzzes. Stops on unlock (`lock` event with `false`), a tap, a button press or after 6 s, then clears the screen, redraws widgets and calls `done()` once. Returns a function that stops it early. |
| `countdown(n)` | core `fire()` | `n` short buzzes (200 ms on, 300 ms off). Runs inside any app: no drawing, no `load()` |

All alerts buzz at full strength and in Quiet Mode: they call `Bangle.buzz`
directly and never read the `quiet` setting. While the turnaround alarm
shows, it owns the UI (`Bangle.setUI` custom, plus a one-shot `BTN1`
watch); the app sets its own UI again in `done()`.
Buzzing can read as a twist or tap on the accelerometer, which unlocks a
Bangle.js 2, so while any alert buzzes `wakeOnTwist`, `wakeOnDoubleTap` and
`wakeOnFaceUp` are off (restored 500 ms after the last buzz, or by boot code
on `load()`). A countdown also re-locks a watch that was locked if it
unlocks mid-buzz anyway. Timings are in
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
| `get()` | `{out, back}` in kph (numbers), or `null` where there's no value yet. `out` freezes at the turnaround; `back` is `null` until then. A half has no value until GPS has tracked it for 10 s. |
| `fmt(kph)` | `"5.2 kph"`, or `"-- kph"` for `null`. Use this rather than `toFixed(1)`, which doesn't carry in Espruino (`4.96` gives `"4.9"`). |
| `stats()` | `{outKm, outMs, backKm, backMs, tracking}`: the distance and tracked time behind the speeds (for tests and debugging) |

So the rows are `"Out " + speed.fmt(v.out)` and, on the walk back,
`"Back " + speed.fmt(v.back)`, with `v = speed.get()`. Calling `get()` every
second is fine: it only reads RAM.

How it tracks:

- GPS power is `Bangle.setGPSPower(1, "bangturn")` from the `"start"` event
  (or from boot, if a walk is running) until `"end"` or `"cancel"`. As a
  safety net it also turns GPS off by itself once the walk's hour is up, and
  boot doesn't turn it on for a walk whose time has passed.
- A fix counts if it has a position and an HDOP of 5 or better. A fix that
  implies more than 15 kph since the last good one is a jump and is ignored;
  after 5 jumps in a row tracking restarts from the new position, leaving
  out the gap.
- Distance is added in straight steps of at least 10 m, so jitter adds next
  to nothing. Time is the time between good fixes by the GPS clock
  (`fix.time`), so neither the wait for the first fix nor `-1 min` changes
  the average. A gap with no fixes is bridged in a straight line.
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
