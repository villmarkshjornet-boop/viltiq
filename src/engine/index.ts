// ViltIQ Engine v1 — offentlig API. Kartet (og annen kode) skal kun
// importere herfra, ikke fra motorens interne filer direkte.

export { runEngine, runEcologicalEngine, ENGINE_VERSION, CONFIG_VERSION, DEFAULT_ENGINE_CONFIG } from "./engine";
export type { RunEngineOptions, RunEcologicalEngineOptions, EngineConfig, AreaOfInterest } from "./engine";
export { getSpeciesProfile, HJORT_PROFILE, RADYR_PROFILE, ELG_PROFILE } from "./species/profiles";
export type { SpeciesProfile } from "./species/profiles";
export { PRIORITERTE_ARTER } from "./types";
export type {
  Species,
  EngineObservation,
  EngineResult,
  PredictionZone,
  HeatmapPoint,
  EngineSignalBreakdown,
  EnvironmentBreakdown,
  EngineDebugInfo,
  ConfidenceLevel,
  ActivityLevel,
  PredictionMode,
  LatLng,
} from "./types";

// Miljø/økologi (§C–§Å i motor-oppdraget) — se docs/ENGINE_RESEARCH.md for kildegrunnlag.
export { resolveEnvironmentContext } from "./environment/resolve";
export type {
  EnvironmentalContext,
  EnvironmentResolver,
  StaticEnvironmentalFeatures,
  DynamicEnvironmentalFeatures,
  HabitatClass,
} from "./environment/types";
export { getEcologyProfile } from "./ecology/profiles";
export type { SpeciesEcologyProfile, Season, EvidenceStrength } from "./ecology/types";
export { determineSeason } from "./ecology/suitability";

// Prediction snapshots (§21–24 i motor-oppdraget) — se snapshot.ts for
// hvorfor dette er en egen, ren fil adskilt fra Firestore-I/O.
export {
  buildPredictionSnapshot,
  validityWindowHours,
  shouldSaveSnapshot,
  DEFAULT_SNAPSHOT_MIN_INTERVAL_MS,
} from "./snapshot";
export type {
  PredictionSnapshot,
  PredictionSnapshotZone,
  BuildSnapshotContext,
} from "./snapshot";

// Utvikler-diagnostikk (§39 i V1.2-oppdraget) — IKKE brukerrettet, se debugLog.ts.
export { buildIntelligenceDebugReport, logIntelligenceDebug } from "./debugLog";

// Jaktplan (HuntPlan-oppdraget §3, re-eksportert her i Jaktplan-produktflyt-
// oppdragets §7) — ren API-opprydding: buildHuntPlan() var tidligere kun
// importert direkte fra ./huntPlan (se app/kart.tsx), ikke gjennom motorens
// offentlige barrel som resten av API-et. INGEN atferdsendring — samme
// funksjon, samme typer, kun nå tilgjengelig fra samme sted som alt annet.
export { buildHuntPlan, stablePredictionSnapshotId } from "./huntPlan";
export type {
  HuntPlan,
  HuntPlanZoneRef,
  HuntPlanAlternative,
  WindAssessment,
  ExpectedMovement,
  BuildHuntPlanOptions,
} from "./huntPlan";
