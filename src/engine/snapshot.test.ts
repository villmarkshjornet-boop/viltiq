import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const {
  buildPredictionSnapshot,
  shouldSaveSnapshot,
  validityWindowHours,
  DEFAULT_SNAPSHOT_MIN_INTERVAL_MS,
} = await import("./snapshot");
const { evaluateSnapshotAgainstObservation } = await import(
  "../services/predictions"
);

const NOW = new Date("2026-08-10T20:00:00.000Z").getTime();

function baseZone(overrides: Record<string, unknown> = {}) {
  return {
    id: "zone-1",
    species: "hjort",
    center: { latitude: 60.0, longitude: 10.0 },
    radiusMeters: 300,
    score: 62,
    level: "Høy",
    confidence: 0.5,
    confidenceLevel: "middels",
    observationCount: 3,
    distinctCameraCount: 1,
    newestObservationAgeMinutes: 30,
    dominantSignals: ["Fersk observasjon", "Kamera støtter"],
    predictionMode: "local_dominant",
    explanation: "Fersk observasjon nær kamera A.",
    signalBreakdown: {
      recency: 1,
      repetition: 0.5,
      cameraDirection: 0.2,
      movementDirection: 0.3,
      cameraDiversity: 0,
      corridor: 0,
      ecology: 0,
    },
    ...overrides,
  };
}

function baseEngineResult(overrides: Record<string, unknown> = {}) {
  return {
    engineVersion: "ViltIQ Engine v1",
    configVersion: "1",
    species: "hjort",
    generatedAt: NOW,
    zones: [baseZone()],
    confidence: 0.5,
    confidenceLevel: "middels",
    summary: "Moderat aktivitet.",
    signals: ["Fersk observasjon"],
    observationsConsidered: 3,
    heatmapPoints: [
      { latitude: 60.0, longitude: 10.0, weight: 0.9 },
      { latitude: 60.001, longitude: 10.001, weight: 0.4 },
    ],
    ...overrides,
  };
}

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    jaktlagId: "",
    areaCenter: { latitude: 60.0, longitude: 10.0 },
    areaRadiusMeters: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPredictionSnapshot
// ---------------------------------------------------------------------------

test("buildPredictionSnapshot: mapper felter korrekt fra EngineResult + kontekst", () => {
  const result = baseEngineResult();
  const snap = buildPredictionSnapshot(result as never, baseContext());

  assert.equal(snap.userId, "u1");
  assert.equal(snap.jaktlagId, "");
  assert.equal(snap.species, "hjort");
  assert.equal(snap.engineVersion, "ViltIQ Engine v1");
  assert.equal(snap.configVersion, "1");
  assert.equal(snap.calculatedAt, NOW);
  assert.equal(snap.validFrom, NOW);
  assert.equal(snap.observationsConsidered, 3);
  assert.equal(snap.summary, "Moderat aktivitet.");
  assert.deepEqual(snap.areaCenter, { latitude: 60.0, longitude: 10.0 });
  assert.equal(snap.areaRadiusMeters, 5000);
  assert.equal(snap.zones.length, 1);
  assert.deepEqual(snap.zones[0], {
    center: { latitude: 60.0, longitude: 10.0 },
    radiusMeters: 300,
    score: 62,
    level: "Høy",
    confidence: 0.5,
    confidenceLevel: "middels",
    dominantSignals: ["Fersk observasjon", "Kamera støtter"],
    predictionMode: "local_dominant",
  });
});

test("buildPredictionSnapshot: validUntil er alltid etter validFrom (positivt TTL-vindu)", () => {
  const snap = buildPredictionSnapshot(baseEngineResult() as never, baseContext());
  assert.ok(snap.validUntil > snap.validFrom);
  // hjort: timeHalfLifeHours = 5, multiplikator 2.5 => 12.5t vindu.
  assert.equal(snap.validUntil - snap.validFrom, validityWindowHours("hjort") * 3600_000);
});

test("buildPredictionSnapshot: kompakte soner inkluderer ALDRI heatmapPoints eller debug-felter", () => {
  const snap = buildPredictionSnapshot(baseEngineResult() as never, baseContext());
  const json = JSON.stringify(snap);
  assert.ok(!json.includes("heatmapPoints"));
  assert.ok(!("heatmapPoints" in snap));
  // Soner skal kun ha det kompakte settet av felter, ikke f.eks. id/explanation/signalBreakdown.
  const zoneKeys = Object.keys(snap.zones[0]).sort();
  assert.deepEqual(zoneKeys, [
    "center",
    "confidence",
    "confidenceLevel",
    "dominantSignals",
    "level",
    "predictionMode",
    "radiusMeters",
    "score",
  ]);
});

test("buildPredictionSnapshot: stempler environmentSchemaVersion/ecologyModelVersion/speciesProfileVersion KUN når ecologyUsed er satt (§27)", () => {
  const withEcology = buildPredictionSnapshot(baseEngineResult() as never, baseContext({ ecologyUsed: true }));
  assert.equal(withEcology.environmentSchemaVersion, "1");
  assert.equal(withEcology.ecologyModelVersion, "1");
  assert.equal(withEcology.speciesProfileVersion, "2");

  const withoutEcology = buildPredictionSnapshot(baseEngineResult() as never, baseContext());
  assert.equal(withoutEcology.environmentSchemaVersion, undefined);
  assert.equal(withoutEcology.ecologyModelVersion, undefined);
  assert.equal(withoutEcology.speciesProfileVersion, undefined);
  assert.ok(!("environmentSchemaVersion" in withoutEcology), "feltet skal ikke være til stede i det hele tatt, ikke bare undefined");
});

test("validityWindowHours: elg (lengre halveringstid) gir et lengre gyldighetsvindu enn rådyr", () => {
  assert.ok(validityWindowHours("elg") > validityWindowHours("radyr"));
});

// ---------------------------------------------------------------------------
// shouldSaveSnapshot
// ---------------------------------------------------------------------------

test("shouldSaveSnapshot: første kall (lastSavedAtMs === undefined) skal alltid lagre", () => {
  assert.equal(shouldSaveSnapshot(undefined, NOW, DEFAULT_SNAPSHOT_MIN_INTERVAL_MS), true);
});

test("shouldSaveSnapshot: for tidlig siden forrige lagring => false", () => {
  const lastSaved = NOW;
  const soonAfter = NOW + 60_000; // 1 minutt senere, godt under 15 min terskel
  assert.equal(shouldSaveSnapshot(lastSaved, soonAfter, DEFAULT_SNAPSHOT_MIN_INTERVAL_MS), false);
});

test("shouldSaveSnapshot: nøyaktig på terskelen => true (>=, ikke >)", () => {
  const lastSaved = NOW;
  const atThreshold = NOW + DEFAULT_SNAPSHOT_MIN_INTERVAL_MS;
  assert.equal(shouldSaveSnapshot(lastSaved, atThreshold, DEFAULT_SNAPSHOT_MIN_INTERVAL_MS), true);
});

test("shouldSaveSnapshot: godt over terskelen => true", () => {
  const lastSaved = NOW;
  const wayAfter = NOW + DEFAULT_SNAPSHOT_MIN_INTERVAL_MS * 3;
  assert.equal(shouldSaveSnapshot(lastSaved, wayAfter, DEFAULT_SNAPSHOT_MIN_INTERVAL_MS), true);
});

// ---------------------------------------------------------------------------
// evaluateSnapshotAgainstObservation — den viktigste testen i denne filen.
// Kontrakten er bevisst asymmetrisk: enten en KONKRET "confirmed_hit", eller
// null. ALDRI en "miss"/"unconfirmed"-klassifisering, fordi fravær av en
// senere observasjon i en sone ikke er bevis for at prediksjonen var feil —
// dyret kan ha vært der uten å bli sett/fotografert.
// ---------------------------------------------------------------------------

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    jaktlagId: "",
    species: "hjort",
    engineVersion: "ViltIQ Engine v1",
    configVersion: "1",
    calculatedAt: NOW,
    validFrom: NOW,
    validUntil: NOW + 10 * 3600_000,
    areaCenter: { latitude: 60.0, longitude: 10.0 },
    areaRadiusMeters: 5000,
    zones: [
      {
        center: { latitude: 60.0, longitude: 10.0 },
        radiusMeters: 300,
        score: 62,
        level: "Høy",
        confidence: 0.5,
        confidenceLevel: "middels",
        dominantSignals: ["Fersk observasjon"],
      },
    ],
    observationsConsidered: 3,
    summary: "Moderat aktivitet.",
    ...overrides,
  };
}

function baseObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    species: "hjort",
    timestamp: NOW + 3600_000, // 1 time etter prediksjonen
    position: { latitude: 60.0, longitude: 10.0 }, // rett i sonesenteret
    source: "manual",
    movementDirectionDeg: null,
    cameraDirectionDeg: null,
    count: 1,
    sex: null,
    age: null,
    trackType: null,
    cameraId: null,
    jaktlagId: "",
    dataQuality: 0.5,
    ...overrides,
  };
}

test("evaluateSnapshotAgainstObservation: (a) observasjon i sone + i tidsvindu => confirmed_hit", () => {
  const evalResult = evaluateSnapshotAgainstObservation(
    baseSnapshot() as never,
    baseObservation() as never
  );
  assert.ok(evalResult !== null);
  assert.equal(evalResult!.outcome, "confirmed_hit");
  assert.equal(evalResult!.hoursAfterPrediction, 1);
  assert.deepEqual(evalResult!.matchedZone, baseSnapshot().zones[0]);
});

test("evaluateSnapshotAgainstObservation: (b) feil art => null", () => {
  const evalResult = evaluateSnapshotAgainstObservation(
    baseSnapshot() as never,
    baseObservation({ species: "elg" }) as never
  );
  assert.equal(evalResult, null);
});

test("evaluateSnapshotAgainstObservation: (c) observasjon FØR validFrom => null (kan ikke bekrefte med eldre data)", () => {
  const snap = baseSnapshot();
  const evalResult = evaluateSnapshotAgainstObservation(
    snap as never,
    baseObservation({ timestamp: (snap.validFrom as number) - 1 }) as never
  );
  assert.equal(evalResult, null);
});

test("evaluateSnapshotAgainstObservation: (d) observasjon ETTER validUntil => null", () => {
  const snap = baseSnapshot();
  const evalResult = evaluateSnapshotAgainstObservation(
    snap as never,
    baseObservation({ timestamp: (snap.validUntil as number) + 1 }) as never
  );
  assert.equal(evalResult, null);
});

test("evaluateSnapshotAgainstObservation: (e) rett art/tid men UTENFOR alle sonenes radius => null, IKKE en 'miss'", () => {
  // Observasjonen er 5000 m unna sonesenteret — langt utenfor zone.radiusMeters (300 m).
  // Dette er BEVISST fortsatt null: motoren kan ha hatt rett om at dyret var
  // i sonen, uten at noen tilfeldigvis observerte det der. Funksjonen skal
  // aldri late som den vet at prediksjonen var feil bare fordi ETT konkret
  // sted utenfor sonen ble observert — derfor asserter vi strengt på === null,
  // og IKKE et objekt med f.eks. outcome: "miss".
  const evalResult = evaluateSnapshotAgainstObservation(
    baseSnapshot() as never,
    baseObservation({ position: { latitude: 60.05, longitude: 10.05 } }) as never
  );
  assert.equal(evalResult, null);
});

test("evaluateSnapshotAgainstObservation: (f) tom zones-array => null, krasjer ikke", () => {
  const evalResult = evaluateSnapshotAgainstObservation(
    baseSnapshot({ zones: [] }) as never,
    baseObservation() as never
  );
  assert.equal(evalResult, null);
});
