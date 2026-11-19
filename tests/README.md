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
```

Set `BANGLE_DIR` if the emulator isn't in `/opt/bangle`. GitHub Actions runs
the same on every pull request (`.github/workflows/test.yml`).

## Writing tests

```js
const { test, assert } = require("./harness");

test("what it checks", async h => {
  h.tx('require("bangturn").start()');               // run code on the watch
  assert.eq(h.eval('require("bangturn").status().phase'), "out");
  await h.load("bangturn.app.js");                    // load an app and wait for it
  await h.wait(1500);                                 // let real time pass
});
```

- Each test starts with a fresh emulator, BangTurn and the latest `sched`
  installed, and boot code run (`load()`), like a freshly booted watch.
- `h.eval(js)` returns the value (through JSON). `h.tx(js)` ignores it.
- `h.load()` with no file loads the clock, which is how to simulate a reboot
  or leaving the app.
- The emulator clock can't be moved forward, so test timing by starting a
  walk in the past (`start(Date.now() - 45*60000)`), and real firing with
  events a second or two away.
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
