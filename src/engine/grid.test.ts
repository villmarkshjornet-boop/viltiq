import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { extractZones } = await import("./grid");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");

// § kritisk korrigering (V1.2 §8-9): extractZones hadde INGEN egen
// testdekning før denne filen — kun indirekte via engine.test.ts/
// ecologicalEngine.test.ts sine helhetlige scenarioer. Disse testene
// dekker connected-component/watershed-klyngingen direkte og isolert, med
// syntetiske ScoredCell-lister (ingen avhengighet av økologi-/miljølaget).

const cfg = DEFAULT_ENGINE_CONFIG;
const cellSizeMeters = 150;
const mergeRadiusMeters = 450; // hjort-typisk (baseRadiusMeters 300 × 1.5)
const emptyBreakdown = { recency: 0, repetition: 0, cameraDirection: 0, movementDirection: 0, cameraDiversity: 0, corridor: 0, ecology: 0 };

/**
 * Bygger et tett, kvadratisk rutenett av ScoredCell rundt `center`, med
 * `scoreFn(distFromCenter)` som scoremodell. `validityFn` er valgfri (default
 * "valid_land" for alle celler) — kun de vann-spesifikke testene under
 * trenger å overstyre den.
 */
function buildCellGrid(
  center: { latitude: number; longitude: number },
  spanMeters: number,
  scoreFn: (dist: number) => number,
  validityFn: (point: { latitude: number; longitude: number }, dist: number) => "valid_land" | "water" | "invalid" | "unknown" = () => "valid_land"
) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((center.latitude * Math.PI) / 180);
  const steps = Math.round(spanMeters / cellSizeMeters);
  const cells = [];
  for (let r = -steps; r <= steps; r++) {
    for (let c = -steps; c <= steps; c++) {
      const point = {
        latitude: center.latitude + (r * cellSizeMeters) / metersPerDegLat,
        longitude: center.longitude + (c * cellSizeMeters) / metersPerDegLon,
      };
      const dist = distanceMeters(point, center);
      const score = scoreFn(dist);
      cells.push({ center: point, score, breakdown: { ...emptyBreakdown, ecology: score }, validity: validityFn(point, dist) });
    }
  }
  return cells;
}

test("extractZones: én sammenhengende, flat habitat-plateau blir ÉN sone, ikke fem-seks identiske", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // 700 m radius platå — nøyaktig audit-scenarioet som tidligere ga 5 identiske soner.
  const cells = buildCellGrid(center, 1200, (dist) => (dist < 700 ? 0.9 : 0.1));
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1, `forventet nøyaktig 1 sone fra ett sammenhengende platå, fikk ${zones.length}`);
  assert.ok(distanceMeters(zones[0].center, center) < 700, "sonens senter skal ligge inne i platået");
});

test("extractZones: to geografisk separate gode områder blir to hotspots — slås IKKE sammen", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const areaA = movePoint(center.latitude, center.longitude, 270, 3000); // vest
  const areaB = movePoint(center.latitude, center.longitude, 90, 3000); // øst, 6 km fra A
  const cells = [
    ...buildCellGrid(areaA, 600, (dist) => (dist < 400 ? 0.9 : 0.05)),
    ...buildCellGrid(areaB, 600, (dist) => (dist < 400 ? 0.85 : 0.05)),
  ];
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 2, `forventet nøyaktig 2 separate soner, fikk ${zones.length}`);
  const distAtoB = distanceMeters(zones[0].center, zones[1].center);
  assert.ok(distAtoB > 5000, `forventet at de to sonene forblir langt fra hverandre (ikke slått sammen), fikk ${distAtoB.toFixed(0)} m`);
});

test("extractZones: tre reelt separate områder forsvinner ikke selv om ett av dem er et stort platå som ellers ville brukt opp maxZones", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const areaA = movePoint(center.latitude, center.longitude, 270, 4000);
  const areaB = movePoint(center.latitude, center.longitude, 90, 4000);
  const areaC = movePoint(center.latitude, center.longitude, 0, 4000);
  const cells = [
    ...buildCellGrid(areaA, 700, (dist) => (dist < 700 ? 0.9 : 0.05)), // stort platå — ville fragmentert før V1.2
    ...buildCellGrid(areaB, 300, (dist) => (dist < 200 ? 0.7 : 0.05)),
    ...buildCellGrid(areaC, 300, (dist) => (dist < 200 ? 0.6 : 0.05)),
  ];
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 3, `forventet at alle tre reelt separate områder overlever som egne soner, fikk ${zones.length}`);
});

test("extractZones: én observasjons jevnt Gaussisk-avtagende score-hale gir ÉN sone, ikke flere konsentriske ringer", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // Simulerer distanceWeight-aktig Gaussisk falloff fra ett enkelt punkt —
  // INGEN flat plateau, en kontinuerlig avtagende gradient (samme type
  // score-felt én ferske observasjon faktisk produserer via signals.ts).
  const radius = 300;
  const cells = buildCellGrid(center, 1500, (dist) => 0.5 * Math.exp(-0.5 * (dist / radius) ** 2) + 0.05);
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1, `forventet ÉN sone fra en enkelt Gaussisk topp, fikk ${zones.length} (mulig gjeninnføring av ring-fragmentering)`);
});

test("extractZones: en STERK enkelt-observasjons Gaussisk topp gir fortsatt ÉN sone, ikke seks (V1.2.2 kritisk korrigering)", () => {
  // KRITISK REGRESJONSTEST — funnet under V1.2.2s multi-zone-testmatrise:
  // testen over (amplitude 0.5) fanget IKKE denne bugen, fordi bare STERKE
  // topper er sterke nok til at halen forblir "relevant" (over minZoneScore)
  // godt utenfor mergeRadiusMeters (450 m), i et "foreldreløst" belte verken
  // regel (a) (for langt fra toppen) eller regel (b) (for bratt hopp-til-
  // hopp-fall) dekker. Før fiksen (se grid.ts sin findAbsorbingZone) ga
  // NØYAKTIG denne konstruksjonen (peak≈9.66, radius=300 m) 6 konsentriske
  // ring-soner i stedet for 1 — reproduserer en realistisk "mange
  // observasjoner på samme sted" (f.eks. et fôringssted/en fast trasé), som
  // ellers ville vist som flere falske "nærliggende" hotspots i UI-et.
  const center = { latitude: 60.0, longitude: 10.0 };
  const radius = 300;
  const peak = 9.66;
  const cells = buildCellGrid(center, 1500, (dist) => peak * Math.exp(-0.5 * (dist / radius) ** 2) + 0.02);
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1, `forventet ÉN sone fra en sterk enkelt Gaussisk topp, fikk ${zones.length} (ring-fragmentering er tilbake)`);
});

// ===========================================================================
// V1.3 §K/§L: zone footprint (footprintCells/footprintHull) — den faktiske
// geografiske utstrekningen, ikke en kunstig sirkel rundt center.
// ===========================================================================

test("extractZones: footprint har flere krevde celler for et bredt platå, og skroget omslutter platåets senter", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const cells = buildCellGrid(center, 700, (dist) => (dist < 700 ? 0.9 : 0.05));
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1);
  const zone = zones[0];
  assert.ok(zone.footprintCells.length > 10, `forventet mange krevde celler for et 700 m platå, fikk ${zone.footprintCells.length}`);
  assert.ok(zone.footprintHull.length >= 3, `forventet et ekte polygon (>=3 hjørner), fikk ${zone.footprintHull.length}`);
  // Alle footprint-cellene skal faktisk ligge innenfor platået som ble bygget (< 700 m fra senter).
  for (const c of zone.footprintCells) {
    assert.ok(distanceMeters(c, center) < 900, "en footprint-celle skal ikke ligge langt utenfor det scorede platået");
  }
});

test("extractZones: to separate soner får hver sitt EGNE, ikke-overlappende footprint", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const areaA = movePoint(center.latitude, center.longitude, 270, 3000);
  const areaB = movePoint(center.latitude, center.longitude, 90, 3000);
  const cells = [
    ...buildCellGrid(areaA, 600, (dist) => (dist < 400 ? 0.9 : 0.05)),
    ...buildCellGrid(areaB, 600, (dist) => (dist < 400 ? 0.85 : 0.05)),
  ];
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 2);
  assert.ok(zones[0].footprintCells.length > 0 && zones[1].footprintCells.length > 0, "begge soner skal ha egne footprint-celler");
  // Sone A sine footprint-celler skal alle ligge nær areaA, ikke areaB (og omvendt).
  const zoneNearA = distanceMeters(zones[0].center, areaA) < distanceMeters(zones[0].center, areaB) ? zones[0] : zones[1];
  for (const c of zoneNearA.footprintCells) {
    assert.ok(distanceMeters(c, areaA) < distanceMeters(c, areaB), "footprint-celler skal ikke lekke over til den andre sonens område");
  }
});

test("extractZones: sonens radius reflekterer platåets faktiske utstrekning, men er tak-begrenset (aldri urealistisk kjempestor)", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // Et EKSTREMT stort platå (2 km radius) — skal gi en stor, men fornuftig
  // tak-begrenset sone, ikke en sone som påstår å dekke hele analyseområdet.
  const cells = buildCellGrid(center, 2500, (dist) => (dist < 2000 ? 0.9 : 0.05));
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1);
  assert.ok(zones[0].radiusMeters <= mergeRadiusMeters * 3 + 1, `forventet at radius er tak-begrenset til ${mergeRadiusMeters * 3} m, fikk ${zones[0].radiusMeters}`);
  assert.ok(zones[0].radiusMeters > mergeRadiusMeters, "forventet at et genuint stort platå likevel gir en STØRRE radius enn artens vanlige minimum");
});

test("extractZones: ingen relevante celler gir tom soneliste, krasjer ikke", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const cells = buildCellGrid(center, 500, () => 0.01); // alt under terskel
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.deepEqual(zones, []);
});

// ===========================================================================
// zone-hull-audit (§19/§20): direkte, isolert unit-test av selve
// adjacency-TERSKELEN extractZones() bruker under klyngingen
// (`adjacencyThreshold = cellSizeMeters * 1.5`, se filkommentaren i grid.ts).
// To ISOLERTE punkt-celler (ingen fylling-celler mellom dem som kunne
// "kjede" dem sammen via et mellomledd) plasseres på en PRESIST kontrollert
// avstand fra hverandre — rett under vs. rett over terskelen — slik at det
// eneste som avgjør om de havner i samme sone er selve
// distanceMeters()-sjekken mot adjacencyThreshold, ikke score/mergeRadius
// (begge cellene er godt innenfor mergeRadiusMeters uansett, se
// findAbsorbingZone/flood-fill sin rekkefølge av sjekker i grid.ts).
// ===========================================================================

test("extractZones: adjacency-terskel (cellSizeMeters*1.5) — to punkt-celler 224 m fra hverandre (under 225 m-terskelen) slås sammen til ÉN sone", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const other = movePoint(center.latitude, center.longitude, 90, 224); // 224 m < 150*1.5=225 m
  const cells = [
    { center, score: 10, breakdown: emptyBreakdown, validity: "valid_land" as const },
    { center: other, score: 9.9, breakdown: emptyBreakdown, validity: "valid_land" as const },
  ];
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1, `224 m er under adjacencyThreshold (225 m) — forventet at cellene slås sammen til 1 sone, fikk ${zones.length}`);
  assert.equal(zones[0].footprintCells.length, 2, "begge cellene skal være krevd av den ene sonen");
});

test("extractZones: adjacency-terskel (cellSizeMeters*1.5) — to punkt-celler 226 m fra hverandre (over 225 m-terskelen) forblir TO separate soner", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const other = movePoint(center.latitude, center.longitude, 90, 226); // 226 m > 150*1.5=225 m
  const cells = [
    { center, score: 10, breakdown: emptyBreakdown, validity: "valid_land" as const },
    { center: other, score: 9.9, breakdown: emptyBreakdown, validity: "valid_land" as const },
  ];
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 2, `226 m er over adjacencyThreshold (225 m) — forventet at cellene forblir 2 separate soner, fikk ${zones.length}`);
});

test("extractZones: adjacency-terskelen skalerer med FAKTISK cellSizeMeters, ikke en hardkodet konstant (§ brukeradvarsel: 'Ikke hardkod 150')", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const largeCellSize = 400; // adjacencyThreshold = 600 m
  const withinThreshold = movePoint(center.latitude, center.longitude, 90, 590);
  const beyondThreshold = movePoint(center.latitude, center.longitude, 90, 610);

  const mergedZones = extractZones(
    [
      { center, score: 10, breakdown: emptyBreakdown, validity: "valid_land" as const },
      { center: withinThreshold, score: 9.9, breakdown: emptyBreakdown, validity: "valid_land" as const },
    ],
    largeCellSize,
    mergeRadiusMeters,
    cfg
  );
  assert.equal(mergedZones.length, 1, "590 m skal være innenfor 400×1.5=600 m-terskelen for en 400 m celle-størrelse");

  const splitZones = extractZones(
    [
      { center, score: 10, breakdown: emptyBreakdown, validity: "valid_land" as const },
      { center: beyondThreshold, score: 9.9, breakdown: emptyBreakdown, validity: "valid_land" as const },
    ],
    largeCellSize,
    mergeRadiusMeters,
    cfg
  );
  assert.equal(splitZones.length, 2, "610 m skal være utenfor 400×1.5=600 m-terskelen for en 400 m celle-størrelse");
});

// ===========================================================================
// zone-hull-audit (§21/§22): extractZones() sin footprintHull skal hugge en
// genuint hantel-formet (konkav) sone, ikke fylle igjen midten som et
// konveks skrog ville gjort. Selve konkavitets-beviset (punkt-i-polygon,
// areal-sammenligning mot det gamle konvekse skroget) er den ISOLERTE,
// deterministiske testen av gridBoundaryPolygon() i src/lib/geo.test.ts —
// denne testen dekker i tillegg at extractZones() faktisk KOBLER
// footprintHull til gridBoundaryPolygon() (ikke bare at funksjonen isolert
// sett virker), ved å bygge en ekte hantel-formet, sammenhengende
// (bekreftet: 1 sone) klynge gjennom hele extractZones()-pipelinen.
// ===========================================================================

test("extractZones: en hantel-formet sammenhengende sone (to tette blokker + smal bro) får et footprint-hull som hugger broen, ikke et konveks skrog", () => {
  const blockA = { latitude: 60.0, longitude: 10.0 };
  const blockB = movePoint(blockA.latitude, blockA.longitude, 90, 3000);
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((blockA.latitude * Math.PI) / 180);
  const bridgeCells = [];
  for (let x = 2 * cellSizeMeters; x <= 3000 - 2 * cellSizeMeters; x += cellSizeMeters) {
    const point = { latitude: blockA.latitude, longitude: blockA.longitude + x / metersPerDegLon };
    bridgeCells.push({ center: point, score: 5, breakdown: emptyBreakdown, validity: "valid_land" as const });
  }
  const cells = [
    ...buildCellGrid(blockA, 220, (dist) => (dist < 220 ? 5 : 0.01)),
    ...buildCellGrid(blockB, 220, (dist) => (dist < 220 ? 5 : 0.01)),
    ...bridgeCells,
  ];
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1, `forventet at broen faktisk kobler blokkene til ÉN sammenhengende sone, fikk ${zones.length}`);
  const zone = zones[0];
  const hull = zone.footprintHull;
  assert.ok(hull.length >= 4, "forventet et ekte polygon for hantel-sonen");

  // Et punkt midtveis på broen, men 100 m unna selve senterlinjen — utenfor
  // den én-celle-brede broens faktiske footprint (±75 m), men innenfor det
  // konvekse skroget en tidligere versjon av denne koden ville tegnet.
  const gapPoint = {
    latitude: blockA.latitude + 100 / metersPerDegLat,
    longitude: blockA.longitude + 1500 / metersPerDegLon,
  };
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const xi = hull[i].longitude, yi = hull[i].latitude;
    const xj = hull[j].longitude, yj = hull[j].latitude;
    const intersect = yi > gapPoint.latitude !== yj > gapPoint.latitude && gapPoint.longitude < ((xj - xi) * (gapPoint.latitude - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  assert.ok(!inside, "footprint-hullet skal IKKE påstå at tomrommet 100 m fra den smale broens senterlinje er del av den anbefalte sonen");
});

test("extractZones: respekterer maxZones selv med mange reelt separate områder", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const cells = [];
  for (let i = 0; i < 10; i++) {
    const p = movePoint(center.latitude, center.longitude, i * 36, 5000);
    cells.push(...buildCellGrid(p, 200, (dist) => (dist < 150 ? 0.8 - i * 0.01 : 0.02)));
  }
  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.ok(zones.length <= cfg.zones.maxZones, `forventet maks ${cfg.zones.maxZones} soner, fikk ${zones.length}`);
});
