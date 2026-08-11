// ViltIQ Engine v1 — forklaringer (§21–22, §34).
//
// Bygges DETERMINISTISK fra tallene motoren allerede har regnet ut — ingen
// fri tekstgenerering. Samme input gir alltid samme forklaring. Språket
// følger §34: aldri "dyret er her", alltid "sannsynlig aktivitet" / "vurdert
// område" / "indikasjoner peker mot".

import { distanceMeters, vindRetningLabel } from "@/src/lib/geo";
import type { SpeciesProfile } from "./species/profiles";
import type { ActivityLevel, EngineDebugCorridor, EngineObservation, EngineSignalBreakdown, LatLng } from "./types";

function formatSpan(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `siste ${Math.max(1, min)} minutter`;
  const hrs = Math.round(ms / 3600000);
  if (hrs < 48) return `siste ${hrs} time${hrs === 1 ? "" : "r"}`;
  const days = Math.round(ms / 86400000);
  return `siste ${days} dager`;
}

function formatAge(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(0, min)} minutter`;
  const hrs = Math.round(ms / 3600000);
  if (hrs < 48) return `${hrs} time${hrs === 1 ? "" : "r"}`;
  const days = Math.round(ms / 86400000);
  return `${days} dager`;
}

type SignalCandidate = { text: string; weight: number };

export type ZoneExplanationInput = {
  species: SpeciesProfile;
  level: ActivityLevel;
  center: LatLng;
  contributingObservations: readonly EngineObservation[];
  breakdown: EngineSignalBreakdown;
  distinctCameraCount: number;
  corridors: readonly EngineDebugCorridor[];
  nowMs: number;
};

export type ZoneExplanation = { explanation: string; dominantSignals: string[] };

const MIN_SIGNAL_CONTRIBUTION = 0.05;

export function buildZoneExplanation(input: ZoneExplanationInput): ZoneExplanation {
  const { species, level, center, contributingObservations, breakdown, distinctCameraCount, corridors, nowMs } = input;

  if (contributingObservations.length === 0) {
    return {
      explanation: `Vurdert område med lite datagrunnlag for ${species.label.toLowerCase()}.`,
      dominantSignals: [],
    };
  }

  const timestamps = contributingObservations.map((o) => o.timestamp);
  const oldest = Math.min(...timestamps);
  const newest = Math.max(...timestamps);
  const noun = `${species.label.toLowerCase()}observasjoner`;

  const candidates: SignalCandidate[] = [];

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

  if (corridorRelevant && nearestCorridor) {
    candidates.push({
      text: `Aktiviteten ser ut til å bevege seg mot ${vindRetningLabel(nearestCorridor.bearingDeg)}`,
      weight: breakdown.corridor,
    });
  }

  if (distinctCameraCount >= 2) {
    candidates.push({
      text: `${distinctCameraCount} uavhengige kamera peker mot området`,
      weight: breakdown.cameraDiversity || distinctCameraCount,
    });
  }

  if (breakdown.cameraDirection > MIN_SIGNAL_CONTRIBUTION) {
    candidates.push({ text: `Kamerasektor peker mot området`, weight: breakdown.cameraDirection });
  }

  if (breakdown.movementDirection > MIN_SIGNAL_CONTRIBUTION) {
    candidates.push({ text: `Registrert bevegelsesretning peker mot området`, weight: breakdown.movementDirection });
  }

  // Alltid med: antall + tidsvindu, og alder på siste registrering — de to
  // enkleste, mest konkrete fakta motoren har (jf. eksempelet i §21).
  const always: string[] = [
    `${contributingObservations.length} ${noun} ${formatSpan(nowMs - oldest)}`,
    `Siste registrering er ${formatAge(nowMs - newest)} gammel`,
  ];

  candidates.sort((a, b) => b.weight - a.weight);
  const extra = candidates.slice(0, 2).map((c) => c.text);
  const dominantSignals = [...always, ...extra].slice(0, 4);

  const directionPhrase = corridorRelevant && nearestCorridor
    ? `Indikasjoner peker mot området ${vindRetningLabel(nearestCorridor.bearingDeg)} for siste registrering.`
    : `Vurdert område med ${level.toLowerCase()} aktivitetsscore.`;

  return { explanation: directionPhrase, dominantSignals };
}
