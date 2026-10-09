import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { EngineObservation } from "./types";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { movementProjectionScoreAt } = await import("./movement");
const { scoreCell } = await import("./grid");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { getSpeciesProfile } = await import("./species/profiles");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");

// V1.3 (§H/§I i motoroppdraget): movement.ts sin movementProjectionScoreAt()
// er et NYTT, additivt bidrag — en fremover-projisert "forventet posisjon"
// fra ÉN observasjons EGEN movementDirectionDeg + alder. Bevisst adskilt fra
// (og skal IKKE forveksles med) to andre, allerede eksisterende mekanismer
// dekket av andre testfiler:
//  - grid.ts sin moveMultiplier (retnings-VEKTING av det symmetriske
//    fotavtrykket) — se movementDirection.test.ts.
//  - reinforcement.ts sin computeMovementCorridors() (kjeder FLERE
//    observasjoner) — se reinforcement.test.ts.

const NOW = new Date("2026-08-19T18:00:00.000Z").getTime();
const cfg = DEFAULT_ENGINE_CONFIG;
const hjort = getSpeciesProfile("hjort");
const radyr = getSpeciesProfile("radyr");
const elg = getSpeciesProfile("elg");

const OBS_POS = { latitude: 60.0, longitude: 10.0 };

let idCounter = 0;
function obs(overrides: Partial<EngineObservation> = {}): EngineObservation {
  idCounter += 1;
  return {
    id: `mv-obs-${idCounter}`,
    species: "hjort",
    timestamp: NOW,
    position: OBS_POS,
    source: "camera",
    movementDirectionDeg: null,
    cameraDirectionDeg: null,
    count: 1,
    sex: null,
    age: null,
    trackType: null,
    cameraId: `cam-${idCounter}`,
    jaktlagId: "",
    dataQuality: 0.8,
    ...overrides,
  };
}

function hoursAgo(h: number): number {
  return NOW - h * 3600000;
}

// ===========================================================================
// §Y-F: fersk observasjon + retning -> synlig, konsentrert fremover-klump.
// ===========================================================================

test("§Y-F: fersk observasjon (5 min) med retning gir et synlig, konsentrert bidrag rett i det projiserte punktet, som faller raskt av med avstand", () => {
  const fresh = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(5 / 60) });
  const expectedPoint = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, Math.min(hjort.maxMovementProjectionMeters, hjort.expectedMovementSpeedMetersPerHour * (5 / 60)));

  const peak = movementProjectionScoreAt(expectedPoint, fresh, hjort, cfg, NOW);
  assert.ok(peak > 0.3, `forventet et tydelig bidrag rett i det projiserte punktet, fikk ${peak}`);

  // 500 m unna det projiserte punktet skal bidraget være langt svakere —
  // "konsentrert", ikke en jevnt utbredt sky.
  const farFromExpected = movePoint(expectedPoint.latitude, expectedPoint.longitude, 0, 500);
  const farScore = movementProjectionScoreAt(farFromExpected, fresh, hjort, cfg, NOW);
  assert.ok(farScore < peak * 0.05, `forventet at bidraget er nesten borte 500 m unna en fersk projeksjon, fikk peak=${peak} far=${farScore}`);
});

// ===========================================================================
// §Y-G: gammel observasjon + retning -> bredere, svakere klump enn F.
// ===========================================================================

test("§Y-G: gammel observasjon (18 t) med retning gir et SVAKERE, men BREDERE bidrag enn en fersk observasjon", () => {
  const fresh = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(5 / 60) });
  const old = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(18) });

  const freshDist = Math.min(hjort.maxMovementProjectionMeters, hjort.expectedMovementSpeedMetersPerHour * (5 / 60));
  const oldDist = Math.min(hjort.maxMovementProjectionMeters, hjort.expectedMovementSpeedMetersPerHour * 18);
  const freshExpected = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, freshDist);
  const oldExpected = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, oldDist);

  const freshPeak = movementProjectionScoreAt(freshExpected, fresh, hjort, cfg, NOW);
  const oldPeak = movementProjectionScoreAt(oldExpected, old, hjort, cfg, NOW);
  assert.ok(oldPeak > 0, `en 18 t gammel observasjon skal fortsatt gi et svakt, men MÅLBART bidrag, fikk ${oldPeak}`);
  assert.ok(oldPeak < freshPeak, `forventet at den gamle projeksjonens TOPPSTYRKE er svakere enn den ferske sin, fikk fresh=${freshPeak} old=${oldPeak}`);

  // "Bredere": samme faste offset (300 m) fra HVERT sitt projiserte punkt
  // skal beholde en STØRRE ANDEL av toppverdien for den gamle (brede)
  // projeksjonen enn for den ferske (smale) — en genuint annen form, ikke
  // bare en nedskalert kopi av den samme kurven.
  const freshOffsetPoint = movePoint(freshExpected.latitude, freshExpected.longitude, 0, 300);
  const oldOffsetPoint = movePoint(oldExpected.latitude, oldExpected.longitude, 0, 300);
  const freshRatio = movementProjectionScoreAt(freshOffsetPoint, fresh, hjort, cfg, NOW) / freshPeak;
  const oldRatio = movementProjectionScoreAt(oldOffsetPoint, old, hjort, cfg, NOW) / oldPeak;
  assert.ok(oldRatio > freshRatio, `forventet at den gamle (brede) projeksjonen beholder en større andel av toppen 300 m unna enn den ferske (smale), fikk fresh=${freshRatio} old=${oldRatio}`);
});

// ===========================================================================
// §Y-H: observasjon UTEN retning -> alltid nøyaktig 0, uansett punkt/alder.
// ===========================================================================

test("§Y-H: observasjon uten kjent bevegelsesretning gir ALLTID 0 i movementProjectionScoreAt (ikke finn på retning)", () => {
  const noDirectionFresh = obs({ movementDirectionDeg: null, timestamp: hoursAgo(0.1) });
  const noDirectionOld = obs({ movementDirectionDeg: null, timestamp: hoursAgo(20) });

  for (const o of [noDirectionFresh, noDirectionOld]) {
    for (const distM of [0, 100, 1000, 10000]) {
      const p = movePoint(OBS_POS.latitude, OBS_POS.longitude, 45, distM);
      assert.equal(movementProjectionScoreAt(p, o, hjort, cfg, NOW), 0, `forventet 0 uten retning (dist=${distM})`);
    }
  }
});

// ===========================================================================
// §Y-I: retning peker mot vann -> bidraget undertrykkes/blir 0 der.
// ===========================================================================

test("§Y-I: retning som peker rett mot en innsjø undertrykker bidraget til 0 ved det projiserte punktet", () => {
  const o = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(2) });
  const projectionDistance = Math.min(hjort.maxMovementProjectionMeters, hjort.expectedMovementSpeedMetersPerHour * 2);
  const expectedPoint = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, projectionDistance);

  // Hjemmebygd validityAt, samme mønster som spatialValidity.test.ts sin
  // buildLakeEnvironment: en liten innsjø sentrert nøyaktig på det
  // projiserte punktet.
  const lakeRadiusMeters = 50;
  const validityAtWithLake = (point: { latitude: number; longitude: number }) =>
    distanceMeters(point, expectedPoint) < lakeRadiusMeters ? ("water" as const) : ("valid_land" as const);

  const withoutGating = movementProjectionScoreAt(expectedPoint, o, hjort, cfg, NOW);
  assert.ok(withoutGating > 0.2, `sanity check: uten geografi-gating skal det projiserte punktet ha et tydelig bidrag, fikk ${withoutGating}`);

  const withLakeGating = movementProjectionScoreAt(expectedPoint, o, hjort, cfg, NOW, validityAtWithLake);
  assert.equal(withLakeGating, 0, `forventet at en innsjø nøyaktig på det projiserte punktet undertrykker bidraget helt, fikk ${withLakeGating}`);
});

// ===========================================================================
// §Y-J: retning peker mot dårlig/ukjent habitat -> degraderer, krasjer ikke,
// finner ikke opp sikkerhet. "unknown" skal ALDRI tolkes som vann.
// ===========================================================================

test("§Y-J: 'unknown' spatialValidity langs hele projeksjonen degraderer IKKE bidraget (og krasjer ikke) — kun bekreftet vann/invalid undertrykker", () => {
  const o = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(2) });
  const projectionDistance = Math.min(hjort.maxMovementProjectionMeters, hjort.expectedMovementSpeedMetersPerHour * 2);
  const expectedPoint = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, projectionDistance);

  const validityAtUnknown = () => "unknown" as const;

  assert.doesNotThrow(() => movementProjectionScoreAt(expectedPoint, o, hjort, cfg, NOW, validityAtUnknown));

  const withUnknown = movementProjectionScoreAt(expectedPoint, o, hjort, cfg, NOW, validityAtUnknown);
  const withoutValidityAt = movementProjectionScoreAt(expectedPoint, o, hjort, cfg, NOW);
  assert.equal(withUnknown, withoutValidityAt, "manglende/ukjent miljødata skal gi NØYAKTIG samme resultat som å ikke ha noen validityAt i det hele tatt, ALDRI tolket som vann");
  assert.ok(withUnknown > 0, "bidraget skal fortsatt være reelt tilstede, ikke null, ved ukjent (ikke bekreftet ugyldig) geografi");
});

test("manglende validityAt (ren runEngine uten miljøresolver) degraderer likt til INGEN gating, uansett hvor retningen peker", () => {
  const o = obs({ movementDirectionDeg: 200, timestamp: hoursAgo(1) });
  const p = movePoint(OBS_POS.latitude, OBS_POS.longitude, 200, 100);
  assert.doesNotThrow(() => movementProjectionScoreAt(p, o, hjort, cfg, NOW));
  assert.ok(movementProjectionScoreAt(p, o, hjort, cfg, NOW) > 0);
});

// ===========================================================================
// Artsforskjell: hjort/rådyr/elg skal gi genuint ulike projeksjonsverdier
// for nøyaktig samme observasjon/punkt/tidspunkt — ikke identiske tall.
// ===========================================================================

test("hjort/rådyr/elg gir genuint ulike movementProjectionScoreAt-verdier for identisk observasjon/punkt/tidspunkt", () => {
  const o = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(1) });
  const point = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, 500);

  const scores = {
    hjort: movementProjectionScoreAt(point, o, hjort, cfg, NOW),
    radyr: movementProjectionScoreAt(point, o, radyr, cfg, NOW),
    elg: movementProjectionScoreAt(point, o, elg, cfg, NOW),
  };

  assert.ok(scores.hjort > 0 && scores.radyr > 0 && scores.elg > 0, `forventet at alle tre arter gir et reelt bidrag, fikk ${JSON.stringify(scores)}`);
  const distinctValues = new Set([scores.hjort, scores.radyr, scores.elg]);
  assert.equal(distinctValues.size, 3, `forventet tre genuint forskjellige verdier for de tre artene, fikk ${JSON.stringify(scores)}`);
});

// ===========================================================================
// Aldri ubegrenset: bidraget skal være PRESIST 0 langt før en urealistisk
// avstand (titalls km) — et eksplisitt hardt tak, ikke bare en asymptotisk
// tilnærming mot 0.
// ===========================================================================

test("movementProjectionScoreAt er PRESIST 0 (ikke bare tilnærmet) 50 km unna — eksplisitt hardt avstandstak, aldri en uendelig hale", () => {
  // Elg har de største tak-verdiene av de tre prioriterte artene
  // (maxMovementProjectionMeters/maxMovementUncertaintyMeters) — hvis selv
  // elgens bidrag er nøyaktig 0 her, gjelder det samme (med enda større
  // margin) for hjort og rådyr.
  const o = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(5), species: "elg" });
  const farPoint = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, 50000);
  assert.equal(movementProjectionScoreAt(farPoint, o, elg, cfg, NOW), 0, "forventet nøyaktig 0 (hardt avstandstak), ikke bare en veldig liten verdi");
});

// ===========================================================================
// Integrasjon (grid.ts sin scoreCell): bidraget kobles inn ADDITIVT i
// breakdown.movementProjection/total — samme tall som å kalle
// movementProjectionScoreAt direkte med de samme argumentene (ingen
// dobbel-regning, ingen egen parallell logikk i grid.ts).
// ===========================================================================

test("grid.ts sin scoreCell() kobler movementProjectionScoreAt inn ADDITIVT i breakdown.movementProjection, med nøyaktig samme verdi som et direkte kall", () => {
  const o = obs({ movementDirectionDeg: 90, timestamp: hoursAgo(1) });
  const point = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, 200);

  const direct = movementProjectionScoreAt(point, o, hjort, cfg, NOW);
  assert.ok(direct > 0, "sanity check: forventet et reelt direkte bidrag for dette punktet");

  const scored = scoreCell(point, [o], hjort, cfg, NOW, []);
  assert.ok(Math.abs((scored.breakdown.movementProjection ?? 0) - direct) < 1e-9, `forventet at scoreCell sin breakdown.movementProjection matcher et direkte kall nøyaktig, fikk breakdown=${scored.breakdown.movementProjection} direct=${direct}`);
  assert.ok(scored.score >= direct - 1e-9, "totalscoren skal minst inkludere movementProjection-bidraget (additivt, ikke erstattet)");
});

test("grid.ts sin scoreCell(): observasjon uten retning gir movementProjection=0, uten å påvirke de andre breakdown-feltene", () => {
  const o = obs({ movementDirectionDeg: null, timestamp: hoursAgo(1) });
  const point = movePoint(OBS_POS.latitude, OBS_POS.longitude, 90, 200);
  const scored = scoreCell(point, [o], hjort, cfg, NOW, []);
  assert.equal(scored.breakdown.movementProjection ?? 0, 0);
  assert.ok(scored.breakdown.repetition > 0, "det eksisterende symmetriske bidraget skal fortsatt være der, uberørt");
});
