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
