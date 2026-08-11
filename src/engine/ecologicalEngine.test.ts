import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEcologicalEngine } = await import("./engine");
const { distanceMeters, movePoint } = await import("@/src/lib/geo");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");

// Alle disse testene bruker en MOCKET, synkron EnvironmentResolver — ingen
// nettverkskall. Dette er nøyaktig grensen §27 (determinisme, ingen eksternt
// kall) krever: selve scoringen (runEcologicalEngine) er ren og synkron,
// uansett hvor miljødataene til slutt kommer fra i appen.

const NOW_WINTER = new Date("2026-01-15T12:00:00.000Z").getTime();
const NOW_SPRING_LATE = new Date("2026-05-25T12:00:00.000Z").getTime();
const NOW_SUMMER = new Date("2026-07-01T12:00:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `eco-obs-${idCounter}`,
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: new Date(NOW_WINTER).toISOString(),
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

// ===========================================================================
// Vinterhjort – høyde/snø
// ===========================================================================

test("Vinterhjort: lavtliggende/snøfattig sone får høyere score enn høytliggende/snørik sone, uten noen observasjoner", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500); // vest, "dalbunn"
  const highPoint = movePoint(center.latitude, center.longitude, 90, 1500); // øst, "fjell"

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearLow = distanceMeters(p, lowPoint) < distanceMeters(p, highPoint);
    return {
      static: {
        ...UKJENT_STATIC_FEATURES,
        habitat: "skog" as const,
        relativeElevationMeters: nearLow ? -250 : 350,
      },
      dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: nearLow ? 0.05 : 0.55, temperatureC: nearLow ? 1 : -10 },
    };
  };

  const result = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1, "forventet minst én sone ut fra økologisk suitability alene");
  // Lavsiden er UNIFORMT bedre i dette (bevisst binære) miljøoppsettet, så
  // motoren fyller opp sonene sine derfra før den noen gang rekker
  // høytliggende/snørike celler — riktig oppførsel av grådig sone-utvinning
  // med et hardt maxZones-tak. Vi verifiserer derfor at INGEN av de dannede
  // sonene ligger nærmest det høytliggende/snørike punktet.
  for (const zone of result.zones) {
    assert.ok(
      distanceMeters(zone.center, lowPoint) < distanceMeters(zone.center, highPoint),
      `forventet at sone ${zone.id} (score ${zone.score}) ligger nærmest det lavtliggende/snøfattige punktet`
    );
  }
});

// ===========================================================================
// Vårtrekk
// ===========================================================================

test("Vårtrekk (elg): sent i vårtrekk-vinduet favoriseres høyereliggende områder", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // Bevisst asymmetriske avstander (1500 m / 1650 m) slik at ingen rutesenter
  // i det interne scoring-gridet kan havne nøyaktig på symmetrilinjen mellom
  // punktene — en ren geometrisk koinsidens ved eksakt symmetri, ikke noe
  // motoren skal vurderes etter.
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500);
  const highPoint = movePoint(center.latitude, center.longitude, 90, 1650);

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearLow = distanceMeters(p, lowPoint) < distanceMeters(p, highPoint);
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: nearLow ? -250 : 250 },
      dynamic: UKJENT_DYNAMIC_FEATURES,
    };
  };

  const result = runEcologicalEngine([], "elg", {
    now: NOW_SPRING_LATE,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  for (const zone of result.zones) {
    assert.ok(
      distanceMeters(zone.center, highPoint) < distanceMeters(zone.center, lowPoint),
      `forventet at sone ${zone.id} (score ${zone.score}) sent i vårtrekket ligger nærmest det høytliggende punktet`
    );
  }
});

// ===========================================================================
// Lokal observasjon overstyrer prior
// ===========================================================================

test("Lokal observasjon overstyrer prior: ecology favoriserer lavland, men ferske observasjoner høyere oppe flytter hovedsonen dit", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500);
  const highPoint = movePoint(center.latitude, center.longitude, 90, 1500);

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearLow = distanceMeters(p, lowPoint) < distanceMeters(p, highPoint);
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: nearLow ? -250 : 350 },
      dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: nearLow ? 0.05 : 0.55, temperatureC: nearLow ? 1 : -10 },
    };
  };

  const p2 = movePoint(highPoint.latitude, highPoint.longitude, 30, 60);
  const p3 = movePoint(highPoint.latitude, highPoint.longitude, 150, 60);
  const observations = [
    obs({ latitude: highPoint.latitude, longitude: highPoint.longitude, observationSource: "camera", cameraId: "camA", tid: new Date(NOW_WINTER).toISOString() }),
    obs({ latitude: p2.latitude, longitude: p2.longitude, observationSource: "camera", cameraId: "camB", tid: new Date(NOW_WINTER - 10 * 60000).toISOString() }),
    obs({ latitude: p3.latitude, longitude: p3.longitude, observationSource: "camera", cameraId: "camC", tid: new Date(NOW_WINTER - 20 * 60000).toISOString() }),
  ];

  const result = runEcologicalEngine(observations as never, "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  assert.ok(
    distanceMeters(result.zones[0].center, highPoint) < distanceMeters(result.zones[0].center, lowPoint),
    "forventet at tre ferske, lokale observasjoner flytter hovedsonen mot dem, til tross for at prior favoriserer lavlandet"
  );
});

// ===========================================================================
// Ingen observasjoner
// ===========================================================================

test("Ingen observasjoner: godt habitat gir en moderat sone med lav confidence, ikke ingenting og ikke skråsikkerhet", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "jordbruk" as const, relativeElevationMeters: -100 },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });

  const result = runEcologicalEngine([], "radyr", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 1000,
    environment,
  });

  assert.ok(result.zones.length >= 1, "forventet at god habitat-suitability alene kan danne en sone");
  assert.equal(result.zones[0].confidenceLevel, "lav", "ingen observasjoner bak sonen skal alltid gi lav confidence");
  assert.equal(result.zones[0].observationCount, 0);
  assert.ok(result.zones[0].score > 0 && result.zones[0].score < 100);
});

// ===========================================================================
// Temperatur – artsskillet
// ===========================================================================

test("Temperatur-artsskille: samme kalde vintertemperatur svekker hjort mer enn rådyr", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const cold = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 0 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, temperatureC: -15, snowDepthMeters: 0.4 },
  });
  const mild = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 0 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, temperatureC: 2, snowDepthMeters: 0 },
  });

  const hjortCold = runEcologicalEngine([], "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: cold });
  const hjortMild = runEcologicalEngine([], "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: mild });
  const radyrCold = runEcologicalEngine([], "radyr", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: cold });
  const radyrMild = runEcologicalEngine([], "radyr", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: mild });

  const hjortDrop = hjortMild.zones[0].score - hjortCold.zones[0].score;
  const radyrDrop = radyrMild.zones[0].score - radyrCold.zones[0].score;

  assert.ok(
    hjortDrop > radyrDrop,
    `forventet at hjort svekkes mer av kulde enn rådyr (hjort-fall=${hjortDrop}, rådyr-fall=${radyrDrop})`
  );
});

// ===========================================================================
// Sesongendring
// ===========================================================================

test("Sesongendring: identisk område og fravær av observasjoner, men dato endret fra vinter til sommer, endrer ecological suitability", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const highElevationCold = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 350 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.5, temperatureC: -8 },
  });

  const winterResult = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment: highElevationCold,
  });
  const summerResult = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment: highElevationCold,
  });

  assert.notEqual(
    winterResult.zones[0]?.score,
    summerResult.zones[0]?.score,
    "samme høytliggende/snørike/kalde punkt skal vurderes ulikt vinter vs. sommer (vintersnø-straffen gjelder kun om vinteren)"
  );
  assert.ok(
    (summerResult.zones[0]?.score ?? 0) > (winterResult.zones[0]?.score ?? 0),
    "det samme punktet skal scorer høyere om sommeren enn om vinteren når det er høytliggende og snørikt"
  );
});

// ===========================================================================
// Vind + terreng
// ===========================================================================

test("Vind + terreng: le-side (skråning bort fra vinden) scorer likt eller høyere enn vindeksponert side, aldri omvendt", async () => {
  const { computeSpatialSuitability } = await import("./ecology/suitability");
  const { HJORT_ECOLOGY_PROFILE } = await import("./ecology/hjort");

  const windDirection = 270; // vind FRA vest
  const dynamic = { ...UKJENT_DYNAMIC_FEATURES, windDirectionDeg: windDirection, windSpeedMs: 8 };

  const exposed = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "sommer",
    NOW_SUMMER,
    { ...UKJENT_STATIC_FEATURES, habitat: "skog", aspectDeg: 270 }, // skråningen vender rett mot vinden
    dynamic
  );
  const sheltered = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "sommer",
    NOW_SUMMER,
    { ...UKJENT_STATIC_FEATURES, habitat: "skog", aspectDeg: 90 }, // skråningen vender bort fra vinden (le)
    dynamic
  );

  assert.ok(
    sheltered.suitability >= exposed.suitability,
    `forventet le-siden (${sheltered.suitability}) >= vindeksponert side (${exposed.suitability})`
  );
});

// ===========================================================================
// Kanttilfeller
// ===========================================================================

test("Kanttilfelle: miljøoppslag som returnerer 'ukjent' for alt krasjer ikke", () => {
  const environment = () => ({ static: UKJENT_STATIC_FEATURES, dynamic: UKJENT_DYNAMIC_FEATURES });
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: { latitude: 60, longitude: 10 },
    areaRadiusMeters: 1000,
    environment,
  });
  assert.ok(Number.isFinite(result.confidence));
});

test("Determinisme: samme input (inkl. miljøresolver) gir samme output", () => {
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 50 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.1, temperatureC: -2 },
  });
  const options = { now: NOW_WINTER, areaCenter: { latitude: 60, longitude: 10 }, areaRadiusMeters: 800, environment };
  const r1 = runEcologicalEngine([], "hjort", options);
  const r2 = runEcologicalEngine([], "hjort", options);
  assert.deepEqual(r1, r2);
});
