// ViltIQ Engine v1 — forsterkning (§10–11).
//
// To uavhengige mekanismer:
//  1. Kamera-diversitet: flere UAVHENGIGE kamera som støtter samme område er
//     et sterkere signal enn samme kamera som ser dyret flere ganger (kan
//     være samme individ) — bonus påført PER SONE, etter klynging.
//  2. Bevegelseskorridor: en enkel form for "spatiotemporal reinforcement"
//     (§10) — IKKE full trajectory tracking. Kjeder sammenhengende
//     observasjonspar med konsistent retning og projiserer et punkt videre
//     langs korridoren, som gir en mild scorebonus til celler i nærheten.
//     Motoren later aldri som den kjenner en eksakt rute.
//
// Temporal density (§11: "4 observasjoner siste timer" skal telle mer enn
// "10 observasjoner over 6 måneder") er BEVISST ikke en egen bonus her — den
// oppstår allerede naturlig av at hvert bidrag i grid.ts er tidsvektet før
// det summeres (gamle observasjoner bidrar nesten ingenting uansett antall).
// En egen additiv "temporal density"-bonus ville dobbelttalt samme effekt
// under et annet navn.

import { calcBearing, distanceMeters, movePoint } from "@/src/lib/geo";
import type { EngineConfig } from "./config";
import { normalizeDegrees } from "./normalize";
import { angularDifferenceDeg, distanceWeight } from "./signals";
import type { SpeciesProfile } from "./species/profiles";
import type { EngineDebugCorridor, EngineObservation, LatLng } from "./types";

type Link = { fromIdx: number; toIdx: number; bearing: number };

function averageBearingDeg(bearings: readonly number[]): number {
  let x = 0;
  let y = 0;
  for (const b of bearings) {
    const rad = (b * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Finn enkle bevegelseskorridorer: kjeder av påfølgende observasjoner (i tid)
 * som ligger innenfor avstands-/tidsterskelen og peker i samme retning
 * (innenfor toleranse). En kjede med flere lenker og konsistent retning gir
 * en sterkere korridor enn en enkelt lenke.
 */
export function computeMovementCorridors(
  observations: readonly EngineObservation[],
  cfg: EngineConfig["reinforcement"]
): EngineDebugCorridor[] {
  if (observations.length < 2) return [];
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);

  const links: Link[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const dtHours = (b.timestamp - a.timestamp) / 3600000;
    if (dtHours <= 0 || dtHours > cfg.corridorMaxLinkHours) continue;
    const dist = distanceMeters(a.position, b.position);
    if (dist <= 1 || dist > cfg.corridorMaxLinkDistanceMeters) continue;
    links.push({ fromIdx: i, toIdx: i + 1, bearing: calcBearing(a.position, b.position) });
  }

  const corridors: EngineDebugCorridor[] = [];
  let chain: Link[] = [];

  const flush = () => {
    if (chain.length === 0) return;
    const avgBearing = averageBearingDeg(chain.map((l) => l.bearing));
    const consistent = chain.every((l) => angularDifferenceDeg(l.bearing, avgBearing) <= cfg.corridorBearingToleranceDeg);
    const last = sorted[chain[chain.length - 1].toIdx];
    const point = movePoint(last.position.latitude, last.position.longitude, avgBearing, cfg.corridorProjectionMeters);

    const idxs = new Set<number>();
    for (const l of chain) {
      idxs.add(l.fromIdx);
      idxs.add(l.toIdx);
    }

    corridors.push({
      point,
      bearingDeg: avgBearing,
      strength: Math.min(1, chain.length / 2) * (consistent ? 1 : 0.5),
      contributingIds: Array.from(idxs).map((i) => sorted[i].id),
    });
    chain = [];
  };

  for (const link of links) {
    const prev = chain[chain.length - 1];
    const contiguous = prev != null && prev.toIdx === link.fromIdx;
    const bearingOk = prev != null && angularDifferenceDeg(link.bearing, prev.bearing) <= cfg.corridorBearingToleranceDeg;
    if (chain.length > 0 && !(contiguous && bearingOk)) flush();
    chain.push(link);
  }
  flush();

  return corridors;
}

/** Scorebonus en rute får fra nærliggende korridorprojeksjoner. Tak: `maxCorridorBonus`. */
export function corridorBonusAt(
  point: LatLng,
  corridors: readonly EngineDebugCorridor[],
  profile: SpeciesProfile,
  cfg: EngineConfig
): number {
  let bonus = 0;
  for (const c of corridors) {
    const dist = distanceMeters(point, c.point);
    bonus += c.strength * profile.corridorWeight * distanceWeight(dist, profile.baseRadiusMeters);
  }
  return Math.min(cfg.reinforcement.maxCorridorBonus, bonus);
}

/**
 * Bonus for at en sone støttes av flere UAVHENGIGE kamera (ikke bare mange
 * observasjoner fra samme kamera, som kan være samme individ som passerer
 * flere ganger). 0 hvis 0 eller 1 unikt kamera bidrar.
 */
export function cameraDiversityBonus(
  contributingObservations: readonly EngineObservation[],
  cfg: EngineConfig["reinforcement"]
): number {
  const cameraIds = new Set(
    contributingObservations
      .filter((o) => o.source === "camera" && o.cameraId != null)
      .map((o) => o.cameraId as string)
  );
  if (cameraIds.size <= 1) return 0;
  return Math.min(cfg.maxCameraDiversityBonus, (cameraIds.size - 1) * cfg.perExtraCameraBonus);
}
