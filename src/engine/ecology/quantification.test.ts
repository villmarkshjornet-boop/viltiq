// ViltIQ Engine — Motor V1.1 kvantifiseringsgrunnlag.
//
// FORMÅL: Dette er IKKE en ren korrekthetstest (selv om den bruker node:test
// og assert som resten av repoet). Formålet er å EMPIRISK måle hvor mye hver
// miljøfaktor faktisk flytter en celles score i DAGENS motor — før noe
// cold-start-arbeid bygges videre på antagelsen om at "koblet inn" betyr
// "har praktisk betydning". Kjør med `npm test` (eller
// `node --test src/engine/ecology/quantification.test.ts`) og LES
// console.log-utskriften — den er hoveddokumentasjonen her, assert-ene er en
// sikring mot at tallene stille endrer seg under senere refaktorering.
//
// Alle scenarier bruker computeSpatialSuitability/computeCrepuscularActivityMultiplier
// direkte (samme funksjoner runEcologicalEngine kaller i engine.ts) for å
// isolere ÉN faktor om gangen, pluss et par fulle runEcologicalEngine()-kall
// der det gir et riktigere "hva ser brukeren"-bilde (cold-start-taket).

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { computeSpatialSuitability, computeCrepuscularActivityMultiplier } = await import("./suitability");
const { getEcologyProfile } = await import("./profiles");
const { UKJENT_STATIC_FEATURES, UKJENT_DYNAMIC_FEATURES } = await import("../environment/types");
const { saturateScore } = await import("../grid");
const { DEFAULT_ENGINE_CONFIG } = await import("../config");
const { runEcologicalEngine } = await import("../engine");
const { buildCoarseSampleGrid, DEFAULT_SAMPLE_SPACING_METERS, DEFAULT_MAX_SAMPLE_POINTS } = await import("../environment/resolve");

const cfg = DEFAULT_ENGINE_CONFIG;
const SPECIES = ["hjort", "radyr", "elg"] as const;

function iso(s: string): number {
  return new Date(s).getTime();
}

// Midt på dagen, langt fra soloppgang/solnedgang (ingen UKJENT_DYNAMIC_FEATURES.sunriseMs/sunsetMs
// satt her heller, så crepuscularMultiplier === 1 alltid med mindre annet er eksplisitt satt).
const NOW_WINTER_MIDDAY = iso("2026-01-15T12:00:00.000Z");
const NOW_SUMMER_MIDDAY = iso("2026-07-01T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Felles hjelpefunksjoner
// ---------------------------------------------------------------------------

type Effect = "ingen effekt" | "minimal (<5%)" | "moderat (5-20%)" | "dominant (>20%)";

/** Klassifiserer hvor mye displayScore (eller suitability) endrer seg relativt mellom to scenarier. */
function classify(a: number, b: number): Effect {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  const pct = (Math.abs(b - a) / ref) * 100;
  if (pct < 0.5) return "ingen effekt";
  if (pct < 5) return "minimal (<5%)";
  if (pct < 20) return "moderat (5-20%)";
  return "dominant (>20%)";
}

/**
 * Rå økologi-bidrag og displayScore for ÉN rutesenter UTEN observasjoner,
 * korridorer eller kamera-diversitetsbonus — nøyaktig samme formel som
 * engine.ts sin `ecologyScoreAt` (engine.ts:321-325): suitability × ecology.weight × crepuscularMultiplier,
 * deretter saturateScore (grid.ts:227-230). Dette ISOLERER den økologiske
 * konstribusjonen fra alt observasjonsbasert, som er poenget her.
 */
function ecologyOnlyScore(suitability: number, crepuscularMultiplier: number): { raw: number; display: number } {
  const raw = suitability * cfg.ecology.weight * crepuscularMultiplier;
  return { raw, display: saturateScore(raw, cfg.zones.scoreSaturation) };
}

function logRow(label: string, suitability: number, raw: number, display: number): void {
  console.log(
    `      ${label.padEnd(24)} suitability=${suitability.toFixed(4)}   raw=${raw.toFixed(4)}   display=${display.toFixed(2)}`
  );
}

// ===========================================================================
// 1. VINDSTYRKE — 0 / 4 / 10 m/s, hjort/rådyr/elg
// ===========================================================================
// windExposureFactor (suitability.ts:87-99) krever aspectDeg + windDirectionDeg
// + windSpeedMs alle satt, og windSpeedMs >= 2 for i det hele tatt å ha noen
// effekt. Vi holder aspekt = vindretning FAST ved 270° (verst-case: skråningen
// vender rett inn i vinden, fullt eksponert, shelterFactor=0) og varierer KUN
// styrken, slik oppdraget ber om.

test("Kvantifisering — vindstyrke (0/4/10 m/s), verst-case eksponert skråning", () => {
  console.log("\n=== 1. VINDSTYRKE (aspekt=270°=rett inn i vinden, verst-case eksponering) ===");
  const speeds = [0, 4, 10];

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    console.log(`  ${species} (windExposureSensitivity.strength=${profile.windExposureSensitivity.strength}):`);
    const rows = speeds.map((ms) => {
      const dyn = { ...UKJENT_DYNAMIC_FEATURES, windDirectionDeg: 270, windSpeedMs: ms };
      const stat = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, aspectDeg: 270 };
      const { suitability } = computeSpatialSuitability(profile, "sommer", NOW_SUMMER_MIDDAY, stat, dyn);
      const { raw, display } = ecologyOnlyScore(suitability, 1);
      logRow(`${ms} m/s`, suitability, raw, display);
      return { ms, suitability, display };
    });
    const [calm, mid, strong] = rows;
    const effect = classify(calm.display, strong.display);
    console.log(`      -> effekt 0->10 m/s: ${effect}`);

    assert.ok(
      strong.suitability <= calm.suitability,
      `${species}: forventet sterk vind (${strong.suitability}) <= stille (${calm.suitability})`
    );
    // Kalibreringsfunn: over 2 m/s-terskelen er formelen BLIND for selve
    // styrken — kun retning (aspekt vs. vindretning) teller. 4 m/s og 10 m/s
    // gir derfor identisk suitability, ikke en gradert forskjell.
    assert.equal(
      mid.suitability,
      strong.suitability,
      `${species}: forventet IDENTISK suitability ved 4 m/s og 10 m/s (formelen skalerer ikke med styrke over terskelen), fikk ${mid.suitability} vs ${strong.suitability}`
    );
    // 0 m/s ligger under 2 m/s-terskelen i windExposureFactor (suitability.ts:95)
    // og skal derfor gi NØYAKTIG samme suitability som "ingen vinddata i det
    // hele tatt" (windSpeedMs: null) — dvs. vind-sub-faktoren er 1, uavhengig
    // av at habitat/andre faktorer fortsatt bidrar til den totale suitabiliteten.
    const noWindStat = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, aspectDeg: 270 };
    const noWindBaseline = computeSpatialSuitability(
      profile,
      "sommer",
      NOW_SUMMER_MIDDAY,
      noWindStat,
      { ...UKJENT_DYNAMIC_FEATURES, windDirectionDeg: 270, windSpeedMs: null }
    ).suitability;
    assert.equal(
      calm.suitability,
      noWindBaseline,
      `${species}: 0 m/s (under 2 m/s-terskelen) skal gi identisk suitability til "ingen vinddata" (ingen effekt), fikk ${calm.suitability} vs ${noWindBaseline}`
    );
  }
  console.log(
    "  KONKLUSJON: vindSTYRKE har KUN effekt via en binær terskel (>=2 m/s), og selv da er strength-verdiene\n" +
      "  (0.10-0.15 for alle tre arter) så lave at maks mulig straff er 2-3% av suitability. I praksis også\n" +
      "  BETINGET av at aspectDeg er kjent (ikke null) — resolve.ts (estimateSlopeAspect) returnerer null på\n" +
      "  flatt/for-grovt-samplet terreng, så effekten uteblir helt for mange celler i praksis."
  );
});

// ===========================================================================
// 2. TEMPERATUR — -5°C / 5°C / 15°C, hjort/rådyr/elg (kun aktiv om vinteren)
// ===========================================================================
// winterSnowElevationFactor (suitability.ts:46-59) bruker
// Math.max(elevPenalty, snowPenalty, tempPenalty) — IKKE en additiv/isolert
// temperaturkurve. For å isolere temperatur alene holder vi
// relativeElevationMeters=0 og snowDepthMeters=0 (begge gir penalty=0), slik
// at kun tempPenalty driver resultatet. tempPenalty = clamp(-tempC/10, 0, 1)
// — KUN negative temperaturer straffer noe i det hele tatt.

test("Kvantifisering — temperatur (-5/5/15 °C), vinter, elevasjon+snø nøytralisert", () => {
  console.log("\n=== 2. TEMPERATUR (vinter, relativeElevationMeters=0, snowDepthMeters=0 — isolerer temp) ===");
  const temps = [-5, 5, 15];

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    console.log(`  ${species} (winterSnowElevation.strength=${profile.winterSnowElevation.strength}):`);
    const rows = temps.map((t) => {
      const stat = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 0 };
      const dyn = { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0, temperatureC: t };
      const { suitability } = computeSpatialSuitability(profile, "vinter", NOW_WINTER_MIDDAY, stat, dyn);
      const { raw, display } = ecologyOnlyScore(suitability, 1);
      logRow(`${t} °C`, suitability, raw, display);
      return { t, suitability, display };
    });
    const [cold, mild, warm] = rows;
    console.log(`      -> effekt -5°C vs 5°C: ${classify(cold.display, mild.display)}`);
    console.log(`      -> effekt 5°C vs 15°C: ${classify(mild.display, warm.display)}`);

    assert.ok(cold.suitability <= mild.suitability, `${species}: -5°C skal ikke score bedre enn 5°C`);
    // Kalibreringsfunn: alt >= 0°C gir penalty=0 — 5°C og 15°C er UMULIGE å
    // skille fra hverandre i denne modellen, kun fravær/nærvær av frost teller.
    assert.equal(
      mild.suitability,
      warm.suitability,
      `${species}: forventet IDENTISK suitability ved 5°C og 15°C (kun negative temperaturer straffer), fikk ${mild.suitability} vs ${warm.suitability}`
    );
  }
  console.log(
    "  KONKLUSJON: temperatur over 0°C er totalt uten differensierende effekt (5°C == 15°C alltid).\n" +
      "  Effekten finnes KUN under 0°C, og er da FAKTISK betydelig for hjort (HIGH evidens, strength=0.9)."
  );
});

test("Kvantifisering — temperatur har NULL effekt utenfor vintersesongen", () => {
  console.log("\n=== 2b. TEMPERATUR utenfor vinter (sommer) — sesong-port ===");
  const profile = getEcologyProfile("hjort");
  const stat = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 0 };
  const cold = computeSpatialSuitability(profile, "sommer", NOW_SUMMER_MIDDAY, stat, {
    ...UKJENT_DYNAMIC_FEATURES,
    temperatureC: -15,
  }).suitability;
  const warm = computeSpatialSuitability(profile, "sommer", NOW_SUMMER_MIDDAY, stat, {
    ...UKJENT_DYNAMIC_FEATURES,
    temperatureC: 20,
  }).suitability;
  console.log(`      hjort, sommer, -15°C vs 20°C: ${cold.toFixed(4)} vs ${warm.toFixed(4)}`);
  assert.equal(cold, warm, "temperatur skal IKKE påvirke suitability i det hele tatt utenfor 'vinter'-sesongen");
});

// ===========================================================================
// 3. ELEVASJON (relativ) — 100 / 400 / 800 m, vinter OG sommer
// ===========================================================================
// VIKTIG PRESISERING: kun `relativeElevationMeters` (høyde relativt til
// områdesnittet) brukes NOEN steder i computeSpatialSuitability — det
// absolutte `elevationMeters`-feltet leses aldri av scoringen. Vi tester
// derfor relativeElevationMeters, som oppdraget selv antyder ("snø-
// elevasjon-preferanse er sesongavhengig").

test("Kvantifisering — relativ elevasjon (100/400/800 m), VINTER — temp+snø nøytralisert", () => {
  console.log("\n=== 3a. ELEVASJON, vinter (snowDepthMeters=0, temperatureC=0 — isolerer elevasjon) ===");
  const elevations = [100, 400, 800];

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    console.log(`  ${species} (winterSnowElevation.strength=${profile.winterSnowElevation.strength}):`);
    const rows = elevations.map((elev) => {
      const stat = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: elev };
      const dyn = { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0, temperatureC: 0 };
      const { suitability } = computeSpatialSuitability(profile, "vinter", NOW_WINTER_MIDDAY, stat, dyn);
      const { raw, display } = ecologyOnlyScore(suitability, 1);
      logRow(`${elev} m rel.`, suitability, raw, display);
      return { elev, suitability, display };
    });
    const [low, mid, high] = rows;
    console.log(`      -> effekt 100m vs 400m: ${classify(low.display, mid.display)}`);
    console.log(`      -> effekt 400m vs 800m: ${classify(mid.display, high.display)}`);

    assert.ok(low.suitability >= mid.suitability, `${species}: 100m skal ikke score dårligere enn 400m om vinteren`);
    // Kalibreringsfunn: elevPenalty = clamp(relElev/300, 0, 1) METTER ved
    // relativeElevationMeters=300 — 400m og 800m er IDENTISKE, ikke gradvis verre.
    assert.equal(
      mid.suitability,
      high.suitability,
      `${species}: forventet IDENTISK suitability ved 400m og 800m (elevPenalty metter ved 300m rel.), fikk ${mid.suitability} vs ${high.suitability}`
    );
  }
  console.log(
    "  KONKLUSJON: elevasjonsstraffen metter ved relativeElevationMeters=300m — alt utover det (400m, 800m,\n" +
      "  8000m) gir NØYAKTIG samme suitability. Kun forskjeller under 300m relativ høyde er meningsfulle for motoren."
  );
});

test("Kvantifisering — relativ elevasjon (100/400/800 m), SOMMER — helt uten effekt", () => {
  console.log("\n=== 3b. ELEVASJON, sommer — sesong-port (skal være HELT flatt) ===");
  const elevations = [100, 400, 800];

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    const results = elevations.map((elev) => {
      const stat = { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: elev };
      const { suitability } = computeSpatialSuitability(profile, "sommer", NOW_SUMMER_MIDDAY, stat, UKJENT_DYNAMIC_FEATURES);
      return suitability;
    });
    console.log(`  ${species}: 100m=${results[0].toFixed(4)}  400m=${results[1].toFixed(4)}  800m=${results[2].toFixed(4)}`);
    assert.equal(results[0], results[1], `${species}: elevasjon skal IKKE påvirke suitability om sommeren (100m vs 400m)`);
    assert.equal(results[1], results[2], `${species}: elevasjon skal IKKE påvirke suitability om sommeren (400m vs 800m)`);
  }
  console.log(
    "  KONKLUSJON: bekrefter at snø-elevasjon-preferansen er STRENGT sesong-gatet (kun 'vinter') — samme\n" +
      "  punkt scorer identisk uansett elevasjon i sommersesongen, jf. suitability.ts:124 (if season === 'vinter')."
  );
});

// ===========================================================================
// 4. HABITATKLASSE — skog (forest) / jordbruk (open/agriculture) / myr (wetland)
// ===========================================================================
// HabitatClass (environment/types.ts:12) = "skog" | "myr" | "jordbruk" | "apent" | "vann" | "bebygd" | "ukjent".
// Vi bruker skog/jordbruk/myr som nærmeste treff på oppdragets forest/open-
// agriculture/wetland. Alt annet nøytralisert (elevasjon=0, vei langt unna,
// ingen kant, ingen vind) slik at KUN habitatFactor driver suitability.

test("Kvantifisering — habitatklasse (skog/jordbruk/myr), alt annet nøytralisert", () => {
  console.log("\n=== 4. HABITATKLASSE (skog=forest, jordbruk=open/agriculture, myr=wetland) ===");
  const habitats = ["skog", "jordbruk", "myr"] as const;

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    console.log(`  ${species} (habitatSuitability.evidence=${profile.habitatSuitability.evidence}):`);
    const rows = habitats.map((h) => {
      const stat = { ...UKJENT_STATIC_FEATURES, habitat: h, relativeElevationMeters: 0, roadDistanceMeters: 5000 };
      const { suitability } = computeSpatialSuitability(profile, "sommer", NOW_SUMMER_MIDDAY, stat, UKJENT_DYNAMIC_FEATURES);
      const { raw, display } = ecologyOnlyScore(suitability, 1);
      logRow(h, suitability, raw, display);
      return { h, suitability, display };
    });
    const best = rows.reduce((a, b) => (b.display > a.display ? b : a));
    const worst = rows.reduce((a, b) => (b.display < a.display ? b : a));
    const effect = classify(best.display, worst.display);
    console.log(`      -> spenn beste (${best.h}) vs. dårligste (${worst.h}): ${effect}`);

    assert.ok(best.display > worst.display, `${species}: forventet et faktisk spenn mellom habitatklasser`);
  }
  console.log(
    "  KONKLUSJON: habitatklasse er den ENESTE faktoren i hele testsettet som konsekvent klassifiserer som\n" +
      "  'dominant' — fordi habitatFactor IKKE er tak-begrenset til en 'aldri under X%'-floor slik de andre\n" +
      "  faktorene er (winterSnow/road/wind har eksplisitte 30-80%-gulv, habitat har INGEN)."
  );
});

// ===========================================================================
// 5. TID PÅ DØGNET (crepuscular-multiplikator) — midt på dagen / solnedgang /
//    natt / soloppgang
// ===========================================================================
// computeCrepuscularActivityMultiplier (suitability.ts:145-156) er en TEMPORAL
// multiplikator, IKKE stedbunden — den ganges likt over HELE analyseområdet.
// Maks effekt oppnås NØYAKTIG ved soloppgang/solnedgang; alt >1 time unna
// begge er identisk nøytralt (1.0) — "natt" og "midt på dagen" er derfor
// UMULIGE å skille fra hverandre i denne modellen.

test("Kvantifisering — tid på døgnet (midday/solnedgang/natt/soloppgang), suitability=1 for å isolere temporal-effekten", () => {
  console.log("\n=== 5. TID PÅ DØGNET (crepuscularMultiplier, suitability=1 for ren temporal isolasjon) ===");
  const sunrise = iso("2026-06-01T04:00:00.000Z");
  const sunset = iso("2026-06-01T22:00:00.000Z");
  const dyn = { ...UKJENT_DYNAMIC_FEATURES, sunriseMs: sunrise, sunsetMs: sunset };

  const timesOfDay = [
    { label: "midt på dagen", whenMs: sunrise + 8 * 3600000 }, // ~12:00, langt fra begge
    { label: "solnedgang/dusk", whenMs: sunset },
    { label: "natt", whenMs: sunset + 4 * 3600000 }, // langt fra begge, "midnatt"-ish
    { label: "soloppgang/dawn", whenMs: sunrise },
  ];

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    console.log(`  ${species} (crepuscularActivity.strength=${profile.crepuscularActivity.strength}):`);
    const rows = timesOfDay.map(({ label, whenMs }) => {
      const mult = computeCrepuscularActivityMultiplier(whenMs, dyn, profile.crepuscularActivity);
      const { raw, display } = ecologyOnlyScore(1, mult);
      console.log(`      ${label.padEnd(20)} multiplikator=${mult.toFixed(4)}   raw=${raw.toFixed(4)}   display=${display.toFixed(2)}`);
      return { label, mult, display };
    });
    const [midday, dusk, night, dawn] = rows;
    console.log(`      -> effekt midday vs. dusk (maks): ${classify(midday.display, dusk.display)}`);

    // Kalibreringsfunn: "natt" og "midt på dagen" er UMULIGE å skille — begge
    // er >1t fra nærmeste tussmørke-vindu og gir derfor nøyaktig multiplikator 1.0.
    assert.equal(midday.mult, night.mult, `${species}: forventet at 'midt på dagen' og 'natt' gir IDENTISK multiplikator (begge nøytrale)`);
    assert.equal(dusk.mult, dawn.mult, `${species}: forventet symmetrisk bonus ved soloppgang og solnedgang`);
    assert.ok(dusk.mult > midday.mult, `${species}: forventet bonus nær solnedgang > nøytral midt på dagen`);
  }
  console.log(
    "  KONKLUSJON: tid-på-døgnet er en RENT TEMPORAL multiplikator påført HELE analyseområdet likt — den\n" +
      "  endrer ALDRI hvilken CELLE som scorer høyest, kun det generelle nivået. Maks bonus er beskjeden\n" +
      "  (+10.5-12% ved eksakt soloppgang/solnedgang for alle tre arter), og 'natt' vs. 'midday' er\n" +
      "  UMULIGE å skille (begge = nøytral 1.0x) — 'natt' gir INGEN egen aktivitetsbonus i dagens modell."
  );
});

// ===========================================================================
// COLD-START SCORE-TAK — maks mulig displayScore med NULL observasjoner
// ===========================================================================
// Bygger det mest gunstige tenkelige EnvironmentalContext per art (beste
// habitatklasse, nøytral sesong/elevasjon, vei langt unna, kantsone-bonus,
// vindstille, "nå" nøyaktig ved soloppgang for maks crepuscular-bonus) og
// kjører den FULLE runEcologicalEngine([], ...)-pipelinen (ingen
// observasjoner) for å lese det FAKTISKE, virkelige score-taket motoren i
// dag kan produsere for et område med NULL lokal evidens.

test("Cold-start score-tak: maks displayScore med NULL observasjoner, per art", () => {
  console.log("\n=== COLD-START SCORE-TAK (NULL observasjoner, mest gunstige miljø per art) ===");
  const center = { latitude: 60.0, longitude: 10.0 };
  const sunriseNow = iso("2026-07-01T04:00:00.000Z"); // sommer (nøytraliserer vinter/vårtrekk-faktorer helt)

  function bestHabitatFor(profile: ReturnType<typeof getEcologyProfile>): "skog" | "myr" | "jordbruk" | "apent" | "vann" | "bebygd" {
    const entries = Object.entries(profile.habitatSuitability.default) as [
      "skog" | "myr" | "jordbruk" | "apent" | "vann" | "bebygd",
      number
    ][];
    return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
  }

  const ceilings: { species: (typeof SPECIES)[number]; display: number; raw: number }[] = [];

  for (const species of SPECIES) {
    const profile = getEcologyProfile(species);
    const bestHabitat = bestHabitatFor(profile);

    const environment = () => ({
      static: {
        ...UKJENT_STATIC_FEATURES,
        habitat: bestHabitat,
        relativeElevationMeters: 0, // nøytralt (og sommersesong nøytraliserer likevel vinter/vårtrekk-faktorene helt)
        roadDistanceMeters: 5000, // langt unna vei -> roadDistanceFactor = 1 (maks)
        nearHabitatEdge: true, // eneste faktor som kan gi BONUS (>1) i computeSpatialSuitability
        aspectDeg: null, // ingen vindeksponerings-straff mulig uten aspekt
      },
      dynamic: {
        ...UKJENT_DYNAMIC_FEATURES,
        windSpeedMs: 0, // vindstille -> windExposureFactor = 1 (maks, uansett)
        sunriseMs: sunriseNow, // "nå" = nøyaktig soloppgang -> maks crepuscularMultiplier
        sunsetMs: sunriseNow + 18 * 3600000, // langt unna, påvirker ikke "closest" (soloppgang er nærmest)
      },
    });

    const result = runEcologicalEngine([], species, {
      now: sunriseNow,
      areaCenter: center,
      areaRadiusMeters: 500,
      environment,
      debug: true,
    });

    const zone = result.zones[0];
    const rawEcology = result.debug?.topCells[0]?.breakdown.ecology ?? 0;
    console.log(
      `  ${species.padEnd(6)} beste habitat=${bestHabitat.padEnd(8)} -> raw ecology=${rawEcology.toFixed(4)}  displayScore=${zone.score.toFixed(1)}  level="${zone.level}"  confidence=${zone.confidence.toFixed(2)} ("${zone.confidenceLevel}")`
    );
    ceilings.push({ species, display: zone.score, raw: rawEcology });

    assert.equal(zone.observationCount, 0, `${species}: cold-start-taket skal måles med NULL bidragsytende observasjoner`);
    assert.equal(zone.confidenceLevel, "lav", `${species}: null observasjoner skal ALLTID gi lav confidence, uansett hvor gunstig miljøet er`);
  }

  console.log(
    `\n  Terskler (config.ts:173): moderat=${cfg.levelThresholds.moderat}  høy=${cfg.levelThresholds.høy}  sværtHøy=${cfg.levelThresholds.sværtHøy}`
  );
  for (const c of ceilings) {
    const crossesHøy = c.display >= cfg.levelThresholds.høy;
    const crossesSværtHøy = c.display >= cfg.levelThresholds.sværtHøy;
    console.log(
      `  ${c.species}: ${c.display.toFixed(1)} -> ${crossesSværtHøy ? "KRYSSER Svært høy!" : crossesHøy ? "KRYSSER Høy!" : "under Høy-terskelen"}`
    );
    // Hoved-produktkravet denne seksjonen svarer på: cold-start (null lokal
    // evidens) skal ALDRI alene kunne late som "Høy"/"Svært høy" aktivitet.
    assert.ok(
      c.display < cfg.levelThresholds.høy,
      `${c.species}: FORVENTNINGSBRUDD — miljø alene (null observasjoner) når displayScore=${c.display}, som er >= Høy-terskelen (${cfg.levelThresholds.høy})`
    );
  }
  console.log(
    "  KONKLUSJON: med dagens ecology.weight=3 (config.ts:127) og scoreSaturation=6 (config.ts:170) klarer\n" +
      "  IKKE miljøet alene å krysse 'Høy' (50) for noen av de tre artene selv i det mest gunstige tenkelige\n" +
      "  scenariet (beste habitat + kantbonus + soloppgang-bonus + vindstille + nøytralisert sesong). Taket\n" +
      "  ligger rundt 'Moderat'-terskelen (25), som stemmer med den DOKUMENTERTE designintensjonen i\n" +
      "  config.ts:117-128 sin kommentar til ecology.weight. Confidence forblir 'lav' i alle tilfeller."
  );
});

// ===========================================================================
// API-KALL-REVISJON: resolveEnvironmentContext() — skalerer den med
// sample-punkter (bra) eller med grid-CELLER (dårlig)?
// ===========================================================================

test("API-kall-revisjon: resolveEnvironmentContext() skalerer med SAMPLE-punkter, ikke med grid-CELLER", () => {
  console.log("\n=== API-KALL-REVISJON: resolveEnvironmentContext() ===");

  // Bruker den FAKTISKE buildCoarseSampleGrid (nå eksportert fra resolve.ts)
  // i stedet for en manuell reimplementering — en tidligere kopi her drev fra
  // kildekoden etter at V1.1-revisjonen rettet et avrundingsavvik (se
  // resolve.test.ts): ett enkelt sqrt-skaleringssteg + Math.ceil kunne runde
  // antall punkter opp OVER maxPoints igjen (49 punkter ved et tak på 36).
  // Fikset i resolve.ts sin buildCoarseSampleGrid (nå en liten løkke som
  // gjentar skaleringen til taket faktisk holder) — importer ekte funksjon
  // her for at denne testen aldri kan drifte fra den virkelige logikken igjen.
  function sampleGridPointCount(radiusMeters: number, spacingMeters: number, maxPoints: number): number {
    return buildCoarseSampleGrid({ latitude: 60, longitude: 10 }, radiusMeters, spacingMeters, maxPoints).points.length;
  }

  // app/kart.tsx:766/810/842 — analyseRadiusMeter = Math.min(radiusKm * 1000, 5000)
  // app/kart.tsx:768            — resolveEnvironmentContext(userLocation, analyseRadiusMeter)
  //                                INGEN options-argument sendes inn, så de EKTE eksporterte
  // defaultene i resolve.ts gjelder — importert her (ikke en lokal kopi) for at
  // testen aldri kan drifte fra virkelig oppførsel igjen.
  const REALISTIC_RADIUS_M = 5000;
  const DEFAULT_SPACING_M = DEFAULT_SAMPLE_SPACING_METERS;
  const DEFAULT_MAX_POINTS = DEFAULT_MAX_SAMPLE_POINTS;

  const samplePoints = sampleGridPointCount(REALISTIC_RADIUS_M, DEFAULT_SPACING_M, DEFAULT_MAX_POINTS);
  const elevationCalls = samplePoints; // src/engine/environment/elevation.ts:16 — ett fetch() per sample-punkt (resolve.ts, cachedElevation)
  const habitatCalls = samplePoints; // src/engine/environment/habitat.ts:39 — ett fetch() per sample-punkt (resolve.ts, cachedHabitat)
  const roadCalls = 1; // src/engine/environment/roads.ts:20 — ETT Overpass-kall for HELE området, nå OGSÅ cachet (cachedRoads, V1.2)
  const weatherCalls = 1; // src/engine/environment/dynamic.ts:18 — ETT Open-Meteo-kall for HELE området, nå OGSÅ cachet (cachedDynamicEnvironment, V1.2)
  const totalCalls = elevationCalls + habitatCalls + roadCalls + weatherCalls;

  console.log(`  Realistisk område (app/kart.tsx:766): radius=${REALISTIC_RADIUS_M} m (radiusKm*1000, kappet til 5000 m)`);
  console.log(`  Sample-grid (V1.2: default spacing=${DEFAULT_SPACING_M}m/maxPoints=${DEFAULT_MAX_POINTS}, hevet fra 36): ${samplePoints} punkter`);
  console.log(`    -> elevation.ts fetch(): ${elevationCalls} kall (per sample-punkt, 7-dagers TTL-cache)`);
  console.log(`    -> habitat.ts fetch(): ${habitatCalls} kall (per sample-punkt, 7-dagers TTL-cache)`);
  console.log(`    -> roads.ts fetch(): ${roadCalls} kall (ETT Overpass-kall for hele området, 7-dagers TTL-cache, V1.2)`);
  console.log(`    -> dynamic.ts fetch(): ${weatherCalls} kall (ETT Open-Meteo-kall for hele området, 30-min TTL-cache, V1.2)`);
  console.log(`  TOTALT: ${totalCalls} HTTP-kall per resolveEnvironmentContext()-kjøring (kald cache — varme kall fra samme område/vindu er 0)`);
  console.log(`  Til sammenligning: grid.ts sitt scoring-grid kan ha opptil maxGridCells=${cfg.maxGridCells} celler (config.ts:137).`);
  console.log(
    "  MEN hver av de celle-scoringene slår KUN opp i resolve.ts sin nearestSample()/bilinearElevationAt() — et rent\n" +
      "  in-memory oppslag i den allerede hentede sample-listen. Ingen ekstra nettverkskall per celle."
  );

  // V1.2: taket hevet fra <150 til <300 — bevisst tillatt flere kall enn
  // V1.1 (100+100+1+1=202) for bedre miljøoppløsning (se filens hoved-
  // kommentar §1-3), men FORTSATT et lite, FAST antall — ikke bundet til
  // scoring-gridets celletall, og fortsatt langt under maxGridCells.
  assert.ok(totalCalls < 300, `forventet et lite, fast antall API-kall (<300) for et realistisk område, fikk ${totalCalls}`);
  assert.ok(
    totalCalls < cfg.maxGridCells,
    `API-kallene (${totalCalls}) skal være LANGT under scoring-gridets maks celletall (${cfg.maxGridCells}) — det er nettopp det som beviser at kallene er bundet av SAMPLE-punkter, ikke grid-CELLER`
  );

  // RETTET (V1.1, fortsatt sant i V1.2): buildCoarseSampleGrid overskrider
  // ikke taket — se resolve.test.ts for full regresjonsdekning.
  assert.ok(
    samplePoints <= DEFAULT_MAX_POINTS,
    `forventet at sample-punktene holder seg innenfor maxSamplePoints=${DEFAULT_MAX_POINTS}, fikk ${samplePoints}`
  );
  console.log(
    "  KONKLUSJON: resolveEnvironmentContext() sine nettverkskall er bundet av maxSamplePoints (fast, uavhengig\n" +
      "  av områdestørrelse innenfor normal bruk), IKKE av scoring-gridets celletall. Dette er GOD skalering —\n" +
      "  hundrevis-av-celler-scenarioet oppdraget advarer mot, oppstår IKKE i dagens kode. Vei og vær er nå\n" +
      "  OGSÅ cachet (V1.2), så re-oppløsning av samme (avrundede) område innenfor cache-vinduet er 0 nye kall."
  );
});
