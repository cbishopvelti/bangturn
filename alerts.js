/* BangTurn alerts module, installed to Storage as "bangturn.alerts".
   OWNED BY: alerts task. This is a minimal working stub; replace the bodies,
   keep the exported names and signatures (see docs/ARCHITECTURE.md).
   Spec: docs/spec.md, "Alerts". Must buzz in Quiet Mode. */

/* One short confirmation buzz when a walk starts. Called by the app. */
exports.started = function () {
  Bangle.buzz(100);
};

/* Turnaround alarm. Called by the app at startup when
   require("bangturn").takeAlert() returns "turn" (the app was just loaded by
   the sched entry). Show "TURN AROUND" full screen, buzz the long pattern,
   stop on unlock (Bangle "lock" event with false) or after 6 s, then call
   done() so the app can show the countdown. */
exports.turnaround = function (done) {
  g.reset().clear().setFontAlign(0, 0).setFont("Vector", 30)
    .drawString("TURN\nAROUND", g.getWidth() / 2, g.getHeight() / 2);
  Bangle.setLCDPower(1);
  Bangle.buzz(600).then(function () { setTimeout(done, 200); });
};

/* Walk-back countdown: n short buzzes (1 at 15 min left, 2 at 8, 3 at 4,
   4 at 1). Runs inside whatever app is open; must not draw or load(). */
exports.countdown = function (n) {
  var i = 0;
  (function next() {
    if (i++ >= n) return;
    Bangle.buzz(200).then(function () { setTimeout(next, 300); });
  })();
};
