// ViltIQ Engine v1 — orkestrering.
//
// Pipeline: normaliser → isoler art → generer grid → finn korridorer →
// score ruter → klynge til soner → kamera-diversitetsbonus → confidence →
// forklaring → sett sammen resultat. Ingen tilfeldighet, ingen eksternt
// kall, ingen AI — samme input gir alltid samme output (§27).

import { distanceMeters, isPointInPolygon } from "@/src/lib/geo";
import type { Observasjon } from "@/src/types/observation";
import { CONFIG_VERSION, DEFAULT_ENGINE_CONFIG, ENGINE_VERSION, type EngineConfig } from "./config";
import { computeFallbackConfidence, computeZoneConfidence, confidenceLevelFromScore } from "./confidence";
import { buildZoneExplanation, buildZoneRecommendation, type EcologyExplanationContext, type ZoneExplanationInput } from "./explain";
import {
  buildGridCells,
  extractZones,
  levelFromScore,
  saturateScore,
  scoreGrid,
  type AreaOfInterest,
  type ScoredCell,
} from "./grid";
import { normalizeObservations } from "./normalize";
import { computeEvidenceDensity } from "./evidenceFusion";
import { cameraDiversityBonus, computeMovementCorridors } from "./reinforcement";
import { effectiveRadiusMeters, distanceWeight } from "./signals";
import { getSpeciesProfile, type SpeciesProfile } from "./species/profiles";
import type { EngineDebugInfo, EngineDebugScoreStats, EngineObservation, EngineResult, EngineSignalBreakdown, HeatmapPoint, LatLng, PredictionMode, PredictionZone, Species } from "./types";
import type { EnvironmentResolver, SpatialValidity } from "./environment/types";
import { getEcologyProfile } from "./ecology/profiles";
import {
  computeCrepuscularActivityMultiplier,
  computeSpatialSuitability,
  determineSeason,
  isRutActive,
} from "./ecology/suitability";

export { ENGINE_VERSION, CONFIG_VERSION, DEFAULT_ENGINE_CONFIG };
export type { EngineConfig };
export type { AreaOfInterest } from "./grid";

export type RunEngineOptions = {
  /**
   * Epoketid (ms) motoren skal regne "nå"/target-tidspunktet fra. Defaulter
   * til Date.now(). Opprinnelig kun til testing, men fungerer allerede som
   * den fulle "targetDateTime"-inngangen (§3 i V1.3-motoroppdraget) for
   * fremtidig/tilbakedatert jaktplanlegging: ALLE tidsavhengige beregninger
   * nedover i pipelinen (sesong/brunst/skumring/dag-natt i
   * ecology/suitability.ts, tidsvekting i signals.ts, ferskhet i
   * confidence.ts) tar denne verdien eksplisitt som parameter — INGEN av dem
   * leser Date.now() internt. Unntaket er selve VÆRET (dynamic.ts sitt
   * Open-Meteo-kall via environment/resolve.ts): det henter alltid
   * NÅVÆRENDE forhold, siden en ekte værPROGNOSE for en fremtidig `now`
   * ville krevd en egen, større funksjon (forecast-endepunkt, ikke bare
   * denne parameteren) — utenfor rammen av denne rene tids-plumbingen.
   */
  now?: number;
  /** Inkluder EngineDebugInfo i resultatet (§23). */
  debug?: boolean;
  /** Delvis overstyring av DEFAULT_ENGINE_CONFIG. */
  config?: Partial<EngineConfig>;
  /**
   * Jaktområde (BUG 4, V1.5): et brukertegnet polygon som begrenser HVILKE
   * allerede scorede ruter som får bli til soner/heatmap-punkter — satt inn
   * mellom `scoreGrid()` og `extractZones()` i `runPipeline` under, ikke en
   * egen parallell motor. Scoring selv (scoreGrid) er UENDRET; kun hvilke
   * celler som når frem til klyngingen endres. Under 3 punkter tolkes som
   * "ikke satt" (identisk med å utelate feltet helt) — se runPipeline.
   */
  huntAreaPolygon?: readonly LatLng[];
};

function mergeConfig(overrides: Partial<EngineConfig> | undefined): EngineConfig {
  if (!overrides) return DEFAULT_ENGINE_CONFIG;
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...overrides,
    timeDecay: { ...DEFAULT_ENGINE_CONFIG.timeDecay, ...overrides.timeDecay },
    distance: { ...DEFAULT_ENGINE_CONFIG.distance, ...overrides.distance },
    direction: { ...DEFAULT_ENGINE_CONFIG.direction, ...overrides.direction },
    reinforcement: { ...DEFAULT_ENGINE_CONFIG.reinforcement, ...overrides.reinforcement },
    zones: { ...DEFAULT_ENGINE_CONFIG.zones, ...overrides.zones },
    levelThresholds: { ...DEFAULT_ENGINE_CONFIG.levelThresholds, ...overrides.levelThresholds },
    confidenceThresholds: { ...DEFAULT_ENGINE_CONFIG.confidenceThresholds, ...overrides.confidenceThresholds },
    confidence: {
      ...DEFAULT_ENGINE_CONFIG.confidence,
      ...overrides.confidence,
      weights: { ...DEFAULT_ENGINE_CONFIG.confidence.weights, ...overrides.confidence?.weights },
    },
    ecology: { ...DEFAULT_ENGINE_CONFIG.ecology, ...overrides.ecology },
  };
}

function findContributingObservations(
  center: LatLng,
  observations: readonly EngineObservation[],
  baseRadiusMeters: number,
  cfg: EngineConfig,
  nowMs: number
): EngineObservation[] {
  const CONTRIBUTION_THRESHOLD = 0.05;
  return observations.filter((o) => {
    const ageHours = (nowMs - o.timestamp) / 3600000;
    const radius = effectiveRadiusMeters(baseRadiusMeters, ageHours, cfg.distance);
    const dist = distanceMeters(center, o.position);
    return distanceWeight(dist, radius) >= CONTRIBUTION_THRESHOLD;
  });
}

/** Andel lokalt bidrag av rå-scoren over hvilken sonen regnes som lokalt dominert, ikke en balansert blanding (V1.1 §31). */
const LOCAL_DOMINANT_RATIO = 0.7;

/**
 * Utleder PredictionMode fra den allerede beregnede signalBreakdown-en — INGEN
 * ny scoring, kun en klassifisering av tall motoren allerede har regnet ut.
 * `repetition`/`cameraDirection`/`movementDirection`/`corridor`/`cameraDiversity`
 * er alle avledet fra lokale observasjoner, `ecology` fra miljøprioren alene.
 */
function derivePredictionMode(breakdown: EngineSignalBreakdown, contributingCount: number): PredictionMode {
  if (contributingCount === 0) return "environment_only";
  const localContribution =
    breakdown.repetition + breakdown.cameraDirection + breakdown.movementDirection + breakdown.corridor + breakdown.cameraDiversity;
  const ecologyContribution = Math.max(0, breakdown.ecology);
  if (ecologyContribution <= 0) return "local_dominant";
  const total = localContribution + ecologyContribution;
  if (total <= 0) return "local_dominant";
  const localRatio = localContribution / total;
  return localRatio >= LOCAL_DOMINANT_RATIO ? "local_dominant" : "environment_plus_local";
}

/** Øvre grense på antall punkter sendt til et heatmap-lag — beskytter rendering-ytelsen (§22) uavhengig av grid-oppløsning. */
const MAX_HEATMAP_POINTS = 600;
/** Under denne vekten bidrar punktet ikke synlig til et heatmap uansett — ikke verdt å sende det. */
const MIN_HEATMAP_WEIGHT = 0.03;

export type HeatmapCandidate = HeatmapPoint & { originalIndex: number };

/**
 * KRITISK KORRIGERING (V1.2 §6): `[...].sort(byWeight).slice(0, MAX)` brukte
 * JavaScripts STABILE sortering — når store deler av gridet deler nøyaktig
 * samme vekt (svært vanlig ved miljø-platåer, se resolve.ts sin filkommentar),
 * beholdt stabil sortering ganske enkelt de FØRSTE cellene i opprinnelig
 * rad-major gridrekkefølge. Empirisk bekreftet: dette kuttet bort HELE den
 * nordlige halvdelen av analyseområdet — ikke fordi den var mindre relevant,
 * men fordi array-rekkefølgen tilfeldigvis favoriserte sørlige rader.
 *
 * Fikset her: ved en vekt-uavgjort gruppe som må kuttes for å holde seg
 * innenfor taket, velges et GEOGRAFISK JEVNT FORDELT utvalg fra gruppen
 * (basert på cellenes opprinnelige rad-major indeks — meningsfullt geografisk
 * siden buildGridCells bygger cellene rad for rad over hele analyseflaten),
 * i stedet for en vilkårlig prefiks. Celler med en STRENGT høyere vekt enn
 * andre beholdes alltid fullt ut uansett — dette endrer ALDRI hvilke celler
 * som prioriteres, kun HVILKE av flere likeverdige celler som må kuttes.
 */
export function selectHeatmapPoints(candidates: readonly HeatmapCandidate[], maxPoints: number): HeatmapPoint[] {
  const strip = (c: HeatmapCandidate): HeatmapPoint => ({ latitude: c.latitude, longitude: c.longitude, weight: c.weight });
  if (candidates.length <= maxPoints) {
    return [...candidates].sort((a, b) => b.weight - a.weight).map(strip);
  }

  const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
  const selected: HeatmapCandidate[] = [];
  let i = 0;
  while (i < sorted.length && selected.length < maxPoints) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].weight === sorted[i].weight) j++;
    const group = sorted.slice(i, j);
    const remainingBudget = maxPoints - selected.length;

    if (group.length <= remainingBudget) {
      selected.push(...group);
    } else {
      // Gruppen må kuttes — plukk et jevnt fordelt utvalg over rad-major
      // rekkefølgen (geografisk spennvidde) fremfor en sammenhengende blokk.
      const byIndex = [...group].sort((a, b) => a.originalIndex - b.originalIndex);
      const stride = byIndex.length / remainingBudget;
      for (let k = 0; k < remainingBudget; k++) {
        selected.push(byIndex[Math.floor(k * stride)]);
      }
    }
    i = j;
  }
  return selected.map(strip);
}

/**
 * Bygger vektede heatmap-punkter fra HELE det skårede gridet (ikke bare
 * klyngede soner) — samme rå score som zones bruker, kun uten terskel-/
 * klyngefiltreringen, slik at kartet kan tegne et faktisk gradient-landskap
 * i stedet for isolerte sirkler.
 */
function buildHeatmapPoints(scoredCells: readonly ScoredCell[], cfg: EngineConfig): HeatmapPoint[] {
  // originalIndex MÅ tildeles FØR vann-/vekt-filtrering — den reflekterer
  // cellens rad-major posisjon i det FULLE gridet (buildGridCells bygger rad
  // for rad), som selectHeatmapPoints() bruker til geografisk jevn utvalg
  // (V1.2 §6). Filtrerer man først og indekserer etterpå, mister indeksen
  // sin geografiske betydning.
  const candidates: HeatmapCandidate[] = scoredCells
    .map((cell, originalIndex): HeatmapCandidate => ({
      latitude: cell.center.latitude,
      longitude: cell.center.longitude,
      weight: saturateScore(cell.score, cfg.zones.scoreSaturation) / 100,
      originalIndex,
    }))
    .filter((p, i) => {
      const validity = scoredCells[i].validity;
      // V1.2.1 (spatial validity, §9-14): "water"/"invalid"-celler skal
      // ALDRI males som en attraktiv del av sannsynlighetsfeltet, uansett
      // hvilken rå score de måtte ha fått fra en observasjon nær bredden —
      // samme filter som extractZones() bruker, se grid.ts.
      return validity !== "water" && validity !== "invalid" && p.weight >= MIN_HEATMAP_WEIGHT;
    });
  return selectHeatmapPoints(candidates, MAX_HEATMAP_POINTS);
}

/** Persentiler over RÅ celle-score for hele gridet — V1.2.1 §21-instrumentering, kun til debug/utvikler-diagnostikk. */
function computeScoreStats(scoredCells: readonly ScoredCell[]): EngineDebugScoreStats | undefined {
  if (scoredCells.length === 0) return undefined;
  const sorted = scoredCells.map((c) => c.score).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
  return {
    min: sorted[0],
    p25: at(25),
    median: at(50),
    p75: at(75),
    p90: at(90),
    max: sorted[sorted.length - 1],
  };
}

function emptyResult(species: Species, nowMs: number, cfg: EngineConfig, inputCount: number, debug: boolean): EngineResult {
  const profile = getSpeciesProfile(species);
  return {
    engineVersion: ENGINE_VERSION,
    configVersion: CONFIG_VERSION,
    species,
    generatedAt: nowMs,
    zones: [],
    confidence: 0,
    confidenceLevel: "lav",
    summary: `Ingen observasjoner av ${profile.label.toLowerCase()} funnet i dette området med dagens data.`,
    signals: [],
    observationsConsidered: 0,
    heatmapPoints: [],
    debug: debug
      ? {
          totalObservationsInput: inputCount,
          totalObservationsAfterNormalize: 0,
          gridCellCount: 0,
          cellSizeMeters: cfg.cellSizeMeters,
          validLandCells: 0,
          waterCells: 0,
          unknownValidityCells: 0,
          scoreStats: undefined,
          topCells: [],
          corridors: [],
        }
      : undefined,
  };
}

/**
 * V1.4 ("Unngå at 67.8 og 67.7 hopper frem og tilbake mellom #1/#2 uten
 * relevant inputendring... Samme input skal alltid produsere samme
 * resultat"): eksplisitt, FLERTRINNS deterministisk sammenligningsfunksjon
 * brukt til å sortere `zones` FØR `zone.rank` settes — IKKE bare
 * `b.score - a.score` overlatt til at Array.prototype.sort() sin stabilitet
 * (garantert i moderne V8/Hermes, men ikke noe denne koden selv skal måtte
 * stole på) bevarer riktig sekundær rekkefølge. `score` er allerede avrundet
 * til 1 desimal (se displayScore-utregningen over), så to soner KAN lande på
 * nøyaktig samme tall uten å ha vært identiske underveis; uten en eksplisitt
 * sekundærnøkkel ville rekkefølgen mellom dem avhengt av sorteringsmotorens
 * interne implementasjon i stedet for av tallene selv.
 *
 * Eksportert (i stedet for holdt lokal inne i runPipeline) nettopp for å
 * kunne enhetstestes direkte med konstruerte tie-scenarioer — se
 * rankDeterminism.test.ts — uten å måtte fabrikkere en ekte flertrinns
 * observasjonsscene som tilfeldigvis treffer en eksakt score-tie.
 *
 * Prioritert rekkefølge:
 *   1) score (høyest vinner) — den faktiske rangeringen brukeren ser.
 *   2) sammenhengende fotavtrykk-størrelse (footprint.cells.length) —
 *      spesifikasjonens egen foreslåtte tie-breaker ("sammenhengende
 *      areal"): en sone bygget på et bredere, sammenhengende platå er en mer
 *      robust "vinner" ved eksakt lik score enn en smal enkelt-topp.
 *   3) confidence — spesifikasjonens andre foreslåtte tie-breaker ("lokal
 *      signalstyrke"): mer datagrunnlag bak samme score vinner.
 *   4) zone.id — rent, absolutt siste sikkerhetsnett (id er avledet av
 *      opprinnelig ekstraksjonsrekkefølge, se grid.ts) som GARANTERER en
 *      total orden uansett hvor usannsynlig en firedobbel tie er, slik at
 *      sorteringen ALDRI kan avhenge av sort()-implementasjonens egen
 *      stabilitet.
 *
 * Dette løser determinisme INNENFOR én beregning: samme input gir alltid
 * samme rekkefølge. Stabilitet PÅ TVERS AV separate beregninger (f.eks. en
 * marginal værendring et minutt senere som endrer rå score med en brøkdel)
 * er BEVISST IKKE forsøkt løst med en egen hysterese-mekanisme her — se
 * resultCache.ts sin dokumenterte grov-bucketing (vær ±2°C/±2m/s, tid 30
 * min, areal) for hvorfor en reell ny motorkjøring uansett sjelden skjer for
 * en inputendring SÅ liten at den ikke burde påvirke rangeringen; å i
 * tillegg bygge en parallell hysterese-mekanisme her, uten et konkret
 * observert problem i praksis, ville vært spekulativ kompleksitet.
 */
export function compareZonesForRank(a: PredictionZone, b: PredictionZone): number {
  if (b.score !== a.score) return b.score - a.score;
  const footprintDelta = (b.footprint?.cells.length ?? 0) - (a.footprint?.cells.length ?? 0);
  if (footprintDelta !== 0) return footprintDelta;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Delt pipeline for `runEngine` (kun observasjoner) og `runEcologicalEngine`
 * (observasjoner + økologisk prior). Selve scoringen er identisk uansett —
 * forskjellen er kun OM et areaOfInterest/ecologyScoreAt sendes inn.
 */
function runPipeline(
  rawObservations: readonly Observasjon[],
  species: Species,
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  debug: boolean,
  areaOfInterest?: AreaOfInterest,
  ecologyScoreAt?: (point: LatLng) => number,
  ecologyExplanationAt?: (point: LatLng) => EcologyExplanationContext,
  ecologyValidityAt?: (point: LatLng) => SpatialValidity,
  huntAreaPolygon?: readonly LatLng[]
): EngineResult {
  const normalizedAll = normalizeObservations(rawObservations);
  const observations = normalizedAll.filter((o) => o.species === species);

  if (observations.length === 0 && !areaOfInterest) {
    return emptyResult(species, nowMs, cfg, rawObservations.length, debug);
  }

  const { cells, cellSizeMeters } = buildGridCells(observations, profile, cfg, areaOfInterest);
  const corridors = computeMovementCorridors(observations, cfg.reinforcement);
  const scoredCells = scoreGrid(cells, observations, profile, cfg, nowMs, corridors, ecologyScoreAt, ecologyValidityAt);

  // BUG 4 (V1.5): et gyldig jaktområde-polygon filtrerer HER — ETTER scoring,
  // FØR klynging — ikke etter at extractZones() allerede har tegnet
  // sone-hull basert på et annet (ufiltrert) kandidatsett. Se grid.ts sin
  // gridBoundaryPolygon()-dokumentasjon for hvorfor å klippe celler EFTER at
  // et hull allerede er sporet gir feilaktige "avbitte" soner — riktig sted
  // å klippe er FØR extractZones() i det hele tatt ser kandidatsettet, slik
  // at klyngingen/hull-sporingen (helt uendret) selv jobber med et sett som
  // allerede bare består av polygon-interne celler. Under 3 punkter er intet
  // meningsfullt polygon (se isPointInPolygon) og behandles identisk med at
  // feltet ikke var satt i det hele tatt — INGEN filtrering, byte-identisk
  // med funksjonens oppførsel før denne featuren fantes.
  const validHuntAreaPolygon = huntAreaPolygon && huntAreaPolygon.length >= 3 ? huntAreaPolygon : undefined;
  const cellsForZones = validHuntAreaPolygon
    ? scoredCells.filter((c) => isPointInPolygon(c.center, validHuntAreaPolygon))
    : scoredCells;

  // Merge-radius skalert med artens egen baseRadius — se extractZones' dokumentasjon
  // for hvorfor en fast global verdi kan fragmentere én observasjon til flere soner.
  const mergeRadiusMeters = Math.max(cfg.zones.mergeRadiusMeters, profile.baseRadiusMeters * 1.5);
  const rawZones = extractZones(cellsForZones, cellSizeMeters, mergeRadiusMeters, cfg);

  // V1.3 §N/§O: hver sone sin buildZoneRecommendation() trenger den SAMME
  // ZoneExplanationInput som buildZoneExplanation() allerede bygger — lagres
  // her, nøklet på selve sone-OBJEKTET (overlever zones.sort() under, i
  // motsetning til en indeks-basert liste), slik at den kan gjenbrukes i en
  // EGEN etter-passering. recommendation.rank krever zone.rank, som først
  // finnes ETTER zones.sort()+forEach under — kan ikke regnes ut i SAMME
  // passering som selve sone-konstruksjonen.
  const explanationInputByZone = new Map<PredictionZone, ZoneExplanationInput>();

  const zones: PredictionZone[] = rawZones.map((raw, index) => {
    const contributing = findContributingObservations(raw.center, observations, profile.baseRadiusMeters, cfg, nowMs);
    const distinctCameraIds = new Set(
      contributing.filter((o) => o.source === "camera" && o.cameraId != null).map((o) => o.cameraId as string)
    );
    const camBonus = cameraDiversityBonus(contributing, cfg.reinforcement);
    const breakdown = { ...raw.breakdown, cameraDiversity: camBonus };
    // V1.3 (§J): eksplisitt, navngitt "lokal evidens-tetthet" — rent
    // forklarings-/breakdown-formål (se evidenceFusion.ts sin filkommentar),
    // IKKE lagt til finalRawScore under: de underliggende bidragene
    // (repetition/cameraDiversity/corridor) er allerede talt med i raw.rawScore.
    breakdown.evidenceDensity = computeEvidenceDensity(contributing, raw.center, corridors);
    const finalRawScore = raw.rawScore + camBonus;

    const displayScore = saturateScore(finalRawScore, cfg.zones.scoreSaturation);
    const level = levelFromScore(displayScore, cfg.levelThresholds);
    const confidence = computeZoneConfidence(contributing, cfg, nowMs);
    const confidenceLevel = confidenceLevelFromScore(confidence, cfg.confidenceThresholds);
    const newestAgeMinutes = contributing.length
      ? Math.round((nowMs - Math.max(...contributing.map((o) => o.timestamp))) / 60000)
      : 0;
    const predictionMode = derivePredictionMode(breakdown, contributing.length);
    // Beregnet ÉN gang og gjenbrukt til både forklaringen OG
    // zone.environmentBreakdown (§25) — samme tall, ikke to parallelle
    // uttrekk av samme underliggende computeSpatialSuitability-kall.
    const ecologyContext = ecologyExplanationAt ? ecologyExplanationAt(raw.center) : undefined;

    const explanationInput: ZoneExplanationInput = {
      species: profile,
      level,
      center: raw.center,
      contributingObservations: contributing,
      breakdown,
      distinctCameraCount: distinctCameraIds.size,
      corridors,
      nowMs,
      ecology: ecologyContext,
      predictionMode,
    };
    const { explanation, dominantSignals } = buildZoneExplanation(explanationInput);

    const zone: PredictionZone = {
      id: `${species}-zone-${index + 1}`,
      species,
      center: raw.center,
      radiusMeters: raw.radiusMeters,
      score: Math.round(displayScore * 10) / 10,
      level,
      confidence: Math.round(confidence * 100) / 100,
      confidenceLevel,
      observationCount: contributing.length,
      distinctCameraCount: distinctCameraIds.size,
      newestObservationAgeMinutes: Math.max(0, newestAgeMinutes),
      dominantSignals,
      explanation,
      signalBreakdown: breakdown,
      predictionMode,
      environmentBreakdown: ecologyContext?.breakdown,
      // V1.3 §K/§L — grid.ts sin extractZones() har allerede regnet ut den
      // FAKTISKE sammenhengende utstrekningen (footprintCells/footprintHull,
      // se claimedZoneIndex-sporingen der); vi gjenbruker den direkte, ingen
      // ny presentasjons-side-utregning.
      footprint: { cells: raw.footprintCells, hull: raw.footprintHull },
    };
    explanationInputByZone.set(zone, explanationInput);
    return zone;
  });

  // V1.4 ("Unngå at 67.8 og 67.7 hopper frem og tilbake mellom #1/#2"):
  // se compareZonesForRank() sin filkommentar under for hele begrunnelsen —
  // en eksplisitt, testbar, flertrinns sorteringsnøkkel i stedet for å
  // stole på at Array.prototype.sort() sin stabilitet alene gjør rangeringen
  // deterministisk ved eksakt like scorer.
  zones.sort(compareZonesForRank);
  // V1.3 §M/§N: 1-basert rangering blant sonene i DETTE resultatet, satt
  // ETTER sortering — samme rekkefølge som zones[] allerede har.
  zones.forEach((zone, i) => {
    zone.rank = i + 1;
  });
  // V1.3 §N/§O: nå som zone.rank er satt, kan den strukturerte anbefalingen
  // (samme Støtter/Begrenser-grunner som explanation/dominantSignals over,
  // se explain.ts sin buildZoneRecommendation) knyttes til hver sone — for
  // UI-et (EngineStatusPanel), IKKE en ny parallell beregning.
  zones.forEach((zone) => {
    const explanationInput = explanationInputByZone.get(zone);
    if (explanationInput) zone.recommendation = buildZoneRecommendation(explanationInput, zone);
  });

  const overallConfidence = zones.length > 0 ? zones[0].confidence : computeFallbackConfidence(observations, cfg, nowMs);
  const overallConfidenceLevel = confidenceLevelFromScore(overallConfidence, cfg.confidenceThresholds);
  const summary =
    zones.length > 0
      ? `${zones[0].level} aktivitet. ${zones[0].explanation}`
      : `Ingen område når terskelen for en tydelig sone for ${profile.label.toLowerCase()} akkurat nå.`;

  const debugInfo: EngineDebugInfo | undefined = debug
    ? {
        totalObservationsInput: rawObservations.length,
        totalObservationsAfterNormalize: observations.length,
        gridCellCount: cells.length,
        cellSizeMeters,
        validLandCells: scoredCells.filter((c) => c.validity === "valid_land").length,
        waterCells: scoredCells.filter((c) => c.validity === "water" || c.validity === "invalid").length,
        unknownValidityCells: scoredCells.filter((c) => c.validity === "unknown").length,
        scoreStats: computeScoreStats(scoredCells),
        topCells: [...scoredCells]
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map((c) => ({ center: c.center, score: Math.round(c.score * 1000) / 1000, breakdown: c.breakdown, validity: c.validity })),
        corridors,
      }
    : undefined;

  return {
    engineVersion: ENGINE_VERSION,
    configVersion: CONFIG_VERSION,
    species,
    generatedAt: nowMs,
    zones,
    confidence: overallConfidence,
    confidenceLevel: overallConfidenceLevel,
    summary,
    signals: zones.length > 0 ? zones[0].dominantSignals : [],
    observationsConsidered: observations.length,
    // Samme filtrerte sett som extractZones() over — heatmap-gradienten skal
    // ALDRI synlig blø utenfor et satt jaktområde mens sonene selv holder
    // seg innenfor, se huntArea-feltets dokumentasjon i types.ts.
    heatmapPoints: buildHeatmapPoints(cellsForZones, cfg),
    debug: debugInfo,
    huntArea: validHuntAreaPolygon ? { matchedCellCount: cellsForZones.length, cellSizeMeters } : undefined,
  };
}

/**
 * Kjør ViltIQ Engine v1 for én art, KUN basert på observasjoner (ingen
 * miljø-/økologidata). `rawObservations` kan være hele det synlige
 * datasettet (flere arter) — motoren isolerer selv arten den skal vurdere
 * (§14), så en hjorteobservasjon kan aldri påvirke rådyr- eller
 * elg-resultatet. Ren, synkron, deterministisk — ingen nettverkskall (§27).
 */
export function runEngine(
  rawObservations: readonly Observasjon[],
  species: Species,
  options: RunEngineOptions = {}
): EngineResult {
  const cfg = mergeConfig(options.config);
  const nowMs = options.now ?? Date.now();
  const debug = options.debug ?? false;
  const profile = getSpeciesProfile(species);
  return runPipeline(rawObservations, species, profile, cfg, nowMs, debug, undefined, undefined, undefined, undefined, options.huntAreaPolygon);
}

export type RunEcologicalEngineOptions = RunEngineOptions & {
  /** Analyseområdets senter og radius — sikrer at motoren kan score et område ut fra miljø/økologi alene, selv uten observasjoner (§T). */
  areaCenter: LatLng;
  areaRadiusMeters: number;
  /**
   * Ferdig utfylt, SYNKRON miljøoppslag — bygg denne med
   * environment/resolve.ts sin `resolveEnvironmentContext()` (async, gjør de
   * faktiske nettverkskallene) FØR du kaller denne funksjonen. Selve
   * scoringen forblir synkron/deterministisk/testbar (§27) uansett hvor
   * miljødataene kom fra.
   */
  environment: EnvironmentResolver;
};

/**
 * ViltIQ Engine v1 med økologisk prior (§S: "Research prior + current
 * environmental suitability + recent observations = posterior prediction").
 * Kombinerer artens forskningsbaserte habitat-/sesong-/høyde-/vei-/vind-
 * suitability (src/engine/ecology) med de samme observasjonssignalene som
 * `runEngine` — ferske, lokale observasjoner kan alltid overstyre en generell
 * prior, siden begge bidrar til samme rå celle-score (se config.ts sin
 * `ecology.weight`-dokumentasjon for hvorfor balansen er satt som den er).
 */
export function runEcologicalEngine(
  rawObservations: readonly Observasjon[],
  species: Species,
  options: RunEcologicalEngineOptions
): EngineResult {
  const cfg = mergeConfig(options.config);
  const nowMs = options.now ?? Date.now();
  const debug = options.debug ?? false;
  const baseProfile = getSpeciesProfile(species);
  const ecologyProfile = getEcologyProfile(species);
  const season = determineSeason(nowMs);

  const rutActive = isRutActive(nowMs, ecologyProfile);
  const profile: SpeciesProfile = rutActive
    ? {
        ...baseProfile,
        movementDirectionWeight: Math.min(1, baseProfile.movementDirectionWeight * (1 + ecologyProfile.rutBehavior.movementBoost)),
        corridorWeight: Math.min(1, baseProfile.corridorWeight * (1 + ecologyProfile.rutBehavior.movementBoost)),
      }
    : baseProfile;

  const crepuscularMultiplier = computeCrepuscularActivityMultiplier(
    nowMs,
    options.environment(options.areaCenter).dynamic,
    ecologyProfile.crepuscularActivity
  );

  const ecologyScoreAt = (point: LatLng): number => {
    const context = options.environment(point);
    const { suitability } = computeSpatialSuitability(ecologyProfile, season, nowMs, context.static, context.dynamic);
    return suitability * cfg.ecology.weight * crepuscularMultiplier;
  };

  // V1.2.1 (spatial validity): leser direkte fra samme miljøoppslag som
  // ecologyScoreAt/ecologyExplanationAt gjør — resolve.ts sin
  // resolveSpatialValidity() har allerede regnet ut dette PER PUNKT (ikke
  // en ny beregning her), se environment/resolve.ts.
  const ecologyValidityAt = (point: LatLng): SpatialValidity => options.environment(point).static.spatialValidity;

  // Kun til FORKLARING (§28), ikke scoring — samme rene beregning som
  // ecologyScoreAt over, kalt igjen for sonens senter for å hente ut
  // per-faktor-nedbrytningen som scoringen ellers ville kastet bort.
  const ecologyExplanationAt = (point: LatLng): EcologyExplanationContext => {
    const context = options.environment(point);
    const { breakdown } = computeSpatialSuitability(ecologyProfile, season, nowMs, context.static, context.dynamic);
    return {
      breakdown,
      habitat: context.static.habitat,
      season,
      crepuscularMultiplier,
      rutActive,
      // V1.3: rå sunrise/sunsetMs + artens egen crepuscularActivity-faktor,
      // slik at buildZoneRecommendation() (explain.ts) kan utlede et EKTE
      // "beste tidspunkt"-klokkeslettvindu — se computeRecommendedTimeWindow().
      sunriseMs: context.dynamic.sunriseMs,
      sunsetMs: context.dynamic.sunsetMs,
      crepuscularActivity: ecologyProfile.crepuscularActivity,
    };
  };

  const areaOfInterest: AreaOfInterest = { center: options.areaCenter, radiusMeters: options.areaRadiusMeters };
  const result = runPipeline(
    rawObservations,
    species,
    profile,
    cfg,
    nowMs,
    debug,
    areaOfInterest,
    ecologyScoreAt,
    ecologyExplanationAt,
    ecologyValidityAt,
    options.huntAreaPolygon
  );

  // V1.3 (§Q): resolveEnvironmentContext() (environment/resolve.ts) satte
  // denne som en EKSTRA egenskap på selve resolver-funksjonen (se
  // EnvironmentResolver i environment/types.ts) — leses her og festes til
  // resultatet uendret. `undefined` for enhver håndbygd test-resolver som
  // ikke bryr seg om datakvalitet, IKKE tolket som "fallback" (det er
  // reservert for `runEngine()`, som ikke har noen resolver i det hele tatt).
  if (options.environment.dataQuality) {
    result.dataQuality = options.environment.dataQuality;
  }
  return result;
}
