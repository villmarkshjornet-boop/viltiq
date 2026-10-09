// ViltIQ Engine v1 — prediction snapshots.
//
// Motoren i seg selv har ALDRI vært persistert: hvert skjermbilde regner ut
// runEngine/runEcologicalEngine på nytt via useMemo, og resultatet forsvinner
// idet komponenten re-renderer. Det gjør det umulig å noensinne spørre "hva
// trodde motoren kl. 20:00 i går, og stemte det?" — grunnlaget for enhver
// fremtidig kalibrering/evaluering (§21–24) mangler helt.
//
// Denne filen er den RENE (ingen Firestore/IO) halvparten av løsningen: en
// kompakt, lagringsvennlig projeksjon av et EngineResult, pluss en triviell
// throttle-sjekk. Selve Firestore-skrivingen bor i src/services/predictions.ts
// — holdt adskilt slik at denne filen (som resten av src/engine/) forblir
// fullt testbar med bare node:test, uten noen Firestore-avhengighet.
//
// Bevisst UTELATT her: EngineResult.heatmapPoints. Det er hele scoring-
// gridet (opptil maxGridCells punkter) og vokser fort — å lagre det per
// snapshot ville gjort denne samlingen uforholdsmessig stor uten å gi noe
// mer enn det sonene allerede oppsummerer. Et snapshot lagrer kun sonene.

import { ECOLOGY_MODEL_VERSION, ENVIRONMENT_SCHEMA_VERSION, SPECIES_PROFILE_VERSION } from "./config";
import { getSpeciesProfile } from "./species/profiles";
import type {
  ActivityLevel,
  ConfidenceLevel,
  EngineResult,
  LatLng,
  PredictionMode,
  Species,
} from "./types";

/** Kompakt, lagringsvennlig projeksjon av én PredictionZone — se filkommentaren for hvorfor heatmapPoints og de mer "debug-aktige" feltene (id, observationCount osv.) bevisst er utelatt. */
export type PredictionSnapshotZone = {
  center: LatLng;
  radiusMeters: number;
  score: number;
  level: ActivityLevel;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  dominantSignals: string[];
  /** Se PredictionMode i types.ts — avgjør senere om et snapshot kan brukes til å evaluere en RENT miljøbasert prediksjon vs. en lokalt underbygget en. */
  predictionMode: PredictionMode;
};

export type PredictionSnapshot = {
  userId: string;
  /** "" = offentlig/intet jaktlag — samme konvensjon som observations/cameras/fellings, ALDRI utelatt. */
  jaktlagId: string;
  species: Species;
  engineVersion: string;
  configVersion: string;
  /**
   * V1.1 (§27): versjon av miljølaget som produserte dette snapshotet — se
   * config.ts. Kun satt når motoren faktisk kjørte MED en miljøresolver
   * (runEcologicalEngine); et snapshot fra ren runEngine (ingen miljødata)
   * lar disse stå udefinert fremfor å late som en versjon som ikke gjaldt.
   */
  environmentSchemaVersion?: string;
  ecologyModelVersion?: string;
  speciesProfileVersion?: string;
  /** Epoketid (ms) da motoren genererte resultatet — kopiert fra EngineResult.generatedAt. */
  calculatedAt: number;
  /** = calculatedAt. Egen felt for symmetri med validUntil og for å gjøre "gyldig i intervallet [validFrom, validUntil]"-sjekker selvforklarende der de brukes. */
  validFrom: number;
  /** calculatedAt + et TTL-vindu — se validityWindowHours() for begrunnelsen. */
  validUntil: number;
  areaCenter: LatLng;
  areaRadiusMeters: number;
  zones: PredictionSnapshotZone[];
  observationsConsidered: number;
  summary: string;
};

/**
 * Hvor mange ganger artens temporalDecay-halveringstid (species/profiles.ts)
 * et snapshot regnes som "gyldig" i. Dette er, som resten av motorens
 * kalibrering, en fornuftig FØRSTE modell, ikke en vitenskapelig fasit:
 * 2–3 halveringstider er punktet der tidsvekten allerede har falt til en
 * brøkdel av opprinnelig verdi (se timeDecay.backgroundFloor i config.ts) —
 * altså der prediksjonen uansett ikke lenger er ment å representere "nå",
 * bare svak bakgrunnshistorikk. Egen konstant (ikke gjenbruk av
 * halfLifeHours direkte) fordi "hvor lenge er en LAGRET prediksjon relevant"
 * og "hvor fort taper en ENKELT observasjon vekt i motoren" er to beslektede,
 * men ikke identiske spørsmål.
 */
const VALIDITY_HALF_LIFE_MULTIPLIER = 2.5;

/** Gyldighetsvindu (timer) for et snapshot av en gitt art — se VALIDITY_HALF_LIFE_MULTIPLIER. */
export function validityWindowHours(species: Species): number {
  return getSpeciesProfile(species).timeHalfLifeHours * VALIDITY_HALF_LIFE_MULTIPLIER;
}

export type BuildSnapshotContext = {
  userId: string;
  jaktlagId: string;
  areaCenter: LatLng;
  areaRadiusMeters: number;
  /** Sett til true når `result` kom fra runEcologicalEngine (miljølag brukt) — styrer om environmentSchemaVersion/ecologyModelVersion/speciesProfileVersion stemples på snapshotet. */
  ecologyUsed?: boolean;
};

/**
 * Ren mapping fra et fullt EngineResult (+ kontekst kalleren alene kjenner —
 * hvem som kjørte det, for hvilket jaktlag, og hvilket kartutsnitt) til et
 * kompakt PredictionSnapshot klart for lagring. Ingen IO, ingen Firestore.
 */
export function buildPredictionSnapshot(
  result: EngineResult,
  context: BuildSnapshotContext
): PredictionSnapshot {
  const calculatedAt = result.generatedAt;
  const validUntil = calculatedAt + validityWindowHours(result.species) * 3600_000;

  return {
    userId: context.userId,
    jaktlagId: context.jaktlagId,
    species: result.species,
    engineVersion: result.engineVersion,
    configVersion: result.configVersion,
    ...(context.ecologyUsed
      ? {
          environmentSchemaVersion: ENVIRONMENT_SCHEMA_VERSION,
          ecologyModelVersion: ECOLOGY_MODEL_VERSION,
          speciesProfileVersion: SPECIES_PROFILE_VERSION,
        }
      : {}),
    calculatedAt,
    validFrom: calculatedAt,
    validUntil,
    areaCenter: context.areaCenter,
    areaRadiusMeters: context.areaRadiusMeters,
    zones: result.zones.map((zone) => ({
      center: zone.center,
      radiusMeters: zone.radiusMeters,
      score: zone.score,
      level: zone.level,
      confidence: zone.confidence,
      confidenceLevel: zone.confidenceLevel,
      dominantSignals: zone.dominantSignals,
      predictionMode: zone.predictionMode,
    })),
    observationsConsidered: result.observationsConsidered,
    summary: result.summary,
  };
}

/**
 * Startpunkt for hvor sjelden en kaller (kart.tsx, som en annen workstream
 * eier) bør skrive et nytt snapshot — IKKE en tunet verdi. 15 minutter er
 * valgt fordi det er kort nok til at "hva trodde motoren i går kveld"-
 * spørringen (§ oppdragets motivasjon) får rimelig tidsoppløsning, men langt
 * nok til at et skjermbilde som re-renderer på hver GPS-oppdatering ikke
 * skriver et nytt Firestore-dokument hvert sekund.
 */
export const DEFAULT_SNAPSHOT_MIN_INTERVAL_MS = 15 * 60 * 1000;

/** Triviell throttle: skal kalleren lagre et nytt snapshot nå? */
export function shouldSaveSnapshot(
  lastSavedAtMs: number | undefined,
  nowMs: number,
  minIntervalMs: number
): boolean {
  return lastSavedAtMs === undefined || nowMs - lastSavedAtMs >= minIntervalMs;
}
