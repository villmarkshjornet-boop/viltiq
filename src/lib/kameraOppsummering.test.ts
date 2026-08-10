import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { KameraOppsummeringInput } from "./kameraOppsummering";

// See src/lib/cameraActivity.test.ts / src/testSupport/nodeEsmTestLoader.mjs
// for why this hook is needed: kameraOppsummering.ts (and its dependency
// cameraActivity.ts) use extensionless relative imports that plain
// `node --test` cannot resolve on its own. `import type` above is erased
// entirely by Node's type stripping and never touches this resolution path.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { genererKameraOppsummering } = await import("./kameraOppsummering");
const { LAV_KONFIDENS_TERSKEL } = await import("./cameraActivity");

// ---------------------------------------------------------------------------
// Lav konfidens -> usikker fraseringen, ikke en selvsikker påstand om nivå
// ---------------------------------------------------------------------------

test("genererKameraOppsummering: lav confidence og 0 observasjoner gir usikker fraseringen", () => {
  const input: KameraOppsummeringInput = {
    activeDays: 2,
    observationEvents: 0,
    totalAnimals: 0,
    dominantSpecies: null,
    dominantSpeciesPercentage: null,
    observationsPerWeek: 0,
    animalsPerWeek: 0,
    peakTime: null,
    activityLevel: "low",
    confidence: LAV_KONFIDENS_TERSKEL - 0.1, // under terskelen
  };

  const tekst = genererKameraOppsummering(input);

  assert.match(tekst, /for lite data/i);
  // Skal IKKE inneholde en selvsikker nivå-påstand av typen "vurderes aktiviteten... som lav/middels/høy"
  assert.ok(
    !/vurderes aktiviteten ved kameraet som/i.test(tekst),
    "lav-konfidens-teksten skal ikke fremstille et sikkert aktivitetsnivå"
  );
});

test("genererKameraOppsummering: lav confidence med noen observasjoner nevner antallet, men er fortsatt usikker", () => {
  const input: KameraOppsummeringInput = {
    activeDays: 3,
    observationEvents: 2,
    totalAnimals: 3,
    dominantSpecies: null,
    dominantSpeciesPercentage: null,
    observationsPerWeek: 4.67,
    animalsPerWeek: 7,
    peakTime: null,
    activityLevel: "medium",
    confidence: LAV_KONFIDENS_TERSKEL - 0.2,
  };

  const tekst = genererKameraOppsummering(input);

  assert.match(tekst, /for lite data/i);
  assert.match(tekst, /2 observasjoner/);
});

// ---------------------------------------------------------------------------
// Normal case (høy nok confidence) inneholder nøkkeltallene
// ---------------------------------------------------------------------------

test("genererKameraOppsummering: normal case inneholder nøkkeltall og artsnavn", () => {
  // Brukerens eget eksempel: activeDays≈63, observationEvents=18, totalAnimals=23,
  // dominantSpecies="Rådyr", dominantSpeciesPercentage=74.
  // Merk: activeDays formateres via formaterPeriode() til "9 uker" (63 dager er
  // nøyaktig 9 hele uker) — det er DENNE teksten som skal opptre i strengen,
  // ikke det rå tallet 63.
  const input: KameraOppsummeringInput = {
    activeDays: 63,
    observationEvents: 18,
    totalAnimals: 23,
    dominantSpecies: "Rådyr",
    dominantSpeciesPercentage: 74,
    observationsPerWeek: 2,
    animalsPerWeek: 2.56,
    peakTime: "på ettermiddagen",
    activityLevel: "medium",
    confidence: 0.9,
  };

  const tekst = genererKameraOppsummering(input);

  assert.ok(tekst.includes("9 uker"), "skal inneholde formatert periode");
  assert.ok(tekst.includes("18"), "skal inneholde antall observasjoner");
  assert.ok(tekst.includes("23"), "skal inneholde totalt antall dyr");
  assert.ok(tekst.includes("Rådyr"), "skal inneholde dominant art");
  assert.ok(tekst.includes("74"), "skal inneholde prosentandel for dominant art");
  assert.ok(tekst.includes("på ettermiddagen"), "skal inneholde peakTime");
  assert.ok(tekst.includes("middels"), "skal inneholde norsk nivåtekst for 'medium'");
});

test("genererKameraOppsummering: uten dominant art eller peakTime utelates disse setningene", () => {
  const input: KameraOppsummeringInput = {
    activeDays: 10,
    observationEvents: 5,
    totalAnimals: 6,
    dominantSpecies: null,
    dominantSpeciesPercentage: null,
    observationsPerWeek: 3.5,
    animalsPerWeek: 4.2,
    peakTime: null,
    activityLevel: "low",
    confidence: 0.9,
  };

  const tekst = genererKameraOppsummering(input);

  assert.ok(!tekst.includes("står for"), "ingen dominant-art-setning uten dominantSpecies");
  assert.ok(!tekst.includes("hovedsakelig vært registrert"), "ingen peakTime-setning uten peakTime");
  assert.ok(tekst.includes("lav"), "skal inneholde norsk nivåtekst for 'low'");
});
