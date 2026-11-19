/* BangTurn widget, installed as "bangturn.wid.js".
   Shows the whole minutes left (rounded up) while a walk runs; width 0 and
   no timers when idle. Hidden (width 0, no timers) inside the BangTurn
   app, which calls WIDGETS.bangturn.hide(). Redraws on "bangturn" events and once a minute,
   aligned to the moment the displayed number changes, so it wakes the CPU
   at most once a minute. Idle cost: one small Storage read at load.
   See docs/ARCHITECTURE.md. */
(function () {
  var W = 28, to, hidden;
  function active() {
    var s = require("Storage").readJSON("bangturn.json", 1);
    return !!(s && s.start !== undefined);
  }
  function tick() {
    to = undefined;
    var st = require("bangturn").status();
    if (!st.active) return update();
    WIDGETS.bangturn.draw(st);
    /* next change of ceil(remaining/60000), +50 ms margin */
    var ms = st.remaining % 60000;
    to = setTimeout(tick, (ms || 60000) + 50);
  }
  function update() {
    var on = !hidden && active(), w = on ? W : 0, wd = WIDGETS.bangturn;
    if (to) { clearTimeout(to); to = undefined; }
    if (wd.width != w) {
      wd.width = w;
      Bangle.drawWidgets();
    }
    if (on) tick();
  }
  WIDGETS.bangturn = {
    area: "tr",
    width: 0,
    /* the BangTurn app shows the countdown itself, so it hides this */
    hide: function () { hidden = true; update(); },
    draw: function (st) {
      if (!this.width || this.x === undefined) return;
      if (!st || st.remaining === undefined) st = require("bangturn").status();
      if (!st.active) return;
      var m = Math.ceil(st.remaining / 60000);
      g.reset().clearRect(this.x, this.y, this.x + W - 1, this.y + 23)
        .setFontAlign(0, 0).setFont("6x8", m > 99 ? 1 : 2)
        .drawString(m, this.x + W / 2, this.y + 12);
    }
  };
  Bangle.on("bangturn", update);
  update();
})();
