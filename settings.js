/* BangTurn settings, installed as "bangturn.settings.js": shown under
   Settings > Apps > BangTurn. One item, the walk length, which opens the
   scroll wheel picker (bangturn.picker). A new length applies to the next
   walk; a walk that is running keeps its own. */
(function (back) {
  var bt = require("bangturn");
  function menu() {
    var m = { "": { title: "BangTurn", back: back } };
    // a plain item, so a tap opens the wheels rather than a number stepper
    m["Length: " + bt.getMins() + " min"] = function () {
      E.showMenu();
      require("bangturn.picker").show(bt.getMins(), function (mins) {
        bt.setMins(mins);
        menu();
      });
    };
    E.showMenu(m);
  }
  menu();
})
