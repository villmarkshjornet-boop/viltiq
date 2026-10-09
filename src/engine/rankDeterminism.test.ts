import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEngine, compareZonesForRank } = await import("./engine");
const { movePoint } = await import("@/src/lib/geo");

// V1.4 (§ rank-determinisme): "Unngå at 67.8 og 67.7 hopper frem og tilbake
// mellom #1/#2 uten relevant inputendring... Bruk deterministic
// tie-breaking... Samme input skal alltid produsere samme resultat."
//
// To ting bevises her, adskilt:
//   1) SAMME input, kjørt flere ganger, gir ALLTID samme sone-rekkefølge
//      (compareZonesForRank() i engine.ts, brukt av zones.sort() FØR
//      zone.rank settes, er en ren, deterministisk funksjon — ingen
//      tilfeldighet, ingen avhengighet av Map-iterasjonsrekkefølge e.l.).
//   2) En KONSTRUERT eksakt tie på `score` løses konsekvent via den
//      dokumenterte, flertrinns tie-break-rekkefølgen (footprint-størrelse →
//      confidence → id), ikke vilkårlig/sort-implementasjonsavhengig.
//
// Stabilitet PÅ TVERS AV separate beregninger av et NESTEN (men ikke helt)
// identisk scenario (f.eks. en marginal værfluktuasjon) er bevisst IKKE
// forsøkt bevist/løst her — se compareZonesForRank() sin filkommentar i
// engine.ts for begrunnelsen (resultCache.ts sin grov-bucketing gjør en
// reell ny motorkjøring for en SÅ liten endring sjelden i praksis).

const NOW = new Date("2026-08-10T21:31:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `rank-obs-${idCounter}`,
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
// 1) Samme input, kjørt N ganger på rad → identisk rekkefølge hver gang.
// ===========================================================================

test("rank-determinisme: identisk input gir identisk sone-rekkefølge over 20 gjentatte kjøringer", () => {
  const base = { latitude: 60.0, longitude: 10.0 };
  // Tre geografisk separate klynger med bevisst ULIK, men TETT sammenlignbar
  // observasjonstetthet — nok til flere soner uten å garantere en eksakt
  // tie (den eksakte tie-casen dekkes separat under via compareZonesForRank
  // direkte), slik at denne testen fanger den GENERELLE determinisme-
  // garantien: samme observasjonsliste inn skal ALDRI kunne gi ulik
  // rank-rekkefølge ut, uansett hvor mange ganger motoren kjøres.
  const areaA = movePoint(base.latitude, base.longitude, 270, 3000);
  const areaB = movePoint(base.latitude, base.longitude, 90, 3000);
  const areaC = movePoint(base.latitude, base.longitude, 0, 3000);

  const observations = [
    ...[0, 1, 2].map((i) => obs({ observationSource: "camera", cameraId: `camA${i}`, latitude: areaA.latitude, longitude: areaA.longitude, tid: hoursAgoIso(i) })),
    ...[0, 1].map((i) => obs({ observationSource: "camera", cameraId: `camB${i}`, latitude: areaB.latitude, longitude: areaB.longitude, tid: hoursAgoIso(i * 2) })),
    obs({ observationSource: "manual", latitude: areaC.latitude, longitude: areaC.longitude, tid: hoursAgoIso(4) }),
  ];

  const runs = Array.from({ length: 20 }, () => runEngine(observations as never, "hjort", { now: NOW }));

  assert.ok(runs[0].zones.length >= 2, `forventet minst 2 soner for å gjøre rekkefølge-testen meningsfull, fikk ${runs[0].zones.length}`);

  const referenceOrder = runs[0].zones.map((z) => ({ center: z.center, score: z.score, rank: z.rank }));
  for (let i = 1; i < runs.length; i++) {
    const order = runs[i].zones.map((z) => ({ center: z.center, score: z.score, rank: z.rank }));
    assert.deepEqual(
      order,
      referenceOrder,
      `kjøring #${i + 1}: forventet identisk (senter, score, rank)-rekkefølge som kjøring #1 for identisk input`
    );
  }
});

// ===========================================================================
// 2) compareZonesForRank() direkte: en eksakt score-tie løses konsekvent via
//    den dokumenterte flertrinns tie-break-rekkefølgen, ikke tilfeldig.
// ===========================================================================

function fakeZone(overrides: Record<string, unknown>) {
  return {
    id: "zone-x",
    species: "hjort",
    center: { latitude: 60, longitude: 10 },
    radiusMeters: 300,
    score: 50,
    level: "Høy",
    confidence: 0.5,
    confidenceLevel: "middels",
    observationCount: 1,
    distinctCameraCount: 1,
    newestObservationAgeMinutes: 0,
    dominantSignals: [],
    explanation: "",
    signalBreakdown: {},
    predictionMode: "observation_and_environment",
    footprint: { cells: [], hull: [] },
    ...overrides,
  } as never;
}

test("compareZonesForRank: ulik score avgjør alene, uavhengig av alt annet", () => {
  const higher = fakeZone({ id: "z-a", score: 67.8, confidence: 0.1, footprint: { cells: [1], hull: [] } });
  const lower = fakeZone({ id: "z-b", score: 67.7, confidence: 0.9, footprint: { cells: Array(50).fill(1), hull: [] } });
  assert.ok(compareZonesForRank(higher, lower) < 0, "sonen med høyest score skal alltid rangeres foran, uansett footprint/confidence");
  assert.ok(compareZonesForRank(lower, higher) > 0, "sammenligningen skal være antisymmetrisk");
});

test("compareZonesForRank: eksakt lik score → større sammenhengende fotavtrykk (footprint.cells.length) vinner", () => {
  const narrow = fakeZone({ id: "z-narrow", score: 60, footprint: { cells: Array(5).fill(1), hull: [] } });
  const wide = fakeZone({ id: "z-wide", score: 60, footprint: { cells: Array(40).fill(1), hull: [] } });
  assert.ok(compareZonesForRank(wide, narrow) < 0, "bredere sammenhengende fotavtrykk skal vinne ved eksakt lik score");
  assert.ok(compareZonesForRank(narrow, wide) > 0, "sammenligningen skal være antisymmetrisk");
});

test("compareZonesForRank: lik score OG lik footprint-størrelse → høyere confidence vinner", () => {
  const lessConfident = fakeZone({ id: "z-low-conf", score: 60, confidence: 0.3, footprint: { cells: Array(10).fill(1), hull: [] } });
  const moreConfident = fakeZone({ id: "z-high-conf", score: 60, confidence: 0.8, footprint: { cells: Array(10).fill(1), hull: [] } });
  assert.ok(compareZonesForRank(moreConfident, lessConfident) < 0, "høyere confidence skal vinne når score og footprint er identiske");
});

test("compareZonesForRank: lik score, footprint OG confidence → id er siste, garanterte, deterministiske sikkerhetsnett", () => {
  const zA = fakeZone({ id: "hjort-zone-1", score: 60, confidence: 0.5, footprint: { cells: Array(10).fill(1), hull: [] } });
  const zB = fakeZone({ id: "hjort-zone-2", score: 60, confidence: 0.5, footprint: { cells: Array(10).fill(1), hull: [] } });
  assert.ok(compareZonesForRank(zA, zB) < 0, "ved fullstendig tie skal laveste id konsekvent vinne (aldri tilfeldig)");
  assert.equal(compareZonesForRank(zA, zA), 0, "en sone sammenlignet med seg selv skal alltid gi 0 (reflexivitet)");

  // Konsistens over gjentatte sammenligninger — beviser at det ikke er noen
  // skjult tilstand/tilfeldighet i selve funksjonen.
  for (let i = 0; i < 10; i++) {
    assert.ok(compareZonesForRank(zA, zB) < 0, "gjentatt sammenligning av samme par skal alltid gi samme resultat");
  }
});
