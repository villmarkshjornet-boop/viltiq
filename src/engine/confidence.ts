// ViltIQ Engine v1 — confidence (§20).
//
// Confidence handler om HVOR MYE DATAGRUNNLAG som støtter en sone — ikke
// hvor høy scoren er. Bygget av fire uavhengige delkomponenter (0–1 hver),
// vektet sammen via config.confidence.weights:
//   volume       antall bidragsytende observasjoner (metter, ikke lineært)
//   diversity    antall uavhengige kilder (ulike kamera + observasjonstyper)
//   consistency  hvor enige observasjonenes retninger er med hverandre
//   recency      hvor fersk den nyeste bidragsytende observasjonen er

import type { EngineConfig } from "./config";
import { timeWeight } from "./signals";
import type { ConfidenceLevel, EngineObservation } from "./types";

export function confidenceLevelFromScore(
  confidence: number,
  thresholds: EngineConfig["confidenceThresholds"]
): ConfidenceLevel {
  if (confidence >= thresholds.høy) return "høy";
  if (confidence >= thresholds.middels) return "middels";
  return "lav";
}

function saturate(n: number, saturationCount: number): number {
  if (saturationCount <= 0) return n > 0 ? 1 : 0;
  return 1 - Math.exp(-n / saturationCount);
}

/**
 * Sirkulær "resultant length" (0–1) for et sett retninger — 1.0 hvis alle
 * peker samme vei, mot 0 jo mer spredt de er. Standard mål for enighet
 * mellom vinkler (unngår fellene ved å ta simpelt gjennomsnitt av grader).
 */
function directionalConsistency(directionsDeg: readonly number[]): number {
  if (directionsDeg.length < 2) return 0.5; // for lite data til å si noe om enighet — verken belønn eller straff
  let x = 0;
  let y = 0;
  for (const d of directionsDeg) {
    const rad = (d * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  return Math.sqrt(x * x + y * y) / directionsDeg.length;
}

export function computeZoneConfidence(
  contributingObservations: readonly EngineObservation[],
  cfg: EngineConfig,
  nowMs: number
): number {
  if (contributingObservations.length === 0) return 0;

  const volume = saturate(contributingObservations.length, cfg.confidence.observationSaturationCount);

  const sourceKeys = new Set(
    contributingObservations.map((o) => (o.source === "camera" && o.cameraId ? `cam:${o.cameraId}` : o.source))
  );
  const diversity = saturate(sourceKeys.size, cfg.confidence.sourceSaturationCount);

  const directions = contributingObservations
    .map((o) => o.movementDirectionDeg ?? o.cameraDirectionDeg)
    .filter((d): d is number => d != null);
  const consistency = directionalConsistency(directions);

  const newestTimestamp = Math.max(...contributingObservations.map((o) => o.timestamp));
  const newestAgeHours = (nowMs - newestTimestamp) / 3600000;
  const recency = timeWeight(newestAgeHours, cfg.timeDecay);

  const w = cfg.confidence.weights;
  const combined = volume * w.volume + diversity * w.diversity + consistency * w.consistency + recency * w.recency;
  return Math.min(1, Math.max(0, combined));
}

/** Brukt når ingen sone når terskelen — gir likevel et ærlig (lavt) confidence-tall fremfor å late som 0 er "ukjent". */
export function computeFallbackConfidence(
  observations: readonly EngineObservation[],
  cfg: EngineConfig,
  nowMs: number
): number {
  return computeZoneConfidence(observations, cfg, nowMs) * 0.5; // halvert: ingen sone nådde terskelen, så selv "beste" støtte her er svak
}
