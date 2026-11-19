/* BangTurn boot code, installed as "bangturn.boot.js" (runs every time an
   app loads, so keep it tiny and cheap when no walk is active).
   OWNED BY: GPS speed task. Stub: only switches GPS power with the walk.
   Fill in fix filtering and distance tracking into bangturn.gps.json.
   See docs/ARCHITECTURE.md. */
(function () {
  function on() { Bangle.setGPSPower(1, "bangturn"); }
  function off() { Bangle.setGPSPower(0, "bangturn"); }
  Bangle.on("bangturn", function (type) {
    if (type == "start") on();
    else if (type == "end" || type == "cancel") off();
  });
  var s = require("Storage").readJSON("bangturn.json", 1);
  if (s && s.start !== undefined) on();
})();
