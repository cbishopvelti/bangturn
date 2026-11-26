/* Draws the app icon, a U-turn arrow, and writes both versions of it:
   app.png (48x48, anti-aliased, for the App Loader) and app-icon.js (the
   same shape as a 1-bit Image String, for the launcher on the watch).

     node tools/make-icon.js

   The arrow is one continuous stroke: up the right stem, over a half
   circle and down the left stem into the arrowhead. */
const fs = require("fs");
const path = require("path");
const png = require("./png");

const SIZE = 48;
const SS = 8; // samples per pixel each way, for the PNG's soft edges
const W = 7; // stroke width
const DX = 4, DY = -1; // centres the shape in the 48x48 box

const LX = 14 + DX, RX = 33 + DX; // the stems' centre lines
const CX = (LX + RX) / 2, CY = 20 + DY; // centre of the half circle
const R = (RX - LX) / 2; // its radius, to the middle of the stroke
const NECK = 31 + DY; // where the left stem meets the arrowhead
const HEAD_Y = 30 + DY, TIP_Y = 45 + DY, HEAD_W = 11; // arrowhead
const BOTTOM = 45 + DY; // foot of the right stem

/* Is the point (x, y), in pixels, inside the arrow? */
function inside(x, y) {
  const h = W / 2;
  // right stem, from the half circle's centre line down to its foot
  if (y >= CY && y <= BOTTOM && Math.abs(x - RX) <= h) return true;
  // left stem, down to the arrowhead
  if (y >= CY && y <= NECK && Math.abs(x - LX) <= h) return true;
  // the half circle over the top, joining both stems without a seam
  if (y <= CY) {
    const d = Math.hypot(x - CX, y - CY);
    if (d >= R - h && d <= R + h) return true;
  }
  // arrowhead, pointing down
  if (y >= HEAD_Y && y <= TIP_Y) {
    const half = HEAD_W * (TIP_Y - y) / (TIP_Y - HEAD_Y);
    if (Math.abs(x - LX) <= half) return true;
  }
  return false;
}

/* How much of pixel (px, py) the arrow covers, 0 to 1 */
function coverage(px, py) {
  let n = 0;
  for (let i = 0; i < SS; i++)
    for (let j = 0; j < SS; j++)
      if (inside(px + (i + 0.5) / SS, py + (j + 0.5) / SS)) n++;
  return n / (SS * SS);
}

const cov = [];
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) cov.push(coverage(x, y));

// app.png: black, with the coverage as alpha
const rgba = new Uint8Array(SIZE * SIZE * 4);
cov.forEach((c, i) => { rgba[i * 4 + 3] = Math.round(c * 255); });

// app-icon.js: 1 bit per pixel, set where at least half the pixel is covered.
// Espruino's image format: width, height, bits per pixel, then the pixels
// row by row, most significant bit first.
const bits = Buffer.alloc(3 + SIZE * SIZE / 8);
bits[0] = SIZE; bits[1] = SIZE; bits[2] = 1;
cov.forEach((c, i) => { if (c >= 0.5) bits[3 + (i >> 3)] |= 0x80 >> (i & 7); });

const ROOT = path.join(__dirname, "..");
fs.writeFileSync(path.join(ROOT, "app.png"), png(rgba, SIZE, SIZE));
fs.writeFileSync(path.join(ROOT, "app-icon.js"), `atob("${bits.toString("base64")}")\n`);
console.log("wrote app.png and app-icon.js");
