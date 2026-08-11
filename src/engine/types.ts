// ViltIQ Engine v1 — motor-uavhengig domenemodell.
//
// Disse typene er bevisst FRIKOBLET fra src/types/observation.ts (som følger
// Firestore-formen). normalize.ts er eneste sted som oversetter mellom de to
// — motorens egne beregninger (signals/grid/reinforcement/confidence/
// explain) skal aldri måtte vite noe om hvordan ViltIQ lagrer data.

import type { LatLng } from "@/src/lib/geo";

export type { LatLng };

/** Intern artstype. Ukjente/uprioriterte arter (f.eks. "Rev") mappes til "annet". */
export type Species = "hjort" | "radyr" | "elg" | "annet";

export const PRIORITERTE_ARTER: readonly Species[] = ["hjort", "radyr", "elg"];

/** Hvor en observasjon kommer fra. */
export type EngineSource = "camera" | "manual" | "track";

/**
 * Én normalisert hendelse motoren kan resonnere over. Kun observasjoner med
 * kjent posisjon og gyldig tidspunkt blir til en EngineObservation — se
 * normalize.ts for hvilke rådata som filtreres bort og hvorfor.
 */
export type EngineObservation = {
  id: string;
  species: Species;
  /** Epoketid i millisekunder — motorens eneste interne tidsrepresentasjon. */
  timestamp: number;
  position: LatLng;
  source: EngineSource;
  /** Dyrets sannsynlige bevegelsesretning (0–360, 0=nord), IKKE det samme som cameraDirectionDeg. */
  movementDirectionDeg: number | null;
  /** Retningen kameraet peker (0–360). Kun satt når source === "camera". */
  cameraDirectionDeg: number | null;
  /** Antall dyr i observasjonen (alltid >= 1). */
  count: number;
  sex: string | null;
  age: string | null;
  /** Sportype (Fotspor/Avføring/...) — kun satt når source === "track". */
  trackType: string | null;
  cameraId: string | null;
  jaktlagId: string;
  /**
   * Grov 0–1 fullstendighetsheuristikk (har retning? har art? rimelig antall?)
   * — brukt som et svakt signal, IKKE en påstand om at observasjonen er sann.
   */
  dataQuality: number;
};

export type ConfidenceLevel = "lav" | "middels" | "høy";
export type ActivityLevel = "Lav" | "Moderat" | "Høy" | "Svært høy";

/**
 * Navngitt oppdeling av hva som bidro til en sones score — grunnlaget for
 * både den deterministiske forklaringen (explain.ts) og debug-inspektøren.
 * Alle verdier er rå, ikke-normaliserte bidrag (samme enhet som zone.score).
 */
export type EngineSignalBreakdown = {
  /** Bidrag fra tidsvekting (ferske observasjoner teller mest). */
  recency: number;
  /** Bidrag fra antall/repeterte observasjoner i området. */
  repetition: number;
  /** Bidrag fra kameraets retningsbias (foran > bak). */
  cameraDirection: number;
  /** Bidrag fra dyrets faktiske bevegelsesretning (sterkere enn kamerabias). */
  movementDirection: number;
  /** Bonus for at flere UAVHENGIGE kamera støtter samme område. */
  cameraDiversity: number;
  /** Bonus fra en registrert bevegelseskorridor (spatiotemporal reinforcement). */
  corridor: number;
  /** Bidrag fra økologisk suitability (høyde/snø/habitat/vei/kant/vind) — 0 når motoren kjøres uten miljødata. */
  ecology: number;
};

export type PredictionZone = {
  id: string;
  species: Species;
  center: LatLng;
  radiusMeters: number;
  /** 0–100, skalert visningsscore. IKKE en sannsynlighet. */
  score: number;
  level: ActivityLevel;
  /** 0–1, hvor mye datagrunnlag som støtter sonen — uavhengig av score. */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  observationCount: number;
  distinctCameraCount: number;
  /** Alder på nyeste bidragsytende observasjon, i minutter. */
  newestObservationAgeMinutes: number;
  /** 2–4 korte, deterministisk genererte punkter — se explain.ts. */
  dominantSignals: string[];
  /** Én kort, menneskelig setning bygget deterministisk fra signalene. */
  explanation: string;
  signalBreakdown: EngineSignalBreakdown;
};

export type EngineDebugCell = {
  center: LatLng;
  score: number;
  breakdown: EngineSignalBreakdown;
};

export type EngineDebugCorridor = {
  point: LatLng;
  bearingDeg: number;
  strength: number;
  contributingIds: string[];
};

export type EngineDebugInfo = {
  totalObservationsInput: number;
  totalObservationsAfterNormalize: number;
  gridCellCount: number;
  cellSizeMeters: number;
  /** De 10 høyest scorede rutene, uavhengig av om de ble til en sone. */
  topCells: EngineDebugCell[];
  corridors: EngineDebugCorridor[];
};

export type EngineResult = {
  engineVersion: string;
  species: Species;
  /** Epoketid (ms) da resultatet ble generert. */
  generatedAt: number;
  zones: PredictionZone[];
  /** Overordnet confidence — hentet fra beste sone, eller lav hvis ingen soner. */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** Én kort oppsummeringssetning for hele resultatet. */
  summary: string;
  /** De viktigste signalene på tvers av resultatet (speiler beste sone). */
  signals: string[];
  observationsConsidered: number;
  debug?: EngineDebugInfo;
};
