// Solar position (NOAA-style low-precision formulas, ±0.5°), enough to pick day/night mode.
'use strict';
const SUN = (() => {
  const rad = Math.PI / 180;
  function elevation(date, lat, lng) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
    const ha = (gmst * 15 + lng) * rad - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
  }
  // next time (within 24 h) the sun crosses `alt` going up (rise) or down (set)
  function nextCrossing(from, lat, lng, alt = -0.833) {
    let prev = elevation(from, lat, lng);
    for (let m = 2; m <= 1440; m += 2) {
      const t = new Date(from.getTime() + m * 60000), e = elevation(t, lat, lng);
      if ((prev < alt) !== (e < alt)) return { time: t, rising: e >= alt };
      prev = e;
    }
    return null;
  }
  return { elevation, nextCrossing };
})();
