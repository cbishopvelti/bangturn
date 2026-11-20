# BangTurn

A Bangle.js 2 app that tells you when to turn around on an out-and-back walk (an hour, or the length you set).

Tap the screen to start (the button never starts a walk). At 30 minutes the watch buzzes hard and shows
**TURN AROUND**. On the way back it buzzes 1, 2 and 3 times when half, a
quarter and an eighth of the way back is left (15, 7.5 and 3.75 minutes on
an hour walk), and the walk ends quietly at an hour. The screen shows the
countdown and your average speed out and back (GPS), each with the time it
would take to get back to the start at that speed, and a bottom row with
the speed you need to be back as the countdown reaches 0 (target symbol),
your speed now (speedometer) and the difference between them.
The way back is measured along the path you walked, with loops and detours
cut out (see "Way home" in the spec). A widget shows the
minutes left in other apps. Press the button during a walk for **Resume**,
**-1 min** (if you started late) and **Cancel walk**.

To change the walk length, press the button on the idle screen and pick
**Length** (or go to Settings >
Apps > BangTurn) and drag the hours and minutes wheels. The countdown shows
the total in minutes, so 1 h 30 starts at `90:00`. A new length applies to
the next walk.

- Spec: [docs/spec.md](docs/spec.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Tests: `npm test` in a headless emulator, see [tests/README.md](tests/README.md)

## Installing on the watch

BangTurn needs the Scheduler (`sched`) app. It's one of the default apps, and
the App Loader installs it for you if it's missing.

**One click (easiest).** Open
[cbishopvelti.github.io/bangturn](https://cbishopvelti.github.io/bangturn/) in
Chrome or Edge, press **Connect**, pick the watch and press the install
(or update) button on BangTurn. It's the normal Bangle.js App Loader with only
BangTurn and Scheduler on it, rebuilt from main on every push by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml)
(`sh tools/build-loader.sh` builds the same thing locally into `_site/`).

**Trying a pull request before it's merged.** Every open PR from a branch in
this repository gets its own install page at
`cbishopvelti.github.io/bangturn/pr-<number>/` (for example
[pr-33](https://cbishopvelti.github.io/bangturn/pr-33/)), with a yellow banner
saying which PR it is. A bot comment on the PR links to it and is kept up to
date. The preview's version is main's plus a fourth number (`0.01.32.3` is
PR commits on top of main's `0.01.32`), so the App Loader offers it as an
update, and main's next build after the merge as an update again. To go back
without merging, open the main page and press reinstall on BangTurn. Previews
rebuild on every push to the PR or to main and disappear when the PR closes.

**App Loader from files.** Download this repository (Code, then Download ZIP)
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
| 7.5 min left (2 buzzes) | `require("bangturn").start(Date.now()-52*60000)` | 30 s |
| 3.75 min left (3 buzzes), then the end | `require("bangturn").start(Date.now()-55.75*60000)` | 30 s, end 3.75 min later |

These times are for an hour walk. For another length, the buzzes come at
1/2, 1/4 and 1/8 of the way back left.

`require("bangturn").cancel()` stops a test walk. Disconnect the Web IDE
before a check that needs the watch on your wrist.

1. **Install.** BangTurn is in the launcher with its icon. Opening it shows
   the time of day with seconds, `60:00` and "Tap to start". No widget on
   the clock while idle.
2. **Start.** Press the button on the idle screen: a menu opens (Length) and nothing buzzes; press it again and you're back on the idle
   screen with no walk. Then tap the screen: one short buzz and the countdown
   runs, with the time of day and, under it, "Start" and the start time (HH:MM:SS) above it.
   While the watch is locked the seconds of the countdown, the time of day
   and the times to the origin turn grey: locked, the screen only redraws
   once a minute, so they show the second it last redrew (the moment it
   locked, then `:59` on the countdown and `:00` on the time as each minute
   turns) and don't tick. The start time keeps its seconds in black.
   No minutes number by the battery inside the app. Swipe right
   (or long-press) back to the clock: the widget shows `60`, and reopening
   the app shows the right time. With the watch unlocked, tap the number by
   the battery: BangTurn opens. Try taps on its edges and on the widgets next
   to it, and say if it's too fussy or opens when it shouldn't.
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
11. **Way home.** On the same walk, watch the times next to the speeds and
    the bottom row. Walking steadily, the speed now (after the speedometer)
    should sit near your average and not jump about by more than a few
    tenths (it is the last 20 s). The difference at the end should be green
    near 0.0, red with a minus when you are too slow, and readable in
    daylight. Walk a
    small loop or a there-and-back detour on the way out: the times should
    drop back when you rejoin your path. Turn around: the times should fall
    about a second a second, and the speed needed (after the target)
    should hold steady if you keep to it.
    Step off the path on the way back and rejoin it further on: the times
    rise, then drop back. At the start point they should read close to
    `0:00` (within GPS accuracy, 10 to 20 m). Note if the times ever grow
    while you are walking back along the same path: that means the watch
    isn't matching the way back to the way out (the 25 m in `speed.js`,
    `SNAP`, would need to be larger).

If you use the Alarms app: BangTurn's entries are hidden there, but its
Advanced menu's Disable All and Delete All also switch off or remove the
entries of a walk that's running.

## Battery

BangTurn costs nothing when no walk is running: no timers, no GPS, no
wake-ups left in the scheduler (checked in the emulator by
`tests/battery.test.js`). During a walk it keeps GPS on for the speeds and
the widget redraws once a minute; GPS goes off at the end, on Cancel walk,
and by itself shortly after the end if anything else misses it.

What to expect (the emulator can't measure power, so these are rough):

- **No walks:** a Bangle.js 2 on a plain clock, connected to Gadgetbridge,
  usually lasts one to two weeks, so a few percent a day. Heart rate
  monitoring set to continuous or frequent, a long backlight timeout, or lots
  of notifications cut that a lot.
- **A walk with the watch's own GPS:** the GPS chip draws about 20 mA, so
  roughly 10 to 20% of the battery per hour.
- **A walk with the phone's GPS** (Android Integration, "Overwrite GPS" on):
  the watch's GPS chip goes off once the phone's fixes arrive, so the walk
  should cost the watch much less. The phone's battery pays instead. If the
  phone stops sending fixes, the watch's own GPS takes over.

To use the phone's GPS, all three of these are needed (otherwise every
walk runs the watch's own GPS):

- On the watch: Settings > Apps > Android Integration > **Overwrite GPS** on.
- In Gadgetbridge on the phone: the Bangle.js device's settings (the gear on
  its card) > Location > **Use phone gps data** on. It is off by default;
  while it's off, Gadgetbridge shows "Phone gps data update is deactivated
  in the settings" on the phone when a walk starts.
- Gadgetbridge allowed to use the phone's location: in Gadgetbridge's own
  Settings > Location, press **Acquire location** (it asks for the location
  permission; this is what fixed it for Chris) and leave **Keep location
  updated** on (Gadgetbridge drops phone fixes while it's off). The phone's
  location must be on too.

Info's **Phone GPS** row (below) says which of these is missing. During a
walk, the symbol left of the time of day (top row) shows it at a glance: a phone
when the speeds come from the phone's GPS, a red crosshair while the watch's
own GPS chip is on (the battery drain), blank before any GPS.

Android Integration switches to the watch's own GPS as soon as one phone
fix is a second later than the gap between the last two, and a phone's fixes
are irregular (more so when it sits still), so left alone the watch's GPS
flaps on and off all walk. During a walk BangTurn steps in: while the phone
is connected over Bluetooth, the watch's GPS only comes on after a minute
with no phone fix (Info's Phone GPS reads "waiting" meanwhile), and goes off
again at the phone's next one. If Bluetooth drops, it comes on at once. The
same applies when you change app during a walk, if the phone sent a fix in
the last two minutes.

To tell BangTurn from a faulty watch:

1. Check phone GPS is set up as above, if you mean the phone to supply GPS.
2. Charge to 100% and leave the watch on the clock for a day with no walk.
   BangTurn does nothing then, so a big drop (say over 15 to 20% in a day)
   isn't BangTurn: check the Health app's heart rate setting and the
   backlight timeout. To be sure, uninstall BangTurn and repeat.
3. Note the battery before and after one walk to see what a walk costs.
4. Press the button and choose **Info** (during a walk, or from the start
   screen's menu). **GPS via**
   says where the last GPS fix came from (phone, or watch for its own GPS)
   and **Watch GPS** says whether the watch's GPS chip is powered, asked of
   the firmware itself. **Phone GPS** checks the phone GPS setup: "working",
   "setting off" (Overwrite GPS is off on the watch), "no Bluetooth" (not
   connected to Gadgetbridge), "waiting" (the phone's fixes have stopped
   and the watch's GPS is held off for up to a minute) or "no fixes" (asked, but Gadgetbridge sends
   nothing: turn on Use phone gps data, and press Acquire location in
   Gadgetbridge's Settings > Location).
   With the phone supplying GPS it should read phone
   and off, a few seconds after the walk starts or you open BangTurn (the
   watch's GPS runs until the phone's first fix arrives). **Last fix** says
   how long ago GPS last gave a position, and **Battery** the charge left.
   **GPS apps** lists every app that has asked for GPS (BangTurn shows as
   bangturn), from the firmware's own list. If an app other than bangturn
   is there, it's keeping GPS on too. With phone GPS an app can be listed
   while the chip is off: Watch GPS says whether the chip itself is on.
   Tap a row to refresh it. If it says watch and ON, the phone isn't
   supplying GPS.
5. The Power Manager app's logging can show which code keeps waking the
   watch.

A watch that still drains fast with nothing installed beyond the defaults
may be faulty: Espruino's forum and support can help.
