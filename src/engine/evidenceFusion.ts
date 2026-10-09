// ViltIQ Engine v1.3 (§J) — lokal evidens-tetthet ("evidence fusion").
//
// Flere observasjoner støtter allerede hverandre IMPLISITT i dag: hvert
// bidrag i grid.ts sin scoreCell summeres rått, og cameraDiversityBonus
// (reinforcement.ts) gir en egen bonus for uavhengige kamera. Det som
// MANGLER er en EKSPLISITT, navngitt oppsummering av akkurat DETTE mønsteret
// — "observasjon A peker mot nordøst, observasjon B ligger senere i tid
// lenger nordøst, habitatet mellom dem er gunstig" — som i dag er usynlig
// bakt inn i summen, i stedet for et tall/reason code man kan vise fram.
//
// KRITISK (§34, ikke-forhandlingsbart): dette er IKKE et forsøk på å avgjøre
// om observasjonene stammer fra samme individ. Motoren har ingen faktisk
// identifikasjon å bygge på, og skal ALDRI late som den har det. Språket
// (både her og i explain.ts sin reason code) er alltid "uavhengige signaler
// / overlappende signaler / support(ing) evidence" — ALDRI "samme dyr".
//
// Rent forklarings-/breakdown-formål: `computeEvidenceDensity` legges til
// EngineSignalBreakdown.evidenceDensity KUN for synlighet (§J: "en NAVNGITT
// versjon av et signal som før var usynlig bakt inn"). Den skal ALDRI legges
// til raw-scoren en gang til i engine.ts — de underliggende bidragene
// (repetition/cameraDiversity/corridor) er allerede talt med der. Å addere
// evidenceDensity på toppen ville dobbelttalt akkurat de samme signalene
// under et annet navn — samme fallgruve reinforcement.ts sin filkommentar
// advarer mot for "temporal density".

import { distanceMeters } from "@/src/lib/geo";
import type { EngineDebugCorridor, EngineObservation, LatLng } from "./types";

/** Metter mot 1 — første ekstra kilde/gjentakelse teller mest, avtagende marginalnytte deretter (samme form som confidence.ts sin saturate). */
function saturate(n: number, saturationCount: number): number {
  if (saturationCount <= 0) return n > 0 ? 1 : 0;
  return 1 - Math.exp(-n / saturationCount);
}

/** Antall EKSTRA uavhengige kilder der metningskurven for kilde-diversitet når ~63 % av maks. */
const SOURCE_SATURATION_COUNT = 2;
/** Antall EKSTRA bidragsytende observasjoner der metningskurven for repetisjon når ~63 % av maks. */
const REPETITION_SATURATION_COUNT = 3;

/** Vekt (0–1) hver delkomponent har i den samlede evidence-density-summen. */
const SOURCE_DIVERSITY_WEIGHT = 0.5;
const REPETITION_WEIGHT = 0.3;
const CORRIDOR_CONSISTENCY_WEIGHT = 0.4;

/** Tak på total evidence-density — samme enhet som rå cellescore (ikke normalisert 0–1), speiler tak-mønsteret til maxCorridorBonus/maxCameraDiversityBonus i config.ts. */
export const MAX_EVIDENCE_DENSITY = 1.2;

/** Hvor nærme sonens senter en korridors projiserte punkt må ligge for å regnes som "relevant for denne sonen" — samme avstandsbegrep som explain.ts sin nearestCorridor-logikk bruker til bullet/summary, bare som en fast terskel i stedet for et rent "nærmest"-valg. */
const CORRIDOR_RELEVANCE_METERS = 500;

/**
 * Regner ut hvor mye UAVHENGIG, innbyrdes KONSISTENT lokal evidens som
 * støtter samme sone — DETERMINISTISK ut fra observasjonene og korridorene
 * motoren allerede har regnet ut, ingen ny scoring av selve observasjonene.
 *
 * Tre delkomponenter, vektet og tak-begrenset:
 * - Kilde-diversitet: flere DISTINKTE kilder (ulike kamera, eller
 *   manuell/spor-registreringer regnet som hver sin kilde) er sterkere
 *   evidens enn samme kilde som gjentar seg (kan være samme individ som
 *   passerer flere ganger — se cameraDiversityBonus i reinforcement.ts, som
 *   bruker akkurat samme skille).
 * - Repetisjon: flere bidragsytende observasjoner totalt, uavhengig av kilde.
 * - Korridor-konsistens: finnes det en registrert bevegelseskorridor
 *   (reinforcement.ts sin computeMovementCorridors) som (a) faktisk stammer
 *   fra MINST ÉN av de bidragsytende observasjonene OG (b) projiserer et
 *   punkt nær DENNE sonen — nøyaktig "A peker mot NØ, B ligger lenger NØ"-
 *   mønsteret §J beskriver.
 */
export function computeEvidenceDensity(
  contributingObservations: readonly EngineObservation[],
  center: LatLng,
  corridors: readonly EngineDebugCorridor[]
): number {
  if (contributingObservations.length === 0) return 0;

  const sourceKeys = new Set(
    contributingObservations.map((o) => (o.source === "camera" && o.cameraId ? `cam:${o.cameraId}` : `${o.source}:${o.id}`))
  );
  const sourceDiversity = saturate(Math.max(0, sourceKeys.size - 1), SOURCE_SATURATION_COUNT);

  const repetition = saturate(Math.max(0, contributingObservations.length - 1), REPETITION_SATURATION_COUNT);

  const contributingIds = new Set(contributingObservations.map((o) => o.id));
  const relevantCorridor = corridors.find(
    (c) => distanceMeters(center, c.point) <= CORRIDOR_RELEVANCE_METERS && c.contributingIds.some((id) => contributingIds.has(id))
  );
  const corridorConsistency = relevantCorridor ? relevantCorridor.strength : 0;

  const density =
    sourceDiversity * SOURCE_DIVERSITY_WEIGHT + repetition * REPETITION_WEIGHT + corridorConsistency * CORRIDOR_CONSISTENCY_WEIGHT;

  return Math.min(MAX_EVIDENCE_DENSITY, density);
}
