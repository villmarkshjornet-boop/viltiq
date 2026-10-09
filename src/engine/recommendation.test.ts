import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { buildZoneRecommendation, deriveDataFreshness } = await import("./explain");
const { computeEvidenceDensity } = await import("./evidenceFusion");
const { getSpeciesProfile } = await import("./species/profiles");

// V1.3 §J/§N/§O — evidensfusjon + strukturert, deterministisk anbefaling.
//
// buildZoneRecommendation er den STRUKTURERTE søsteren til
// buildZoneExplanation (samme klassifisering/blanding, se explain.ts sin
// resolveOrderedReasons) — disse testene dekker derfor IKKE
// Støtter/Begrenser-klassifiseringen på nytt (det er allerede dekket av
// ecologicalEngine.test.ts sine "Blandet forklaring"-tester), men at
// strukturen (positiveReasons/negativeReasons/probabilityLabel/dataFreshness/
// evidenceCount) faktisk speiler den samme underliggende beregningen, og at
// §J/§34s krav (evidensfusjon uten individtracking-språk) holder.

const NOW = new Date("2026-08-19T18:00:00.000Z").getTime();
const hjortProfile = getSpeciesProfile("hjort");

let idCounter = 0;
function engineObs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `rec-obs-${idCounter}`,
    species: "hjort",
    timestamp: NOW,
    position: { latitude: 60.0, longitude: 10.0 },
    source: "camera",
    movementDirectionDeg: null,
    cameraDirectionDeg: null,
    count: 1,
    sex: null,
    age: null,
    trackType: null,
    cameraId: "camA",
    jaktlagId: "",
    dataQuality: 0.8,
    ...overrides,
  };
}

function baseBreakdown(overrides: Record<string, unknown> = {}) {
  return {
    recency: 0,
    repetition: 0,
    cameraDirection: 0,
    movementDirection: 0,
    cameraDiversity: 0,
    corridor: 0,
    ecology: 0,
    ...overrides,
  };
}

function ecologyContext(overrides: Record<string, unknown> = {}) {
  return {
    breakdown: {
      habitat: 0.5,
      winterSnowElevation: 1,
      springGreenup: 1,
      road: 1,
      edge: 1,
      windExposure: 1,
      timeOfDay: 1,
      precipitation: 1,
    },
    habitat: "skog" as const,
    season: "sommer" as const,
    crepuscularMultiplier: 1,
    rutActive: false,
    ...overrides,
  };
}

function mkZone(overrides: Record<string, unknown> = {}) {
  return {
    id: "hjort-zone-1",
    species: "hjort" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    radiusMeters: 200,
    score: 50,
    level: "Moderat" as const,
    confidence: 0.5,
    confidenceLevel: "middels" as const,
    observationCount: 2,
    distinctCameraCount: 2,
    newestObservationAgeMinutes: 30,
    dominantSignals: [],
    explanation: "",
    signalBreakdown: baseBreakdown(),
    predictionMode: "environment_plus_local" as const,
    rank: 1,
    ...overrides,
  };
}

// ===========================================================================
// positiveReasons fra BÅDE økologi og lokal evidens
// ===========================================================================

test("buildZoneRecommendation: sone med både sterk økologi og sterk lokal evidens har positiveReasons fra BEGGE kilder", () => {
  const observations = [
    engineObs({ cameraId: "camA", timestamp: NOW - 5 * 60000 }),
    engineObs({ cameraId: "camB", timestamp: NOW - 10 * 60000 }),
  ];
  const input = {
    species: hjortProfile,
    level: "Høy" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    contributingObservations: observations,
    breakdown: baseBreakdown({ recency: 0.8, repetition: 0.6, cameraDiversity: 0.5 }),
    distinctCameraCount: 2,
    corridors: [],
    nowMs: NOW,
    ecology: ecologyContext({ breakdown: { habitat: 0.8, winterSnowElevation: 1, springGreenup: 1, road: 1, edge: 1.1, windExposure: 1, timeOfDay: 1, precipitation: 1 } }),
    predictionMode: "environment_plus_local" as const,
  };
  const zone = mkZone({ predictionMode: "environment_plus_local", level: "Høy", observationCount: 2, distinctCameraCount: 2 });

  const rec = buildZoneRecommendation(input as never, zone as never);

  assert.ok(
    rec.positiveReasons.some((r) => /skogterreng|habitat/i.test(r)),
    `forventet at miljøet nevnes blant positiveReasons, fikk: ${JSON.stringify(rec.positiveReasons)}`
  );
  assert.ok(
    rec.positiveReasons.some((r) => /fersk|observasjon|kamera|gjentatte/i.test(r)),
    `forventet at lokal evidens OGSÅ nevnes blant positiveReasons, fikk: ${JSON.stringify(rec.positiveReasons)}`
  );
  assert.equal(rec.summary.length > 0, true);
  assert.equal(rec.evidenceCount, 2);
});

// ===========================================================================
// negativeReasons fra reelle begrensende faktorer
// ===========================================================================

test("buildZoneRecommendation: negativeReasons nevner en reell begrensning (nær vei) når ingen lokale observasjoner finnes ennå", () => {
  const input = {
    species: hjortProfile,
    level: "Lav" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    contributingObservations: [],
    breakdown: baseBreakdown(),
    distinctCameraCount: 0,
    corridors: [],
    nowMs: NOW,
    ecology: ecologyContext({ breakdown: { habitat: 0.5, winterSnowElevation: 1, springGreenup: 1, road: 0.5, edge: 1, windExposure: 1, timeOfDay: 1, precipitation: 1 } }),
  };
  const zone = mkZone({ predictionMode: "environment_only", level: "Lav", observationCount: 0, distinctCameraCount: 0, confidenceLevel: "lav" });

  const rec = buildZoneRecommendation(input as never, zone as never);

  assert.ok(
    rec.negativeReasons.some((r) => /vei|bebyggelse/i.test(r)),
    `forventet at nær vei nevnes blant negativeReasons, fikk: ${JSON.stringify(rec.negativeReasons)}`
  );
  assert.ok(
    rec.negativeReasons.some((r) => /ingen ferske observasjoner/i.test(r)),
    `forventet at fravær av ferske observasjoner nevnes, fikk: ${JSON.stringify(rec.negativeReasons)}`
  );
});

test("buildZoneRecommendation: negativeReasons nevner tynt datagrunnlag når kun ÉN, ikke helt fersk observasjon bidrar", () => {
  const observations = [engineObs({ timestamp: NOW - 10 * 3600000 })]; // 10t gammel
  const input = {
    species: hjortProfile,
    level: "Moderat" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    contributingObservations: observations,
    breakdown: baseBreakdown({ recency: 0.2 }),
    distinctCameraCount: 1,
    corridors: [],
    nowMs: NOW,
    predictionMode: "local_dominant" as const,
  };
  const zone = mkZone({ predictionMode: "local_dominant", level: "Moderat", observationCount: 1, distinctCameraCount: 1, newestObservationAgeMinutes: 600 });

  const rec = buildZoneRecommendation(input as never, zone as never);

  assert.ok(
    rec.negativeReasons.some((r) => /lite lokalt datagrunnlag/i.test(r)),
    `forventet at tynt datagrunnlag nevnes blant negativeReasons, fikk: ${JSON.stringify(rec.negativeReasons)}`
  );
});

// ===========================================================================
// probabilityLabel — ALDRI en prosent, alltid nøyaktig zone.level
// ===========================================================================

test("buildZoneRecommendation: probabilityLabel er EKSAKT zone.level, og INGEN felt inneholder en prosent-sannsynlighet", () => {
  const levels = ["Lav", "Moderat", "Høy", "Svært høy"] as const;
  for (const level of levels) {
    const observations = [engineObs({ timestamp: NOW - 5 * 60000 }), engineObs({ cameraId: "camB", timestamp: NOW - 15 * 60000 })];
    const input = {
      species: hjortProfile,
      level,
      center: { latitude: 60.0, longitude: 10.0 },
      contributingObservations: observations,
      breakdown: baseBreakdown({ recency: 0.7, repetition: 0.5, cameraDiversity: 0.4 }),
      distinctCameraCount: 2,
      corridors: [],
      nowMs: NOW,
      predictionMode: "local_dominant" as const,
    };
    const zone = mkZone({ level, predictionMode: "local_dominant", observationCount: 2, distinctCameraCount: 2 });

    const rec = buildZoneRecommendation(input as never, zone as never);

    assert.equal(rec.probabilityLabel, level);
    assert.ok(!JSON.stringify(rec).includes("%"), `forventet ingen prosenttegn noe sted i anbefalingen, fikk: ${JSON.stringify(rec)}`);
  }
});

// ===========================================================================
// dataFreshness — deterministiske terskler
// ===========================================================================

test("deriveDataFreshness: fersk + flere observasjoner + høy confidence gir 'god'", () => {
  assert.equal(deriveDataFreshness("høy", 10, 5), "god");
});

test("deriveDataFreshness: én gammel observasjon gir 'lav', uansett confidence-nivå", () => {
  assert.equal(deriveDataFreshness("middels", 30 * 60, 1), "lav"); // 30 timer gammel
  assert.equal(deriveDataFreshness("høy", 25 * 60, 1), "lav", "selv en høy confidence skal ikke redde et 25t gammelt eneste funn");
});

test("deriveDataFreshness: ingen observasjoner gir alltid 'lav'", () => {
  assert.equal(deriveDataFreshness("høy", 0, 0), "lav");
});

test("deriveDataFreshness: noe grunnlag, men ikke nok til 'god', gir 'middels'", () => {
  assert.equal(deriveDataFreshness("middels", 60, 1), "middels");
  assert.equal(deriveDataFreshness("høy", 10, 1), "middels", "høy confidence men bare ÉN observasjon skal ikke alene gi 'god'");
});

test("buildZoneRecommendation: dataFreshness varierer korrekt over tre konkrete scenarioer (integrasjon)", () => {
  const godScenario = mkZone({ confidenceLevel: "høy", newestObservationAgeMinutes: 15, observationCount: 3 });
  const lavScenario = mkZone({ confidenceLevel: "lav", newestObservationAgeMinutes: 2000, observationCount: 1 });
  const middelsScenario = mkZone({ confidenceLevel: "middels", newestObservationAgeMinutes: 120, observationCount: 1 });

  const makeInput = (n: number) => ({
    species: hjortProfile,
    level: "Moderat" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    contributingObservations: Array.from({ length: n }, (_, i) => engineObs({ cameraId: `cam${i}`, timestamp: NOW })),
    breakdown: baseBreakdown(),
    distinctCameraCount: n,
    corridors: [],
    nowMs: NOW,
  });

  const god = buildZoneRecommendation(makeInput(3) as never, godScenario as never);
  const lav = buildZoneRecommendation(makeInput(1) as never, lavScenario as never);
  const middels = buildZoneRecommendation(makeInput(1) as never, middelsScenario as never);

  assert.equal(god.dataFreshness, "god");
  assert.equal(lav.dataFreshness, "lav");
  assert.equal(middels.dataFreshness, "middels");
});

// ===========================================================================
// Evidensfusjon (§J): flere uavhengige, konsistente signaler > ett isolert
// signal — men ALDRI språk om at det er samme individ.
// ===========================================================================

test("computeEvidenceDensity: to observasjoner fra uavhengige kilder gir HØYERE tetthet enn én isolert observasjon", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const single = [engineObs({ cameraId: "camA" })];
  const double = [engineObs({ cameraId: "camA" }), engineObs({ cameraId: "camB" })];

  const singleDensity = computeEvidenceDensity(single as never, center, []);
  const doubleDensity = computeEvidenceDensity(double as never, center, []);

  assert.equal(singleDensity, 0, "én isolert observasjon skal ikke alene gi noen evidence-density");
  assert.ok(doubleDensity > singleDensity, `forventet doubleDensity (${doubleDensity}) > singleDensity (${singleDensity})`);
});

test("computeEvidenceDensity: en relevant, konsistent korridor mellom to bidragsytende observasjoner løfter tettheten ytterligere", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const observations = [engineObs({ id: "a", cameraId: "camA" }), engineObs({ id: "b", cameraId: "camB" })];
  const corridor = { point: center, bearingDeg: 45, strength: 1, contributingIds: ["a", "b"] };

  const withoutCorridor = computeEvidenceDensity(observations as never, center, []);
  const withCorridor = computeEvidenceDensity(observations as never, center, [corridor]);

  assert.ok(withCorridor > withoutCorridor, `forventet at en relevant korridor løfter tettheten (${withoutCorridor} -> ${withCorridor})`);
});

test("buildZoneRecommendation: evidenceDensity gir en 'flere uavhengige signaler'-reason, men ALDRI individtracking-språk", () => {
  const observations = [engineObs({ id: "a", cameraId: "camA", timestamp: NOW - 5 * 60000 }), engineObs({ id: "b", cameraId: "camB", timestamp: NOW - 10 * 60000 })];
  const corridor = { point: { latitude: 60.0, longitude: 10.0 }, bearingDeg: 45, strength: 1, contributingIds: ["a", "b"] };
  const input = {
    species: hjortProfile,
    level: "Høy" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    contributingObservations: observations,
    breakdown: baseBreakdown({ recency: 0.6, repetition: 0.4, cameraDiversity: 0.5, evidenceDensity: 0.9 }),
    distinctCameraCount: 2,
    corridors: [corridor],
    nowMs: NOW,
    predictionMode: "local_dominant" as const,
  };
  const zone = mkZone({ level: "Høy", predictionMode: "local_dominant", observationCount: 2, distinctCameraCount: 2 });

  const rec = buildZoneRecommendation(input as never, zone as never);

  assert.ok(
    rec.positiveReasons.some((r) => /uavhengige signaler støtter/i.test(r)),
    `forventet en "flere uavhengige signaler støtter"-reason, fikk: ${JSON.stringify(rec.positiveReasons)}`
  );
  const allText = JSON.stringify(rec).toLowerCase();
  assert.ok(!allText.includes("samme individ"), "skal ALDRI hevde at signalene stammer fra samme individ");
  assert.ok(!allText.includes("samme dyr"), "skal ALDRI hevde at det er samme dyr");
  assert.ok(!allText.includes("individtracking"), "skal ALDRI referere til individtracking");
});

// ===========================================================================
// Determinisme — ingen LLM, ingen tilfeldighet
// ===========================================================================

test("buildZoneRecommendation: identisk input gir byte-identisk output ved gjentatt kall", () => {
  const observations = [engineObs({ cameraId: "camA", timestamp: NOW - 5 * 60000 }), engineObs({ cameraId: "camB", timestamp: NOW - 20 * 60000 })];
  const input = {
    species: hjortProfile,
    level: "Moderat" as const,
    center: { latitude: 60.0, longitude: 10.0 },
    contributingObservations: observations,
    breakdown: baseBreakdown({ recency: 0.5, repetition: 0.4, cameraDiversity: 0.3, evidenceDensity: 0.3 }),
    distinctCameraCount: 2,
    corridors: [],
    nowMs: NOW,
    ecology: ecologyContext(),
    predictionMode: "environment_plus_local" as const,
  };
  const zone = mkZone({ predictionMode: "environment_plus_local", observationCount: 2, distinctCameraCount: 2 });

  const r1 = buildZoneRecommendation(input as never, zone as never);
  const r2 = buildZoneRecommendation(input as never, zone as never);

  assert.deepEqual(r1, r2);
});
