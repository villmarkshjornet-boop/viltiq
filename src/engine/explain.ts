// ViltIQ Engine v1 — forklaringer (§21–22, §34).
//
// Bygges DETERMINISTISK fra tallene motoren allerede har regnet ut — ingen
// fri tekstgenerering. Samme input gir alltid samme forklaring. Språket
// følger §34: aldri "dyret er her", alltid "sannsynlig aktivitet" / "vurdert
// område" / "indikasjoner peker mot".

import { distanceMeters, vindRetningLabel } from "@/src/lib/geo";
import { UKJENT_DYNAMIC_FEATURES, type DynamicEnvironmentalFeatures, type HabitatClass } from "./environment/types";
import { computeCrepuscularActivityMultiplier, type SuitabilityBreakdown } from "./ecology/suitability";
import type { Season, WeightedFactor } from "./ecology/types";
import type { SpeciesProfile } from "./species/profiles";
import type {
  ActivityLevel,
  ConfidenceLevel,
  EngineDebugCorridor,
  EngineObservation,
  EngineSignalBreakdown,
  LatLng,
  PredictionZone,
  RecommendedTimeWindow,
  ZoneRecommendation,
} from "./types";

function formatSpan(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `siste ${Math.max(1, min)} minutter`;
  const hrs = Math.round(ms / 3600000);
  if (hrs < 48) return `siste ${hrs} time${hrs === 1 ? "" : "r"}`;
  const days = Math.round(ms / 86400000);
  return `siste ${days} dager`;
}

const HABITAT_LABELS: Record<HabitatClass, string> = {
  skog: "Skogterreng",
  myr: "Myrterreng",
  jordbruk: "Kulturlandskap/jordbruksmark",
  apent: "Åpent landskap",
  vann: "Vann/våtmark",
  bebygd: "Bebygd område",
  ukjent: "Ukjent arealtype",
};

/**
 * Kontekst for å bygge en økologisk (miljøbasert) forklaring — brukt når en
 * sone har lite/ingen lokalt datagrunnlag (§28/§T i V1.1-oppdraget). Bygges
 * av engine.ts fra samme `computeSpatialSuitability`-kall som scoringen
 * allerede gjør, KUN til forklaringsformål (ingen ny nettverk/scoring-logikk).
 */
export type EcologyExplanationContext = {
  breakdown: SuitabilityBreakdown;
  habitat: HabitatClass;
  season: Season;
  crepuscularMultiplier: number;
  rutActive: boolean;
  /**
   * V1.3: RÅ soloppgang/solnedgang-tidspunkt (samme kilde som crepuscularMultiplier
   * over ble regnet fra, se environment/dynamic.ts) — lagret HER (i tillegg til
   * selve multiplikatoren for "nå") fordi `computeRecommendedTimeWindow` under
   * trenger de faktiske klokkeslettene for å utlede et KLOKKESLETT-VINDU, ikke
   * bare "nå sin" multiplikator-verdi. `null`/fraværende når motoren kjørte
   * uten værdata. Valgfrie (ikke i eldre, allerede eksisterende
   * EcologyExplanationContext-literaler/tester) — les alltid som `?? null`.
   */
  sunriseMs?: number | null;
  sunsetMs?: number | null;
  /** Artens EGEN crepuscularActivity-faktor (ecology/profiles.ts) — samme objekt som ble brukt til å regne ut crepuscularMultiplier, gjenbrukt av computeRecommendedTimeWindow til å avgjøre HVOR BREDT vinduet er for akkurat denne arten. Valgfri, samme grunn som sunriseMs/sunsetMs over — fravær betyr rett og slett "intet beregnet tidsvindu", ikke en feil. */
  crepuscularActivity?: WeightedFactor;
};

export type ZoneExplanationInput = {
  species: SpeciesProfile;
  level: ActivityLevel;
  center: LatLng;
  contributingObservations: readonly EngineObservation[];
  breakdown: EngineSignalBreakdown;
  distinctCameraCount: number;
  corridors: readonly EngineDebugCorridor[];
  nowMs: number;
  ecology?: EcologyExplanationContext;
  /**
   * V1.2 §21-22 (kritisk korrigering): styrer HVILKEN av de to signal-
   * gruppene (miljø vs. lokal evidens) som får prioritet når begge finnes —
   * samme klassifisering motoren allerede bruker til UI (predictionMode),
   * gjenbrukt her i stedet for at explain.ts skulle regne ut sin egen,
   * parallelle vurdering av hva som dominerer.
   */
  predictionMode?: "environment_only" | "environment_plus_local" | "local_dominant";
};

type EcologyCandidate = { text: string; weight: number };

/**
 * Klassifiserer hver økologiske delfaktor som Støtter/Nøytralt/Begrenser
 * (§28) — DETERMINISTISK ut fra tallene `computeSpatialSuitability` allerede
 * har regnet ut. Terskler er bevisst symmetriske rundt "ingen effekt" (1.0
 * for de multiplikative faktorene, ~0.5 for habitat), ikke nye vekter.
 */
function classifyEcologyFactors(ctx: EcologyExplanationContext): {
  supports: EcologyCandidate[];
  limits: EcologyCandidate[];
} {
  const supports: EcologyCandidate[] = [];
  const limits: EcologyCandidate[] = [];
  const { breakdown, habitat, season, crepuscularMultiplier, rutActive } = ctx;

  const habitatLabel = HABITAT_LABELS[habitat];
  if (breakdown.habitat >= 0.6) {
    supports.push({ text: `${habitatLabel} (gunstig habitat)`, weight: breakdown.habitat });
  } else if (breakdown.habitat <= 0.4) {
    limits.push({ text: `${habitatLabel} (mindre gunstig habitat)`, weight: 1 - breakdown.habitat });
  }

  if (season === "vinter" && breakdown.winterSnowElevation < 0.98) {
    limits.push({ text: "Høyde-/snøforhold reduserer forventet aktivitet", weight: 1 - breakdown.winterSnowElevation });
  }
  if (season === "vårtrekk" && breakdown.springGreenup < 0.98) {
    limits.push({ text: "Høydepreferanse i vårtrekk ikke oppfylt her", weight: 1 - breakdown.springGreenup });
  }
  if (breakdown.road < 0.9) {
    limits.push({ text: "Nær vei/bebyggelse", weight: 1 - breakdown.road });
  }
  if (breakdown.edge > 1.03) {
    supports.push({ text: "Kantsone/habitatovergang i nærheten", weight: breakdown.edge - 1 });
  }
  if (breakdown.windExposure < 0.95) {
    limits.push({ text: "Værutsatt terreng", weight: 1 - breakdown.windExposure });
  }
  if (crepuscularMultiplier > 1.05) {
    supports.push({ text: "Aktiv døgnperiode (skumring/demring)", weight: crepuscularMultiplier - 1 });
  }
  if (breakdown.timeOfDay > 1.03) {
    supports.push({ text: "Nattaktivitet – økt forventet aktivitetsnivå", weight: breakdown.timeOfDay - 1 });
  } else if (breakdown.timeOfDay < 0.97) {
    limits.push({ text: "Dagtid – lavere forventet aktivitetsnivå", weight: 1 - breakdown.timeOfDay });
  }
  // NB: terskelen er lavere enn de andre (0.99, ikke 0.97) — precipitationFactor
  // er BEVISST svært svakt vektet (LOW evidens, §G), så selv kraftig nedbør
  // (metningspunkt) for den sterkeste arten (hjort, strength 0.15) gir maks
  // ~0.0225 avvik fra nøytral. En terskel på 0.97 ville aldri trigget.
  if (breakdown.precipitation < 0.99) {
    limits.push({ text: "Nedbør kan dempe aktiviteten noe", weight: 1 - breakdown.precipitation });
  }
  if (rutActive) {
    supports.push({ text: "Brunsttid – økt bevegelse", weight: 0.5 });
  }

  supports.sort((a, b) => b.weight - a.weight);
  limits.sort((a, b) => b.weight - a.weight);
  return { supports, limits };
}

const MAX_FACTORS_PER_LINE = 3;

/**
 * Bygger de tre Støtter/Nøytralt/Begrenser-linjene for en sone UTEN lokalt
 * datagrunnlag — kalt fra `buildZoneExplanation` i stedet for den generiske
 * fallback-teksten, hver gang motoren kan tilby en økologisk kontekst (§28).
 */
function buildEcologyOnlyExplanation(species: SpeciesProfile, ecology: EcologyExplanationContext): ZoneExplanation {
  const { supports, limits } = classifyEcologyFactors(ecology);

  const lines: string[] = [];
  if (supports.length > 0) {
    lines.push(`Støtter: ${supports.slice(0, MAX_FACTORS_PER_LINE).map((c) => c.text).join(" · ")}`);
  }
  lines.push("Nøytralt: Lite lokalt datagrunnlag");
  const limitTexts = limits.slice(0, MAX_FACTORS_PER_LINE).map((c) => c.text);
  limitTexts.push("Ingen ferske observasjoner i området");
  lines.push(`Begrenser: ${limitTexts.join(" · ")}`);

  return {
    explanation: `Miljøbasert vurdering for ${species.label.toLowerCase()} — ingen ferske lokale observasjoner i området ennå.`,
    dominantSignals: lines.slice(0, 4),
  };
}

export type ZoneExplanation = { explanation: string; dominantSignals: string[] };

const MIN_SIGNAL_CONTRIBUTION = 0.05;

/**
 * Slår sammen to kandidatgrupper (dominerende + sekundær) til maks `max`
 * elementer, men reserverer BEVISST minst én plass til den sekundære
 * gruppen når den har noe å vise — se buildZoneExplanation for hvorfor.
 */
function pickBlended(dominant: readonly EcologyCandidate[], secondary: readonly EcologyCandidate[], max: number): EcologyCandidate[] {
  if (secondary.length === 0) return dominant.slice(0, max);
  if (dominant.length === 0) return secondary.slice(0, max);
  const secondaryCount = Math.min(1, secondary.length, max - 1);
  const dominantCount = max - secondaryCount;
  return [...dominant.slice(0, dominantCount), ...secondary.slice(0, secondaryCount)];
}

/**
 * Bygger LOKALE (observasjonsbaserte) Støtter/Begrenser-kandidater —
 * SIGNALER, ikke bokføring (V1.2 §23). Erstatter den tidligere "alltid med:
 * antall + alder"-bokføringen (som ofte gjentok samme faktum to ganger, se
 * §23-eksempelet i motoroppdraget) med faktiske, vektede signaler som
 * konkurrerer om plass på linje med de økologiske kandidatene.
 */
function classifyLocalFactors(
  contributingObservations: readonly EngineObservation[],
  breakdown: EngineSignalBreakdown,
  distinctCameraCount: number,
  nowMs: number,
  corridorRelevant: boolean,
  nearestCorridor: EngineDebugCorridor | null
): { supports: EcologyCandidate[]; limits: EcologyCandidate[] } {
  const supports: EcologyCandidate[] = [];
  const limits: EcologyCandidate[] = [];

  const newest = Math.max(...contributingObservations.map((o) => o.timestamp));
  const newestAgeHours = (nowMs - newest) / 3600000;

  if (newestAgeHours < 2) {
    supports.push({ text: "Fersk lokal aktivitet", weight: Math.max(breakdown.recency, 0.5) });
  }
  if (contributingObservations.length >= 2) {
    supports.push({ text: "Gjentatte observasjoner i området", weight: breakdown.repetition });
  }
  if (distinctCameraCount >= 2) {
    supports.push({
      text: `${distinctCameraCount} uavhengige kamera støtter området`,
      weight: breakdown.cameraDiversity || distinctCameraCount,
    });
  }
  if (corridorRelevant && nearestCorridor) {
    supports.push({
      text: `Aktiviteten ser ut til å bevege seg mot ${vindRetningLabel(nearestCorridor.bearingDeg)}`,
      weight: breakdown.corridor,
    });
  }
  if (breakdown.movementDirection > MIN_SIGNAL_CONTRIBUTION) {
    supports.push({ text: "Registrert bevegelsesretning peker mot området", weight: breakdown.movementDirection });
  }
  if (breakdown.cameraDirection > MIN_SIGNAL_CONTRIBUTION) {
    supports.push({ text: "Kamerasektor peker mot området", weight: breakdown.cameraDirection });
  }
  // V1.3 (§J): eksplisitt reason code for "evidence fusion" — flere
  // UAVHENGIGE, innbyrdes konsistente lokale signaler (ulike kilder,
  // gjentakelser, en sammenhengende korridor), se evidenceFusion.ts. Bevisst
  // IKKE fraset som at det er samme individ — kun at signalene støtter
  // hverandre (§34).
  if ((breakdown.evidenceDensity ?? 0) > MIN_SIGNAL_CONTRIBUTION) {
    supports.push({ text: "Flere uavhengige signaler støtter området", weight: breakdown.evidenceDensity ?? 0 });
  }
  // Ærlig begrensning: kun ÉN, ikke helt fersk observasjon er fortsatt et
  // tynt grunnlag, selv om den støtter sonen — nevnes derfor også som en
  // begrensning, ikke bare en støtte, når det er den ENESTE lokale evidensen.
  if (contributingObservations.length === 1 && newestAgeHours > 6) {
    limits.push({ text: "Lite lokalt datagrunnlag ennå", weight: 0.3 });
  }

  supports.sort((a, b) => b.weight - a.weight);
  limits.sort((a, b) => b.weight - a.weight);
  return { supports, limits };
}

type OrderedReasons = {
  supports: EcologyCandidate[];
  limits: EcologyCandidate[];
  corridorRelevant: boolean;
  nearestCorridor: EngineDebugCorridor | null;
};

/**
 * DELT av `buildZoneExplanation` (streng-form, §21-23) og
 * `buildZoneRecommendation` (strukturert form, V1.3 §O) — regner ut de
 * samme Støtter/Begrenser-kandidatene i SAMME prioriterte rekkefølge kun ÉN
 * gang, slik at de to formatene aldri kan komme til å vise ulike grunner for
 * samme sone. Selve klassifiseringen (hvilke faktorer teller som støtte vs.
 * begrensning) skjer fortsatt utelukkende i `classifyLocalFactors`/
 * `classifyEcologyFactors` — denne funksjonen orkestrerer kun rekkefølgen.
 */
function resolveOrderedReasons(input: ZoneExplanationInput): OrderedReasons {
  const { center, contributingObservations, breakdown, distinctCameraCount, corridors, nowMs, ecology, predictionMode } = input;

  if (contributingObservations.length === 0) {
    if (!ecology) return { supports: [], limits: [], corridorRelevant: false, nearestCorridor: null };
    const { supports, limits } = classifyEcologyFactors(ecology);
    // Samme "alltid nevnt"-begrensning som buildEcologyOnlyExplanation sin
    // strengbaserte Begrenser-linje legger til, kun som en egen kandidat her
    // (vekt 0 — den skal ikke fortrenge en reell, tyngre begrensning, bare
    // alltid være MED når det ikke finnes lokale observasjoner i det hele tatt).
    return { supports, limits: [...limits, { text: "Ingen ferske observasjoner i området", weight: 0 }], corridorRelevant: false, nearestCorridor: null };
  }

  // Nærmeste korridor til denne sonen — brukt både til bullet og til summary-retning.
  let nearestCorridor: EngineDebugCorridor | null = null;
  let nearestCorridorDist = Infinity;
  for (const c of corridors) {
    const d = distanceMeters(center, c.point);
    if (d < nearestCorridorDist) {
      nearestCorridorDist = d;
      nearestCorridor = c;
    }
  }
  const corridorRelevant = breakdown.corridor > MIN_SIGNAL_CONTRIBUTION && nearestCorridor != null;

  const local = classifyLocalFactors(contributingObservations, breakdown, distinctCameraCount, nowMs, corridorRelevant, nearestCorridor);
  const eco = ecology ? classifyEcologyFactors(ecology) : { supports: [], limits: [] };

  // "local_dominant" (eller ingen ecology i det hele tatt, dvs. ren
  // runEngine) -> lokal evidens først. "environment_plus_local" -> miljøet
  // står for mesteparten av scoren og nevnes derfor først. Reserverer
  // BEVISST minst én plass til den ikke-dominerende gruppen når begge har
  // noe å vise — ellers kunne f.eks. tre sterke miljøgrunner fylle alle tre
  // plassene og skjule at én fersk observasjon faktisk var det som løftet
  // sonen fra "environment_only" til "environment_plus_local" i utgangspunktet.
  const localFirst = predictionMode !== "environment_plus_local";
  const supports = localFirst
    ? pickBlended(local.supports, eco.supports, MAX_FACTORS_PER_LINE)
    : pickBlended(eco.supports, local.supports, MAX_FACTORS_PER_LINE);
  const limits = localFirst
    ? pickBlended(local.limits, eco.limits, MAX_FACTORS_PER_LINE)
    : pickBlended(eco.limits, local.limits, MAX_FACTORS_PER_LINE);

  return { supports, limits, corridorRelevant, nearestCorridor };
}

/**
 * KRITISK KORRIGERING (V1.2 §21-22): tidligere ble HELE den økologiske
 * forklaringen forkastet i det øyeblikket én eneste observasjon bidro til
 * sonen — selv når miljøet fortsatt stod for majoriteten av rå-scoren
 * (bekreftet empirisk: ~70 % miljø-andel i en `environment_plus_local`-sone
 * ga en forklaring som utelukkende nevnte observasjonstelling/alder).
 * `buildZoneExplanation` blander nå BEGGE kildene når begge finnes, og lar
 * `predictionMode` (samme klassifisering UI-et allerede viser) avgjøre
 * hvilken av de to gruppene som får førsteprioritet i Støtter/Begrenser-
 * linjene — ren omprioritering av allerede beregnede tall, ingen ny scoring.
 */
export function buildZoneExplanation(input: ZoneExplanationInput): ZoneExplanation {
  const { species, level, contributingObservations, nowMs, ecology, predictionMode } = input;

  if (contributingObservations.length === 0) {
    if (ecology) {
      return buildEcologyOnlyExplanation(species, ecology);
    }
    return {
      explanation: `Vurdert område med lite datagrunnlag for ${species.label.toLowerCase()}.`,
      dominantSignals: [],
    };
  }

  const { supports: supportsOrdered, limits: limitsOrdered, corridorRelevant, nearestCorridor } = resolveOrderedReasons(input);

  const lines: string[] = [];
  if (supportsOrdered.length > 0) {
    lines.push(`Støtter: ${supportsOrdered.map((c) => c.text).join(" · ")}`);
  }
  if (limitsOrdered.length > 0) {
    lines.push(`Begrenser: ${limitsOrdered.map((c) => c.text).join(" · ")}`);
  }
  // Sikkerhetsfallback — dominantSignals skal aldri være tom når det faktisk
  // finnes bidragsytende observasjoner, selv i det usannsynlige tilfellet at
  // ingen av kandidatene over trigget (f.eks. én observasjon, ukjent retning,
  // ett enkelt kamera, ingen relevant korridor).
  if (lines.length === 0) {
    const oldest = Math.min(...contributingObservations.map((o) => o.timestamp));
    lines.push(`${contributingObservations.length} ${species.label.toLowerCase()}observasjoner ${formatSpan(nowMs - oldest)}`);
  }

  const explanation = corridorRelevant && nearestCorridor
    ? `Indikasjoner peker mot området ${vindRetningLabel(nearestCorridor.bearingDeg)} for siste registrering.`
    : predictionMode === "environment_plus_local" && ecology
      ? `Terreng og lokale observasjoner støtter vurderingen for ${species.label.toLowerCase()}.`
      : `Vurdert område med ${level.toLowerCase()} aktivitetsscore.`;

  return { explanation, dominantSignals: lines.slice(0, 4) };
}

// ===========================================================================
// V1.3 §N/§O — deterministisk, STRUKTURERT sone-anbefaling.
//
// "Ikke bruk en LLM til å dikte forklaringer... Motoren skal produsere
// strukturerte reason codes/data. UI kan gjøre dem menneskelesbare." Alt
// under er derfor bygget av de SAMME tallene/klassifiseringene som
// buildZoneExplanation over allerede regner ut (samme
// classifyLocalFactors/classifyEcologyFactors/pickBlended via
// resolveOrderedReasons, samme forklaringssetning via buildZoneExplanation
// selv) — kun i strukturert (ikke ferdig-sammenslått streng-) form, egnet
// for UI som vil vise egne bullet-lister i stedet for én forhåndsformatert
// "Støtter: ... · ..."-linje.
// ===========================================================================

/** Grenser brukt av `deriveDataFreshness` — se funksjonens dokumentasjon for begrunnelsen bak hver av dem. */
const FRESHNESS_GOD_MAX_AGE_MINUTES = 180; // 3 timer
const FRESHNESS_LAV_MAX_AGE_MINUTES = 24 * 60; // 24 timer
/** Minst så mange bidragsytende observasjoner kreves i tillegg til høy confidence for "god" — ett enkelt (om enn ferskt) funn er ikke nok til å kalles et GODT datagrunnlag alene. */
const FRESHNESS_GOD_MIN_OBSERVATIONS = 2;

/**
 * V1.3 (§R): "Datagrunnlag: Lavt/Middels/Godt" — utledet DETERMINISTISK fra
 * tall motoren allerede har regnet ut (confidence.ts sin confidenceLevel,
 * pluss alder/antall på de bidragsytende observasjonene), IKKE en ny,
 * parallell måling av "hvor bra" dataene er.
 *
 * Terskler (bevisst konservative — heller undervurdere enn overvurdere):
 * - "lav": ingen bidragsytende observasjoner i det hele tatt, ELLER
 *   confidence-nivået i seg selv er lavt, ELLER nyeste observasjon er over
 *   `FRESHNESS_LAV_MAX_AGE_MINUTES` (24t) gammel — for tynt/utdatert til å
 *   stole på, uansett hva et enkelt confidence-tall skulle antyde.
 * - "god": confidence-nivået er høyt OG nyeste observasjon er ferdig
 *   (<= `FRESHNESS_GOD_MAX_AGE_MINUTES`, 3t) OG minst
 *   `FRESHNESS_GOD_MIN_OBSERVATIONS` (2) observasjoner bidrar — ett enkelt
 *   ferskt funn er fortsatt et tynt (om enn lovende) grunnlag alene.
 * - "middels": alt annet — noe reelt grunnlag, men ikke nok til "god".
 */
export function deriveDataFreshness(
  confidenceLevel: ConfidenceLevel,
  newestObservationAgeMinutes: number,
  observationCount: number
): "lav" | "middels" | "god" {
  if (observationCount === 0) return "lav";
  if (confidenceLevel === "lav") return "lav";
  if (newestObservationAgeMinutes > FRESHNESS_LAV_MAX_AGE_MINUTES) return "lav";
  if (
    confidenceLevel === "høy" &&
    newestObservationAgeMinutes <= FRESHNESS_GOD_MAX_AGE_MINUTES &&
    observationCount >= FRESHNESS_GOD_MIN_OBSERVATIONS
  ) {
    return "god";
  }
  return "middels";
}

/**
 * V1.3 (§N/§O): bygger en `ZoneRecommendation` for ÉN sone — den strukturerte
 * søsteren til `buildZoneExplanation`. Tar samme `ZoneExplanationInput` som
 * `buildZoneExplanation` (den TRENGER nøyaktig de samme tallene) pluss den
 * allerede ferdigbygde `PredictionZone` selve motoren produserte, for å
 * unngå å regne ut score/confidence/rank/nivå én gang til her.
 *
 * `zoneId`/`species`/`rank`/`score`/`confidence`/`probabilityLabel` leses
 * DIREKTE av `zone` — ingen ny beregning. `summary` gjenbruker
 * `buildZoneExplanation(input).explanation` ORDRETT (§O: "samme setning",
 * ikke en parallell tekstberegning). `positiveReasons`/`negativeReasons` er
 * de SAMME Støtter/Begrenser-kandidatene `buildZoneExplanation` bruker (via
 * `resolveOrderedReasons`), bare som rene tekstlister i stedet for én
 * ferdig-sammenslått "Støtter: ... · ..."-streng.
 *
 * §P: `probabilityLabel` er ALDRI en prosent — samme `ActivityLevel`-etikett
 * som resten av motoren. §34: reason-tekstene bruker ALDRI "samme individ"-
 * språk, kun "uavhengige/overlappende signaler" (se evidenceFusion.ts).
 */
export function buildZoneRecommendation(input: ZoneExplanationInput, zone: PredictionZone): ZoneRecommendation {
  const { explanation } = buildZoneExplanation(input);
  const { supports, limits } = resolveOrderedReasons(input);

  return {
    zoneId: zone.id,
    species: zone.species,
    rank: zone.rank ?? 1,
    score: zone.score,
    confidence: zone.confidence,
    probabilityLabel: zone.level,
    positiveReasons: supports.map((c) => c.text),
    negativeReasons: limits.map((c) => c.text),
    summary: explanation,
    dataFreshness: deriveDataFreshness(zone.confidenceLevel, zone.newestObservationAgeMinutes, input.contributingObservations.length),
    evidenceCount: input.contributingObservations.length,
    recommendedTimeWindows: input.ecology?.crepuscularActivity
      ? computeRecommendedTimeWindow(input.ecology.sunriseMs ?? null, input.ecology.sunsetMs ?? null, input.ecology.crepuscularActivity)
      : [],
  };
}

// ===========================================================================
// V1.3 — "Beste tidspunkt": et EKTE, per-sone anbefalt klokkeslett-vindu.
//
// Forbudt (§ oppdraget): oppdiktet/hardkodet "beste tid". Denne funksjonen
// utleder derfor vinduet fra de SAMME to ingrediensene motoren allerede har:
// REELLE sunrise/sunsetMs (environment/dynamic.ts, Open-Meteo) og artens
// EGEN, forskningsbaserte `crepuscularActivity.strength` (ecology/profiles.ts)
// — ALDRI en ny, parallell astronomi- eller atferdsberegning. Den GJENBRUKER
// `computeCrepuscularActivityMultiplier` (ecology/suitability.ts) direkte, ved
// faktisk å KALLE den gjentatte ganger rundt hver soloppgang/solnedgang og se
// hvor lenge multiplikatoren forblir "meningsfullt" forhøyet — i stedet for å
// derivere en lukket løsning fra dens interne konstanter (som ville vært en
// skjult kopi av implementasjonsdetaljer som kunne gå ut av sync om formelen
// noensinne endres der).
// ===========================================================================

/** Prøveoppløsning (ms) når vinduets grense søkes utover fra selve soloppgangen/solnedgangen — fint nok for et HH:MM-visningsvindu. */
const TIME_WINDOW_SEARCH_STEP_MS = 5 * 60000;
/** computeCrepuscularActivityMultiplier er per konstruksjon nøytral (1.0) mer enn 1t unna — søk aldri lenger enn dette (med litt margin), uavhengig av at vi bevisst ikke antar den eksakte grensen. */
const TIME_WINDOW_SEARCH_MAX_RADIUS_MS = 90 * 60000;
/**
 * Hvor mye multiplikatoren minst må være forhøyet for at vinduet skal regnes
 * som "meningsfullt" nok til å vise brukeren — samme størrelsesorden (~5 %)
 * som `MIN_SIGNAL_CONTRIBUTION` over bruker til å avgjøre om et signal i det
 * hele tatt er verdt å nevne. Ved arters faktiske crepuscularActivity-styrke
 * (0.35–0.4 for hjort/rådyr/elg, maks-multiplikator ~1.105–1.12, se
 * quantification.test.ts) krysses denne terskelen komfortabelt nær selve
 * soloppgangen/solnedgangen; en art med for svak/fraværende styrke (f.eks.
 * "annet", strength=0) krysser den ALDRI — se `computeRecommendedTimeWindow`.
 */
const MEANINGFUL_MULTIPLIER_THRESHOLD = 1.05;

/**
 * Finner (om det finnes) det sammenhengende klokkeslett-vinduet rundt ETT
 * astronomisk hendelsestidspunkt (soloppgang ELLER solnedgang) der
 * `computeCrepuscularActivityMultiplier` er >= MEANINGFUL_MULTIPLIER_THRESHOLD.
 * Returnerer `null` når selve toppunktet (hendelsestidspunktet, der
 * multiplikatoren ALLTID er høyest) ikke engang når terskelen — dvs. arten er
 * for svakt/ikke crepuscularActivity-fundert (§Y: aldri fabrikkere et vindu
 * for en flat-aktivitets-art).
 */
function findMeaningfulWindowAround(
  eventMs: number,
  dynamic: DynamicEnvironmentalFeatures,
  crepuscularActivity: WeightedFactor
): { startMs: number; endMs: number } | null {
  const peakMultiplier = computeCrepuscularActivityMultiplier(eventMs, dynamic, crepuscularActivity);
  if (peakMultiplier < MEANINGFUL_MULTIPLIER_THRESHOLD) return null;

  let startMs = eventMs;
  let endMs = eventMs;
  for (let offset = TIME_WINDOW_SEARCH_STEP_MS; offset <= TIME_WINDOW_SEARCH_MAX_RADIUS_MS; offset += TIME_WINDOW_SEARCH_STEP_MS) {
    const before = eventMs - offset;
    const after = eventMs + offset;
    if (computeCrepuscularActivityMultiplier(before, dynamic, crepuscularActivity) >= MEANINGFUL_MULTIPLIER_THRESHOLD) {
      startMs = before;
    }
    if (computeCrepuscularActivityMultiplier(after, dynamic, crepuscularActivity) >= MEANINGFUL_MULTIPLIER_THRESHOLD) {
      endMs = after;
    }
  }
  return { startMs, endMs };
}

/**
 * V1.3: bygger opptil to `RecommendedTimeWindow` (dawn/dusk) for ÉN
 * sone/art, fra REELLE sunrise/sunsetMs + artens EGEN crepuscularActivity —
 * se filkommentaren over. Ren, deterministisk, testbar uten UI/locale (§27
 * — selve klokkeslett-FORMATERINGEN til "05:20" er bevisst UI-ets jobb, se
 * EngineStatusPanel.tsx, ikke denne funksjonens).
 *
 * Returnerer et TOMT array (aldri et oppdiktet vindu) når:
 * - arten ikke har noen dokumentert skumrings-/demringseffekt
 *   (`crepuscularActivity.strength <= 0`, f.eks. "annet"/Rev), ELLER
 * - motoren kjørte uten værdata (sunriseMs/sunsetMs begge `null`), ELLER
 * - selv toppunktet ikke når MEANINGFUL_MULTIPLIER_THRESHOLD (svært lav styrke).
 */
export function computeRecommendedTimeWindow(
  sunriseMs: number | null,
  sunsetMs: number | null,
  crepuscularActivity: WeightedFactor
): RecommendedTimeWindow[] {
  if (crepuscularActivity.strength <= 0) return [];
  const dynamic: DynamicEnvironmentalFeatures = { ...UKJENT_DYNAMIC_FEATURES, sunriseMs, sunsetMs };
  const windows: RecommendedTimeWindow[] = [];

  if (sunriseMs != null) {
    const w = findMeaningfulWindowAround(sunriseMs, dynamic, crepuscularActivity);
    if (w) windows.push({ type: "dawn", startMs: w.startMs, endMs: w.endMs });
  }
  if (sunsetMs != null) {
    const w = findMeaningfulWindowAround(sunsetMs, dynamic, crepuscularActivity);
    if (w) windows.push({ type: "dusk", startMs: w.startMs, endMs: w.endMs });
  }
  return windows;
}
