// ViltIQ Engine — økologiske artsprofiler. Se docs/ENGINE_RESEARCH.md for
// kildegrunnlaget bak HVER parameter under. `evidence` er internt (§W) —
// vises ikke til sluttbruker, men hindrer at en svakt fundert regel (f.eks.
// vind) får like sterk vekt som en godt dokumentert (f.eks. hjort/snø/høyde).

import type { HabitatClass } from "../environment/types";
import type { Species } from "../types";

export type EvidenceStrength = "HIGH" | "MEDIUM" | "LOW";

/**
 * Praktisk periodisering, IKKE i seg selv en forskningspåstand (se
 * docs/ENGINE_RESEARCH.md punkt 10). Grenser er kalendermånedbaserte og kan
 * justeres uten at det påstår noe om biologi.
 */
export type Season = "vinter" | "vårtrekk" | "sommer" | "brunst" | "senhøst";

export type HabitatSuitabilityMap = Partial<Record<HabitatClass, number>>;

export type WeightedFactor = { evidence: EvidenceStrength; strength: number };

export type SpeciesEcologyProfile = {
  species: Species;

  /** 0–1 suitability per habitatklasse. `bySeason` overstyrer `default` der den finnes. */
  habitatSuitability: {
    evidence: EvidenceStrength;
    default: HabitatSuitabilityMap;
    bySeason?: Partial<Record<Season, HabitatSuitabilityMap>>;
  };

  /** Vinter × snø × relativ høyde-interaksjon (docs punkt 1). 0 = ingen effekt. */
  winterSnowElevation: WeightedFactor;

  /** Vårtrekk × høydegradient-interaksjon (docs punkt 2). 0 = ingen effekt. */
  springGreenupElevation: WeightedFactor;

  /** Gradient-unngåelse av vei/bebyggelse (docs punkt 5). */
  roadSensitivity: WeightedFactor;

  /** Svak bonus nær habitat-overganger (docs punkt 6 — LOW evidens). */
  edgeAffinity: WeightedFactor;

  /** Ren fysisk le/vindeksponert-effekt (docs punkt 7 — LOW evidens, ingen atferdspåstand). */
  windExposureSensitivity: WeightedFactor;

  /** Aktivitetsbonus nær soloppgang/solnedgang (docs punkt 8 — MEDIUM evidens for prinsippet, ikke artsspesifikt kildebelagt). */
  crepuscularActivity: WeightedFactor;

  /**
   * V1.3 (§F): grovt dag/natt-BASISNIVÅ, atskilt fra `crepuscularActivity`
   * over — crepuscularActivity er en KONTINUERLIG bonus nær selve soloppgang/
   * solnedgang-overgangen, mens dette er en kategorisk "generelt mer/mindre
   * aktiv om natten enn om dagen"-justering. `strength` skalerer EN felles
   * formel (se `timeOfDayFactor` i suitability.ts) — samme mønster som
   * `windExposureSensitivity`/`edgeAffinity`, ikke fire frittstående tall,
   * nettopp for å unngå at motoren "finner på" fire uavhengige artstall uten
   * kildedekning. Se hver arts egen kommentar for hvorfor styrken er satt
   * som den er.
   */
  timeOfDayActivity: WeightedFactor;

  /**
   * Kun hjort har dokumentert brunstatferd (docs punkt 4). Andre arter har
   * movementBoost 0 — INGEN egen brunstprofil er gjettet inn for dem.
   */
  rutBehavior: { evidence: EvidenceStrength; movementBoost: number; months: readonly number[] };

  /**
   * V1.3 (§G): svak, REN FYSISK nedbør-effekt (samme forsiktighetsprinsipp
   * som `windExposureSensitivity` — ingen artsspesifikk, norsk primærkilde
   * funnet for noen av de tre artene i denne research-runden, se
   * suitability.ts sin `precipitationFactor`-kommentar). 0 = ingen effekt.
   */
  precipitationSensitivity: WeightedFactor;
};
