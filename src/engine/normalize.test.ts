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
