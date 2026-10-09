import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Se src/lib/geo.test.ts for hvorfor denne hooken trengs (extensionless
// relative import nedenfor).
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { computeReminderFireAtMs, buildReminderContent, reminderIdentifier, REMINDER_MARGIN_MINUTES } =
  await import("./huntPlanReminder");

const NOW = new Date("2026-09-23T16:00:00.000Z").getTime();

// Minimal, men typegyldig HuntPlan-fixture — matcher konvensjonen i
// huntPlan.test.ts sin baseZone(): kun feltene testene faktisk leser
// (species, timeWindows, id) har meningsfulle verdier, resten er nøytrale
// plassholdere som tilfredsstiller typen.
// Returnerer `as never` — samme etablerte konvensjon som huntPlan.test.ts sin
// baseZone()/baseEnvironment() bruker ved kallsstedet: `...overrides` gjør
// streng literal-typing (f.eks. `species: "hjort"` som `Species`, ikke bare
// `string`) umulig å opprettholde uten å skrive hver override-variant separat
// — bevisst løst typet fixture-hjelper, typesjekket der det faktisk teller
// (selve implementasjonen i huntPlanReminder.ts).
function baseHuntPlan(overrides: Record<string, unknown> = {}) {
  const plan = {
    id: "hjort-1758600000000-hjort-zone-1-plan-1758600000000",
    predictionSnapshotId: "hjort-1758600000000",
    zoneId: "hjort-zone-1",
    species: "hjort",
    targetDateTime: new Date(NOW).toISOString(),
    primaryZone: {
      id: "hjort-zone-1",
      rank: 1,
      score: 62,
      confidence: 0.6,
      center: { latitude: 60.0, longitude: 10.0 },
    },
    recommendedPosition: { latitude: 60.0, longitude: 10.0 },
    positionReasoning: ["Punktet er sonens høyest scorede rute."],
    approach: {
      windDirectionDeg: 270,
      windSpeedMs: 3,
      windDirectionLabel: "vest",
      recommendedApproachDirectionDeg: 270,
      recommendedApproachLabel: "vest",
      note: "Vinden kommer fra vest.",
    },
    expectedMovement: { confidence: 0, basis: "insufficient_data", note: "Utilstrekkelig grunnlag." },
    timeWindows: [{ type: "dusk", startMs: NOW + 2 * 3600_000, endMs: NOW + 3 * 3600_000 }],
    reasons: { positive: [], negative: [] },
    alternatives: [],
    dataFreshness: "middels",
    generatedAt: NOW,
    ...overrides,
  };
  return plan as never;
}

// ---------------------------------------------------------------------------
// computeReminderFireAtMs
// ---------------------------------------------------------------------------

test("computeReminderFireAtMs: fyrer REMINDER_MARGIN_MINUTES før timeWindows[0].startMs", () => {
  const windowStartMs = NOW + 2 * 3600_000; // matcher default timeWindows[0] i baseHuntPlan()
  const fireAtMs = computeReminderFireAtMs(baseHuntPlan(), NOW);
  assert.equal(fireAtMs, windowStartMs - REMINDER_MARGIN_MINUTES * 60_000);
});

test("computeReminderFireAtMs: null når planen ikke har noe tidsvindu", () => {
  const plan = baseHuntPlan({ timeWindows: [] });
  assert.equal(computeReminderFireAtMs(plan, NOW), null);
});

test("computeReminderFireAtMs: null når vinduet (minus margin) allerede er passert/for nært", () => {
  const plan = baseHuntPlan({ timeWindows: [{ type: "dusk", startMs: NOW + 60_000, endMs: NOW + 3600_000 }] });
  assert.equal(computeReminderFireAtMs(plan, NOW), null);
});

test("computeReminderFireAtMs: bruker KUN første tidsvindu, ikke et senere", () => {
  const plan = baseHuntPlan({
    timeWindows: [
      { type: "dawn", startMs: NOW + 3 * 3600_000, endMs: NOW + 4 * 3600_000 },
      { type: "dusk", startMs: NOW + 10 * 3600_000, endMs: NOW + 11 * 3600_000 },
    ],
  });
  assert.equal(computeReminderFireAtMs(plan, NOW), NOW + 3 * 3600_000 - REMINDER_MARGIN_MINUTES * 60_000);
});

// ---------------------------------------------------------------------------
// buildReminderContent
// ---------------------------------------------------------------------------

test("buildReminderContent: nevner artsnavnet, lover ikke mer enn planen sier", () => {
  const content = buildReminderContent(baseHuntPlan({ species: "hjort" }));
  assert.match(content.title, /ViltIQ/);
  assert.match(content.body, /Hjort/i);
});

test("buildReminderContent: ulike arter gir ulik tekst (ingen hardkodet artsnavn)", () => {
  const hjort = buildReminderContent(baseHuntPlan({ species: "hjort" }));
  const radyr = buildReminderContent(baseHuntPlan({ species: "radyr" }));
  assert.notEqual(hjort.body, radyr.body);
});

// ---------------------------------------------------------------------------
// reminderIdentifier
// ---------------------------------------------------------------------------

test("reminderIdentifier: deterministisk og stabil for samme plan.id (garanterer 'erstatt, ikke dupliser')", () => {
  const plan = baseHuntPlan();
  assert.equal(reminderIdentifier(plan), reminderIdentifier(baseHuntPlan()));
});

test("reminderIdentifier: ulik for ulik plan.id (ulikt tidspunkt/sone gir egen påminnelse)", () => {
  const a = baseHuntPlan({ id: "plan-a" });
  const b = baseHuntPlan({ id: "plan-b" });
  assert.notEqual(reminderIdentifier(a), reminderIdentifier(b));
});
