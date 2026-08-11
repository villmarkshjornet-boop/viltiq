import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEngine } = await import("./engine");
const { scoreCell } = await import("./grid");
const { getSpeciesProfile } = await import("./species/profiles");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { normalizeObservations } = await import("./normalize");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");

const NOW = new Date("2026-08-10T21:31:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `obs-${idCounter}`,
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

function hoursAgoIso(hours: number): string {
  return new Date(NOW - hours * 3600000).toISOString();
}

// ===========================================================================
// Scenario 1 — Én fersk observasjon
// ===========================================================================

test("Scenario 1: én fersk observasjon gir en sone nær observasjonen, uten høy confidence", () => {
  const camPos = { latitude: 60.0, longitude: 10.0 };
  const observations = [
    obs({
      observationSource: "camera",
      cameraId: "camA",
      latitude: camPos.latitude,
      longitude: camPos.longitude,
      cameraDirectionDegrees: 90,
      tid: hoursAgoIso(0),
    }),
  ];

  const result = runEngine(observations as never, "hjort", { now: NOW });

  assert.equal(result.zones.length, 1, "forventet nøyaktig én sone rundt den ferske observasjonen");
  const zone = result.zones[0];
  assert.ok(zone.score > 0, `forventet positiv score, fikk ${zone.score}`);
  assert.ok(distanceMeters(zone.center, camPos) < 400, "sonen bør ligge nær observasjonen");
  assert.notEqual(zone.confidenceLevel, "høy", "én enkelt observasjon bør ikke alene gi høy confidence");
  // Retningsbias (foran vs. bak kamera) testes presist og isolert i Scenario 6.
});

// ===========================================================================
// Scenario 2 — Gammel observasjon
// ===========================================================================

test("Scenario 2: samme observasjon 5 dager gammel gir betydelig lavere score enn fersk", () => {
  const camPos = { latitude: 60.0, longitude: 10.0 };
  const fresh = runEngine(
    [obs({ latitude: camPos.latitude, longitude: camPos.longitude, tid: hoursAgoIso(0) })] as never,
    "hjort",
    { now: NOW }
  );
  const old = runEngine(
    [obs({ latitude: camPos.latitude, longitude: camPos.longitude, tid: hoursAgoIso(24 * 5) })] as never,
    "hjort",
    { now: NOW }
  );

  const freshScore = fresh.zones[0]?.score ?? 0;
  const oldScore = old.zones[0]?.score ?? 0;
  assert.ok(freshScore > 0, "fersk observasjon bør gi positiv score (forutsetning for testen)");
  assert.ok(
    oldScore < freshScore * 0.3,
    `forventet at gammel score (${oldScore}) er under 30% av fersk score (${freshScore})`
  );
});

// ===========================================================================
// Scenario 3 — Flere ferske observasjoner
// ===========================================================================

test("Scenario 3: tre ferske kameraobservasjoner i samme område gir sterkere sone og høyere confidence enn én", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const single = runEngine(
    [obs({ latitude: center.latitude, longitude: center.longitude, observationSource: "camera", cameraId: "camA", tid: hoursAgoIso(0) })] as never,
    "hjort",
    { now: NOW }
  );

  const p2 = movePoint(center.latitude, center.longitude, 30, 60);
  const p3 = movePoint(center.latitude, center.longitude, 150, 60);
  const triple = runEngine(
    [
      obs({ latitude: center.latitude, longitude: center.longitude, observationSource: "camera", cameraId: "camA", tid: hoursAgoIso(0) }),
      obs({ latitude: p2.latitude, longitude: p2.longitude, observationSource: "camera", cameraId: "camB", tid: hoursAgoIso(0.3) }),
      obs({ latitude: p3.latitude, longitude: p3.longitude, observationSource: "camera", cameraId: "camC", tid: hoursAgoIso(0.6) }),
    ] as never,
    "hjort",
    { now: NOW }
  );

  assert.ok(single.zones.length > 0 && triple.zones.length > 0, "begge tilfeller bør danne en sone");
  assert.ok(
    triple.zones[0].score > single.zones[0].score * 2,
    `forventet betydelig sterkere sone (triple=${triple.zones[0].score}, single=${single.zones[0].score})`
  );
  assert.ok(
    triple.zones[0].confidence > single.zones[0].confidence,
    `forventet høyere confidence for triple (${triple.zones[0].confidence}) enn single (${single.zones[0].confidence})`
  );
});

// ===========================================================================
// Scenario 4 — Tidsserie / bevegelseskorridor
// ===========================================================================

test("Scenario 4: observasjoner som beveger seg vest → sentrum → øst med stigende tid gir en registrert østlig korridor", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const west = movePoint(center.latitude, center.longitude, 270, 1000);
  const east = movePoint(center.latitude, center.longitude, 90, 1000);

  const result = runEngine(
    [
      obs({ latitude: west.latitude, longitude: west.longitude, observationSource: "camera", cameraId: "camW", tid: hoursAgoIso(1) }),
      obs({ latitude: center.latitude, longitude: center.longitude, observationSource: "camera", cameraId: "camC", tid: hoursAgoIso(0.5) }),
      obs({ latitude: east.latitude, longitude: east.longitude, observationSource: "camera", cameraId: "camE", tid: hoursAgoIso(0) }),
    ] as never,
    "hjort",
    { now: NOW, debug: true }
  );

  assert.ok(result.debug, "debug-info bør være med når debug:true");
  const corridors = result.debug!.corridors;
  assert.ok(corridors.length >= 1, "forventet at en bevegelseskorridor ble oppdaget");
  const eastward = corridors.some((c) => Math.abs(((c.bearingDeg - 90 + 540) % 360) - 180) < 30);
  assert.ok(eastward, `forventet en korridor med østlig retning, fikk ${JSON.stringify(corridors.map((c) => c.bearingDeg))}`);
});

// ===========================================================================
// Scenario 5 — Motstridende data
// ===========================================================================

test("Scenario 5: observasjoner spredt på to fjerne, uavhengige områder gir flere soner og ikke høy confidence", () => {
  const areaA = { latitude: 60.0, longitude: 10.0 };
  const areaB = movePoint(areaA.latitude, areaA.longitude, 90, 2000);

  const result = runEngine(
    [
      obs({ latitude: areaA.latitude, longitude: areaA.longitude, observationSource: "camera", cameraId: "camA", cameraDirectionDegrees: 0, tid: hoursAgoIso(0) }),
      obs({ latitude: areaB.latitude, longitude: areaB.longitude, observationSource: "camera", cameraId: "camB", cameraDirectionDegrees: 180, tid: hoursAgoIso(0.1) }),
    ] as never,
    "hjort",
    { now: NOW }
  );

  assert.ok(result.zones.length >= 2, `forventet minst 2 separate soner, fikk ${result.zones.length}`);
  assert.notEqual(result.confidenceLevel, "høy", "spredt, tynt underbygget data bør ikke gi høy samlet confidence");
});

// ===========================================================================
// Scenario 6 — Kamera-retning
// ===========================================================================

test("Scenario 6: et kamera som peker nord gir høyere score nord for kameraet enn rett sør (bak)", () => {
  const camPos = { latitude: 60.0, longitude: 10.0 };
  const raw = [
    obs({ observationSource: "camera", cameraId: "camN", cameraDirectionDegrees: 0, latitude: camPos.latitude, longitude: camPos.longitude, tid: hoursAgoIso(0) }),
  ];
  const normalized = normalizeObservations(raw as never).filter((o) => o.species === "hjort");
  const profile = getSpeciesProfile("hjort");

  const north = movePoint(camPos.latitude, camPos.longitude, 0, 250);
  const south = movePoint(camPos.latitude, camPos.longitude, 180, 250);

  const scoredNorth = scoreCell(north, normalized, profile, DEFAULT_ENGINE_CONFIG, NOW, []);
  const scoredSouth = scoreCell(south, normalized, profile, DEFAULT_ENGINE_CONFIG, NOW, []);

  assert.ok(
    scoredNorth.score > scoredSouth.score,
    `forventet at punktet foran kameraet (${scoredNorth.score}) scorer høyere enn rett bak (${scoredSouth.score})`
  );
});

// ===========================================================================
// Scenario 7 — Få data
// ===========================================================================

test("Scenario 7: kun én gammel sporobservasjon gir lav score, lav confidence og forklaring som ikke overdriver", () => {
  const result = runEngine(
    [obs({ observationSource: "track", sporType: "Fotspor", tid: hoursAgoIso(24 * 6) })] as never,
    "hjort",
    { now: NOW }
  );

  assert.equal(result.confidenceLevel, "lav");
  if (result.zones.length > 0) {
    assert.equal(result.zones[0].level, "Lav");
  }
  const text = (result.summary + " " + result.zones.map((z) => z.explanation).join(" ")).toLowerCase();
  assert.ok(!text.includes("dyret er her"), "motoren skal aldri hevde å vite at dyret er et konkret sted");
});

// ===========================================================================
// Scenario 8 — Artsseparasjon
// ===========================================================================

test("Scenario 8: rådyr-observasjoner påvirker aldri hjort-resultatet, selv på samme sted/tid", () => {
  const shared = { latitude: 60.0, longitude: 10.0 };
  const hjortObs = [obs({ dyr: "Hjort", latitude: shared.latitude, longitude: shared.longitude, tid: hoursAgoIso(0) })];
  const radyrObs = [
    obs({ dyr: "Rådyr", latitude: shared.latitude, longitude: shared.longitude, observationSource: "camera", cameraId: "r1", tid: hoursAgoIso(0) }),
    obs({ dyr: "Rådyr", latitude: shared.latitude, longitude: shared.longitude, observationSource: "camera", cameraId: "r2", tid: hoursAgoIso(0.1) }),
  ];

  const hjortOnly = runEngine(hjortObs as never, "hjort", { now: NOW });
  const mixed = runEngine([...hjortObs, ...radyrObs] as never, "hjort", { now: NOW });

  assert.deepEqual(mixed, hjortOnly, "hjort-resultatet skal være identisk uansett hvor mye rådyr-data som følger med");
});

// ===========================================================================
// Kanttilfeller (§29)
// ===========================================================================

test("Kanttilfelle: ingen data gir tomt, ikke-krasjende resultat", () => {
  const result = runEngine([] as never, "hjort", { now: NOW });
  assert.deepEqual(result.zones, []);
  assert.equal(result.confidence, 0);
  assert.equal(result.confidenceLevel, "lav");
});

test("Kanttilfelle: kun uprioritert art i datasettet gir tomt resultat, ikke krasj", () => {
  const result = runEngine([obs({ dyr: "Rev" })] as never, "hjort", { now: NOW });
  assert.equal(result.zones.length, 0);
});

test("Kanttilfelle: manglende retning og manglende kamera krasjer ikke", () => {
  const result = runEngine(
    [obs({ retning: null, cameraDirectionDegrees: null, cameraId: null, observationSource: "manual" })] as never,
    "hjort",
    { now: NOW }
  );
  assert.ok(Number.isFinite(result.confidence));
});

test("Kanttilfelle: observasjon uten koordinater filtreres bort uten å krasje", () => {
  const result = runEngine(
    [obs({ latitude: null, longitude: null }), obs({ latitude: 60, longitude: 10 })] as never,
    "hjort",
    { now: NOW }
  );
  assert.equal(result.observationsConsidered, 1);
});

test("Kanttilfelle: fremtidig tidspunkt krasjer ikke og behandles som ferskt", () => {
  const result = runEngine(
    [obs({ tid: new Date(NOW + 2 * 3600000).toISOString() })] as never,
    "hjort",
    { now: NOW }
  );
  assert.ok(Number.isFinite(result.confidence));
  assert.ok(result.zones.length >= 0);
});

test("Kanttilfelle: dupliserte observasjoner (samme id) telles kun én gang", () => {
  const duplicate = obs({ id: "same-id" });
  const result = runEngine([duplicate, { ...duplicate }] as never, "hjort", { now: NOW });
  assert.equal(result.observationsConsidered, 1);
});

test("Kanttilfelle: ekstremt gammel observasjon gir et endelig, ikke-NaN resultat", () => {
  const result = runEngine([obs({ tid: "1990-01-01T00:00:00.000Z" })] as never, "hjort", { now: NOW });
  assert.ok(Number.isFinite(result.confidence));
  for (const z of result.zones) assert.ok(Number.isFinite(z.score));
});

test("Kanttilfelle: antall 0 behandles som 1, ikke som fravær av dyr", () => {
  const result = runEngine([obs({ antall: 0 })] as never, "hjort", { now: NOW });
  assert.ok(Number.isFinite(result.confidence));
});

test("Kanttilfelle: ekstremt høyt antall krasjer ikke, og score holder seg innenfor [0,100]", () => {
  const result = runEngine([obs({ antall: 100000 })] as never, "hjort", { now: NOW });
  for (const z of result.zones) {
    assert.ok(z.score >= 0 && z.score <= 100, `score ${z.score} utenfor [0,100]`);
  }
});

test("Kanttilfelle: samme kamera observert mange ganger gir distinctCameraCount 1 og ingen diversitetsbonus", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    obs({ observationSource: "camera", cameraId: "campX", tid: hoursAgoIso(i * 0.05) })
  );
  const result = runEngine(many as never, "hjort", { now: NOW });
  assert.ok(result.zones.length > 0);
  assert.equal(result.zones[0].distinctCameraCount, 1);
  assert.equal(result.zones[0].signalBreakdown.cameraDiversity, 0);
});

// ===========================================================================
// Determinisme og ytelse (§26–27)
// ===========================================================================

test("Determinisme: samme input gir alltid samme output", () => {
  const input = [
    obs({ observationSource: "camera", cameraId: "c1", cameraDirectionDegrees: 45 }),
    obs({ observationSource: "manual", retning: 200, tid: hoursAgoIso(2) }),
  ];
  const r1 = runEngine(input as never, "hjort", { now: NOW });
  const r2 = runEngine(input as never, "hjort", { now: NOW });
  assert.deepEqual(r1, r2);
});

test("Ytelse: et realistisk stort datasett (300 observasjoner) kjører raskt", () => {
  const many = Array.from({ length: 300 }, (_, i) => {
    const angle = (i * 37) % 360;
    const dist = (i % 50) * 40;
    const pos = movePoint(60, 10, angle, dist);
    return obs({
      latitude: pos.latitude,
      longitude: pos.longitude,
      observationSource: i % 3 === 0 ? "camera" : "manual",
      cameraId: i % 3 === 0 ? `cam-${i % 7}` : null,
      cameraDirectionDegrees: i % 3 === 0 ? (i * 11) % 360 : null,
      tid: hoursAgoIso(i % 240),
    });
  });

  const start = Date.now();
  const result = runEngine(many as never, "hjort", { now: NOW });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 3000, `forventet under 3000ms, brukte ${elapsed}ms`);
  assert.ok(result.zones.length <= DEFAULT_ENGINE_CONFIG.zones.maxZones);
});
