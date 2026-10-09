import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { determineSeason, computeSpatialSuitability, computeCrepuscularActivityMultiplier, isRutActive } =
  await import("./suitability");
const { HJORT_ECOLOGY_PROFILE } = await import("./hjort");
const { RADYR_ECOLOGY_PROFILE } = await import("./radyr");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("../environment/types");

function iso(dateStr: string): number {
  return new Date(dateStr).getTime();
}

// ---------------------------------------------------------------------------
// determineSeason
// ---------------------------------------------------------------------------

test("determineSeason: kalendermåned mappes til forventet sesong", () => {
  assert.equal(determineSeason(iso("2026-01-15T00:00:00.000Z")), "vinter");
  assert.equal(determineSeason(iso("2026-03-01T00:00:00.000Z")), "vinter");
  assert.equal(determineSeason(iso("2026-04-15T00:00:00.000Z")), "vårtrekk");
  assert.equal(determineSeason(iso("2026-07-01T00:00:00.000Z")), "sommer");
  assert.equal(determineSeason(iso("2026-09-25T00:00:00.000Z")), "brunst");
  assert.equal(determineSeason(iso("2026-11-10T00:00:00.000Z")), "senhøst");
  assert.equal(determineSeason(iso("2026-12-24T00:00:00.000Z")), "vinter");
});

// ---------------------------------------------------------------------------
// computeSpatialSuitability — vinter × snø/høyde/temperatur
// ---------------------------------------------------------------------------

test("computeSpatialSuitability: hjort — lavtliggende, snøfattig, mildt vinterpunkt scorer høyere enn høytliggende, snørikt, kaldt", () => {
  const when = iso("2026-01-15T12:00:00.000Z");
  const low = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "vinter",
    when,
    { ...UKJENT_STATIC_FEATURES, relativeElevationMeters: -100, habitat: "skog" },
    { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.05, temperatureC: 2 }
  );
  const high = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "vinter",
    when,
    { ...UKJENT_STATIC_FEATURES, relativeElevationMeters: 400, habitat: "skog" },
    { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.6, temperatureC: -12 }
  );
  assert.ok(
    low.suitability > high.suitability,
    `forventet lavtliggende/snøfattig (${low.suitability}) > høytliggende/snørikt (${high.suitability})`
  );
});

test("computeSpatialSuitability: rådyr (svak, LOW-evidens vintereffekt) påvirkes mindre av samme snø/høyde-forskjell enn hjort", () => {
  const when = iso("2026-01-15T12:00:00.000Z");
  const lowStatic = { ...UKJENT_STATIC_FEATURES, relativeElevationMeters: -100, habitat: "skog" as const };
  const highStatic = { ...UKJENT_STATIC_FEATURES, relativeElevationMeters: 400, habitat: "skog" as const };
  const lowDyn = { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.05, temperatureC: 2 };
  const highDyn = { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.6, temperatureC: -12 };

  const hjortDiff =
    computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "vinter", when, lowStatic, lowDyn).suitability -
    computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "vinter", when, highStatic, highDyn).suitability;
  const radyrDiff =
    computeSpatialSuitability(RADYR_ECOLOGY_PROFILE, "vinter", when, lowStatic, lowDyn).suitability -
    computeSpatialSuitability(RADYR_ECOLOGY_PROFILE, "vinter", when, highStatic, highDyn).suitability;

  assert.ok(
    hjortDiff > radyrDiff,
    `forventet at hjort (HIGH evidens) påvirkes mer enn rådyr (LOW evidens): hjort=${hjortDiff}, rådyr=${radyrDiff}`
  );
});

test("computeSpatialSuitability: ingen miljødata gir nøytral suitability, ikke straff", () => {
  const result = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "vinter",
    iso("2026-01-15T00:00:00.000Z"),
    UKJENT_STATIC_FEATURES,
    UKJENT_DYNAMIC_FEATURES
  );
  assert.ok(result.suitability > 0, "manglende data skal ikke sende suitability til 0");
});

// ---------------------------------------------------------------------------
// computeSpatialSuitability — vårtrekk × høyde (elg, docs punkt 2)
// ---------------------------------------------------------------------------

test("computeSpatialSuitability: elg — tidlig i vårtrekket foretrekkes lavere høyde, sent i vårtrekket høyere", async () => {
  const { ELG_ECOLOGY_PROFILE } = await import("./elg");
  const highStatic = { ...UKJENT_STATIC_FEATURES, relativeElevationMeters: 300, habitat: "skog" as const };
  const lowStatic = { ...UKJENT_STATIC_FEATURES, relativeElevationMeters: -300, habitat: "skog" as const };

  const early = iso("2026-04-02T00:00:00.000Z");
  const late = iso("2026-05-30T00:00:00.000Z");

  const earlyHigh = computeSpatialSuitability(ELG_ECOLOGY_PROFILE, "vårtrekk", early, highStatic, UKJENT_DYNAMIC_FEATURES).suitability;
  const earlyLow = computeSpatialSuitability(ELG_ECOLOGY_PROFILE, "vårtrekk", early, lowStatic, UKJENT_DYNAMIC_FEATURES).suitability;
  const lateHigh = computeSpatialSuitability(ELG_ECOLOGY_PROFILE, "vårtrekk", late, highStatic, UKJENT_DYNAMIC_FEATURES).suitability;
  const lateLow = computeSpatialSuitability(ELG_ECOLOGY_PROFILE, "vårtrekk", late, lowStatic, UKJENT_DYNAMIC_FEATURES).suitability;

  assert.ok(earlyLow > earlyHigh, `tidlig i vårtrekket: forventet lavt (${earlyLow}) > høyt (${earlyHigh})`);
  assert.ok(lateHigh > lateLow, `sent i vårtrekket: forventet høyt (${lateHigh}) > lavt (${lateLow})`);
});

// ---------------------------------------------------------------------------
// computeCrepuscularActivityMultiplier / isRutActive
// ---------------------------------------------------------------------------

test("computeCrepuscularActivityMultiplier: gir bonus nær soloppgang, nøytral midt på dagen", () => {
  const sunrise = iso("2026-06-01T04:00:00.000Z");
  const sunset = iso("2026-06-01T22:00:00.000Z");
  const dyn = { ...UKJENT_DYNAMIC_FEATURES, sunriseMs: sunrise, sunsetMs: sunset };

  const atSunrise = computeCrepuscularActivityMultiplier(sunrise, dyn, HJORT_ECOLOGY_PROFILE.crepuscularActivity);
  const midday = computeCrepuscularActivityMultiplier(sunrise + 8 * 3600000, dyn, HJORT_ECOLOGY_PROFILE.crepuscularActivity);

  assert.ok(atSunrise > 1, `forventet bonus ved soloppgang, fikk ${atSunrise}`);
  assert.ok(Math.abs(midday - 1) < 1e-9, `forventet nøytral (1.0) midt på dagen, fikk ${midday}`);
});

test("isRutActive: sann for hjort i september/oktober, usann ellers og usann for rådyr (ingen dokumentert brunstboost)", () => {
  assert.equal(isRutActive(iso("2026-09-25T00:00:00.000Z"), HJORT_ECOLOGY_PROFILE), true);
  assert.equal(isRutActive(iso("2026-06-01T00:00:00.000Z"), HJORT_ECOLOGY_PROFILE), false);
  assert.equal(isRutActive(iso("2026-09-25T00:00:00.000Z"), RADYR_ECOLOGY_PROFILE), false);
});

// ---------------------------------------------------------------------------
// computeSpatialSuitability — dag/natt-basisnivå (§F, V1.3)
// ---------------------------------------------------------------------------

// Fast soloppgang/solnedgang-referanse brukt av alle testene under —
// soloppgang 04:00, solnedgang 22:00 UTC (samme dag).
const SUNRISE = iso("2026-06-01T04:00:00.000Z");
const SUNSET = iso("2026-06-01T22:00:00.000Z");
const DAYLIGHT_DYN = { ...UKJENT_DYNAMIC_FEATURES, sunriseMs: SUNRISE, sunsetMs: SUNSET };

test("computeSpatialSuitability: hjort — nattbasisnivå > dagbasisnivå, dusk er nøytralt (dekket av crepuscularActivity, ikke dobbelttelt)", () => {
  const staticF = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const };
  const night = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", SUNRISE - 2 * 3600000, staticF, DAYLIGHT_DYN); // 02:00 — klart natt
  const day = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", SUNRISE + 9 * 3600000, staticF, DAYLIGHT_DYN); // 13:00 — klart dag
  const dusk = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", SUNSET, staticF, DAYLIGHT_DYN); // nøyaktig solnedgang

  assert.equal(night.breakdown.timeOfDay, 1.05, `forventet nøyaktig 1 + 0.25*0.2 = 1.05, fikk ${night.breakdown.timeOfDay}`);
  assert.equal(day.breakdown.timeOfDay, 0.9625, `forventet nøyaktig 1 - 0.25*0.15 = 0.9625, fikk ${day.breakdown.timeOfDay}`);
  assert.equal(dusk.breakdown.timeOfDay, 1, "dusk skal være nøytral her — den kontinuerlige bonusen ligger i crepuscularActivity");

  assert.ok(
    night.breakdown.timeOfDay > day.breakdown.timeOfDay,
    `forventet nattbasisnivå (${night.breakdown.timeOfDay}) > dagbasisnivå (${day.breakdown.timeOfDay})`
  );
  assert.ok(
    night.suitability > day.suitability,
    `forventet natt-suitability (${night.suitability}) > dag-suitability (${day.suitability}) alt annet likt`
  );
});

test("computeSpatialSuitability: timeOfDay-faktoren er artsdifferensiert — hjort (strength 0.25) påvirkes mer enn elg (strength 0.1) av samme dag/natt-forskjell", async () => {
  const { ELG_ECOLOGY_PROFILE } = await import("./elg");
  const staticF = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const };
  const nightWhen = SUNRISE - 2 * 3600000;

  const hjortNight = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", nightWhen, staticF, DAYLIGHT_DYN);
  const elgNight = computeSpatialSuitability(ELG_ECOLOGY_PROFILE, "sommer", nightWhen, staticF, DAYLIGHT_DYN);

  assert.equal(elgNight.breakdown.timeOfDay, 1.02, `forventet nøyaktig 1 + 0.1*0.2 = 1.02, fikk ${elgNight.breakdown.timeOfDay}`);
  assert.ok(
    hjortNight.breakdown.timeOfDay - 1 > elgNight.breakdown.timeOfDay - 1,
    `forventet hjort sin nattbonus (${hjortNight.breakdown.timeOfDay}) sterkere enn elg sin (${elgNight.breakdown.timeOfDay})`
  );
});

test("computeSpatialSuitability: timeOfDay er nøytral (1) når soloppgang/solnedgang mangler — ingen straff/bonus uten data", () => {
  const staticF = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const };
  const result = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", iso("2026-06-01T02:00:00.000Z"), staticF, UKJENT_DYNAMIC_FEATURES);
  assert.equal(result.breakdown.timeOfDay, 1);
});

test("computeSpatialSuitability: timeOfDay er nøytral (1) for 'annet' (strength 0, ingen forskningsgjennomgang)", async () => {
  const { getEcologyProfile } = await import("./profiles");
  const annet = getEcologyProfile("annet");
  const staticF = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const };
  const night = computeSpatialSuitability(annet, "sommer", SUNRISE - 2 * 3600000, staticF, DAYLIGHT_DYN);
  assert.equal(night.breakdown.timeOfDay, 1);
});

// ---------------------------------------------------------------------------
// computeSpatialSuitability — nedbør (§G, V1.3)
// ---------------------------------------------------------------------------

test("computeSpatialSuitability: hjort — nedbør demper suitability svakt og monotont (ingen nedbør > lett > kraftig), aldri under 85 % av faktoren", () => {
  const staticF = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const };
  const none = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", iso("2026-06-01T13:00:00.000Z"), staticF, {
    ...UKJENT_DYNAMIC_FEATURES,
    precipitationMm: 0,
  });
  const light = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", iso("2026-06-01T13:00:00.000Z"), staticF, {
    ...UKJENT_DYNAMIC_FEATURES,
    precipitationMm: 2,
  });
  const heavy = computeSpatialSuitability(HJORT_ECOLOGY_PROFILE, "sommer", iso("2026-06-01T13:00:00.000Z"), staticF, {
    ...UKJENT_DYNAMIC_FEATURES,
    precipitationMm: 10, // over metningspunktet (5 mm) — skal IKKE straffes hardere enn ved akkurat 5 mm
  });

  assert.equal(none.breakdown.precipitation, 1);
  assert.equal(light.breakdown.precipitation, 0.991, `forventet 1 - 0.15*0.4*0.15 = 0.991, fikk ${light.breakdown.precipitation}`);
  assert.equal(heavy.breakdown.precipitation, 0.9775, `forventet 1 - 0.15*1*0.15 = 0.9775 (metnet), fikk ${heavy.breakdown.precipitation}`);
  assert.ok(none.breakdown.precipitation > light.breakdown.precipitation, "ingen nedbør skal scorer høyere enn lett nedbør");
  assert.ok(light.breakdown.precipitation > heavy.breakdown.precipitation, "lett nedbør skal scorer høyere enn kraftig nedbør");
  assert.ok(heavy.breakdown.precipitation >= 0.85, "faktoren skal aldri gå under det dokumenterte 85 %-gulvet");
});

test("computeSpatialSuitability: precipitation er nøytral (1) når nedbørdata mangler — samme gracious-degradation-mønster som windExposureFactor", () => {
  const staticF = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const };
  const result = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "sommer",
    iso("2026-06-01T13:00:00.000Z"),
    staticF,
    UKJENT_DYNAMIC_FEATURES // precipitationMm: null
  );
  assert.equal(result.breakdown.precipitation, 1);
});

test("computeSpatialSuitability: helt manglende dynamiske miljødata (UKJENT_DYNAMIC_FEATURES) gir nøytrale timeOfDay/precipitation, ikke straff", () => {
  const result = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "sommer",
    iso("2026-06-01T13:00:00.000Z"),
    UKJENT_STATIC_FEATURES,
    UKJENT_DYNAMIC_FEATURES
  );
  assert.equal(result.breakdown.timeOfDay, 1);
  assert.equal(result.breakdown.precipitation, 1);
  assert.ok(result.suitability > 0, "manglende miljødata skal aldri sende suitability til 0");
});
