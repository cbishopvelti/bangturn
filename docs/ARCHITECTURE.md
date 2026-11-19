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
| `boot.js` | `bangturn.boot.js` | GPS power and speed tracking in the background | GPS speed |
| `speed.js` | `bangturn.speed` (module) | Average speeds for the UI | GPS speed |
| `widget.js` | `bangturn.wid.js` | Minutes-left widget | widget |
| `metadata.json`, `tests/harness.js`, `tests/run.js` | | App loader metadata, test harness | core (add your storage entries and tests freely) |

Each task owns its files. Stubs are in place and already work end to end
(a plain countdown, simple buzzes, GPS on/off, a minutes widget), so every
task can replace its own file without waiting for the others. If you need
something from another part, add it to this document in your PR rather
than editing that part's file.

Data files:

| File | Contents | Written by |
|---|---|---|
| `bangturn.json` | Walk state (below) | `lib.js` only |
| `bangturn.gps.json` | `{outKm, outMs, backKm, backMs}`: distance and GPS time for each half | `boot.js` only |
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
| `fmt(ms)` | `"1:00:00"` (h:mm:ss, rounds up to the second) |
| `isActive()` | A walk is running |
| `read()` | The raw state object |
| `start()` | Starts a walk now, writes the six `sched` entries. Doesn't buzz: the app calls `alerts.started()`. |
| `minusOne()` | Moves the start 1 minute earlier and reschedules, skipping past events. Past the turnaround: no alarm, `turned` set, phase becomes `"back"`. Past the end: the walk finishes. Returns the new `status()`. |
| `cancel()` | Clears all BangTurn `sched` entries and the state |
| `finish()` | Ends the walk silently (used at the end, and by `minusOne`) |
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
| `turnaround(done)` | app at startup (hook above) | Full-screen "TURN AROUND", long buzz pattern, stop on unlock (`lock` event with `false`) or after 6 s, then call `done()` once |
| `countdown(n)` | core `fire()` | `n` short buzzes (~200 ms on, 300 ms off). Runs inside any app: no drawing, no `load()` |

All alerts must also buzz in Quiet Mode.

## Speed: `bangturn.boot.js` and `require("bangturn.speed")`

`boot.js` runs on every app load. Keep it cheap when no walk is running (it
reads `bangturn.json` and does nothing else). During a walk it keeps GPS
on (`Bangle.setGPSPower(1, "bangturn")`) and tracks distance into
`bangturn.gps.json`. It turns GPS off on the `"end"` and `"cancel"` events.
Use `require("bangturn").status().phase` (or `turned`) to decide which half
a fix belongs to; `-1 min` can move the turnaround, and an `"offset"` event
says when.

`require("bangturn.speed").get()` returns `{out, back}` in kph (numbers) or
`null` where there's no value yet. `out` freezes at the turnaround; `back`
is `null` until then. The UI only uses this function.

## Widget: `bangturn.wid.js`

`WIDGETS.bangturn`, width 0 when idle. Reads `require("bangturn").status()`
and redraws on `"bangturn"` events and once a minute. Use the core module
rather than reading files directly where you can, but keep the widget light
since it loads in every app.

## Tests

`npm test` runs every `tests/*.test.js` in a headless Bangle.js 2 emulator
(set up with `tests/setup-emulator.sh`, see [tests/README.md](../tests/README.md)).
Each test gets a fresh emulator with the app installed and boot code run.
Add your own `tests/<area>.test.js` rather than editing `core.test.js`.
Keep all source ASCII (the harness rejects anything else), so write `-1 min`
with a plain hyphen.
