import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// See src/lib/cameraActivity.test.ts / src/testSupport/nodeEsmTestLoader.mjs
// for why this hook is needed: plain `node --test` cannot resolve the
// extensionless relative specifier below on its own.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { distanceMeters, calcBearing, movePoint, vindRetningLabel, anonymiserPosisjon, buildSector, convexHull, gridBoundaryPolygon } =
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

// ---------------------------------------------------------------------------
// convexHull — V1.3 (§K/§L): brukt av src/engine/grid.ts sin extractZones()
// til å bygge zone.footprint.hull for polygon-rendering på kartet
// (app/kart.tsx). Presentasjonslaget stoler på at denne ALDRI kaster eller
// returnerer noe kartlaget ikke kan tegne — degenererte tilfeller (for få/
// identiske punkter, typisk for en liten enkelt-celle-sone) må derfor
// returnere noe trygt (punktene uendret) i stedet for å krasje.
// ---------------------------------------------------------------------------

test("convexHull: tomt input gir tomt output (ingen krasj)", () => {
  assert.deepEqual(convexHull([]), []);
});

test("convexHull: ett punkt returneres uendret (intet meningsfullt skrog under 3 punkter)", () => {
  const p = { latitude: 60.1, longitude: 10.1 };
  assert.deepEqual(convexHull([p]), [p]);
});

test("convexHull: to punkter returneres uendret", () => {
  const a = { latitude: 60.1, longitude: 10.1 };
  const b = { latitude: 60.2, longitude: 10.3 };
  assert.deepEqual(convexHull([a, b]), [a, b]);
});

test("convexHull: alle punkter identiske (under 3) returneres uendret, ikke NaN/krasj", () => {
  const p = { latitude: 60.1, longitude: 10.1 };
  const points = [p, { ...p }];
  const hull = convexHull(points);
  assert.equal(hull.length, 2);
  for (const h of hull) {
    assert.ok(Number.isFinite(h.latitude) && Number.isFinite(h.longitude));
  }
});

test("convexHull: mange identiske punkter (3+) degenererer trygt (ingen krasj, ingen NaN)", () => {
  const p = { latitude: 60.1, longitude: 10.1 };
  const points = Array.from({ length: 5 }, () => ({ ...p }));
  const hull = convexHull(points);
  assert.ok(hull.length >= 1, "forventet minst ett punkt i resultatet");
  for (const h of hull) {
    assert.ok(Number.isFinite(h.latitude) && Number.isFinite(h.longitude));
  }
});

test("convexHull: firkant med ett indre punkt returnerer nøyaktig de 4 hjørnene, ikke senterpunktet", () => {
  const corners = [
    { latitude: 60.0, longitude: 10.0 },
    { latitude: 60.0, longitude: 10.1 },
    { latitude: 60.1, longitude: 10.1 },
    { latitude: 60.1, longitude: 10.0 },
  ];
  const center = { latitude: 60.05, longitude: 10.05 };
  const hull = convexHull([...corners, center]);
  assert.equal(hull.length, 4, `forventet 4 hjørner i skroget, fikk ${hull.length}`);
  for (const c of corners) {
    assert.ok(hull.some((h) => h.latitude === c.latitude && h.longitude === c.longitude), `hjørne ${JSON.stringify(c)} mangler i skroget`);
  }
  assert.ok(!hull.some((h) => h.latitude === center.latitude && h.longitude === center.longitude), "det indre senterpunktet skal IKKE være med i skroget");
});

test("convexHull: alle returnerte punkter er blant de originale input-punktene (samme lat/lon-form, ikke en beregnet centroid)", () => {
  const points = [
    { latitude: 60.0, longitude: 10.0 },
    { latitude: 60.05, longitude: 10.08 },
    { latitude: 60.02, longitude: 10.15 },
    { latitude: 59.98, longitude: 10.07 },
    { latitude: 60.03, longitude: 10.03 },
  ];
  const hull = convexHull(points);
  for (const h of hull) {
    assert.ok(
      points.some((p) => p.latitude === h.latitude && p.longitude === h.longitude),
      `skroget inneholder et punkt ${JSON.stringify(h)} som ikke finnes i input`
    );
  }
});

// ---------------------------------------------------------------------------
// gridBoundaryPolygon — zone-hull-audit (§21/§22): erstattet convexHull() som
// PRIMÆR footprint-algoritme i src/engine/grid.ts sin extractZones(), fordi
// et EKTE konveks skrog viste seg (bekreftet med reelle motorkjøringer, se
// .e2e-scratch/diag-zone-hull-audit.mjs) å kunne "fylle igjen" reelt tomrom
// — inkl. vann-celler som ALDRI ble krevd — mellom to deler av en genuint
// sammenhengende, men ikke-konveks-formet sone (f.eks. to tette klynger
// forbundet av en smal "bro", akkurat brukerens egen skisse).
// ---------------------------------------------------------------------------

/** Lokalt meter-plan (samme projeksjon som geo.ts selv bruker) — kun til testberegninger her, ikke en del av selve API-et. */
function localPlane(refLat: number) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((refLat * Math.PI) / 180);
  return {
    toLatLng: (x: number, y: number, origin: { latitude: number; longitude: number }) => ({
      latitude: origin.latitude + y / metersPerDegLat,
      longitude: origin.longitude + x / metersPerDegLon,
    }),
  };
}

function shoelaceAreaM2(hull: { latitude: number; longitude: number }[]): number {
  if (hull.length < 3) return 0;
  const avgLat = hull.reduce((s, p) => s + p.latitude, 0) / hull.length;
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((avgLat * Math.PI) / 180);
  const xy = hull.map((p) => ({ x: p.longitude * metersPerDegLon, y: p.latitude * metersPerDegLat }));
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** Ray-casting point-in-polygon — kun til testformål (ikke presisjonskritisk her, bare innenfor/utenfor). */
function pointInPolygon(point: { latitude: number; longitude: number }, hull: { latitude: number; longitude: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const xi = hull[i].longitude, yi = hull[i].latitude;
    const xj = hull[j].longitude, yj = hull[j].latitude;
    const intersect = yi > point.latitude !== yj > point.latitude && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

test("gridBoundaryPolygon: under 3 celler faller trygt tilbake til convexHull()s degenererte oppførsel", () => {
  assert.deepEqual(gridBoundaryPolygon([], 150), []);
  const p = { latitude: 60.1, longitude: 10.1 };
  assert.deepEqual(gridBoundaryPolygon([p], 150), [p]);
  const q = { latitude: 60.2, longitude: 10.2 };
  assert.deepEqual(gridBoundaryPolygon([p, q], 150), [p, q]);
});

test("gridBoundaryPolygon: en solid 3×3-blokk med rutenett-celler gir en firkant med areal ~ (3×cellSize)²", () => {
  const cellSizeMeters = 150;
  const origin = { latitude: 60.0, longitude: 10.0 };
  const plane = localPlane(origin.latitude);
  const cells = [];
  for (let r = -1; r <= 1; r++) {
    for (let c = -1; c <= 1; c++) {
      cells.push(plane.toLatLng(c * cellSizeMeters, r * cellSizeMeters, origin));
    }
  }
  const hull = gridBoundaryPolygon(cells, cellSizeMeters);
  assert.equal(hull.length, 4, `forventet en firkant (4 hjørner) for en solid blokk, fikk ${hull.length}`);
  const area = shoelaceAreaM2(hull);
  const expected = (3 * cellSizeMeters) ** 2;
  assert.ok(Math.abs(area - expected) / expected < 0.01, `forventet areal ~${expected} m², fikk ${area.toFixed(0)} m²`);
});

test("gridBoundaryPolygon: ingen hjørne i resultatet ligger mer enn én cellebredde fra nærmeste faktiske krevde celle", () => {
  const cellSizeMeters = 150;
  const origin = { latitude: 60.0, longitude: 10.0 };
  const plane = localPlane(origin.latitude);
  // Hantel-formet klynge: to 3×3-blokker forbundet av en smal, én-celle-bred bro.
  const cells = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) cells.push(plane.toLatLng(c * cellSizeMeters, r * cellSizeMeters, origin));
  const dx = 3000;
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) cells.push(plane.toLatLng(dx + c * cellSizeMeters, r * cellSizeMeters, origin));
  for (let x = 2 * cellSizeMeters; x <= dx - 2 * cellSizeMeters; x += cellSizeMeters) cells.push(plane.toLatLng(x, 0, origin));

  const hull = gridBoundaryPolygon(cells, cellSizeMeters);
  assert.ok(hull.length >= 4, "forventet et ekte polygon for hantel-klyngen");
  for (const h of hull) {
    const nearest = Math.min(...cells.map((c) => distanceMeters(h, c)));
    assert.ok(nearest <= cellSizeMeters * 1.05, `hjørne ${JSON.stringify(h)} er ${nearest.toFixed(1)} m fra nærmeste krevde celle (over ${cellSizeMeters} m)`);
  }
});

test("gridBoundaryPolygon: en hantel-formet (konkav) klynge — to tette blokker + smal bro — hugger den faktiske broen, IKKE et konveks skrog som fyller igjen hele midten (den konkrete over-fylling-bugen fra zone-hull-audit)", () => {
  const cellSizeMeters = 150;
  const origin = { latitude: 60.0, longitude: 10.0 };
  const plane = localPlane(origin.latitude);
  const cells = [];
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) cells.push(plane.toLatLng(c * cellSizeMeters, r * cellSizeMeters, origin));
  const dx = 3000;
  for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) cells.push(plane.toLatLng(dx + c * cellSizeMeters, r * cellSizeMeters, origin));
  for (let x = 2 * cellSizeMeters; x <= dx - 2 * cellSizeMeters; x += cellSizeMeters) cells.push(plane.toLatLng(x, 0, origin));

  const newHull = gridBoundaryPolygon(cells, cellSizeMeters);
  const oldHull = convexHull(cells);

  // Et punkt midt mellom blokkene, men 100 m unna selve broens senterlinje —
  // altså tydelig utenfor den én-celle-brede broens faktiske footprint
  // (±75 m), men fortsatt innenfor den store konvekse innhyllingen av de to
  // 3×3-blokkenes hjørner (som strekker seg ±150 m i y-retning).
  const gapPoint = plane.toLatLng(dx / 2, 100, origin);

  assert.ok(pointInPolygon(gapPoint, oldHull), "forutsetning: det konvekse skroget MÅ dekke tomromspunktet (ellers tester vi ikke det reelle problemet)");
  assert.ok(!pointInPolygon(gapPoint, newHull), "rutenett-konturen skal IKKE påstå at tomrommet mellom broen og blokkenes ytterkant er del av sonen");

  const newArea = shoelaceAreaM2(newHull);
  const oldArea = shoelaceAreaM2(oldHull);
  assert.ok(newArea < oldArea, `forventet at rutenett-konturens areal (${newArea.toFixed(0)} m²) er mindre enn det konvekse skrogets (${oldArea.toFixed(0)} m²)`);
});
