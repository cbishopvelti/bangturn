# BangTurn: turnaround timer for Bangle.js 2

**Status:** v1.4 (2026-11-19)

## Purpose

Tell you when to turn around on an out-and-back walk. Start it when you set off on a one-hour walk. At the halfway point, 30 minutes in, the watch vibrates so you know to turn around.

## Core flow

1. Open BangTurn from the launcher. The screen shows the time of day, `60:00` under it and a **Start** prompt.
2. Tap the screen. The one-hour countdown begins and the watch confirms with one short buzz.
3. You can leave the app and go back to the clock. The timer keeps running in the background.
4. When the countdown reaches 30 minutes left, the watch vibrates with a distinct pattern and shows **TURN AROUND**.
5. The alarm stops as soon as the watch unlocks (you raise your wrist to look, press the button or tap), or after 6 seconds, whichever comes first.
6. The countdown carries on for the walk back, with short countdown buzzes at half, a quarter and an eighth of the way back left (15, 7.5 and 3.75 minutes on an hour walk). At zero the walk ends silently (no buzz): GPS turns off and the app returns to the idle screen.

## Duration

- **1 hour** by default, turnaround at half the walk (30 minutes).
- Adjustable: the button on the idle screen opens a menu with **Length**, or Settings > Apps > BangTurn > Length. Two scroll wheels side by side, hours (0 to 9) and minutes (0 to 59), like a phone's duration picker: drag a wheel up or down, or tap the number above or below the middle band. The total shows underneath in minutes ("90 min"). The button or the back arrow saves it. Shortest walk 1 minute, longest 9 h 59.
- The countdown still shows minutes only: 1 h 30 starts at `90:00`, and the widget shows `89` etc.
- A new length applies to the next walk. A walk already running keeps the length it started with.
- Countdown buzzes only come after the turnaround: a 20 minute walk has no 15 min buzz, a 10 minute walk only the 4 and 1 min ones.

## UI (176×176 touchscreen, single button)

| State | Screen | Button | Touch |
|---|---|---|---|
| Idle | Time of day (HH:MM:SS) at the top, the walk length (`60:00`), "Tap to start", "Button: length" | Opens a menu: **Length** (the picker) and **Info** (as in the walk menu; Phone GPS reads "no walk" since nothing asks for GPS without one). The button never starts a walk on its own; in the menu it goes back to the idle screen, as does 10 s with no input | Tap: start. Swipe right: back to the clock. No left swipe (another app on the watch uses swipes) |
| Running | At the top two lines with the times one above the other at the right: the time of day (HH:MM:SS, the seconds in grey while locked), then "Start" and the walk's start time (HH:MM:SS, moved earlier by any −1 min taps, always with seconds since it never changes); big countdown of the whole walk in minutes and seconds (`48:00`, no hours), with the seconds in grey while the watch is locked (frozen at the last once-a-minute redraw; the minutes don't move); average speed row(s) in kph (see Speed), with a Back row once you've turned around, each with the time to the origin at that speed; a bottom row with the speed now and the speed needed (see Way home); a GPS symbol at the left of the time of day's line, which doesn't move the time (a phone while the speeds come from the phone's GPS, a red crosshair while the watch's own GPS chip is on, blank before any GPS). No progress bar: its space went to the bigger times at the top | Short press: opens a menu with **Resume**, **−1 min** and **Cancel walk**. Long press: Bangle default (back to clock, walk keeps running) | Swipe right: back to the clock (walk keeps running) |
| Menu | List: Resume, −1 min (shows current offset, e.g. "−1 min (−3)"), Cancel walk, Info. Info opens a list: **GPS via** (phone, watch or none yet: where the last GPS fix came from), **Watch GPS** (ON/off: whether the watch's own GPS chip is powered), **Phone GPS** (working, waiting, setting off, no Bluetooth or no fixes: the first missing link for the phone's GPS; waiting means the phone's fixes have stopped and the watch's own GPS is held off for up to a minute while Bluetooth is connected), **GPS apps** (the apps that have asked for GPS power, from the firmware's `Bangle._PWR.GPS` list), **Last fix** (how long ago GPS last gave a position) and **Battery** (%); tap a row to refresh, back returns to the menu | Selects | Tap an item. Resume (or no input for 10 s) goes back to the countdown. −1 min moves the start time 1 minute earlier per tap and stays in the menu. Cancel walk clears all BangTurn `sched` timers and returns to idle |
| Alert | "TURN AROUND", full-screen high contrast | Stops alarm | Tap: stops alarm |

- High contrast, large digits: readable in sunlight on the memory LCD.
- A small widget, to the left of the battery, shows the remaining minutes (rounded down, the same minutes as the countdown's `m:ss`) on the clock and other apps while a timer is running. It is hidden inside BangTurn itself, which shows the countdown.

## Speed

- Average speed in **kph**, one decimal place, measured with **GPS**.
- First 30 min: one row, `Out 5.2 kph`, the average since the start.
- At the turnaround that value freezes, and a second row appears: `Back 4.9 kph`, the average since the turnaround, updated as you walk.
- Average = distance covered / time elapsed in that half. Distance is the sum of GPS fix-to-fix distances, ignoring fixes with poor accuracy (HDOP too high) and jumps that imply more than ~15 kph.
- Before the first fix the row shows `-- kph`. If you use −1 min, the speed still uses only the time GPS has been running, since there's no distance for the minutes before you pressed start.
- GPS turns on when the walk starts and off when it ends or is cancelled.
- With the phone supplying GPS (Android Integration's Overwrite GPS) and Bluetooth connected, the watch's own GPS chip only comes on after a minute with no phone fix, and goes off at the phone's next one. Android Integration alone switches after about a second's delay, so the chip flaps on and off. If Bluetooth drops, the chip comes on at once.

## Way home

The origin is where the walk started (the first good GPS fix). The watch keeps the **trail** back to it: the path you have walked, by its shortest way.

- Loops and there-and-back detours on the way out are cut out: when you come back within about 25 m of an earlier part of the trail, the trail is cut back to there.
- On the way back you follow the trail, and it shortens as you go, whenever you actually turn around (early, late or on the alarm).
- If you leave the trail on the way back (a detour to use up time), the detour is added: the way home is back the way you came. When you rejoin the trail anywhere, the detour is forgotten and the way home is the trail from there.
- The **distance home** is the length of the trail. Right-angle corners are kept; a hairpin whose two legs are within 25 m is treated as a detour and cut.

On the walk screen:

- Next to each average speed, the **time to the origin** at that speed: distance home / speed, as `m:ss` (the seconds in grey while locked, like the countdown). `Out 5.2 kph 28:45` means retracing the trail at your Out average takes 28:45. Compare it with the countdown: less than the countdown means you'd be early.
- A bottom row, `Now 5.1 kph  Need 4.6`: **Now** is your speed over the last 20 s. **Need** is distance home / time left on the countdown: the speed that brings you to the origin as the countdown reaches 0. On the way out that is for turning around right now, so it starts low and climbs to about your Out speed by the turnaround.
- The Now number is **green** when it equals Need. It shades towards **red** as you fall behind (fully red at 1 kph or more under Need) and towards the normal text colour (black on the light theme) as you get ahead (fully at 1 kph or more over). The screen has 8 colours, so the shades in between are dithered. With no Now or no Need it is the normal colour.
- `--` where there's nothing to show: no GPS yet, no Back speed yet, a speed of 0 (you'd never arrive), or no good fix in the last 15 s for Now. A needed speed of 100 kph or more shows `99+`.

## Alerts

- Start confirmation: one short buzz (~100 ms).
- Home-stretch countdown (walk back only), short buzzes (~200 ms on, 300 ms off) so you can count them without looking:
  - Half the way back left (15 min on an hour walk): 1 buzz
  - A quarter left (7.5 min): 2 buzzes
  - An eighth left (3.75 min): 3 buzzes
  - These scale with the walk length (Chris, 2026-11-20), so every walk gets all three.
- Walk done (countdown hits zero): **no buzz**.
- Countdown buzzes also play in Quiet Mode.
- Turnaround alarm: distinct and prominent. A continuous pattern of long full-strength buzzes (e.g. 600 ms on, 200 ms off), unlike any notification buzz, with the screen lit.
- It stops on a button press or a tap on the screen, or after **6 seconds**, whichever comes first. No repeats. (Not on unlock: on the real watch the buzz itself reads as a twist or tap and unlocks it. Twist and tap wake-ups stay on, as Chris wants them.)
- Countdown buzzes must not unlock the watch: if a buzz unlocks a locked watch, it is locked again.
- **Buzzes in Quiet Mode**, since this alarm is the whole point of the app.

## Background behaviour

- Use the built-in **`sched`** library (the same one the Alarm and Timer apps use) rather than an in-app `setTimeout`. That way the timer survives leaving the app, opening other apps, or the watch going back to the clock.
- On start, BangTurn writes five timer entries to `sched` (turnaround at 30 min; countdown buzzes at 45, 52.5 and 56.25 min, scaled to the walk length; silent walk end at 60 min, which turns GPS off), each with `js` pointing back to BangTurn, so the alert opens BangTurn wherever you are. The start time is saved in `bangturn.json` so the countdown can be redrawn after leaving and reopening the app.
- Requires the **Scheduler** (`sched`) app as a dependency in `metadata.json`.
- If the watch reboots mid-walk, `sched` restores the timer.

## Battery

- GPS is the main drain: on for the hour of the walk, roughly 10 to 20% of the battery per walk. No HRM or Bluetooth use.
- GPS runs from a small boot/background handler so speed keeps being tracked when you leave the app.
- Redraw the countdown once a second only while the screen is unlocked. When locked, redraw once a minute. Seconds would freeze then, so while locked the countdown's `:ss` and the time of day's seconds are drawn in grey (dithered), frozen at the last redraw (the lock, then `:59` on the countdown and `:00` on the time each minute).
- Nothing runs between ticks: the timer is a single `sched` wake-up, not a polling loop.

## Out of scope (v1)

- Turnaround by distance
- Changing the walk length
- A warning buzz before the turnaround (the countdown buzzes are on the walk back only)
- Logging walks or history
- Phone app or Gadgetbridge integration

## Implementation notes

- Espruino JavaScript, standard BangleApps layout: `app.js`, `widget.js`, `boot.js` (GPS tracking in the background), `metadata.json`, `app-icon.js`.
- Test in the Espruino Web IDE emulator first, then on the watch.
- Can be published to a personal fork of the BangleApps loader or uploaded directly via the Web IDE.

## Decisions

- 1-hour walk by default, adjustable with hours/minutes scroll wheels (Chris, 2026-11-20); turnaround at half; countdown shows the whole walk in minutes (no hours).
- Prominent turnaround alarm; buzzes in Quiet Mode; stops on a button press, a tap or after 6 s.
- No warning buzz before the turnaround.
- Home-stretch countdown buzzes at 1/2, 1/4 and 1/8 of the way back left (1/2/3 buzzes).
- **−1 min** in the menu moves the walk's start time one minute earlier per tap (for when you forgot to press start straight away). The countdown drops by a minute and all `sched` timers are rescheduled. Any buzz whose time has already passed is skipped: if this moves the turnaround into the past, no alarm fires and the screen switches to the way back (Back speed row); if it moves the end into the past, the walk finishes.
- Cancel via short button press, then Cancel walk in the menu. If the watch is locked, the first press may only wake the screen; a second press opens the menu.
