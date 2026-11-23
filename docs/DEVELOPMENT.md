# Developing BangTurn

- Spec: [spec.md](spec.md)
- How it's built: [ARCHITECTURE.md](ARCHITECTURE.md)
- Tests: `npm test` in a headless emulator, see [tests/README.md](../tests/README.md)
- User guide (also the App Loader's "Read more"): [README.md](../README.md)

## Installing development builds

BangTurn needs the Scheduler (`sched`) app. It's one of the default apps, and
the App Loader installs it for you if it's missing.

**One click (easiest).** Open
[cbishopvelti.github.io/bangturn](https://cbishopvelti.github.io/bangturn/) in
Chrome or Edge, press **Connect**, pick the watch and press the install
(or update) button on BangTurn. It's the normal Bangle.js App Loader with only
BangTurn and Scheduler on it, rebuilt from main on every push by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
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
    tenths (it is the last 20 s). It and the difference at the end should be green
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


## Releasing to the Bangle.js App Loader

BangTurn is listed in the official App Loader (banglejs.com/apps) through
the [espruino/BangleApps](https://github.com/espruino/BangleApps) repository,
as `apps/bangturn/`. This repository stays the place it is developed; a
release copies the app's files across.

1. Bump `version` in `metadata.json` (two numbers, such as `1.01`) and add a
   line for it at the end of `ChangeLog`, in the same `1.01: what changed`
   form. The App Loader shows that line as the release notes.
2. If the screens changed, `npm run screenshots` retakes the pictures in
   `screenshots/` in the emulator.
3. `npm run store-check` runs BangleApps' own checks (`bin/sanitycheck.js`
   and its ESLint rules, which allow no warnings) on the app. CI runs it on
   every pull request too.
4. In a fork of BangleApps, on a new branch from its `master`, copy the
   files in: `node tools/app-files.js <fork>/apps/bangturn` (it copies only
   what `metadata.json` uses, plus `ChangeLog`, `README.md` and the
   screenshots). Commit with an `AI-assisted` trailer if AI helped (their
   `AGENTS.md` asks for it, without naming the AI service), push, and open
   a pull request to `espruino/BangleApps` `master`.
5. Once it's merged it appears at
   [espruino.github.io/BangleApps](https://espruino.github.io/BangleApps/)
   (the development App Loader) straight away, and at
   [banglejs.com/apps](https://banglejs.com/apps/) when that is next
   refreshed.

Code in BangleApps is MIT licensed: submitting it there means agreeing to
that for the app.

The install page here (`cbishopvelti.github.io/bangturn`) keeps publishing
main as `<version>.<build>` (`1.00.42`), which the App Loader sees as newer
than the store's `1.00`, so a watch on development builds stays on them.
