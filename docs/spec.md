# BangTurn: turnaround timer for Bangle.js 2

**Status:** v1.2 (2026-11-19)

## Purpose

Tell you when to turn around on an out-and-back walk. Press start when you set off on a one-hour walk. At the halfway point, 30 minutes in, the watch vibrates so you know to turn around.

## Core flow

1. Open BangTurn from the launcher. The screen shows `1:00:00`, "Turn around at 30:00" under it and a **Start** prompt.
2. Press the button (or tap Start). The one-hour countdown begins and the watch confirms with one short buzz.
3. You can leave the app and go back to the clock. The timer keeps running in the background.
4. When the countdown reaches 30 minutes left, the watch vibrates with a distinct pattern and shows **TURN AROUND**.
5. The alarm stops as soon as the watch unlocks (you raise your wrist to look, press the button or tap), or after 6 seconds, whichever comes first.
6. The countdown carries on for the walk back. At zero the watch gives a gentler "walk done" buzz and returns to the idle screen.

## Duration

- Fixed at **1 hour** total, turnaround at **30 minutes**. No way to change it in v1.
- Kept as one constant in the code so it's easy to make adjustable later.

## UI (176×176 touchscreen, single button)

| State | Screen | Button | Touch |
|---|---|---|---|
| Idle | `1:00:00`, "Turn around at 30:00" below, "Press to start" | Start | Tap: start |
| Running | Big countdown of the whole walk (h:mm:ss), "Turn around at 30:00" under it until the turnaround, then "Heading home"; average speed row(s) in kph (see Speed); progress bar | Short press: opens a menu with **Resume**, **−1 min** and **Cancel walk**. Long press: Bangle default (back to clock, walk keeps running) | Nothing |
| Menu | List: Resume, −1 min (shows current offset, e.g. "−1 min (−3)"), Cancel walk | Selects | Tap an item. Resume (or no input for 10 s) goes back to the countdown. −1 min moves the start time 1 minute earlier per tap and stays in the menu. Cancel walk clears both `sched` timers and returns to idle |
| Alert | "TURN AROUND", full-screen high contrast | Stops alarm | Tap: stops alarm |

- High contrast, large digits: readable in sunlight on the memory LCD.
- A small widget shows the remaining minutes on the clock and other apps while a timer is running.

## Speed

- Average speed in **kph**, one decimal place, measured with **GPS**.
- First 30 min: one row, `Out 5.2 kph`, the average since the start.
- At the turnaround that value freezes, and a second row appears: `Back 4.9 kph`, the average since the turnaround, updated as you walk.
- Average = distance covered / time elapsed in that half. Distance is the sum of GPS fix-to-fix distances, ignoring fixes with poor accuracy (HDOP too high) and jumps that imply more than ~15 kph.
- Before the first fix the row shows `-- kph`. If you use −1 min, the speed still uses only the time GPS has been running, since there's no distance for the minutes before you pressed start.
- GPS turns on when the walk starts and off when it ends or is cancelled.

## Alerts

- Start confirmation: one short buzz (~100 ms).
- Walk done (countdown hits zero): two short buzzes, no repeats.
- Turnaround alarm: distinct and prominent. A continuous pattern of long full-strength buzzes (e.g. 600 ms on, 200 ms off), unlike any notification buzz, with the screen lit.
- It stops when the watch unlocks (Bangle `lock` event fires with `false`, i.e. you looked at it or touched it) or after **6 seconds**, whichever comes first. No repeats.
- **Buzzes in Quiet Mode**, since this alarm is the whole point of the app.

## Background behaviour

- Use the built-in **`sched`** library (the same one the Alarm and Timer apps use) rather than an in-app `setTimeout`. That way the timer survives leaving the app, opening other apps, or the watch going back to the clock.
- On start, BangTurn writes two timer entries to `sched` (turnaround at 30 min, walk done at 60 min), each with `js` pointing back to BangTurn, so the alert opens BangTurn wherever you are. The start time is saved in `bangturn.json` so the countdown can be redrawn after leaving and reopening the app.
- Requires the **Scheduler** (`sched`) app as a dependency in `metadata.json`.
- If the watch reboots mid-walk, `sched` restores the timer.

## Battery

- GPS is the main drain: on for the hour of the walk, roughly 10 to 20% of the battery per walk. No HRM or Bluetooth use.
- GPS runs from a small boot/background handler so speed keeps being tracked when you leave the app.
- Redraw the countdown once a second only while the screen is unlocked. When locked, redraw once a minute (or not at all and let the widget show minutes).
- Nothing runs between ticks: the timer is a single `sched` wake-up, not a polling loop.

## Out of scope (v1)

- Turnaround by distance
- Changing the walk length
- A warning buzz before the turnaround
- Logging walks or history
- Phone app or Gadgetbridge integration

## Implementation notes

- Espruino JavaScript, standard BangleApps layout: `app.js`, `widget.js`, `boot.js` (GPS tracking in the background), `metadata.json`, `app-icon.js`.
- Test in the Espruino Web IDE emulator first, then on the watch.
- Can be published to a personal fork of the BangleApps loader or uploaded directly via the Web IDE.

## Decisions

- Fixed 1-hour walk, turnaround at 30 min, countdown shows the whole hour.
- Prominent turnaround alarm; buzzes in Quiet Mode; stops on unlock or after 6 s.
- No pre-warning buzz.
- **−1 min** in the menu moves the walk's start time one minute earlier per tap (for when you forgot to press start straight away). The countdown drops by a minute and both `sched` timers are rescheduled. If this moves the turnaround into the past, no alarm fires and the screen switches to "Heading home"; if it moves the end into the past, the walk finishes.
- Cancel via short button press, then Cancel walk in the menu. If the watch is locked, the first press may only wake the screen; a second press opens the menu.
