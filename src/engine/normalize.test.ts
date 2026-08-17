import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { normalizeSpecies, normalizeDegrees, normalizeObservations } = await import("./normalize");

function baseObs(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: "2026-08-10T20:00:00.000Z",
    latitude: 60.1,
    longitude: 10.1,
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

// ---------------------------------------------------------------------------
// normalizeSpecies
// ---------------------------------------------------------------------------

test("normalizeSpecies: kjenner igjen alle tre prioriterte arter uavhengig av case/mellomrom", () => {
  assert.equal(normalizeSpecies("Hjort"), "hjort");
  assert.equal(normalizeSpecies("hjort"), "hjort");
  assert.equal(normalizeSpecies(" Hjort "), "hjort");
  assert.equal(normalizeSpecies("Rådyr"), "radyr");
  assert.equal(normalizeSpecies("radyr"), "radyr");
  assert.equal(normalizeSpecies("Elg"), "elg");
});

test("normalizeSpecies: ukjent/uprioritert art blir 'annet'", () => {
  assert.equal(normalizeSpecies("Rev"), "annet");
  assert.equal(normalizeSpecies(""), "annet");
  assert.equal(normalizeSpecies("Bjørn"), "annet");
});

// ---------------------------------------------------------------------------
// normalizeDegrees
// ---------------------------------------------------------------------------

test("normalizeDegrees: verdier innenfor [0,360) er uendret, negative/over 360 vikles rundt", () => {
  assert.equal(normalizeDegrees(45), 45);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(-10), 350);
  assert.equal(normalizeDegrees(370), 10);
});

test("normalizeDegrees: ikke-endelige verdier gir 0 i stedet for å krasje", () => {
  assert.equal(normalizeDegrees(NaN), 0);
  assert.equal(normalizeDegrees(Infinity), 0);
});

// ---------------------------------------------------------------------------
// normalizeObservations
// ---------------------------------------------------------------------------

test("normalizeObservations: observasjon uten GPS filtreres bort", () => {
  const result = normalizeObservations([baseObs({ latitude: null, longitude: null })] as never);
  assert.equal(result.length, 0);
});

test("normalizeObservations: ugyldig/tomt tidspunkt filtreres bort", () => {
  const result = normalizeObservations([baseObs({ tid: "" })] as never);
  assert.equal(result.length, 0);
});

test("normalizeObservations: dupliserte id-er dedupliseres", () => {
  const result = normalizeObservations([baseObs({ id: "dup" }), baseObs({ id: "dup" })] as never);
  assert.equal(result.length, 1);
});

test("normalizeObservations: antall <= 0 normaliseres til 1", () => {
  const result = normalizeObservations([baseObs({ antall: 0 })] as never);
  assert.equal(result[0].count, 1);
});

test("normalizeObservations: skiller kamera-retning fra bevegelsesretning", () => {
  const result = normalizeObservations([
    baseObs({ retning: 90, cameraDirectionDegrees: 270 }),
  ] as never);
  assert.equal(result[0].movementDirectionDeg, 90);
  assert.equal(result[0].cameraDirectionDeg, 270);
});

test("normalizeObservations: gyldig observasjon får forventede felter", () => {
  const result = normalizeObservations([
    baseObs({ dyr: "Elg", observationSource: "camera", cameraId: "cam1", antall: 3 }),
  ] as never);
  assert.equal(result.length, 1);
  const o = result[0];
  assert.equal(o.species, "elg");
  assert.equal(o.source, "camera");
  assert.equal(o.cameraId, "cam1");
  assert.equal(o.count, 3);
  assert.equal(o.timestamp, new Date("2026-08-10T20:00:00.000Z").getTime());
  assert.deepEqual(o.position, { latitude: 60.1, longitude: 10.1 });
});

// ---------------------------------------------------------------------------
// accuracyMeters / sporAlder / schemaVersion (Motor V1 datamodell-utvidelse)
// ---------------------------------------------------------------------------

test("normalizeObservations: accuracyMeters mappes rett gjennom", () => {
  const result = normalizeObservations([baseObs({ accuracyMeters: 12.5 })] as never);
  assert.equal(result[0].accuracyMeters, 12.5);
});

test("normalizeObservations: manglende/ugyldig accuracyMeters gir undefined, krasjer ikke", () => {
  assert.equal(normalizeObservations([baseObs({})] as never)[0].accuracyMeters, undefined);
  assert.equal(
    normalizeObservations([baseObs({ accuracyMeters: null })] as never)[0].accuracyMeters,
    undefined
  );
  assert.equal(
    normalizeObservations([baseObs({ accuracyMeters: NaN })] as never)[0].accuracyMeters,
    undefined
  );
});

test("normalizeObservations: sporAlder på en track-observasjon mappes til engelsk trackFreshness-enum", () => {
  const fersk = normalizeObservations([
    baseObs({ observationSource: "track", sporType: "Fotspor", sporAlder: "fersk" }),
  ] as never);
  assert.equal(fersk[0].trackFreshness, "fresh");

  const dager = normalizeObservations([
    baseObs({ observationSource: "track", sporType: "Fotspor", sporAlder: "noen_dager" }),
  ] as never);
  assert.equal(dager[0].trackFreshness, "days");

  const gammel = normalizeObservations([
    baseObs({ observationSource: "track", sporType: "Fotspor", sporAlder: "gammel" }),
  ] as never);
  assert.equal(gammel[0].trackFreshness, "old");
});

test("normalizeObservations: manglende sporAlder gir undefined trackFreshness, krasjer ikke", () => {
  const result = normalizeObservations([
    baseObs({ observationSource: "track", sporType: "Fotspor" }),
  ] as never);
  assert.equal(result[0].trackFreshness, undefined);
});

test("normalizeObservations: sporAlder på en IKKE-track-observasjon mappes uskadelig (motoren bruker den aldri der)", () => {
  const result = normalizeObservations([
    baseObs({ observationSource: "manual", sporAlder: "gammel" }),
  ] as never);
  assert.equal(result.length, 1, "observasjonen skal fortsatt normaliseres helt vanlig");
  assert.equal(result[0].source, "manual");
  // normalize.ts mapper feltet uavhengig av kilde (samme prinsipp som trackType),
  // men grid.ts sin scoreCell bruker det KUN når source === "track" — se
  // engine.test.ts / signals.test.ts for at det faktisk ikke påvirker scoring her.
  assert.equal(result[0].trackFreshness, "old");
});

test("normalizeObservations: schemaVersion på inputen påvirker ikke normalisering (motoren kjenner ikke feltet)", () => {
  const result = normalizeObservations([baseObs({ schemaVersion: 2 })] as never);
  assert.equal(result.length, 1);
  assert.equal(result[0].species, "hjort");
});
