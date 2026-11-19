/* BangTurn boot code, installed as "bangturn.boot.js". It runs every time
   an app loads, so it is tiny: when no walk is running it reads
   bangturn.json and does nothing else. During a walk it hands over to the
   "bangturn.speed" module, which keeps GPS on and tracks the distance in
   the background, whatever app is open. See docs/ARCHITECTURE.md.
   OWNED BY: GPS speed task. */
(function () {
  Bangle.on("bangturn", function (type) {
    require("bangturn.speed").event(type);
  });
  var s = require("Storage").readJSON("bangturn.json", 1);
  if (s && s.start !== undefined) require("bangturn.speed").resume(s);
})();
