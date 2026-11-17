/** WGS84 transverse Mercator, sixth-order Krueger series (angles exposed in degrees). */
export interface UtmCrs {
  zone: number;
  north: boolean;
}
export const WORLD = 40075016.68557849;
const R = 6378137,
  f = 1 / 298.257223563,
  n = f / (2 - f),
  e = Math.sqrt(f * (2 - f)),
  k0 = 0.9996;
const A = (R / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64 + n ** 6 / 256);
const alpha = [
  n / 2 -
    (2 * n * n) / 3 +
    (5 * n ** 3) / 16 +
    (41 * n ** 4) / 180 -
    (127 * n ** 5) / 288 +
    (7891 * n ** 6) / 37800,
  (13 * n * n) / 48 -
    (3 * n ** 3) / 5 +
    (557 * n ** 4) / 1440 +
    (281 * n ** 5) / 630 -
    (1983433 * n ** 6) / 1935360,
  (61 * n ** 3) / 240 -
    (103 * n ** 4) / 140 +
    (15061 * n ** 5) / 26880 +
    (167603 * n ** 6) / 181440,
  (49561 * n ** 4) / 161280 -
    (179 * n ** 5) / 168 +
    (6601661 * n ** 6) / 7257600,
  (34729 * n ** 5) / 80640 - (3418889 * n ** 6) / 1995840,
  (212378941 * n ** 6) / 319334400,
];
const beta = [
  n / 2 -
    (2 * n * n) / 3 +
    (37 * n ** 3) / 96 -
    n ** 4 / 360 -
    (81 * n ** 5) / 512 +
    (96199 * n ** 6) / 604800,
  (n * n) / 48 +
    n ** 3 / 15 -
    (437 * n ** 4) / 1440 +
    (46 * n ** 5) / 105 -
    (1118711 * n ** 6) / 3870720,
  (17 * n ** 3) / 480 -
    (37 * n ** 4) / 840 -
    (209 * n ** 5) / 4480 +
    (5569 * n ** 6) / 90720,
  (4397 * n ** 4) / 161280 - (11 * n ** 5) / 504 - (830251 * n ** 6) / 7257600,
  (4583 * n ** 5) / 161280 - (108847 * n ** 6) / 3991680,
  (20648693 * n ** 6) / 638668800,
];
const rad = Math.PI / 180;
export function parseCrs(crs: string): UtmCrs {
  const m = /^EPSG:(326|327)([0-9]{2})$/.exec(crs);
  const zone = m ? Number(m[2]) : 0;
  if (!m || zone < 1 || zone > 60)
    throw new Error("Choose a UTM coordinate system such as EPSG:32632.");
  return { zone, north: m[1] === "326" };
}
export function wgs84ToUtm(
  lon: number,
  lat: number,
  crs: UtmCrs,
): { x: number; y: number } {
  const lambda = (lon - (crs.zone * 6 - 183)) * rad,
    tau = Math.tan(lat * rad),
    sigma = Math.sinh(e * Math.atanh((e * tau) / Math.hypot(1, tau))),
    tp = tau * Math.hypot(1, sigma) - sigma * Math.hypot(1, tau);
  const xi = Math.atan2(tp, Math.cos(lambda)),
    eta = Math.asinh(Math.sin(lambda) / Math.hypot(tp, Math.cos(lambda)));
  let x = eta,
    y = xi;
  alpha.forEach((a, i) => {
    const j = 2 * (i + 1);
    x += a * Math.cos(j * xi) * Math.sinh(j * eta);
    y += a * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return { x: 500000 + k0 * A * x, y: (crs.north ? 0 : 10000000) + k0 * A * y };
}
export function utmToWgs84(
  x: number,
  y: number,
  crs: UtmCrs,
): { lon: number; lat: number } {
  const eta = (x - 500000) / (k0 * A),
    xi = (y - (crs.north ? 0 : 10000000)) / (k0 * A);
  let ep = eta,
    xp = xi;
  beta.forEach((b, i) => {
    const j = 2 * (i + 1);
    ep -= b * Math.cos(j * xi) * Math.sinh(j * eta);
    xp -= b * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  const tp = Math.sin(xp) / Math.hypot(Math.sinh(ep), Math.cos(xp));
  let tau = tp;
  for (let i = 0; i < 8; i++) {
    const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.hypot(1, tau))),
      actual = tau * Math.hypot(1, sigma) - sigma * Math.hypot(1, tau),
      delta =
        ((tp - actual) * (1 + (1 - e * e) * tau * tau)) /
        ((1 - e * e) * Math.hypot(1, tau) * Math.hypot(1, actual));
    tau += delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  return {
    lon: crs.zone * 6 - 183 + Math.atan2(Math.sinh(ep), Math.cos(xp)) / rad,
    lat: Math.atan(tau) / rad,
  };
}
export function wgs84ToMercator(
  lon: number,
  lat: number,
): { mx: number; my: number } {
  const limit = 85.0511287798066,
    phi = Math.max(-limit, Math.min(limit, lat)) * rad;
  return { mx: R * lon * rad, my: R * Math.asinh(Math.tan(phi)) };
}
export function mercatorToWgs84(
  mx: number,
  my: number,
): { lon: number; lat: number } {
  return { lon: mx / R / rad, lat: Math.atan(Math.sinh(my / R)) / rad };
}
export class Projection {
  readonly crs: UtmCrs;
  constructor(crs = "EPSG:32632") {
    this.crs = parseCrs(crs);
  }
  toMap(x: number, y: number): { mx: number; my: number } {
    const { lon, lat } = utmToWgs84(x, y, this.crs);
    return wgs84ToMercator(lon, lat);
  }
  fromMap(mx: number, my: number): { x: number; y: number } {
    const { lon, lat } = mercatorToWgs84(mx, my);
    return wgs84ToUtm(lon, lat, this.crs);
  }
}
/** Ground metres per Mercator metre at a Mercator northing. */
export function metresPerMapUnit(y: number): number {
  return 1 / Math.cosh(y / R);
}
export function tileAt(
  mx: number,
  my: number,
  z: number,
): { x: number; y: number } {
  const size = WORLD / 2 ** z;
  return {
    x: Math.floor((mx + WORLD / 2) / size),
    y: Math.floor((WORLD / 2 - my) / size),
  };
}
export function tileBounds(
  z: number,
  x: number,
  y: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const size = WORLD / 2 ** z;
  return {
    minX: -WORLD / 2 + x * size,
    maxX: -WORLD / 2 + (x + 1) * size,
    minY: WORLD / 2 - (y + 1) * size,
    maxY: WORLD / 2 - y * size,
  };
}
