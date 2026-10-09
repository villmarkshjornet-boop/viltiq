import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { buildHowViltIQWouldHunt, buildRecommendedPostSummary, summarizeObservations, formatObservationAge } =
  await import("./huntPlanNarrative");

// Samme "as never"-konvensjon som huntPlan.test.ts/huntPlanReminder.test.ts —
// se de filene for begrunnelsen (...overrides gjør streng literal-typing
// upraktisk å opprettholde for en fixture-hjelper).
function basePlan(overrides: Record<string, unknown> = {}) {
  const plan = {
    id: "hjort-1-plan-1",
    predictionSnapshotId: "hjort-1",
    zoneId: "hjort-zone-1",
    species: "hjort",
    targetDateTime: new Date().toISOString(),
    primaryZone: { id: "hjort-zone-1", rank: 1, score: 70, confidence: 0.7, center: { latitude: 60, longitude: 10 } },
    recommendedPosition: { latitude: 60, longitude: 10 },
    positionReasoning: ["Punktet er sonens høyest scorede rute."],
    approach: {
      windDirectionDeg: 270,
      windSpeedMs: 3,
      windDirectionLabel: "vest",
      recommendedApproachDirectionDeg: 270,
      recommendedApproachLabel: "vest",
      note: "Vinden kommer fra vest. Nærm deg sonen med kurs mot vest.",
    },
    expectedMovement: {
      confidence: 0.7,
      basis: "observation_corridor",
      note: "Nylig registrert bevegelsesretning gir et rimelig grunnlag for en forventet posisjon.",
    },
    timeWindows: [{ type: "dusk", startMs: Date.now() + 3600_000, endMs: Date.now() + 7200_000 }],
    reasons: { positive: ["Fersk lokal aktivitet"], negative: [] },
    alternatives: [],
    dataFreshness: "god",
    generatedAt: Date.now(),
    ...overrides,
  };
  return plan as never;
}

function baseZone(overrides: Record<string, unknown> = {}) {
  const zone = {
    id: "hjort-zone-1",
    species: "hjort",
    center: { latitude: 60, longitude: 10 },
    radiusMeters: 300,
    score: 70,
    level: "Høy",
    confidence: 0.7,
    confidenceLevel: "høy",
    observationCount: 2,
    distinctCameraCount: 1,
    newestObservationAgeMinutes: 45,
    dominantSignals: [],
    explanation: "",
    signalBreakdown: {
      recency: 0, repetition: 0, cameraDirection: 0, movementDirection: 0,
      cameraDiversity: 0, corridor: 0, ecology: 0,
    },
    predictionMode: "local_dominant",
    ...overrides,
  };
  return zone as never;
}

// ---------------------------------------------------------------------------
// buildHowViltIQWouldHunt — sterk/komplett plan
// ---------------------------------------------------------------------------

test("buildHowViltIQWouldHunt: sterk plan (kjent vind, god freshness, fersk bevegelse) gir konfident, ikke-tom tekst", () => {
  const text = buildHowViltIQWouldHunt(basePlan());
  assert.ok(text.length > 20, `forventet en faktisk tekst, fikk: "${text}"`);
  assert.match(text, /vest/i);
  assert.doesNotMatch(text, /begrenset grunnlag/i, "god datagrunnlag skal IKKE hedges som 'begrenset'");
});

test("buildHowViltIQWouldHunt: nevner morgenvindu/kveldsvindu når timeWindows finnes", () => {
  const dusk = buildHowViltIQWouldHunt(basePlan({ timeWindows: [{ type: "dusk", startMs: 1, endMs: 2 }] }));
  assert.match(dusk, /kveldsvindu/i);
  const dawn = buildHowViltIQWouldHunt(basePlan({ timeWindows: [{ type: "dawn", startMs: 1, endMs: 2 }] }));
  assert.match(dawn, /morgenvindu/i);
});

// ---------------------------------------------------------------------------
// Manglende bevegelsesgrunnlag
// ---------------------------------------------------------------------------

test("buildHowViltIQWouldHunt: insufficient_data gir ærlig 'ikke nok grunnlag'-setning, ALDRI en retning", () => {
  const text = buildHowViltIQWouldHunt(basePlan({ expectedMovement: { confidence: 0, basis: "insufficient_data", note: "x" } }));
  assert.match(text, /ikke nok grunnlag/i);
});

test("buildHowViltIQWouldHunt: crepuscular_habitat_shift nevner IKKE en bestemt retning", () => {
  const text = buildHowViltIQWouldHunt(
    basePlan({ expectedMovement: { confidence: 0.4, basis: "crepuscular_habitat_shift", note: "x" } })
  );
  assert.match(text, /uten en bestemt retning/i);
});

// ---------------------------------------------------------------------------
// Usikkert confidence/basis
// ---------------------------------------------------------------------------

test("buildHowViltIQWouldHunt: lav dataFreshness hedges tilnærmingen som ETT MULIG alternativ, ikke en bestemt anbefaling", () => {
  const text = buildHowViltIQWouldHunt(basePlan({ dataFreshness: "lav" }));
  assert.match(text, /begrenset grunnlag/i);
  assert.match(text, /mulig alternativ/i);
});

test("buildHowViltIQWouldHunt: observation_corridor med LAV confidence (<0.5) hedges med et forbehold, sier ALDRI dyret fortsatt er der", () => {
  const text = buildHowViltIQWouldHunt(
    basePlan({ expectedMovement: { confidence: 0.2, basis: "observation_corridor", note: "x" } })
  );
  assert.match(text, /forbehold/i);
  assert.doesNotMatch(text, /er der/i);
});

test("buildHowViltIQWouldHunt: ukjent vindretning nevner ALDRI en tilnærmingsretning", () => {
  const text = buildHowViltIQWouldHunt(basePlan({ approach: { windDirectionDeg: null, windSpeedMs: null, windDirectionLabel: "ukjent", recommendedApproachDirectionDeg: null, recommendedApproachLabel: "ukjent", note: "x" } }));
  assert.match(text, /ikke grunnlag/i);
  assert.doesNotMatch(text, /vest|øst|nord|sør/i);
});

// ---------------------------------------------------------------------------
// Manglende tidsvindu
// ---------------------------------------------------------------------------

test("buildHowViltIQWouldHunt: tomt timeWindows gir fortsatt en fullverdig, ikke-tom tekst (ingen dawn/dusk-setning lagt til)", () => {
  const text = buildHowViltIQWouldHunt(basePlan({ timeWindows: [] }));
  assert.ok(text.length > 20);
  assert.doesNotMatch(text, /vindu/i);
});

// ---------------------------------------------------------------------------
// Narrativet er ALDRI tomt/meningsløst, uansett kombinasjon
// ---------------------------------------------------------------------------

test("buildHowViltIQWouldHunt: aldri tom tekst, selv i det svakeste tilfellet (ukjent vind + insufficient_data + ingen tidsvindu + ingen habitatovergang)", () => {
  const text = buildHowViltIQWouldHunt(
    basePlan({
      positionReasoning: ["Punktet er sonens høyest scorede rute."],
      approach: { windDirectionDeg: null, windSpeedMs: null, windDirectionLabel: "ukjent", recommendedApproachDirectionDeg: null, recommendedApproachLabel: "ukjent", note: "x" },
      expectedMovement: { confidence: 0, basis: "insufficient_data", note: "x" },
      timeWindows: [],
    })
  );
  assert.ok(text.length > 20, `svakeste tilfelle skal fortsatt gi en meningsfull tekst, fikk: "${text}"`);
  // To setninger (tilnærming + bevegelse) skal alltid finnes selv her.
  assert.equal((text.match(/\./g) || []).length >= 2, true);
});

// ---------------------------------------------------------------------------
// summarizeObservations / formatObservationAge
// ---------------------------------------------------------------------------

test("summarizeObservations: ingen observasjoner gir hasObservations=false", () => {
  const obs = summarizeObservations(baseZone({ observationCount: 0, distinctCameraCount: 0, newestObservationAgeMinutes: 0 }));
  assert.equal(obs.hasObservations, false);
});

test("summarizeObservations: observasjoner MED kamera gir korrekt distinctCameraCount", () => {
  const obs = summarizeObservations(baseZone({ observationCount: 3, distinctCameraCount: 2, newestObservationAgeMinutes: 10 }));
  assert.equal(obs.hasObservations, true);
  assert.equal(obs.count, 3);
  assert.equal(obs.distinctCameraCount, 2);
});

test("formatObservationAge: under 60 min vises i minutter", () => {
  assert.equal(formatObservationAge(12), "for 12 minutter siden");
});

test("formatObservationAge: timer og dager formateres i riktig entall/flertall", () => {
  assert.equal(formatObservationAge(60), "for 1 time siden");
  assert.equal(formatObservationAge(180), "for 3 timer siden");
  // Samme 48-timers terskel som explain.ts sin formatSpan bruker FØR den
  // bytter til dager — 24t vises derfor fortsatt i timer, ikke som "1 dag".
  assert.equal(formatObservationAge(1440), "for 24 timer siden");
  assert.equal(formatObservationAge(2880), "for 2 dager siden");
});

// ---------------------------------------------------------------------------
// buildRecommendedPostSummary — V1.3 "Anbefalt jaktpost"
// ---------------------------------------------------------------------------

const FORBIDDEN_INVENTED_WORDS = [
  "utsikt", "vegetasjon", "kulefang", "skjul", "skjermet",
  "skytesektor", "sti", "høyde på posten", "skuddsjanse",
];
const FORBIDDEN_OVERCLAIM_PHRASES = [
  "den perfekte posten", "her vil dyret komme", "her får du skuddsjanse",
];

test("buildRecommendedPostSummary: positionReasoning MED ekstra innhold (habitatovergang) brukes direkte i hvorfor", () => {
  const post = buildRecommendedPostSummary(
    basePlan({
      positionReasoning: [
        "Punktet er sonens høyest scorede rute — samme punkt sonen faktisk ble bygget rundt.",
        "Punktet ligger nær en habitatovergang (kantsone), som støtter valget som stå-/siktepunkt.",
        "Motoren lagrer ikke score per enkeltcelle innad i sonen utover selve toppcellen.",
      ],
    })
  );
  assert.match(post.hvorfor, /habitatovergang/i);
});

test("buildRecommendedPostSummary: KUN de alltid-tilstedeværende metodologi-/ærlighetslinjene (ingen ekstra innhold) gir den ærlige standardsetningen, ALDRI en oppdiktet detalj", () => {
  const post = buildRecommendedPostSummary(
    basePlan({
      positionReasoning: [
        "Punktet er sonens høyest scorede rute — samme punkt sonen faktisk ble bygget rundt.",
        "Motoren lagrer ikke score per enkeltcelle innad i sonen utover selve toppcellen.",
      ],
    })
  );
  assert.match(post.hvorfor, /basert på eksisterende vurdering av området, vind og forventet bevegelse/i);
});

test("buildRecommendedPostSummary: tomt positionReasoning gir samme ærlige standardsetning (aldri tom tekst)", () => {
  const post = buildRecommendedPostSummary(basePlan({ positionReasoning: [] }));
  assert.match(post.hvorfor, /basert på eksisterende vurdering av området, vind og forventet bevegelse/i);
});

test("buildRecommendedPostSummary: hvordan nevner anbefalt tilnærmingsretning når den er kjent (kort, IKKE en duplisering av hele Vind-seksjonens note)", () => {
  const post = buildRecommendedPostSummary(
    basePlan({ approach: { windDirectionDeg: 270, windSpeedMs: 3, windDirectionLabel: "vest", recommendedApproachDirectionDeg: 270, recommendedApproachLabel: "vest", note: "Ekte motor-note som IKKE skal gjentas her." } })
  );
  assert.match(post.hvordan, /vest/i);
  assert.doesNotMatch(post.hvordan, /Ekte motor-note/);
});

test("buildRecommendedPostSummary: hvordan nevner ALDRI en retning når tilnærmingsretning er ukjent", () => {
  const post = buildRecommendedPostSummary(
    basePlan({ approach: { windDirectionDeg: null, windSpeedMs: null, windDirectionLabel: "ukjent", recommendedApproachDirectionDeg: null, recommendedApproachLabel: "ukjent", note: "x" } })
  );
  assert.doesNotMatch(post.hvordan.toLowerCase(), /vest|øst|nord|sør/);
  assert.match(post.hvordan, /ikke nok grunnlag/i);
});

test("buildRecommendedPostSummary: userLocation gitt -> distanceLabel beregnes og inneholder 'fra deg'", () => {
  const post = buildRecommendedPostSummary(
    basePlan({ recommendedPosition: { latitude: 60, longitude: 10 } }),
    { latitude: 60.01, longitude: 10 }
  );
  assert.notEqual(post.distanceLabel, null);
  assert.match(post.distanceLabel as string, /fra deg/);
});

test("buildRecommendedPostSummary: ingen userLocation -> distanceLabel er null (aldri en gjettet avstand)", () => {
  const post = buildRecommendedPostSummary(basePlan());
  assert.equal(post.distanceLabel, null);
});

test("buildRecommendedPostSummary: userLocation=null (samme som 'ukjent posisjon') -> distanceLabel er null", () => {
  const post = buildRecommendedPostSummary(basePlan(), null);
  assert.equal(post.distanceLabel, null);
});

test("buildRecommendedPostSummary: hvorfor-teksten dikter ALDRI opp ukjente egenskaper (utsikt/vegetasjon/kulefang/skjul/skytesektor/sti/høyde/skuddsjanse) eller falske løfter, uansett datagrunnlag", () => {
  const cases = [
    buildRecommendedPostSummary(basePlan({ positionReasoning: [] })),
    buildRecommendedPostSummary(basePlan()),
    buildRecommendedPostSummary(
      basePlan({
        positionReasoning: [
          "Punktet ligger nær en habitatovergang (kantsone), som støtter valget som stå-/siktepunkt.",
        ],
      })
    ),
  ];
  for (const post of cases) {
    for (const word of FORBIDDEN_INVENTED_WORDS) {
      assert.doesNotMatch(post.hvorfor.toLowerCase(), new RegExp(word), `hvorfor inneholdt oppdiktet ord: "${word}"`);
    }
    for (const phrase of FORBIDDEN_OVERCLAIM_PHRASES) {
      assert.doesNotMatch(post.hvorfor.toLowerCase(), new RegExp(phrase), `hvorfor inneholdt et forbudt overclaim: "${phrase}"`);
    }
  }
});
