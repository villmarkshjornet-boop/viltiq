import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { buildHuntPlan } = await import("./huntPlan");

const NOW = new Date("2026-08-19T16:00:00.000Z").getTime();

// ---------------------------------------------------------------------------
// Fixtures — matcher konvensjonen i snapshot.test.ts (baseZone/baseEngineResult).
// ---------------------------------------------------------------------------

function baseZone(overrides: Record<string, unknown> = {}) {
  return {
    id: "hjort-zone-1",
    species: "hjort",
    center: { latitude: 60.0, longitude: 10.0 },
    radiusMeters: 300,
    score: 62,
    level: "Høy",
    confidence: 0.6,
    confidenceLevel: "middels",
    observationCount: 2,
    distinctCameraCount: 1,
    newestObservationAgeMinutes: 30,
    dominantSignals: ["Fersk observasjon"],
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
    predictionMode: "local_dominant",
    rank: 1,
    footprint: {
      cells: [
        { latitude: 60.0, longitude: 10.0 },
        { latitude: 60.001, longitude: 10.001 },
      ],
      hull: [
        { latitude: 60.0, longitude: 10.0 },
        { latitude: 60.001, longitude: 10.001 },
      ],
    },
    recommendation: {
      zoneId: "hjort-zone-1",
      species: "hjort",
      rank: 1,
      score: 62,
      confidence: 0.6,
      probabilityLabel: "Høy",
      positiveReasons: ["Fersk lokal aktivitet"],
      negativeReasons: [],
      summary: "Vurdert område med høy aktivitetsscore.",
      dataFreshness: "middels",
      evidenceCount: 2,
      recommendedTimeWindows: [],
    },
    ...overrides,
  };
}

function baseEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    static: {
      elevationMeters: 300,
      relativeElevationMeters: 0,
      slopeDegrees: 5,
      aspectDeg: 180,
      habitat: "skog",
      roadDistanceMeters: 500,
      nearHabitatEdge: false,
      spatialValidity: "valid_land",
    },
    dynamic: {
      temperatureC: 5,
      windSpeedMs: 4,
      windDirectionDeg: 0,
      snowDepthMeters: null,
      precipitationMm: 0,
      // Soloppgang/solnedgang langt unna NOW, slik at tester ikke
      // utilsiktet lander i et skumrings-/demringsvindu med mindre de
      // eksplisitt ber om det.
      sunriseMs: NOW - 8 * 3600_000,
      sunsetMs: NOW + 8 * 3600_000,
    },
    ...overrides,
  };
}

function baseObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "obs-1",
    species: "hjort",
    timestamp: NOW - 30 * 60_000,
    position: { latitude: 60.0005, longitude: 10.0005 },
    source: "camera",
    movementDirectionDeg: 90,
    cameraDirectionDeg: 90,
    count: 1,
    sex: null,
    age: null,
    trackType: null,
    cameraId: "cam-1",
    jaktlagId: "",
    dataQuality: 0.9,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Grunnleggende felter
// ---------------------------------------------------------------------------

test("buildHuntPlan: planen refererer korrekt zoneId/species/target-tidspunkt", () => {
  const zone = baseZone();
  const targetMs = NOW + 3600_000;
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, targetMs, NOW, { nowMs: NOW });

  assert.equal(plan.zoneId, "hjort-zone-1");
  assert.equal(plan.species, "hjort");
  assert.equal(plan.targetDateTime, new Date(targetMs).toISOString());
  assert.equal(plan.primaryZone.id, "hjort-zone-1");
  assert.equal(plan.primaryZone.rank, 1);
  assert.equal(plan.primaryZone.score, 62);
  assert.deepEqual(plan.primaryZone.center, { latitude: 60.0, longitude: 10.0 });
});

test("buildHuntPlan: predictionSnapshotId er deterministisk avledet fra art + engineResultGeneratedAt, ikke fra Date.now()", () => {
  const zone = baseZone();
  const plan1 = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW + 1000, 12345, { nowMs: NOW });
  const plan2 = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW + 999999, 12345, { nowMs: NOW + 50 });

  assert.equal(plan1.predictionSnapshotId, "hjort-12345");
  assert.equal(plan1.predictionSnapshotId, plan2.predictionSnapshotId);
});

// ---------------------------------------------------------------------------
// §3.9 — vindgeometri: konkrete gradseksempler
// ---------------------------------------------------------------------------

test("approach: vind fra nord (0°) => anbefalt innmarsjkurs er 0° (gå mot vinden/nordover inn i sonen)", () => {
  const zone = baseZone();
  const env = baseEnvironment({ dynamic: { ...baseEnvironment().dynamic, windDirectionDeg: 0, windSpeedMs: 5 } });
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.approach.windDirectionDeg, 0);
  assert.equal(plan.approach.recommendedApproachDirectionDeg, 0);
});

test("approach: vind fra øst (90°) => anbefalt innmarsjkurs er 90°", () => {
  const zone = baseZone();
  const env = baseEnvironment({ dynamic: { ...baseEnvironment().dynamic, windDirectionDeg: 90, windSpeedMs: 5 } });
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.approach.recommendedApproachDirectionDeg, 90);
});

test("approach: vind fra sørvest (225°) => anbefalt innmarsjkurs er 225°", () => {
  const zone = baseZone();
  const env = baseEnvironment({ dynamic: { ...baseEnvironment().dynamic, windDirectionDeg: 225, windSpeedMs: 6 } });
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.approach.recommendedApproachDirectionDeg, 225);
});

test("approach: geometrisk konsistensbevis — jegerens posisjon (sett fra sonen, i innmarsjkursens motsatte retning) er nøyaktig der vinden uansett blåser MOT, så lukten aldri drifter tilbake mot sonen", () => {
  for (const windDirectionDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const zone = baseZone();
    const env = baseEnvironment({ dynamic: { ...baseEnvironment().dynamic, windDirectionDeg, windSpeedMs: 5 } });
    const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, { nowMs: NOW });

    const hunterBearingFromZone = (plan.approach.recommendedApproachDirectionDeg! + 180) % 360;
    const windBlowsToward = (windDirectionDeg + 180) % 360;
    assert.equal(hunterBearingFromZone, windBlowsToward, `feilet for windDirectionDeg=${windDirectionDeg}`);
  }
});

test("approach: ukjent vindretning => ingen gjettet kurs (null), ærlig note", () => {
  const zone = baseZone();
  const env = baseEnvironment({ dynamic: { ...baseEnvironment().dynamic, windDirectionDeg: null } });
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.approach.windDirectionDeg, null);
  assert.equal(plan.approach.recommendedApproachDirectionDeg, null);
  assert.match(plan.approach.note, /ukjent/i);
});

// ---------------------------------------------------------------------------
// §3.11 — expectedMovement.basis
// ---------------------------------------------------------------------------

test("expectedMovement: fersk, nær observasjon med retning => basis 'observation_corridor', med from/toward/directionDeg", () => {
  const zone = baseZone();
  const env = baseEnvironment();
  const obs = baseObservation({ timestamp: NOW - 10 * 60_000, movementDirectionDeg: 90 });
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, {
    nowMs: NOW,
    nearbyObservations: [obs] as never,
  });

  assert.equal(plan.expectedMovement.basis, "observation_corridor");
  assert.ok(plan.expectedMovement.from);
  assert.ok(plan.expectedMovement.toward);
  assert.equal(plan.expectedMovement.directionDeg, 90);
  assert.ok(plan.expectedMovement.confidence > 0);
});

test("expectedMovement: ingen nær observasjon, men targetDateTime midt i et reelt skumringsvindu => basis 'crepuscular_habitat_shift', UTEN retning/posisjon", () => {
  const zone = baseZone();
  const sunriseMs = NOW;
  const env = baseEnvironment({
    dynamic: { ...baseEnvironment().dynamic, sunriseMs, sunsetMs: sunriseMs + 12 * 3600_000 },
  });
  // targetDateTime = akkurat soloppgang => garantert innenfor det beregnede vinduet.
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, sunriseMs, NOW, { nowMs: NOW });

  assert.equal(plan.expectedMovement.basis, "crepuscular_habitat_shift");
  assert.equal(plan.expectedMovement.directionDeg, undefined);
  assert.equal(plan.expectedMovement.toward, undefined);
  assert.ok(plan.expectedMovement.confidence > 0);
});

test("expectedMovement: verken observasjon eller skumringstid => basis 'insufficient_data', confidence 0", () => {
  const zone = baseZone();
  // dynamic.sunrise/sunset er langt fra NOW i baseEnvironment() (§ fixture) —
  // targetDateTimeMs = NOW havner dermed midt på dagen, utenfor ethvert vindu.
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.expectedMovement.basis, "insufficient_data");
  assert.equal(plan.expectedMovement.confidence, 0);
  assert.equal(plan.expectedMovement.directionDeg, undefined);
});

test("expectedMovement: observasjon UTENFOR søkeradius fra sonen ignoreres => faller tilbake, IKKE observation_corridor", () => {
  const zone = baseZone({ radiusMeters: 100 });
  const farObs = baseObservation({
    position: { latitude: 61.0, longitude: 12.0 }, // langt unna
    movementDirectionDeg: 45,
  });
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW, NOW, {
    nowMs: NOW,
    nearbyObservations: [farObs] as never,
  });

  assert.notEqual(plan.expectedMovement.basis, "observation_corridor");
});

test("expectedMovement: lav confidence blir ALDRI fraset som sikker fakta — teksten hedger konsekvent ('kan', 'sannsynlig', 'usikker', 'utilstrekkelig'), aldri 'er her'/'vil være'", () => {
  const zone = baseZone();
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.expectedMovement.confidence, 0);
  assert.doesNotMatch(plan.expectedMovement.note, /\ber her\b|\bvil være\b|\bsikkert\b/i);
  assert.match(plan.expectedMovement.note, /utilstrekkelig/i);

  // Samme sjekk for en LAV (men > 0) confidence-gren: gammel observasjon.
  const oldObs = baseObservation({ timestamp: NOW - 40 * 3600_000, movementDirectionDeg: 10 });
  const plan2 = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW, NOW, {
    nowMs: NOW,
    nearbyObservations: [oldObs] as never,
  });
  if (plan2.expectedMovement.basis === "observation_corridor") {
    assert.ok(plan2.expectedMovement.confidence < 0.5);
    assert.doesNotMatch(plan2.expectedMovement.note, /\ber her\b|\bvil være\b|\bsikkert\b/i);
  }
});

// ---------------------------------------------------------------------------
// §3.8 — recommendedPosition / positionReasoning
// ---------------------------------------------------------------------------

test("recommendedPosition: er zone.center (sonens toppunkt) — men positionReasoning sier ÆRLIG hvorfor, ikke et gjettet mer presist punkt", () => {
  const zone = baseZone();
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.deepEqual(plan.recommendedPosition, zone.center);
  assert.ok(plan.positionReasoning.length > 0);
  assert.ok(
    plan.positionReasoning.some((r) => /toppunkt|høyest scorede|ikke et geometrisk gjennomsnitt|sentroide/i.test(r)),
    "positionReasoning skal eksplisitt forklare at punktet ikke er et sentroide"
  );
  assert.ok(
    plan.positionReasoning.some((r) => /ikke.*presist|ærlig/i.test(r)),
    "positionReasoning skal ærlig nevne presisjonsbegrensningen"
  );
});

test("recommendedPosition: nær habitatkant legger til et ekte sekundærsignal i positionReasoning", () => {
  const zone = baseZone();
  const env = baseEnvironment({ static: { ...baseEnvironment().static, nearHabitatEdge: true } });
  const plan = buildHuntPlan(zone as never, [zone] as never, env as never, NOW, NOW, { nowMs: NOW });

  assert.ok(plan.positionReasoning.some((r) => /kantsone|habitatovergang/i.test(r)));
});

// ---------------------------------------------------------------------------
// §3.12 — alternatives
// ---------------------------------------------------------------------------

test("alternatives: TOM når ingen sone har environmentBreakdown (ren observasjonsmotor, ingen økologidata)", () => {
  const zone = baseZone({ environmentBreakdown: undefined });
  const other = baseZone({ id: "hjort-zone-2", rank: 2, environmentBreakdown: undefined });
  const plan = buildHuntPlan(zone as never, [zone, other] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.deepEqual(plan.alternatives, []);
});

test("alternatives: TOM når vindeksponering er praktisk talt identisk mellom sonene (ingen fabrikkert vilkår)", () => {
  const breakdown = {
    habitat: 0.8,
    winterSnowElevation: 1,
    springGreenup: 1,
    road: 1,
    edge: 1,
    windExposure: 0.99,
  };
  const zone = baseZone({ environmentBreakdown: breakdown });
  const other = baseZone({ id: "hjort-zone-2", rank: 2, environmentBreakdown: { ...breakdown, windExposure: 0.991 } });
  const plan = buildHuntPlan(zone as never, [zone, other] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.deepEqual(plan.alternatives, []);
});

test("alternatives: genuint annerledes vindeksponering => ETT alternativ med et ekte, differensierende vilkår", () => {
  const zone = baseZone({ environmentBreakdown: { habitat: 0.8, winterSnowElevation: 1, springGreenup: 1, road: 1, edge: 1, windExposure: 0.99 } });
  const other = baseZone({
    id: "hjort-zone-2",
    rank: 2,
    environmentBreakdown: { habitat: 0.8, winterSnowElevation: 1, springGreenup: 1, road: 1, edge: 1, windExposure: 0.95 },
  });
  const plan = buildHuntPlan(zone as never, [zone, other] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.equal(plan.alternatives.length, 1);
  assert.equal(plan.alternatives[0].zoneId, "hjort-zone-2");
  assert.equal(plan.alternatives[0].rank, 2);
  assert.ok(plan.alternatives[0].condition.length > 0);
});

test("alternatives: en annen art i allZones ekskluderes alltid, uansett vindeksponering", () => {
  const zone = baseZone({ environmentBreakdown: { habitat: 0.8, winterSnowElevation: 1, springGreenup: 1, road: 1, edge: 1, windExposure: 0.99 } });
  const otherSpecies = baseZone({
    id: "radyr-zone-1",
    species: "radyr",
    rank: 1,
    environmentBreakdown: { habitat: 0.8, winterSnowElevation: 1, springGreenup: 1, road: 1, edge: 1, windExposure: 0.5 },
  });
  const plan = buildHuntPlan(zone as never, [zone, otherSpecies] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.deepEqual(plan.alternatives, []);
});

// ---------------------------------------------------------------------------
// reasons / dataFreshness — gjenbruk av zone.recommendation
// ---------------------------------------------------------------------------

test("reasons: gjenbruker DIREKTE zone.recommendation sine positiveReasons/negativeReasons", () => {
  const zone = baseZone();
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, NOW, NOW, { nowMs: NOW });

  assert.deepEqual(plan.reasons.positive, ["Fersk lokal aktivitet"]);
  assert.equal(plan.dataFreshness, "middels");
});

test("reasons: langt-frem-i-tid targetDateTime legger til en ærlig værdata-staleness-advarsel i negative", () => {
  const zone = baseZone();
  const farFutureMs = NOW + 30 * 24 * 3600_000; // 30 dager frem
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, farFutureMs, NOW, { nowMs: NOW });

  assert.ok(plan.reasons.negative.some((r) => /værdata|vind- og værdata/i.test(r)));
});

test("reasons: nær-i-tid targetDateTime legger IKKE til værdata-staleness-advarselen", () => {
  const zone = baseZone();
  const soonMs = NOW + 30 * 60_000; // 30 min frem
  const plan = buildHuntPlan(zone as never, [zone] as never, baseEnvironment() as never, soonMs, NOW, { nowMs: NOW });

  assert.ok(!plan.reasons.negative.some((r) => /værdata|vind- og værdata/i.test(r)));
});
