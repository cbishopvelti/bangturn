/* A fake GPS walker for the emulator tests (it has no GPS): feeds fixes
   with Bangle.emit("GPS", fix). Used by gps.test.js and walk.test.js.
   const w = walker(h); w.walk(5, 600) walks north at 5 kph for 10 min of
   GPS time, in a moment of real time. */
const KM_PER_DEG = 111.195;
const GPS_T0 = 1763580000000; // any time: the GPS clock needn't match the watch

/* A fake walker: keeps a position and a GPS clock, and feeds fixes to the
   watch. Distances in km, speeds in kph, times in seconds. */
function walker(h, opts) {
  const w = Object.assign({ lat: 51.5, lon: -0.12, t: GPS_T0 }, opts);
  const fixJS = (lat, lon, t, f) => {
    f = Object.assign({ fix: 1, alt: 0, speed: 0, course: 0, satellites: 8, hdop: 1 }, f);
    const time = f.time === null ? "" : `,time:new Date(${t})`;
    delete f.time;
    return `{lat:${lat},lon:${lon}${time},` + JSON.stringify(f).slice(1);
  };
  const dLat = km => km / KM_PER_DEG;
  const dLon = km => km / (KM_PER_DEG * Math.cos(w.lat * Math.PI / 180));

  /* one fix here and now; `f` overrides fields ({time:null} leaves it out) */
  w.fix = f => h.tx(`Bangle.emit("GPS",${fixJS(w.lat, w.lon, w.t, f)})`);
  /* a fix `north`/`east` km away from here, without moving the walker */
  w.fixAt = (north, east, f) =>
    h.tx(`Bangle.emit("GPS",${fixJS(w.lat + dLat(north), w.lon + dLon(east), w.t, f)})`);
  /* the GPS reporting that it has no fix */
  w.noFix = () => h.tx(`Bangle.emit("GPS",{fix:0,lat:NaN,lon:NaN,satellites:0,time:new Date(${w.t})})`);
  /* move without any fixes */
  w.move = (north, east) => { w.lon += dLon(east || 0); w.lat += dLat(north); };
  w.skip = sec => { w.t += sec * 1000; };
  /* walk at `kph` for `sec` seconds with a fix every `step` seconds.
     o.east: head east instead of north; o.south: head south; o.west: west;
     o.jitter: km each fix is off to the side, alternating left and right */
  w.walk = (kph, sec, o) => {
    o = o || {};
    const step = o.step || 1, km = kph * step / 3600;
    const sign = o.south ? -1 : 1;
    const ew = o.east || o.west;
    const a = ew ? 0 : sign * dLat(km), b = ew ? (o.west ? -1 : 1) * dLon(km) : 0;
    const ja = ew ? dLat(o.jitter || 0) : 0, jb = ew ? 0 : dLon(o.jitter || 0);
    let left = Math.round(sec / step);
    while (left > 0) { // in batches: emit() queues its events
      const n = Math.min(left, 40);
      h.tx(`(function(){var a=${w.lat},o=${w.lon},t=${w.t},j=1;for(var i=0;i<${n};i++){` +
        `a+=${a};o+=${b};t+=${step * 1000};j=-j;Bangle.emit("GPS",` +
        fixJS(`a+j*${ja}`, `o+j*${jb}`, "t") + `)}})()`);
      w.lat += a * n; w.lon += b * n; w.t += step * 1000 * n;
      left -= n;
    }
  };
  /* stand still for `sec` seconds while the fixes wander slowly round a
     circle of radius `r` km that passes through where you are */
  w.stand = (sec, r) => {
    const ra = dLat(r || 0), ro = dLon(r || 0), dth = r ? 0.001 / r : 0; // 1 m a second
    for (let i = 1; i <= sec; i += 40) {
      const n = Math.min(sec - i + 1, 40);
      h.tx(`(function(){for(var i=${i};i<${i + n};i++)Bangle.emit("GPS",` +
        fixJS(`${w.lat}+${ra}*Math.sin(i*${dth})`, `${w.lon}+${ro}*(1-Math.cos(i*${dth}))`, `${w.t}+i*1000`) + `)})()`);
    }
    w.t += sec * 1000;
  };
  return w;
}

module.exports = walker;
