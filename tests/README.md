# Emulator tests

Headless Bangle.js 2 emulator tests for BangTurn, run in Node 18 or later.

## Setup

The tests need EspruinoWebIDE and BangleApps checked out side by side.
`tests/setup-emulator.sh` does that in `$BANGLE_DIR` (default `/opt/bangle`,
which the "Bangturn" cloud environment already has):

```sh
BANGLE_DIR=~/bangle sh tests/setup-emulator.sh
```

## Running

```sh
npm test                                   # all tests/*.test.js
node tests/run.js tests/core.test.js -v    # one file, with the watch's console
node tests/run.js --grep=reboot            # tests whose name contains "reboot"
BANGTURN_TEST_TIME=2026-06-15T23:58:00Z npm test   # run at another time of day
```

The whole suite takes about 10 seconds.

Set `BANGLE_DIR` if the emulator isn't in `/opt/bangle`. GitHub Actions runs
the same on every pull request (`.github/workflows/test.yml`).

## Writing tests

```js
const { test, assert } = require("./harness");

test("what it checks", async h => {
  h.tx('require("bangturn").start()');               // run code on the watch
  assert.eq(h.eval('require("bangturn").status().phase'), "out");
  await h.load("bangturn.app.js");                    // load an app and wait for it
  await h.wait(1500);                                 // let 1.5 s pass on the watch
});
```

- Each test starts from a freshly booted watch: BangTurn and the latest
  `sched` installed and boot code run (`load()`). The harness boots once,
  snapshots the watch's RAM and flash, and restores that for every test.
- The watch's clock is virtual (`tests/emulator.js`). It stands still while
  the watch runs a command and only moves in `h.wait(ms)`, which runs the
  watch's timers as they fall due, so a 6 s wait takes no real time and every
  run sees exactly the same times. Every test starts at 10:00:00 UTC on
  15 June 2026 (plus the boot), well away from minute and day boundaries.
  `BANGTURN_TEST_TIME` (any time `Date.parse` reads) starts it elsewhere, to
  check a change near midnight, say.
- `h.eval(js)` returns the value (through JSON). `h.tx(js)` ignores it.
- `h.load()` with no file loads the clock, which is how to simulate a reboot
  or leaving the app.
- `h.wait()` can pass any amount of time, but a long one runs every redraw
  on the way, so test long spans by starting a walk in the past
  (`start(Date.now() - 45*60000)`) and real firing with events a second or
  two away. Don't use `setTime()` on the watch: the clock is the harness's.
- There's no GPS in the emulator. `GPS_USERS` records who asked for GPS power
  (`GPS_USERS.bangturn == 1` while BangTurn has it on).
  Feed fixes with `Bangle.emit("GPS", {fix:1, lat:.., lon:.., hdop:1, time:new Date(..)})`,
  at most a few dozen per `h.tx` (events are queued). The speed tracker
  measures time with `fix.time`, so a test can walk for half an hour in a
  moment; `tests/walker.js` is a helper for that.
- `tests/walk.test.js` moves a whole walk forward in time with `jump()`
  (it shifts the walk's offset, as -1 min does) and lets sched fire for real.
  It presses the button by running the firmware's BTN1 watches.
- `E.reboot()` works: Storage survives and the boot code runs again, but the
  emulator doesn't then open the clock (and the clock started at boot has no
  `__FILE__`), so follow it with `h.load()`.
- An uncaught error on the watch fails the test.
