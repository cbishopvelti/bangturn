/* BangTurn widget, installed as "bangturn.wid.js".
   OWNED BY: widget task. Stub: shows the minutes left while a walk runs.
   See docs/ARCHITECTURE.md. */
(function () {
  var W = 28, iv;
  function active() {
    var s = require("Storage").readJSON("bangturn.json", 1);
    return s && s.start !== undefined;
  }
  function update() {
    var on = active(), w = on ? W : 0;
    if (iv) { clearInterval(iv); iv = undefined; }
    if (on) iv = setInterval(function () { WIDGETS.bangturn.draw(); }, 60000);
    if (WIDGETS.bangturn.width != w) {
      WIDGETS.bangturn.width = w;
      Bangle.drawWidgets();
    } else WIDGETS.bangturn.draw();
  }
  WIDGETS.bangturn = {
    area: "tr",
    width: 0,
    draw: function () {
      if (!this.width) return;
      var st = require("bangturn").status();
      g.reset().clearRect(this.x, this.y, this.x + W - 1, this.y + 23)
        .setFontAlign(0, 0).setFont("6x8", 2)
        .drawString(Math.ceil(st.remaining / 60000), this.x + W / 2, this.y + 12);
    }
  };
  Bangle.on("bangturn", update);
  update();
})();
