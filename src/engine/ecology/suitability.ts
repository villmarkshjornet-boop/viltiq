// ViltIQ Engine — økologisk suitability-scoring. Kombinerer habitat, vinter/
// snø/høyde, vårtrekk/høyde, vei-gradient, kantsone og vindeksponering til én
// 0–1 suitability per punkt. Interaksjoner (§D/§V) er eksplisitte if/else på
// sesong, ikke en generisk multi-faktor-formel — sporbart og forklarbart per
// §21, i stedet for en uigjennomsiktig vektsum.
//
// VIKTIG prinsipp (§S/§Y): dette er en PRIOR, ikke en påstand. Alle faktorer
// er derfor tak-begrenset (floor på hvor mye de kan straffe/premiere) — ingen
// enkelt miljøfaktor kan alene sende suitability til 0 eller påstå sikkerhet.

import { directionalAlignment } from "../signals";
import type { DynamicEnvironmentalFeatures, StaticEnvironmentalFeatures } from "../environment/types";
import type { Season, SpeciesEcologyProfile } from "./types";

export function determineSeason(whenMs: number): Season {
  const m = new Date(whenMs).getUTCMonth(); // 0=jan..11=des
  if (m === 11 || m <= 2) return "vinter"; // des–mar
  if (m === 3 || m === 4) return "vårtrekk"; // apr–mai
  if (m >= 5 && m <= 7) return "sommer"; // jun–aug
  if (m === 8 || m === 9) return "brunst"; // sep–okt
  return "senhøst"; // nov
}

/** 0 (starten av apr) → 1 (slutten av mai) — hvor langt inn i vårtrekk-vinduet "nå" er. */
function springProgress(whenMs: number): number {
  const d = new Date(whenMs);
  const start = Date.UTC(d.getUTCFullYear(), 3, 1);
  const end = Date.UTC(d.getUTCFullYear(), 4, 31);
  return Math.max(0, Math.min(1, (whenMs - start) / (end - start)));
}

function habitatFactor(profile: SpeciesEcologyProfile, season: Season, habitat: StaticEnvironmentalFeatures["habitat"]): number {
  const override = profile.habitatSuitability.bySeason?.[season]?.[habitat];
  const value = override ?? profile.habitatSuitability.default[habitat];
  return value ?? 0.5; // ukjent/uspesifisert habitat: nøytral, ikke straffet
}

/**
 * Vinter × snø/temperatur × relativ høyde. Lavere relativ høyde, mindre snø
 * OG mildere temperatur er gunstigere — docs/ENGINE_RESEARCH.md punkt 1
 * nevner EKSPLISITT at hjort bruker mindre hjemmeområder "når snøen er dyp
 * ELLER TEMPERATUREN ER LAVERE ENN NORMALT". Temperatur er derfor bevisst
 * IKKE en egen isolert kurve (docs punkt 9 sin dokumenterte begrensning),
 * men en del av SAMME, kildebelagte vinterinteraksjon.
 */
function winterSnowElevationFactor(
  relativeElevM: number | null,
  snowDepthM: number | null,
  temperatureC: number | null,
  factor: SpeciesEcologyProfile["winterSnowElevation"]
): number {
  if (factor.strength <= 0) return 1;
  if (relativeElevM == null && snowDepthM == null && temperatureC == null) return 1;
  const elevPenalty = relativeElevM != null ? Math.max(0, Math.min(1, relativeElevM / 300)) : 0;
  const snowPenalty = snowDepthM != null ? Math.max(0, Math.min(1, snowDepthM / 0.6)) : 0;
  const tempPenalty = temperatureC != null ? Math.max(0, Math.min(1, -temperatureC / 10)) : 0; // 0°C=ingen straff, -10°C=maks
  const penalty = Math.max(elevPenalty, snowPenalty, tempPenalty);
  return 1 - factor.strength * penalty * 0.7; // aldri under 30 % av opprinnelig suitability
}

/** Vårtrekk × høyde: preferansen forskyves gradvis oppover ETTER HVERT SOM sesongen skrider frem, ikke momentant. */
function springGreenupFactor(
  relativeElevM: number | null,
  whenMs: number,
  factor: SpeciesEcologyProfile["springGreenupElevation"]
): number {
  if (factor.strength <= 0 || relativeElevM == null) return 1;
  const progress = springProgress(whenMs);
  const preference = (progress - 0.5) * 2; // -1 (foretrekk lavt) .. 1 (foretrekk høyt)
  const elevNorm = Math.max(-1, Math.min(1, relativeElevM / 300));
  const alignment = (preference * elevNorm + 1) / 2; // 0..1
  return 1 - factor.strength * (1 - alignment) * 0.5; // aldri under 50 %
}

function roadDistanceFactor(roadDistanceM: number | null, factor: SpeciesEcologyProfile["roadSensitivity"]): number {
  if (factor.strength <= 0 || roadDistanceM == null) return 1;
  const norm = Math.max(0, Math.min(1, roadDistanceM / 1000));
  return 1 - factor.strength * (1 - norm) * 0.4; // aldri under 60 %
}

function edgeAffinityFactor(nearEdge: boolean, factor: SpeciesEcologyProfile["edgeAffinity"]): number {
  if (factor.strength <= 0 || !nearEdge) return 1;
  return 1 + factor.strength * 0.15; // svak bonus, jf. LOW evidens i docs
}

/** Ren fysisk le/vindeksponert-effekt — INGEN påstand om at dyret aktivt oppsøker le (docs punkt 7). */
function windExposureFactor(
  aspectDeg: number | null,
  dynamic: DynamicEnvironmentalFeatures,
  factor: SpeciesEcologyProfile["windExposureSensitivity"]
): number {
  if (factor.strength <= 0 || aspectDeg == null || dynamic.windDirectionDeg == null || dynamic.windSpeedMs == null) {
    return 1;
  }
  if (dynamic.windSpeedMs < 2) return 1; // svak vind: neglisjerbar praktisk effekt
  const exposureAlignment = directionalAlignment(aspectDeg, dynamic.windDirectionDeg, 0);
  const shelterFactor = 1 - exposureAlignment; // 1 = fullt i le, 0 = fullt eksponert
  return 1 - factor.strength * (1 - shelterFactor) * 0.2; // svært svak, aldri under 80 %
}

/** Én av fire grove døgnperioder — se `classifyTimeOfDay` under. */
type TimeOfDayCategory = "dawn" | "day" | "dusk" | "night";

/** ± vindu rundt sol opp/ned som regnes som "dawn"/"dusk" — SAMME vindu som computeCrepuscularActivityMultiplier bruker, for konsistens mellom de to relaterte mekanismene. */
const DAWN_DUSK_WINDOW_MS = 3600000;

/**
 * Kategoriserer "nå" relativt til dagens soloppgang/solnedgang. Ren
 * kalender-/klokkeslettbasert plassering — INGEN påstand om dyreatferd i seg
 * selv (det er `timeOfDayFactor` sin jobb, og kun for arter/vekter der
 * `profile.timeOfDayActivity.strength > 0`).
 *
 * Kjent forenkling (samme type forenkling som `determineSeason` sine
 * kalendermånedgrenser): sammenligner kun mot INNEVÆRENDE dags soloppgang/
 * solnedgang, ikke midnattssol/polarnatt-spesialtilfeller lengst nord — et
 * tidspunkt kort før midnatt på en dag med sen solnedgang vil da kunne
 * klassifiseres feil som "night" i stedet for sent på "day". Akseptert som
 * en praktisk begrensning, ikke rettet opp her (samme avveining som resten
 * av filen: enkel og forklarbar fremfor astronomisk fullstendig).
 */
function classifyTimeOfDay(whenMs: number, sunriseMs: number, sunsetMs: number): TimeOfDayCategory {
  if (Math.abs(whenMs - sunriseMs) <= DAWN_DUSK_WINDOW_MS) return "dawn";
  if (Math.abs(whenMs - sunsetMs) <= DAWN_DUSK_WINDOW_MS) return "dusk";
  if (whenMs > sunriseMs && whenMs < sunsetMs) return "day";
  return "night";
}

/**
 * Dag/natt-BASISNIVÅ (§F, V1.3) — et grovere, kategorisk supplement til den
 * kontinuerlige skumrings-/demringsbonusen over (crepuscularActivity), IKKE
 * en erstatning eller dobbelttelling av samme mekanisme:
 * - "dawn"/"dusk" returnerer nøytral 1 her — den effekten er allerede dekket
 *   (og bedre modellert, som en glatt avstandskurve) av
 *   `computeCrepuscularActivityMultiplier`.
 * - "day"/"night" er den NYE aksen: fanger opp at selve aktivitetsNIVÅET kan
 *   ligge systematisk høyere/lavere om natten enn om dagen, UTOVER selve
 *   soloppgang/solnedgang-overgangsvinduet.
 * Unngår eksplisitt en deterministisk "dyret er ute om natten"-regel (§Y):
 * dette er en svak, tak-begrenset SANNSYNLIGHETSJUSTERING, samme
 * capping-disiplin som windExposureFactor/edgeAffinityFactor over.
 */
function timeOfDayFactor(
  whenMs: number,
  dynamic: DynamicEnvironmentalFeatures,
  factor: SpeciesEcologyProfile["timeOfDayActivity"]
): number {
  if (factor.strength <= 0) return 1;
  if (dynamic.sunriseMs == null || dynamic.sunsetMs == null) return 1;
  const category = classifyTimeOfDay(whenMs, dynamic.sunriseMs, dynamic.sunsetMs);
  if (category === "dawn" || category === "dusk") return 1;
  if (category === "night") return 1 + factor.strength * 0.2; // svak nattbonus, aldri over 1.2×
  return 1 - factor.strength * 0.15; // svak dagreduksjon, aldri under 85 %
}

/**
 * Nedbør-relatert justering (§G, V1.3) — svak, REN FYSISK/ubehag-basert
 * effekt, samme forsiktighetsprinsipp som windExposureFactor over: INGEN
 * norsk, artsspesifikk primærkilde funnet for noen av de tre artene i denne
 * research-runden (se hver arts `precipitationSensitivity`-kommentar),
 * derfor identisk LOW-evidens-behandling som vind — aldri mer enn en svak,
 * tak-begrenset straff. `precipitationMm` er ÉN enkelt (siste) måling fra
 * Open-Meteo, ikke en trend (se dynamic.ts/cache.ts — ingen historikk
 * lagres, kun siste hentede verdi med 30 min TTL), så dette er bevisst BARE
 * "regner det nå", ikke "har det regnet mye siste døgnet".
 */
function precipitationFactor(
  precipitationMm: number | null,
  factor: SpeciesEcologyProfile["precipitationSensitivity"]
): number {
  if (factor.strength <= 0 || precipitationMm == null || precipitationMm <= 0) return 1;
  const norm = Math.max(0, Math.min(1, precipitationMm / 5)); // metning ved ~5 mm — "kraftig" nedbør, mer gir ikke ytterligere straff
  return 1 - factor.strength * norm * 0.15; // svært svak, aldri under 85 %
}

export type SuitabilityBreakdown = {
  habitat: number;
  winterSnowElevation: number;
  springGreenup: number;
  road: number;
  edge: number;
  windExposure: number;
  /** V1.3 (§F): dag/natt-basisnivå — se `timeOfDayFactor` over. */
  timeOfDay: number;
  /** V1.3 (§G): nedbør-justering — se `precipitationFactor` over. */
  precipitation: number;
};

export type SuitabilityResult = { suitability: number; breakdown: SuitabilityBreakdown };

/** Kombinerer alle romlige (ikke-tidsbundne-per-punkt) faktorer til én 0–1 suitability for ett punkt. */
export function computeSpatialSuitability(
  profile: SpeciesEcologyProfile,
  season: Season,
  whenMs: number,
  staticFeatures: StaticEnvironmentalFeatures,
  dynamic: DynamicEnvironmentalFeatures
): SuitabilityResult {
  const habitat = habitatFactor(profile, season, staticFeatures.habitat);

  let winterSnow = 1;
  let springGreenup = 1;
  if (season === "vinter") {
    winterSnow = winterSnowElevationFactor(
      staticFeatures.relativeElevationMeters,
      dynamic.snowDepthMeters,
      dynamic.temperatureC,
      profile.winterSnowElevation
    );
  } else if (season === "vårtrekk") {
    springGreenup = springGreenupFactor(staticFeatures.relativeElevationMeters, whenMs, profile.springGreenupElevation);
  }

  const road = roadDistanceFactor(staticFeatures.roadDistanceMeters, profile.roadSensitivity);
  const edge = edgeAffinityFactor(staticFeatures.nearHabitatEdge, profile.edgeAffinity);
  const windExposure = windExposureFactor(staticFeatures.aspectDeg, dynamic, profile.windExposureSensitivity);
  const timeOfDay = timeOfDayFactor(whenMs, dynamic, profile.timeOfDayActivity);
  const precipitation = precipitationFactor(dynamic.precipitationMm, profile.precipitationSensitivity);

  const suitability = Math.max(
    0,
    Math.min(1, habitat * winterSnow * springGreenup * road * edge * windExposure * timeOfDay * precipitation)
  );

  return {
    suitability,
    breakdown: { habitat, winterSnowElevation: winterSnow, springGreenup, road, edge, windExposure, timeOfDay, precipitation },
  };
}

/** Temporal (ikke stedbunden) aktivitetsbonus nær soloppgang/solnedgang. Anvendes likt over hele analyseområdet. */
export function computeCrepuscularActivityMultiplier(
  whenMs: number,
  dynamic: DynamicEnvironmentalFeatures,
  factor: SpeciesEcologyProfile["crepuscularActivity"]
): number {
  if (factor.strength <= 0) return 1;
  const windows = [dynamic.sunriseMs, dynamic.sunsetMs].filter((t): t is number => t != null);
  if (windows.length === 0) return 1;
  const closestDistMs = Math.min(...windows.map((t) => Math.abs(whenMs - t)));
  const withinHourFraction = Math.max(0, 1 - closestDistMs / 3600000);
  return 1 + factor.strength * withinHourFraction * 0.3;
}

/** Er "nå" innenfor artens brunstmåneder? Kun hjort har `movementBoost > 0` dokumentert (docs punkt 4). */
export function isRutActive(whenMs: number, profile: SpeciesEcologyProfile): boolean {
  const m = new Date(whenMs).getUTCMonth() + 1; // 1=jan..12=des
  return profile.rutBehavior.movementBoost > 0 && profile.rutBehavior.months.includes(m);
}
