// When the sun rises and sets over Paris, so the map can be at night when
// the city is. The usual low-precision sunrise equation: good to a few minutes.

const RAD = Math.PI / 180;
const LAT = 48.8566, LON = 2.3522;
/** Julian date of a time in ms, and back. */
const toJulian = (ms: number) => ms / 86400000 + 2440587.5;
const fromJulian = (j: number) => (j - 2440587.5) * 86400000;

/** Sunrise and sunset (ms since the epoch) of the day `now` falls in. */
export function parisSun(now: number): { rise: number; set: number } {
  // Days since noon on 1 January 2000, to the nearest noon: the solar day we're in.
  const n = Math.round(toJulian(now) - 2451545 + LON / 360);
  const mean = n - LON / 360;
  const M = ((357.5291 + 0.98560028 * mean) % 360) * RAD;
  const centre = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
  const lambda = ((M / RAD + centre + 180 + 102.9372) % 360) * RAD;
  const transit = 2451545 + mean + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);
  const decl = Math.asin(Math.sin(lambda) * Math.sin(23.4397 * RAD));
  // The sun's centre 0.833° below the horizon: its top edge, through the air's bending.
  const hour = Math.acos((Math.sin(-0.833 * RAD) - Math.sin(LAT * RAD) * Math.sin(decl)) / (Math.cos(LAT * RAD) * Math.cos(decl))) / RAD;
  return { rise: fromJulian(transit - hour / 360), set: fromJulian(transit + hour / 360) };
}

/** Whether it's dark in Paris at `now`. */
export function parisNight(now: number) {
  const { rise, set } = parisSun(now);
  return now < rise || now > set;
}
