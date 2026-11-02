// BUG 4 (V1.5) — jaktområde-polygon. Tester AT:
//  1) `huntAreaPolygon` utelatt => byte-identisk med dagens oppførsel (den
//     eksisterende engine.test.ts/ecologicalEngine.test.ts-suiten, UENDRET,
//     er den sterkeste formen for dette beviset — her testes det i tillegg
//     direkte: utelatt vs. eksplisitt `undefined` gir samme resultatobjekt).
//  2) Et gyldig polygon begrenser ALLE synlige resultater (soner, heatmap,
//     og dermed også `recommendedPosition` i huntPlan.ts, som bare returnerer
//     `zone.center` uendret — se huntPlan.ts sin egen dokumentasjon) til
//     polygonets innside, uten at grid.ts/huntPlan.ts er rørt.
//  3) `buildGridCells()` (grid.ts, UENDRET) aldri stille trunkerer et stort
//     jaktområde selv når `maxGridCells` tvinger cellestørrelsen opp.
//  4) Et polygon som geometrisk ikke kan treffe NOEN rute gir et EKSPLISITT
//     signal (`huntArea.matchedCellCount === 0`) i stedet for en stille,
//     tom sone-liste som ser identisk ut som "ingen dyreaktivitet".
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEngine, runEcologicalEngine } = await import("./engine");
const { buildGridCells } = await import("./grid");
const { getSpeciesProfile } = await import("./species/profiles");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { distanceMeters, movePoint, isPointInPolygon } = await import("@/src/lib/geo");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");

const NOW = new Date("2026-08-10T21:31:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `hunt-area-obs-${idCounter}`,
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: new Date(NOW).toISOString(),
    latitude: 60.0,
    longitude: 10.0,
    geohash: "u4",
    retning: null,
    antall: 1,
    observationSource: "manual",
    cameraId: null,
    cameraDirectionDegrees: null,
    sporType: null,
    kjonn: null,
    alder: null,
    ...overrides,
  };
}

/** Kvadratisk polygon (±sideMeters/2 i nord/øst) rundt et senterpunkt. */
function squarePolygon(center: { latitude: number; longitude: number }, sideMeters: number) {
  const half = sideMeters / 2;
  const n = movePoint(center.latitude, center.longitude, 0, half);
  const e = movePoint(center.latitude, center.longitude, 90, half);
  const s = movePoint(center.latitude, center.longitude, 180, half);
  const w = movePoint(center.latitude, center.longitude, 270, half);
  return [
    { latitude: n.latitude, longitude: w.longitude },
    { latitude: n.latitude, longitude: e.longitude },
    { latitude: s.latitude, longitude: e.longitude },
    { latitude: s.latitude, longitude: w.longitude },
  ];
}

// ===========================================================================
// 1) huntAreaPolygon utelatt => byte-identisk
// ===========================================================================

test("huntAreaPolygon utelatt vs. eksplisitt undefined gir byte-identisk EngineResult", () => {
  const clusterCenter = { latitude: 60.0, longitude: 10.0 };
  const observations = [
    obs({ latitude: clusterCenter.latitude, longitude: clusterCenter.longitude }),
    obs({ latitude: clusterCenter.latitude + 0.001, longitude: clusterCenter.longitude }),
  ];

  const withoutField = runEngine(observations as never, "hjort", { now: NOW, debug: true });
  const withExplicitUndefined = runEngine(observations as never, "hjort", { now: NOW, debug: true, huntAreaPolygon: undefined });

  assert.deepEqual(
    withExplicitUndefined,
    withoutField,
    "et utelatt huntAreaPolygon-felt og et eksplisitt undefined-felt MÅ gi nøyaktig samme resultat — feltet skal være en total no-op når det ikke er satt"
  );
});

test("huntAreaPolygon med under 3 punkter behandles identisk med 'ikke satt' (ingen filtrering)", () => {
  const clusterCenter = { latitude: 60.0, longitude: 10.0 };
  const observations = [obs({ latitude: clusterCenter.latitude, longitude: clusterCenter.longitude })];

  const baseline = runEngine(observations as never, "hjort", { now: NOW, debug: true });
  const withTwoPoints = runEngine(observations as never, "hjort", {
    now: NOW,
    debug: true,
    huntAreaPolygon: [clusterCenter, { latitude: clusterCenter.latitude + 0.01, longitude: clusterCenter.longitude }],
  });
  const withEmptyArray = runEngine(observations as never, "hjort", { now: NOW, debug: true, huntAreaPolygon: [] });

  assert.deepEqual(withTwoPoints, baseline, "under 3 punkter (2 her) skal IKKE utløse noen filtrering");
  assert.deepEqual(withEmptyArray, baseline, "et tomt array skal IKKE utløse noen filtrering");
  assert.equal(withTwoPoints.huntArea, undefined, "huntArea-feltet skal ikke settes når polygonet ikke var gyldig");
});

// ===========================================================================
// 2) Et gyldig polygon begrenser soner/heatmap til sin egen innside
// ===========================================================================

test("huntAreaPolygon: en sone som uten polygon ville dominert, men ligger UTENFOR polygonet, forsvinner helt — mens sonen innenfor forblir", () => {
  const clusterA = { latitude: 60.0, longitude: 10.0 };
  const clusterB = movePoint(clusterA.latitude, clusterA.longitude, 90, 5000); // 5 km øst — klart separat sone

  const observations = [
    obs({ latitude: clusterA.latitude, longitude: clusterA.longitude, observationSource: "camera", cameraId: "camA", antall: 1 }),
    obs({ latitude: clusterA.latitude + 0.0005, longitude: clusterA.longitude, antall: 1 }),
    // ClusterB får FLERE/ferskere observasjoner enn A — ville vært den sterkeste sonen totalt, uten polygon.
    obs({ latitude: clusterB.latitude, longitude: clusterB.longitude, observationSource: "camera", cameraId: "camB", antall: 3 }),
    obs({ latitude: clusterB.latitude + 0.0005, longitude: clusterB.longitude, antall: 3 }),
    obs({ latitude: clusterB.latitude, longitude: clusterB.longitude + 0.0005, antall: 2 }),
  ];

  const withoutPolygon = runEngine(observations as never, "hjort", { now: NOW });
  assert.ok(
    withoutPolygon.zones.some((z) => distanceMeters(z.center, clusterB) < 1000),
    "forutsetning: uten polygon skal clusterB (flest/ferskest) danne en reell sone, ellers tester vi ikke det reelle scenarioet"
  );

  const polygonAroundA = squarePolygon(clusterA, 1200);
  const result = runEngine(observations as never, "hjort", { now: NOW, huntAreaPolygon: polygonAroundA });

  assert.ok(result.zones.length >= 1, "forventet minst én sone innenfor polygonet rundt clusterA");
  for (const zone of result.zones) {
    assert.ok(
      isPointInPolygon(zone.center, polygonAroundA),
      `sone-senteret ${JSON.stringify(zone.center)} MÅ ligge innenfor det satte jaktområdet — dette ER også 'recommendedPosition' en jaktplan ville vist (huntPlan.ts' computeRecommendedPosition returnerer alltid zone.center uendret)`
    );
    assert.ok(distanceMeters(zone.center, clusterB) > 1000, "ingen sone skal kunne stamme fra clusterB, som ligger utenfor polygonet");
  }
  for (const point of result.heatmapPoints) {
    assert.ok(
      isPointInPolygon({ latitude: point.latitude, longitude: point.longitude }, polygonAroundA),
      "heatmap-gradienten skal heller ikke blø utenfor polygonet"
    );
  }
  assert.ok(result.huntArea && result.huntArea.matchedCellCount > 0, "huntArea-feltet skal rapportere et reelt antall treff-celler > 0");
});

test("huntAreaPolygon: fungerer identisk for runEcologicalEngine (observasjoner + økologisk prior)", () => {
  const clusterA = { latitude: 60.0, longitude: 10.0 };
  const clusterB = movePoint(clusterA.latitude, clusterA.longitude, 90, 5000);
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, spatialValidity: "valid_land" as const },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES },
  });

  const polygonAroundA = squarePolygon(clusterA, 1200);
  const result = runEcologicalEngine([], "hjort", {
    now: NOW,
    areaCenter: clusterA,
    areaRadiusMeters: 6000, // stort nok til at bbox også dekker clusterB
    environment,
    huntAreaPolygon: polygonAroundA,
  });

  assert.ok(result.zones.length >= 1, "ren økologisk prior, uten observasjoner, skal fortsatt kunne gi en sone innenfor polygonet");
  for (const zone of result.zones) {
    assert.ok(isPointInPolygon(zone.center, polygonAroundA), "samme garanti som for runEngine: sone-senter må ligge innenfor polygonet");
    assert.ok(distanceMeters(zone.center, clusterB) > 1000, "ingen sone fra clusterB-siden av det store analyseområdet");
  }
});

// ===========================================================================
// 3) Stort jaktområde => aldri stille trunkert av maxGridCells
// ===========================================================================

test("buildGridCells: et stort jaktområde skalerer cellestørrelsen opp, men dekker ALDRI stille et mindre areal enn det forespurte", () => {
  const profile = getSpeciesProfile("hjort");
  const center = { latitude: 60.0, longitude: 10.0 };
  const radiusMeters = 50000; // godt over det som gir <=2500 celler ved standard 150 m cellestørrelse

  const { cells, cellSizeMeters } = buildGridCells([], profile, DEFAULT_ENGINE_CONFIG, { center, radiusMeters });

  assert.ok(
    cellSizeMeters > DEFAULT_ENGINE_CONFIG.cellSizeMeters,
    `forventet at et så stort område tvinger cellestørrelsen opp fra standard ${DEFAULT_ENGINE_CONFIG.cellSizeMeters} m, fikk ${cellSizeMeters} m`
  );
  assert.ok(cells.length > 0 && cells.length <= DEFAULT_ENGINE_CONFIG.maxGridCells, "celletallet skal fortsatt respektere maxGridCells-taket");

  const maxDistFromCenter = Math.max(...cells.map((c) => distanceMeters(center, c)));
  assert.ok(
    maxDistFromCenter >= radiusMeters - cellSizeMeters,
    `rutenettet skal dekke omtrent helt ut til den forespurte radiusen (${radiusMeters} m) selv etter maxGridCells-skalering — fikk maks avstand ${maxDistFromCenter.toFixed(0)} m med cellestørrelse ${cellSizeMeters.toFixed(0)} m (dette er den eksplisitte verifikasjonen av at maxGridCells skalerer cellestørrelse, ALDRI kutter geografisk dekning)`
  );
});

// ===========================================================================
// 4) Polygon som ikke kan treffe noen rute => eksplisitt signal, ikke stille tomt
// ===========================================================================

test("huntAreaPolygon: et polygon utenfor det analyserte rutenettet gir et EKSPLISITT huntArea.matchedCellCount===0, ikke en stille tom sone-liste", () => {
  const analysisCenter = { latitude: 60.0, longitude: 10.0 };
  const observations = [obs({ latitude: analysisCenter.latitude, longitude: analysisCenter.longitude })];

  // Langt utenfor ethvert rutenett buildGridCells kunne generert for dette
  // analyseområdet (observasjon + standard padding) — polygonet er fortsatt
  // et helt gyldig (≥3 punkter, enkelt) polygon, det treffer bare ingenting.
  const farAwayPolygon = squarePolygon(movePoint(analysisCenter.latitude, analysisCenter.longitude, 0, 500000), 500);

  const result = runEngine(observations as never, "hjort", { now: NOW, huntAreaPolygon: farAwayPolygon });

  assert.equal(result.zones.length, 0, "ingen celler traff polygonet, så ingen soner kan (ærlig) rapporteres");
  assert.ok(result.huntArea, "huntArea-feltet skal være satt siden et gyldig (≥3 punkter) polygon ble gitt");
  assert.equal(
    result.huntArea?.matchedCellCount,
    0,
    "matchedCellCount===0 er det eksplisitte signalet UI-laget skal bruke til å vise 'område for lite/tynt', IKKE tolke som 'ingen dyreaktivitet funnet'"
  );
});
