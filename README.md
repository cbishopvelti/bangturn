# BangTurn

A Bangle.js 2 app that tells you when to turn around on a one-hour out-and-back walk.

Press the button to start. At 30 minutes the watch buzzes hard and shows
**TURN AROUND**. On the way back it buzzes 1, 2, 3 and 4 times at 15, 8, 4 and
1 minutes left, and the walk ends quietly at an hour. The screen shows the
countdown and your average speed out and back (GPS), and a widget shows the
minutes left in other apps. Press the button during a walk for **Resume**,
**-1 min** (if you started late) and **Cancel walk**.

- Spec: [docs/spec.md](docs/spec.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Tests: `npm test` in a headless emulator, see [tests/README.md](tests/README.md)

## Installing on the watch

BangTurn needs the Scheduler (`sched`) app. It's one of the default apps, and
the App Loader installs it for you if it's missing.

**App Loader (easiest).** Download this repository (Code, then Download ZIP)
and unzip it. Open the [App Loader](https://banglejs.com/apps/) in Chrome or
Edge and connect to the watch. On the **More...** tab, press **Install App from
Files** and select every file in the folder (it only takes the ones
`metadata.json` lists). If your App Loader doesn't have that button yet, use
the Web IDE.

**Espruino Web IDE.** Run `npm run bundle` (Node 18 or later, no packages
needed), or download `bangturn-install` from the latest
[Emulator tests run](https://github.com/cbishopvelti/bangturn/actions/workflows/test.yml) on GitHub. Open the
[Web IDE](https://www.espruino.com/ide/), connect to the watch, paste
`dist/bangturn-install.js` into the editor on the right and press **Send to
Espruino**. It writes the files, adds BangTurn to the launcher and restarts
the clock. Sending it again updates the app.

**Your own App Loader.** Fork [BangleApps](https://github.com/espruino/BangleApps),
copy these files into `apps/bangturn/`, turn on GitHub Pages for the fork and
install from `https://<you>.github.io/BangleApps/`.

## Testing on the watch

The emulator tests cover the logic, but these need the real watch. To get to
an alarm without walking for half an hour, connect the Web IDE and type a
line from the table in the console (left side). It starts a walk that's
already partway through.

| To test | Type | It happens in |
|---|---|---|
| Turnaround alarm | `require("bangturn").start(Date.now()-29.5*60000)` | 30 s |
| 15 min left (1 buzz) | `require("bangturn").start(Date.now()-44.5*60000)` | 30 s |
| 8 min left (2 buzzes) | `require("bangturn").start(Date.now()-51.5*60000)` | 30 s |
| 4 min left (3 buzzes) | `require("bangturn").start(Date.now()-55.5*60000)` | 30 s |
| 1 min left (4 buzzes), then the end | `require("bangturn").start(Date.now()-58.5*60000)` | 30 s, end 60 s later |

`require("bangturn").cancel()` stops a test walk. Disconnect the Web IDE
before a check that needs the watch on your wrist.

1. **Install.** BangTurn is in the launcher with its icon. Opening it shows
   the time of day with seconds, `60:00` and "Press to start". No widget on
   the clock while idle.
2. **Start.** A button press (or a tap) gives one short buzz and the countdown
   runs, with the time of day and "Start HH:MM" side by side above it. While
   the watch is locked the seconds go: the countdown shows `60 min` and the
   time HH:MM. No minutes number by the battery inside the app. Swipe right
   (or long-press) back to the clock: the widget shows `60`, and reopening
   the app shows the right time.
3. **Button stops the alarm.** Start a turnaround test, go to the clock and
   let the watch lock. When the alarm starts (strong long buzzes, lit screen,
   TURN AROUND), press the button once. The alarm stops at once and the
   countdown shows the Back speed row. The press must not open the menu.
4. **Other ways the alarm stops.** Repeat and raise your wrist instead (stops
   when the watch unlocks), then repeat with the watch unlocked and tap the
   screen. Repeat once more and leave it: it stops by itself after 6 s and
   doesn't come back.
5. **Quiet Mode.** Set Settings, Quiet Mode to Silent and rerun the alarm and a
   countdown test: they still buzz.
6. **Countdown buzzes.** Run the four countdown tests on your wrist with the
   watch on the clock. You can count 1, 2, 3 and 4 buzzes without looking, and
   they feel different from the alarm.
7. **Silent end.** In the last test the 4 buzzes come, then a minute later
   the walk ends with no buzz, the GPS turns off and the widget goes.
8. **Menu.** During a walk, a button press opens Resume, -1 min and Cancel
   walk. -1 min shows `(-1)` and the countdown drops a minute. With no input
   the menu goes back to the countdown after 10 s. If the watch is locked the
   first press may only wake it. Cancel walk returns to the idle screen and
   nothing buzzes afterwards.
9. **Reboot mid-walk.** Start a walk, then hold the button until the watch
   restarts (about 10 s). The widget still shows the minutes left and the app
   the right countdown and Out speed, and the alarms still come.
10. **A real walk.** Walk the full hour outdoors with the watch on the clock.
    Check the alarm is hard to miss, and compare the Out and Back speeds with
    a phone app. The GPS filter (ignores fixes with HDOP over 5, counts
    distance in 10 m steps, drops jumps over 15 kph) is untuned, so note
    readings that look too high or too low, and whether standing still
    creeps up the distance. Note the battery before and after: the spec
    expects 10 to 20% for the hour.

If you use the Alarms app: BangTurn's entries are hidden there, but its
Advanced menu's Disable All and Delete All also switch off or remove the
entries of a walk that's running.
