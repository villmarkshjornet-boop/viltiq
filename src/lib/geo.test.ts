import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// See src/lib/cameraActivity.test.ts / src/testSupport/nodeEsmTestLoader.mjs
// for why this hook is needed: plain `node --test` cannot resolve the
// extensionless relative specifier below on its own.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { distanceMeters, calcBearing, movePoint, vindRetningLabel, anonymiserPosisjon, buildSector } =
  await import("./geo");

// ---------------------------------------------------------------------------
// distanceMeters
// ---------------------------------------------------------------------------

test("distanceMeters: samme punkt gir 0 meter", () => {
  const p = { latitude: 60.39, longitude: 5.32 };
  assert.equal(distanceMeters(p, p), 0);
});

test("distanceMeters: 1 breddegrad tilsvarer ca. 111.19 km (jordas omkrets/360)", () => {
  const a = { latitude: 0, longitude: 0 };
  const b = { latitude: 1, longitude: 0 };
  const d = distanceMeters(a, b);
  assert.ok(Math.abs(d - 111194.93) < 1, `forventet ~111194.93 m, fikk ${d}`);
});

test("distanceMeters: symmetrisk (a->b == b->a)", () => {
  const a = { latitude: 59.9139, longitude: 10.7522 };
  const b = { latitude: 60.3913, longitude: 5.3221 };
  assert.equal(distanceMeters(a, b), distanceMeters(b, a));
});

// ---------------------------------------------------------------------------
// calcBearing
// ---------------------------------------------------------------------------

test("calcBearing: rett nord gir 0 grader", () => {
  const from = { latitude: 0, longitude: 0 };
  const to = { latitude: 1, longitude: 0 };
  assert.equal(calcBearing(from, to), 0);
});

test("calcBearing: rett øst gir 90 grader", () => {
  const from = { latitude: 0, longitude: 0 };
  const to = { latitude: 0, longitude: 1 };
  assert.equal(calcBearing(from, to), 90);
});

test("calcBearing: rett sør gir 180 grader", () => {
  const from = { latitude: 0, longitude: 0 };
  const to = { latitude: -1, longitude: 0 };
  assert.equal(calcBearing(from, to), 180);
});

test("calcBearing: rett vest gir 270 grader", () => {
  const from = { latitude: 0, longitude: 0 };
  const to = { latitude: 0, longitude: -1 };
  assert.equal(calcBearing(from, to), 270);
});

test("calcBearing: resultatet er alltid i [0, 360)", () => {
  const cases: [number, number][] = [
    [10, 10], [-10, 10], [10, -10], [-10, -10], [0, 0],
  ];
  for (const [dLat, dLon] of cases) {
    const b = calcBearing({ latitude: 0, longitude: 0 }, { latitude: dLat, longitude: dLon });
    assert.ok(b >= 0 && b < 360, `bearing ${b} utenfor [0, 360) for delta (${dLat}, ${dLon})`);
  }
});

// ---------------------------------------------------------------------------
// movePoint
// ---------------------------------------------------------------------------

test("movePoint: 0 meter gir nøyaktig samme punkt", () => {
  const p = movePoint(60.39, 5.32, 45, 0);
  assert.equal(p.latitude, 60.39);
  assert.equal(p.longitude, 5.32);
});

test("movePoint: nordover (0 grader) øker breddegrad og lar lengdegrad stå", () => {
  const p = movePoint(60, 10, 0, 1000);
  assert.ok(p.latitude > 60, `forventet økt breddegrad, fikk ${p.latitude}`);
  assert.equal(p.longitude, 10);
});

test("movePoint: østover (90 grader) øker lengdegrad", () => {
  const p = movePoint(60, 10, 90, 1000);
  assert.ok(p.longitude > 10, `forventet økt lengdegrad, fikk ${p.longitude}`);
  assert.ok(Math.abs(p.latitude - 60) < 1e-6, `forventet ~uendret breddegrad, fikk ${p.latitude}`);
});

test("movePoint: avstanden til startpunktet matcher distM (rundtur med distanceMeters)", () => {
  const start = { latitude: 60, longitude: 10 };
  const moved = movePoint(start.latitude, start.longitude, 200, 5000);
  const d = distanceMeters(start, moved);
  assert.ok(Math.abs(d - 5000) < 50, `forventet ~5000 m, fikk ${d}`);
});

test("movePoint: retningen fra startpunktet til det flyttede punktet matcher bearingDeg", () => {
  const start = { latitude: 60, longitude: 10 };
  const moved = movePoint(start.latitude, start.longitude, 123, 3000);
  const bearing = calcBearing(start, moved);
  assert.ok(Math.abs(bearing - 123) < 0.5, `forventet ~123 grader, fikk ${bearing}`);
});

// ---------------------------------------------------------------------------
// vindRetningLabel
// ---------------------------------------------------------------------------

test("vindRetningLabel: de åtte himmelretningene", () => {
  assert.equal(vindRetningLabel(0), "N");
  assert.equal(vindRetningLabel(45), "NØ");
  assert.equal(vindRetningLabel(90), "Ø");
  assert.equal(vindRetningLabel(135), "SØ");
  assert.equal(vindRetningLabel(180), "S");
  assert.equal(vindRetningLabel(225), "SV");
  assert.equal(vindRetningLabel(270), "V");
  assert.equal(vindRetningLabel(315), "NV");
});

test("vindRetningLabel: 360 grader vikler rundt til N", () => {
  assert.equal(vindRetningLabel(360), "N");
});

test("vindRetningLabel: verdier nær en grense rundes til nærmeste retning", () => {
  assert.equal(vindRetningLabel(22), "N");
  assert.equal(vindRetningLabel(23), "NØ");
});

// ---------------------------------------------------------------------------
// anonymiserPosisjon
// ---------------------------------------------------------------------------

test("anonymiserPosisjon: radius 0 gir nøyaktig samme punkt", () => {
  const p = anonymiserPosisjon(60.39, 5.32, 0);
  assert.equal(p.latitude, 60.39);
  assert.equal(p.longitude, 5.32);
});

test("anonymiserPosisjon: avviket er aldri større enn oppgitt radius", () => {
  const original = { latitude: 60.39, longitude: 5.32 };
  for (let i = 0; i < 200; i++) {
    const p = anonymiserPosisjon(original.latitude, original.longitude, 200);
    const d = distanceMeters(original, p);
    assert.ok(d <= 200 * 1.02, `avvik ${d} m overskrider radius 200 m (forsøk ${i})`);
  }
});

test("anonymiserPosisjon: gir ulike punkter ved gjentatte kall (ikke deterministisk)", () => {
  const p1 = anonymiserPosisjon(60.39, 5.32, 200);
  const p2 = anonymiserPosisjon(60.39, 5.32, 200);
  assert.ok(
    p1.latitude !== p2.latitude || p1.longitude !== p2.longitude,
    "forventet at to kall med samme input gir ulike (tilfeldige) punkter"
  );
});

// ---------------------------------------------------------------------------
// buildSector
// ---------------------------------------------------------------------------

test("buildSector: starter og slutter i senterpunktet", () => {
  const center = { latitude: 60, longitude: 10 };
  const coords = buildSector(center, 500, 90);
  assert.deepEqual(coords[0], center);
  assert.deepEqual(coords[coords.length - 1], center);
});

test("buildSector: antall punkter er steps + 3 (senter + steps+1 buepunkter + senter)", () => {
  const coords = buildSector({ latitude: 60, longitude: 10 }, 500, 90, 110, 24);
  assert.equal(coords.length, 24 + 3);
});

test("buildSector: alle buepunkter ligger innenfor oppgitt radius fra senteret", () => {
  const center = { latitude: 60, longitude: 10 };
  const radiusM = 500;
  const coords = buildSector(center, radiusM, 45, 110, 24);
  for (const c of coords) {
    const d = distanceMeters(center, c);
    assert.ok(d <= radiusM * 1.02, `punkt ${JSON.stringify(c)} er ${d} m fra senteret, over radius ${radiusM}`);
  }
});

test("buildSector: første og siste buepunkt matcher start- og sluttretningen i sektoren", () => {
  const center = { latitude: 60, longitude: 10 };
  const bearingDeg = 200;
  const spanDeg = 110;
  const coords = buildSector(center, 500, bearingDeg, spanDeg, 24);
  const first = coords[1]; // index 0 er senteret
  const last = coords[coords.length - 2]; // siste element er senteret
  const startBearing = calcBearing(center, first);
  const endBearing = calcBearing(center, last);
  const expectedStart = (bearingDeg - spanDeg / 2 + 360) % 360;
  const expectedEnd = (bearingDeg + spanDeg / 2 + 360) % 360;
  assert.ok(Math.abs(startBearing - expectedStart) < 0.5, `forventet startretning ~${expectedStart}, fikk ${startBearing}`);
  assert.ok(Math.abs(endBearing - expectedEnd) < 0.5, `forventet sluttretning ~${expectedEnd}, fikk ${endBearing}`);
});
