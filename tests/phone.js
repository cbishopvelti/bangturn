/* Phone GPS for the emulator tests: Android Integration ("Overwrite GPS")
   from BangleApps/apps/android, with a stand-in for the firmware's GPS
   power (see phoneGPS). Used by battery.test.js and watchgps.test.js. */
const fs = require("fs");
const path = require("path");
const { assert } = require("./harness");

const APPS = path.join(process.env.BANGLE_DIR || "/opt/bangle", "BangleApps");

async function phoneGPS(h, opt) {
  opt = opt || {};
  assert(fs.existsSync(path.join(APPS, "apps/android/lib.js")),
    "BangleApps/apps/android missing: run tests/setup-emulator.sh");
  const file = f => fs.readFileSync(path.join(APPS, "apps/android", f), "utf8");
  const put = (name, content) => h.tx(`require("Storage").write(${JSON.stringify(name)},${JSON.stringify(content)})`);
  put("0hw.boot.js", "Bangle.setGPSPower=function(on,id){if(!Bangle._PWR)Bangle._PWR={};" +
    "var l=Bangle._PWR.GPS||(Bangle._PWR.GPS=[]);id=id===undefined?'?':''+id;var i=l.indexOf(id);" +
    "if(on){if(i<0)l.push(id)}else if(i>=0)l.splice(i,1);if(!l.length)delete Bangle._PWR.GPS;" +
    "return global.GPS_HW=l.length>0};Bangle.isGPSOn=function(){return !!global.GPS_HW};" +
    "Bangle.getGPSFix=function(){return global.GPS_HW?{fix:0}:undefined};" +
    // what the android app sends to the phone (the emulator has no Bluetooth.println)
    'global.GBOUT=[];Bluetooth.println=function(s){if(s){s=JSON.parse(s);if(s.t=="gps_power")GBOUT.push(s.status)}};\n' +
    // bt: Bluetooth is connected, and BangTurn waits opt.wait ms for the phone
    (opt.bt ? "NRF.getSecurityStatus=function(){return {connected:!global.BT_DOWN}};" +
      `require("bangturn.speed").PHONE_WAIT=${opt.wait || 1500};\n` : ""));
  put("android", file("lib.js"));
  put("android.boot.js", file("boot.js"));
  h.tx(`require("Storage").writeJSON("android.settings.json",{overwriteGps:true,keep:true})`);
  await h.load();
  assert(h.eval("!!Bangle.moveGPSPower"), "Overwrite GPS is installed");
}
const phoneFix = h => h.tx(`GB({t:"gps",lat:51.5,lon:-0.12,alt:0,speed:0,course:0,time:Date.now(),satellites:8,hdop:1,externalSource:true})`);
const hw = h => h.eval("!!global.GPS_HW");
const lastAsk = h => h.eval("GBOUT[GBOUT.length-1]"); // last gps_power sent to the phone

module.exports = { phoneGPS, phoneFix, hw, lastAsk };
