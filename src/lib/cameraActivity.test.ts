import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { CameraActivityObservation } from "./cameraActivity";

// cameraActivity.ts itself imports "./aktivitet" WITHOUT a file extension —
// perfectly normal for this repo's bundler (moduleResolution: "bundler"),
// but plain `node --test` (no bundler, no compile step) requires full
// specifiers for relative imports and would fail to resolve it. Registering
// this loader hook (see src/testSupport/nodeEsmTestLoader.mjs for exactly
// why/how) lets us dynamically import the REAL, unmodified cameraActivity.ts
// and exercise its actual exported functions. `import type` above is erased
// entirely by Node's type stripping, so it never hits this resolution issue —
// only the dynamic `import()` below (of runtime values) needs the hook.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { calculateCameraActivity, formaterPeriode, LAV_KONFIDENS_TERSKEL } =
  await import("./cameraActivity");

// ---------------------------------------------------------------------------
// formaterPeriode
// ---------------------------------------------------------------------------

test("formaterPeriode: under 7 dager viser dager i flertall", () => {
  assert.equal(formaterPeriode(2), "2 dager");
});

test("formaterPeriode: 1 dag viser entall", () => {
  assert.equal(formaterPeriode(1), "1 dag");
});

test("formaterPeriode: 0 dager viser dager i flertall", () => {
  assert.equal(formaterPeriode(0), "0 dager");
});

test("formaterPeriode: nøyaktig hele uker viser bare uker", () => {
  // 63 dager = 9 uker jevnt
  assert.equal(formaterPeriode(63), "9 uker");
});

test("formaterPeriode: uker + restdager viser begge deler", () => {
  // 66 dager = 9 uker og 3 dager
  assert.equal(formaterPeriode(66), "9 uker og 3 dager");
});

test("formaterPeriode: nøyaktig 1 uke viser entall 'uke'", () => {
  assert.equal(formaterPeriode(7), "1 uke");
});

// ---------------------------------------------------------------------------
// calculateCameraActivity — grunnleggende telling
// ---------------------------------------------------------------------------

test("calculateCameraActivity: totalAnimals er summen av antall, ikke antall hendelser", () => {
  // Brukerens eget eksempel: 5 observasjoner med antall 2,1,4,2,3 -> events=5, totalAnimals=12
  const installedAt = new Date("2026-08-01T00:00:00.000Z");
  const now = new Date("2026-08-08T00:00:00.000Z"); // 7 dager senere
  const observations: CameraActivityObservation[] = [
    { tid: "2026-08-02T10:00:00.000Z", antall: 2 },
    { tid: "2026-08-03T10:00:00.000Z", antall: 1 },
    { tid: "2026-08-04T10:00:00.000Z", antall: 4 },
    { tid: "2026-08-05T10:00:00.000Z", antall: 2 },
    { tid: "2026-08-06T10:00:00.000Z", antall: 3 },
  ];

  const result = calculateCameraActivity({
    installedAt,
    removedAt: null,
    observations,
    now,
  });

  assert.equal(result.observationEvents, 5);
  assert.equal(result.totalAnimals, 12);
});

test("calculateCameraActivity: activeDays regnes fra installedAt til removedAt", () => {
  const installedAt = new Date("2026-01-01T00:00:00.000Z");
  const removedAt = new Date("2026-01-11T00:00:00.000Z"); // 10 dager senere
  const result = calculateCameraActivity({
    installedAt,
    removedAt,
    observations: [],
  });

  assert.equal(result.activeDays, 10);
});

test("calculateCameraActivity: activeDays regnes fra installedAt til 'now' når removedAt er null", () => {
  const installedAt = new Date("2026-06-01T00:00:00.000Z");
  const now = new Date("2026-06-16T00:00:00.000Z"); // 15 dager senere
  const result = calculateCameraActivity({
    installedAt,
    removedAt: null,
    observations: [],
    now,
  });

  assert.equal(result.activeDays, 15);
});

// ---------------------------------------------------------------------------
// calculateCameraActivity — aktivitetsnivå avhenger av RATE, ikke bare totalt
// antall dyr. Scenariet fra brukeren: "5 dyr på 2 dager" vs "10 dyr på 6
// måneder" — det første skal fremstå som mer aktivt (høyere score/level),
// selv om det har færre dyr totalt.
// ---------------------------------------------------------------------------

test("calculateCameraActivity: høy rate over kort periode slår høyt totalt antall over lang periode", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  // Kamera A: 5 dyr fordelt på 2 observasjoner, over kun 2 dager -> høy rate.
  // Observasjonene er "gamle" (langt tilbake i tid) for at ferskhets-vekten
  // ikke skal favorisere dette kameraet — vi vil isolere effekten av rate.
  const kortInstallert = new Date("2026-01-01T00:00:00.000Z");
  const kortFjernet = new Date("2026-01-03T00:00:00.000Z"); // 2 dager
  const kortPeriode = calculateCameraActivity({
    installedAt: kortInstallert,
    removedAt: kortFjernet,
    observations: [
      { tid: "2026-01-01T12:00:00.000Z", antall: 3 },
      { tid: "2026-01-02T12:00:00.000Z", antall: 2 },
    ],
    now,
  });

  // Kamera B: 10 dyr fordelt på 10 observasjoner over 6 måneder (~180 dager) -> lav rate.
  const langInstallert = new Date("2026-02-01T00:00:00.000Z");
  const langObservasjoner: CameraActivityObservation[] = Array.from(
    { length: 10 },
    (_, i) => ({
      tid: new Date(2026, 1, 1 + i * 18).toISOString(),
      antall: 1,
    })
  );
  const langPeriode = calculateCameraActivity({
    installedAt: langInstallert,
    removedAt: null,
    observations: langObservasjoner,
    now, // ~6 måneder etter installedAt
  });

  assert.ok(
    kortPeriode.totalAnimals < langPeriode.totalAnimals,
    "kort-periode-kameraet skal ha FÆRRE dyr totalt enn lang-periode-kameraet (forutsetning for testen)"
  );
  assert.ok(
    kortPeriode.score > langPeriode.score,
    `forventet at score for høy-rate/kort-periode (${kortPeriode.score}) skal være ` +
      `høyere enn score for lav-rate/lang-periode (${langPeriode.score}), til tross ` +
      `for at sistnevnte har flere dyr totalt`
  );
});

// ---------------------------------------------------------------------------
// calculateCameraActivity — confidence ved lite datagrunnlag
// ---------------------------------------------------------------------------

test("calculateCameraActivity: kort periode uten observasjoner gir lav confidence", () => {
  const installedAt = new Date("2026-08-08T00:00:00.000Z");
  const now = new Date("2026-08-10T00:00:00.000Z"); // 2 dager
  const result = calculateCameraActivity({
    installedAt,
    removedAt: null,
    observations: [],
    now,
  });

  assert.ok(
    result.confidence < LAV_KONFIDENS_TERSKEL,
    `forventet confidence under terskelen (${LAV_KONFIDENS_TERSKEL}), fikk ${result.confidence}`
  );
});

test("calculateCameraActivity: lang periode med mange observasjoner gir markant høyere confidence enn kort periode uten data", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  const kort = calculateCameraActivity({
    installedAt: new Date("2026-08-08T00:00:00.000Z"), // 2 dager
    removedAt: null,
    observations: [],
    now,
  });

  const langInstallert = new Date("2026-06-01T00:00:00.000Z"); // ~70 dager
  const observasjoner: CameraActivityObservation[] = Array.from(
    { length: 15 },
    (_, i) => ({
      tid: new Date(2026, 5, 1 + i * 4).toISOString(),
      antall: 1,
    })
  );
  const lang = calculateCameraActivity({
    installedAt: langInstallert,
    removedAt: null,
    observations: observasjoner,
    now,
  });

  assert.ok(lang.activeDays >= 60, `forutsetning: activeDays >= 60, fikk ${lang.activeDays}`);
  assert.ok(
    lang.confidence > kort.confidence,
    `forventet at confidence for lang periode (${lang.confidence}) skal være ` +
      `markant høyere enn for kort periode uten data (${kort.confidence})`
  );
  assert.ok(
    lang.confidence - kort.confidence >= 0.3,
    `forventet en markant forskjell (>= 0.3) i confidence, fikk ${lang.confidence - kort.confidence}`
  );
});

test("calculateCameraActivity: confidence er alltid i intervallet [0, 1]", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const result = calculateCameraActivity({
    installedAt: new Date("2020-01-01T00:00:00.000Z"),
    removedAt: null,
    observations: Array.from({ length: 50 }, (_, i) => ({
      tid: new Date(2026, 0, 1 + i).toISOString(),
      antall: 1,
    })),
    now,
  });

  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});
