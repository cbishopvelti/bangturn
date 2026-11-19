/* BangTurn speed module, installed to Storage as "bangturn.speed".
   OWNED BY: GPS speed task (together with boot.js and bangturn.gps.json).
   Stub: replace the body, keep the signature (see docs/ARCHITECTURE.md). */

/* Average speeds for the UI, in kph (numbers), or null before there is a
   value: { out: kph|null, back: kph|null }.
   out: average from the start to the turnaround (frozen after it).
   back: average since the turnaround (null while still walking out). */
exports.get = function () {
  return { out: null, back: null };
};
